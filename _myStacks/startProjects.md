**Stack:** Golang · Go-chi · REST API · React · TypeScript · Vite · Tailwind CSS · HttpOnly Cookies · CORS · DTO Pattern · Clean Architecture · Monorepo

# Guia de Inicialização — Stack Go + React/TS + Tailwind

> **Filosofia:** O front-end é um terminal visual burro. Toda regra de negócio, validação e autorização vivem no Go. O React apenas renderiza DTOs higienizados e envia intenções do usuário.

---

# 1. Visão Geral do Projeto & Arquitetura

## Fluxo de Comunicação

```
┌─────────────────────┐         HTTPS (JSON)          ┌──────────────────────────┐
│  React + TS (Vite)  │ ────────────────────────────► │        Go (API)          │
│                     │   Cookie HttpOnly (sessão)    │                          │
│  - Renderiza DTOs   │ ◄──────────────────────────── │  - Regras de negócio     │
│  - Validação de UX  │      Apenas DTOs estritos     │  - Validação real        │
│    (feedback visual)│                               │  - Autorização           │
│  - Zero segredos    │                               │  - Sessões (HttpOnly)    │
└─────────────────────┘                               │  - Acesso ao banco       │
                                                      └──────────────────────────┘
```

## Princípios Arquiteturais

| Princípio | Regra prática |
|---|---|
| **Segurança máxima** | O front nunca decide nada. Validação no React é só UX (feedback rápido); a validação que vale é a do Go. Todo endpoint assume que o cliente é hostil. |
| **Isolamento de dados** | Modelos do banco (**entities**) nunca saem do backend. A API responde exclusivamente com **DTOs** — structs criadas para cada caso de uso, contendo o mínimo necessário. |
| **Autenticação segura** | Zero tokens em `localStorage`/`sessionStorage` (vulnerável a XSS). Sessão via cookie `HttpOnly` + `Secure` + `SameSite=Strict`, gerenciado 100% pelo Go. O JavaScript do front nunca lê o cookie. |
| **Separação de conceitos** | Camadas no Go: `handler → service → repository`. Handler traduz HTTP↔DTO; service concentra regras de negócio; repository fala com o banco. |

## Fluxo de uma Requisição Autenticada

1. Usuário faz login → Go valida credenciais → cria sessão no servidor → grava `session_id` em cookie `HttpOnly`.
2. Browser envia o cookie automaticamente em cada request (`credentials: "include"` no fetch).
3. Middleware de auth no Go valida a sessão **antes** de qualquer handler executar.
4. Handler chama o service → service aplica regras → repository busca dados.
5. Service/handler **mapeia entity → DTO** e devolve apenas o DTO em JSON.

---

## 2. Estrutura de Pastas Recomendada (Monorepo)

```
meu-projeto/
├── backend/
│   ├── cmd/
│   │   └── api/
│   │       └── main.go              # Entry point: wiring de rotas, middlewares, server
│   ├── internal/                    # Código privado (Go impede import externo de /internal)
│   │   ├── domain/                  # Entities: modelos completos do negócio/banco
│   │   │   └── user.go              #   → NUNCA serializados para o front
│   │   ├── dto/                     # DTOs: structs de entrada/saída da API
│   │   │   └── user_dto.go          #   → ÚNICA coisa que vira JSON
│   │   ├── handler/                 # Camada HTTP: parse request, chama service, responde DTO
│   │   │   └── user_handler.go
│   │   ├── service/                 # Regras de negócio e validação pesada
│   │   │   └── user_service.go
│   │   ├── repository/              # Acesso a dados (SQL, cache)
│   │   │   └── user_repository.go
│   │   └── middleware/              # CORS, auth de sessão, rate limit, logging
│   │       ├── cors.go
│   │       └── auth.go
│   ├── go.mod
│   └── go.sum
│
├── frontend/
│   ├── src/
│   │   ├── api/                     # Camada única de comunicação com o Go
│   │   │   ├── client.ts            #   → fetch wrapper com credentials: "include"
│   │   │   └── users.ts             #   → funções por recurso
│   │   ├── types/                   # Interfaces TS espelhando os DTOs do Go
│   │   │   └── user.ts              #   → contrato ponta a ponta
│   │   ├── components/              # Componentes reutilizáveis (burros)
│   │   ├── pages/                   # Views/rotas da aplicação
│   │   ├── hooks/                   # Hooks de dados (ex: useUser)
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   └── index.css                # @import "tailwindcss";
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
│
├── .gitignore
└── README.md
```

