# Microsserviços — Quando, Como e (Principalmente) Quando Não

> **TL;DR:** Microsserviços resolvem um problema **organizacional** (times pisando uns nos outros), não técnico. Para escalar tráfego existe load balancer; para escalar times existe microsserviço. Com 1 time pequeno, monolito modular ganha em tudo.

**Conecta com:** [system-design-fundamentos.md](system-design-fundamentos.md) · [mensageria-filas.md](../devops/mensageria-filas.md) · [kubernetes.md](../devops/kubernetes.md) · [apis-rest.md](apis-rest.md) · [redes-de-computadores.md](../redes/redes-de-computadores.md)

---

## 1. O que microsserviços realmente compram

| Benefício real | Condição para valer |
|---|---|
| Deploy independente por time | existir mais de um time |
| Escalar só o componente quente | um componente ter perfil de carga MUITO diferente |
| Isolamento de falha | investimento pesado em resiliência (senão falha propaga igual) |
| Stack por serviço | raramente vale o custo operacional |

E o preço, pago adiantado e para sempre:

- Toda chamada de função vira **chamada de rede**: latência de ~ns para ~ms (1.000.000×), e agora pode falhar, demorar, chegar duplicada.
- Transação ACID entre módulos **deixa de existir** — vira saga/consistência eventual.
- Debugging vira arqueologia distribuída (por isso tracing, correlação de IDs).
- Cada serviço: pipeline, deploy, monitoramento, versionamento de contrato.

**Lei de Conway (eterna):** a arquitetura do sistema espelha a estrutura de comunicação da organização. Microsserviços funcionam quando cada serviço tem um dono claro. 4 devs mantendo 12 serviços = 4 devs fazendo o trabalho de infra de 12 times.

## 2. ⚠️ Monolito modular primeiro — o caminho profissional

O over-engineering mais caro da década foi quebrar sistemas em serviços antes da hora. O antídoto:

```
backend/internal/
├── orders/        # cada módulo: handler + service + repository próprios
│   ├── handler.go
│   ├── service.go
│   └── repository.go
├── users/
├── billing/
└── platform/      # compartilhado: db, middleware, config
```

Regras que tornam o monolito "modular de verdade":

1. Módulo A só chama módulo B pela **interface pública** do service de B — nunca pelo repository de B, nunca por query na tabela de B.
2. Cada módulo é dono das suas tabelas. Join entre módulos = chamada de service, não SQL cruzado.
3. DTOs entre módulos, não entities (mesmo dentro do processo).

Resultado: as **fronteiras** de microsserviços existem e são fiscalizáveis em code review, mas você mantém: uma transação ACID quando precisa, um deploy, um debugger, latência de chamada de função. Se um dia precisar extrair, a costura já está marcada.

## 3. Sinais reais de que é hora de extrair um serviço

Extraia quando (dois ou mais):

- **Times bloqueando deploys uns dos outros** toda semana (o sinal nº 1, organizacional).
- Um módulo precisa de **escala 10×+ diferente** (ex: processamento de imagem que quer GPU/CPU alto enquanto o resto é I/O).
- Requisito de **isolamento regulatório** (dados de pagamento com PCI, escopo de auditoria menor).
- Componente com ciclo de vida distinto (ML model que atualiza 10×/dia vs CRUD estável).

**Nunca** extraia porque: "vai crescer no futuro", "é o que as big techs fazem", "quero aprender Kubernetes" (aprenda em lab, não na arquitetura do produto).

Método de extração: **strangler fig** — extraia UM serviço (o de fronteira mais limpa), rode em produção 3 meses, aprenda o custo operacional real, e só então decida o próximo. Big-bang rewrite para microsserviços tem taxa de fracasso altíssima.

## 4. Comunicação entre serviços

### Síncrona — REST ou gRPC
Quando o chamador **precisa da resposta agora** (validar estoque antes de confirmar pedido).

| | REST/JSON | gRPC |
|---|---|---|
| Contrato | OpenAPI (opcional) | `.proto` obrigatório (força contrato — o maior benefício) |
| Formato | texto, debugável com curl | binário protobuf, ~5–10× menor/rápido de serializar |
| Streaming | não nativo | bidirecional nativo |
| Quando | APIs públicas, poucos serviços | serviço↔serviço interno com volume alto |

⚠️ gRPC entre 2 serviços de baixo volume é over-engineering — REST interno com DTOs resolve e todo mundo sabe debugar.

### Assíncrona — eventos via fila
Quando o chamador **não precisa esperar** (pedido criado → enviar email, atualizar analytics, notificar estoque). Publisher emite `OrderCreated`, consumidores reagem no seu ritmo. Desacopla ciclo de vida: o serviço de email pode estar fora do ar sem derrubar a criação de pedidos. Detalhes, garantias de entrega e idempotência de consumidor em [mensageria-filas.md](../devops/mensageria-filas.md).

**Regra de bolso:** comando que precisa de resposta → síncrono. Fato que aconteceu e outros podem reagir → evento assíncrono.

## 5. Dados: a parte mais difícil

