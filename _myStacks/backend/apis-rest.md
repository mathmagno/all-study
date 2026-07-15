# APIs REST — Design de Contratos que Duram

> **TL;DR:** REST é modelar o sistema como recursos manipulados por verbos HTTP padronizados. Um contrato bem desenhado sobrevive a reescritas inteiras do código por trás dele — o contrato É o produto do backend.

**Conecta com:** [protocolo-http.md](protocolo-http.md) (semântica dos verbos/status) · [startProjects.md](../startProjects.md) (DTOs) · [seguranca-da-informacao.md](../seguranca/seguranca-da-informacao.md) (validação, autorização) · [microsservicos.md](microsservicos.md)

---

## 1. REST de verdade (não é só "API JSON")

Princípios que importam na prática:

1. **Recursos, não ações.** A URL nomeia uma *coisa* (substantivo); o verbo HTTP diz o que fazer com ela. `POST /orders`, não `POST /createOrder`.
2. **Stateless.** Cada request é autossuficiente (sessão vai no cookie, contexto vai em parâmetros). Nenhum "estado de conversa" no servidor entre requests → qualquer instância atende qualquer request → escala horizontal.
3. **Representações.** O cliente nunca vê o dado interno; vê uma *representação* (nosso DTO). O mesmo recurso pode ter representações diferentes por contexto (`UserResponse` vs `UserAdminResponse`).
4. **Interface uniforme.** Verbos e status codes padronizados significam que qualquer dev (e qualquer ferramenta) entende sua API sem ler manual.

O que REST **não** exige: HATEOAS, XML, aderência religiosa. API pragmática > API academicamente pura.

## 2. Design de URLs

```
GET    /api/v1/orders              → lista (com paginação SEMPRE)
POST   /api/v1/orders              → cria
GET    /api/v1/orders/981          → busca uma
PUT    /api/v1/orders/981          → substitui inteira
PATCH  /api/v1/orders/981          → altera campos
DELETE /api/v1/orders/981          → remove
GET    /api/v1/orders/981/items    → sub-recurso (itens DO pedido)
```

Convenções que evitam brigas de code review para sempre:

