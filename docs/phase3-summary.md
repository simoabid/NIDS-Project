# NIDS Project — Phase 3 Summary

> **Repository:** https://github.com/simoabid/NIDS-Project  
> **Date:** 2026-05-08

---

## 1. Phase 3 Objective

**Traffic Capture & Backend Pipeline** — Implement the backend modules that connect Suricata network monitoring to the AI service and push real-time alerts to the dashboard. This phase bridges the gap between raw network traffic and the React frontend.

**Scope:**
- MongoDB models for alerts and audit logging
- Suricata eve.json tailing service (capture → Redis Stream)
- Redis pub/sub subscriber (AI predictions → MongoDB → Socket.io)
- REST API routes for alerts, capture control, and audit logs
- Periodic stats broadcaster for dashboard charts
- End-to-end pipeline verification

---

## 2. Step-by-Step Implementation

### Step 1 — Backend Dependencies

Added packages required for Phase 3 capture and streaming:

```bash
npm install axios          # HTTP calls to AI service
```

> `child_process`, `fs`, `readline`, `crypto` are Node.js built-ins — no extra packages needed.  
> `uuid` was initially considered but replaced with `crypto.randomUUID()` for ESM compatibility.

---

### Step 2 — MongoDB Alert Model

**File:** `backend/src/models/Alert.ts`

| Feature | Detail |
|---------|--------|
| Schema | Mirrors `AlertPayload` from `types/events.ts` exactly |
| Severity | Auto-derived via Mongoose pre-save hook: `DoS → critical`, `PortScan → high`, `Normal → low`, `Unknown → medium` |
| Status lifecycle | `new → acknowledged → resolved → false_positive` |
| TTL index | `createdAt` with 30-day expiry — old alerts purged automatically |
| Compound indexes | `{ attackType, createdAt }`, `{ severity, status }`, `{ sourceIp, createdAt }` for dashboard query patterns |

---

### Step 3 — MongoDB AuditLog Model

**File:** `backend/src/models/AuditLog.ts`

| Feature | Detail |
|---------|--------|
| Multi-domain actions | `auth:login`, `auth:logout`, `capture:start`, `capture:stop`, `alert:acknowledge`, `ai:prediction`, `ai:detection`, `ai:error` |
| Static method | `AuditLog.record()` — fire-and-forget, never blocks the request/response flow |
| Actor tracking | `actor` (userId), `actorEmail`, `actorRole`, `ipAddress` |
| TTL index | 90-day expiry on `createdAt` |
| AI decision tracking | Logs model predictions with `targetType: 'prediction'` and metadata including `attackType`, `confidence`, `severity` |

---

### Step 4 — Traffic Capture Service (Suricata → Redis)

**File:** `backend/src/services/captureService.ts`

**How it works:**
```
Suricata (host) writes eve.json
    → fs.watch fires on every append (event-driven, not polling)
    → readline parses new JSON lines
    → ConnectionTracker computes sliding-window statistics
    → extractFeatures() maps eve fields to 41 NSL-KDD features
    → XADD to Redis Stream "traffic:raw" (MAXLEN ~10,000)
```

| Feature | Detail |
|---------|--------|
| Tailing method | `fs.watch` + `fs.createReadStream` (position tracking) — pure event-driven like `tail -f` |
| Feature extraction | All 41 NSL-KDD features mapped from Suricata flow metadata |
| Statistical features | 2-second sliding window: `count`, `srv_count`, `serror_rate`, `same_srv_rate`, etc. |
| Modes | `CAPTURE_MODE=live` (network interface) or `CAPTURE_MODE=pcap` (file replay for dev) |
| Malformed JSON handling | Graceful skip with error counter — Suricata can emit partial writes at flush boundaries |

**Environment variables:**
- `CAPTURE_MODE` — `live` or `pcap`
- `CAPTURE_PCAP_PATH` — path to pcap file for replay mode
- `SURICATA_BIN` — binary location (default: `/usr/bin/suricata`)
- `SURICATA_EVE_DIR` — eve.json output directory
- `SURICATA_EVE_LOG` — full path override for eve.json

---

### Step 5 — Alert Subscriber (AI → Backend → Socket.io)

**File:** `backend/src/services/alertSubscriber.ts`

**How it works:**
```
AI Service publishes JSON to Redis "alerts" pub/sub channel
    → Dedicated ioredis connection (subscriber mode)
    → Parse JSON + validate attackType against enum
    → Alert.create() in MongoDB (severity auto-derived)
    → emitAlert() via Socket.io to all "viewer" room clients
    → AuditLog.record() — ai:detection or ai:prediction
```

| Feature | Detail |
|---------|--------|
| Dedicated connection | Subscriber mode blocks all other commands — uses a separate Redis client from the main one in `config/redis.ts` |
| Type validation | `attackType` validated against `['Normal', 'DoS', 'PortScan', 'Unknown']` before Mongoose insertion |
| Logging | Attacks at `INFO` level, normal traffic at `DEBUG` |
| Stats | `received`, `saved`, `emitted`, `errors` — exposed via `getSubscriberStats()` |
| Graceful shutdown | `unsubscribe()` + `quit()` with final stats logged |

