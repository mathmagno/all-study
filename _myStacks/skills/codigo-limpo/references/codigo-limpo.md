# Código Limpo — harness de revisão

Critério objetivo para mudanças em `jpag`, `lounge-jotaja`,
`jotaja-cs-platform` e `jotaja-import-local`.

Este documento não exige limpar o repositório inteiro em toda mudança. A revisão
considera as linhas adicionadas ou alteradas, o legado diretamente afetado e o
risco criado pelo conjunto do diff. Problema preexistente fora do escopo segue a
regra do escoteiro.

Este harness trata somente de Código Limpo. A seção **Clean Architecture** do
`CLAUDE.md` central permanece fechada e continua sendo aplicada separadamente.

## Severidade

| Severidade | Sinal | Decisão |
|---|---|---|
| **Bloqueia merge** | O diff compromete comportamento, contrato, segurança, dinheiro ou diagnóstico de falha | Corrigir antes da aprovação |
| **Corrige antes do commit** | O diff introduz ambiguidade, ruído ou estrutura desnecessária sem alterar a regra de negócio | Corrigir no trabalho atual |
| **Regra do escoteiro** | A violação já existia, não foi tocada e não é necessária para a mudança | Corrigir em commit separado ou registrar; não ampliar o diff funcional |

“Legado” não isenta linha modificada. Ao tocar na linha, aplique o harness.

## Índice

