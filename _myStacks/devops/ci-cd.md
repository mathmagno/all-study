# CI/CD — Do Commit ao Deploy Confiável

> **TL;DR:** Pipeline bom não é uma sequência de comandos verdes; é uma cadeia de evidência. O mesmo commit passa por testes, gera um artefato imutável, é promovido entre ambientes e pode ser interrompido ou revertido sem improviso. Velocidade vem de lotes pequenos e feedback rápido.

**Conecta com:** [git.md](git.md) · [docker.md](docker.md) · [infraestrutura-como-codigo.md](infraestrutura-como-codigo.md) · [kubernetes.md](kubernetes.md) · [aws-infraestrutura.md](../aws/aws-infraestrutura.md) · [seguranca-da-informacao.md](../seguranca/seguranca-da-informacao.md)

---

## 1. CI, entrega e implantação não são a mesma coisa

| Prática | Promessa | Termina onde |
|---|---|---|
| Continuous Integration | toda mudança integra e recebe feedback frequente | build/teste/artefato |
| Continuous Delivery | cada mudança aprovada **pode** ir a produção | produção pronta, gate pode ser humano |
| Continuous Deployment | cada mudança que passa os gates **vai** a produção | deploy automático |

CI exige integração pequena e frequente. Rodar pipeline em branch que vive três meses é “teste automatizado”, não integração contínua.

CD não significa ausência de controle. Significa controle codificado: revisão, testes, política, aprovação por ambiente quando o risco exige, observação e rollback. Deploy manual via SSH com checklist na cabeça não é mais seguro por ser lento.

## 2. A cadeia de confiança

```text
commit revisado
  → dependências travadas
  → testes e análise
  → build uma vez
  → artefato identificado por SHA/digest
  → scan/assinatura/proveniência
  → promoção do MESMO artefato
  → deploy gradual + health check
  → métricas confirmam ou rollback
```

Cada seta precisa ser rastreável. A pergunta operacional deve ter resposta em minutos:

```text
Qual commit? → quais testes? → qual digest? → quem aprovou?
→ onde foi implantado? → qual migração? → como está o SLO?
```

Se staging recompila `main` e produção recompila de novo, você validou artefatos diferentes. **Build once, promote many.**

## 3. Pipeline mínimo e ordem dos gates

Falhas baratas e rápidas primeiro:

```text
format/lint (segundos)
  → unit tests/typecheck (segundos/minutos)
  → build (minutos)
  → integration/contract tests
  → scan de artefato/IaC/dependência
  → deploy em ambiente
  → smoke test
```

Jobs independentes rodam em paralelo; deploy espera todos. Um pipeline de 40 minutos reduz frequência, aumenta lote e incentiva bypass. Meça duração e taxa de flake por etapa.

Nem todo teste entra no caminho crítico: suíte longa/e2e ampla pode rodar agendada, desde que um conjunto pequeno proteja os fluxos críticos antes do deploy. Flake não é “tente de novo até passar”; é bug no sistema de teste e destrói confiança.

## 4. GitHub Actions para o monorepo Go + React

Exemplo legível de CI. As majors refletem o ecossistema atual; em produção endurecida, fixe actions de terceiros/GitHub por **SHA completo** e deixe uma automação abrir PRs de atualização.

```yaml
name: ci

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6

      - uses: actions/setup-go@v6
        with:
          go-version-file: backend/go.mod
          cache-dependency-path: backend/go.sum

      - name: Format
        working-directory: backend
        run: test -z "$(gofmt -l .)"

      - name: Test
        working-directory: backend
        run: go test -race -count=1 ./...

      - name: Build
        working-directory: backend
        run: |
          mkdir -p ../out
          CGO_ENABLED=0 go build -trimpath -o ../out/api ./cmd/api

  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6

      - uses: pnpm/action-setup@v6
        with:
          version: "10"
          run_install: false

      - uses: actions/setup-node@v6
        with:
          node-version: "24"
          cache: pnpm
          cache-dependency-path: frontend/pnpm-lock.yaml

      - name: Install
        working-directory: frontend
        run: pnpm install --frozen-lockfile

      - name: Validate and build
        working-directory: frontend
        run: |
          pnpm lint
          pnpm test -- --run
          pnpm build

  image:
    if: github.event_name == 'push'
    needs: [backend, frontend]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - name: Build immutable image
        run: docker build --tag api:${{ github.sha }} ./backend
```

Adapte paths/scripts ao projeto; YAML copiado sem entender vira falsa segurança. O job de imagem real deve publicar no registry, registrar digest e scan. PR de código não confiável valida sem receber credencial de deploy.

## 5. Reprodutibilidade: lockfile, ambiente limpo e relógio parado

O runner começa limpo; isso revela dependência escondida na máquina do dev. Para o mesmo commit produzir o mesmo resultado:

