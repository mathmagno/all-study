# AWS — De Usuários a Capacidade sem Chute

> **TL;DR:** Usuários não dimensionam servidor diretamente. Converta comportamento em requests, pico, concorrência, bytes, linhas, conexões e jobs; depois meça quanto uma unidade real suporta no SLO desejado. A conta reduz ordens de grandeza erradas — o load test fecha a decisão.

**Conecta com:** [system-design-fundamentos.md](../backend/system-design-fundamentos.md) · [escalabilidade-load-balancing.md](../devops/escalabilidade-load-balancing.md) · [aws-infraestrutura.md](aws-infraestrutura.md) · [aws-custos.md](aws-custos.md) · [mensageria-filas.md](../devops/mensageria-filas.md) · [protocolo-http.md](../backend/protocolo-http.md)

---

## 1. A cadeia de conversão

```text
usuários ativos
  → ações por usuário
  → requests e jobs por ação
  → volume diário
  → RPS médio
  → RPS de pico + margem
  → concorrência, banda, storage e conexões
  → unidades de compute medidas em load test
```

“Temos 100 mil usuários” não diz quase nada: podem abrir o app uma vez por mês ou fazer streaming o dia inteiro. Comece por **DAU/MAU, frequência e comportamento**, não por cadastro total.

Toda estimativa deve registrar:

- fonte da hipótese (analytics, benchmark, entrevista ou chute explícito);
- intervalo possível, não só um número;
- SLO de latência/disponibilidade;
- data para comparar estimado × real.

## 2. Inputs mínimos

| Entrada | Exemplo | Por que importa |
|---|---|---|
| MAU / DAU | 500k / 100k | frequência real de uso |
| ações por DAU/dia | 10 jornadas | volume de negócio |
| requests por ação | 4 | fan-out do front/API |
| proporção leitura:escrita | 80:20 | pressão em cache/banco |
| request/response médios | 2 KB / 25 KB | rede e egress |
| padrão horário | pico 4× média | capacidade instantânea |
| latência alvo | p99 < 400 ms | throughput útil por instância |
| retenção | 1 ano | storage e backup |

Prefira medir payload compactado no caminho real. Um JSON de 25 KB no servidor pode sair menor com compressão; upload de imagem não. Média esconde outliers: limite payload máximo separadamente para evitar que uma requisição enorme consuma memória de todas.

## 3. DAU → requests por segundo

Exemplo completo para uma aplicação com 100 mil DAU:

```text
DAU                         = 100.000
ações por usuário/dia       = 10
requests de API por ação    = 4
requests/dia                = 100.000 × 10 × 4 = 4.000.000

RPS médio                   = 4.000.000 / 86.400 ≈ 46
fator de pico               = 4
RPS pico de usuários        = 46 × 4 ≈ 185
webhooks/jobs/API extra     = +20%
RPS de projeto              = 185 × 1,20 ≈ 222 RPS
```

Dimensionar pela média daria uma infraestrutura ~5× menor justamente no horário em que todos chegam. O fator de pico depende do produto: ferramenta de escritório concentra horário comercial; live commerce concentra minutos; serviço global pode ser mais uniforme. Extraia do analytics por janelas de 1 minuto, não invente `×4` para sempre.

**RPS não é usuários simultâneos.** Dez mil pessoas com a tela aberta e sem fazer request quase não pressionam a API; 500 clientes em loop podem derrubá-la.

## 4. Concorrência: Lei de Little na prática

Para um sistema estável:

```text
concorrência em voo ≈ throughput (req/s) × tempo no sistema (s)
```

Com 222 RPS e 300 ms:

```text
222 × 0,300 ≈ 67 requests simultâneos
```

Se uma dependência degrada para 3 s, a mesma carga vira ~666 requests em voo. Por isso timeout, pool e backpressure são mecanismos de capacidade: sem eles, lentidão cria mais concorrência, que cria fila, que piora a lentidão — **colapso por fila**.

Use percentis e cenários: p50 para comportamento típico, p95/p99 para experiência e dimensionamento de fila/pool. Não multiplique RPS de pico por latência média e chame de garantia.

## 5. Compute: benchmark antes de escolher tamanho

Execute a aplicação real com limites de CPU/memória equivalentes ao deploy, banco representativo e mix 80:20. Suponha que uma task sustentou:

```text
70 RPS mantendo p99 < 400 ms, erros < 0,1% e CPU < 70%
```

Então:

```text
tasks para throughput = ceil(222 / 70) = 4
```

Quatro é o mínimo matemático desse teste, não a configuração final. Considere:

- pelo menos duas instâncias/AZs quando downtime importa;
- capacidade após perder uma task/AZ conforme requisito;
- margem para GC, deploy, variação e medição imperfeita;
- tempo de startup até o autoscaling reagir.

