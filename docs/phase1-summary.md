# NIDS Project — Phase 1 Summary

> **Repository:** https://github.com/simoabid/NIDS-Project  
> **Branch:** `master` | **Commits:** `2583235` · `b467f56`

---

## 1. Project Context

Starting point: three specification PDFs in `docs/`.

| Document | Key requirements extracted |
|---|---|
| `Cahier_des_charges_NIDS.pdf` | Node.js/Python/React stack, JWT/RBAC security |
| `Cahier_des_Charges_Dashboard_NIDS.pdf` | WebSocket alerts < 500 ms, real-time charts |
| `Cahier_des_charges_IA.pdf` | Scikit-Learn / TensorFlow inference, Redis Streams |

**Goal of Phase 1:** Establish a clean, compilable, production-ready foundation — no working features required, but no broken plumbing either.

---

## 2. Root Directory

### Files created

| File | Purpose |
|---|---|
| `README.md` | Architecture diagram, folder map, service ports, startup workflow |
| `.gitignore` | 59-line policy: secrets, build artifacts, ML models, captures, IDE files |
| `.env.example` | Documents every env var (blank values, safe to commit) |
| `docker-compose.yml` | Orchestrates all 8 services |

---

## 3. Infrastructure

### `docker-compose.yml` — 8 services

| Service | Image | Port | Role |
|---|---|---|---|
| `mongo` | `mongo:7` | 27017 | Primary database |
| `redis` | `redis:7-alpine` | 6379 | Pub/sub + streams |
| `ai-service` | `./ai-service` | 8000 | ML inference |
| `backend` | `./backend` | 5000 | REST API + Socket.io |
| `frontend` | `./frontend` | 3000 | React SPA |
| `nginx` | `nginx:alpine` | 80 | Reverse proxy |
| `prometheus` | `prom/prometheus` | 9090 | Metrics scraping |
| `grafana` | `grafana/grafana` | 3001 | Dashboards |

Named volumes: `mongo-data`, `redis-data`, `prometheus-data`, `grafana-data`.  
`depends_on: condition: service_healthy` — backend waits for Mongo/Redis.

### `infra/nginx/nginx.conf`

- `/api/*` → `backend:5000`
- `/socket.io/*` → `backend:5000` with `Upgrade`/`Connection` WebSocket headers
- `/*` → `frontend:3000` with SPA fallback (`try_files $uri /index.html`)
- Security headers, gzip compression, `/health` endpoint

---

## 4. Backend — Node.js / TypeScript / Express

### 4.1 Setup

**Dependencies installed:** `express`, `socket.io`, `mongoose`, `ioredis`, `jsonwebtoken`, `bcryptjs`, `express-rate-limit`, `cors`, `helmet`, `dotenv`, `winston`, `zod`, `axios`, `morgan`, `cookie-parser`

**Dev dependencies:** `typescript@6`, `ts-node-dev`, `tsconfig-paths`, `@types/*`, `jest`, `ts-jest`

**tsconfig.json:** `"module": "Node16"`, `"moduleResolution": "Node16"`, strict mode. No `baseUrl`/`paths` (deprecated in TS 6 with Node16). All relative imports use explicit `.js` extensions.

### 4.2 Files created

#### `src/config/env.ts`
Zod schema validates every env var at startup — exits immediately with a readable error list if anything is missing or malformed. Numeric and boolean vars auto-transformed from strings.

#### `src/config/logger.ts`
Winston: JSON in production, colourized in development. Morgan HTTP logging via custom stream.

#### `src/config/db.ts`
`connectDB()` / `disconnectDB()` with event logging. `autoIndex: false` in production.

#### `src/config/redis.ts`
ioredis with `lazyConnect: true`. `connectRedis()` / `disconnectRedis()` exported.

#### `src/app.ts`
Middleware stack in order:
1. `app.set('trust proxy', 1)` — real IP behind Nginx; rate-limiter correctness
2. `helmet()`, `cors()` (explicit methods + headers), `express.json()`, `express.urlencoded()`
3. `cookieParser()` — reads HttpOnly refresh-token cookie
4. **X-Request-ID middleware** — UUID per request for cross-service log correlation
5. `morgan` — includes request ID in log format
6. Global rate limiter — 100 req / 15 min per IP
7. `GET /api/health` — reports DB state + uptime
8. `app.use('/api/auth', authRoutes)`
9. 404 handler
10. Global error handler — `AppError` instances use their status code; unknown errors return 500

