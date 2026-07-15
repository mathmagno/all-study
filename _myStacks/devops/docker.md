# Docker — Da Imagem ao Processo em Produção

> **TL;DR:** Container não é uma VM pequena: é um processo isolado criado de uma imagem imutável. Uma imagem boa compila em estágios, contém só o runtime, roda sem root, recebe configuração em runtime, não guarda estado local e encerra corretamente ao receber sinal.

**Conecta com:** [ci-cd.md](ci-cd.md) · [kubernetes.md](kubernetes.md) · [aws-infraestrutura.md](../aws/aws-infraestrutura.md) · [seguranca-da-informacao.md](../seguranca/seguranca-da-informacao.md) · [startProjects.md](../startProjects.md)

---

## 1. Imagem, container e registry

| Conceito | O que é | Analogia útil |
|---|---|---|
| Dockerfile | receita versionada | código-fonte do pacote |
| Image | filesystem + metadados imutáveis em layers | artefato de build |
| Container | processo rodando a partir da imagem | instância do artefato |
| Registry | armazenamento/distribuição de imagens | registry de releases |

```text
Dockerfile ──build──> image:git-a84c2f1 ──push──> registry
                                               │
                                  pull + run ──┴──> container (processo)
```

Parar/remover container não apaga a imagem. Reiniciar container não deve ser mecanismo de persistência. Tudo que precisa sobreviver vai para banco, object storage ou volume com lifecycle deliberado.

## 2. Layers e cache: ordem muda o tempo de build

Cada `FROM`, `COPY` e `RUN` produz/usa layers. Quando uma entrada muda, aquela etapa e as seguintes perdem cache. Copie primeiro arquivos estáveis:

```dockerfile
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download      # só repete quando dependências mudam
COPY . .                 # código muda o tempo todo
RUN go build ./cmd/api
```

Copiar o repositório inteiro antes de baixar módulos invalida o cache a cada alteração. Combine comandos quando isso mantém a layer limpa, mas não transforme o Dockerfile em shell ilegível.

`.dockerignore` reduz contexto, vazamento e invalidação:

```dockerignore
.git
.env*
!.env.example
node_modules
dist
bin
coverage
*.log
```

O ignore é barreira adicional, não autorização para deixar segredo no diretório de build.

## 3. Dockerfile Go multi-stage

```dockerfile
# syntax=docker/dockerfile:1
FROM golang:1.26-alpine AS build
WORKDIR /src

COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download

COPY . .
RUN --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" \
    -o /out/api ./cmd/api

FROM gcr.io/distroless/static-debian12:nonroot AS runtime
WORKDIR /
COPY --from=build --chown=nonroot:nonroot /out/api /api

EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/api"]
```

O estágio de build tem compilador e cache; a imagem final recebe só o binário/runtime necessário. Resultado: download menor e superfície de ataque menor.

- Alinhe a versão Go ao `go.mod`; atualização de base é PR testado.
- `EXPOSE` documenta a porta, não publica nada sozinho.
- Forma JSON de `ENTRYPOINT` executa o binário diretamente e recebe sinais.
- Distroless não tem shell: excelente em runtime, menos conveniente para debug. Use observabilidade/ephemeral debug, não instale shell “por garantia”.
- Se a aplicação usa CGO, timezone ou arquivos adicionais, prove no teste da **imagem final**; não presuma que o build stage representa runtime.

## 4. Tags são nomes; digest identifica bytes

```text
api:latest          → ponteiro mutável, não prova versão
api:git-a84c2f1     → rastreável, mas tag ainda pode ser movida
api@sha256:9f...c2  → conteúdo exato
```

Pipeline publica tag do commit e registra digest. Ambientes promovem o mesmo digest; não recompilam por ambiente. Para base image, tag fixa família/patch conforme política e digest aumenta reprodutibilidade — com automação para atualizar, pois pin eterno congela correções.

## 5. Configuração em runtime; segredo nunca na imagem

```go
port := envOrDefault("PORT", "8080")
databaseURL := mustEnv("DATABASE_URL")
```

