# System Design — Fundamentos Eternos

> **TL;DR:** System design não é decorar ferramentas. É gerenciar trade-offs sob restrições. Ferramentas mudam a cada 5 anos; latência, gargalo, consistência e falha parcial são eternos.

**Conecta com:** [escalabilidade-load-balancing.md](../devops/escalabilidade-load-balancing.md) · [mensageria-filas.md](../devops/mensageria-filas.md) · [aws-estimativa-usuarios-capacidade.md](../aws/aws-estimativa-usuarios-capacidade.md) · [redes-de-computadores.md](../redes/redes-de-computadores.md) · [microsservicos.md](microsservicos.md)

---

## 1. O que System Design realmente é

Todo sistema é uma resposta a três perguntas:

1. **O que precisa acontecer?** (requisitos funcionais)
2. **Quão bem precisa acontecer?** (requisitos não-funcionais: latência, disponibilidade, consistência, custo)
3. **O que estou disposto a sacrificar?** (trade-offs)

Não existe arquitetura "certa" — existe arquitetura adequada às restrições atuais. O erro clássico do júnior é copiar a arquitetura da Netflix para um sistema com 200 usuários. O erro clássico do sênior preguiçoso é não evoluir o design quando a escala muda de ordem de grandeza.

**Regra das ordens de grandeza:** cada 10x no volume (usuários, dados, requisições) quebra alguma suposição do design atual. Um design bom para 1k usuários raramente sobrevive intacto a 100k. Projete para a escala atual × 10; não para × 1000.

## 2. Requisitos: funcionais vs não-funcionais

| Tipo | Pergunta | Exemplo |
|---|---|---|
| Funcional | O que o sistema faz? | "Usuário cria pedido" |
| Não-funcional | Sob quais garantias? | "p99 < 300ms, 99.9% uptime, pedido nunca duplica" |

Requisitos não-funcionais definem a arquitetura muito mais que os funcionais. Um CRUD com exigência de 99.99% de disponibilidade e consistência forte global é um problema difícil; o mesmo CRUD com 99% e consistência eventual roda num VPS de $5.

**Perguntas esclarecedoras que sempre valem (entrevista ou projeto real):**
- Quantos usuários? Quantos ativos por dia (DAU)?
- Leitura ou escrita domina? (proporção típica: 10:1 até 100:1 leitura)
- Qual a tolerância a dado desatualizado? (segundos? nunca?)
- O que acontece se o sistema cair 5 minutos? (perda de dinheiro? de vidas? nada?)
- Qual o tamanho médio do dado por operação?

## 3. Back-of-envelope: estimativa de capacidade

Método de 4 passos (detalhado com exemplo completo em [aws-estimativa-usuarios-capacidade.md](../aws/aws-estimativa-usuarios-capacidade.md)):

```
1. DAU → requisições/dia    (DAU × ações por usuário/dia)
2. req/dia → RPS médio      (dividir por 86.400)
3. RPS médio → RPS de pico  (× 2 a 5, conforme o padrão de uso)
4. Dimensionar para o pico, não para a média
```

**Números de latência que todo engenheiro carrega na cabeça** (aproximados, o que importa é a ordem de grandeza):

| Operação | Tempo | Intuição |
|---|---|---|
| L1 cache | ~1 ns | — |
| RAM | ~100 ns | memória é "grátis" |
| SSD leitura aleatória | ~100 µs | 1000× a RAM |
| Leitura sequencial 1MB SSD | ~1 ms | sequencial >> aleatório |
| Round-trip mesmo datacenter | ~0,5 ms | rede local é barata |
| Query indexada no Postgres | ~1–5 ms | — |
| Round-trip inter-região (BR→US) | ~120 ms | distância física é lei |
| Handshake TLS completo | ~1–2 RTT extra | por isso conexões se reutilizam |

Consequências práticas: cache em RAM é sempre a primeira otimização; chamadas de rede em loop são o assassino de performance nº 1; colocar servidor perto do usuário importa mais que otimizar código.

## 4. Conceitos eternos

