# Escalabilidade e Load Balancing — Crescer sem Multiplicar o Gargalo

> **TL;DR:** Escalar é manter SLO enquanto a carga cresce, não adicionar máquinas. Torne a aplicação stateless, encontre o gargalo medido e aumente a capacidade daquela etapa. Load balancer distribui tráfego saudável; não corrige query lenta, banco saturado ou dependência sem timeout.

**Conecta com:** [system-design-fundamentos.md](../backend/system-design-fundamentos.md) · [redes-de-computadores.md](../redes/redes-de-computadores.md) · [aws-estimativa-usuarios-capacidade.md](../aws/aws-estimativa-usuarios-capacidade.md) · [mensageria-filas.md](mensageria-filas.md) · [kubernetes.md](kubernetes.md) · [protocolo-http.md](../backend/protocolo-http.md)

---

## 1. Escala começa por um SLO e uma curva

“Aguenta quantos usuários?” precisa virar:

```text
Com o mix real de endpoints, qual RPS mantém:
  p99 < 400 ms, erro < 0,1% e saturação recuperável?
```

Meça quatro sinais:

- **demanda:** RPS, jobs/s, bytes/s, conexões;
- **latência:** p50/p95/p99, incluindo fila;
- **erros:** aplicação, timeout, rejeição e retry;
- **saturação:** CPU, memória, pools, locks, I/O e backlog.

Sistemas têm um “joelho”: throughput cresce quase linear, depois fila/latência explodem antes de throughput melhorar. Opere com margem anterior a esse ponto; 100% de utilização não é eficiência se qualquer pico causa colapso.

## 2. Vertical vs horizontal

| Estratégia | Faz o quê | Vantagem | Limite |
|---|---|---|---|
| vertical (scale up) | máquina maior | simples, útil para banco | teto, restart, SPOF/custo por salto |
| horizontal (scale out) | mais instâncias | redundância e crescimento gradual | estado, coordenação e dependências |

Escala vertical é frequentemente a melhor primeira ação: comprar CPU/RAM pode custar menos que redesenhar sistema. Horizontal entra quando disponibilidade, pico ou limite da máquina justificam.

```text
1 API maior                    3 APIs atrás de LB
┌──────────────┐              ┌────┐ ┌────┐ ┌────┐
│ CPU/RAM ↑    │              │ A  │ │ B  │ │ C  │
└──────────────┘              └────┘ └────┘ └────┘
```

Mais réplicas da API podem multiplicar conexões até derrubar o mesmo banco. Escalar uma camada não escala automaticamente o sistema.

## 3. Stateless é o pré-requisito barato

Qualquer instância deve atender qualquer request:

```text
request → LB → API A/B/C
                 │
       sessão no Redis/banco
       arquivos no object storage
       estado durável no banco
```

Evite sessão/upload/cache indispensável em memória/disco local. Sticky session reduz redistribuição e pode ser escape temporário, mas cria hotspots e complica deploy/falha. Corrija a localização do estado.

Stateless não significa “sem estado”; significa que o processo não é o dono durável dele. Isso permite replacement, rolling deploy e autoscaling.

## 4. O que um load balancer faz

- recebe conexões e escolhe target saudável;
- distribui carga e remove instância doente;
- pode terminar TLS, rotear por host/path e aplicar limites;
- drena conexões durante deploy;
- expõe métricas por target.

| Camada | Enxerga | Use para |
|---|---|---|
| L4 | IP, porta, TCP/UDP | protocolo genérico, TLS passthrough, alto throughput |
| L7 | HTTP: host/path/header/status | web/API, routing e health HTTP |

Web app normalmente usa L7. L4 não entende `/api`; L7 precisa compreender o protocolo e frequentemente termina TLS. Nenhum deles reduz o tempo de uma query após encaminhar o request.

## 5. Algoritmos de distribuição

| Algoritmo | Ideia | Quando funciona | Armadilha |
|---|---|---|---|
| round robin | alterna targets | requests parecidos | request lento cria desigualdade |
| least connections | menos conexões ativas | duração variável | conexão não mede custo exato |
| weighted | proporção por peso | canary/capacidade diferente | peso exige calibração |
| hash consistente | mesma chave tende ao target | cache/localidade | reintroduz afinidade/redistribuição |
| random/power of two | amostra e escolhe melhor | grande frota | depende de métrica disponível |

Round robin é default excelente para API stateless. Não escolha algoritmo sofisticado antes de olhar dispersão de RPS, latência e utilização por target.

Long-lived connections (WebSocket/gRPC streaming) distribuem no momento da conexão; adicionar instância não move conexões existentes. Planeje draining e escala por conexões, não apenas requests.

