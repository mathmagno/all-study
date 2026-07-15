# AWS — Infraestrutura Segura e Evolutiva para uma Aplicação Web

> **TL;DR:** Uma boa arquitetura AWS não começa com 30 serviços. Começa com identidade protegida, rede compreendida, aplicação stateless, dados privados, backups testados e métricas. Adicione alta disponibilidade e escala conforme o impacto da falha justificar o custo.

**Conecta com:** [redes-de-computadores.md](../redes/redes-de-computadores.md) (CIDR, subnets, DNS e TLS) · [seguranca-da-informacao.md](../seguranca/seguranca-da-informacao.md) (menor privilégio e defesa em profundidade) · [docker.md](../devops/docker.md) · [infraestrutura-como-codigo.md](../devops/infraestrutura-como-codigo.md) · [aws-custos.md](aws-custos.md) · [aws-estimativa-usuarios-capacidade.md](aws-estimativa-usuarios-capacidade.md)

---

## 1. O modelo mental: responsabilidade, Region e AZ

A AWS protege datacenters, hardware e a infraestrutura dos serviços gerenciados. Você continua responsável por **identidades, permissões, configuração de rede, dados, código, backups e observabilidade**. Serviço gerenciado reduz trabalho operacional; não elimina decisões.

- **Region:** área geográfica independente (`sa-east-1`, `us-east-1`). Escolha por latência, requisitos legais, disponibilidade de serviços e custo.
- **Availability Zone (AZ):** conjunto isolado de datacenters dentro da Region. Duas AZs protegem contra a falha de uma instalação; não contra erro de deploy ou exclusão lógica.
- **Edge location:** ponto de presença de CloudFront/Route 53 próximo do usuário; não é onde sua API ou seu banco necessariamente rodam.

**Regra prática:** uma Region, duas AZs para os componentes que realmente precisam de alta disponibilidade. Multi-Region só entra quando o negócio exige sobreviver à perda de uma Region e aceita pagar pela replicação, consistência e operação duplicadas.

## 2. Antes da primeira instância: proteja a conta

A camada de identidade é o perímetro real da cloud:

1. Ative MFA forte no usuário root; não crie access key para root e não o use no dia a dia.
2. Use IAM Identity Center ou federação para pessoas; dê acesso temporário por roles, não chaves permanentes espalhadas em notebooks.
3. Aplique menor privilégio e separe **role da aplicação**, **role do deploy** e **role humana**.
4. Habilite CloudTrail e centralize trilhas de auditoria.
5. Crie AWS Budget e alerta de anomalia **antes** dos recursos caros.
6. Se houver equipe e ambientes relevantes, separe produção de desenvolvimento por contas dentro de AWS Organizations.

```text
Pessoa ──SSO──> role de desenvolvimento (tempo limitado)
GitHub Actions ──OIDC──> role de deploy (somente pipeline autorizado)
ECS task ──task role──> S3/SQS necessários (sem chave no container)
```

Uma access key vazada em `.env` continua válida até ser revogada. Credencial temporária expira e pode ser limitada pelo repositório, branch e ambiente que a solicitou.

## 3. VPC: uma rede isolada, não uma caixa mágica

A **VPC** é seu espaço de endereços e suas regras de roteamento. Comece com CIDR que permita crescimento sem sobreposição, por exemplo `10.0.0.0/16`, e divida por função e AZ:

| Subnet | AZ A | AZ B | Rota de saída |
|---|---|---|---|
| Pública | `10.0.0.0/24` | `10.0.1.0/24` | `0.0.0.0/0 → Internet Gateway` |
| App privada | `10.0.10.0/24` | `10.0.11.0/24` | NAT ou VPC endpoints, se necessário |
| Dados privada | `10.0.20.0/24` | `10.0.21.0/24` | sem rota direta para internet |

Uma subnet é “pública” porque sua **route table** aponta para um Internet Gateway; o nome não produz isolamento. Recurso também precisa de IP público e regra permitindo tráfego para ser alcançável.

**NAT Gateway** permite que workloads privadas iniciem conexões IPv4 para fora (baixar pacote, chamar terceiro) sem aceitar conexões iniciadas da internet. Ele tem custo por hora e por volume; para S3/ECR/serviços compatíveis, VPC endpoints podem reduzir exposição e, conforme o tráfego, custo. Não adicione NAT “porque todo diagrama tem”.

## 4. Arquitetura de referência para Go + React

```text
                         ┌── CloudFront ── S3 privado (React/Vite)
Browser ── Route 53 ─────┤
                         └── ALB público (HTTPS/ACM)
                                  │
                    ┌─────────────┴─────────────┐
               ECS/Fargate A              ECS/Fargate B
               subnet privada              subnet privada
                    └─────────────┬─────────────┘
                                  │
                         RDS PostgreSQL privado
                           Multi-AZ quando exigido
                                  │
                       S3 (arquivos) / SQS (trabalho)
```

