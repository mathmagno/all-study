# Redes de Computadores — O Que Todo Engenheiro de Software Precisa Saber

> **TL;DR:** Todo bug "misterioso" de produção passa por rede: timeout, DNS, conexão recusada, latência. Entender TCP/IP, DNS e TLS transforma "não funciona" em diagnóstico de 5 minutos. Física e protocolos não mudam com a moda.

**Conecta com:** [protocolo-http.md](../backend/protocolo-http.md) (camada de aplicação) · [aws-infraestrutura.md](../aws/aws-infraestrutura.md) (VPC/subnets na prática) · [seguranca-da-informacao.md](../seguranca/seguranca-da-informacao.md) (firewall, isolamento) · [escalabilidade-load-balancing.md](../devops/escalabilidade-load-balancing.md) (LB L4/L7)

---

## 1. O modelo TCP/IP na prática (4 camadas que importam)

O modelo OSI (7 camadas) é didático; o mundo real roda TCP/IP:

| Camada | Protocolo | O que decide | Onde você mexe |
|---|---|---|---|
| **Aplicação** | HTTP, DNS, TLS*, SSH | o significado dos dados | seu código Go, headers |
| **Transporte** | TCP, UDP, QUIC | entrega confiável? portas | timeouts, keep-alive, LB L4 |
| **Rede (Internet)** | IP, ICMP | roteamento entre redes | VPC, subnets, route tables |
| **Enlace/Física** | Ethernet, Wi-Fi | bits no fio | (cloud abstrai) |

*TLS vive "entre" transporte e aplicação.

Intuição do encapsulamento: seu JSON viaja dentro de um segmento TCP, dentro de um pacote IP, dentro de um frame Ethernet — como cartas dentro de envelopes. Cada roteador no caminho só lê o envelope IP; só o destino abre até o JSON.

## 2. IP, CIDR e sub-redes (a base da sua VPC)

### Endereçamento
- IPv4: 32 bits (`10.0.1.25`). Esgotado — daí NAT e IPv6 (128 bits).
- **Faixas privadas (RFC 1918)** — só existem dentro da sua rede, não roteiam na internet:
  `10.0.0.0/8` · `172.16.0.0/12` · `192.168.0.0/16`

### CIDR — notação que você usa toda semana em cloud
`10.0.0.0/16` = os primeiros 16 bits são fixos (rede), o resto varia (hosts):

| CIDR | IPs | Uso típico |
|---|---|---|
| /32 | 1 | um host exato (regra de firewall) |
| /24 | 256 | uma subnet pequena |
| /16 | 65.536 | uma VPC inteira |
| /0 | todos | `0.0.0.0/0` = "qualquer origem" (cuidado em security group!) |

### Desenho clássico de rede em camadas (o mesmo de [seguranca-da-informacao.md](../seguranca/seguranca-da-informacao.md#3-arquitetura-segura-separação-frontback-e-rede-em-camadas))

```
VPC 10.0.0.0/16
├── subnet pública  10.0.1.0/24  → LB (tem rota p/ internet gateway)
├── subnet privada  10.0.10.0/24 → API Go (sai via NAT, ninguém entra)
└── subnet privada  10.0.20.0/24 → Postgres/Redis (nem sai)
```

Sub-rede define **domínios de isolamento**: quem está em qual subnet + security groups (firewall por instância) determinam quem fala com quem. É a materialização de "banco nunca exposto".

## 3. TCP — o cavalo de batalha

### Garantias e o preço delas
TCP entrega um **fluxo de bytes confiável, ordenado e sem duplicatas** enquanto a conexão progride, ou sinaliza falha; não preserva fronteiras de mensagem nem promete que uma operação inteira será concluída antes de a conexão cair. O preço: estabelecimento, buffers e controle.

### 3-way handshake (por que toda conexão custa 1 RTT antes do primeiro byte)
```
cliente → SYN     → servidor      "quero conectar, meu nº de sequência é X"
cliente ← SYN+ACK ← servidor      "aceito, meu nº é Y, confirmo seu X"
cliente → ACK     → servidor      "confirmo Y"  → conexão aberta
```

Consequências diretas no seu sistema:
- Conexão nova = 1 RTT (+ 1–2 de TLS). **Por isso** conexões se reutilizam: keep-alive HTTP, pool do `http.Client` Go, pool do `database/sql` — reaproveitar conexão é a otimização de rede nº 1.
- **Portas:** conexão = tupla `(IP:porta origem, IP:porta destino)`. Servidor escuta em 1 porta (`:8080`) e atende milhares de conexões simultâneas — cada uma com porta de origem diferente do lado do cliente.
- `connection refused` geralmente significa rejeição ativa (nada escutando, porta errada ou firewall em modo reject). `timeout` significa ausência de resposta dentro do prazo (drop, rota, host, perda ou congestionamento). **São pistas, não provas únicas.**

