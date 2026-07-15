# Kubernetes — Orquestração Quando Containers Viram um Sistema

> **TL;DR:** Kubernetes reconcilia estado desejado: você declara réplicas, recursos e políticas; controllers tentam manter isso verdadeiro sob deploy e falha. Ele resolve operação repetida de muitos workloads — não corrige aplicação stateful, health check ruim, banco saturado ou time sem observabilidade.

**Conecta com:** [docker.md](docker.md) · [ci-cd.md](ci-cd.md) · [escalabilidade-load-balancing.md](escalabilidade-load-balancing.md) · [microsservicos.md](../backend/microsservicos.md) · [redes-de-computadores.md](../redes/redes-de-computadores.md) · [aws-infraestrutura.md](../aws/aws-infraestrutura.md)

---

## 1. Quando Kubernetes se paga — e quando não

Kubernetes compra uma API comum para scheduling, rollout, service discovery, autoscaling e políticas. Sinais reais:

- muitos serviços/times com deploys e requisitos repetidos;
- necessidade de portabilidade/controle além de um PaaS;
- plataforma com owners, observabilidade e operação do cluster;
- workloads variados que compartilham capacidade e guardrails.

Para uma API + worker de um time pequeno, ECS/Fargate, App Runner, Cloud Run ou outro PaaS geralmente entrega mais produto por hora. Um cluster exige upgrades, networking, ingress/gateway, DNS, storage, RBAC, políticas, custo e on-call — mesmo gerenciado.

⚠️ “Precisamos escalar” não implica Kubernetes. Load balancer + duas instâncias escalam tráfego; Kubernetes escala a **operação padronizada** de muitos workloads.

## 2. Arquitetura e loop de reconciliação

```text
kubectl / pipeline → API Server → etcd (estado desejado/observado)
                          │
               scheduler + controllers
                          │
                  kubelet em cada Node
                          │
                         Pods
```

Você não manda “suba este processo e espere”. Declara `replicas: 3`; controllers observam 2 e criam 1. Se um Pod morre, outro aparece — possivelmente com novo IP e em outro Node.

- **Control plane:** API, scheduling e reconciliação.
- **Node:** máquina que oferece CPU/memória para Pods.
- **Pod:** menor unidade implantável; um ou mais containers que compartilham rede/volumes.
- **Controller:** mantém o estado desejado, mas não conhece sua regra de negócio.

Self-healing reinicia processo; não reverte corrupção, loop lógico nem versão ruim que continua “healthy”.

## 3. Objetos que você usa todos os dias

| Objeto | Responsabilidade |
|---|---|
| Pod | executar containers juntos; efêmero |
| Deployment | réplicas stateless + rolling update/rollback |
| ReplicaSet | mantém quantidade de Pods; Deployment gerencia |
| Service | endereço/DNS estável para conjunto de Pods |
| ConfigMap / Secret | configuração não sensível / dado sensível |
| Job / CronJob | trabalho finito / agendado |
| StatefulSet + PVC | identidade/storage estáveis quando inevitável |
| Gateway/Ingress | entrada HTTP(S) conforme controller instalado |

Não crie Pod manual em produção: ao morrer, ninguém o recria e seu manifest não expressa rollout. Use controller adequado.

## 4. Deployment + Service de uma API Go

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  labels:
    app.kubernetes.io/name: api
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 0
      maxSurge: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: api
  template:
    metadata:
      labels:
        app.kubernetes.io/name: api
    spec:
      # Esta API não chama a API do cluster, então não recebe token automático.
      automountServiceAccountToken: false
      terminationGracePeriodSeconds: 30
      securityContext:
        runAsNonRoot: true
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: api
          image: registry.example/api@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
          ports:
            - name: http
              containerPort: 8080
          envFrom:
            - configMapRef:
                name: api-config
            - secretRef:
                name: api-secrets
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 500m
              memory: 256Mi
          startupProbe:
            httpGet: {path: /livez, port: http}
            failureThreshold: 30
            periodSeconds: 2
          readinessProbe:
            httpGet: {path: /readyz, port: http}
            periodSeconds: 5
            timeoutSeconds: 2
          livenessProbe:
            httpGet: {path: /livez, port: http}
            periodSeconds: 10
            timeoutSeconds: 2
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
---
apiVersion: v1
kind: Service
metadata:
  name: api
spec:
  selector:
    app.kubernetes.io/name: api
  ports:
    - name: http
      port: 80
      targetPort: http
  type: ClusterIP
