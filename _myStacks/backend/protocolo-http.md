# Protocolo HTTP — Do Request ao HTTP/3

> **TL;DR:** HTTP é o contrato universal da web há 30 anos e não vai a lugar nenhum. Dominar semântica de métodos, status codes, headers e caching vale para qualquer stack, para sempre.

**Conecta com:** [apis-rest.md](apis-rest.md) · [redes-de-computadores.md](../redes/redes-de-computadores.md) (TCP/TLS por baixo) · [seguranca-da-informacao.md](../seguranca/seguranca-da-informacao.md) (headers de segurança) · [escalabilidade-load-balancing.md](../devops/escalabilidade-load-balancing.md) (caching)

---

## 1. Anatomia de uma troca HTTP

```http
POST /api/orders HTTP/1.1          ← request line: método, path, versão
Host: api.exemplo.com              ← obrigatório no 1.1 (virtual hosting)
Content-Type: application/json     ← formato do corpo enviado
Accept: application/json           ← formato que aceito receber
Cookie: session_id=abc123          ← enviado automaticamente pelo browser
Content-Length: 27

{"product_id": 42, "qty": 1}
```

```http
HTTP/1.1 201 Created               ← status line
Content-Type: application/json
Location: /api/orders/981          ← onde o recurso criado vive
Cache-Control: no-store

{"id": 981, "status": "pending"}
```

HTTP é **stateless por design**: cada request carrega tudo que o servidor precisa (por isso o cookie vai em toda requisição). Estado entre requests é sempre uma camada em cima (sessão no servidor, identificada pelo cookie).

## 2. Métodos e suas garantias semânticas

As duas propriedades que importam:

- **Safe (seguro):** não altera estado. Pode ser cacheado, prefetchado, repetido à vontade.
- **Idempotente:** N chamadas = mesmo efeito de 1. Pode ser retried com segurança.

| Método | Safe | Idempotente | Uso |
|---|---|---|---|
| GET | ✅ | ✅ | ler recurso — **nunca** mutar estado em GET |
| HEAD | ✅ | ✅ | GET sem corpo (checar existência/tamanho) |
| POST | ❌ | ❌ | criar recurso, disparar ação |
| PUT | ❌ | ✅ | substituir recurso inteiro |
| PATCH | ❌ | ❌* | alteração parcial (*pode ser idempotente se bem desenhado) |
| DELETE | ❌ | ✅ | remover (2ª chamada: 404 ou 204, efeito igual) |
| OPTIONS | ✅ | ✅ | preflight de CORS, capacidades |

**Por que isso não é pedantismo:** proxies, browsers e load balancers *confiam* nessas garantias. GET que muta estado será executado por um prefetch de browser ou crawler. POST sem idempotency key retried pela rede duplica cobrança. A semântica é um contrato com toda a infraestrutura entre cliente e servidor.

## 3. Status codes — os que você realmente usa

| Código | Significado | Quando |
|---|---|---|
| **200** OK | sucesso com corpo | GET, PUT, PATCH bem-sucedidos |
| **201** Created | recurso criado | POST de criação (+ header `Location`) |
| **204** No Content | sucesso sem corpo | DELETE, PUT sem retorno |
| **301/308** | redirect permanente | migração de URL (browser cacheia!) |
| **302/307** | redirect temporário | 307 preserva o método |
| **304** Not Modified | cache do cliente vale | resposta a ETag/If-Modified-Since |
| **400** Bad Request | request malformado | JSON inválido, campo faltando |
| **401** Unauthorized | não autenticado | sem sessão / sessão expirada |
| **403** Forbidden | autenticado, sem permissão | user tenta recurso de admin |
| **404** Not Found | não existe | também para esconder existência (403 vaza informação) |
| **409** Conflict | conflito de estado | email já cadastrado, edição concorrente |
| **422** Unprocessable | sintaxe ok, semântica não | validação de negócio falhou |
| **429** Too Many Requests | rate limit | + header `Retry-After` |
| **500** Internal Error | bug no servidor | **nunca** vaze stack trace no corpo |
| **502/503/504** | upstream/indisponível/timeout | problemas de infra — LB gera esses |

Regras práticas:
- **4xx = culpa do cliente, 5xx = culpa sua.** Alertas de monitoramento disparam em 5xx; 4xx em volume anormal indica ataque ou bug no front.
- Diferencie 401 (quem é você?) de 403 (sei quem é, não pode).
- Use 404 no lugar de 403 quando revelar que o recurso existe já é vazamento (ex: `/api/users/123` de outro tenant).

## 4. Headers essenciais

### Negociação de conteúdo
- `Content-Type`: o que estou enviando (`application/json; charset=utf-8`).
- `Accept`: o que aceito receber.
- `Content-Length` / `Transfer-Encoding: chunked`: como saber onde o corpo termina.

### Contexto e infraestrutura
- `Host`: qual site neste IP (virtual hosting).
- `User-Agent`: quem é o cliente.
- `X-Forwarded-For` / `X-Real-IP`: IP original atrás de proxy/LB — **só confie se seu proxy sobrescreve** (cliente pode forjar).
- `X-Request-ID`: correlação de logs entre serviços — gere no ponto de entrada, propague em toda chamada interna.