- **S3 + CloudFront:** assets estáticos; Origin Access Control mantém o bucket fora da internet direta.
- **Application Load Balancer (ALB):** termina TLS, faz health check e distribui HTTP entre tasks saudáveis.
- **ECS com Fargate:** executa a imagem Docker sem administrar hosts; bom default quando o time não precisa da API do Kubernetes.
- **RDS PostgreSQL:** backups, patching e failover gerenciados; ainda exige índices, queries boas e capacidade correta.
- **S3:** upload e artefato durável; nunca dependa do disco efêmero da task.
- **SQS:** trabalho assíncrono que não precisa prolongar a requisição HTTP.

O desenho é uma **referência**, não uma lista de compras. Um MVP pode começar em App Runner, Lightsail, uma instância ou um PaaS. Migre quando limites medidos justificarem as peças.

## 5. Security Group e NACL: firewall em duas escalas

| Controle | Aplica em | Estado | Uso recomendado |
|---|---|---|---|
| Security Group | ENI/recurso | **stateful** | regra principal entre componentes |
| Network ACL | subnet | **stateless** | guardrail amplo; raramente precisa customização fina |

Modele permissões por **origem lógica**, referenciando Security Groups:

```text
sg-alb: entrada 443 da internet; saída 8080 para sg-api
sg-api: entrada 8080 somente de sg-alb; saída 5432 para sg-db
        e 443 somente para endpoints/prefix lists/destinos externos aprovados
sg-db:  entrada 5432 somente de sg-api; sem acesso público
```

Não abra Postgres em `0.0.0.0/0`, nem “temporariamente”. Para diagnóstico, use sessão auditável (ECS Exec/Systems Manager), túnel controlado ou ferramenta dentro da VPC. Bastion permanente com SSH público costuma aumentar a superfície sem necessidade.

## 6. Compute: escolha pelo trabalho operacional que você aceita

| Opção | Você gerencia | Boa quando | Cuidado |
|---|---|---|---|
| App Runner | imagem e config | app web simples, time pequeno | menos controle e opções de rede |
| ECS + Fargate | tasks, service e rede | containers sem administrar servidor | custo por task sempre ligada |
| ECS + EC2 | cluster e hosts | carga estável/grande, otimização de custo | patching e capacidade dos hosts |
| Lambda | função e eventos | carga intermitente, tarefas curtas | cold start, limites e modelo diferente |
| EKS | cluster Kubernetes e workloads | organização já precisa do ecossistema K8s | maior custo operacional |

**Escolha o serviço mais simples que atende os requisitos atuais.** Kubernetes não torna a aplicação automaticamente disponível; ele adiciona um control plane, objetos e um novo conjunto de falhas para operar.

Para qualquer opção, a aplicação deve ser stateless, responder a `SIGTERM`, encerrar requisições em voo e expor endpoints de saúde. Esses fundamentos estão em [docker.md](../devops/docker.md) e [kubernetes.md](../devops/kubernetes.md).

## 7. Dados: durabilidade exige mais que “usar RDS”

### RDS PostgreSQL

- `PubliclyAccessible=false`, subnets de dados privadas e acesso apenas pelo `sg-api`.
- Backups automáticos com retenção compatível com o negócio e **restauração testada**.
- Multi-AZ **de instância** usa standby para failover e não serve leitura. Multi-AZ **DB cluster** tem writer + readers; escolha conscientemente o modo e seus endpoints/custos.
- Read replica quando SELECTs medidos saturarem o primário e a aplicação aceitar atraso de replicação.
- Connection pool limitado: 20 tasks × 50 conexões = 1.000 conexões no banco. Escalar API sem orçamento de conexões derruba o banco.
- Migrações versionadas e compatíveis com deploy gradual; nunca altere schema manualmente em produção.

### S3 e cache

Use S3 para arquivos, backups e artefatos; ative versionamento/lifecycle conforme recuperação e custo. Redis/ElastiCache entra para cache, sessão ou coordenação efêmera — não como única cópia de dado importante.

**Backup não testado é esperança, não recuperação.** Defina RPO (quanto dado pode perder) e RTO (quanto tempo pode ficar fora) e prove ambos com exercício periódico.

## 8. Segredos, criptografia e certificados

- **Secrets Manager:** segredos com rotação/gestão; **SSM Parameter Store:** configuração e parâmetros, inclusive valores protegidos.
- Passe o identificador do segredo para a task; a task role busca em runtime. Não grave valor no Dockerfile, Terraform state, repositório ou log.
- KMS controla chaves usadas por serviços; prefira criptografia gerenciada e restrinja quem pode descriptografar.
- ACM emite/renova certificados: o do ALB fica na mesma Region do ALB; o certificado de viewer do CloudFront deve estar em `us-east-1`. Redirecione HTTP para HTTPS e use TLS até a borda adequada ao threat model.
- Separe **task execution role** (ECS puxa imagem/escreve logs) de **task role** (sua aplicação acessa AWS APIs).

## 9. DNS, TLS e caminho real da requisição

