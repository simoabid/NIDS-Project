# 🚀 Running & Testing the NIDS Dashboard

## Current Status

Your stack is **already running** — all 8 Docker containers are up:

| Service | Container | Port | Status |
|---|---|---|---|
| MongoDB | `nids_mongo` | 27017 | ✅ Healthy |
| Redis | `nids_redis` | 6379 | ✅ Healthy |
| AI Service | `nids_ai` | 8000 | ✅ Healthy |
| Backend | `nids_backend` | 5000 | ✅ Healthy |
| Frontend | `nids_frontend` | 3000 | ⚠️ Running OLD build |
| Nginx | `nids_nginx` | 80 | ⚠️ Restarting (DNS issue) |
| Prometheus | `nids_prometheus` | 9090 | ✅ Running |
| Grafana | `nids_grafana` | 3001 | ✅ Running |

> [!WARNING]
> The frontend container is running a **5-hour-old build** — it doesn't have the new pages (AlertsPage, CapturePage, AuditPage). We need to rebuild it.

---

## Step 1: Rebuild the Frontend (picks up all new code)

```bash
docker compose up --build -d frontend
```

This rebuilds ONLY the frontend container (~30s). All other services stay untouched.

## Step 2: Fix the Nginx restart loop

```bash
docker compose restart nginx
```

The nginx container was failing because it tried to resolve the backend hostname before it was ready. A simple restart fixes it since all services are now healthy.

## Step 3: Seed the Admin User

If you haven't seeded the database yet, create the default admin account:

```bash
docker compose exec backend node dist/scripts/seed.js
```

> [!NOTE]
> If the seed script hasn't been compiled to JS yet, run it via the dev server locally:
> ```bash
> cd backend && npm run seed
> ```
> This requires MONGO_URI to be set in your `.env` pointing to `localhost:27017`.

---

## Step 4: Access the Dashboard

| What | URL |
|---|---|
| **Dashboard (via Nginx)** | http://localhost |
| **Dashboard (direct)** | http://localhost:3000 |
| **Backend API** | http://localhost:5000/api/health |
| **AI Service** | http://localhost:8000/health |
| **Grafana** | http://localhost:3001 |
| **Prometheus** | http://localhost:9090 |

### Default Admin Credentials (from seed script)
```
Email:    admin@nids.local
Password: Admin123!
```

---

## Step 5: Testing Each Feature

### 1. Login Page (`/login`)
- Open http://localhost:3000/login
- Enter admin credentials
- ✅ Should redirect to `/dashboard`
- ❌ Try wrong password → should show error message
- ✅ Check: token stored in memory (not localStorage)

### 2. Dashboard (`/dashboard`)
- ✅ 4 stat cards (Total Events, DoS, Port Scans, Detection Rate)
- ✅ Donut chart (attack type breakdown)
- ✅ Recent alerts table (compact, last 5)
- ✅ Alert banner on critical DoS alerts
- ✅ Live updates every 10s via Socket.io

### 3. Alerts Page (`/alerts`)
- ✅ Full paginated table with severity badges
- ✅ Filter dropdowns (Attack Type, Severity)
- ✅ Pagination controls
- ✅ "NEW" pulsing indicator on fresh alerts (<30s old)
- ✅ Confidence progress bars
- ✅ Monospace IPs

### 4. Capture Control (`/capture`) — Admin Only
- ✅ Status hero card (Idle state with dashed border)
- ✅ Mode tabs: Live Capture / PCAP Analysis
- ✅ Start capture with interface name (e.g., `eth0`)
- ✅ Status changes to green pulsing + mini stat boxes
- ✅ Stop capture via danger zone card
- ✅ Admin Only badge visible

### 5. Audit Log (`/audit-log`) — Admin Only
- ✅ Timeline of system events
- ✅ Color-coded action badges (auth=green, ai=indigo, capture=cyan)
- ✅ Action filter dropdown
- ✅ Expandable metadata panels (click "Metadata")
- ✅ Actor email, role badge, IP address, timestamps

### 6. Sidebar Navigation
- ✅ All 5 links work: Dashboard, Alerts, Capture, Audit Log
- ✅ Active route highlighted
- ✅ Capture & Audit only visible to admins

### 7. WebSocket Reconnection
- Open browser DevTools → Network tab → filter "ws"
- ✅ Socket connects after login
- Kill the backend temporarily: `docker compose stop backend`
- ✅ Frontend should show reconnecting state
- Restart: `docker compose start backend`
- ✅ Socket reconnects automatically
- ✅ Missed alerts fetched via REST

---

## Generating Test Data

If your dashboard is empty, you can generate test alerts using these methods:

### Method 1: AI Prediction via HTTP (inference only — returns result but doesn't push to dashboard)

```bash
# Test the AI model directly — note: categorical features MUST be strings
curl -X POST http://localhost:8000/predict \
  -H "Content-Type: application/json" \
  -d '{
    "features": {
      "duration": 0.5,
      "protocol_type": "tcp",
      "service": "http",
      "flag": "SF",
      "src_bytes": 1032,
      "dst_bytes": 0,
      "count": 511,
      "srv_count": 511,
      "dst_host_count": 255,
      "dst_host_srv_count": 255,
      "dst_host_same_srv_rate": 1.0,
      "dst_host_diff_srv_rate": 0.0
    }
  }'
```

> **Note:** `/predict` only returns the classification result. To see alerts on the dashboard,
> the data must flow through the Redis pipeline (Method 2 or 3).

### Method 2: Publish directly to the `alerts` PubSub channel (instant dashboard update)

This bypasses the AI model and sends an alert directly to the backend's subscriber → MongoDB → Socket.io → Dashboard:

```bash
# DoS alert — appears on dashboard immediately
docker compose exec redis redis-cli PUBLISH alerts \
  '{"id":"test-dos-1","sourceIp":"192.168.1.100","destinationIp":"10.0.0.1","sourcePort":54321,"destinationPort":80,"protocol":"TCP","attackType":"DoS","confidence":0.97,"packetSize":1032,"timestamp":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}'

# PortScan alert
docker compose exec redis redis-cli PUBLISH alerts \
  '{"id":"test-ps-1","sourceIp":"10.0.0.50","destinationIp":"192.168.1.1","sourcePort":44123,"destinationPort":22,"protocol":"TCP","attackType":"PortScan","confidence":0.94,"packetSize":512,"timestamp":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}'

# Normal traffic
docker compose exec redis redis-cli PUBLISH alerts \
  '{"id":"test-norm-1","sourceIp":"172.16.0.5","destinationIp":"8.8.8.8","sourcePort":39421,"destinationPort":443,"protocol":"TCP","attackType":"Normal","confidence":0.99,"packetSize":1500,"timestamp":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}'
```

### Method 3: Feed the full AI pipeline via Redis Stream (AI classifies → dashboard)

This sends raw features to the `traffic:raw` stream, which the AI consumer picks up, classifies, and publishes to the `alerts` channel automatically:

```bash
docker compose exec redis redis-cli XADD traffic:raw '*' \
  duration '0' protocol_type 'tcp' service 'http' flag 'S0' \
  src_bytes '1032' dst_bytes '0' land '0' wrong_fragment '0' urgent '0' \
  hot '0' num_failed_logins '0' logged_in '0' num_compromised '0' \
  root_shell '0' su_attempted '0' num_root '0' num_file_creations '0' \
  num_shells '0' num_access_files '0' num_outbound_cmds '0' \
  is_host_login '0' is_guest_login '0' \
  count '511' srv_count '511' serror_rate '1.0' srv_serror_rate '1.0' \
  rerror_rate '0' srv_rerror_rate '0' same_srv_rate '1.0' diff_srv_rate '0' \
  srv_diff_host_rate '0' dst_host_count '255' dst_host_srv_count '255' \
  dst_host_same_srv_rate '1.0' dst_host_diff_srv_rate '0' \
  dst_host_same_src_port_rate '1.0' dst_host_srv_diff_host_rate '0' \
  dst_host_serror_rate '1.0' dst_host_srv_serror_rate '1.0' \
  dst_host_rerror_rate '0' dst_host_srv_rerror_rate '0' \
  sourceIp '192.168.1.105' destinationIp '10.0.0.50' \
  sourcePort '44123' destinationPort '22' protocol 'TCP' packetSize '512'
```

Run these commands multiple times with different IPs/attack types to populate the dashboard.

---

## Quick Commands Reference

```bash
# Rebuild everything
docker compose up --build -d

# View logs (all services)
docker compose logs -f

# View logs (single service)
docker compose logs -f frontend
docker compose logs -f backend

# Stop everything (keep data)
docker compose down

# Stop everything (wipe data)
docker compose down -v

# Check health
docker compose ps
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Login fails with 401 | Run the seed script to create admin user |
| Dashboard is empty | Send test predictions via curl/Redis (see above) |
| Frontend shows old UI | `docker compose up --build -d frontend` |
| Nginx keeps restarting | `docker compose restart nginx` after backend is healthy |
| WebSocket not connecting | Check browser console for `[Socket] Connected` message |
| Capture start fails | Backend needs access to the network interface |
