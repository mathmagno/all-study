---
name: codigo-limpo
description: Aplica o harness executável de Código Limpo do ecosystem-jotaja. Use antes de implementar, alterar, corrigir, refatorar ou revisar código Go, TypeScript ou TSX em jpag, lounge-jotaja, jotaja-cs-platform ou jotaja-import-local; também use ao revisar diff, commit ou PR desses projetos.
---

# Código Limpo

Execute este fluxo antes de escrever código. Não replique as regras detalhadas
aqui: a fonte canônica é o
[harness](references/codigo-limpo.md).

## 1. Carregar o contexto

1. Leia os
   [padrões de engenharia do ecosystem-jotaja](references/padroes-engenharia-ecosystem-jotaja.md)
   e o `CLAUDE.md` do repositório, se existir.
2. Leia no harness a tabela de severidade, o perfil do repositório e todas as
   seções relacionadas aos arquivos que serão tocados.
3. Em revisão ampla, refatoração transversal ou mudança com mais de uma camada,
   leia o harness inteiro.
4. Trate a seção 2, Clean Architecture, do `CLAUDE.md` central como fechada:
   aplique-a como critério, mas não a reescreva por causa desta skill.

## 2. Delimitar a mudança

1. Inspecione `git status`, o diff existente e o código adjacente.
2. Preserve alterações do usuário e não misture limpeza fora do escopo.
3. Identifique o perfil de idioma, as fronteiras externas e os comandos já
   instalados no repositório.
4. Liste antes do patch os riscos que podem bloquear merge: contrato público,
   dinheiro, erro, segurança, efeito colateral, regra duplicada e regressão sem
   teste quando há runner.

## 3. Projetar antes do patch

Para cada nome novo, responda qual papel ele representa. Para cada função nova
ou ampliada, responda qual é sua única responsabilidade. Para cada chamada que
pode falhar, defina contexto, causa preservada e tradução na borda. Para cada
valor monetário, defina a unidade no nome e no tipo.

Se a proposta já introduz um sinal classificado como bloqueio ou correção antes
do commit, corrija o desenho antes de editar.

## 4. Implementar

- Use nomes do domínio e da infraestrutura conforme o perfil do repositório.
- Não introduza abreviação privada, recipiente genérico que esconda o papel no
  escopo ou `any` na fronteira.
- Mantenha regra de negócio separada de transporte, persistência e serialização.
- Preserve a causa do erro; decida por sentinela, tipo ou `Result`.
- Não devolva detalhe de infraestrutura ao cliente e não engula erro.
- Modele dinheiro de domínio em centavos inteiros. Percentual é outra grandeza.
- Não extraia coincidência. Extraia regra repetida ou padrão confirmado pela
  terceira ocorrência e pela mesma razão de mudança.
- Adicione ou ajuste teste de comportamento quando o projeto já tiver runner.
- Use comentário para decisão, restrição, contrato externo ou incidente; não
  narre uma linha que já se explica.

## 5. Revisar o próprio diff

Leia o diff como revisor, não como autor. Para cada regra aplicável, registre o
sinal concreto e classifique:

- **bloqueia merge:** corrija antes de concluir;
- **corrige antes do commit:** corrija no patch atual;
- **regra do escoteiro:** não misture; proponha commit separado.

Não aceite uma violação porque já existe em outro arquivo. Também não amplie o
patch para limpar dívida que não foi tocada.

## 6. Verificar

1. Execute formatador, typecheck, lint, build e testes relevantes somente entre
   os comandos já disponíveis no projeto.
2. Comece pelo menor teste que cobre a mudança e amplie conforme o risco.
3. Não instale ferramenta para satisfazer o harness.
4. Se um comando não existir, depender de serviço externo ou não puder rodar,
   declare exatamente o que ficou sem verificação. Nunca presuma verde.

## 7. Entregar

Informe arquivos alterados, verificações executadas e resultado. Liste qualquer
dívida de escoteiro separadamente; não a apresente como parte concluída da
mudança funcional.

## Precedência

Em conflito, siga nesta ordem:

1. instrução explícita do usuário;
2. convenção de produto e stack do `CLAUDE.md` local;
3. guardrails e Clean Architecture do `CLAUDE.md` central;
4. harness de Código Limpo.

As resoluções locais já registradas no harness prevalecem sobre formulações
genéricas do livro: erro continua valor, DRY não é “a qualquer custo”, receivers
Go e abreviações consagradas são permitidos, e contratos externos mantêm seus
nomes na borda.
