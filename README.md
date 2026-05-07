# 🛡️ NIDS — Network Intrusion Detection System

An intelligent, AI-powered Network Intrusion Detection System that analyzes network traffic in real time using Machine Learning/Deep Learning to distinguish legitimate connections from cyber attacks (DoS, Port Scanning, etc.).

---

## 📐 Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Network / Internet                           │
└─────────────────────┬───────────────────────────────────────────────┘
                      │ Raw packets / .pcap files
                      ▼
          ┌───────────────────────┐
          │   Zeek / Suricata     │  ← NIDS Engine (packet inspection)
          └───────────┬───────────┘
                      │ Extracted metadata (IP, port, protocol, size)
                      ▼
          ┌───────────────────────┐
          │     Redis Streams     │  ← Async message pipeline
          └───────────┬───────────┘
                      │ Feature vectors
                      ▼
          ┌───────────────────────┐
          │   AI Service          │  ← Python microservice (FastAPI)
          │   (Scikit-Learn /     │     Inference + confidence score
          │    TensorFlow)        │
          └───────────┬───────────┘
                      │ Prediction (Normal / DoS / Port Scan)
                      ▼
          ┌───────────────────────┐
          │   Backend API         │  ← Node.js / Express (TypeScript)
          │   REST + WebSockets   │     Auth (JWT/RBAC), Audit layer
          └──────┬────────────────┘
                 │              │
          REST (HTTPS)    Socket.io push
                 │              │
          ┌──────┴──────┐  ┌────┴──────────────────┐
          │   MongoDB   │  │  Frontend Dashboard    │
          │  (Alerts +  │  │  React.js / TS /       │
          │   History)  │  │  TailwindCSS           │
          └─────────────┘  └────────────────────────┘
                                       ▲
                          Nginx reverse proxy (port 80/443)
```

**Data flow in one sentence:** Zeek/Suricata captures packets → metadata is pushed to Redis Streams → AI Service runs inference → Backend persists + pushes alerts via WebSockets → React Dashboard displays real-time alerts in < 500 ms.

---

## 📁 Folder Structure

```
nids-project/
│
├── ai-service/              # Python microservice — model training & inference
│   ├── src/
│   │   ├── main.py          # FastAPI application entry point
│   │   ├── predictor.py     # Model loading + prediction logic
│   │   ├── preprocessor.py  # Feature extraction & normalization
│   │   └── schemas.py       # Pydantic request/response schemas
│   ├── data/                # Training datasets (.csv) — gitignored if large
│   ├── model/               # Serialized model files (.pkl, .h5) — gitignored
│   ├── notebooks/           # Jupyter notebooks (EDA, training, evaluation)
│   ├── tests/               # Unit tests for inference pipeline
│   ├── requirements.txt     # Python dependencies
│   └── Dockerfile
│
├── backend/                 # Node.js / Express API (TypeScript)
│   └── src/
│       ├── config/          # DB connection, environment config
│       ├── controllers/     # Route handler logic
│       ├── middleware/       # JWT auth, RBAC, error handling, audit logger
│       ├── models/          # Mongoose schemas (Alert, User, AuditLog)
│       ├── routes/          # Express route definitions
│       └── services/
│           ├── socketService.ts   # Socket.io — push alerts to frontend
│           ├── redisService.ts    # Redis Streams consumer
│           └── auditService.ts    # Audit trail for alerts + admin actions
│   ├── package.json
│   ├── tsconfig.json
│   └── Dockerfile
│
├── frontend/                # React.js dashboard (TypeScript + TailwindCSS)
│   └── src/
│       ├── components/      # Reusable UI: AlertBanner, TrafficChart, etc.
│       ├── hooks/           # Custom hooks: useSocket, useAlerts
│       ├── pages/           # Login.tsx, Dashboard.tsx
│       ├── services/        # Axios REST client + Socket.io setup
│       └── types/           # Shared TypeScript interfaces
│   ├── tailwind.config.ts
│   ├── vite.config.ts
│   ├── package.json
│   └── Dockerfile
│
├── infra/                   # Infrastructure & DevOps configuration
│   ├── nginx/
│   │   └── nginx.conf       # Reverse proxy routing rules
│   ├── prometheus/
│   │   └── prometheus.yml   # Scrape configs for backend + ai-service metrics
│   └── grafana/
│       └── dashboards/      # Pre-built Grafana dashboard JSON exports
│
├── docs/                    # Project specifications (PDFs)
│   ├── Cahier_des_charges_NIDS.pdf
│   ├── Cahier_des_Charges_Dashboard_NIDS.pdf
│   └── Cahier_des_charges_IA.pdf
│
├── docker-compose.yml       # Orchestrates all 6 services
├── .env.example             # Environment variable template
├── .gitignore
└── README.md                # ← you are here
```

---

## 🌐 Service Ports

| Service | URL | Description |
|---|---|---|
| **Frontend** | `http://localhost:3000` | React dashboard (Vite dev server) |
| **Backend API** | `http://localhost:5000` | Express REST API + Socket.io |
| **AI Service** | `http://localhost:8000` | FastAPI inference microservice |
| **MongoDB** | `localhost:27017` | Alert history + user database |
| **Redis** | `localhost:6379` | Streaming pipeline (Redis Streams) |
| **Grafana** | `http://localhost:3001` | Monitoring dashboards |
| **Prometheus** | `http://localhost:9090` | Metrics scraping & storage |
| **Nginx** | `http://localhost:80` | Reverse proxy (production) |