- commite `go.sum` e lockfile do gerenciador JS;
- instale com modo frozen; atualização é PR explícito;
- fixe toolchain via `go.mod`, `.nvmrc`/config equivalente;
- não baixe `latest` sem digest/versão durante o build;
- remova timestamps/paths locais quando afetam binário (`-trimpath`, build determinístico possível);
- simule relógio/aleatoriedade em testes, não dependa da hora atual global.

Cache acelera download/build, mas **não é fonte de verdade**. Chave deriva de SO, toolchain e lockfile; cache miss deve apenas deixar lento, nunca quebrar. Se limpar cache “resolve”, há dependência não declarada.

## 6. Artefato imutável e proveniência

Identifique imagem pelo commit e promova pelo digest:

```text
registry.example/api:git-a84c2f1  → sha256:9f...c2
dev     usa sha256:9f...c2
staging usa sha256:9f...c2
prod    usa sha256:9f...c2
```

Tag é ponteiro mutável; digest identifica bytes. `latest` não responde qual versão roda e pode mudar entre pull e rollback.

Para risco relevante, gere:

- SBOM (componentes/versões);
- scan de vulnerabilidades do artefato final;
- proveniência ligando source, workflow e build;
- assinatura/verificação antes do deploy.

Scan não é oráculo: CVE sem caminho explorável pode ser menor que configuração pública errada; vulnerabilidade crítica explorável não pode ficar escondida em centenas de warnings. Defina SLA/exceção com dono e validade.

## 7. Segurança do workflow

Workflow executa código com acesso a repositório e, às vezes, produção. Trate como software privilegiado:

```yaml
permissions:
  contents: read
  id-token: write # apenas no job que troca OIDC por credencial cloud
```

- Permissões mínimas no nível do job; `id-token: write` permite pedir token OIDC, não concede cloud sozinho.
- Trust policy da AWS restringe organização/repositório, branch/workflow e environment.
- Use environment protegido para produção (reviewers, branch/tag permitido e secrets próprios).
- Prefira OIDC/credencial temporária a access key longa em secrets.
- Actions reutilizáveis são dependências executáveis: allowlist e SHA completo reduzem supply-chain risk.
- Não execute input de PR em shell sem quoting/validação (`title`, branch, comentário podem conter código).
- `pull_request_target` roda no contexto privilegiado do repositório base; não faça checkout/execute código do fork nesse contexto.
- Self-hosted runner acumula estado e alcança sua rede; isole/torne efêmero antes de usá-lo para PR não confiável.

Secret masking é uma camada de log, não proteção absoluta. Ferramenta maliciosa pode exfiltrar valor por rede/encoding. Dê ao job somente o segredo e o egress que precisa.

## 8. Separação entre CI e deploy

Não dê acesso a produção para todo job de teste. Separe workflows/jobs e confiança:

```text
PR (conteúdo não confiável)
  └── read-only: lint, testes, build descartável

main protegida
  └── publish: registry, sem acesso à aplicação

environment=production
  └── deploy: usa digest aprovado + role curta + gate
```

O evento de deploy deve referenciar artefato já produzido por commit protegido. Se workflow privilegiado aceita “qualquer tag informada” por usuário, valide que digest pertence ao pipeline/repositório esperado.

Use `concurrency` para serializar deploy do mesmo ambiente. Dois deploys simultâneos, especialmente com migration, criam estado impossível de raciocinar.

## 9. Migração de banco: o ponto sem rollback simples

Deploy de aplicação pode voltar para imagem anterior; schema/dados podem não. Faça mudança compatível em etapas:

```text
1. EXPAND: adiciona coluna/tabela/índice sem quebrar versão antiga
2. DEPLOY: código novo escreve/lê os dois formatos quando necessário
3. MIGRATE: backfill observável, em lotes e retomável
4. SWITCH: muda leitura após validar
5. CONTRACT: remove formato antigo em release posterior
```

Evite `rename/drop/not null` incompatível no mesmo deploy que começa a depender dele. Índice em tabela grande pode bloquear/consumir I/O; use estratégia online suportada e monitore.

Migration precisa de:

- versão e lock para não executar duas vezes;
- timeout e observabilidade;
- compatibilidade com instâncias antigas durante rolling deploy;
- backup/restore e plano de forward-fix;
- idempotência ou estado explícito para retomar backfill.

“Down migration” automática com perda de dados não é rollback. Frequentemente, rollback seguro é reimplantar código compatível e corrigir schema para frente.

## 10. Estratégias de deploy

| Estratégia | Como funciona | Custo/risco |
|---|---|---|
| Recreate | para antigo, sobe novo | simples; downtime |
| Rolling | troca instâncias gradualmente | barato; duas versões coexistem |
| Blue/green | ambiente novo recebe tráfego após validar | rollback rápido; capacidade duplicada |
| Canary | pequena fração recebe versão nova | detecta risco cedo; exige métricas/roteamento |