#### `src/index.ts`
Startup order enforced:
1. `connectDB()` → 2. `connectRedis()` → 3. `initSocket(server)` → 4. `server.listen()`

Graceful shutdown on `SIGTERM`/`SIGINT`: `server.close()` → `disconnectDB()` → `disconnectRedis()`. 10-second force-kill timeout.

#### `src/services/socketService.ts`
- JWT auth middleware on every connection (rejects unauthenticated sockets)
- RBAC rooms: all users join `viewer`, admins also join `admin`
- Event handlers: `capture:start/stop` (admin-only), `stats:request`
- Exported emit helpers: `emitAlert()`, `emitStats()`, `emitCaptureStatus()`

#### `src/types/events.ts`
`AlertPayload`, `StatsPayload`, `CaptureStatusPayload`, `ServerToClientEvents`, `ClientToServerEvents`, `InterServerEvents`, `SocketData`

#### `src/types/auth.ts`
`Role` union + `JwtPayload` interface — single definition shared across the codebase.

#### `src/types/express.d.ts`
Augments `Express.Request` with `user?: JwtPayload` — controllers get typed `req.user`.

#### `src/models/User.ts`
- `email` — unique, lowercase, `match` regex
- `password` — `select: false` (excluded from all queries by default)
- `role` — enum `'admin' | 'viewer'`, default `'viewer'`
- `{ timestamps: true }` — auto `createdAt`/`updatedAt`
- Pre-save hook — bcrypt hashes password only when modified (promise-based, Mongoose 9)
- `bcrypt rounds = 12` — ~250ms; good security/UX balance
- `comparePassword(candidate)` instance method
- `findByEmail(email)` static — normalizes email, opts-in password with `.select('+password').exec()`

#### `src/middleware/authenticate.ts`
Extracts `Bearer <token>`, validates, attaches to `req.user`. Returns `TOKEN_EXPIRED` code on expiry (frontend uses this to trigger silent refresh before redirecting to login).

#### `src/middleware/authorize.ts`
Factory: `authorize(...roles: Role[])`. Returns 403 with `yourRole` if role doesn't match.

#### `src/utils/AppError.ts`
Extends `Error` with `statusCode` + optional `code`. Factory shortcuts: `.badRequest()`, `.unauthorized()`, `.forbidden()`, `.notFound()`.

#### `src/controllers/authController.ts`

**`login`:**
1. Zod validates body
2. `User.findByEmail()` — same error for missing user AND wrong password (prevents user enumeration)
3. Signs access token (15 min, `JWT_SECRET`) + refresh token (7 days, `JWT_REFRESH_SECRET`)
4. Refresh token set as `HttpOnly; Secure; SameSite=Strict; Path=/api/auth` cookie
5. Returns `{ accessToken, user: { id, email, role } }`

**`refresh`:** Reads cookie → verifies → loads user → issues new access token + rotates refresh token.

**`logout`:** Clears the refresh cookie.

#### `src/routes/authRoutes.ts`
- `POST /login` — 5 req/15 min rate limiter, `skipSuccessfulRequests: true`
- `POST /refresh` — public
- `POST /logout` — requires `authenticate`

#### `src/scripts/seed.ts`
Idempotent admin seeder. Checks for existing admin before creating. Credentials overridable via `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`. Runs via `npm run seed`.

### 4.3 `backend/Dockerfile`

Two-stage build: `builder` (compiles TypeScript) → `production` (prod deps only, non-root user `nids:nodejs`). Exec-form `CMD` ensures SIGTERM reaches Node. `wget`-based HEALTHCHECK.

---

## 5. Frontend — React / TypeScript / Vite / Tailwind v4

### 5.1 Setup

```bash
npx create-vite@latest . --no-interactive --template react-ts
npm install socket.io-client axios react-router-dom recharts lucide-react \
            clsx tailwind-merge sonner
npm install -D tailwindcss @tailwindcss/vite
```

### 5.2 Files created

#### `vite.config.ts`
- `@tailwindcss/vite` plugin — Tailwind v4 (no `tailwind.config.ts`)
- Dev proxy: `/api` + `/socket.io` (with `ws: true`) → `localhost:5000`
- `resolve.alias: { '@': '/src' }`
- `manualChunks` function: `react`, `charts`, `socket`, `ui` bundles

#### `src/index.css`
`@import "tailwindcss"` + `@theme {}` block with CSS-native design tokens:
- `--color-brand-*` (indigo), `--color-surface-*` (dark), `--color-danger/warning/success-*`
- `--font-sans: 'Inter'`, `--font-mono: 'JetBrains Mono'`
- Custom scrollbar styling

