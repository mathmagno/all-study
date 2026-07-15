# AWS — Custos sem Surpresa e FinOps para Engenheiros

> **TL;DR:** Cloud troca compra antecipada por uma torneira ligada. O custo nasce de quantidade × tempo × preço, mas as surpresas quase sempre vêm de recurso ocioso, tráfego, logs, cópias e falta de dono. Meça custo por unidade de negócio e otimize depois de proteger confiabilidade.

**Conecta com:** [aws-infraestrutura.md](aws-infraestrutura.md) · [aws-estimativa-usuarios-capacidade.md](aws-estimativa-usuarios-capacidade.md) · [system-design-fundamentos.md](../backend/system-design-fundamentos.md) · [escalabilidade-load-balancing.md](../devops/escalabilidade-load-balancing.md) · [infraestrutura-como-codigo.md](../devops/infraestrutura-como-codigo.md)

---

## 1. O modelo mental da fatura

Quase todo custo de cloud é variação de quatro unidades:

```text
Custo mensal ≈
  computação (quantidade × horas × tamanho)
  + armazenamento (GB-mês + operações)
  + banco/serviços gerenciados (capacidade × tempo + I/O)
  + rede (GB transferidos por origem/destino)
  + requests, logs, snapshots, suporte e impostos aplicáveis
```

“Serverless” não significa grátis; significa pagar por uso em vez de servidor provisionado. “Gerenciado” não significa mais barato por unidade; significa comprar operação, patching e disponibilidade junto com o recurso.

Preço isolado também não decide arquitetura. Uma solução mais barata na fatura pode custar mais em horas de engenharia, incidentes e perda de receita. O objetivo é **menor custo total para o nível de serviço exigido**, não a menor linha no Cost Explorer.

## 2. Visibilidade vem antes de otimização

Sem atribuição, a pergunta “quem gerou este custo?” vira investigação manual. Defina tags desde a infraestrutura como código:

| Tag | Exemplo | Pergunta respondida |
|---|---|---|
| `project` | `checkout` | qual produto consome? |
| `environment` | `prod` | é produção ou experimento? |
| `owner` | `team-payments` | quem decide/recebe alerta? |
| `cost-center` | `cc-042` | quem paga? |
| `managed-by` | `terraform` | pode alterar manualmente? |
| `expires-at` | `2026-08-01` | recurso temporário já venceu? |

Ative as **cost allocation tags** necessárias; apenas colocar tag no recurso não garante que ela apareça retroativamente nos relatórios. Em organizações maiores, contas separadas por ambiente/unidade dão uma fronteira de custo mais forte que tags sozinhas.

Ferramentas com papéis diferentes:

- **Cost Explorer:** explorar histórico, tendência e dimensão que cresceu.
- **AWS Budgets:** alertar valor real ou previsto contra um limite planejado.
- **Cost Anomaly Detection:** detectar padrão incomum; não é bloqueio em tempo real e pode haver atraso nos dados de cobrança.
- **Cost and Usage Report/Data Exports:** granularidade para análise própria quando Cost Explorer não basta.
- **Pricing Calculator:** estimar antes de criar; depois substitua hipótese por uso real.

## 3. Orçamento é guardrail, não disjuntor

Crie alertas em camadas, por exemplo 50%, 80%, 100% e previsão acima do orçamento. Envie ao dono técnico e ao responsável financeiro — email ignorado não é controle.

```text
Mudança de custo detectada
  → qual serviço/conta/tag cresceu?
  → volume de negócio também cresceu?
      sim: custo por unidade melhorou ou piorou?
      não: vazamento, ociosidade, bug ou alteração de preço/configuração
  → mitigar com segurança
  → registrar causa e prevenção
```

⚠️ Não automatize “desligar tudo ao atingir R$ X” em produção. Dados de billing não são instantâneos e desligamento abrupto pode causar perda muito maior. Ações automáticas servem para sandbox/recursos explicitamente descartáveis; produção exige runbook e autoridade claras.

## 4. Compute: pague pelo perfil real de carga

| Perfil | Opção inicial | Alavanca principal |
|---|---|---|
| API 24×7 previsível | ECS/EC2/Fargate | right-sizing e compromisso após medir |
| Função/evento muito intermitente | Lambda | paga por uso e pode escalar a zero, dentro dos limites |
| Web app gerenciada | App Runner | autoscaling acima da capacidade mínima configurada |
| Worker tolerante a interrupção | EC2 Spot/Fargate Spot | checkpoint, retry e idempotência |
| Carga estável por meses | On-Demand primeiro | Savings Plans/Reserved após baseline |