Uma decisão plausível seria 5 tasks no pico, com `min` menor se o serviço puder escalar com antecedência suficiente. Se perder uma, restam as quatro unidades mínimas calculadas — ainda com a folga nominal do arredondamento (~26% sobre 222 RPS), mas sem redundância para outra perda, tráfego subestimado ou degradação de capacidade.

⚠️ Não use “Go aguenta 50 mil RPS” de benchmark alheio. Handler vazio mede runtime; seu sistema mede JSON, regra, TLS, banco, locks, rede e terceiros.

## 6. CPU, memória e limites

Throughput sozinho não explica a saturação. Durante o teste, observe:

| Recurso | Sinal | Resposta |
|---|---|---|
| CPU | throttling/CPU alta e fila crescendo | otimizar hot path ou mais CPU/tasks |
| memória | RSS cresce, OOM/restarts | perfil heap, limitar buffers/payloads |
| goroutines | crescem sem voltar | timeout/leak/dependência lenta |
| file descriptors | conexão recusada/erro de socket | pool, keep-alive e limites do host |
| rede | bytes/s no limite | payload/cache/compressão/capacidade |
| banco | latência/conexões/locks | query, índice, pool e modelo de dados |

Headroom não é CPU ociosa desperdiçada; é tempo para detectar e reagir ao pico. A margem correta vem do tempo de warm-up e da volatilidade da demanda.

## 7. Banco: QPS, conexões e working set

Se cada request faz em média 2 queries:

```text
222 RPS × 2 = 444 queries/s no pico
```

Mas a média pode mentir: um endpoint de relatório faz 30 queries e domina o banco. Meça queries por rota e p95 de duração. O teste deve incluir índices e distribuição de dados parecidos com produção — tabela vazia produz plano irreal.

### Orçamento de conexões

Suponha banco limitado a 300 conexões e reserve 50 para administração, migrações e margem. Com autoscaling máximo de 10 tasks:

```text
pool máximo por task = floor((300 - 50) / 10) = 25
```

Configure pelo **máximo de tasks**, não pelo número atual. Cinco tasks com pool 50 parecem caber; ao escalar para dez, tentam abrir 500. Pool não cria capacidade: conexão demais aumenta contenção e memória do Postgres.

### Working set

O banco performa melhor quando páginas/índices quentes cabem em memória. Estime volume total, mas meça o conjunto acessado com frequência. Antes de aumentar instância: índices corretos, queries, paginação, retenção e N+1.

## 8. Storage: crescimento é fluxo × retenção

Exemplo de pedidos:

```text
100.000 DAU × 0,3 pedido/dia       = 30.000 pedidos/dia
linha + índices + overhead ≈ 4 KB  = 120 MB/dia
por ano                            ≈ 44 GB/ano (antes de versões/backups)
```

Exemplo de uploads:

```text
5% dos DAU fazem 1 upload de 2 MB/dia
100.000 × 0,05 × 2 MB = 10 GB/dia ≈ 3,65 TB/ano
```

O segundo domina completamente o primeiro. Arquivo vai para object storage, não para Postgres nem disco da task. Inclua thumbnails, versões, replicação, snapshots e retenção — “objeto médio” raramente é a história toda.

Para banco, projete crescimento de tabela **e índices**; para logs, bytes por request × requests; para backup, retenção e mudança diária. Defina lifecycle a partir de regra de negócio, não só para baixar custo.

## 9. Banda e egress

Com 4 milhões de respostas/dia de 25 KB:

```text
4.000.000 × 25 KB ≈ 100 GB/dia ≈ 3 TB/mês de resposta bruta
```

Some requests, headers, uploads, retries, replicação e tráfego interno. Depois desconte somente o que um cache **realmente** evita no origin.

```text
origin egress ≈ tráfego cacheável × (1 - cache_hit_ratio)
                + tráfego não cacheável
```

Assets com hash podem ter cache hit alto; JSON por usuário, baixo ou zero. Nunca aplique cache compartilhado a resposta privada sem chave e headers corretos.

Latência geográfica não se resolve com mais CPU. CDN aproxima conteúdo estático; API e banco devem ficar próximos um do outro, e a Region deve refletir usuários e requisitos.

## 10. Filas e workers

Dimensione consumidor pela taxa de chegada e tempo por job:

```text
concorrência mínima ≈ jobs/s de pico × duração média do job em segundos
```

Se chegam 20 jobs/s e cada um leva 500 ms:

```text
20 × 0,5 = 10 workers concorrentes para não aumentar backlog
```

Na prática, some margem e meça o p95. A métrica principal para autoscaling não é CPU, mas **idade da mensagem mais antiga** ou backlog por consumidor. Se chegada permanece maior que processamento, escalar até o máximo e aplicar backpressure; fila infinita só adia a queda e aumenta o tempo do usuário.