---

### Step 6 — REST API Routes

#### Alert Controller (`backend/src/controllers/alertController.ts`)

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/alerts` | GET | authenticate | Paginated list, sorted newest-first. Filters: `attackType`, `severity`, `status`, `sourceIp` |
| `/api/alerts/stats` | GET | authenticate | Aggregated statistics: `total`, `last24h`, `byAttackType`, `bySeverity`, `byStatus` |
| `/api/alerts/:id` | GET | authenticate | Single alert detail |
| `/api/alerts/:id/status` | PATCH | admin | Update alert lifecycle: `acknowledged`, `resolved`, `false_positive` |

**Implementation notes:**
- `Promise.all` on `find()` + `countDocuments()` for parallel DB queries
- `/stats` route placed before `/:id` to prevent route shadowing
- Zod validation on all query parameters

#### Capture Controller (`backend/src/controllers/captureController.ts`)

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/capture/start` | POST | admin | Start live capture on a network interface |
| `/api/capture/stop` | POST | admin | Stop active capture |
| `/api/capture/pcap` | POST | admin | Process a pcap file offline |
| `/api/capture/status` | GET | authenticate | Current capture state and stats |

**Implementation notes:**
- All mutations emit `capture:status` Socket.io event for real-time dashboard updates
- All mutations write `AuditLog.record()` entries with actor, IP, and mode metadata
- Guard against double-start: returns 400 if capture is already running

#### Audit Controller (`backend/src/controllers/auditController.ts`)

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/audit-log` | GET | admin | Last N entries (default 100), filterable by `action` and `actor` |

#### Route Files

| File | Mount Point | Auth Strategy |
|------|-------------|---------------|
| `alertRoutes.ts` | `/api/alerts` | `authenticate` at router level; `authorize('admin')` on PATCH |
| `captureRoutes.ts` | `/api/capture` | `authenticate` at router level; `authorize('admin')` on start/stop/pcap |
| `auditRoutes.ts` | `/api/audit-log` | `authenticate` + `authorize('admin')` at router level |

---

### Step 7 — Stats Broadcaster

**File:** `backend/src/services/statsBroadcaster.ts`

**How it works:**
```
setInterval(10s) → MongoDB $facet aggregation (single round-trip)
    → compute: totalPackets, normalCount, attackCount,
               detectionRate, avgConfidence, topAttackType
    → emitStats() → Socket.io "stats:update" → all dashboard clients
```

| Feature | Detail |
|---------|--------|
| Interval | 10 seconds |
| DB query | Single `$facet` aggregation pipeline — one round-trip for all metrics |
| Immediate fire | Broadcasts once immediately on start so dashboard doesn't wait 10s |
| captureActive | Reads `captureService.isActive` to reflect capture state |

---

### Step 8 — Boot Sequence & Graceful Shutdown

**File:** `backend/src/index.ts`

**Startup order:**
```
1. connectDB()              ← MongoDB
2. connectRedis()           ← Main Redis client (XADD, commands)
3. startAlertSubscriber()   ← Dedicated Redis pub/sub connection
4. startStatsBroadcaster()  ← setInterval(10s)
5. server.listen()          ← Accept HTTP + WebSocket traffic
```

**Shutdown order:**
```
1. stopStatsBroadcaster()   ← clearInterval
2. stopAlertSubscriber()    ← unsubscribe + quit
3. disconnectDB()           ← Mongoose close
4. disconnectRedis()        ← Main Redis quit
```

---

### Step 9 — App Route Registration

**File:** `backend/src/app.ts`

```typescript
app.use('/api/auth',      authRoutes);      // Phase 1
app.use('/api/alerts',    alertRoutes);      // Phase 3
app.use('/api/capture',   captureRoutes);    // Phase 3
app.use('/api/audit-log', auditRoutes);      // Phase 3
```

Removed all `// TODO: mount additional routers` stubs.

---

### Step 10 — Infrastructure Fix

**File:** `docker-compose.yml`

**Problem:** Nginx was in a restart loop because it started before the backend container registered its Docker DNS name, causing `host not found in upstream "backend:5000"`.

**Fix:** Added health check conditions to `depends_on`:
```yaml
depends_on:
  frontend:
    condition: service_healthy
  backend:
    condition: service_healthy
```

---

## 3. End-to-End Pipeline Verification

| Test | Command | Result |
|------|---------|--------|
| Redis PUBLISH → MongoDB | `redis-cli PUBLISH alerts '{DoS alert}'` | ✅ Saved with `severity: critical` auto-derived |
| Redis PUBLISH → REST API | `GET /api/alerts?limit=1` | ✅ Alert returned with all 12 fields + pagination |
| Stream → AI → MongoDB | `redis-cli XADD traffic:raw ...` | ✅ AI consumer classified, published to alerts, backend saved (6 total) |
| Alert stats | `GET /api/alerts/stats` | ✅ `{total: 6, byAttackType: {DoS: 2, PortScan: 1, Normal: 3}}` |
| Capture start (admin) | `POST /api/capture/start` | ✅ Logged attempt, fails gracefully without Suricata in Docker |
| Unauthenticated → 401 | `GET /api/alerts` (no token) | ✅ `401` |
| Viewer → admin route | `POST /api/capture/start` (viewer JWT) | ✅ `403 "Forbidden — required role: admin"` |
| Suricata installed | `suricata --build-info` | ✅ Version 8.0.4 on host |
| Docker health | `docker ps` | ✅ All 8 services up |

