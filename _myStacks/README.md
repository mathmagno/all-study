# My Stacks — Engenharia de Software do Código à Produção

> **Objetivo:** um mapa de estudo prático para construir, entregar e operar aplicações Go + React/TypeScript sem decorar ferramentas. Cada guia parte de princípios duráveis, mostra decisões de produção e deixa explícito quando a complexidade ainda não se paga.

**Stack de referência:** Go · `net/http`/chi · REST · PostgreSQL · React · TypeScript · Vite · Tailwind · Docker · AWS

---

## Comece aqui

| Se você quer... | Abra primeiro |
|---|---|
| iniciar um projeto Go + React agora | [Guia de Inicialização](startProjects.md) |
| entender um bug entre browser e API | [Protocolo HTTP](backend/protocolo-http.md) → [Redes](redes/redes-de-computadores.md) |
| desenhar um contrato de API | [APIs REST](backend/apis-rest.md) |
| revisar segurança antes de produção | [Segurança da Informação](seguranca/seguranca-da-informacao.md) |
| publicar a aplicação em container | [Docker](devops/docker.md) → [CI/CD](devops/ci-cd.md) |
| descobrir se o sistema precisa escalar | [System Design](backend/system-design-fundamentos.md) → [Escalabilidade](devops/escalabilidade-load-balancing.md) |
| processar trabalho fora do request | [Mensageria e Filas](devops/mensageria-filas.md) |
| decidir entre monolito e serviços | [Microsserviços](backend/microsservicos.md) |
| montar a infraestrutura na AWS | [AWS — Infraestrutura](aws/aws-infraestrutura.md) |
| estimar carga e tamanho | [AWS — Capacidade](aws/aws-estimativa-usuarios-capacidade.md) |
| controlar a fatura | [AWS — Custos](aws/aws-custos.md) |

## Trilha recomendada

### 0. Construa uma vez

1. [Guia de Inicialização — Go + React/TS + Tailwind](startProjects.md) — monorepo, DTOs, cookies HttpOnly, CORS e estrutura mínima.

O objetivo desta etapa é ter algo executável. Os próximos guias explicam **por que** cada fronteira existe e como ela se comporta sob falha e escala.

### 1. Domine o caminho da requisição

1. [Protocolo HTTP — Do Request ao HTTP/3](backend/protocolo-http.md) — métodos, status, headers, cache, timeouts e shutdown.
2. [APIs REST — Design de Contratos que Duram](backend/apis-rest.md) — recursos, paginação, erros, idempotência e versionamento.
3. [Redes de Computadores](redes/redes-de-computadores.md) — TCP/IP, DNS, TLS, CIDR, NAT, load balancer e diagnóstico.
4. [Segurança da Informação](seguranca/seguranca-da-informacao.md) — threat modeling, autenticação, autorização, segredos e defesa em profundidade.

Ao terminar, você deve conseguir seguir uma requisição do DNS ao banco e localizar em qual camada ela falhou.

### 2. Pense em sistemas, não só endpoints

1. [System Design — Fundamentos Eternos](backend/system-design-fundamentos.md) — requisitos, estimativas, consistência, disponibilidade e gargalos.
2. [Escalabilidade e Load Balancing](devops/escalabilidade-load-balancing.md) — escala vertical/horizontal, cache, banco, health checks e backpressure.
3. [Mensageria e Filas](devops/mensageria-filas.md) — trabalho assíncrono, entrega, retries, DLQ, idempotência e outbox.
4. [Microsserviços](backend/microsservicos.md) — fronteiras, sagas, resiliência e os sinais reais para extrair um serviço.

Essa ordem é intencional: microsserviços usam rede, mensageria e observabilidade como fundação. Começar por eles inverte causa e solução.

### 3. Entregue com repetibilidade

1. [Git — Histórico que Ajuda em vez de Atrapalhar](devops/git.md) — commits, branches, rebase/merge, conflitos e recuperação.
2. [Docker — Da Imagem ao Processo em Produção](devops/docker.md) — layers, multi-stage, Compose, segurança e sinais.
3. [CI/CD — Do Commit ao Deploy Confiável](devops/ci-cd.md) — gates, artefatos imutáveis, OIDC, migrações e rollback.
4. [Infraestrutura como Código](devops/infraestrutura-como-codigo.md) — Terraform/OpenTofu, state, módulos, ambientes, drift e revisão.
5. [Kubernetes](devops/kubernetes.md) — desired state, Deployments, Services, probes, recursos, rollout e autoscaling.

Kubernetes está no fim, não no início: primeiro domine a imagem, o processo, a entrega e a infraestrutura que o cluster vai orquestrar.

### 4. Opere na AWS com números

1. [AWS — Infraestrutura Segura e Evolutiva](aws/aws-infraestrutura.md) — identidade, VPC, subnets, ALB, ECS, RDS, S3 e observabilidade.
2. [AWS — De Usuários a Capacidade](aws/aws-estimativa-usuarios-capacidade.md) — DAU → RPS, concorrência, storage, banda, conexões e load test.
3. [AWS — Custos sem Surpresa](aws/aws-custos.md) — atribuição, budgets, right-sizing, rede, compromissos e custo por unidade.

