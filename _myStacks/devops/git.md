# Git — Histórico que Ajuda em vez de Atrapalhar

> **TL;DR:** Git é um grafo de snapshots, não um Google Drive de arquivos. Commits pequenos, intenção clara e integração frequente tornam mudança revisável, reversível e recuperável. Branch longa e commit gigante apenas adiam conflitos e escondem risco.

**Conecta com:** [ci-cd.md](ci-cd.md) · [infraestrutura-como-codigo.md](infraestrutura-como-codigo.md) · [docker.md](docker.md) · [startProjects.md](../startProjects.md) · [seguranca-da-informacao.md](../seguranca/seguranca-da-informacao.md)

---

## 1. O modelo mental: snapshots em um grafo

Cada commit guarda um snapshot do projeto, metadados e referência para seu(s) pai(s). O hash identifica esse conteúdo e sua história:

```text
A──B──C  main
    \
     D──E  feature/login
```

- **Branch:** ponteiro móvel para um commit; criar branch é barato.
- **HEAD:** o commit/branch em que você está.
- **Merge:** commit com duas histórias como pais, quando necessário.
- **Tag:** nome estável apontando para um commit, normalmente uma release.
- **Remote:** outro repositório e seus ponteiros conhecidos; `origin/main` não é atualizado magicamente — `fetch` atualiza sua visão.

Git armazena conteúdo alcançável pelo grafo. Isso explica por que apagar um arquivo em commit novo **não remove o segredo da história** e por que commits “perdidos” costumam ser recuperáveis pelo reflog.

## 2. As três áreas que evitam commits acidentais

```text
working tree ──git add──> staging/index ──git commit──> repositório local
     ▲                        │
     └────── git restore ─────┘
```

- **Working tree:** arquivos como estão no disco.
- **Staging area:** seleção exata do próximo commit.
- **Repositório local:** commits já gravados.

Fluxo de inspeção:

```bash
git status
git diff             # mudanças ainda não staged
git diff --staged    # exatamente o que entrará no commit
git add -p           # escolhe trechos, não o arquivo inteiro
git commit
```

`git add .` é conveniente, mas não substitui ler `git diff --staged`. O staging permite separar refactor e mudança de comportamento que aconteceram no mesmo arquivo.

## 3. Um commit deve contar uma decisão

Um bom commit é:

- **atômico:** faz uma mudança coerente;
- **compilável/testável:** não deixa o branch quebrado sem motivo;
- **reversível:** pode ser revertido sem desfazer três assuntos diferentes;
- **explicável:** mensagem registra o porquê, não repete o diff.

```text
feat(auth): rotaciona sessão após login

Evita session fixation ao invalidar o ID anônimo depois que a
identidade é confirmada. Mantém o carrinho associado à nova sessão.
```

O prefixo estilo Conventional Commits (`feat`, `fix`, `docs`, `refactor`, `test`, `chore`) é útil se o time automatiza changelog/release. ⚠️ Sem automação ou convenção compartilhada, discutir 20 tipos de prefixo é cerimônia; título imperativo e corpo claro já resolvem.

## 4. Fluxo diário seguro

```bash
# atualiza a visão do remoto sem alterar seu trabalho
git fetch origin

# parte de uma main atualizada
git switch main
git pull --ff-only
git switch -c feat/order-cancellation

# trabalha em mudanças pequenas
git add -p
git commit -m "feat(orders): adiciona transição para cancelled"

# publica e abre PR
git push -u origin feat/order-cancellation
```

`pull` combina fetch + integração. Usar `--ff-only` na `main` impede merge commit acidental local; na feature, escolha conscientemente merge ou rebase conforme a política do time.

Antes de trocar de contexto, prefira commit pequeno e marcado como rascunho em branch privada. `git stash` é útil para interrupção curta, mas vira gaveta esquecida; liste com `git stash list` e aplique/remova deliberadamente.

## 5. Branching: integração frequente vence árvore complexa

Para a maioria dos times de produto, **trunk-based com branches curtas**:

```text
main ──●────●────●────●────────► sempre implantável
        \ f1 /    \ f2 /
```

- branch dura horas ou poucos dias, não meses;
- PR pequeno e integração frequente;
- feature incompleta fica atrás de feature flag, não isolada por trimestre;
- release é um commit/tag, não um branch eterno para cada ambiente.

