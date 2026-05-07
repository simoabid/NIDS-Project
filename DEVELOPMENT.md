# Development Guide

## Project Structure

The NIDS project is three independent microservices communicating through a shared event pipeline:

```text
📦 nids-project/
├── ai-service/              Python · FastAPI — ML inference + Redis Streams consumer
│   ├── data/                Training datasets (gitignored CSVs)
│   │   ├── KDDTrain+.txt    NSL-KDD training set (125,973 rows)
│   │   ├── KDDTest+.txt     NSL-KDD test set (22,544 rows)
│   │   └── explore.py       Dataset exploration script
│   ├── model/               Trained artifacts (gitignored .pkl files)
│   │   ├── classifier.pkl   Random Forest (100 estimators, 120 features)
│   │   ├── scaler.pkl       ColumnTransformer (StandardScaler + OneHotEncoder)
│   │   ├── label_encoder.pkl LabelEncoder: 0=DoS, 1=Normal, 2=PortScan
│   │   └── feature_columns.json  Ordered feature names (committed — text file)
│   ├── src/
│   │   ├── __init__.py
│   │   ├── main.py          FastAPI app with lifespan (model loading + consumer)
│   │   ├── schemas.py       Pydantic request/response models
│   │   ├── preprocessing.py ColumnTransformer + LabelEncoder pipeline
│   │   ├── consumer.py      Async Redis Streams consumer (XREADGROUP → alerts Pub/Sub)
│   │   └── train.py         Training script: load → preprocess → train → evaluate → save
│   ├── tests/
│   │   ├── test_predict.py  8 pytest integration tests (real model, no mocking)
│   │   └── smoke_test.sh    12-check curl smoke test with colored output
│   ├── Dockerfile           Python 3.12-slim, non-root, urllib healthcheck
│   └── requirements.txt     fastapi, scikit-learn, pandas, redis, pytest
│
├── backend/                 TypeScript · Express — REST API + Socket.io + MongoDB
│   ├── src/
│   │   ├── config/          env.ts (Zod), db.ts (Mongo), redis.ts, logger.ts (Winston)
│   │   ├── controllers/     authController.ts (login/refresh/logout)
│   │   ├── middleware/       authenticate.ts (JWT), authorize.ts (RBAC)
│   │   ├── models/          User.ts (bcrypt, select:false password)
│   │   ├── routes/          authRoutes.ts (rate-limited login)
│   │   ├── services/        socketService.ts (rooms, emitAlert, emitStats)
│   │   ├── types/           events.ts, auth.ts, express.d.ts
│   │   ├── utils/           AppError.ts (factory methods)
│   │   ├── app.ts           Express middleware stack
│   │   └── index.ts         Startup: DB → Redis → Socket → Listen
│   ├── Dockerfile           Node 22-alpine, two-stage build
│   └── package.json
│
├── frontend/                React · TypeScript · Vite — SPA dashboard
│   ├── src/
│   │   ├── context/         AuthContext.tsx (silent refresh, socket management)
│   │   ├── components/      PrivateRoute.tsx (role-based guards)
│   │   ├── pages/           LoginPage.tsx, DashboardPage.tsx (skeleton)
│   │   ├── services/        api.ts (Axios + interceptor), socket.ts (typed client)
│   │   ├── store/           tokenStore.ts (module-variable, never localStorage)
│   │   ├── types/           events.ts (mirrors backend contracts)
│   │   └── App.tsx          Router with AuthProvider
│   ├── Dockerfile           Node 22-alpine, multi-stage Vite build + serve
│   └── package.json
│
├── infra/
│   ├── nginx/nginx.conf     Reverse proxy: /api→backend, /socket.io→backend, /*→frontend
│   ├── prometheus/          Scrape config
│   └── grafana/             Dashboard provisioning
│
├── docs/                    Specification PDFs + phase summaries
├── docker-compose.yml       8 services with health checks and named volumes
├── .env.example             Template for all environment variables
├── .gitignore               Secrets, builds, datasets, model artifacts, IDE files
├── CHANGELOG.md             Keep a Changelog format
├── CONTRIBUTING.md          Contributor guide with PR template
└── README.md                Architecture overview
```

### Data Flow

```
Zeek/Suricata → traffic:raw (Redis Stream)
             → AI Consumer (XREADGROUP)
             → Random Forest predict
             → alerts (Redis Pub/Sub)
             → Backend subscriber → emitAlert()
             → Socket.io → Frontend dashboard
```

**Latency target:** < 500ms from raw packet to dashboard alert.

---

## Service Details

### AI Service (Python / FastAPI)

**Port:** 8000

The AI service owns the ML model and is the only Python service. It operates in two modes:

1. **HTTP inference** — `POST /predict` accepts a feature dict, returns `{ attackType, confidence, label }`
2. **Stream consumer** — reads from `traffic:raw` Redis Stream, classifies flows, publishes alerts

#### Training a new model

```bash
cd ai-service
source .venv/bin/activate

# 1. Ensure datasets exist
ls data/KDDTrain+.txt data/KDDTest+.txt

# 2. Train — produces 4 artifacts in model/
python -m src.train

# 3. Verify
pytest tests/ -v                    # 8 tests, all should pass
```

Training outputs:
- `model/classifier.pkl` — Random Forest (100 estimators)
- `model/scaler.pkl` — fitted ColumnTransformer
- `model/label_encoder.pkl` — LabelEncoder (0=DoS, 1=Normal, 2=PortScan)
- `model/feature_columns.json` — ordered list of 41 raw feature names