- Substantivos no **plural** (`/orders`, não `/order`), minúsculo, kebab-case se composto (`/order-items`).
- Máximo ~2 níveis de aninhamento. `/users/1/orders/981/items/3/reviews` → prefira `/order-items/3/reviews`.
- Filtro, ordenação e paginação em **query string**: `GET /orders?status=pending&sort=-created_at&limit=20`.
- ID na URL, corpo no body, contexto de auth no cookie/middleware — nunca `user_id` vindo do corpo para decidir autorização (o cliente mente; ver [seguranca-da-informacao.md](../seguranca/seguranca-da-informacao.md#8-autorização--a-falha-nº-1-em-apis-reais)).
- **Ações que não são CRUD** (o caso que sempre gera dúvida): modele como sub-recurso ou como recurso próprio:
  - `POST /orders/981/cancellation` (cria um cancelamento) ✅
  - `POST /password-resets` (cria uma solicitação de reset) ✅
  - Escape pragmático aceitável quando nada encaixa: `POST /orders/981/cancel`. Consistência no projeto > pureza.

## 3. Paginação — offset vs cursor

### Offset (simples, para começar)
```
GET /orders?limit=20&offset=40      → SQL: LIMIT 20 OFFSET 40
```
Problemas em escala: `OFFSET 100000` força o banco a ler e descartar 100k linhas (lento); inserções entre páginas causam itens duplicados/pulados.

### Cursor/keyset (estável e O(1), para listas grandes ou infinitas)
```
GET /orders?limit=20&cursor=eyJpZCI6OTgxfQ
→ SQL: WHERE id < 981 ORDER BY id DESC LIMIT 20
```
Resposta carrega o cursor da próxima página:
```json
{
  "data": [ ... ],
  "next_cursor": "eyJpZCI6OTYxfQ",
  "has_more": true
}
```

**Regra:** offset até ~10k linhas ou UIs com "página 3 de 10"; cursor para scroll infinito, feeds e qualquer tabela que cresce sem limite. ⚠️ Implementar cursor genérico multi-coluna no dia 1 é over-engineering — comece com offset, migre o endpoint que doer.

**Nunca** exponha lista sem `limit` máximo imposto no servidor (`limit=1000000` é um DoS grátis).

## 4. Erros — um formato, para sempre

Formato consistente inspirado no RFC 9457 (Problem Details):

```json
{
  "error": {
    "code": "validation_failed",
    "message": "Dados inválidos.",
    "details": [
      {"field": "email", "message": "formato inválido"},
      {"field": "qty", "message": "deve ser maior que zero"}
    ]
  }
}
```

- `code`: string estável que o front usa para lógica (`if code == "email_taken"`). Nunca faça o front parsear `message`.
- `message`: texto seguro para exibir. **Genérico em auth** ("credenciais inválidas" — nunca "senha errada", que confirma que o email existe).
- `details`: erros de validação por campo, para o form marcar inputs.
- Stack trace, query SQL, paths internos: **só no log do servidor**, jamais na resposta.

No Go, um helper único usado por todos os handlers garante o formato:

```go
func writeError(w http.ResponseWriter, status int, code, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]any{
		"error": map[string]string{"code": code, "message": msg},
	})
}
```

## 5. Idempotência em POST

POST não é idempotente — mas retry acontece (timeout de rede não diz se o servidor processou). Para operações críticas (pagamento, pedido), o cliente envia uma chave:

```
POST /api/v1/orders
Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000
```

Servidor: guarda `(chave → resposta)` por 24h. Chave repetida → devolve a resposta original, **não** executa de novo.

```go
// Esqueleto: tabela idempotency_keys (key PK, response jsonb, created_at)
// 1. INSERT da chave; violação de unique = replay → devolve resposta salva
// 2. Processa o pedido na MESMA transação que salva a resposta
```

⚠️ Só para operações onde duplicar custa caro. CRUD comum não precisa — o custo de manter a tabela de chaves não se paga.

## 6. Versionamento

- **Path (`/api/v1/...`)**: explícito, cacheável, debugável no log. **Use este.**
- Header (`Accept: application/vnd.api.v2+json`): academicamente elegante, operacionalmente chato.

Regras de compatibilidade — o que **não quebra** cliente (pode fazer sem v2):
- Adicionar campo novo na resposta (cliente ignora o que não conhece).
- Adicionar parâmetro opcional, endpoint novo.

O que **quebra** (exige v2 ou coordenação):
- Remover/renomear campo, mudar tipo, mudar semântica de status code, tornar campo obrigatório.

⚠️ **Over-engineering:** criar `v2` preventivamente ou manter 4 versões vivas. Comece com `v1`, evite quebras aditivas, e só crie `v2` quando uma quebra real for inevitável. API interna (nosso front + nosso back deployados juntos) pode nem precisar de versão — o monorepo garante sincronismo.

## 7. Rate limiting na API

Resposta padrão:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 30
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
```

Algoritmo pragmático: **token bucket** por chave (IP para anônimo, user_id para logado) — permite rajadas curtas, limita a média. Em Go single-instance, `golang.org/x/time/rate` em memória resolve; multi-instância, contador no Redis. Limites diferentes por rota: login 5/min (força bruta), API geral 100/min. Detalhes de segurança em [seguranca-da-informacao.md](../seguranca/seguranca-da-informacao.md#13-rate-limiting-e-anti-dos).

## 8. Contrato explícito: OpenAPI

O contrato da API documentado em `openapi.yaml` no repo:

- Front gera types TS automaticamente (`openapi-typescript`) → o espelho manual de DTOs vira geração automática, erro de sincronismo vira erro de compilação.
- Vale a pena a partir do momento em que **outra pessoa** consome sua API (outro time, mobile, parceiro).

⚠️ Para monorepo com 1 dev nos dois lados, manter interfaces TS manualmente espelhando DTOs (como em [startProjects.md](../startProjects.md)) é suficiente e mais simples. OpenAPI entra quando o contrato precisa ser *negociado* entre pessoas.

## 9. Anatomia de um handler Go de produção

Tudo que este documento prega, num handler:

```go
func (h *OrderHandler) Create(w http.ResponseWriter, r *http.Request) {
	// 1. Limite de corpo (anti payload-bomb)
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10) // 64 KB

	// 2. Decode estrito: campo desconhecido = erro (pega typo e ataque)
	var req dto.CreateOrderRequest
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "Corpo da requisição inválido.")
		return
	}

	// 3. Usuário vem do middleware de sessão — NUNCA do corpo
	user := middleware.UserFrom(r.Context())

	// 4. Validação e regra de negócio no service (única fonte de verdade)
	order, err := h.service.CreateOrder(r.Context(), user.ID, req)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrValidation):
			writeError(w, http.StatusUnprocessableEntity, "validation_failed", err.Error())
		case errors.Is(err, service.ErrOutOfStock):
			writeError(w, http.StatusConflict, "out_of_stock", "Produto sem estoque.")
		default:
			log.Error("create order", "err", err, "request_id", middleware.RequestID(r.Context()))
			writeError(w, http.StatusInternalServerError, "internal", "Erro interno.")
		}
		return
	}

	// 5. Resposta: 201 + Location + DTO estrito
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Location", fmt.Sprintf("/api/v1/orders/%d", order.ID))
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(dto.NewOrderResponse(order))
}
```

## 10. Checklist de design de API

- [ ] URLs nomeiam recursos no plural; verbos ficam no método HTTP
- [ ] Toda lista tem paginação com `limit` máximo imposto no servidor
- [ ] Formato de erro único com `code` estável para o front
- [ ] Mensagens de erro de auth genéricas (não confirmam existência de conta)
- [ ] `DisallowUnknownFields` + `MaxBytesReader` em todo decode
- [ ] Identidade do usuário sempre do middleware, nunca do payload
- [ ] Idempotency key nas operações onde duplicar custa dinheiro
- [ ] Mudanças aditivas preferidas; quebra de contrato = versão nova
- [ ] `201 + Location` na criação; `204` sem corpo em delete
- [ ] Rate limit com `429 + Retry-After` (mais restrito em login)