**Regras de ouro da estrutura:**

- `internal/domain` (entities) e `internal/dto` são pastas **separadas de propósito**: o compilador e o code review pegam na hora se alguém serializar uma entity.
- No front, **todo** acesso à API passa por `src/api/`. Nenhum componente chama `fetch` direto — um único lugar para configurar credenciais, erros e tipos.
- `src/types/` é o espelho 1:1 dos DTOs do Go. Mudou o DTO → muda a interface → o TypeScript quebra o build em todo lugar afetado. Tipagem ponta a ponta.

---

## 3. Guia de Inicialização Rápida (Step-by-Step)

### 3.1 Back-end (Go)

Requisito: Go 1.22+ (o roteador da stdlib ganhou métodos e path params — dispensa framework para começar).

```bash
mkdir -p meu-projeto/backend && cd meu-projeto/backend

# Inicia o módulo (use o caminho do seu repositório)
go mod init github.com/seu-usuario/meu-projeto/backend

# Roteador chi: leve, idiomático, compatível com net/http (opcional, mas recomendado)
go get github.com/go-chi/chi/v5

# Estrutura mínima
mkdir -p cmd/api internal/domain internal/dto internal/handler internal/service internal/repository internal/middleware
```

`cmd/api/main.go` mínimo:

```go
package main

import (
	"log"
	"net/http"

	"github.com/go-chi/chi/v5"
)

func main() {
	r := chi.NewRouter()

	r.Get("/api/health", func(w http.ResponseWriter, req *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok"}`))
	})

	log.Println("API rodando em :8080")
	log.Fatal(http.ListenAndServe(":8080", r))
}
```

Rodar:

```bash
go run ./cmd/api
```

### 3.2 Front-end (Vite + React + TypeScript + Tailwind v4)

```bash
cd meu-projeto

# Cria o app com template React + TypeScript
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install

# Tailwind CSS v4 (plugin oficial do Vite — sem postcss.config, sem tailwind.config para começar)
npm install tailwindcss @tailwindcss/vite
```

`vite.config.ts` — plugin do Tailwind + proxy para o Go (evita CORS em dev):

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // Toda chamada a /api vai para o Go — mesmo origin no browser,
      // cookies funcionam sem configuração extra de CORS em dev
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
});
```

`src/index.css`:

```css
@import "tailwindcss";
```

Rodar:

```bash
npm run dev
```

> **Dica de processo:** com o proxy do Vite, em desenvolvimento o browser só enxerga `http://localhost:5173` — cookies `SameSite=Strict` funcionam naturalmente. Em produção, sirva front e API sob o mesmo domínio (ex: nginx/caddy roteando `/api` para o Go) e o CORS vira quase irrelevante.

---

## 4. Padrão de Comunicação e Segurança (Exemplos de Código)

### 4.1 Entity vs DTO em Go — limitando o que vira JSON

`internal/domain/user.go` — a entity completa, **jamais serializada**:

```go
package domain

import "time"

// User é o modelo interno completo. NUNCA enviar ao front.
type User struct {
	ID           int64
	Name         string
	Email        string
	PasswordHash string    // segredo — nunca sai do backend
	Role         string    // decisão de autorização é do Go, não do front
	InternalNote string    // dado operacional interno
	CreatedAt    time.Time
	UpdatedAt    time.Time
}
```

`internal/dto/user_dto.go` — o contrato público, estrito e higienizado:

```go
package dto

import "meu-projeto/backend/internal/domain"

// UserResponse é o ÚNICO formato de usuário que a API expõe.
// Campos ausentes aqui simplesmente não existem para o front.
type UserResponse struct {
	ID    int64  `json:"id"`
	Name  string `json:"name"`
	Email string `json:"email"`
}

// NewUserResponse é o único caminho entity → JSON.
// Mapeamento explícito: adicionar um campo exige decisão consciente.
func NewUserResponse(u domain.User) UserResponse {
	return UserResponse{
		ID:    u.ID,
		Name:  u.Name,
		Email: u.Email,
	}
}

// LoginRequest tipa e limita o que aceitamos de entrada.
type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}
```

**Por que mapeamento manual e não `json:"-"` na entity?** Com `json:"-"` a proteção depende de lembrar a tag em cada campo novo — esquecer = vazamento silencioso. Com DTO + construtor, o padrão é *fechado por default*: campo novo na entity não vaza a menos que alguém o adicione explicitamente ao DTO.

