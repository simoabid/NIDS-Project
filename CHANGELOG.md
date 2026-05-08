# Changelog

All notable changes to this project will be documented in this file.

This project follows the [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) format and semantic versioning.

---

## [v0.4.0] - 2026-05-08

### Added
- **AppLayout Shell** (`frontend/src/components/layout/AppLayout.tsx`) — collapsible sidebar navigation with route-aware active states, role-based link visibility (Capture/Audit hidden from viewers), top status bar with live capture indicator and logout button. Nested route structure via React Router `<Outlet>`.

- **Login Form Integration** (`frontend/src/pages/LoginPage.tsx`) — wired to `POST /api/auth/login` with `tokenStore.set()` → `connectSocket(token)` → `navigate('/dashboard')`. Error handling for 401, 429 (rate limit), and network errors. Auto-focus, shake animation, password toggle.

- **StatCards** (`frontend/src/components/dashboard/StatCards.tsx`) — four live metric cards (Total Events, DoS Attacks, Port Scans, Detection Rate) fed by `useStats()`. Updates every 10s via `stats:update` Socket.io event. K/M suffix formatting, semantic color coding, skeleton loading state.

- **TrafficDonutChart** (`frontend/src/components/dashboard/TrafficDonutChart.tsx`) — Recharts `PieChart` donut showing Normal/DoS/PortScan distribution from `useStats().dbStats.byAttackType`. Custom tooltip, center total label, empty state handling.

- **AlertBanner** (`frontend/src/components/dashboard/AlertBanner.tsx`) — persistent red/amber banner for DoS (critical) and PortScan (high) alerts. 8-second auto-dismiss with countdown progress bar. Sonner toast fires alongside for off-screen visibility. Normal traffic ignored.

- **AlertsTable** (`frontend/src/components/alerts/AlertsTable.tsx`) — reusable table with compact/full modes. Columns: Timestamp (relative + tooltip), Source IP, Destination IP, Attack Type (color-coded), Confidence (progress bar + %), Severity badge (icon + color). Left border by severity for instant scanning, pulsing dot for alerts < 30s old.

- **AlertsPage** (`frontend/src/pages/AlertsPage.tsx`) — full paginated alert history with attack type and severity filter dropdowns. Live alerts prepend via `alert:new` Socket.io event.

- **CapturePage** (`frontend/src/pages/CapturePage.tsx`) — admin-only capture control panel. Status hero card with live/idle/processing states, mode selector (Live/PCAP), start/stop controls with danger-zone styling. Synced via `useCaptureStatus()` hook (REST + Socket.io).

- **AuditPage** (`frontend/src/pages/AuditPage.tsx`) — admin-only forensic timeline. Vertical layout with domain-based color coding (Auth=blue, AI=purple, Capture=green, Alert=red, User=amber). Action and actor filter dropdowns, expandable metadata panels.

- **React hooks architecture** — three custom hooks following the REST-on-mount + Socket-on-update pattern:

  | Hook | REST | Socket Event | Reconnect |
  | :--- | :--- | :--- | :--- |
  | `useAlerts(filters?)` | `GET /api/alerts` | `alert:new` | Timestamp-based recovery |
  | `useStats()` | `GET /api/alerts/stats` | `stats:update` | Full re-fetch |
  | `useCaptureStatus()` | `GET /api/capture/status` | `capture:status` | Full re-fetch |

- **WebSocket reconnection hardening** (`frontend/src/services/socket.ts`) — `reconnectionAttempts: Infinity`, exponential back-off up to 30s, connection counter with `isReconnect()` export. Counter resets on login/logout.

- **Missed-alert recovery** (`frontend/src/hooks/useAlerts.ts`) — on reconnection, fetches alerts newer than `lastSeenTimestampRef`, deduplicates by ID (O(1) `Set` lookup), merges into existing list sorted by timestamp, capped at 200 in-memory.

- **RBAC route guards** — `/capture` and `/audit-log` wrapped in `<PrivateRoute requiredRole="admin">`. Viewers see an "Access denied" screen with role requirement message.

