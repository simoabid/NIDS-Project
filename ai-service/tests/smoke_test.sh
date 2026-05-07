#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# AI Service — Manual Smoke Test
# ai-service/tests/smoke_test.sh
#
# Run after `docker compose up` to verify the /predict endpoint is reachable
# and returns the correct shape. Exits 0 if all checks pass, 1 on failure.
#
# Usage:
#   chmod +x tests/smoke_test.sh
#   ./tests/smoke_test.sh                     # default: localhost:8000
#   ./tests/smoke_test.sh http://ai:8000      # custom base URL
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

BASE_URL="${1:-http://localhost:8000}"
PASS=0
FAIL=0

green() { printf "\033[32m✓ %s\033[0m\n" "$1"; }
red()   { printf "\033[31m✗ %s\033[0m\n" "$1"; }
bold()  { printf "\033[1m%s\033[0m\n" "$1"; }

check() {
    local test_name="$1"
    local condition="$2"
    if eval "$condition"; then
        green "$test_name"
        PASS=$((PASS + 1))
    else
        red "$test_name"
        FAIL=$((FAIL + 1))
    fi
}

bold "═══════════════════════════════════════════════════════════════"
bold "  AI Service Smoke Test — ${BASE_URL}"
bold "═══════════════════════════════════════════════════════════════"

# ── 1. Health check ──────────────────────────────────────────────────────────
echo ""
bold "1. Health Endpoint"
HEALTH=$(curl -sf "${BASE_URL}/health" 2>&1) || { red "Health endpoint unreachable"; exit 1; }
echo "   Response: ${HEALTH}"

check "Status is ok" "echo '${HEALTH}' | python3 -c 'import sys,json; assert json.load(sys.stdin)[\"status\"]==\"ok\"'"
check "Mode is inference" "echo '${HEALTH}' | python3 -c 'import sys,json; assert json.load(sys.stdin)[\"mode\"]==\"inference\"'"
check "Model is RandomForest" "echo '${HEALTH}' | python3 -c 'import sys,json; assert json.load(sys.stdin)[\"model\"]==\"RandomForest\"'"

# ── 2. Normal traffic ────────────────────────────────────────────────────────
echo ""
bold "2. Normal Traffic Detection"
NORMAL=$(curl -sf -X POST "${BASE_URL}/predict" \
  -H "Content-Type: application/json" \
  -d '{
    "features": {
      "duration": 0, "protocol_type": "tcp", "service": "ftp_data", "flag": "SF",
      "src_bytes": 491, "dst_bytes": 0, "land": 0, "wrong_fragment": 0,
      "urgent": 0, "hot": 0, "num_failed_logins": 0, "logged_in": 0,
      "num_compromised": 0, "root_shell": 0, "su_attempted": 0, "num_root": 0,
      "num_file_creations": 0, "num_shells": 0, "num_access_files": 0,
      "num_outbound_cmds": 0, "is_host_login": 0, "is_guest_login": 0,
      "count": 2, "srv_count": 2, "serror_rate": 0.0, "srv_serror_rate": 0.0,
      "rerror_rate": 0.0, "srv_rerror_rate": 0.0, "same_srv_rate": 1.0,
      "diff_srv_rate": 0.0, "srv_diff_host_rate": 0.0, "dst_host_count": 150,
      "dst_host_srv_count": 25, "dst_host_same_srv_rate": 0.17,
      "dst_host_diff_srv_rate": 0.03, "dst_host_same_src_port_rate": 0.17,
      "dst_host_srv_diff_host_rate": 0.0, "dst_host_serror_rate": 0.0,
      "dst_host_srv_serror_rate": 0.0, "dst_host_rerror_rate": 0.05,
      "dst_host_srv_rerror_rate": 0.0
    }
  }')
echo "   Response: ${NORMAL}"
check "attackType is Normal" "echo '${NORMAL}' | python3 -c 'import sys,json; assert json.load(sys.stdin)[\"attackType\"]==\"Normal\"'"
check "label is 1" "echo '${NORMAL}' | python3 -c 'import sys,json; assert json.load(sys.stdin)[\"label\"]==1'"
check "confidence >= 0.8" "echo '${NORMAL}' | python3 -c 'import sys,json; assert json.load(sys.stdin)[\"confidence\"]>=0.8'"

