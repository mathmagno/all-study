# Mensageria e Filas — Assíncrono sem Perder Trabalho nem Duplicar Efeito

> **TL;DR:** Fila desacopla tempo e absorve pico, mas troca uma chamada visível por estado distribuído. Mensagem pode atrasar, duplicar, chegar fora de ordem e falhar para sempre. ACK após commit, consumidor idempotente, retry limitado, DLQ operável e métricas de idade são o mínimo profissional.

**Conecta com:** [microsservicos.md](../backend/microsservicos.md) · [system-design-fundamentos.md](../backend/system-design-fundamentos.md) · [apis-rest.md](../backend/apis-rest.md) · [escalabilidade-load-balancing.md](escalabilidade-load-balancing.md) · [aws-estimativa-usuarios-capacidade.md](../aws/aws-estimativa-usuarios-capacidade.md) · [aws-infraestrutura.md](../aws/aws-infraestrutura.md)

---

## 1. O que o assíncrono realmente compra

Request síncrono acopla disponibilidade e latência:

```text
cliente → pedidos → pagamento → estoque → email
          só responde quando todos terminarem
```

Evento/fila tira do caminho o que não precisa da resposta imediata:

```text
cliente → pedidos → banco → 201 Created
                      │
                      └── OrderCreated → fila → email / analytics / integração
```

Benefícios reais:

- **desacoplamento temporal:** email pode estar fora e processar depois;
- **buffer de pico:** produtor continua até a capacidade/retention da fila;
- **controle de concorrência:** N workers protegem banco/terceiro;
- **fan-out:** consumidores independentes reagem ao mesmo fato;
- **latência do request:** trabalho não crítico sai do caminho.

O preço: consistência eventual, duplicatas, backlog, contratos versionados e debugging distribuído. Se o usuário precisa saber agora se o pagamento foi aceito, esconder a operação em fila não elimina a necessidade de estado/feedback.

## 2. Fila, pub/sub e stream

| Modelo | Quem recebe | Retenção/replay | Use quando |
|---|---|---|---|
| Queue | uma instância do grupo processa cada mensagem | até ACK/expiração | distribuir trabalho |
| Pub/sub | cada assinatura recebe uma cópia | depende do broker | vários consumidores reagem ao fato |
| Stream/log | consumidores leem por offset | histórico retido | replay, múltiplas visões, alto volume ordenado por partição |

Exemplos conceituais:

```text
GenerateInvoice command → fila invoices → um worker executa
OrderCreated event       → tópico → email + analytics + loyalty
ClickRecorded event      → stream particionado → vários consumer groups
```

SQS é queue; SNS/EventBridge fazem fan-out/roteamento; Kafka é log/stream; RabbitMQ combina exchanges e filas com roteamento rico. Ferramenta não muda semântica: decida primeiro se há comando, fato, competição ou replay.

## 3. Comando vs evento: contrato conta intenção

- **Comando:** pedido dirigido a um responsável, verbo imperativo (`GenerateInvoice`). Pode ser rejeitado/falhar.
- **Evento:** fato imutável que já ocorreu, passado (`OrderCreated`). Consumidores não “desfazem” o fato; produzem novas ações/compensações.

Envelope mínimo:

```json
{
  "id": "01J...ULID",
  "type": "order.created.v1",
  "occurred_at": "2026-07-14T15:00:00Z",
  "correlation_id": "req-8f2a",
  "causation_id": "cmd-91c4",
  "producer": "orders",
  "data": {
    "order_id": "ord_981",
    "customer_id": "cus_42",
    "total_cents": 12990,
    "currency": "BRL"
  }
}
```

- `id` deduplica a **mensagem**, não o pedido inteiro.
- `correlation_id` liga request → eventos → logs.
- `causation_id` mostra qual comando/evento causou este.
- Dinheiro usa inteiro + moeda, não float.
- Evento carrega dados necessários e estáveis; não serialize entity/tabela inteira nem segredo.

## 4. Garantias de entrega e o “exactly once”

| Garantia | Pode perder? | Pode duplicar? | Exigência |
|---|---|---|---|
| at-most-once | sim | não pelo mecanismo | ACK antes/sem retry |
| at-least-once | não após aceitar, dentro da garantia do broker | **sim** | consumidor idempotente |
| exactly-once | depende do escopo declarado | fora do escopo, sim | transação/deduplicação e limites claros |

O default pragmático é **at-least-once + idempotência**. Duplicata acontece quando:

```text
worker processa e commita no banco
  → cai antes de ACK
  → broker torna mensagem visível outra vez
  → outro worker processa de novo
```

Nenhum ACK timing elimina perda e duplicata ao mesmo tempo sem coordenar broker e efeito externo. Broker pode oferecer exactly-once dentro do próprio log/transação; email, cobrança, HTTP de terceiro e outro banco continuam fora desse limite. Documente o escopo em vez de vender magia.

## 5. Ciclo correto: receber → processar → persistir → ACK

```text
receive
  → validar envelope/schema
  → verificar/deduplicar
  → executar regra com timeout
  → commit do efeito + marca de processamento
  → ACK/delete
```

- ACK antes do commit perde trabalho se o processo cair.
- ACK depois do commit pode duplicar, então a operação precisa ser idempotente.
- Se falhar de modo transitório, não ACK; mensagem volta após visibility timeout/nack.
- Se for inválida/permanente, retry infinito só queima capacidade: envie à DLQ após política definida.

**Visibility timeout** deve superar o processamento normal com margem. Curto demais cria dois workers simultâneos; longo demais atrasa recuperação. Trabalho variável/longo usa heartbeat/extensão com limite e contexto cancelável.

## 6. Consumidor idempotente em Go + PostgreSQL

Deduplicação e efeito de negócio devem acontecer na mesma transação:

```sql
CREATE TABLE processed_messages (
    consumer   text        NOT NULL,
    message_id text        NOT NULL,
    processed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (consumer, message_id)
);
```

```go
func (h *Handler) Handle(ctx context.Context, m Message) error {
	tx, err := h.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	result, err := tx.ExecContext(ctx, `
		INSERT INTO processed_messages (consumer, message_id)
		VALUES ($1, $2)
		ON CONFLICT DO NOTHING`, "loyalty-v1", m.ID)
	if err != nil {
		return err
	}

	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return tx.Commit() // duplicata já processada: sucesso sem novo efeito
	}

	updateResult, err := tx.ExecContext(ctx, `
		UPDATE loyalty_accounts
		SET points = points + $1
		WHERE customer_id = $2`, m.Points, m.CustomerID)
	if err != nil {
		return err
	}
	updated, err := updateResult.RowsAffected()
	if err != nil {
		return err
	}
	if updated != 1 {
		return fmt.Errorf("loyalty account not found") // rollback inclui a deduplicação
	}

	return tx.Commit() // ACK no broker somente depois deste sucesso
}
```

Se o efeito é HTTP/email/pagamento fora do banco, a transação local não cobre ambos. Use idempotency key aceita pelo terceiro, estado de operação com unique key ou uma máquina de estados que retoma sem repetir efeito cego.

Dedup store precisa de retenção maior que a janela em que o broker/sistema pode reenviar. Limpar cedo reativa duplicatas antigas; guardar para sempre também tem custo.

## 7. Retry: só erro transitório, com limite e jitter

Classifique:

| Erro | Exemplo | Ação |
|---|---|---|
| transitório | timeout, 429, 503, conexão reset | retry com backoff + jitter |
| permanente de mensagem | schema inválido, campo impossível | DLQ/quarentena sem insistir |
| bug do consumidor | panic, invariant quebrada | alerta + tentativas limitadas + DLQ |
| dependência negou negócio | cartão recusado | estado de negócio; normalmente sem retry técnico |

```text
delay ≈ min(base × 2^tentativa, máximo) + jitter aleatório
```

Jitter evita que milhares de mensagens falhadas juntas retornem juntas. Defina máximo de tentativas/tempo total; retry sem limite transforma poison message em DoS interno.

Respeite `Retry-After` quando aplicável, limite concorrência contra terceiro e use circuit breaker/degradação quando a dependência está doente. A fila protege somente enquanto backlog e retenção suportam a indisponibilidade.

## 8. DLQ não é lixeira

Dead-letter queue guarda mensagens que excederam tentativas ou foram redirecionadas por erro permanente. Para ser útil:

- alarme por **qualquer crescimento inesperado**;
- retenção suficiente para investigar, considerando a origem;
- envelope, erro final, versão e correlation ID disponíveis sem vazar segredo;
- runbook: corrigir consumidor/dado → testar → redrive controlado;
- redrive limitado e idempotente — jogar 1 milhão de volta de uma vez repete o incidente.