- **Phase 4 documentation** — `docs/phase4-summary.md` with component inventory, hooks architecture, design system tokens, and security enforcement matrix.

### Changed
- **`frontend/src/App.tsx`** — replaced all inline placeholder functions with real module imports. Nested route structure under `<AppLayout>` with admin-only `<PrivateRoute>` guards on `/capture` and `/audit-log`.
- **`frontend/src/pages/DashboardPage.tsx`** — replaced `animate-pulse` skeleton with StatCards, TrafficDonutChart, AlertBanner, and compact AlertsTable.
- **`frontend/src/services/socket.ts`** — `reconnection: true` (explicit), `reconnectionAttempts: 10 → Infinity`, `reconnectionDelayMax: 10,000 → 30,000`. Added `connectCount` counter and `isReconnect()` export for hook-level reconnection discrimination.
- **`frontend/src/index.css`** — added animation keyframes (`fade-in-up`, `banner-countdown`) and design system colour tokens.
- **All reconnect handlers** — `useAlerts`, `useStats`, `useCaptureStatus` now call `isReconnect()` to skip the initial connect event, eliminating redundant double-fetches on login.

### Design Notes
- **"Dark Luxury" aesthetic** — `#0f172a` page background, `#1e293b` card surfaces, `#6366f1` brand indigo accent. Severity colour coding consistent across all components: red=critical/DoS, orange=high/PortScan, green=low/Normal.
- **Connection counter vs custom events** — initial approach of emitting a custom `nids:reconnected` event was abandoned because `socket.emit()` sends to the server, not local listeners. The connection counter approach is simpler and doesn't leak custom events across the wire.
- **Timestamp-based recovery** — a blind page-1 re-fetch on reconnection replaces the entire alert list, losing scroll position and already-loaded data. Timestamp-based recovery fetches only the gap, merges without duplication, and preserves the existing list.

---

## [v0.3.0] - 2026-05-08

### Added
- **Alert Model** (`backend/src/models/Alert.ts`) — Mongoose schema mirroring `AlertPayload` with auto-derived severity via pre-save hook (`DoS → critical`, `PortScan → high`, `Normal → low`), 30-day TTL index, and compound indexes for dashboard query patterns.

- **AuditLog Model** (`backend/src/models/AuditLog.ts`) — security audit trail with fire-and-forget `record()` static method, 90-day TTL index. Tracks auth events, capture control, and AI decisions with actor/IP/metadata fields.

- **Traffic Capture Service** (`backend/src/services/captureService.ts`) — event-driven Suricata `eve.json` tailing via `fs.watch` + `readline`. Extracts all 41 NSL-KDD features from flow events with sliding-window statistics, publishes to Redis Stream `traffic:raw` with `MAXLEN ~10,000` eviction. Supports live and pcap replay modes.

- **Alert Subscriber** (`backend/src/services/alertSubscriber.ts`) — dedicated ioredis pub/sub connection subscribing to the `alerts` channel. Saves incoming AI predictions to MongoDB, writes audit log entries, and emits `alert:new` Socket.io events to all connected dashboard clients.

- **Stats Broadcaster** (`backend/src/services/statsBroadcaster.ts`) — 10-second interval that queries MongoDB with a single `$facet` aggregation pipeline and emits `stats:update` via Socket.io. Fires once immediately on start so dashboards don't wait for the first interval.

- **Alert REST API** — paginated alert history with filters (`attackType`, `severity`, `status`, `sourceIp`), aggregate statistics endpoint, single alert detail, and admin-only status lifecycle updates.

  | Endpoint | Method | Auth |
  | :--- | :--- | :--- |
  | `GET /api/alerts` | Paginated list | authenticate |
  | `GET /api/alerts/stats` | Aggregate breakdown | authenticate |
  | `GET /api/alerts/:id` | Single alert | authenticate |
  | `PATCH /api/alerts/:id/status` | Status update | admin |