#### Key design decisions

- **3-class mapping:** 23 NSL-KDD attack subtypes collapsed into DoS, Normal, PortScan. Simpler model, faster inference, matches the dashboard card layout.
- **ColumnTransformer:** OneHotEncoder for categorical features (protocol_type, service, flag) + StandardScaler for numerics. Produces 120 transformed features.
- **Dynamic feature alignment:** The `/predict` endpoint accepts any subset of features. Missing features default to 0. This means the data source doesn't need to know the internal model structure.
- **Graceful degradation:** If `REDIS_URL` is not set or Redis is down, the consumer is skipped and `/predict` still works for direct HTTP calls.

#### Environment variables

| Variable | Default | Description |
|---|---|---|
| `REDIS_URL` | _(empty)_ | Redis connection string. Consumer disabled if empty. |
| `MODEL_DIR` | `./model` | Path to model artifacts directory |
| `REDIS_STREAM_KEY` | `traffic:raw` | Redis Stream to consume from |
| `REDIS_ALERT_CHANNEL` | `alerts` | Pub/Sub channel for alert publishing |
| `REDIS_BATCH_SIZE` | `10` | Max messages per XREADGROUP call |

### Backend (Node.js / TypeScript / Express)

**Port:** 5000

The backend is the hub. It owns auth (JWT + RBAC), MongoDB models, Socket.io rooms, and the Redis consumer for alerts.

```bash
cd backend
npm install
npm run seed       # create admin user (idempotent)
npm run dev        # ts-node-dev hot reload on :5000
npm run build      # tsc → dist/
npm start          # production: node dist/index.js
npm test           # jest
npm run lint       # tsc --noEmit
```

#### Auth flow (dual JWT tokens)

1. `POST /api/auth/login` → validates credentials → returns access token (15 min) + sets refresh token as HttpOnly cookie (7 days)
2. Access token stored in `tokenStore` module variable (frontend) — never localStorage
3. On 401 → Axios interceptor calls `POST /api/auth/refresh` → rotates both tokens → retries original request
4. Socket.io connections authenticated via access token in `auth.token` handshake

#### Socket.io rooms

- All authenticated users join `viewer` room
- Admin users also join `admin` room
- `alert:new` events emitted to `viewer` room
- `capture:start/stop` events restricted to `admin` room

### Frontend (React / TypeScript / Vite)

**Port:** 3000

```bash
cd frontend
npm install
npm run dev        # Vite dev server, proxies /api + /socket.io to :5000
npm run build      # tsc -b && vite build
npm run lint       # eslint
```

#### Key architecture decisions

- **Token storage:** Module-level variable (`tokenStore.ts`), not localStorage. Inaccessible to XSS-injected scripts.
- **Silent refresh:** `AuthContext` attempts `POST /api/auth/refresh` on mount. If successful, the user stays logged in without re-entering credentials.
- **Typed Socket.io:** `ServerToClientEvents` and `ClientToServerEvents` interfaces mirror the backend contracts in `src/types/events.ts`.

---

## Docker Compose

All 8 services with health checks:

| # | Service | Image | Port | Depends On |
|---|---|---|---|---|
| 1 | MongoDB | `mongo:7` | 27017 | — |
| 2 | Redis | `redis:7-alpine` | 6379 | — |
| 3 | AI Service | `./ai-service` | 8000 | Redis |
| 4 | Backend | `./backend` | 5000 | Mongo, Redis, AI |
| 5 | Frontend | `./frontend` | 3000 | Backend |
| 6 | Nginx | `nginx:1.25-alpine` | 80 | Frontend, Backend |
| 7 | Prometheus | `prom/prometheus:v2.51.2` | 9090 | — |
| 8 | Grafana | `grafana/grafana:10.4.2` | 3001 | Prometheus |

```bash
cp .env.example .env                    # fill in your values
docker compose up --build -d            # build and start everything
docker compose logs -f ai-service       # tail a specific service
docker compose down                     # stop (volumes preserved)
docker compose down -v                  # stop AND wipe named volumes
```

**Important:** Run `python -m src.train` in `ai-service/` before `docker compose build`. The `.pkl` files are gitignored but must exist locally.

---

## Testing

### AI Service

```bash
cd ai-service && source .venv/bin/activate

# Unit/integration tests (loads real model, no mocking)
pytest tests/ -v

# Manual smoke test (requires running server)
uvicorn src.main:app --port 8000 &
./tests/smoke_test.sh
```

**Test coverage by class:**

| Test | Attack Class | Assertion |
|---|---|---|
| `test_normal_classification` | Normal | label=1, confidence ≥ 0.8 |
| `test_dos_classification` | DoS | label=0, confidence ≥ 0.8 |
| `test_portscan_classification` | PortScan | label=2, confidence ≥ 0.8 |

### Backend

```bash
cd backend && npm test     # jest with --passWithNoTests
```

### Frontend

```bash
cd frontend && npm test    # vitest
```

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
| Model artifacts | `.pkl` files gitignored — only `feature_columns.json` is committed |

---

## Phase Roadmap

| Phase | Focus | Status |
|---|---|---|
| Phase 1 | Project scaffold, auth, infrastructure | ✅ Complete |
| Phase 2 | AI microservice: training + inference + Redis consumer | ✅ Complete |
| Phase 3 | Backend integration + frontend dashboard wiring | 🔜 Next |
| Phase 4 | Live packet capture (Zeek/Suricata) integration | Planned |
| Phase 5 | CICIDS2017 dataset, model expansion, PFE defense prep | Planned |