# ── 3. DoS attack ────────────────────────────────────────────────────────────
echo ""
bold "3. DoS Attack Detection"
DOS=$(curl -sf -X POST "${BASE_URL}/predict" \
  -H "Content-Type: application/json" \
  -d '{
    "features": {
      "duration": 0, "protocol_type": "tcp", "service": "private", "flag": "S0",
      "src_bytes": 0, "dst_bytes": 0, "land": 0, "wrong_fragment": 0,
      "urgent": 0, "hot": 0, "num_failed_logins": 0, "logged_in": 0,
      "num_compromised": 0, "root_shell": 0, "su_attempted": 0, "num_root": 0,
      "num_file_creations": 0, "num_shells": 0, "num_access_files": 0,
      "num_outbound_cmds": 0, "is_host_login": 0, "is_guest_login": 0,
      "count": 123, "srv_count": 6, "serror_rate": 1.0, "srv_serror_rate": 1.0,
      "rerror_rate": 0.0, "srv_rerror_rate": 0.0, "same_srv_rate": 0.05,
      "diff_srv_rate": 0.07, "srv_diff_host_rate": 0.0, "dst_host_count": 255,
      "dst_host_srv_count": 26, "dst_host_same_srv_rate": 0.1,
      "dst_host_diff_srv_rate": 0.05, "dst_host_same_src_port_rate": 0.0,
      "dst_host_srv_diff_host_rate": 0.0, "dst_host_serror_rate": 1.0,
      "dst_host_srv_serror_rate": 1.0, "dst_host_rerror_rate": 0.0,
      "dst_host_srv_rerror_rate": 0.0
    }
  }')
echo "   Response: ${DOS}"
check "attackType is DoS" "echo '${DOS}' | python3 -c 'import sys,json; assert json.load(sys.stdin)[\"attackType\"]==\"DoS\"'"
check "label is 0" "echo '${DOS}' | python3 -c 'import sys,json; assert json.load(sys.stdin)[\"label\"]==0'"
check "confidence >= 0.8" "echo '${DOS}' | python3 -c 'import sys,json; assert json.load(sys.stdin)[\"confidence\"]>=0.8'"

# ── 4. PortScan attack ───────────────────────────────────────────────────────
echo ""
bold "4. PortScan Attack Detection"
SCAN=$(curl -sf -X POST "${BASE_URL}/predict" \
  -H "Content-Type: application/json" \
  -d '{
    "features": {
      "duration": 0, "protocol_type": "icmp", "service": "eco_i", "flag": "SF",
      "src_bytes": 18, "dst_bytes": 0, "land": 0, "wrong_fragment": 0,
      "urgent": 0, "hot": 0, "num_failed_logins": 0, "logged_in": 0,
      "num_compromised": 0, "root_shell": 0, "su_attempted": 0, "num_root": 0,
      "num_file_creations": 0, "num_shells": 0, "num_access_files": 0,
      "num_outbound_cmds": 0, "is_host_login": 0, "is_guest_login": 0,
      "count": 1, "srv_count": 1, "serror_rate": 0.0, "srv_serror_rate": 0.0,
      "rerror_rate": 0.0, "srv_rerror_rate": 0.0, "same_srv_rate": 1.0,
      "diff_srv_rate": 0.0, "srv_diff_host_rate": 0.0, "dst_host_count": 1,
      "dst_host_srv_count": 16, "dst_host_same_srv_rate": 1.0,
      "dst_host_diff_srv_rate": 0.0, "dst_host_same_src_port_rate": 1.0,
      "dst_host_srv_diff_host_rate": 1.0, "dst_host_serror_rate": 0.0,
      "dst_host_srv_serror_rate": 0.0, "dst_host_rerror_rate": 0.0,
      "dst_host_srv_rerror_rate": 0.0
    }
  }')
echo "   Response: ${SCAN}"
check "attackType is PortScan" "echo '${SCAN}' | python3 -c 'import sys,json; assert json.load(sys.stdin)[\"attackType\"]==\"PortScan\"'"
check "label is 2" "echo '${SCAN}' | python3 -c 'import sys,json; assert json.load(sys.stdin)[\"label\"]==2'"
check "confidence >= 0.8" "echo '${SCAN}' | python3 -c 'import sys,json; assert json.load(sys.stdin)[\"confidence\"]>=0.8'"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
bold "═══════════════════════════════════════════════════════════════"
if [ "$FAIL" -eq 0 ]; then
    green "All ${PASS} checks passed!"
    exit 0
else
    red "${FAIL} checks failed out of $((PASS + FAIL))"
    exit 1
fi