- **Capture REST API** — admin-only endpoints for starting/stopping live capture and processing pcap files. All mutations emit `capture:status` Socket.io events and create audit log entries.

  | Endpoint | Method | Auth |
  | :--- | :--- | :--- |
  | `POST /api/capture/start` | Start live capture | admin |
  | `POST /api/capture/stop` | Stop capture | admin |
  | `POST /api/capture/pcap` | Process pcap file | admin |
  | `GET /api/capture/status` | Current state | authenticate |

- **Audit Log REST API** — `GET /api/audit-log` returning last N entries (default 100) with `action` and `actor` filters. Admin-only access.

- **Boot sequence integration** — `alertSubscriber` and `statsBroadcaster` wired into startup (after Redis + Socket.io) and graceful shutdown (clearInterval → unsubscribe → disconnect).

- **End-to-end pipeline verification** — tested full data flow: Redis `PUBLISH` → MongoDB persist → REST API returns alert; `XADD traffic:raw` → AI classifies → alert published → saved to Mongo. Auth/RBAC verified: unauthenticated → 401, viewer on admin routes → 403.

- **Phase 3 documentation** — `docs/phase3-summary.md` with step-by-step implementation details, data flow diagram, file inventory, and security matrix.

### Changed
- **`docker-compose.yml`** — Nginx `depends_on` now uses `condition: service_healthy` for backend and frontend, fixing a restart loop caused by DNS resolution failures when Nginx started before backend registered.
- **`.env.example`** — added Suricata/capture configuration: `CAPTURE_MODE`, `CAPTURE_PCAP_PATH`, `SURICATA_BIN`, `SURICATA_EVE_DIR`, `SURICATA_EVE_LOG`.
- **`backend/src/app.ts`** — mounted `alertRoutes`, `captureRoutes`, `auditRoutes`; removed TODO stubs.
- **`backend/src/index.ts`** — startup order: `connectDB → connectRedis → startAlertSubscriber → startStatsBroadcaster → listen`.
- **`backend/package.json`** — added `axios` dependency for AI service HTTP calls.

### Design Notes
- The Alert Subscriber uses a **dedicated Redis connection** for pub/sub — subscriber mode blocks all other commands on that connection, so it cannot share the main client from `config/redis.ts`.
- Severity is derived at the **model layer** (pre-save hook), not the controller, ensuring consistent severity regardless of entry point (REST API, subscriber, or direct insert).
- The Stats Broadcaster uses a single `$facet` aggregation for all metrics in **one DB round-trip**, avoiding N+1 query patterns on the 10-second interval.
- Capture service writes to Redis Streams with `MAXLEN ~10000` to bound memory usage — the `~` prefix lets Redis optimize trimming by removing entries in whole macro-nodes.

---

## [v0.2.0] - 2026-05-07

### Added
- **ML Training Pipeline** — end-to-end preprocessing and training for network traffic classification using the NSL-KDD dataset.

  | Component | Description |
  | :--- | :--- |
  | **Preprocessing** | `ColumnTransformer` pipeline: `StandardScaler` for 38 numeric features + `OneHotEncoder` for 3 categorical features (protocol_type, service, flag). `LabelEncoder` maps 23 NSL-KDD attack subtypes into 3 classes: Normal, DoS, PortScan. |
  | **Training** | Random Forest classifier (100 estimators, `class_weight="balanced"`) with 5-fold stratified cross-validation. Achieves 99.94% accuracy and >99% recall on all 3 classes. |
  | **Artifacts** | Standardized model output: `classifier.pkl`, `scaler.pkl`, `label_encoder.pkl`, `feature_columns.json` — saved to `ai-service/model/`. |

- **FastAPI Inference Service** — replaced the Phase 1 stub with a production inference engine.

  | Endpoint | Behavior |
  | :--- | :--- |
  | `GET /health` | Reports model status, inference mode, and Redis consumer stats |
  | `POST /predict` | Accepts raw feature dict, aligns columns, scales, classifies. Returns `{ attackType, confidence, label }` |