### 4.2 Middleware de CORS e Cookie HttpOnly em Go

`internal/middleware/cors.go`:

```go
package middleware

import "net/http"

// CORS restrito: uma única origem permitida, com credenciais.
// Nunca usar "*" junto com Allow-Credentials.
func CORS(allowedOrigin string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			if origin == allowedOrigin {
				w.Header().Set("Access-Control-Allow-Origin", allowedOrigin)
				w.Header().Set("Access-Control-Allow-Credentials", "true")
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
				w.Header().Set("Vary", "Origin")
			}

			// Preflight termina aqui
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}
```

Login gravando sessão em cookie `HttpOnly` — `internal/handler/auth_handler.go` (trecho):

```go
func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var req dto.LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"payload inválido"}`, http.StatusBadRequest)
		return
	}

	// Validação e autenticação REAIS acontecem no service (Go)
	user, sessionID, err := h.authService.Login(r.Context(), req.Email, req.Password)
	if err != nil {
		http.Error(w, `{"error":"credenciais inválidas"}`, http.StatusUnauthorized)
		return
	}

	// Sessão via cookie: o JavaScript do front NUNCA vê este valor
	http.SetCookie(w, &http.Cookie{
		Name:     "session_id",
		Value:    sessionID,
		Path:     "/",
		HttpOnly: true,                    // inacessível via document.cookie (bloqueia roubo por XSS)
		Secure:   true,                    // só trafega em HTTPS
		SameSite: http.SameSiteStrictMode, // não é enviado em navegação cross-site (mitiga CSRF)
		MaxAge:   int((24 * time.Hour).Seconds()),
	})

	// Resposta: apenas o DTO estrito
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(dto.NewUserResponse(user))
}
```

Middleware de autenticação — nenhum handler protegido roda sem sessão válida:

```go
func (m *AuthMiddleware) RequireSession(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie("session_id")
		if err != nil {
			http.Error(w, `{"error":"não autenticado"}`, http.StatusUnauthorized)
			return
		}

		user, err := m.sessionService.Validate(r.Context(), cookie.Value)
		if err != nil {
			http.Error(w, `{"error":"sessão inválida"}`, http.StatusUnauthorized)
			return
		}

		// Usuário validado disponível para os handlers via context
		ctx := context.WithValue(r.Context(), userContextKey, user)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
```

### 4.3 Interface TypeScript correspondente (tipagem ponta a ponta)

`frontend/src/types/user.ts` — espelho exato do DTO do Go:

```ts
// Espelha dto.UserResponse do backend.
// Se o Go mudar o DTO, esta interface muda junto — e o compilador
// aponta todo componente afetado.
export interface UserResponse {
  id: number;
  name: string;
  email: string;
}

// Espelha dto.LoginRequest
export interface LoginRequest {
  email: string;
  password: string;
}
```

`frontend/src/api/client.ts` — wrapper único de fetch:

```ts
const BASE_URL = "/api"; // proxy do Vite em dev; mesmo domínio em produção

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    // Envia o cookie HttpOnly automaticamente.
    // O JS nunca lê nem escreve o token — só o browser o transporta.
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Erro HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
}
```

`frontend/src/api/users.ts` — funções tipadas por recurso:

```ts
import { apiFetch } from "./client";
import type { LoginRequest, UserResponse } from "../types/user";

export function login(data: LoginRequest): Promise<UserResponse> {
  return apiFetch<UserResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function getMe(): Promise<UserResponse> {
  return apiFetch<UserResponse>("/users/me");
}
```

---

## 5. Checklist de Segurança (antes de cada feature)

- [ ] Endpoint novo passa pelo middleware `RequireSession` (a menos que seja público de propósito)?
- [ ] Resposta usa DTO com construtor explícito — nenhuma entity em `json.NewEncoder`?
- [ ] Validação de entrada feita no **service** Go (a do React é só UX)?
- [ ] Autorização (o usuário PODE fazer isso?) decidida no Go, nunca escondendo botão no front como única barreira?
- [ ] Nenhum `localStorage`/`sessionStorage` guardando credencial ou token?
- [ ] Cookie de sessão com `HttpOnly` + `Secure` + `SameSite=Strict`?
- [ ] Mensagem de erro genérica para o cliente; detalhe só no log do servidor?
- [ ] Mutação sensível (POST/PUT/DELETE) protegida também no verbo HTTP correto (SameSite=Strict cobre CSRF de navegação, mas não substitui método correto)?
