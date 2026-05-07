# Repository Guidelines

## Project Structure & Module Organization

The stack is three independent microservices communicating through a shared event pipeline:

```
ai-service/        Python · FastAPI — ML inference + Redis Streams consumer
backend/           TypeScript · Express — REST API + Socket.io + MongoDB
frontend/          React · TypeScript · Vite — SPA dashboard
infra/             Nginx, Prometheus, Grafana configs
```

**Data flow:** Zeek/Suricata → Redis Streams → AI Service → Backend → Frontend (WebSocket push in < 500 ms).

**AI Service** is the only Python service. It owns the ML model, feature scaler, and `/predict` endpoint.

**Backend** is the hub. It owns auth (JWT + RBAC), MongoDB models, Socket.io rooms, and the Redis consumer. All cross-service decisions flow through it.

**Frontend** owns the React SPA. It uses a module-level `tokenStore` (never `localStorage`) for XSS safety. Socket connection is managed through `AuthContext`.

---

## Build, Test, and Development Commands

### Backend

```bash
npm run dev      # ts-node-dev hot reload (port 5000)
npm run build    # tsc → dist/
npm start        # node dist/index.js (production)
npm run seed     # idempotent admin seeder
npm test         # jest (--passWithNoTests)
npm run lint     # tsc --noEmit (type check only, no ESLint)
```

### Frontend

```bash
npm run dev      # Vite dev server (port 3000, proxies /api + /socket.io to :5000)
npm run build    # tsc -b && vite build
npm run lint     # eslint .
```

### AI Service

```bash
cd ai-service
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn src.main:app --reload --port 8000
```

### All Services

```bash
docker compose up --build -d   # All 8 services
docker compose logs -f
docker compose down
```

---

## Coding Style & Naming Conventions

### TypeScript (backend + frontend)

- **Strict TypeScript** — `"strict": true` in all `tsconfig.json` files. No `any`.
- **ES Module syntax** — `import/export` with explicit `.js` extensions in backend (TS 6 + `Node16` module resolution).
- **No path aliases** — `baseUrl`/`paths` is deprecated with Node16. Use relative imports.
- **Class-based errors** — `AppError` with factory shortcuts (`.badRequest()`, `.unauthorized()`, etc.).
- **Zod for config** — Environment variables validated at startup by `src/config/env.ts`. Missing vars exit immediately.
- **No mutation** — Never modify function arguments or shared state. Return new objects.

### Python (AI Service)

- Type hints expected for new functions.
- ML model files (`.pkl`) and training data (`.csv`) are gitignored — never commit them.

### Commit Format

Conventional commits only:

```
<type>: <description>

feat:   new feature
fix:    bug fix
refactor: restructure without behavior change
chore:   tooling, deps, config
docs:   documentation only
test:   tests only
perf:   performance improvement
ci:     CI/CD changes
```

---

## Testing Guidelines

- **Backend:** Jest with `--passWithNoTests`. Test files alongside source: `authController.test.ts`.
- **Frontend:** Vitest (via Vite). `npm test`.
- **AI Service:** pytest under `ai-service/tests/`.
- **Minimum coverage:** 80% for all new code.
- **Token storage:** Auth tests must use the `tokenStore` module — never `localStorage`.

---

## Security Conventions

| Concern | Pattern |
|---|---|
| XSS token theft | Access token in JS module variable — never `localStorage` |
| CSRF | Refresh token as `HttpOnly; SameSite=Strict` cookie |
| Brute force | 5 req/15 min rate limiter on `POST /api/auth/login` |
| User enumeration | Same error message for invalid email AND invalid password |
| Role escalation | `authorize()` middleware checks `req.user.role` on every protected route |
| Secrets | `.env` gitignored; never committed; `select: false` on password field |
| Docker signals | Exec-form `CMD` so SIGTERM reaches the process directly |

---

## Architecture Decisions

- **Redis Streams** is the async backbone. AI Service consumes raw features, publishes predictions. Backend consumes predictions, emits `alert:new` over Socket.io.
- **Two JWT tokens:** access token (15 min, JS module) + refresh token (7 days, HttpOnly cookie) for silent refresh.
- **RBAC via Socket.io rooms:** all users join `viewer` room; admins also join `admin`.
- **Phase 1 is a scaffold** — login page renders but has no handler; dashboard shows skeleton cards. Phase 2 wires up the live data flows.