- **Async Redis Streams Consumer** — background task that reads from the `traffic:raw` stream via `XREADGROUP`, runs inference, and publishes `AlertPayload` JSON to the `alerts` Pub/Sub channel for backend consumption. Consumer groups ensure at-least-once delivery with `XACK`.

- **FastAPI Lifespan Integration** — model artifacts load once at startup (not per-request). Redis consumer runs as a managed `asyncio.Task` inside the lifespan context manager with graceful cancellation on shutdown.

- **Unit Tests** — 8 pytest integration tests using real model artifacts (no mocking). One test per attack class (Normal, DoS, PortScan) with confidence threshold ≥ 0.8. Edge case tests for partial features, empty input, and invalid payloads.

- **Smoke Test Script** — `tests/smoke_test.sh` with 12 curl-based checks (health + 3 attack classes × 3 assertions each). Colored terminal output with pass/fail summary.

- **Frontend Dockerfile** — multi-stage build: `npm ci` + `vite build` → `serve` static SPA on port 3000.

### Changed
- **`ai-service/src/schemas.py`** — `PredictRequest` now accepts a `features: dict[str, Any]` instead of fixed fields, allowing dynamic feature maps from any data source.
- **`ai-service/Dockerfile`** — added `COPY model/ ./model/` and `MODEL_DIR` environment variable for production inference.
- **`ai-service/requirements.txt`** — added `scikit-learn`, `pandas`, `numpy`, `joblib`, `pytest`, `httpx`.
- **`docker-compose.yml`** — AI service healthcheck changed from `curl` (not in slim image) to `python urllib`.

### Design Notes
- Feature vectors in tests are extracted from real NSL-KDD training rows (not synthetic) to avoid flaky results from decision boundary regions.
- The Redis consumer degrades gracefully: if `REDIS_URL` is not set or Redis is unreachable, the `/predict` HTTP endpoint still works for direct calls.
- Model artifacts (`.pkl`) are gitignored — `python -m src.train` must run locally before `docker compose build`.

---

## [v0.1.0] - 2026-05-06

### Added
- **Project Scaffold** — 8-service Docker Compose stack: MongoDB, Redis, AI Service (Python/FastAPI), Backend (Node/Express/TS), Frontend (React/Vite/Tailwind), Nginx reverse proxy, Prometheus, Grafana.

- **Backend (TypeScript/Express)** — JWT auth with dual-token flow (15-min access token in JS module, 7-day refresh token as HttpOnly cookie), RBAC middleware (`admin`/`viewer`), Zod config validation, Socket.io rooms, rate-limited login endpoint, idempotent admin seeder.

- **Frontend (React/Vite/Tailwind v4)** — SPA with `tokenStore` (XSS-safe, never localStorage), Axios interceptor with silent refresh, typed Socket.io client, `AuthContext` provider, `PrivateRoute` guard, login page skeleton, dashboard page skeleton with `animate-pulse` placeholders.

- **AI Service Stub** — FastAPI `/health` + `/predict` endpoints returning hardcoded `Normal / 1.0` so `docker compose up` completes without a trained model.

- **Infrastructure** — Nginx reverse proxy config (API + WebSocket + SPA fallback), Prometheus scrape config, Grafana provisioning directory, named Docker volumes with AOF persistence for Redis.

- **Security Architecture** — module-variable token storage, HttpOnly/SameSite cookies, brute-force rate limiting, user enumeration prevention, `select: false` on password field, exec-form Docker CMD, trust proxy for rate-limiter accuracy.

---

### Release process (copy-paste friendly)
1. Update the `Unreleased` section moving appropriate entries under a new header `## [vX.Y.Z] - YYYY-MM-DD`.
2. Update `CHANGELOG.md` and commit the change.
3. Tag the release:
   ```bash
   git tag -a vX.Y.Z -m "Release vX.Y.Z"
   git push origin vX.Y.Z
   ```