- [Como aplicar](#como-aplicar)
- [Fonte e resoluções locais](#fonte-e-resoluções-locais)
- [Perfis dos projetos](#perfis-dos-projetos)
- [Nomes](#nomes)
- [Funções](#funções)
- [Comentários](#comentários)
- [Erros](#erros)
- [Duplicação](#duplicação)
- [Testes](#testes)
- [Dinheiro](#dinheiro)
- [Guardrails já naturais](#guardrails-já-naturais)
- [Regra do escoteiro](#regra-do-escoteiro)
- [Formato da revisão](#formato-da-revisão)

## Como aplicar

Antes de implementar:

1. identifique o projeto e seu perfil de idioma;
2. leia as regras relacionadas aos arquivos que serão tocados;
3. procure contratos, sentinelas, tipos e helpers existentes;
4. identifique dinheiro, I/O e decisões de negócio no fluxo;
5. antecipe todo sinal que bloquearia merge.

Antes de concluir:

1. revise o diff, não apenas os arquivos finais;
2. para cada achado, cite regra, `arquivo:linha`, sinal e correção;
3. execute os comandos já disponíveis e relacionados ao diff;
4. declare comando não executado e motivo;
5. separe melhoria de escoteiro da mudança funcional.

Contagem de linhas e busca textual são tripwires, não vereditos. A decisão usa o
sinal descrito em cada regra. Não instale ferramenta para satisfazer o harness.

## Fonte e resoluções locais

Os princípios foram extraídos e reformulados a partir de *Clean Code*, primeira
edição. O mapeamento usa o
[sumário oficial da Pearson](https://www.pearson.com/en-us/subject-catalog/p/clean-code-a-handbook-of-agile-software-craftsmanship/P200000009044/9780132350884)
e a
[amostra oficial do capítulo 2](https://www.informit.com/content/images/9780132350884/samplepages/9780132350884.pdf):

- cap. 1, Código Limpo e regra do escoteiro;
- cap. 2, Nomes significativos;
- cap. 3, Funções;
- cap. 4, Comentários;
- cap. 7, Tratamento de erros;
- cap. 9, Testes unitários;
- cap. 17, Odores e heurísticas.

Não há transcrição de capítulo nem reprodução literal dos exemplos do livro.
Todos os exemplos abaixo partem de código deste ecossistema.

Convenções locais prevalecem sobre recomendações dependentes de linguagem:

- erro continua valor em Go;
- `Result` continua valor nas fronteiras TypeScript que já adotam o contrato;
- decisão usa sentinela ou tipo, nunca texto de erro;
- DRY não significa abstrair coincidências;
- receiver Go de uma letra e abreviações consagradas são permitidos;
- GoDoc pode descrever contrato público; comentário interno explica motivo;
- `context.Context` e receiver não entram na contagem de argumentos;
- `recipient` e `sync` são exceções qualificadas, não vocabulário livre;
- teste é exigido quando o projeto já possui runner; o harness não instala um.

## Perfis dos projetos

| Projeto | Vocabulário | Fronteiras e exceções |
|---|---|---|
| `jpag` | Domínio em pt-BR; infraestrutura em inglês | `recipient` e nomes Pagar.me/Cognito permanecem no adaptador, contrato externo, log ou identificador qualificado; operação técnica pode usar `sync` |
| `lounge-jotaja` | Domínio de produto em pt-BR; infraestrutura AWS/HTTP em inglês | Campos impostos por SDK ou JSON externo preservam o contrato |
| `jotaja-cs-platform` | Código em inglês conforme o `CLAUDE.md` local; UI em pt-BR | Termos sem tradução natural permanecem no domínio: `inadimplencia`, `faturamento`, `bairro` |
| `jotaja-import-local` | Modelo canônico e infraestrutura seguem o vocabulário inglês já adotado; UI e conceitos operacionais do Jotajá ficam em pt-BR | Payload externo preserva seus campos; não misture idiomas dentro do mesmo identificador |

O perfil muda o idioma, não a exigência de intenção. `data`, `info`, `obj` e
`result` não ganham significado por estarem no idioma aceito; aplique N1 pelo
escopo e pelo papel.

### Termos externos

- Use `recipient` sem tradução dentro de `jpag/backend/internal/pagarme` ou quando o nome
  identificar explicitamente o contrato, como `PagarmeRecipientID`.
- Fora da fronteira Pagar.me, use `recebedor` quando o conceito existir sem o
  provedor. Não use `recipiente` como tradução.
- Use `sync` em nome de worker, rota, tabela, métrica ou operação técnica já
  estabelecida. Em regra de negócio, prefira `sincronizar`/`sincronizacao`.
- Preserve `UserPoolId`, `IdToken`, `TransferEnabled` e outros campos impostos
  por SDK/API no adaptador. Traduza ao entrar no modelo interno.

### Comandos existentes

Execute apenas o conjunto relacionado ao diff.

| Projeto | Comandos disponíveis |
|---|---|
| `jpag/backend` | `go test ./...`, `go vet ./...`, `go build ./...` |
| `jpag/frontend` | `npm run lint`, `npm run build`; não há runner de testes |
| `lounge-jotaja/backend` | `go test ./...`, `go vet ./...`, `go build ./...` |
| `lounge-jotaja` | `pnpm lint`, `pnpm build`; não há runner de testes |
| `jotaja-cs-platform` | `pnpm typecheck`, `pnpm test:run`, `pnpm build` |
| `jotaja-import-local` | `pnpm run ci`, ou `pnpm typecheck`, `pnpm test`, `pnpm build` |

## Nomes

### N1 — Nome descreve o papel, não o recipiente

**Severidade:** corrige antes do commit. Nome ambíguo em API, entidade, porta ou
regra pública bloqueia merge.

**Sinal no diff:**

- binding chamado `dados`, `data`, `info`, `obj`, `item`, `result`, `res`,
  `resp`, `value`, `temp` ou `lista` atravessa um `if`, laço, mais de uma
  asserção ou chamada adicional;
- variáveis são distinguidas pelo recipiente, por número ou por sufixo vazio;
- é necessário ler a expressão da direita para descobrir o conteúdo.

**Correção:**

- nomeie pelo papel: `lojistas`, `resumoLojista`, `respostaPagarme`;
- qualifique o resultado quando houver mais de uma operação;
- não acrescente `Data`, `Info`, `Object`, `1` ou `2` para criar distinção.

Binding genérico usado em uma única asserção ou retorno imediato é aceito quando
a chamada já revela o papel. Se o escopo crescer, renomeie.

**❌ Atual — `jpag/backend/internal/service/admin.go:57`:**

```go
lista, err := s.repo.ListarLojistas(ctx)

resp := &dto.LojistasResponse{
    Lojistas: make([]dto.LojistaResumoAdmin, 0, len(lista)),
}
for _, l := range lista {
    item := dto.LojistaResumoAdmin{
        ID:           l.ID.String(),
        NomeExibicao: l.NomeExibicao,
    }
    resp.Lojistas = append(resp.Lojistas, item)
}
return resp, nil
```

**✅ Correção sobre o mesmo trecho:**

```go
lojistas, err := s.repo.ListarLojistas(ctx)

resposta := &dto.LojistasResponse{
    Lojistas: make([]dto.LojistaResumoAdmin, 0, len(lojistas)),
}
for _, lojista := range lojistas {
    resumoLojista := dto.LojistaResumoAdmin{
        ID:           lojista.ID.String(),
        NomeExibicao: lojista.NomeExibicao,
    }
    resposta.Lojistas = append(resposta.Lojistas, resumoLojista)
}
return resposta, nil
```

**Referência:** cap. 2, intenção revelada e distinções significativas.

### N2 — Abreviação privada não entra

**Severidade:** corrige antes do commit.

**Sinal no diff:**

- o nome perde vogais ou sílabas: `svc`, `cfg`, `mov`, `transf`, `qtdPend`;
- a abreviação só é entendida depois de procurar o tipo;
- a busca pelo conceito completo não encontra o identificador;
- a mesma sigla representa dois conceitos.

**Correção:** escreva o conceito por extenso e mantenha abreviação somente nas
exceções fechadas abaixo.

**Exceções fechadas:**

- receiver idiomático de Go;
- `ctx`, `err`, `tx`, `repo`; `ID` em Go e `id` em TypeScript;
- `URL`, `HTTP`, `JSON`, `CSV`, `JWT`, `PIX`, `TED`, `AWS`;
- `i`/`j` em laço curto;
- sigla formal presente no contrato externo.

A exceção não autoriza `pg`, `cg`, `cfg`, `svc` ou outra contração privada.

**❌ Atual — `jpag/backend/internal/service/admin.go:52`:**

```go
func NewAdminService(repo AdminStore, pg RecipientLister, cg CriadorCognito, auditor *Auditoria) *AdminService {
    return &AdminService{repo: repo, pagarme: pg, cognito: cg, auditor: auditor}
}
```

**✅ Correção sobre o mesmo trecho:**

```go
func NewAdminService(repo AdminStore, pagarme RecipientLister, cognito CriadorCognito, auditor *Auditoria) *AdminService {
    return &AdminService{
        repo: repo,
        pagarme: pagarme,
        cognito: cognito,
        auditor: auditor,
    }
}
```

**Referência:** cap. 2, nomes pronunciáveis e buscáveis.

### N3 — Comprimento acompanha o alcance

**Severidade:** corrige antes do commit.

**Sinal no diff:**

- identificador de uma letra permanece vivo além de uma expressão;
- nome curto é reutilizado depois de um ramo;
- variável atravessa mais de cinco linhas e não identifica o conceito;
- o revisor precisa voltar ao início do bloco para lembrar o significado.

**Correção:** expanda o nome até que o papel seja reconhecido no ponto de uso.
Preserve receiver, índice e binding curto quando vivem em uma expressão.

O número de linhas é tripwire. O veredito é a perda de significado no escopo.

**❌ Atual — `jpag/backend/internal/storetest/suite.go:107`:**

```go
a := novo(t)
id := criarLojista(t, a, "1")
```

`a` representa o conjunto inteiro de adapters e continua vivo pelo subteste.

**✅ Correção sobre o mesmo trecho:**

```go
adapters := novo(t)
lojistaID := criarLojista(t, adapters, "1")
```

Nome curto em expressão única continua aceitável. Aumentar todo índice ou
receiver não melhora a leitura.

**Referência:** cap. 2, nomes buscáveis e escopo.

### N4 — Booleano afirma um estado

**Severidade:** corrige antes do commit. Flag que seleciona comportamentos com
efeitos diferentes bloqueia merge.

**Sinal no diff:**

- dupla negação: `naoInativa`, `notDisabled`, `semBloqueio`;
- substantivo ambíguo não diz qual estado é verdadeiro;
- call site recebe `true`/`false` e isso muda todo o fluxo.

**Correção:**

- use estado afirmativo: `ativa`, `bloqueada`, `novaSenhaObrigatoria`;
- quando o booleano escolhe duas operações, separe funções ou use opção nomeada.

**❌ Atual — `jpag/backend/internal/service/auth.go:66`:**

```go
DesafioNovaSenha bool
```

**✅ Padrão já existente — `jpag/backend/internal/cognito/client.go:52`:**

```go
NovaSenhaObrigatoria bool
```

Em `jotaja-import-local/src/app/(main)/ifood-import/page.tsx:15`, `enforce bool`
seleciona fluxo. A correção é uma opção `authEnforced` ou duas funções quando os
efeitos forem diferentes.

**Referência:** cap. 2 e cap. 3.

### N5 — O identificador segue o perfil de idioma

**Severidade:** corrige antes do commit. Nome público que quebra o vocabulário
da camada bloqueia merge.

**Sinal no diff:**

- o identificador mistura idiomas;
- termo de infraestrutura ganha traduções diferentes;
- termo de domínio entra em inglês onde o perfil exige pt-BR;
- nome externo atravessa o adaptador sem tradução ou qualificação.

**Correção:**

- escolha o nome conforme projeto e camada;
- mantenha o nome imposto apenas na borda;
- traduza ao entrar no domínio;
- não faça migração massiva de idioma junto de mudança funcional.

**❌ Atual — `jpag/backend/internal/service/lojista.go:325`:**

```go
func domainSituacao(tab string) string {
```

**✅ Correção sobre a mesma função:**

```go
func situacaoPorAba(aba string) string {
```

`recipient` e `sync` seguem as exceções qualificadas deste documento.

**Referência:** cap. 2 e convenção local.

### N6 — O tipo também revela intenção

**Severidade:** `any` em contrato, fronteira ou domínio bloqueia merge. Uso
local tocado no diff corrige antes do commit.

**Sinal no diff:**

- entra `any`, `any[]` ou cast `as any`;
- resposta externa é usada antes de validação;
- consumidor depende de campos implícitos;
- cast existe apenas para silenciar o compilador.

**Correção:**

- receba dado externo como `unknown`;
- valide ou estreite na fronteira;
- declare o menor tipo que representa o contrato;
- corrija o tipo ou mapeamento em vez de encerrar a análise com cast.

**❌ Atual — `jotaja-import-local/src/lib/integrations/jotaja/jotaja-api.ts:15`:**

```ts
export function isFailedSaveResponse(data: any): boolean {
  const erro = typeof data?.erro === 'string' ? data.erro.trim() : '';
  return data?.insere === false || erro.length > 0;
}
```

**✅ Correção sobre a mesma fronteira:**

```ts
interface SaveResponse {
  erro: string;
  insere: boolean;
}

function isSaveResponse(response: unknown): response is SaveResponse {
  if (typeof response !== 'object' || response === null) return false;
  const fields = response as Record<string, unknown>;
  return typeof fields.erro === 'string' && typeof fields.insere === 'boolean';
}

export function isFailedSaveResponse(response: unknown): boolean {
  if (!isSaveResponse(response)) return true;
  return response.insere === false || response.erro.trim().length > 0;
}
```

Resposta incompleta ou de formato desconhecido é falha; não vira sucesso por
ausência de campos.

**Referência:** cap. 2 e convenção TypeScript local.

## Funções

### F1 — Uma responsabilidade e um nível de abstração

**Severidade:** bloqueia merge quando regra de negócio se mistura com I/O ou
escrita parcial. Nos demais casos, corrige antes do commit.

**Sinal no diff:**

- a função precisa de “e” para ser descrita;
- contém grupos independentes entre buscar, decidir, transformar, persistir e
  responder;
- regra de negócio aparece entre SQL, HTTP, SDK ou JSX;
- entra terceiro nível de controle;
- uma variável conecta duas fases que poderiam ter contratos próprios.

**Correção:**

- deixe a função pública orquestrar helpers nomeados pelo propósito;
- mantenha I/O na borda e cálculo em função pura;
- use guard clauses para retirar níveis;
- não extraia bloco para helper genérico sem intenção.

**❌ Atual — `jotaja-cs-platform/src/lib/queries/dashboard.ts:115`:**

`getDashboardData` busca fontes, normaliza, cruza snapshots, aplica regras,
calcula linhas, estatísticas e KPIs no mesmo corpo de aproximadamente 400 linhas.

**✅ Forma esperada para o mesmo fluxo:**

```ts
export async function getDashboardData(monthIso?: string): Promise<DashboardData> {
  const sources = await loadDashboardSources(monthIso);
  const rows = buildDashboardRows(sources);

  return {
    rows,
    stats: calculateDashboardStats(rows),
    kpis: calculateDashboardKpis(rows, sources.scoreRules),
  };
}
```

`loadDashboardSources` conhece Supabase; as funções de cálculo não conhecem.

**Referência:** cap. 3, fazer uma coisa e um nível de abstração.

### F2 — Argumentos representam um conceito coeso

**Severidade:** corrige antes do commit. Flag que escolhe comportamentos com
efeitos diferentes bloqueia merge.

**Sinal no diff:**

- mais de três argumentos, excluindo receiver e `context.Context`;
- pares ou trios reaparecem em várias chamadas;
- argumentos do mesmo tipo podem ser trocados sem erro;
- call site contém `true`/`false` sem explicar a decisão.

**Correção:**

- crie `struct` ou objeto de parâmetros com nome do conceito;
- separe funções quando o booleano escolhe comportamentos distintos;
- mantenha par coeso, como `de`/`ate`, quando o agrupamento piorar o call site.

**❌ Atual — `jpag/backend/internal/service/auth.go:50`:**

```go
func NewAuthService(lojistas LojistaStore, sessoes SessaoStore, cg CognitoAuth, region, poolID, clientID string) *AuthService {
```

**✅ Correção sobre o mesmo construtor:**

```go
type AuthDependencies struct {
    Lojistas LojistaStore
    Sessoes  SessaoStore
    Cognito  CognitoAuth
}

type CognitoConfig struct {
    Region   string
    PoolID   string
    ClientID string
}

func NewAuthService(dependencies AuthDependencies, config CognitoConfig) *AuthService {
```

**Referência:** cap. 3, argumentos e objetos de parâmetros.

## Comentários

### C1 — Comentário registra informação ausente do código

**Severidade:** corrige antes do commit. Comentário que contradiz comportamento,
segurança ou contrato bloqueia merge.

**Sinal no diff:**

- traduz literalmente a linha seguinte;
- compensa nome genérico;
- usa cabeçalho decorativo sem decisão;
- cita número, nome ou caminho que o código alterou;
- deixa comportamento antigo descrito após a mudança.

**Correção:**

- remova narração;
- renomeie ou extraia quando o código não se explica;
- mantenha motivo, restrição, trade-off, origem do contrato ou incidente;
- GoDoc de símbolo exportado pode descrever seu contrato.

**❌ Atual — `jotaja-cs-platform/src/lib/queries/dashboard.ts:123`:**

```ts
// Always filter to active master restaurants
const { data: rests } = await supabase
  .from("restaurants")
  .select("name")
  .eq("active", true);
```

O predicado já diz o que acontece. Remova o comentário ou registre por que um
restaurante inativo não pode participar do cálculo.

**✅ Atual — `jotaja-import-local/src/lib/domain/catalog/money.ts:3`:**

O comentário registra o postmortem do preço zerado, os formatos externos reais
e por que `parseFloat`/`Number` não podem ser usados diretamente. Isso não pode
ser inferido do corpo da função.

**Referência:** cap. 4.

## Erros

O cap. 7 não é aplicado como preferência universal por exceções. Go usa `error`;
parsers e Server Actions que adotam `Result` continuam com erro como valor.

### E1 — Erro cruza fronteira com contexto e causa preservada

**Severidade:** bloqueia merge.

**Sinal no diff:**

- dependência retorna erro e a função devolve apenas `err`;
- erro cruza repository → service, SDK → adaptador ou parser → caso de uso sem
  identificar a operação;
- novo erro perde `%w`, `cause`, sentinela ou código tipado.

**Correção:**

- Go: `fmt.Errorf("<camada>: <operação>: %w", err)`;
- TypeScript com exceção: contexto e causa preservada;
- TypeScript com `Result`: código/etapa estruturados e causa interna;
- mapeie sentinela somente onde a camada toma uma decisão.

**❌ Atual — `jpag/backend/internal/repository/financeiro.go:99`:**

```go
return fatias, rows.Err()
```

**✅ Correção sobre o mesmo retorno:**

```go
if err := rows.Err(); err != nil {
    return nil, fmt.Errorf("repository: listar composição do período: %w", err)
}
return fatias, nil
```

**✅ Padrão existente — `jpag/backend/internal/repository/sync_write.go:34`:**

```go
return nil, fmt.Errorf("repository: listar ativos: %w", err)
```

**Referência:** cap. 7 e convenção local.

### E2 — Falha não vira ausência silenciosa

**Severidade:** bloqueia merge.

**Sinal no diff:**

- `catch {}` sem justificativa;
- `_ = chamadaQueRetornaErro`;
- `if err == nil` sem ramo de falha;
- indisponibilidade e “não encontrado” viram o mesmo vazio;
- erro vira zero, `""`, `[]` ou `nil` sem contrato explícito.

**Correção:**

- propague com contexto;
- trate ausência por sentinela;
- se o fluxo for best-effort, explique consequência e limite;
- logue quando a operação principal já terminou e o erro não pode ser devolvido.

**❌ Atual — `jpag/backend/internal/service/lojista.go:72`:**

```go
if config, err := s.fin.Config(ctx, lojistaID); err == nil && config.Automatica {
    proximaData = ProximoRepasse(agora, config).Format("2006-01-02")
}
```

**✅ Correção sobre o mesmo fluxo:**

```go
config, err := s.fin.Config(ctx, lojistaID)
switch {
case errors.Is(err, domain.ErrNaoEncontrado):
    // Sem configuração ainda não existe próximo repasse.
case err != nil:
    return nil, fmt.Errorf("service: montar resumo: configuração: %w", err)
case config.Automatica:
    proximaData = ProximoRepasse(agora, config).Format("2006-01-02")
}
```

Outro caso é `jpag/backend/internal/syncer/decompose.go:123`: o erro de
`json.Unmarshal` é descartado sem distinguir payload ausente de inválido.

**✅ Best-effort documentado — `lounge-jotaja/lib/cognito.ts:20`:**

O `catch` de `publishIdToken` explica que a falha não bloqueia a sessão Cognito
e qual mecanismo continua válido. O `catch {}` de `clearIdToken`, na linha 37,
não contém a mesma justificativa e deve ser corrigido quando tocado.

**Referência:** cap. 7 e convenção local.

### E3 — Detalhe interno não vira resposta pública

**Severidade:** bloqueia merge.

**Sinal no diff:**

- resposta HTTP inclui `err.Error()`, `error.message`, stack, SQL ou
  `response.data`;
- mensagem de SDK é concatenada na resposta;
- log não contém o erro que foi escondido do cliente.

**Correção:**

- logue operação e causa de forma estruturada;
- mapeie apenas erros de negócio conhecidos;
- devolva mensagem pública estável;
- preserve os detalhes no servidor.

**❌ Atual — `jotaja-import-local/src/app/api/gplus-import/route.ts:60`:**

```ts
} catch (err: any) {
  const msg = err?.response?.data
    ? JSON.stringify(err.response.data)
    : (err?.message ?? String(err));
  return NextResponse.json({ success: false, message: msg }, { status: 500 });
}
```

**✅ Correção sobre a mesma borda:**

```ts
} catch (error: unknown) {
  console.error("gplus-import: importar catálogo", error);
  return NextResponse.json(
    { success: false, message: "Não foi possível importar o cardápio." },
    { status: 500 },
  );
}
```

**✅ Padrão existente — `jpag/backend/internal/handler/admin.go:179`:**

```go
slog.Error("erro interno em rota admin", "erro", err)
erroJSON(w, http.StatusInternalServerError, "erro interno; tente novamente")
```

**Referência:** cap. 7 e convenção local de fronteira.

## Duplicação

### D1 — Regra compartilhada tem uma implementação; coincidência fica separada

**Severidade:** nova duplicação de regra de negócio bloqueia merge. Terceira
repetição da mesma operação corrige antes do commit. Legado fora do diff é
regra do escoteiro.

**Sinal no diff:**

- fórmula, limiar, mapeamento ou validação de negócio aparece em dois lugares;
- surge a terceira cópia do mesmo fluxo;
- corrigir um contrato exigiria alterar vários arquivos;
- trechos têm a mesma razão de mudar, não apenas a mesma forma.

**Correção:**

- extraia para a camada dona da decisão;
- mantenha variação como dado;
- não crie helper genérico para trechos que mudam por razões diferentes;
- dê à abstração nome e contrato específicos.

**❌ Atual:** oito rotas de `jotaja-import-local/src/app/api/`
repetem configuração de credenciais, `JotajaUploaderService`, serialização e
extração de erro. O padrão aparece em `gplus-import`, `yooga-import`,
`goomer-import`, `gama-import`, `jotaja-import`, `anota-ai-import` e
`anota-ai-admin-import`, além da etapa de upload de `image-import`.

```ts
const api = new JotajaApiService();
await api.configure(jotaja_token, jotaja_restaurant_id, jotaja_user_id);
const uploader = new JotajaUploaderService(api);
const result = await uploader.upload(catalog);
```

**✅ Correção sobre o fluxo existente:**

```ts
const uploadResult = await uploadCatalogToJotaja(catalog, {
  token: jotaja_token,
  restaurantId: jotaja_restaurant_id,
  userId: jotaja_user_id,
});

return NextResponse.json(toUploadResponse(catalog, uploadResult));
```

Cada rota continua dona da leitura e normalização de sua origem. O helper é dono
somente do contrato de upload para o Jotajá.

**Contraexemplo deliberado:** `jpag/backend/internal/repository/ports.go` e
`jpag/backend/internal/dynamostore/ports.go` repetem asserções em cada adaptador. Não
centralize: cada adaptador deve provar localmente que implementa a porta.

**Referência:** cap. 3 e cap. 17. “DRY a todo custo” não se aplica.

## Testes

### T1 — Mudança de comportamento recebe prova quando há runner

**Severidade:** bloqueia merge quando o projeto possui runner. Sem runner,
declare a validação manual; este harness não autoriza instalar um.

**Sinal no diff:**

- muda branch, fórmula, parser, normalização, mapeamento ou tratamento de erro;
- somente produção muda;
- teste existente não cobre o caso;
- correção de bug não reproduz a falha anterior.

**Correção:**

- adicione o menor teste que falha sem a mudança;
- teste resultado observável, não chamada interna;
- extraia cálculo puro antes de testar um orquestrador inteiro;
- registre por que o teste não pôde ser executado.

**❌ Lacuna atual:** `jotaja-cs-platform/src/lib/queries/dashboard.ts:115`
concentra cruzamento e cálculo sem
`jotaja-cs-platform/src/lib/queries/dashboard.test.ts`. Não há trecho de teste
ruim a citar porque o caso é ausência; não se fabrica exemplo.

**✅ Padrão existente — `jotaja-cs-platform/src/lib/scoring/engine.test.ts:83`:**

```ts
it("score never goes below 0", () => {
  const result = calculateScore(rules, row);
  expect(result.score).toBe(0);
});
```

`result` vive até uma única asserção e `calculateScore` revela o papel. Se o
teste ganhar outro resultado, branch ou conjunto de asserções, use `scoreResult`.

`jpag/frontend` e `lounge-jotaja` não possuem runner. Não alegue teste
automatizado nesses projetos.

**Referência:** cap. 9.

### T2 — Teste isola um conceito e diagnostica a falha

**Severidade:** corrige antes do commit. Dependência de relógio, ordem ou estado
compartilhado bloqueia merge.

**Sinal no diff:**

- nome genérico ou numérico;
- um teste cobre decisões independentes;
- mensagem imprime apenas o obtido;
- relógio real, rede ou estado global entra sem controle;
- mock global não é restaurado.

**Correção:**

- um comportamento por teste ou `t.Run`;
- declare obtido e esperado;
- fixe relógio e restaure mocks;
- nomeie pela regra observada.

**❌ Atual — `jpag/backend/internal/service/lojista_test.go:74`:**

```go
if got := RotuloConta(conta); got != "Santander · conta final 47-2" {
    t.Fatalf("rótulo = %q", got)
}
```

**✅ Correção sobre o mesmo teste:**

```go
const esperado = "Santander · conta final 47-2"

obtido := RotuloConta(conta)
if obtido != esperado {
    t.Fatalf("RotuloConta() = %q; esperado %q", obtido, esperado)
}
```

`TestGerarExtratoCSVEscapaFormula`, em
`jpag/backend/internal/service/lojista_test.go:79`, também verifica
decimal e BOM. Divida em comportamentos nomeados ou `t.Run` independentes.

**Referência:** cap. 9.

## Dinheiro

### M1 — Dinheiro entra no domínio como centavos inteiros

**Severidade:** bloqueia merge.

**Sinal no diff:**

- `float32`, `float64` ou decimal representa preço, custo, saldo, receita, taxa
  fixa ou transferência;
- TypeScript armazena dinheiro decimal sem unidade;
- soma ou comparação ocorre antes da normalização;
- `parseFloat` ou `Number` é usado diretamente na entrada monetária.

Percentual, quantidade física e razão não são dinheiro. Identifique a unidade
no nome.

**Correção:**

- Go: `int64` com sufixo `Centavos`;
- TypeScript/JSON: `number` inteiro seguro com sufixo `Centavos` e validação de
  inteiro; não use `bigint` em JSON sem contrato próprio;
- converta e arredonde uma vez na fronteira;
- formate reais/dólares somente na apresentação.

**❌ Atual — `lounge-jotaja/backend/handlers/costs.go:76` e `:109`:**

```go
type costSummary struct {
    GrossUsage float64 `json:"grossUsage"`
    Credit     float64 `json:"credit"`
    Net        float64 `json:"net"`
}

func parseAmount(s *string) float64 {
    if s == nil {
        return 0
    }
    v, err := strconv.ParseFloat(*s, 64)
    if err != nil {
        return 0
    }
    return v
}
```

**✅ Correção esperada para o mesmo contrato:**

```go
type costSummary struct {
    GrossUsageCentavos int64 `json:"grossUsageCentavos"`
    CreditCentavos     int64 `json:"creditCentavos"`
    NetCentavos        int64 `json:"netCentavos"`
}

func parseCentavosAWS(valor *string) (int64, error) {
    // Converter custo decimal e aplicar arredondamento uma vez.
}

func parseQuantidadeAWS(valor *string) (float64, error) {
    // Quantidade física mantém sua unidade; não é dinheiro.
}
```

O helper genérico atual também lê `UsageQuantity`. Separe quantidade de custo:
somente custo vira centavos. Ambos rejeitam valor inválido; zero silencioso não
é correção. A renomeação dos campos JSON monetários exige mudança coordenada dos
consumidores. O mesmo vale para `price: number` no catálogo normalizado de
`jotaja-import-local`.

**✅ Padrão existente:** os valores monetários de
`jpag/backend/internal/domain` e `jpag/backend/internal/dto` usam `int64` e
`Centavos`.

**Referência:** convenção local; o livro não prescreve representação monetária.

## Guardrails já naturais

A auditoria inicial de 22/07/2026 cobriu os quatro repositórios, excluindo
dependências e artefatos gerados. Estas notas registram padrões naturais; não
criam métricas permanentes.

- **Decisão de erro não usa texto.** Não foi confirmado string matching. Novo
  matching de mensagem bloqueia merge; exponha sentinela, tipo ou `Result`.
- **Código morto não está comentado.** Não foram confirmados blocos desativados
  nem `TODO/FIXME/HACK` reais. Se entrarem, apague antes do commit; contrato
  desatualizado bloqueia merge.
- **Efeito colateral está explícito.** Não foi confirmada consulta que persista,
  crie sessão ou emita evento. Se `validar`, `calcular`, `listar`, `get` ou
  `parse` ganhar esse efeito, o diff bloqueia; separe comando e consulta.
- **A maioria das funções Go é curta.** Não crie limite mecânico; aplique F1.
- **A maioria das funções TypeScript tem poucos argumentos.** Preserve F2.
- **Testes existentes são majoritariamente comportamentais.** Preserve T1 e T2.
- **Sentinelas e wrapping são comuns no `jpag`.** Não regrida para mensagem ou
  retorno cru.
- **Dinheiro no núcleo maduro do `jpag` usa centavos.** Não regrida.

## Regra do escoteiro

Melhoria fora do objetivo funcional não entra escondida no mesmo commit.

**Sinal no diff:**

- arquivos sem relação mudam apenas por limpeza;
- renomeação ampla acompanha correção urgente;
- formatação torna o diff maior que a mudança;
- o revisor não separa mudança de comportamento de refatoração.

**Decisão:**

- se a limpeza é necessária para implementar com segurança, mantenha e explique;
- se é independente, mova para commit separado;
- se aumenta risco ou escopo, registre e não execute agora.

**Exemplo real:** corrigir o retorno de erro em `CadastrarLojista` não autoriza
renomear todos os `resp`, `item` e `l` de
`jpag/backend/internal/service/admin.go` no mesmo commit. A limpeza é válida em
commit separado.

**Referência:** cap. 1.

## Formato da revisão

```text
Bloqueia merge
- E3 — detalhe de infraestrutura devolvido em <arquivo>:<linha>.
  Correção: logar a causa e estabilizar a resposta pública.

Corrige antes do commit
- N2 — abreviação privada `cfg` em <arquivo>:<linha>.
  Correção: `configuracao`.

Regra do escoteiro
- N1 — `resp` legado fora das linhas tocadas em <arquivo>:<linha>.
  Fazer em commit separado.

Verificação
- Executado: <comando> — passou.
- Não executado: <comando> — <motivo>.
```

Revisão sem achado informa somente comandos executados e limitações. Não invente
conformidade de teste, lint ou build.