Não envie à DLQ no primeiro timeout; não deixe poison message circular por dias. Separe falha do sistema de rejeição de negócio: pagamento recusado é resultado esperado, não cadáver técnico.

## 9. Ordenação: pague apenas onde a regra exige

Ordenação global serializa processamento e reduz throughput/disponibilidade. Quase sempre a regra é por agregado:

```text
partition/message group key = order_id

order 981: Created → Paid → Shipped      (ordem preservada)
order 742: Created → Cancelled            (processa em paralelo)
```

Mesmo com fila ordenada:

- retry de um item pode bloquear o grupo;
- eventos de fontes diferentes têm relógios/atrasos diferentes;
- consumidor pode observar versão antiga após replay;
- redrive pode alterar a ordem efetiva.

Inclua `aggregate_version` e faça atualização condicional quando transições exigem sequência. Consumidor deve tolerar duplicata e, quando possível, evento já superado. Timestamp sozinho não define causalidade confiável.

## 10. Transactional Outbox: banco e publicação sem dual write

Problema clássico:

```text
1. INSERT pedido COMMIT
2. publish OrderCreated  ← processo cai aqui
```

Pedido existe, evento nunca saiu. Inverter perde de outro jeito: evento sai e transação do pedido falha.

Outbox grava dado e evento na **mesma transação local**:

```sql
BEGIN;
INSERT INTO orders (id, status) VALUES ('ord_981', 'created');
INSERT INTO outbox (id, topic, aggregate_id, payload, occurred_at)
VALUES (
  'evt_123', 'order.created.v1', 'ord_981',
  '{"order_id":"ord_981"}'::jsonb, now()
);
COMMIT;
```

Um relay lê linhas não publicadas, publica e marca. Ele pode cair depois de publish e antes de marcar, então ainda haverá duplicata: outbox garante **não perder a intenção**, não exactly-once no consumidor.

Relay por polling com `FOR UPDATE SKIP LOCKED` é suficiente para muita carga. CDC entra quando volume/latência justificam operação extra. Monitore idade da outbox; “fila saudável” não detecta evento preso antes do broker.

## 11. Schema evolution e compatibilidade

Produtor novo e consumidor antigo coexistem. Evolua de forma aditiva:

- adicione campo opcional com default semântico;
- consumidor ignora campo desconhecido;
- não renomeie/remova/mude tipo em `v1`;
- enum nova deve ter comportamento `unknown`, não crash;
- versão incompatível vira novo tipo (`order.created.v2`) com migração explícita.

Teste contratos entre produtor e consumidores e mantenha exemplos reais sem PII. Schema registry ajuda em escala/equipes, mas não substitui semântica: `total` continuar inteiro e mudar de centavos para reais é compatível no tipo e destrutivo no negócio.

Evento é API de longa vida. “Interno” não significa descartável quando fica retido e vários times consomem.

## 12. Dados no evento: notificação vs state transfer

| Estilo | Payload | Trade-off |
|---|---|---|
| notification | IDs + fato mínimo | consumidor consulta produtor; acopla disponibilidade |
| event-carried state | dados necessários no momento | payload/PII/schema maiores; consumidor autônomo |

Escolha pelo caso. Email de pedido pode precisar nome/endereço já aprovados para funcionar mesmo se serviço de cliente cair; analytics talvez só precise IDs/valores. Não mande access token, senha, cartão, segredo ou entity inteira “por conveniência”.

Payload grande vai para object storage com referência, checksum, autorização e expiração. Broker não é storage de arquivo.

## 13. Escolha do broker sem currículo-driven development

| Opção | Excelente para | Custo operacional/sinal |
|---|---|---|
| tabela/outbox Postgres | poucos jobs, mesma aplicação | simples; cuide de polling/bloat/locks |
| SQS | fila gerenciada, retries/DLQ, escala variável | sem operação de broker; semântica AWS |
| RabbitMQ | routing/ACK/filas flexíveis e baixa latência | cluster/conexões/topologia para operar |
| Kafka | streams, replay, alto throughput e consumer groups | partições, retenção, schema e operação maiores |

SQS Standard entrega at-least-once; projete idempotência mesmo com visibility timeout. FIFO oferece ordenação/deduplicação dentro das garantias e grupos, não transação mágica com seu banco.

⚠️ Kafka para 100 emails por minuto é frequentemente uma plataforma maior que o problema. Comece com transação + outbox + SQS/tabela; migre quando replay, throughput, retenção e múltiplos consumer groups forem requisitos medidos.