Mesma imagem roda em dev/staging/prod; variam ambiente e identidade. Não use:

```dockerfile
ENV DATABASE_PASSWORD=segredo   # fica em metadados/layers
COPY .env /app/.env             # pode ser extraído da imagem
ARG TOKEN                       # ARG também pode aparecer no histórico/cache
```

Segredo de **build** usa secret mount do BuildKit; segredo de **runtime** vem de secret manager/arquivo montado/variável injetada pelo orquestrador. A aplicação deve evitar logá-lo e rotacioná-lo sem rebuild.

## 6. Docker Compose para desenvolvimento local

```yaml
services:
  api:
    build:
      context: ./backend
    environment:
      PORT: "8080"
      DATABASE_URL: postgres://app:dev-only@db:5432/app?sslmode=disable
    ports:
      - "127.0.0.1:8080:8080"
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:18-alpine
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: dev-only
      POSTGRES_DB: app
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d app"]
      interval: 5s
      timeout: 3s
      retries: 10
    volumes:
      # PostgreSQL 18+ organiza os dados por major sob este diretório.
      - postgres-data:/var/lib/postgresql

volumes:
  postgres-data:
```

Nomes dos services viram DNS na rede Compose: API conecta a `db:5432`, não `localhost`. `ports` publica no host; comunicação interna não precisa expor banco.

Credenciais `dev-only` são descartáveis. Para projeto compartilhado, use `.env.example` sem valor real e ignore o `.env`. Compose reproduz dependências locais; não é automaticamente arquitetura de produção.

## 7. Rede: localhost pertence ao próprio container

```text
host:8080 ──port mapping──> api:8080
api ──DNS db──> db:5432
```

- Bind da aplicação deve ser `0.0.0.0:8080` dentro do container; `127.0.0.1` aceita somente tráfego do próprio container.
- Publique apenas portas necessárias, preferencialmente presas a `127.0.0.1` no desenvolvimento.
- Container não ganha segurança por estar em “uma rede Docker”; aplique autenticação, TLS e políticas conforme fronteira real.
- DNS/service discovery substitui IP fixo. IP do container é efêmero.

## 8. Volumes e filesystem efêmero

| Mount | Uso | Cuidado |
|---|---|---|
| named volume | dados locais do Postgres | backup/lifecycle explícitos |
| bind mount | código em desenvolvimento | permissões e diferença host/container |
| tmpfs | temporário sensível/rápido | some no restart e usa memória |

Produção stateless não grava upload no filesystem local: nova réplica não vê o arquivo e reschedule o perde. Use S3/object storage. Logs vão para stdout/stderr e o runtime coleta; não para `/app/logs` sem rotação.

Read-only root filesystem + diretórios temporários montados reduzem persistência do atacante, desde que a aplicação tenha sido preparada para isso.

## 9. PID 1, sinais e graceful shutdown

Orquestradores encerram assim:

```text
SIGTERM → período de graça → SIGKILL
```

Seu binário como PID 1 precisa receber SIGTERM, parar de aceitar trabalho e terminar requests em voo até deadline. Shell form atrapalha propagação:

```dockerfile
ENTRYPOINT ./api        # shell vira PID 1; sinais podem não chegar como esperado
ENTRYPOINT ["/api"]     # forma exec: binário recebe o sinal
```

No Go, use `signal.NotifyContext` + `http.Server.Shutdown`. Worker para de buscar mensagens, conclui/solta as em voo e então sai. Grace period do orquestrador deve ser maior que o timeout interno de shutdown.

## 10. Health check não é “processo existe”

- **Startup:** terminou inicialização?
- **Readiness:** pode receber tráfego agora?
- **Liveness:** está travado sem chance de recuperação?

`/readyz` pode verificar estado interno essencial; `/livez` deve ser barato e não reiniciar a frota porque banco/terceiro caiu. Healthcheck tem timeout curto e não exige autenticação pública — exponha somente na rede de controle.