---

## 4. Complete Data Flow

```
┌─────────────┐     ┌──────────────┐     ┌────────────────┐
│  Suricata    │────▶│  eve.json     │────▶│ captureService │
│  (host)      │     │  (fs.watch)   │     │ (feature eng.) │
└─────────────┘     └──────────────┘     └───────┬────────┘
                                                  │ XADD
                                          ┌───────▼────────┐
                                          │  Redis Stream   │
                                          │  traffic:raw    │
                                          └───────┬────────┘
                                                  │ XREADGROUP
                                          ┌───────▼────────┐
                                          │  AI Service     │
                                          │  (RandomForest) │
                                          └───────┬────────┘
                                                  │ PUBLISH
                                          ┌───────▼────────┐
                                          │  Redis Pub/Sub  │
                                          │  "alerts"       │
                                          └───────┬────────┘
                                                  │ on('message')
                                          ┌───────▼────────┐
                                          │ alertSubscriber │
                                          │  • Alert.create │
                                          │  • AuditLog     │
                                          │  • emitAlert()  │
                                          └───────┬────────┘
                                                  │ Socket.io
                                          ┌───────▼────────┐
                                          │  Dashboard      │
                                          │  (React SPA)    │
                                          └────────────────┘
```

---

## 5. Files Created / Modified

### New Files (11)

| File | Lines | Purpose |
|------|-------|---------|
| `backend/src/models/Alert.ts` | 164 | Mongoose alert schema with TTL + severity hook |
| `backend/src/models/AuditLog.ts` | 164 | Audit trail schema with fire-and-forget record() |
| `backend/src/services/captureService.ts` | 577 | Suricata → eve.json → Redis Stream pipeline |
| `backend/src/services/alertSubscriber.ts` | 200 | Redis pub/sub → MongoDB → Socket.io |
| `backend/src/services/statsBroadcaster.ts` | 120 | 10s periodic stats aggregation |
| `backend/src/controllers/alertController.ts` | 160 | Alert CRUD + stats endpoints |
| `backend/src/controllers/captureController.ts` | 170 | Capture start/stop/pcap/status |
| `backend/src/controllers/auditController.ts` | 50 | Admin-only audit log viewer |
| `backend/src/routes/alertRoutes.ts` | 33 | Alert router with RBAC |
| `backend/src/routes/captureRoutes.ts` | 33 | Capture router with admin gates |
| `backend/src/routes/auditRoutes.ts` | 19 | Audit router (admin only) |

### Modified Files (4)

| File | Change |
|------|--------|
| `backend/src/index.ts` | Added alertSubscriber + statsBroadcaster to boot/shutdown sequence |
| `backend/src/app.ts` | Mounted 3 new route files, removed TODO stubs |
| `.env.example` | Added Suricata/capture configuration section |
| `docker-compose.yml` | Nginx depends_on with service_healthy condition |

---

## 6. Environment Variables Added

| Variable | Default | Purpose |
|----------|---------|---------|
| `CAPTURE_MODE` | `live` | `live` or `pcap` (replay mode for dev) |
| `CAPTURE_PCAP_PATH` | — | Path to pcap file for replay |
| `SURICATA_BIN` | `/usr/bin/suricata` | Suricata binary location |
| `SURICATA_EVE_DIR` | `/var/log/suricata` | Directory for eve.json |
| `SURICATA_EVE_LOG` | — | Full path override for eve.json |

---

## 7. Security Enforcement

| Route | No Token | Viewer | Admin |
|-------|----------|--------|-------|
| `GET /api/alerts` | 401 | 200 ✅ | 200 ✅ |
| `PATCH /api/alerts/:id/status` | 401 | 403 | 200 ✅ |
| `POST /api/capture/start` | 401 | 403 | 200 ✅ |
| `POST /api/capture/stop` | 401 | 403 | 200 ✅ |
| `GET /api/capture/status` | 401 | 200 ✅ | 200 ✅ |
| `GET /api/audit-log` | 401 | 403 | 200 ✅ |

---

## 8. What's Next — Phase 4

Phase 4 will wire the React frontend to consume everything built in Phase 3:

1. **Dashboard page** — live alert feed via Socket.io `alert:new` events
2. **Charts** — traffic statistics from Socket.io `stats:update` 
3. **Alert history table** — paginated data from `GET /api/alerts`
4. **Capture control panel** — admin-only start/stop via `POST /api/capture/*`
5. **Audit log page** — admin-only view from `GET /api/audit-log`
6. **Login integration** — wire the existing auth controller to the login form