**Right-sizing:** CPU média de 5% não prova sozinha que pode reduzir; verifique p95/p99, memória, throttling, rede, latência e pico. Para API, o limite pode ser conexões ao banco antes de CPU.

**Desligar fora do horário:** excelente para dev/staging e runners; perigoso para componentes com estado ou tarefas agendadas não mapeadas. Marque explicitamente o que é descartável e automatize ligar também.

**Autoscaling:** reduz ociosidade apenas se `min`, `max`, métrica e tempo de aquecimento fizerem sentido. Escalar por CPU uma aplicação limitada por banco não resolve o gargalo e pode multiplicar conexões até derrubá-lo.

## 5. Banco: a linha que cresce sem fazer barulho

RDS combina cobrança de instância, armazenamento, I/O conforme opção, backups além da franquia aplicável e transferência. Custos comuns:

- instância superdimensionada “para garantir”;
- Multi-AZ em todos os ambientes, mesmo quando o downtime de dev não importa;
- read replica criada antes de medir queries;
- snapshots antigos e bancos órfãos após testes;
- storage crescendo por logs/tabelas sem retenção;
- I/O alto causado por falta de índice ou query N+1.

Ordem de otimização segura:

1. medir queries (`pg_stat_statements`, slow queries, `EXPLAIN ANALYZE`);
2. corrigir índices, N+1 e retenção;
3. limitar pool de conexões e revisar capacidade;
4. right-size com margem para pico e manutenção;
5. cache/read replica somente para gargalo de leitura comprovado.

Não economize removendo backup, criptografia ou recuperação exigida. Multi-AZ compra disponibilidade; read replica compra leitura. Remover uma sem entender o requisito troca fatura por incidente.

## 6. Storage: GB-mês é só parte da conta

| Serviço/uso | O que costuma cobrar | Otimização saudável |
|---|---|---|
| S3 | GB-mês, requests, retrieval e saída | lifecycle por acesso/retenção |
| EBS | volume provisionado e snapshots | apagar órfãos, dimensionar IOPS/capacidade |
| ECR | imagens armazenadas e transferência | lifecycle preservando releases úteis |
| CloudWatch Logs | ingestão, armazenamento e consultas | nível correto, amostragem e retenção |

Lifecycle não é “apagar tudo em 30 dias”. Classifique o dado: operacional, auditoria, backup, artefato ou temporário. Cada classe tem retenção, recuperação e restrições próprias. Arquivo em classe fria pode ter custo/tempo de retrieval; use para dado realmente frio.

## 7. Rede: o custo invisível no diagrama

Transferência deve ser estimada por **origem → destino**, não apenas “quantos GB”. Pontos que mordem:

- saída da AWS para internet;
- tráfego entre Regions;
- tráfego entre AZs em certos caminhos/serviços;
- NAT Gateway: horas + bytes processados;
- processamento por load balancer e endpoints, conforme serviço;
- replicação, backup e observabilidade atravessando fronteiras.

Exemplo de desperdício arquitetural:

```text
task privada → NAT Gateway → endpoint público do S3
```

Um VPC endpoint para S3 pode evitar o caminho pelo NAT. Mas endpoint também pode ter preço/complexidade conforme tipo: compare volume e requisito em vez de adicionar todos preventivamente.

Para conteúdo estático/global, CloudFront reduz latência e pode reduzir tráfego repetido no origin. Cache correto vem antes de instância maior: assets com hash e `immutable`, HTML revalidável, API privada jamais em cache compartilhado por engano.

## 8. Logs, métricas e segurança também precisam de orçamento

Observabilidade ilimitada pode virar uma das maiores linhas:

- log de debug em produção;
- payload inteiro, token ou PII em cada request (caro **e** inseguro);
- métricas com labels de alta cardinalidade (`user_id`, `request_id`);
- traces de 100% das requisições sem necessidade;
- retenção “never expire”.

Use nível estruturado, redaction, retenção por ambiente, sampling e métricas agregadas. Não “economize” desligando os sinais que permitem detectar falha; reduza ruído e cardinalidade.

Segurança também tem custo visível — WAF, KMS, Secrets Manager, logs — e custo evitado. Compare com ameaça e impacto. Controle barato e obrigatório (MFA, menor privilégio, patching, backup) não depende de escala.

## 9. Modelos de compra: desconto vem depois do baseline

- **On-Demand:** flexibilidade máxima; use enquanto a carga muda e você aprende.
- **Savings Plans/Reserved:** compromisso em troca de desconto; adequado à parcela estável, não ao pico inteiro.
- **Spot:** capacidade interrompível; ótima para workers idempotentes, batch e CI que toleram recomeçar.