Capacidade e custo formam um ciclo: estimar → publicar → medir → recalibrar. Nenhuma planilha substitui métricas reais, e nenhuma métrica elimina a necessidade de uma hipótese inicial.

## Índice completo

### Projeto

| Guia | Pergunta central |
|---|---|
| [startProjects.md](startProjects.md) | como começo a stack com fronteiras seguras? |

### Backend

| Guia | Pergunta central |
|---|---|
| [protocolo-http.md](backend/protocolo-http.md) | o que acontece em uma troca HTTP correta? |
| [apis-rest.md](backend/apis-rest.md) | como desenho um contrato que não vira dívida? |
| [system-design-fundamentos.md](backend/system-design-fundamentos.md) | quais restrições e trade-offs definem a arquitetura? |
| [microsservicos.md](backend/microsservicos.md) | quando separar serviços compra mais do que custa? |

### Segurança e redes

| Guia | Pergunta central |
|---|---|
| [seguranca-da-informacao.md](seguranca/seguranca-da-informacao.md) | como reduzir risco em todas as camadas? |
| [redes-de-computadores.md](redes/redes-de-computadores.md) | como os bytes chegam e onde o caminho quebra? |

### DevOps

| Guia | Pergunta central |
|---|---|
| [git.md](devops/git.md) | como manter mudanças pequenas, legíveis e recuperáveis? |
| [docker.md](devops/docker.md) | como empacotar o mesmo processo de forma reproduzível? |
| [ci-cd.md](devops/ci-cd.md) | como transformar commit em deploy verificável e reversível? |
| [infraestrutura-como-codigo.md](devops/infraestrutura-como-codigo.md) | como versionar a infraestrutura e evitar drift? |
| [kubernetes.md](devops/kubernetes.md) | quando e como orquestrar muitos containers? |
| [escalabilidade-load-balancing.md](devops/escalabilidade-load-balancing.md) | qual gargalo pede a próxima unidade de capacidade? |
| [mensageria-filas.md](devops/mensageria-filas.md) | quando desacoplar tempo, carga e disponibilidade? |

### AWS

| Guia | Pergunta central |
|---|---|
| [aws-infraestrutura.md](aws/aws-infraestrutura.md) | qual arquitetura atende o requisito atual com segurança? |
| [aws-estimativa-usuarios-capacidade.md](aws/aws-estimativa-usuarios-capacidade.md) | quantas unidades o tráfego e os dados realmente exigem? |
| [aws-custos.md](aws/aws-custos.md) | o custo cresce junto com o valor ou com desperdício? |

## Mapa de conexões

```text
                                      ┌───────────────┐
                                      │ startProjects │
                                      └───────┬───────┘
                                              │
                 ┌────────────────────────────┼───────────────────────────┐
                 ▼                            ▼                           ▼
          Protocolo HTTP                    Git                       Segurança
                 │                            │                           ▲
                 ├──────► APIs REST           ├──────► Docker              │
                 │             │              │           │               │
                 ▼             ▼              ▼           ▼               │
               Redes ───► System Design     CI/CD ───► IaC ───────────────┤
                 │             │                          │               │
                 │             ├────► Escalabilidade      ├──► Kubernetes │
                 │             │             │            │               │
                 │             ├────► Mensageria ─────────┘               │
                 │             │             │                            │
                 │             └────► Microsserviços ◄───── Kubernetes    │
                 │                                                        │
                 └────────────────────► AWS Infra ◄───────────────────────┘
                                               │
                                      ┌────────┴────────┐
                                      ▼                 ▼
                                 Capacidade ◄──────► Custos
```

O mapa mostra pré-requisitos conceituais, não uma ordem rígida. Volte pelos links `Conecta com` sempre que um conceito atravessar mais de uma camada.

## As cinco perguntas que atravessam todos os guias

1. **Qual requisito estou atendendo?** Sem latência, disponibilidade, segurança e orçamento explícitos, ferramenta vira palpite.
2. **Qual é o gargalo medido agora?** Otimizar fora dele adiciona complexidade sem capacidade.
3. **Como isto falha?** Timeout, retry, idempotência, backup e rollback começam na arquitetura.
4. **Como saberei?** Logs, métricas, traces e custo precisam apontar impacto, não apenas atividade.
5. **Qual é o caminho de volta?** Mudança segura é pequena, revisável, compatível e reversível.

## Progresso sugerido

- [ ] Aplicação local funciona e respeita DTOs, sessão e fronteiras
- [ ] Consigo diagnosticar DNS → TCP/TLS → HTTP → API → banco
- [ ] API tem contrato, limites, timeouts, logs e checklist de segurança
- [ ] Imagem Docker é mínima, não-root e encerra graciosamente
- [ ] Pipeline testa, produz artefato imutável e faz rollback
- [ ] Infraestrutura é declarativa, revisada e sem segredos no state/repo
- [ ] Capacidade foi estimada e validada por teste de carga
- [ ] Escala responde a uma métrica ligada ao gargalo
- [ ] AWS tem identidade protegida, rede privada, backups testados e alarmes
- [ ] Custo por unidade e trade-offs de disponibilidade estão explícitos
