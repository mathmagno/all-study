# Infraestrutura como Código — Mudanças Repetíveis, Revisáveis e Recuperáveis

> **TL;DR:** IaC transforma infraestrutura em mudança de software: declarada, versionada, revisada, testada e aplicada por um processo único. O arquivo não é a verdade sozinho — configuração, state e recursos reais formam o sistema. Proteja os três.

**Conecta com:** [git.md](git.md) · [ci-cd.md](ci-cd.md) · [aws-infraestrutura.md](../aws/aws-infraestrutura.md) · [aws-custos.md](../aws/aws-custos.md) · [seguranca-da-informacao.md](../seguranca/seguranca-da-informacao.md) · [kubernetes.md](kubernetes.md)

---

## 1. O problema que IaC resolve

Infra criada por clique tende a virar conhecimento tribal:

```text
“funciona em produção”
  → ninguém sabe todas as opções escolhidas
  → staging diverge
  → recuperação depende da memória de alguém
  → auditoria não explica quem mudou o quê e por quê
```

Com IaC, uma mudança passa por diff, revisão, plano e histórico. Isso compra:

- **repetibilidade:** outro ambiente nasce da mesma definição;
- **rastreabilidade:** commit/PR explica a decisão;
- **detecção de drift:** realidade diferente do código aparece no plan;
- **recuperação:** infraestrutura pode ser recriada, respeitando dados/state;
- **guardrails:** validações e políticas antes da API da cloud.

IaC não torna uma arquitetura boa, nem torna toda mudança reversível. Um `apply` declarativo ainda pode apagar banco, trocar subnet ou revogar acesso. Automação aumenta tanto segurança quanto velocidade do erro.

## 2. Declarativo: estado desejado, não receita de cliques

```hcl
resource "aws_s3_bucket" "assets" {
  bucket = "${var.project}-${var.environment}-assets"

  tags = {
    project     = var.project
    environment = var.environment
    managed-by  = "terraform"
  }
}
```

Você declara **o que deve existir**. A ferramenta lê configuração + state + APIs reais, calcula a diferença e propõe ações:

```text
configuração desejada ─┐
state (mapeamento) ─────┼──> plan: + criar  ~ alterar  - destruir  -/+ substituir
recursos reais ─────────┘                         │
                                                 └──> apply
```

Idempotência é o objetivo: aplicar novamente sem mudança deve produzir “no changes”. Se todo plan altera tags/timestamps sem razão, há dado instável ou provider/configuração mal modelados.

## 3. Ferramenta: escolha o ecossistema que o time opera

| Ferramenta | Modelo | Boa quando | Trade-off |
|---|---|---|---|
| Terraform | HCL + providers + state | multi-cloud/ecossistema maduro | licença/produto e state exigem decisão operacional |
| OpenTofu | HCL compatível + state | preferência por projeto open source | valide compatibilidade de providers/features/migração |
| CloudFormation | declarativo nativo AWS | AWS-only e integração nativa | sintaxe/feedback e portabilidade |
| CDK | código gera CloudFormation | time quer abstrações na linguagem | abstração pode esconder diff gerado |
| Pulumi | linguagens gerais + state | lógica/tipos na linguagem do time | poder extra permite complexidade extra |

O princípio importa mais que a marca: uma fonte de mudança, plan revisado, state protegido, credencial temporária e reconciliação de drift. Não mantenha Terraform **e** CloudFormation gerenciando o mesmo recurso.

Este guia usa Terraform/OpenTofu porque o modelo torna os conceitos explícitos. Os comandos `terraform` têm equivalentes `tofu`.

## 4. Estrutura antes de módulos “plataforma”

Uma estrutura legível para poucos ambientes:

```text
infra/
├── modules/
│   ├── web-service/
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   └── network/
└── live/
    ├── dev/
    │   ├── main.tf
    │   ├── backend.hcl
    │   └── terraform.tfvars
    └── prod/
        ├── main.tf
        ├── backend.hcl
        └── terraform.tfvars
```

Ambientes têm **states separados** e permissões separadas. Compartilham módulos, não o mesmo state com condicionais por toda parte. Um erro em dev não deve poder destruir prod.

Workspaces podem separar instâncias equivalentes, mas o nome do workspace não cria isolamento de IAM, conta ou revisão. Para produção, diretório/root module + backend + credenciais explícitos costumam ser mais auditáveis.

## 5. Versões e lockfile: build de infra também precisa ser reproduzível

```hcl
variable "aws_region" {
  type = string
}

locals {
  common_tags = {
    managed-by = "terraform"
  }
}

terraform {
  required_version = ">= 1.10, < 2.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = local.common_tags
  }
}
```

Os números são exemplo, não recomendação eterna: escolha a versão suportada no projeto, revise changelog e atualize deliberadamente. Commite `.terraform.lock.hcl` para fixar versões/checksums selecionados. Não commite `.terraform/`, state nem plan binário.

`~>` permite atualizações compatíveis dentro do intervalo escolhido; pin exato congela correções até intervenção manual. Automação de dependências pode abrir PR, mas plan e release notes continuam necessários.