Dockerfile pode declarar `HEALTHCHECK`, mas a imagem distroless não traz `curl`. Prefira probe HTTP nativa do orquestrador/ALB ou subcomando do próprio binário, em vez de instalar utilitário só para health.

## 11. Limites e segurança de runtime

Container compartilha kernel do host; não é fronteira igual a VM. Mínimo:

- usuário não-root e sem `--privileged`;
- capabilities removidas (`cap_drop: [ALL]`) e read-only quando possível;
- limite/reserva de CPU e memória medidos;
- sem socket Docker montado — ele equivale, na prática, a controle do host;
- seccomp/AppArmor/política do runtime conforme ambiente;
- imagens pequenas, reconstruídas e escaneadas regularmente;
- task/service role mínima; nunca credencial da máquina inteira.

Limite de memória baixo demais causa OOM; sem limite, um leak afeta vizinhos. Faça load test com os mesmos limites de produção.

## 12. Supply chain da imagem

```text
source revisado → builder confiável → imagem → SBOM/scan → assinatura
→ registry privado/policy → deploy verifica digest/proveniência
```

- Use bases oficiais/confiáveis e remova pacote desnecessário.
- Reconstrua periodicamente: uma imagem não ganha patch porque a tag base mudou.
- Scan da imagem **final**, não só `go.mod`/`package.json`.
- Preserve SBOM e relação commit → digest.
- Vulnerabilidade tem severidade, explorabilidade e SLA; exceção precisa de dono/validade.

Assinatura não corrige Dockerfile inseguro; prova origem/integridade dentro da confiança configurada.

## 13. Diagnóstico sem tratar container como pet

```bash
docker compose ps
docker compose logs --tail 100 api
docker inspect "$(docker compose ps -q api)"
docker stats
docker compose config         # vê configuração final interpolada
```

Chegue ao container pelo service do Compose, não por um nome presumido. Cheque: processo saiu? código de saída? OOM? bind em `0.0.0.0`? DNS resolve? porta responde? variável existe? filesystem permite escrita? Em imagem distroless não há `/bin/sh`; rode uma imagem efêmera de debug aprovada na mesma rede/namespace quando autorizado.

Não “conserte” produção alterando container em execução. Mudança manual desaparece no próximo restart e não entra no Git. Corrija Dockerfile/config, gere novo digest e redeploy.

## 14. ⚠️ Over-engineering e antipadrões

| Sintoma | Consequência | Alternativa |
|---|---|---|
| uma VM inteira por container | imagem enorme/lenta | runtime mínimo multi-stage |
| processo como root | blast radius maior | UID não-root |
| segredo em `ARG/ENV/COPY` | extraível de layer/history | secret mount/injeção runtime |
| `latest` em produção | versão/rollback ambíguos | SHA + digest |
| banco/upload no disco da API | perda e escala impossível | serviço stateful/object storage |
| shell script como PID 1 | sinal/zombie incorretos | exec form/binário direto |
| Compose como “Kubernetes caseiro” | operação artesanal | PaaS/ECS/K8s quando houver sinal |

## 15. Checklist Docker

- [ ] `.dockerignore` exclui Git, segredos, dependências, builds e logs
- [ ] Dockerfile multi-stage copia apenas artefatos necessários para runtime
- [ ] Imagem final roda como usuário não-root e sem privilégio/capability desnecessário
- [ ] Configuração entra em runtime; nenhum segredo está em layer, ARG, ENV ou Git
- [ ] Imagem recebe tag do commit, digest é registrado e promovido sem rebuild
- [ ] Aplicação escuta `0.0.0.0`, usa DNS de service e publica só portas necessárias
- [ ] Estado durável está fora do container; logs saem em stdout/stderr
- [ ] PID 1 recebe SIGTERM e faz graceful shutdown dentro do grace period
- [ ] Health checks distinguem startup/readiness/liveness e não amplificam falha externa
- [ ] CPU/memória e filesystem read-only foram testados sob carga
- [ ] Imagem final tem scan/SBOM e bases são atualizadas por PR recorrente