```

O digest de 64 hex acima é apenas sintaticamente ilustrativo; o pipeline injeta o digest real. Labels do selector devem casar com o template; Service encontra Pods por label, não pelo nome do Deployment. Workload que acessa a API do cluster ou usa workload identity recebe `serviceAccountName` dedicado, token conforme a integração e RBAC mínimo — não reativa o token default indiscriminadamente.

Valores de recurso/probe são ponto inicial ilustrativo: profile e load test definem os reais. Read-only exige que temporários sejam externos ou montados em `emptyDir` apropriado.

## 5. Service discovery e caminho da rede

Pods mudam de IP. Service oferece DNS estável:

```text
frontend → http://api:80 → Service → endpoints de Pods ready:8080
```

- `ClusterIP`: apenas dentro do cluster; default para serviço interno.
- `LoadBalancer`: pede load balancer externo ao provider/controller.
- `NodePort`: expõe porta em Nodes; normalmente peça intermediária, não entrada web final.
- Headless Service (`clusterIP: None`): descoberta direta, comum em sistemas stateful.

NetworkPolicy controla tráfego somente se o plugin de rede a implementa. Sem políticas, muitos clusters permitem comunicação lateral ampla por default. DNS, timeout e retry continuam sendo problemas de rede normais.

## 6. Gateway API vs Ingress

Ingress continua estável e suportado, mas sua API está **congelada**; o projeto Kubernetes recomenda Gateway API para novos desenhos que precisam evoluir. Ingress exige controller; Gateway API exige as CRDs/APIs instaladas **e** um controller compatível. Criar uma rota em YAML sozinho não instala dataplane/load balancer.

| Opção | Use quando |
|---|---|
| Ingress | cluster/controller existente e roteamento HTTP simples |
| Gateway API | desenho novo, papéis infra/app separados, rotas/políticas mais expressivas |
| Service LoadBalancer | um serviço/porta sem roteamento compartilhado |

Fluxo típico:

```text
internet → load balancer/controller → Gateway/Ingress route
→ Service → Pod ready
```

TLS termina na borda ou segue até o Pod conforme threat model. Certificado, DNS, timeout, limite de corpo e headers confiáveis precisam configuração explícita.

## 7. ConfigMap e Secret

```yaml
apiVersion: v1
kind: ConfigMap
metadata: {name: api-config}
data:
  PORT: "8080"
  LOG_LEVEL: "info"
```

Secret no Kubernetes é base64 no manifest/API, **não criptografia por si só**. Por padrão, os dados persistidos na camada de storage do API server (`etcd`) não têm encryption at rest habilitada: configure-a, restrinja acesso/backup do `etcd` e aplique RBAC mínimo. Não commite valor real; prefira integração com secret manager externo/CSI/operator conforme ambiente.

- Separe config não sensível de segredo.
- Mudança injetada como env só chega a Pods novos; faça rollout controlado.
- Evite um Secret gigante compartilhado entre serviços.
- ServiceAccount/workload identity dá acesso temporário à cloud sem chave estática.
- Secret montado ainda pode ser lido pelo processo comprometido; menor privilégio continua necessário.

## 8. Probes: três perguntas diferentes

| Probe | Pergunta | Falha causa |
|---|---|---|
| startup | terminou de iniciar? | bloqueia liveness/readiness; pode reiniciar após limite |
| readiness | aceita tráfego agora? | remove dos endpoints |
| liveness | está travado sem recuperação? | reinicia container |

Não faça liveness depender de Postgres/terceiro: indisponibilidade externa reiniciaria todos os Pods, criando tempestade. Readiness pode refletir incapacidade real de servir, mas deve ser rápida e estável.

Probe mal calibrada causa CrashLoopBackOff em aplicação saudável/lenta. Observe startup real e dê margem; reinício não resolve saturação.

## 9. Requests, limits e scheduling

- **request:** o scheduler reserva/usa para posicionar o Pod; HPA de CPU normalmente calcula utilização relativa a ele.
- **CPU limit:** excesso é throttled; limite muito baixo aumenta p99 sem OOM.
- **memory limit:** excesso leva a OOM kill; memória não pode ser “throttled” como CPU.

Sem requests, cluster parece ter espaço até todos disputarem. Requests exagerados deixam Nodes vazios e Pods Pending. Use métricas p95/p99, profile e margem de pico; revise após produção.

```text
capacidade útil do cluster ≠ soma nominal dos Nodes
                      - sistema - DaemonSets - margem de falha