## 6. Health check e draining

```text
target novo:  start → startup → readiness OK → recebe tráfego
target antigo: readiness off → LB drena → SIGTERM → requests terminam → exit
```

- Check ativo consulta periodicamente; falhas consecutivas evitam flapping.
- Readiness diz “posso servir agora”; liveness/restart é problema do runtime.
- Check deve ter timeout curto e endpoint barato.
- Não declare unhealthy porque um terceiro caiu se o serviço ainda pode responder degradado; remover **todas** as instâncias amplia a falha.
- Deregistration delay/graceful shutdown precisam cobrir requests em voo.

Health do target não garante experiência: DNS, TLS, próprio LB e dependências ainda falham. Monitore de fora (synthetic) e dentro (métricas RED).

## 7. Capacidade e margem

Se uma instância validada sustenta 70 RPS dentro do SLO e o pico de projeto é 222:

```text
instâncias mínimas por throughput = ceil(222 / 70) = 4
```

Quatro deixam zero folga se uma falhar. Capacidade final considera:

- perda de instância/AZ conforme requisito;
- variação e erro da estimativa;
- deploy com versões coexistindo;
- warm-up do autoscaling;
- limite de banco/pool/rede.

Headroom é tempo para reagir. Defina `min` pelo baseline/HA e `max` pelo custo **e capacidade do downstream**. O cálculo completo de usuários, concorrência e conexões está em [aws-estimativa-usuarios-capacidade.md](../aws/aws-estimativa-usuarios-capacidade.md).

## 8. Cache: evite trabalho, não esconda bug

Camadas do mais barato/próximo:

| Cache | Bom para | Invalidação |
|---|---|---|
| browser/HTTP | resposta/assets do cliente | Cache-Control/ETag |
| CDN | conteúdo público/geográfico | TTL, URL com hash, purge raro |
| processo | configuração/dado pequeno | perde por réplica/restart |
| Redis | dado quente compartilhado | TTL/evento/delete |
| banco buffer cache | páginas/índices | gerenciado pelo banco |

Cache-aside:

```text
GET chave → hit: responde
          → miss: lê banco → grava cache com TTL → responde
```

Riscos:

- dado velho e invalidação incorreta;
- **stampede:** chave quente expira e todos consultam banco;
- avalanche após restart/eviction;
- cache de resposta privada compartilhado por engano.

Use TTL com jitter, coalescência/lock para chave quente e degradação quando cache cai. Antes de Redis, corrija índice/query e caching HTTP — menos componentes, mesmo ganho em muitos casos.

## 9. Banco: sequência saudável de escala

```text
1. medir slow queries/locks/conexões
2. índice + query + eliminar N+1
3. pool limitado e paginação/retention
4. scale up do primário
5. cache para leitura repetida
6. read replica quando leitura domina
7. particionamento/sharding apenas no limite comprovado
```

Read replica traz consistência eventual e não aumenta escrita. Sharding distribui dados, mas adiciona roteamento, rebalanceamento, joins/transações difíceis e hotspots de chave.

Connection budget:

```text
pool por instância × max de instâncias + reservas < max do banco
```

Autoscaling sem essa conta transforma sucesso (mais Pods) em incidente (connection storm). Proxy/pooler ajuda conexões, não torna query ruim barata.

## 10. Trabalho assíncrono e absorção de pico

Tire do request apenas o que não precisa concluir antes da resposta:

```text
API → transação + outbox → fila → workers limitados → terceiro
```

Fila desacopla taxa de chegada da taxa de processamento por um tempo. Se entram 100 jobs/s e saem 60, backlog cresce 40/s; capacidade/retention acabam.

Escala de worker usa idade da mensagem e backlog por consumidor. ACK, idempotência, retry e DLQ estão em [mensageria-filas.md](mensageria-filas.md). Fila não é justificativa para responder “sucesso” antes de persistir a intenção.

## 11. Backpressure e load shedding

Quando capacidade acaba, rejeitar cedo é melhor que aceitar tudo e falhar tarde:

- limite de concorrência por instância;
- timeout budget em toda dependência;
- fila/pool com tamanho máximo;
- rate limit por tenant/user e quota justa;
- `429` para limite do cliente, `503` para indisponibilidade temporária, com retry orientado;
- desabilitar recomendação/analytics antes de checkout crítico;
- circuit breaker quando dependência precisa se recuperar.

Fila ilimitada aumenta latência até request expirar, mas o servidor continua trabalhando para cliente que foi embora. Propague cancelamento, limite espera e descarte trabalho obsoleto quando a semântica permite.

Retry é multiplicador de carga. Use só erro transitório + operação idempotente + backoff/jitter + limite. Durante falha, orçamento de retry preserva capacidade para requests novos.