### Estados que aparecem em produção
- `LISTEN`: aceitando conexões. `ESTABLISHED`: conversa ativa.
- `TIME_WAIT`: quem fechou espera antes de reutilizar a tupla (proteção contra pacotes atrasados). Muitos podem ser normais sob carga; crescimento inesperado + esgotamento de portas sugere churn e falta de reuse/pooling.
- Flow control (janela) e congestion control (slow start): TCP acelera gradualmente — conexões novas são "frias"; mais um motivo para reutilizá-las.

### UDP — quando a confiabilidade atrapalha
Sem handshake, ordem ou retransmissão no transporte: envia datagramas. É útil quando dado atrasado perde valor (voz/vídeo ao vivo, jogos, métricas) ou a camada superior implementa confiabilidade — **QUIC/HTTP3 roda sobre UDP** para controlar streams sem o head-of-line do TCP. DNS tradicional prefere UDP, mas usa TCP em respostas/fluxos que exigem; DoT/DoH encapsulam em TLS/HTTP.

## 4. DNS — o sistema que derruba metade da internet quando falha

### A resolução completa de `api.exemplo.com`

```
browser → cache local → resolver do SO → resolver recursivo (ISP/8.8.8.8)
  → root server (".")           "quem cuida de .com?"
  → TLD server (".com")         "quem cuida de exemplo.com?"
  → authoritative (Route53...)  "api.exemplo.com = 203.0.113.10"
  ← resposta cacheada em cada nível pelo TTL
```

### Records que você configura

| Tipo | Faz | Exemplo |
|---|---|---|
| A / AAAA | nome → IPv4 / IPv6 | `api.exemplo.com → 203.0.113.10` |
| CNAME | nome → outro nome | `www → exemplo.com` (proibido no apex) |
| ALIAS/ANAME | CNAME no apex (extensão dos provedores) | `exemplo.com → lb-123.amazonaws.com` |
| MX | servidor de email | |
| TXT | verificações, SPF/DKIM | |
| NS | quem é o authoritative da zona | |

### TTL — a decisão operacional
TTL alto (1h+) = menos queries, propagação lenta. TTL baixo (60s) = mudança rápida, mais carga. **Manobra clássica de migração:** baixe o TTL para 60s um dia *antes* da mudança de IP, migre, suba o TTL de volta. "Propagação de DNS" é só cache expirando — não existe força mística.

DNS também é ferramenta de arquitetura: **é o load balancer mais barato que existe** (múltiplos A records → round-robin) e a base de failover geo (Route53 health checks). Limitação: cliente cacheia — remoção de servidor morto não é instantânea.

## 5. TLS — o handshake que protege tudo

O que o TLS 1.3 estabelece em 1 RTT:

```
ClientHello  → versões, cifras suportadas, key share
ServerHello  ← cifra escolhida, key share, CERTIFICADO
[cliente valida o certificado: assinado por CA confiável? domínio bate? validade?]
→ a partir daqui, chaves simétricas derivadas (ECDHE) criptografam tudo
```