Rolling é bom default para API stateless com compatibilidade. Blue/green compra isolamento para mudança arriscada. Canary só funciona se você consegue comparar erro/latência/negócio do canário; mandar 5% e não observar nada é rollout lento, não controle de risco.

Feature flag separa **deploy** de **release**, útil para mudança incompleta/experimento. Flag precisa de dono, default seguro, telemetria e data de remoção; dezenas de combinações antigas viram outro sistema de configuração.

## 11. Health checks, smoke e verificação

Pipeline não termina quando API de deploy responde “accepted”. Espere rollout e verifique:

```text
readiness saudável
  → targets antigos drenados sem erro
  → smoke: login/endpoint crítico com dado controlado
  → 5xx, p99, saturação e métrica de negócio dentro do baseline
  → marcar deploy concluído
```

- **Startup:** processo terminou inicialização?
- **Readiness:** pode receber tráfego agora?
- **Liveness:** está irrecuperavelmente travado e precisa reiniciar?

Não faça liveness depender de banco/terceiro; uma falha externa reiniciaria todas as instâncias e ampliaria o incidente. Smoke deve ser seguro, repetível e distinguível nos logs.

## 12. Rollback automático e humano

Defina antes do deploy:

- quais métricas/limiares abortam;
- janela suficiente para sinal aparecer;
- quem pode parar/promover;
- qual digest anterior é conhecido como bom;
- como schema/flag/dependência se comporta ao voltar.

Rollback automático é adequado para regressão clara (crash, health falhando, 5xx explode). Métrica de negócio ambígua pede humano; automação oscilando entre versões pode piorar incidente.

Botão de rollback deve **promover o digest anterior**, não reconstruir commit antigo com dependências atuais. Registre motivo e abra investigação; rollback restaura serviço, não explica causa.

## 13. Ambientes e testes realistas

Ambiente só ajuda se responde a uma pergunta:

- preview por PR para UI/integração isolada;
- staging para ensaio operacional/contrato externo;
- produção para tráfego real com rollout controlado.

Staging nunca replica perfeitamente volume, dados e integrações de produção. Não transforme a aprovação manual “funcionou no staging” em única garantia. Testes de contrato, migrations compatíveis, canary e observabilidade fecham lacunas diferentes.

Dados de produção não devem ser copiados crus para staging. Use dado sintético ou anonimização verificável, acesso mínimo e retenção.

Preview environment tem custo e superfície: TTL/cleanup automático, namespace/conta isolado e nenhum segredo de produção.

## 14. Observabilidade do próprio pipeline

Meça engenharia e confiabilidade:

| Métrica | Pergunta |
|---|---|
| tempo até feedback | dev descobre erro antes de mudar de contexto? |
| duração p95 do pipeline | qual etapa domina? |
| taxa de flake/retry | podemos confiar no vermelho/verde? |
| frequência de deploy | lotes estão pequenos? |
| lead time | quanto commit espera até produção? |
| change failure rate | quantos deploys exigem correção/rollback? |
| tempo de recuperação | rollback/runbook funciona? |

O objetivo não é maximizar deploys isoladamente. Frequência + baixo lote + baixa falha + recuperação rápida indicam sistema saudável. Gamificar uma métrica cria atalho.

## 15. ⚠️ Over-engineering e antipadrões

| Sintoma | Problema | Alternativa |
|---|---|---|
| 25 stages sequenciais | feedback lento | gates rápidos/paralelos por risco |
| e2e para toda regra | lento e frágil | unit/integração/contrato + poucos e2e |
| recompilar por ambiente | artefato diferente | promover mesmo digest |
| deploy por SSH de notebook | sem rastreabilidade | pipeline + role temporária |
| segredo global para todos jobs | blast radius | permissão/job/environment mínimos |
| canary sem métrica | risco apenas demora | rolling ou canary observado |
| retry até teste passar | CI verde mentiroso | corrigir/quarentenar flake com dono |
| rollback sem pensar no banco | versão antiga incompatível | expand-contract |

## 16. Checklist CI/CD

- [ ] PR pequeno integra frequentemente e exige CI verde/review
- [ ] Pipeline falha rápido, paraleliza jobs independentes e mede flakes
- [ ] Toolchains e dependências estão travadas; cache nunca é fonte de verdade
- [ ] Um commit gera um artefato imutável promovido por digest
- [ ] Actions/dependências de workflow são permitidas e fixadas por SHA no ambiente endurecido
- [ ] Jobs têm permissões mínimas; deploy usa OIDC e environment protegido
- [ ] Código de fork/PR não recebe nem executa com credencial de produção
- [ ] Migrações seguem expand → migrate → contract e toleram duas versões
- [ ] Deploy espera health/smoke/métricas, não apenas resposta da API
- [ ] Rollback promove artefato conhecido e considera schema/flags
- [ ] Deploys do mesmo ambiente são serializados e auditáveis
- [ ] Lead time, duração, flake, change failure rate e recuperação são acompanhados
