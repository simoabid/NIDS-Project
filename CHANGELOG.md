# Changelog

All notable changes to this project will be documented in this file.

This project follows the [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) format and semantic versioning.

---

## [Unreleased]

<!-- Add Phase 3 changes here -->

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