Branches longas acumulam **merge debt**: todos mudam as mesmas fronteiras sem feedback até a integração final. GitFlow pode fazer sentido para produto com versões instaladas e múltiplas linhas suportadas; para SaaS com deploy contínuo, geralmente adiciona filas e cherry-picks.

Ambiente não é branch: `develop`, `staging` e `production` divergindo significam que você testou um commit e publicou outro. Promova o **mesmo artefato/commit** por ambientes no pipeline.

## 6. Merge, rebase e squash

| Estratégia | Resultado | Use quando |
|---|---|---|
| merge commit | preserva topologia completa | branch compartilhada/história do agrupamento importa |
| rebase | reaplica commits sobre nova base, história linear | branch privada antes do PR |
| squash merge | PR vira um commit | commits de trabalho não têm valor individual |
| fast-forward | apenas move o ponteiro | não houve divergência |

```text
Antes:  A──B──C main       Rebase: A──B──C──D'──E'
             \
              D──E feature
```

Rebase **reescreve hashes**. Regra: rebaseie seu branch privado; não reescreva branch pública que outras pessoas já basearam trabalho. Se precisar atualizar uma feature compartilhada, merge explícito costuma ser menos surpreendente.

Depois de rebase em branch já publicada, `git push --force-with-lease` verifica se o remoto ainda está no ponto esperado. `--force` puro pode apagar commit novo de outra pessoa.

Squash não corrige PR grande: reduz commits, mas o revisor ainda precisa entender 2.000 linhas de uma vez. O remédio é reduzir o escopo.

## 7. Conflito é informação, não falha do Git

Conflito significa que duas mudanças tocaram intenção que o Git não consegue reconciliar sozinho:

```text
<<<<<<< HEAD
timeout := 2 * time.Second
=======
timeout := 5 * time.Second
>>>>>>> feat/retry-policy
```

Roteiro:

1. descubra o objetivo de **ambas** as mudanças; não escolha “ours” por reflexo;
2. edite o resultado final sem os marcadores;
3. rode testes/formatter — texto sem marcador ainda pode estar semanticamente errado;
4. `git add <arquivo>` e continue (`git rebase --continue` ou `git commit`);
5. se perdeu contexto, aborte com `git rebase --abort`/`git merge --abort` e converse.

Reduza conflitos com branches curtas, módulos bem definidos e commits que não misturam formatter global com feature. Git resolve linhas; o time resolve intenção.

## 8. Desfazer: escolha pelo que já foi compartilhado

| Situação | Comando/ação | Efeito |
|---|---|---|
| arquivo modificado, não staged | `git restore arquivo` | descarta mudança local |
| arquivo staged por engano | `git restore --staged arquivo` | tira do próximo commit, preserva conteúdo |
| último commit local, mensagem errada | `git commit --amend` | reescreve o commit |
| commits locais precisam ser reorganizados | `git rebase -i` | reordena/squasha/reformula |
| commit já está em branch compartilhada | `git revert <hash>` | cria commit inverso auditável |
| quer mover branch, preservar mudanças staged | `git reset --soft <alvo>` | reescreve ponteiro local |

**Regra de segurança:** se alguém pode ter consumido o commit, use `revert`. Ele preserva a história e o CI consegue auditar a correção.

`git reset --hard` descarta working tree e index; `git clean -fd` remove arquivos não rastreados. São ferramentas destrutivas: confira `status`, alvo e backup antes. Nunca copie comando de limpeza sem entender exatamente o que é alcançável depois.

## 9. Recuperação com reflog

O reflog registra onde referências locais estiveram:

```bash
git reflog --date=local
# 7ac1f42 HEAD@{0}: rebase (finish)
# e84bd10 HEAD@{1}: commit: implementa cancelamento

git show e84bd10
git branch recover/order-cancellation e84bd10
```

Esse procedimento cria um branch antes de tentar qualquer outra operação. Reflog é **local e temporário**: outro clone não conhece seus movimentos e objetos inalcançáveis são coletados com o tempo. Recuperabilidade não substitui push/backup.

Para descobrir quem introduziu uma linha, use `git blame` como índice para o commit e leia contexto com `git show`; não como ferramenta de culpa. Para achar o commit que introduziu regressão, `git bisect` faz busca binária entre versão boa e ruim — com teste automatizado, vira diagnóstico rápido.