### Database per service (a regra)
Cada serviço é dono exclusivo do seu banco. Outro serviço quer o dado? Pergunta pela API ou consome eventos. **Banco compartilhado entre serviços = monolito distribuído**: todo o custo de rede, nenhum desacoplamento (migração de schema de um quebra o outro).

### Transações distribuídas: saga
Sem ACID entre serviços, uma operação de negócio que toca N serviços vira uma **saga**: sequência de transações locais + **compensações** para desfazer em caso de falha no meio.

```
CriarPedido:
  1. orders:  cria pedido (status=pending)
  2. billing: cobra cartão          → falhou? compensa: nada a desfazer, marca pedido failed
  3. stock:   reserva estoque       → falhou? compensa: estorna cobrança, marca failed
  4. orders:  status=confirmed
```

Duas formas: **coreografia** (cada serviço reage a eventos do anterior — simples, mas o fluxo fica invisível) e **orquestração** (um coordenador dirige os passos — fluxo explícito, componente a mais). Até ~3 passos, coreografia; acima, orquestração.

Isto é a materialização do BASE/consistência eventual de [system-design-fundamentos.md](system-design-fundamentos.md#5-consistência-do-acid-ao-base): o sistema fica *temporariamente* inconsistente (cobrou mas ainda não reservou) e o design garante convergência. Se o seu domínio não tolera isso (banco, saúde), esse é um argumento **contra** separar esses módulos em serviços.

## 6. Resiliência: sobrevivendo à rede

Padrões obrigatórios assim que existe chamada serviço→serviço (todos eternos, valem até para chamar API de terceiro no monolito):

### Timeout em tudo
Toda chamada tem prazo. Sem timeout, um serviço lento **trava as goroutines** do chamador até derrubá-lo em cascata — é assim que um serviço secundário derruba o sistema inteiro.

```go
ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
defer cancel()
resp, err := h.stockClient.Reserve(ctx, req)
```

**Timeout budget:** se o cliente espera 5s no total, a cadeia interna tem que caber em 5s: API(5s) → orders(4s) → billing(2s). Timeout de baixo maior que o de cima = trabalho executado que ninguém vai ler.

### Retry com backoff exponencial + jitter
```
tentativa 1 → espera 100ms×(2⁰)+aleatório → 2 → 200ms+aleatório → 3 → desiste
```
- Só para erros **transitórios** (timeout, 503) — retry de 400 é inútil, retry de 500 pode duplicar efeito.
- Só em operações **idempotentes** (ou com idempotency key).
- **Jitter é obrigatório:** sem o componente aleatório, mil clientes que falharam juntos retentam juntos e derrubam o serviço que estava se recuperando (thundering herd).

### Circuit breaker
Depois de N falhas seguidas, **para de chamar** o serviço doente por um tempo (falha rápido, resposta degradada), depois testa com uma requisição. Protege o doente (deixa se recuperar) e o chamador (não desperdiça goroutines). Em Go: `sony/gobreaker`. Com poucos serviços, timeout+retry bem feitos cobrem 90% — breaker entra quando há cadeias de dependência.

### Idempotência no consumidor
Mensagens chegam em duplicidade (garantia at-least-once). Todo consumidor de evento processa a mesma mensagem 2× sem efeito duplo — chave de deduplicação persistida (ver [mensageria-filas.md](../devops/mensageria-filas.md)).

## 7. Observabilidade mínima para distribuído

Sem isto, microsserviços são indebugáveis:

1. **Correlation ID:** gerado na borda (`X-Request-ID`), propagado em TODA chamada e evento, presente em TODO log. Um grep pelo ID conta a história completa da requisição através dos serviços.
2. **Logs estruturados** (JSON com `slog`) centralizados — grep em 5 máquinas não escala.
3. **Métricas RED por serviço:** Rate (RPS), Errors (%), Duration (p95/p99).
4. Tracing distribuído (OpenTelemetry) quando a cadeia passar de ~3 serviços.

## 8. Caminho evolutivo resumido

```
Fase 1: Monolito simples          → valida o produto (semanas)
Fase 2: Monolito MODULAR          → fronteiras fiscalizadas por review (padrão até ~10 devs)
Fase 3: Extrai 1 serviço          → quando um sinal real da seção 3 aparecer
Fase 4: Microsserviços de verdade → múltiplos times donos de múltiplos serviços
```

A maioria dos sistemas de sucesso vive a vida inteira na fase 2 — e isso é engenharia bem feita, não atraso. Shopify, Stack Overflow e GitHub operaram anos em escala gigante como monolitos.

## 9. Checklist antes de extrair um serviço

- [ ] O motivo é organizacional/escala real medida — não moda?
- [ ] O módulo já tem fronteira limpa no monolito (interface própria, tabelas próprias)?
- [ ] Sabemos conviver com consistência eventual nesse fluxo?
- [ ] Timeout, retry+jitter e idempotência implementados nas chamadas?
- [ ] Correlation ID atravessando tudo; logs centralizados; métricas RED?
- [ ] Contrato do serviço versionado (quebra de contrato = quebra de outro time)?
- [ ] O time aceita operar +1 deploy, +1 on-call, +1 pipeline — para sempre?
