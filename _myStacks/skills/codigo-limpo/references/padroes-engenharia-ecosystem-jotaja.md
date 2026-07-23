# ecosystem-jotaja — Padrões de engenharia

Repositórios: `jpag`, `lounge-jotaja`, `jotaja-cs-platform`, `jotaja-import-local`.
Cada repo tem (ou terá) seu próprio `CLAUDE.md` com contexto de produto. Este arquivo define **como se escreve código** em todos eles.

Os dois padrões abaixo não são sugestões de estilo: são critérios de revisão.
Violação introduzida ou tocada deve ser corrigida antes do commit. Dívida fora do
diff segue a regra do escoteiro.

---

## 1. Código Limpo

Antes de implementar, alterar, refatorar ou revisar código, carregue e siga a
skill [`codigo-limpo`](../SKILL.md).

Princípios:

- nome revela intenção; domínio segue o perfil de idioma do repositório;
- função mantém uma responsabilidade e um nível de abstração;
- erro é valor com contexto, causa preservada e decisão por sentinela ou tipo;
- dinheiro de domínio usa centavos inteiros; percentual é outra grandeza;
- regra de negócio não se duplica; coincidência não justifica abstração;
- teste relevante executado faz parte da entrega quando o projeto tem runner;
- dívida fora do diff segue a regra do escoteiro em commit separado.

O critério observável, as severidades, as exceções e os exemplos reais estão no
[harness de Código Limpo](codigo-limpo.md). A seção 2 abaixo é um
critério independente e não deve ser reescrita pela skill.

---

## 2. Clean Architecture

### A regra da dependência

**Dependências apontam para dentro.** O núcleo (regra de negócio) não conhece o mundo externo; o mundo externo conhece o núcleo.

```
        ┌──────────────────────────────────────────┐
        │  Frameworks e drivers                    │  chi, pgx, aws-sdk,
        │  ┌────────────────────────────────────┐  │  Lambda, React, DynamoDB
        │  │  Adaptadores de interface          │  │  handler, repository,
        │  │  ┌──────────────────────────────┐  │  │  pagarme, cognito
        │  │  │  Casos de uso                │  │  │  service, syncer
        │  │  │  ┌────────────────────────┐  │  │  │
        │  │  │  │  Entidades / domínio   │  │  │  │  domain
        │  │  │  └────────────────────────┘  │  │  │
        │  │  └──────────────────────────────┘  │  │
        │  └────────────────────────────────────┘  │
        └──────────────────────────────────────────┘
                   dependência aponta →← para dentro
```

Mapa concreto no `jpag/backend`:

| Camada | Pacote | Pode importar |
|---|---|---|
| Entidades | `internal/domain` | **nada** do projeto |
| Casos de uso | `internal/service`, `internal/syncer` | `domain` |
| Adaptadores | `internal/handler`, `internal/repository`, `internal/middleware`, `internal/pagarme`, `internal/cognito` | `domain`, `service`, `syncer` |
| Frameworks | `cmd/api`, `cmd/sync` | todos (é onde tudo é ligado) |

### Portas e adaptadores

- **A regra define a interface; a infraestrutura implementa.** As portas moram junto de quem as consome (`service/store.go`), não junto de quem as satisfaz.
- O adaptador conhece a porta, a porta não conhece o adaptador. Por isso `repository` importa `service`, e nunca o contrário.
- Afirme a conformidade em tempo de compilação, num único lugar (`repository/ports.go`):
  ```go
  var _ service.FinanceiroStore = (*FinanceiroRepo)(nil)
  ```
  Assinatura que divergir quebra o build ali, não na fiação.

### Proibições concretas

Estas são as violações que aparecem na prática. Nenhuma passa em revisão:

1. `domain` importando qualquer pacote do projeto.
2. `service` ou `syncer` importando `repository`, `handler`, `pagarme`, `cognito` ou qualquer SDK de infraestrutura.
3. Tipo de infraestrutura vazando na assinatura de um caso de uso (`*pgxpool.Pool`, `*dynamodb.Client`, `*http.Request` dentro de `service`).
4. Entidade de domínio serializada direto na resposta HTTP. Existe DTO para isso — a resposta é contrato público, a entidade é interna.
5. SQL, chave de partição ou nome de tabela fora de `repository`.
6. Regra de negócio dentro de `handler`. Handler traduz HTTP ↔ caso de uso: parse, validação de forma, código de status. Decisão é do service.
7. Teste de regra de negócio importando o adaptador. Se o teste precisa saber qual banco está por baixo, a fronteira vazou.

### Como isso se verifica

- `go build ./...` — as asserções de porta pegam divergência de assinatura.
- Ciclo de import é sintoma, não obstáculo: se `A` e `B` não podem se importar mutuamente, a fronteira está no lugar errado. Mova o tipo compartilhado para dentro (`domain`), não crie um alias para calar o compilador.
- Troca de infraestrutura é o teste final: se substituir o banco exige tocar em `service`, `handler` ou `dto`, a arquitetura falhou. No `jpag`, trocar PostgreSQL por DynamoDB deve mexer **só** em `repository`.

### O que a arquitetura compra

Independência de framework, de banco, de UI e de serviço externo — e, principalmente, **testabilidade sem infraestrutura**. Regra de negócio se testa com fake em memória, em milissegundos. Se testar uma regra exige subir container, a fronteira está errada.

---

## 3. Quando os dois conflitam

Clareza vence esperteza. Uma abstração a mais que ninguém entende é pior que uma repetição que todo mundo lê. Se a aplicação de um padrão está deixando o código mais difícil de entender, o padrão está sendo mal aplicado — não é o entendimento que precisa subir.