### Latência vs Throughput
- **Latência:** quanto demora UMA operação (ms).
- **Throughput:** quantas operações por segundo (RPS).
- Não são a mesma coisa: um sistema pode ter throughput alto e latência ruim (filas cheias). Otimize o que o requisito pede.
- Meça latência em **percentis** (p50, p95, p99), nunca média. A média esconde os 1% de usuários com 4s de resposta — e usuários pesados (os melhores clientes) caem justamente no p99.

### Gargalo (bottleneck)
Todo sistema tem exatamente um gargalo dominante por vez. Otimizar qualquer outra coisa é desperdício. Ordem típica de aparição: banco de dados → I/O de rede → CPU. Encontre com medição (profiling, métricas), nunca com intuição.

### SPOF — Single Point of Failure
Qualquer componente único cuja queda derruba tudo. Elimina-se com redundância — mas cada redundância custa dinheiro e complexidade. O banco de dados é o SPOF clássico e o mais caro de redundar. Aceitar um SPOF conscientemente num MVP é engenharia; não saber que ele existe é negligência.

### Stateless vs Stateful
- **Stateless:** o servidor não guarda nada entre requisições (estado vive no banco/Redis). Consequência: qualquer instância atende qualquer requisição → escala horizontal trivial.
- **Stateful:** estado na memória do servidor → usuário "gruda" numa instância → escala difícil.
- **Regra de carreira:** faça a camada de aplicação stateless desde o dia 1 (custo ~zero), mesmo que rode 1 instância só. Sessões em Redis/banco, uploads em object storage, nunca em disco local. É o pré-requisito de todo o resto de escalabilidade.

### Falha parcial
Em sistema distribuído, componentes falham independentemente. A rede **vai** falhar, o serviço vizinho **vai** demorar. Design maduro assume falha como estado normal: timeout em toda chamada externa, retry com backoff, degradação graciosa (feed sem recomendações > feed fora do ar).