## 14. Capacidade, backpressure e shutdown

```text
concorrência necessária ≈ chegada de jobs/s × duração média em segundos
```

Se entram 40/s e a duração **média** é 0,5 s, ~20 execuções concorrentes apenas acompanham o fluxo; use p95/p99 para margem e valide dependências. Autoscaling por CPU pode errar — use idade da mensagem mais antiga, backlog por consumidor e taxa de processamento.

Proteja downstream:

- limite de workers e pool de conexões;
- batch onde semântica permite;
- prefetch pequeno o bastante para distribuição justa;
- pausa/redução quando banco/terceiro satura;
- producer rate limit/admission control quando backlog cruza SLO.

No shutdown, pare de receber, termine/estenda mensagens em voo até deadline e só então encerre. Matar worker após receber sem liberar/esperar visibility atrasa retry; ACK em shutdown antes de commit perde trabalho.

## 15. Observabilidade de mensageria

Dashboard mínimo por fila/consumer:

- taxa publicada, recebida, concluída, retried e DLQ;
- **idade da mensagem mais antiga** (latência real do backlog);
- profundidade/backlog e mensagens em voo;
- duração p50/p95/p99 do handler;
- erro por classe/tipo/versão, sem label por message ID;
- capacidade de workers, saturação do banco/terceiro;
- idade/quantidade da outbox ainda não publicada.

Log estruturado inclui `message_id`, `type`, `correlation_id`, tentativa e resultado. Trace propaga contexto, mas não confunda tempo do handler com tempo total: evento ficou 20 minutos na fila antes de processar.

SLO útil: “99% de `OrderCreated` processados em até 2 minutos”, não “fila disponível 99,9%”. A métrica deve representar o efeito esperado pelo negócio.

## 16. Segurança e multi-tenant

- TLS e criptografia em repouso conforme threat model; chave KMS não corrige consumidor superprivilegiado.
- Producer só publica nos tópicos necessários; consumer só lê/ACK sua fila.
- Valide schema, tamanho e tenant — mensagem interna também é input não confiável.
- Nunca confie em `tenant_id` para autorização sem vinculá-lo à identidade/rota de origem permitida.
- Redija PII em logs/DLQ; retenção e replay obedecem políticas de dados.
- Restrinja quem pode redrive/purge; ambas as ações têm grande blast radius.
- Rotacione credenciais ou use IAM role temporária; não grave chave no payload/config.

Fila pode ser vetor de custo/DoS: limite produtores, tamanho, taxa e cardinalidade de destinos. Mensagem assinada ajuda proveniência entre fronteiras de confiança, mas gerenciamento de chaves e replay ainda precisam desenho.

## 17. ⚠️ Falhas de design comuns

| Sintoma | Consequência | Correção |
|---|---|---|
| ACK antes de persistir | perda silenciosa | commit → ACK |
| consumidor não idempotente | cobrança/email/pontos duplicados | chave + transação/estado |
| retry infinito imediato | poison message derruba tudo | backoff+jitter+limite+DLQ |
| ordem global por comodidade | throughput serial | ordenar por agregado |
| publicar depois do commit sem outbox | evento perdido | transactional outbox |
| autoscaling só por CPU | backlog envelhece invisível | idade/backlog por worker |
| DLQ sem alarme/runbook | cemitério permanente | ownership + redrive controlado |
| entity inteira no evento | PII e contrato acoplado | payload mínimo necessário |

## 18. Checklist de mensageria

- [ ] Assíncrono está fora do caminho somente quando a resposta não é necessária agora
- [ ] Comando/evento, responsável, ordering key e garantia de entrega estão explícitos
- [ ] Envelope tem ID, versão, tempo, correlação e payload mínimo sem segredo
- [ ] Consumidor persiste efeito/dedup na mesma transação e só depois ACKa
- [ ] Efeito externo usa idempotency key/estado retomável
- [ ] Retry classifica transitório vs permanente, usa backoff+jitter e tem limite
- [ ] Visibility timeout/heartbeat cobrem duração; shutdown trata mensagens em voo
- [ ] DLQ tem alarme, owner, retenção, diagnóstico e redrive controlado
- [ ] Banco + publish usam outbox; idade da outbox é monitorada
- [ ] Evolução de schema é aditiva e testada com consumidores antigos
- [ ] Autoscaling observa idade/backlog e respeita capacidade do downstream
- [ ] SLO mede tempo até o efeito de negócio, incluindo espera na fila