```text
carga total = baseline estável + variação previsível + pico imprevisível
              compromisso          On-Demand          autoscaling/Spot*
```

`*` Spot apenas onde interrupção é suportada.

Comprar compromisso para 100% do pico transforma desconto em ociosidade. Calcule cobertura e utilização; revise quando arquitetura/Region/tipo de compute mudar. “Economizei 30% no preço por hora” não ajuda se metade das horas não entrega trabalho.

## 10. Custo por unidade: a métrica que conecta infra ao negócio

Fatura absoluta cresce quando o produto cresce. A pergunta melhor é se cresce **mais rápido que o valor**:

```text
custo por usuário ativo = custo mensal da plataforma / MAU
custo por pedido        = custo do domínio checkout / pedidos concluídos
custo por 1.000 requests = custo atribuível da API / requests × 1.000
```

Exemplo: custo sobe de 1.000 para 1.500, mas pedidos sobem de 10 mil para 20 mil. A fatura cresceu 50%; o custo por pedido caiu de 0,10 para 0,075 na mesma moeda. Isso pode ser uma vitória.

Defina também margem bruta/SLO. Reduzir custo por request enquanto p99 piora e conversão cai é otimização local que destrói resultado global.

## 11. Estimativa antes do deploy

Para cada componente, documente hipótese e fórmula:

| Componente | Driver | Hipótese que precisa ser validada |
|---|---|---|
| API | task-horas/requests | RPS sustentável por task no p99 alvo |
| RDS | tamanho/horas/I/O | working set, conexões e queries |
| S3 | GB-mês + operações | tamanho e retenção por objeto |
| CloudFront | requests + GB | cache hit ratio e geografia |
| SQS/Lambda | mensagens/invocações | batch size, retry e duração |
| Logs | GB ingeridos/retidos | bytes por request × volume |

Faça três cenários: **base**, **pico** e **crescimento 10×**. A estimativa exata é impossível; a ordem de grandeza e a variável dominante são suficientes para impedir decisões absurdas. O método completo está em [aws-estimativa-usuarios-capacidade.md](aws-estimativa-usuarios-capacidade.md).

## 12. Rotina FinOps que cabe num time pequeno

### Toda semana

- olhar anomalias e tendência por serviço/ambiente;
- apagar recursos temporários vencidos e investigar crescimento sem dono;
- confirmar que nenhuma credencial/ataque está gerando uso inesperado.

### Todo mês

- custo por unidade e comparação com previsão;
- top 5 linhas e top 5 variações, não 200 otimizações pequenas;
- right-sizing com métricas de pico;
- snapshots, volumes, IPs, imagens e logs órfãos;
- cobertura de compromissos e uso de Spot onde seguro.

### A cada mudança relevante

- atualizar estimativa e tags no pull request de IaC;
- explicitar impacto mensal aproximado e mecanismo de rollback;
- verificar rede/egress — o item mais esquecido.

## 13. ⚠️ “Economias” que saem caras

| Atalho | Risco | Alternativa |
|---|---|---|
| sem backup para poupar | perda irreversível | retenção proporcional + restore testado |
| uma AZ para sistema crítico | falha de instalação derruba tudo | justificar Multi-AZ pelo impacto |
| Spot para banco/API sem tolerância | interrupção do serviço | Spot em worker idempotente |
| reduzir log até ficar cego | MTTR alto e fraude invisível | retenção/sampling/redaction |
| instância mínima sem teste | throttling e p99 ruim | load test + margem |
| compromisso longo cedo demais | capacidade presa/ociosa | medir baseline por alguns ciclos |
| otimizar 3% sem dono | horas de engenharia maiores | atacar top custos e custo/unidade |

## 14. Checklist de custos AWS

- [ ] Tags de projeto, ambiente, owner e cost center definidas por IaC e ativadas para alocação
- [ ] Budget e detecção de anomalia chegam a alguém que age
- [ ] Estimativa base/pico/10× inclui compute, banco, storage, rede, logs e backups
- [ ] Dev/staging desligam quando seguro; recurso temporário tem expiração/dono
- [ ] RDS otimizado por queries/índices antes de réplica ou classe maior
- [ ] NAT, tráfego inter-AZ/Region e egress revisados explicitamente
- [ ] Logs têm nível, redaction, sampling e retenção deliberados
- [ ] Compromissos cobrem somente baseline estável; Spot somente trabalho interrompível
- [ ] Custo por unidade de negócio é acompanhado junto com SLO
- [ ] Economia nunca remove controle exigido de segurança, backup ou recuperação