```text
Route 53 resolve api.exemplo.com
  → cliente negocia TLS com ALB (certificado ACM)
  → ALB escolhe target healthy
  → task Go processa com X-Request-ID
  → task consulta RDS pela rede privada
  → resposta volta pelo mesmo caminho
```

Configure timeouts coerentes em cada salto: cliente > ALB > servidor > chamadas internas. Preserve `X-Forwarded-For` somente a partir do proxy confiável e gere/propague um correlation ID. DNS, TCP, TLS e os `502/503/504` desse caminho são detalhados em [redes-de-computadores.md](../redes/redes-de-computadores.md).

## 10. Observabilidade mínima antes de produção

1. **Logs estruturados** em CloudWatch Logs, com retenção explícita — “para sempre” vira custo e risco.
2. **Métricas RED:** rate, errors e duration p95/p99 da API; CPU/memória/restarts das tasks; conexões, storage e latência do RDS.
3. **Alarmes acionáveis:** erro 5xx, nenhum target saudável, saturação do banco, fila envelhecendo, falha de backup e custo anormal.
4. **CloudTrail:** quem alterou recursos/permissões; não substitui log da aplicação.
5. **VPC Flow Logs:** diagnóstico de tráfego aceito/rejeitado quando necessário; habilitar tudo sem retenção também custa.

Alarme sem responsável, severidade e ação esperada é ruído. Comece pelos sintomas percebidos pelo usuário e depois alerte causas internas.

## 11. Deploy sem interromper usuários

O pipeline publica uma imagem imutável identificada pelo commit, atualiza a definição da task e acompanha o rollout:

```text
testes → build → scan → push ECR → migração compatível → deploy ECS
      → ALB espera readiness → tráfego entra → tasks antigas drenam → verificação
```

- Nunca use apenas `latest`; grave o digest/tag do commit para saber e restaurar exatamente o que rodou.
- Health check de readiness verifica se a task pode receber tráfego; não dependa de dez serviços externos para responder saudável.
- Configure deregistration/draining e graceful shutdown para terminar requests em voo.
- Rollback da aplicação deve ser rápido; rollback de banco depende de migração **backward-compatible** (expand → migrate → contract).

CI/CD completo em [ci-cd.md](../devops/ci-cd.md); recursos declarativos e proteção do `plan/apply` em [infraestrutura-como-codigo.md](../devops/infraestrutura-como-codigo.md).

## 12. Caminho evolutivo e custo de disponibilidade

| Fase | Arquitetura suficiente | Próximo sinal |
|---|---|---|
| Validação | serviço simples + banco gerenciado | produto encontrou usuários |
| Produção inicial | S3/CloudFront + ALB + 1 task + RDS | downtime da task já importa |
| Alta disponibilidade | 2+ tasks/AZs + RDS Multi-AZ | gargalo medido de app/banco |
| Escala | autoscaling + cache/fila/read replica conforme métrica | limite de uma Region/RPO/RTO |
| Crítica global | estratégia Multi-Region específica | requisito contratual e testes de failover |

Alta disponibilidade não é um botão: duas tasks não ajudam se o deploy quebra ambas; Multi-AZ não ajuda se alguém executa `DROP TABLE`; Multi-Region não ajuda se a credencial comprometida apaga tudo. Redundância, backup, isolamento e processo de mudança resolvem falhas diferentes.

## 13. ⚠️ Over-engineering comum na AWS

| Sintoma | Alternativa pragmática |
|---|---|
| EKS para uma API e um worker | ECS/Fargate ou App Runner |
| Multi-Region sem RTO/RPO de negócio | uma Region + duas AZs + restore testado |
| NAT em toda AZ num ambiente de estudo | endpoint/saída mínima; aceite conscientemente o trade-off de HA |
| Aurora “porque escala” com carga pequena | RDS PostgreSQL dimensionado e medido |
| Redis antes de otimizar query | índice + `EXPLAIN ANALYZE` |
| Bastion SSH público | ECS Exec/SSM com auditoria |
| 40 alarmes genéricos | poucos alarmes ligados a impacto e runbook |
| Copiar arquitetura de big tech | estimar RPS, disponibilidade e orçamento próprios |

## 14. Checklist de infraestrutura AWS

- [ ] Root sem access keys e com MFA; pessoas usam SSO/roles temporárias
- [ ] Budget, alerta de anomalia e tags de custo configurados
- [ ] CIDR e route tables entendidos; banco e aplicação sem exposição pública desnecessária
- [ ] Security Groups referenciam outros grupos, não IPs amplos
- [ ] Aplicação stateless, imagem imutável, graceful shutdown e health checks
- [ ] Segredos fora do código/imagem/state; roles com menor privilégio
- [ ] RDS privado, pool de conexões limitado, backups e restauração testados
- [ ] Logs com retenção; métricas RED e alarmes acionáveis
- [ ] Recursos criados por IaC e mudanças de produção revisadas
- [ ] Cada peça de alta disponibilidade justificada por RTO/RPO e impacto real