## 6. Exemplo AWS mínimo e autocontido

```hcl
variable "project"     { type = string }
variable "environment" { type = string }

resource "aws_s3_bucket" "assets" {
  bucket = "${var.project}-${var.environment}-assets"
}

resource "aws_s3_bucket_public_access_block" "assets" {
  bucket = aws_s3_bucket.assets.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "assets" {
  bucket = aws_s3_bucket.assets.id

  versioning_configuration {
    status = "Enabled"
  }
}

output "assets_bucket_name" {
  description = "Bucket privado usado como origin do CloudFront."
  value       = aws_s3_bucket.assets.id
}
```

Referências entre recursos criam dependência no grafo; não escreva ID na mão nem use `depends_on` quando uma referência já expressa a relação. Falta ainda definir lifecycle, policy/OAC, observabilidade e custo conforme o uso — snippet não é arquitetura completa.

## 7. State: o arquivo mais sensível da infraestrutura

State mapeia endereços do código para IDs reais e pode conter atributos sensíveis. Perder state não apaga recursos, mas perde o mapa; vazar state pode vazar segredo.

Em equipe, use backend remoto com:

- criptografia em trânsito e repouso;
- versionamento/recuperação;
- acesso mínimo e auditoria;
- **locking** para impedir dois writers;
- state distinto por ambiente/componente com ciclo de vida independente.

Exemplo atual do backend S3:

```hcl
terraform {
  backend "s3" {
    bucket       = "empresa-terraform-state"
    key          = "all-study/prod/terraform.tfstate"
    region       = "sa-east-1"
    encrypt      = true
    use_lockfile = true
  }
}
```

Ative versionamento e proteção no bucket. A configuração real de backend pode ser parcial/externa; não grave credenciais nela. No Terraform atual, S3 locking por `use_lockfile` é o caminho recomendado e o locking por DynamoDB está depreciado. OpenTofu também suporta S3 locking e ainda mantém DynamoDB; confirme a estratégia da ferramenta/versão escolhida. Ao migrar, coordene todos os runners para não ter mecanismos diferentes concorrendo.

O bucket/state precisa ser criado por um **bootstrap** pequeno e separado. IaC não consegue depender de um backend que ainda está tentando criar.

Nunca edite JSON do state. Use `import`, blocos `moved` e comandos `terraform state` com backup, revisão e janela adequados. `force-unlock` só quando você provou que não há apply ativo; remover lock de outro writer corrompe a coordenação.

## 8. Plan é a unidade de revisão

```bash
terraform fmt -check -recursive
terraform init -backend-config=backend.hcl
terraform validate
terraform plan -out=tfplan
terraform show tfplan
terraform apply tfplan
```

O PR deve destacar:

- quantos recursos cria/altera/destrói/substitui;
- mudança de rede/IAM/dado e exposição pública;
- custo recorrente aproximado;
- migração e dependências;
- como abortar/recuperar.

Aplicar o **plan salvo** garante que o apply executa aquelas ações, mas só por uma janela curta e controlada: plan inclui configuração/state/valores potencialmente sensíveis e fica obsoleto se realidade ou state mudarem. Nunca o commite ou publique como artefato acessível a todos.

Plan de PR é normalmente especulativo. Depois da aprovação/merge, gere e revise o plan final no contexto de produção antes de aplicar.

## 9. Pipeline de infraestrutura

```text
Pull request
  → fmt + validate + lint/security/policy
  → init sem poder de escrita amplo
  → plan de prod comentado no PR
  → revisão de código + owner do ambiente

main aprovada
  → autenticação OIDC temporária
  → plan final e gate de ambiente
  → apply serializado
  → smoke check + registro do resultado
```

- PR vindo de fork/código não confiável não recebe credencial de produção.
- Role de plan pode ser read-only quando providers/recursos permitirem; role de apply tem apenas ações necessárias.
- Ambiente de produção exige aprovação e concorrência `1` por state.
- OIDC elimina access key permanente no CI, mas a trust policy precisa restringir repositório, branch/workflow e ambiente.
- Saída do plan/log pode conter dado sensível; trate como artefato protegido.

Detalhes de gates, proveniência e deploy em [ci-cd.md](ci-cd.md).

## 10. Segredos: `sensitive` não significa “fora do state”

```hcl
variable "db_password" {
  type      = string
  sensitive = true
}
```

`sensitive = true` normalmente **redige a UI/CLI**, mas o valor ainda pode estar em state/plan. Prefira criar/referenciar um segredo no Secrets Manager/Parameter Store e dar à aplicação permissão para lê-lo em runtime, em vez de fazer IaC transportar o valor.

No Terraform, valores `ephemeral` exigem 1.10+ e argumentos write-only exigem 1.11+ **e suporte do provider**; no OpenTofu, confirme a versão/recurso equivalente adotado. Eles evitam persistência somente nos casos suportados e não corrigem segredo já gravado em snapshots anteriores.

Credenciais do provider vêm de OIDC/role/ambiente, nunca de `provider "aws" { access_key = ... }`. Proteja state como segredo mesmo que você ache que não colocou senha: providers podem registrar valores inesperados.