#### `src/types/events.ts`
Frontend mirror of backend event contracts: `AlertPayload`, `StatsPayload`, `CaptureStatusPayload`, `ServerToClientEvents`, `ClientToServerEvents`.

#### `src/store/tokenStore.ts`
```typescript
let _accessToken: string | null = null
export const tokenStore = { get, set, clear, hasToken }
```
**Never `localStorage`** — module variable is inaccessible to XSS-injected scripts.

#### `src/services/api.ts`
- Base URL from `VITE_API_URL` (empty → Vite proxy in dev)
- Request interceptor: reads `tokenStore.get()`, not `localStorage`
- Response interceptor: on 401 → silent refresh → retry → dispatch `auth:expired` event

#### `src/services/socket.ts`
Typed `Socket<ServerToClientEvents, ClientToServerEvents>`. `autoConnect: false`. `connectSocket(token)` / `disconnectSocket()` exported.

#### `src/context/AuthContext.tsx`
`AuthProvider` with:
- **Silent refresh on mount** — `POST /api/auth/refresh` with `withCredentials: true`; `isLoading=true` during attempt
- **`auth:expired` listener** — window event from Axios interceptor; clears state without circular import
- `login(token, user)` — stores token, connects socket
- `logout()` — clears token, disconnects socket, calls logout endpoint
- `useAuth()` hook — throws outside provider

#### `src/components/PrivateRoute.tsx`
States: loading spinner → redirect to `/login` (with `state.from`) → role-denied page → render children. `requiredRole` prop for admin-only routes.

#### `src/App.tsx`
`<AuthProvider>` wraps `<BrowserRouter>`. Public `/login`, protected `/` and `/dashboard` via `<PrivateRoute>`.

#### `src/main.tsx`
Renders `<App>` + Sonner `<Toaster>` (dark-themed, for `alert:new` notifications).

#### `src/pages/LoginPage.tsx`
Styled form skeleton using Tailwind tokens. No submit handler yet (Phase 2).

#### `src/pages/DashboardPage.tsx`
Stat cards, chart placeholders, alert table — all with `animate-pulse`. No data yet (Phase 2).

---

## 6. AI Service Stub — `ai-service/`

Created so `docker-compose up --build` doesn't crash on the missing Dockerfile.

| File | Contents |
|---|---|
| `Dockerfile` | Python 3.12-slim, non-root user, `urllib` health check |
| `requirements.txt` | `fastapi`, `uvicorn[standard]`, `redis`; ML libs commented out |
| `src/__init__.py` | Package marker |
| `src/main.py` | `/health` + `/predict` endpoints; stub always returns `Normal / 1.0` |
| `src/schemas.py` | Pydantic `PredictRequest` / `PredictResponse` matching backend `AlertPayload` |

---

## 7. Security Architecture

| Concern | Solution |
|---|---|
| XSS token theft | Access token in JS module variable — never `localStorage` |
| CSRF | Refresh token in `HttpOnly; SameSite=Strict` cookie |
| Brute force | 5 req/15 min on login, counting only failed attempts |
| User enumeration | Same error for wrong email AND wrong password |
| Role escalation | `authorize()` checks `req.user.role` on every protected route |
| Secret leakage | `.env` in `.gitignore`; `select: false` on password field |
| Docker signals | Exec-form `CMD` — SIGTERM reaches Node, not a shell wrapper |
| Nginx proxy | `trust proxy 1` — rate-limiter sees real client IPs |

---

## 8. Git History

```
b467f56  chore: close out Phase 1
         ai-service stub, README URL fix

2583235  feat: initial project scaffold
         56 files, 14 446 insertions
```

Zero secrets ever committed. Both commits pushed to `origin/master`.

---

## 9. Phase 2 Entry Points : AI microservice (Python)

**Model training:**
- Download NSL-KDD or CICIDS2017 dataset, explore & clean features
- Train classifier with Scikit-Learn (Random Forest baseline → tune for >90% detection rate)
- Export model as `.pkl` (joblib), save feature list and scaler

**Inference API:**
- FastAPI app with `POST /predict` — accepts feature dict, returns `{ label, confidence }`
- Integrate Redis consumer: pulls raw features from stream, calls model, pushes result
- Unit tests: one sample per attack class (Normal, DoS, PortScan)

---

*Phase 1 closed — 2026-05-06 02:27*