### Idempotência
Operação que produz o mesmo resultado executada 1 ou N vezes. Fundamental porque retry é inevitável — e retry de operação não-idempotente duplica pedido, cobra cartão 2×. `GET`, `PUT`, `DELETE` são idempotentes por contrato; `POST` não é — por isso existe idempotency key (ver [apis-rest.md](apis-rest.md#5-idempotência-em-post)).

## 5. Consistência: do ACID ao BASE

### ACID (bancos relacionais, transações)
- **A**tomicidade: tudo ou nada.
- **C**onsistência: invariantes preservadas (saldo nunca negativo).
- **I**solamento: transações concorrentes não se corrompem.
- **D**urabilidade: commitou, persiste.

### CAP na prática
Em uma partição de rede (P — que sempre pode acontecer), escolha: **C**onsistência (rejeitar requisições até resolver) ou **A**vailability (responder, possivelmente com dado velho). Não existe CA em sistema distribuído real.

- Dinheiro, estoque, autenticação → escolha C.
- Feed, contadores de like, analytics → escolha A.

### Consistência forte vs eventual
- **Forte:** toda leitura vê a última escrita. Custo: latência (coordenação) e disponibilidade.
- **Eventual:** réplicas convergem "em algum momento" (geralmente ms–s). Custo: usuário pode ver dado velho.
- **Padrão pragmático:** consistência forte no caminho crítico (escrita no primário), eventual no resto (leituras de réplica, cache). Um sistema raramente precisa de um único modelo global.

**Read-your-own-writes:** o caso que mais morde — usuário edita perfil, recarrega, vê versão antiga (leu da réplica atrasada). Solução: após escrita, ler do primário por N segundos para aquele usuário.

## 6. Disponibilidade: SLI, SLO, SLA e os "noves"

- **SLI:** métrica medida (ex: % de requisições < 500ms com status 2xx).
- **SLO:** alvo interno (ex: SLI ≥ 99,9% no mês).
- **SLA:** contrato com cliente, com penalidade. SLA sempre mais frouxo que SLO.

| Disponibilidade | Downtime/ano | Custo de alcançar |
|---|---|---|
| 99% | 3,65 dias | 1 servidor bem cuidado |
| 99,9% | 8,7 h | redundância + monitoramento |
| 99,99% | 52 min | multi-AZ, failover automático, on-call |
| 99,999% | 5 min | multi-região, times dedicados, $$$$ |

**Cada nove multiplica o custo por ~10.** Pergunte ao negócio quanto vale o nove antes de pagá-lo. ⚠️ **Over-engineering clássico:** prometer 99,99% para um sistema interno que ninguém usa de madrugada.

## 7. Componentes padrão e quando cada um entra

Todo sistema em escala converge para variações do mesmo desenho. Aprenda o papel de cada peça e o **sinal** que justifica adicioná-la:

| Componente | Resolve | Sinal para adicionar | Antes disso |
|---|---|---|---|
| **Load balancer** | distribuir carga, failover | 2ª instância da API | 1 instância, DNS direto |
| **Cache (Redis)** | leitura repetida cara | mesma query dominando o banco | índice no banco |
| **CDN** | latência de assets/geo | usuários longe do servidor | servir estático do backend |
| **Read replica** | leitura >> escrita | primário saturado de SELECTs | cache primeiro |
| **Fila (mensageria)** | picos, trabalho lento, desacoplar | request faz trabalho que não precisa de resposta síncrona | fazer inline mesmo |
| **Sharding** | volume de escrita/dados | primário satura mesmo otimizado | réplica + cache + vertical |
| **Microsserviços** | escala de TIMES | deploy de um time bloqueia outro | monolito modular |

Ordem de evolução saudável (cada passo só quando o anterior saturar):

```
1 servidor (app+db) → app e db separados → + cache → + LB e 2ª instância
→ + réplicas de leitura → + fila p/ trabalho assíncrono → + CDN
→ sharding / extração de serviços (raríssimo chegar aqui)
```

## 8. Método para resolver qualquer problema de design

Roteiro que funciona em entrevista e em projeto real:

1. **Esclarecer requisitos** (5 min): funcionais, escala, consistência, latência. Nunca pule.
2. **Estimar** (back-of-envelope): RPS, storage, bandwidth. Define se o problema é trivial ou difícil.
3. **Desenhar o caminho feliz** simples: cliente → LB → API → banco. Sem otimização prematura.
4. **Identificar o gargalo** dado a estimativa do passo 2.
5. **Resolver o gargalo** com o componente mais barato da tabela acima.
6. **Repetir 4–5** até atender os requisitos.
7. **Apontar os trade-offs** feitos e o que quebraria em 10× a escala.

## 9. ⚠️ Over-engineering — sinais e antídotos

| Sintoma | Simplificação |
|---|---|
| Kubernetes para 1 container | Docker Compose / ECS / App Runner |
| Microsserviços com 1 time de 4 devs | Monolito modular (pacotes Go bem separados) |
| Kafka para 100 eventos/min | Fila simples (SQS) ou até tabela no Postgres |
| Cache distribuído para 50 usuários | Índice no banco; cache em memória do processo |
| Multi-região "para o futuro" | Multi-AZ; região única até ter usuários que justifiquem |
| Sharding preventivo | Postgres aguenta TB com índice e réplica |
| GraphQL "para flexibilidade" | REST com DTOs bem desenhados (nossa stack já faz isso) |
| Event sourcing em CRUD | Tabela de auditoria simples |

**Teste do bolso:** se você não consegue apontar a métrica atual que o componente novo resolve, ele é especulativo. Complexidade especulativa é dívida técnica com juros — você paga a manutenção hoje por um benefício que talvez nunca chegue.

**Comece simples, itere com inteligência:** o design ideal no papel perde para o design simples medido em produção. Instrumente (métricas, logs), meça, e evolua quando os dados mandarem.

## 10. Checklist de design

- [ ] Requisitos não-funcionais explícitos (p99? uptime? consistência?)
- [ ] Estimativa de RPS/storage feita antes de escolher componentes
- [ ] Camada de aplicação stateless (sessão fora do processo)
- [ ] Todo acesso externo tem timeout definido
- [ ] Gargalo atual identificado por medição
- [ ] SPOFs conhecidos e aceitos conscientemente (ou eliminados)
- [ ] Percentis (p95/p99) monitorados, não médias
- [ ] Cada componente da arquitetura justificado por um sinal real