Conceitos eternos:
- **ECDHE faz o key agreement; assinaturas/certificado autenticam; cifra simétrica protege os dados.** A criptografia de chave pública fica no handshake, não em cada byte da aplicação.
- **Cadeia de confiança:** certificado do site ← assinado por CA intermediária ← assinada por root CA (pré-instalada no SO/browser). É isso que impede man-in-the-middle: o atacante não consegue certificado válido para o seu domínio.
- **Forward secrecy (ECDHE):** chaves efêmeras por sessão — roubar a chave privada do servidor amanhã não decripta o tráfego gravado hoje.
- **SNI:** o cliente diz o hostname no ClientHello — permite N certificados num só IP.
- Na prática: terminação TLS no LB/CDN, certificado automático (ACM/Let's Encrypt), TLS 1.2 mínimo. Rede privada não é criptografia: TLS interno depende de threat model, compliance e fronteiras; mTLS só entra quando também é preciso autenticar workloads (ver [seguranca-da-informacao.md](../seguranca/seguranca-da-informacao.md#10-tlshttps)).

## 6. NAT, proxy e reverse proxy

- **NAT:** muitos IPs privados saem por um IP público (roteador reescreve origem e mantém tabela de mapeamento). Na AWS: **NAT Gateway** é como sua subnet privada baixa dependências sem aceitar conexão de fora — iniciativa só de dentro pra fora.
- **Forward proxy:** age em nome do **cliente** (rede corporativa filtrando saída).
- **Reverse proxy:** age em nome do **servidor** — o que nginx/Caddy/LB fazem: TLS termination, roteamento por path (`/api` → Go, `/` → estáticos), compressão, cache, rate limit. Nosso padrão de produção em [startProjects.md](../startProjects.md) (mesmo domínio para cookies) é um reverse proxy.

## 7. Latência — a física que nenhum framework revoga

Luz na fibra: ~200.000 km/s → cerca de **0,5 ms por 100 km em uma direção**, ou ~1 ms de RTT físico mínimo para endpoints separados por 100 km. Rota real, equipamentos e filas aumentam isso; nenhuma otimização de código vence a distância:

| Caminho | RTT típico |
|---|---|
| mesmo datacenter/AZ | < 1 ms |
| entre AZs da mesma região | 1–2 ms |
| São Paulo ↔ Virgínia | ~120 ms |
| São Paulo ↔ Europa | ~200 ms |

Aritmética que muda arquitetura: página que faz **20 requests sequenciais** para servidor a 120ms = 2,4s só de rede. Respostas: paralelizar requests, agregar endpoints (1 DTO completo > 5 chamadas), CDN para chegar perto do usuário, e a regra de ouro — **N+1 de rede** (query/request em loop) é o assassino de latência nº 1 em qualquer stack.

## 8. Load balancer: L4 vs L7

| | L4 (transporte) | L7 (aplicação) |
|---|---|---|
| Enxerga | IP + porta | HTTP completo: path, headers, cookies |
| Decide por | hash/round-robin de conexão | rota (`/api/*`), header, host |
| TLS | passa adiante (passthrough) | termina e re-encripta/plaintext |
| Custo/latência | menor | um pouco maior |
| Exemplo | AWS NLB | AWS ALB, nginx |

Web app típica quer **L7** (roteamento por path, health check HTTP, headers `X-Forwarded-For`). L4 para: TCP puro (banco), throughput extremo, TLS passthrough. Algoritmos, health checks e o resto da escalabilidade em [escalabilidade-load-balancing.md](../devops/escalabilidade-load-balancing.md).

## 9. Caixa de ferramentas de diagnóstico

O roteiro de "não conecta", de baixo para cima:

```bash
# 1. DNS resolve?
dig api.exemplo.com            # (ou nslookup no Windows) — IP correto? TTL?

# 2. Rota alcança o host?
ping 203.0.113.10              # ICMP pode estar bloqueado; ausência ≠ morto
traceroute api.exemplo.com     # onde no caminho o pacote morre (tracert no Win)

# 3. A PORTA responde? (o teste que mais importa)
nc -zv 203.0.113.10 443        # ou: Test-NetConnection -Port 443 (PowerShell)
# refused = rejeição ativa | timeout = ausência de resposta (investigue serviço/firewall/rota/perda)

# 4. TLS ok?
openssl s_client -connect api.exemplo.com:443 -servername api.exemplo.com
# mostra cadeia de certificados, validade, versão TLS

# 5. HTTP inteiro, com timing
curl -v https://api.exemplo.com/api/health     # headers, status, cert
curl -w "dns:%{time_namelookup} tcp:%{time_connect} tls:%{time_appconnect} total:%{time_total}\n" -o /dev/null -s https://api.exemplo.com
# → diz SE a lentidão é DNS, handshake, ou servidor

# 6. Quem está escutando/conectado na minha máquina?
ss -tlnp        # portas em LISTEN (netstat -ano no Windows)
ss -tn state established | wc -l   # conexões ativas (vazamento de conexão?)

# 7. Último recurso: ver os pacotes
tcpdump -i any port 5432 -w capture.pcap   # abrir no Wireshark
```

Interpretações que economizam horas:
- `connection refused` → houve rejeição ativa; verifique processo, porta e firewall `reject`.
- `timeout` no connect → nenhuma resposta no prazo; investigue firewall `drop`, rota, host, perda e congestionamento.
- DNS resolve para IP velho → cache/TTL, não "propagação misteriosa".
- Funciona local, falha atrás do LB → health check errado ou security group entre LB e app.
- Lento só na primeira request → handshake TCP+TLS; conexões não estão sendo reutilizadas.

## 10. Checklist mental de redes

- [ ] Sei em qual camada o problema está antes de mexer (DNS? TCP? TLS? HTTP?)
- [ ] Conexões reutilizadas em todo lugar (http.Client global, pool de DB, keep-alive)
- [ ] Timeout explícito em toda chamada de rede — a rede VAI falhar
- [ ] Subnets desenhadas em camadas; `0.0.0.0/0` só no LB :443
- [ ] Requests paralelos onde não há dependência; zero N+1 de rede
- [ ] TTL de DNS baixado antes de migração planejada
- [ ] `curl -w` e `nc -zv` na memória muscular para diagnóstico