> **Note:** In development, each service runs independently on its port. In production (`docker-compose up`), Nginx proxies all traffic through port 80/443.

---

## 🚀 Getting Started

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) & [Docker Compose](https://docs.docker.com/compose/install/) v2+
- [Node.js](https://nodejs.org/) ≥ 18 (for local frontend/backend dev)
- [Python](https://www.python.org/) ≥ 3.10 (for local AI service dev)
- [Zeek](https://zeek.org/) or [Suricata](https://suricata.io/) (NIDS engine — install on host)

---

### 1. Clone & Configure

```bash
git clone https://github.com/simoabid/NIDS-Project.git
cd NIDS-Project

# Copy environment template and fill in your values
cp .env.example .env
```

Edit `.env` with your settings (JWT secret, MongoDB URI, etc.).

---

### 2. Run Everything with Docker Compose

```bash
# Build and start all services in detached mode
docker-compose up --build -d

# View aggregated logs
docker-compose logs -f

# Stop all services
docker-compose down
```

The dashboard will be available at **http://localhost:3000**.

---

### 3. Run Services Individually (Development)

#### Frontend
```bash
cd frontend
npm install
npm run dev          # http://localhost:3000
```

#### Backend API
```bash
cd backend
npm install
npm run dev          # http://localhost:5000 (ts-node-dev with hot reload)
```

#### AI Service
```bash
cd ai-service
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn src.main:app --reload --port 8000
```

#### Redis (local)
```bash
docker run -d -p 6379:6379 redis:alpine
```

#### MongoDB (local)
```bash
docker run -d -p 27017:27017 mongo:7
```

---

### 4. Train the AI Model

```bash
cd ai-service
source .venv/bin/activate

# Place your dataset (e.g., NSL-KDD, CICIDS2017) in ai-service/data/
# Then run the training notebook or script:
jupyter notebook notebooks/01_train_model.ipynb
# or
python src/train.py --dataset data/cicids2017.csv --output model/nids_model.pkl
```

---

### 5. Test with a .pcap File

```bash
# Using Zeek to process an offline capture:
zeek -r path/to/capture.pcap

# Using Suricata:
suricata -r path/to/capture.pcap -l /tmp/suricata-output/
```

---

## 🔐 Authentication

The system uses **JWT + RBAC** (Role-Based Access Control).

| Role | Permissions |
|---|---|
| `admin` | Full access: start/stop capture, view all alerts, manage users |
| `viewer` | Read-only: view dashboard, alerts, and statistics |

Tokens are issued on login and must be passed in the `Authorization: Bearer <token>` header for all protected API endpoints.

---

## 📡 Key API Endpoints (Backend)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/api/auth/login` | ❌ | Authenticate and receive JWT |
| `GET` | `/api/alerts` | ✅ | Paginated alert history |
| `GET` | `/api/alerts/:id` | ✅ | Alert detail (IP, type, timestamp) |
| `GET` | `/api/stats` | ✅ | Global traffic statistics |
| `POST` | `/api/capture/start` | ✅ admin | Start real-time network capture |
| `POST` | `/api/capture/stop` | ✅ admin | Stop capture |
| `GET` | `/api/audit` | ✅ admin | Audit log of all admin actions |

**WebSocket events (Socket.io):**
- `alert:new` — emitted when the AI detects an attack; payload: `{ ip, type, confidence, timestamp }`
- `stats:update` — periodic traffic statistics update

---

## 🧪 Testing

```bash
# Backend unit + integration tests
cd backend && npm test

# AI Service tests
cd ai-service && pytest tests/

# Frontend component tests
cd frontend && npm test
```

---

## 📊 Monitoring

Once the stack is running:

- **Grafana** → `http://localhost:3001` — pre-built dashboards for detection rate, alert volume, and system health
- **Prometheus** → `http://localhost:9090` — raw metrics from backend and AI service

---

## 🏗️ Tech Stack Summary

| Layer | Technology |
|---|---|
| Frontend | React.js, TypeScript, TailwindCSS, Vite, Socket.io-client |
| Backend | Node.js, Express.js, TypeScript, Socket.io, Mongoose |
| AI Service | Python, FastAPI, Scikit-Learn / TensorFlow, Pydantic |
| Database | MongoDB |
| Streaming | Redis Streams |
| NIDS Engine | Zeek or Suricata |
| Auth | JWT, RBAC |
| Infrastructure | Docker, Docker Compose, Nginx |
| Monitoring | Prometheus, Grafana |
| Test Env | VirtualBox / GNS3, Wireshark |

---

## 📄 Specifications

Full project requirements are in [`docs/`](./docs/):

- [`Cahier_des_charges_NIDS.pdf`](./docs/Cahier_des_charges_NIDS.pdf) — global system spec (architecture, use cases, sequence diagrams)
- [`Cahier_des_Charges_Dashboard_NIDS.pdf`](./docs/Cahier_des_Charges_Dashboard_NIDS.pdf) — monitoring & dashboard module spec
- [`Cahier_des_Charges_IA.pdf`](./docs/Cahier_des_Charges_IA.pdf) — AI/ML model specification
- [Phase 1 Summary](./phase1-summary.md) — Phase 1 project summary