Inclua retries e duplicatas na conta. Consumidor idempotente e DLQ são parte da capacidade, não detalhes posteriores; veja [mensageria-filas.md](../devops/mensageria-filas.md).

## 11. Cache: estime benefício, memória e avalanche

Cache é útil quando uma leitura cara se repete. Estime:

```text
hit ratio = hits / (hits + misses)
memória ≈ chaves ativas × (tamanho valor + chave + overhead)
```

Um hit ratio de 90% pode reduzir 444 queries/s para ~44 misses/s **apenas** no conjunto cacheado. Não extrapole para escritas e endpoints não cacheáveis.

Planeje TTL com semântica do dado, invalidação, limite de memória e comportamento na queda. Cache frio após deploy/eviction pode mandar toda a carga de volta ao banco (cache stampede); use jitter no TTL, coalescência de requests ou aquecimento para chaves realmente quentes.

## 12. Autoscaling: métrica proporcional ao gargalo

Boas métricas mudam de forma previsível quando adicionamos capacidade:

- API CPU-bound: CPU por task;
- API com custo uniforme: requests por target;
- worker: backlog/idade por consumidor;
- serviço limitado por concorrência: requests em voo, se instrumentado.

Métricas ruins: CPU quando o gargalo é banco, número bruto da fila sem considerar consumidores, média de latência e “usuários online”.

Defina `min`, `max`, target, warm-up e velocidade de scale-in. Scale-out deve ser rápido o bastante para o pico; scale-in conservador evita oscilar e matar requests. O `max` protege custo e dependências — ao alcançá-lo, backpressure e degradação graciosa precisam existir.

## 13. Teste de carga que responde à pergunta certa

Roteiro:

1. Defina SLO e hipótese: “uma task sustenta 70 RPS no mix real com p99 < 400 ms”.
2. Gere dados representativos; tabela pequena e cache sempre quente invalidam o teste.
3. Faça **ramp-up**, carga sustentada e pico — não pule de 0 para 10 mil.
4. Meça cliente, app, banco e fila ao mesmo tempo.
5. Ache o primeiro gargalo; altere uma variável; repita.
6. Execute soak test para leaks e crescimento lento.
7. Teste falha de task/dependência e recuperação, não apenas caminho feliz.

Resultados necessários: throughput máximo dentro do SLO, ponto de saturação, recurso limitante, comportamento de erro e tempo de autoscaling. Uma ferramenta gerando muitos requests não é teste se você não sabe o que aprendeu.

## 14. Cenários e gatilhos de evolução

| Cenário | O que calcular | Decisão esperada |
|---|---|---|
| base | p50 do dia e mínimo HA | custo recorrente mínimo |
| pico normal | p95 por minuto + margem | desired/max e target |
| campanha/evento | pico previsto e warm-up | pre-scaling ou fila |
| dependência 10× lenta | concorrência/timeouts | backpressure/degradação |
| crescimento 10× | DB, storage, rede e custo | qual suposição quebra primeiro |

Registre gatilhos mensuráveis: “read replica quando SELECT usar 70% sustentado apesar de índices/cache”, “nova task quando requests/target ultrapassar o valor validado”, “particionar dado quando manutenção/IOPS exceder limite”. Evite “quando crescer” — não é observável.

## 15. ⚠️ Erros clássicos de capacidade

| Erro | Consequência |
|---|---|
| dimensionar por usuários cadastrados | número sem relação com carga |
| usar RPS médio | queda no horário de pico |
| copiar benchmark público | ignora seu banco e seu SLO |
| escalar app sem orçamento de conexão | banco morre primeiro |
| calcular só CPU | memória, rede, locks e pools ficam invisíveis |
| tratar cache como capacidade garantida | avalanche quando ele esfria |
| ignorar retries/jobs/logs | carga amplificada fora do caminho HTTP |
| precisão de duas casas em hipótese fraca | falsa confiança |

## 16. Checklist de estimativa

- [ ] DAU, ações/dia e requests/ação medidos ou marcados como hipótese
- [ ] RPS médio convertido em pico por janela real; tráfego extra e retries incluídos
- [ ] SLO de p95/p99 e taxa de erro definido antes do benchmark
- [ ] Concorrência calculada para latência normal e degradada
- [ ] RPS sustentável por unidade obtido com dados/mix representativos
- [ ] Banco estimado em QPS, working set e conexões no **máximo** de tasks
- [ ] Storage inclui índices, versões, backups e retenção
- [ ] Banda inclui payload, upload, cache miss e egress por caminho
- [ ] Workers dimensionados por chegada × duração e observados por idade da fila
- [ ] Cenários base, pico, falha e 10× têm custo e gatilhos explícitos
- [ ] Estimativa será comparada com produção e recalibrada