## 10. Segredos: `.gitignore` não apaga história

```gitignore
# configuração local e credenciais
.env
.env.*
!.env.example

# build/dependências
node_modules/
dist/
bin/
coverage/

# ferramentas locais
.idea/
.vscode/
```

- Commite `.env.example` apenas com nomes/valores falsos.
- Se segredo entrou em um commit, **revogue/rotacione primeiro**. Reescrever história reduz exposição, mas não torna a credencial novamente segura: clones, caches e logs podem tê-la.
- Use secret scanning/pre-commit como camada adicional; revisão continua necessária.
- Não coloque `terraform.tfstate`, chave privada, token de cloud ou dump de produção no Git.

Arquivo já rastreado continua rastreado após entrar no `.gitignore`; remova apenas do index com `git rm --cached <arquivo>` e preserve a cópia local conforme necessário.

## 11. O que pertence ao repositório

Versione o que torna build e operação reproduzíveis:

- código, testes, migrations e documentação;
- lockfiles de dependências (`go.sum`, lockfile do gerenciador JS);
- Dockerfile, pipeline e IaC;
- configuração sem segredo e exemplos;
- runbooks próximos do componente.

Não versione artefato gerado reproduzível (`dist/`, binário), dependência baixada (`node_modules/`), log, cache ou dado pessoal. Exceção: código gerado que é parte deliberada do contrato e precisa ser revisado/distribuído — documente o gerador e valide que está atualizado no CI.

Binários grandes incham **todos** os clones porque vivem na história. Use object storage/release registry; Git LFS apenas quando o workflow realmente precisa versioná-los.

## 12. Pull request como unidade de risco

Um PR bom responde:

- **problema e motivação**;
- **o que mudou e o que ficou fora**;
- **como verificar** (testes, cenário manual, evidência);
- **risco, migração e rollback**;
- impacto de contrato, banco, segurança, observabilidade e custo.

Mantenha diff focado. Renomear 50 arquivos junto com regra crítica esconde a regra. Review aprova intenção e operação, não apenas sintaxe.

Proteja `main`: PR obrigatório, CI verde, revisão proporcional ao risco, conversa resolvida e branch atualizada conforme política. Para mudança sensível, exija CODEOWNERS/ambiente protegido. Administrador não deve ignorar gate por rotina.

## 13. Releases e rastreabilidade

```bash
git tag -a v1.4.0 -m "release v1.4.0"
git push origin v1.4.0
```

Tag anotada dá nome estável ao commit. O pipeline deve registrar:

```text
commit SHA → testes → digest da imagem → deploy por ambiente → resultado
```

Assim, “qual código está em produção?” tem resposta exata e rollback promove um artefato já testado — não recompila uma branch que pode ter mudado. Assinatura de commit/tag aumenta proveniência onde o threat model exige; não substitui proteção de conta, revisão e CI.

## 14. ⚠️ Antipadrões

| Antipadrão | Consequência | Correção |
|---|---|---|
| `commit final final 2` | intenção invisível | assunto + porquê |
| PR de milhares de linhas | review superficial | fatiar por comportamento |
| branch por meses | conflito e integração tardia | integrar pequeno/feature flag |
| force push em branch compartilhada | trabalho alheio apagado | revert/merge; lease em branch privada |
| ambiente como branch | commits diferentes por estágio | promover mesmo artefato |
| segredo “apagado” em commit novo | valor segue na história | revogar + limpar quando necessário |
| generated/binary sem política | repo lento e diff inútil | registry/LFS/regra explícita |

## 15. Checklist Git

- [ ] `git status` e `git diff --staged` revisados antes de cada commit
- [ ] Cada commit representa uma decisão testável e reversível
- [ ] Branch nasce atualizada e integra em horas/dias, não meses
- [ ] Rebase/force-with-lease restritos a branch privada
- [ ] Commit compartilhado é desfeito com `revert`, preservando auditoria
- [ ] Conflito resolvido pela intenção e validado por testes
- [ ] `.gitignore` cobre segredos, builds, caches e configuração local
- [ ] Segredo vazado é revogado; “apagar o arquivo” nunca é tratado como correção
- [ ] PR descreve risco, verificação, migração e rollback
- [ ] Commit SHA, artefato e deploy são rastreáveis de ponta a ponta