### Segurança (detalhe completo em [seguranca-da-informacao.md](../seguranca/seguranca-da-informacao.md))
`Strict-Transport-Security`, `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `Set-Cookie` com `HttpOnly; Secure; SameSite=Strict`.

## 5. Caching HTTP — a otimização mais barata que existe

Camada de cache que você ganha de graça do protocolo, antes de pensar em Redis:

```http
Cache-Control: public, max-age=31536000, immutable   ← assets com hash no nome
Cache-Control: private, no-cache                      ← dado por usuário, revalida sempre
Cache-Control: no-store                               ← nunca cachear (dados sensíveis)
```

| Diretiva | Efeito |
|---|---|
| `max-age=N` | válido por N segundos sem perguntar ao servidor |
| `no-cache` | pode guardar, mas **revalida** antes de usar (nome infeliz) |
| `no-store` | não guarda nada, nunca |
| `private` | só o browser pode cachear (não CDN/proxy) |
| `public` | CDN e proxies intermediários podem cachear |
| `immutable` | nem revalida — para arquivos com hash no nome |

### Revalidação com ETag (o ciclo do 304)

```
1. GET /api/products         → 200 + ETag: "v42" + corpo (20 KB)
2. GET /api/products
   If-None-Match: "v42"      → 304 Not Modified (0 bytes de corpo)
```

Servidor economiza banda; cliente ganha latência. No Go, `http.ServeFile`/`http.ServeContent` já implementam ETag/304 para arquivos. Para JSON de API, gere ETag por hash do conteúdo quando a resposta for cara e estável.

**Padrão da nossa stack:** Vite gera assets com hash no nome (`app-a1b2c3.js`) → sirva com `max-age=31536000, immutable`. O `index.html` sem hash → `no-cache`. Resultado: deploy novo é visto na hora, assets nunca são rebaixados.

## 6. Evolução: HTTP/1.1 → 2 → 3

| | HTTP/1.1 (1997) | HTTP/2 (2015) | HTTP/3 (2022) |
|---|---|---|---|
| Transporte | TCP | TCP | **QUIC (UDP)** |
| Formato | texto | binário | binário |
| Paralelismo | 1 request por conexão* | multiplexação na mesma conexão | multiplexação sem HOL de transporte |
| Problema resolvido | keep-alive reusa conexão | head-of-line do HTTP | head-of-line do **TCP** |
| Handshake | TCP + TLS (2–3 RTT) | TCP + TLS | 1 RTT (0-RTT em reconexão) |

*Browsers contornavam abrindo ~6 conexões por domínio.

- **Head-of-line blocking (HOL):** no 1.1, uma resposta lenta trava as seguintes na mesma conexão. HTTP/2 resolve no nível HTTP (streams paralelos), mas um pacote TCP perdido ainda trava **todos** os streams (HOL do TCP). HTTP/3 usa QUIC sobre UDP: perda em um stream não afeta os outros.
- **Na prática hoje:** seu CDN/LB fala HTTP/2 ou 3 com o browser e HTTP/1.1 com seu Go — e está ótimo. A latência que importa é a do último quilômetro (browser↔edge).

⚠️ **Over-engineering:** tunar HTTP/3 no seu servidor de origem, server push, priorização manual de streams. O ganho real vem de graça do CDN. Foque em: menos requests, payloads menores (DTOs estritos já ajudam), cache correto.

## 7. HTTP no Go — o que separa produção de tutorial

### Timeouts no servidor (o default é NÃO ter — e isso derruba produção)

```go
srv := &http.Server{
	Addr:              ":8080",
	Handler:           r,
	ReadHeaderTimeout: 5 * time.Second,   // anti-Slowloris
	ReadTimeout:       10 * time.Second,  // corpo inteiro
	WriteTimeout:      30 * time.Second,  // resposta inteira
	IdleTimeout:       120 * time.Second, // keep-alive ocioso
}
log.Fatal(srv.ListenAndServe())
```

Sem `ReadHeaderTimeout`, um atacante abre milhares de conexões enviando 1 byte por minuto (Slowloris) e esgota seus file descriptors. `http.ListenAndServe(":8080", r)` puro não tem **nenhum** timeout — nunca use em produção.

### Limite de corpo (anti payload-bomb)

```go
r.Body = http.MaxBytesReader(w, r.Body, 1<<20) // 1 MB máx
```

### Cliente: reutilize conexões

```go
// Um único client para a vida do processo — o Transport mantém
// pool de conexões keep-alive (evita handshake TCP+TLS por request)
var httpClient = &http.Client{Timeout: 10 * time.Second}
```

Criar `http.Client` por chamada joga fora o pool → cada request paga handshake completo. E `http.Get` sem timeout espera para sempre — todo cliente tem timeout, sem exceção (ver [system-design-fundamentos.md](system-design-fundamentos.md) sobre falha parcial).

### Graceful shutdown

```go
ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
defer stop()
go srv.ListenAndServe()
<-ctx.Done()
shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
defer cancel()
srv.Shutdown(shutdownCtx) // para de aceitar novas, termina as em voo
```

Sem isso, todo deploy corta requisições no meio. Kubernetes/ECS mandam SIGTERM antes de matar o pod — este código é o que torna deploys invisíveis ao usuário.

## 8. Checklist HTTP

- [ ] GET nunca muta estado; mutações usam POST/PUT/PATCH/DELETE corretos
- [ ] 401 vs 403 vs 404 usados com intenção (404 para não vazar existência)
- [ ] Erros 5xx sem stack trace no corpo; detalhe vai para o log
- [ ] Assets com hash → `immutable`; API sensível → `no-store`
- [ ] ETag/304 em respostas caras e estáveis
- [ ] `http.Server` com os 4 timeouts configurados
- [ ] `MaxBytesReader` em todo endpoint que aceita corpo
- [ ] Um `http.Client` global com timeout, nunca um por request
- [ ] Graceful shutdown implementado
- [ ] `X-Request-ID` gerado e propagado para correlação de logs