```

Defina quotas/LimitRanges por namespace para um time não consumir tudo. Namespace organiza e aplica políticas; não é isolamento forte sozinho.

## 10. Rollout, draining e rollback

Rolling update mantém versões antiga/nova simultâneas. Portanto contrato HTTP, evento e schema precisam compatibilidade:

```text
imagem nova → Pod inicia → startup passa → readiness passa
→ entra no Service → Pod antigo fica unready/drena → SIGTERM
→ app encerra requests → processo sai antes do grace period
```

Comandos de diagnóstico:

```bash
kubectl rollout status deployment/api
kubectl get pods -l app.kubernetes.io/name=api
kubectl describe pod <pod>
kubectl logs <pod> --previous
kubectl rollout undo deployment/api
```

Rollback de imagem não desfaz schema. Use migrations expand-contract. `maxUnavailable: 0` melhora disponibilidade, mas requer capacidade para surge e readiness honesta.

PodDisruptionBudget limita **disrupções voluntárias** (drain/upgrade), não ressuscita Node que falhou. Distribua réplicas entre Nodes/AZs com topology spread/anti-affinity quando o requisito justificar.

## 11. Autoscaling em camadas

| Autoscaler | Altera | Sinal típico |
|---|---|---|
| HPA | réplicas de Pods | CPU, requests/target, métrica custom |
| VPA (add-on) | requests/limits | uso histórico; requer instalação/métricas e pode reiniciar |
| node/cluster autoscaler | quantidade/tamanho de Nodes | Pods Pending por falta de capacidade |

HPA não cria Node instantaneamente e Pod novo precisa de startup. Métricas de recurso normalmente exigem Metrics Server; VPA é CRD/controller instalado separadamente. Defina `min`, `max`, comportamento de scale-up/down e warm-up. Métrica deve acompanhar o gargalo: worker escala por idade/backlog; API pode escalar por requests/CPU.

Escalar Pods multiplica pools/conexões. Banco saturado piora com mais réplicas. `maxReplicas`, backpressure e orçamento de conexões protegem dependências.

## 12. Estado, Jobs e CronJobs

Aplicação stateless usa Deployment; dados duráveis preferem serviço gerenciado quando possível. StatefulSet oferece identidade/ordem/PVC, não opera backup, replicação, failover ou upgrade do banco por você.

- PVC sobrevive ao Pod conforme StorageClass/reclaim policy; não é backup.
- `emptyDir` vive com o Pod e some quando ele é removido.
- Job deve ser idempotente e ter retries/timeout.
- CronJob define `concurrencyPolicy`, deadline e histórico; execução pode atrasar/duplicar conforme falhas.

Migration como Job precisa serialização e compatibilidade. Não deixe cada réplica da API tentar migrar ao iniciar.

## 13. Segurança e observabilidade mínimas

- RBAC mínimo por ServiceAccount; nunca token/admin compartilhado.
- Pod Security Standards/admission: non-root, sem privilege, capabilities mínimas, seccomp.
- NetworkPolicy default-deny + liberações necessárias, após mapear DNS/egress.
- Imagem por digest, registry permitido, scan/assinatura conforme risco.
- Audit log do control plane e secrets fora do Git.
- Logs estruturados em stdout, métricas RED, eventos do cluster e traces com correlation ID.

Observe app **e** plataforma: rate/errors/duration, restarts, OOMKilled, throttling, Pending, rollout falho, saturação de Nodes, DNS e certificado. `kubectl logs` manual não é centralização.

## 14. ⚠️ Over-engineering comum

| Sintoma | Alternativa |
|---|---|
| cluster para 1–2 containers | PaaS/ECS/Fargate/Compose local |
| service mesh antes de métricas/timeouts | HTTP + TLS + observabilidade básica |
| operator custom para configuração | Deployment/Job/CI simples |
| banco no cluster sem time de storage | RDS/serviço gerenciado |
| HPA por CPU em worker de fila | idade/backlog por consumidor |
| liveness consulta todas dependências | sinal interno mínimo |
| Helm com dezenas de flags para um app | manifest/Kustomize/chart pequeno |
| namespace tratado como isolamento | RBAC + NetworkPolicy + contas/clusters conforme risco |

## 15. Checklist Kubernetes

- [ ] Kubernetes atende um problema operacional real que o PaaS mais simples não atende
- [ ] Workload usa controller (Deployment/Job/StatefulSet), nunca Pod solto
- [ ] Imagem é non-root, imutável por digest e recebe SIGTERM corretamente
- [ ] Service seleciona labels corretas e só expõe o necessário
- [ ] Startup/readiness/liveness respondem perguntas distintas e foram calibradas
- [ ] Requests/limits vêm de medição; OOM/throttling/Pending têm alertas
- [ ] Rollout tolera duas versões e migration segue expand-contract
- [ ] HPA usa métrica do gargalo, tem min/max/warm-up e respeita banco/pools
- [ ] Secret não está no Git; workload identity/RBAC aplicam menor privilégio
- [ ] NetworkPolicy/admission/quotas reduzem movimento lateral e blast radius
- [ ] Estado tem backup/restore; PVC nunca é confundido com backup
- [ ] Logs, métricas, eventos e traces permitem diagnosticar sem entrar no Pod