## 11. Módulos: abstraia uma decisão repetida

Um módulo saudável representa uma unidade arquitetural coerente (`web-service`, `network`), tem inputs pequenos, outputs necessários, exemplos e versões. Um módulo ruim recebe 80 booleans e tenta construir qualquer sistema possível.

Crie módulo quando:

- o mesmo conjunto se repete com política comum;
- a abstração reduz decisões perigosas;
- há dono e contrato de versão.

Não crie wrapper para cada resource apenas para “padronizar”. Comece explícito; extraia depois da segunda/terceira repetição. Mantenha árvore relativamente plana e componha módulos no root.

Módulo remoto deve ser fixado a versão imutável. Atualização de módulo é mudança de infraestrutura: leia plan e changelog; não siga branch `main` silenciosamente.

## 12. Drift, import e refactor sem recriar o mundo

**Drift** é realidade diferente da configuração/state, geralmente por clique manual, automação paralela ou incidente. Rode `plan` periódico e defina resposta:

```text
mudança manual era emergência válida?
  sim → codificar/importar a decisão e revisar
  não → reconciliar pelo pipeline
```

Não deixe o console ser um segundo caminho permanente. Em incidente, mudança manual pode ser necessária; registre, estabilize e faça backport para IaC imediatamente.

Para adotar recurso existente, declare-o e use bloco/comando de import; confira o plan até não propor recriação inesperada. Para renomear endereço/mover para módulo, use bloco `moved`:

```hcl
moved {
  from = aws_s3_bucket.assets
  to   = module.assets.aws_s3_bucket.this
}
```

Sem isso, um refactor de código pode parecer `destroy + create` de recurso stateful.

## 13. Mudanças destrutivas e dados

Leia com atenção símbolos de replacement. Trocar nome, subnet, engine ou argumento imutável pode forçar recriação.

Controles úteis:

- `prevent_destroy` em recursos críticos como última barreira, não única proteção;
- deletion protection/versioning/backups no próprio serviço;
- política que bloqueia destroy amplo sem aprovação;
- `create_before_destroy` quando nomes/cotas/dependências permitem;
- migração expand → copiar/validar → cortar tráfego → remover antigo.

`-target` quebra a visão completa do grafo e pode deixar mudanças necessárias para trás; reserve para recuperação excepcional. `-auto-approve` é apropriado só quando aprovação já aconteceu em outro gate e o plan exato está controlado.

Rollback de IaC nem sempre é “reverter commit”: se apply destruiu dado, código anterior não o ressuscita. A recuperação vem de backup, versionamento, réplica e procedimento testado.

## 14. Testes e políticas proporcionais ao risco

Camadas baratas primeiro:

1. `fmt` e `validate`;
2. lint e documentação de inputs/outputs;
3. scanners de configuração (IAM amplo, bucket público, criptografia ausente);
4. política organizacional para guardrails críticos;
5. testes de módulo em conta/sandbox isolada;
6. smoke/integração após apply.

Teste a propriedade, não a implementação inteira: “banco não é público”, “SG só aceita API”, “tags obrigatórias existem”. Snapshot gigante do JSON do plan fica frágil e ensina o time a ignorar diff.

Inclua estimativa de custo no PR quando a mudança adiciona recurso recorrente, NAT/egress, banco, retenção ou capacidade. Política automática auxilia; o dono ainda explica o valor.

## 15. ⚠️ Over-engineering em IaC

| Sintoma | Alternativa pragmática |
|---|---|
| módulo universal com dezenas de flags | módulos pequenos/opinativos ou recurso explícito |
| uma state para a empresa inteira | separar por ambiente/ciclo/blast radius |
| state por cada resource | agrupar o que muda e falha junto |
| gerar HCL com três templates | HCL direto e legível |
| pipeline com apply em todo PR | plan no PR; apply após gate/merge |
| política bloqueando tudo sem escape | poucos guardrails críticos + processo de exceção |
| duas ferramentas no mesmo recurso | um único owner/control plane |
| importar tudo antes de entender | adotar por domínio e validar plan vazio |

## 16. Checklist de IaC

- [ ] Configuração, lockfile e módulos estão no Git; state/plan/.terraform não
- [ ] Ambientes críticos têm state, conta/credenciais e permissões separados
- [ ] Backend remoto usa criptografia, versionamento, acesso mínimo e locking
- [ ] `fmt`, `validate`, scanner e plan rodam em todo PR
- [ ] Apply usa plan final revisado, é serializado por state e deixa auditoria
- [ ] CI autentica por OIDC/credencial temporária; fork não recebe segredo
- [ ] Segredos são referenciados em runtime; state e plan são tratados como sensíveis
- [ ] Módulos abstraem decisões repetidas e têm versão, docs e owner
- [ ] Drift tem detecção e mudança emergencial recebe backport
- [ ] Import/movimento usa mecanismos próprios sem editar state na mão
- [ ] Destroy/replacement de recurso stateful exige backup, migração e aprovação
- [ ] Cada recurso novo explicita segurança, observabilidade, custo e recuperação