## 12. Autoscaling: escale pelo gargalo

| Workload | Métrica possível | Cuidado |
|---|---|---|
| API CPU-bound | CPU por instância | request/CPU precisa ser estável |
| API uniforme | requests por target | inclua latência/saturação |
| worker | idade/backlog por worker | downstream pode ser limite |
| conexão longa | conexões/bytes | scale-out não redistribui antigas |

Target tracking funciona como termostato. Defina:

- mínimo, máximo e target com margem;
- warm-up/startup real;
- scale-out rápido e scale-in conservador;
- estabilização para evitar oscilação;
- pre-scaling para evento conhecido mais rápido que o warm-up.

Latência é sinal importante, mas frequentemente ruim para controlar sozinha: sobe tarde e não é proporcional à quantidade de instâncias. Use como alarme/SLO junto da métrica causal.

## 13. Testes que revelam limites

| Teste | Pergunta |
|---|---|
| baseline | desempenho esperado com carga normal? |
| load | atende o pico projetado? |
| stress | onde satura e como falha? |
| spike | autoscaling/backpressure reage a salto? |
| soak | há leak/bloat após horas? |
| failover | perder target/AZ preserva SLO? |

Use mix de endpoints e distribuição de dados realistas; handler `/health` não representa produto. Faça ramp-up, meça gerador, LB, app, banco e fila. Teste com cache frio/quente e limites reais de container.

Resultado deve registrar: RPS dentro do SLO, ponto de saturação, primeiro gargalo, erro observado e tempo de recuperação. Mude uma variável por vez.

Não faça teste pesado contra produção sem autorização, limites e plano: ele parece ataque e pode gerar custo/perda.

## 14. Disponibilidade e distribuição

Duas instâncias no mesmo Node/AZ compartilham falha. Distribua conforme requisito e teste:

```text
AZ A: LB + API A ─┐
                  ├── banco Multi-AZ/estratégia adequada
AZ B: LB + API B ─┘
```

Multi-AZ cobre falha de instalação; não cobre deploy ruim, credencial comprometida ou `DROP TABLE`. Use rollout gradual, backup/restore, isolamento e mudança pequena.

Multi-Region adiciona replicação, conflito, failover DNS, consistência e operação duplicada. Só entra com RTO/RPO e impacto de negócio explícitos.

## 15. Método para evoluir sem adivinhar

```text
1. definir SLO e estimar pico
2. instrumentar rate/error/duration/saturation
3. load test para encontrar o primeiro gargalo
4. aplicar a solução mais barata daquela camada
5. repetir e documentar qual limite vem depois
```

Exemplos: banco alto por full scan → índice, não 10 APIs; CPU da API alta → profile/mais CPU/réplicas; terceiro lento → timeout/fila/limite; assets distantes → CDN, não read replica.

Capacity plan é hipótese versionada. Compare previsão com produção e recalibre fator de pico, capacidade por instância e custo por unidade.

## 16. ⚠️ Over-engineering clássico

| Sintoma | Alternativa pragmática |
|---|---|
| Kubernetes para uma API | PaaS/ECS/duas VMs + LB |
| Redis antes de olhar query | índice + `EXPLAIN ANALYZE` |
| sharding preventivo | scale up, cache e réplica |
| multi-Region “para HA” | Multi-AZ + backup/restore testado |
| sticky session permanente | estado fora do processo |
| HPA por CPU para tudo | métrica ligada ao gargalo |
| retry ilimitado | budget + backoff/jitter + shedding |
| algoritmo exótico de LB | round robin + targets homogêneos |

## 17. Checklist de escalabilidade

- [ ] SLO, mix de carga, RPS médio/pico e margem estão explícitos
- [ ] Primeiro gargalo foi medido; solução atua naquela camada
- [ ] Aplicação é stateless e qualquer target atende qualquer request
- [ ] LB usa health/readiness e draining compatíveis com graceful shutdown
- [ ] Algoritmo de balanceamento corresponde ao perfil de requests/conexões
- [ ] Capacidade tolera perda exigida e deploy sem operar no joelho da curva
- [ ] Cache tem TTL/invalidação/stampede e falha sem derrubar o banco
- [ ] Banco foi otimizado antes de réplica/sharding; pool cabe no max de instâncias
- [ ] Fila tem capacidade finita, backpressure, idempotência e SLO de idade
- [ ] Autoscaling usa métrica causal, min/max/warm-up e scale-in conservador
- [ ] Load, spike, soak e failover foram testados com limites/dados reais
- [ ] Próximo gatilho de evolução é uma métrica, não “quando crescer”
