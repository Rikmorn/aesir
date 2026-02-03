#!/usr/bin/env bash
#
# Docker Compose Validation Script
#
# Boots all Docker Compose services, verifies health endpoints respond,
# sends a test event to agent-service /events, and tears down cleanly.
#
# Usage:
#   ./scripts/validate-docker-compose.sh              # Run full validation
#   ./scripts/validate-docker-compose.sh --keep        # Skip teardown (debugging)
#   ./scripts/validate-docker-compose.sh --timeout 180 # Custom timeout (seconds)
#
# Exit codes:
#   0 - All checks passed
#   1 - One or more checks failed

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

TIMEOUT=120
KEEP=false
POLL_INTERVAL=5
PROJECT_ROOT=""

# Colors (disabled if not a terminal)
if [ -t 1 ]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[1;33m'
  BLUE='\033[0;34m'
  NC='\033[0m' # No Color
else
  RED=''
  GREEN=''
  YELLOW=''
  BLUE=''
  NC=''
fi

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

ok()   { echo -e "${GREEN}[OK]${NC}   $1"; }
wait_msg() { echo -e "${YELLOW}[WAIT]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; }
info() { echo -e "${BLUE}[INFO]${NC} $1"; }

# Track pass/fail counts
PASS_COUNT=0
FAIL_COUNT=0

record_pass() { PASS_COUNT=$((PASS_COUNT + 1)); }
record_fail() { FAIL_COUNT=$((FAIL_COUNT + 1)); }

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------

while [[ $# -gt 0 ]]; do
  case "$1" in
    --keep)
      KEEP=true
      shift
      ;;
    --timeout)
      TIMEOUT="$2"
      shift 2
      ;;
    --timeout=*)
      TIMEOUT="${1#*=}"
      shift
      ;;
    -h|--help)
      echo "Usage: $0 [--keep] [--timeout SECONDS]"
      echo ""
      echo "Options:"
      echo "  --keep            Skip teardown after validation (useful for debugging)"
      echo "  --timeout SECS    Max wait time for health checks (default: 120)"
      echo "  -h, --help        Show this help message"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      echo "Run '$0 --help' for usage"
      exit 1
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Teardown trap
# ---------------------------------------------------------------------------

teardown() {
  if [ "$KEEP" = true ]; then
    info "Skipping teardown (--keep flag set)"
    info "Run 'docker compose down' to stop services when done"
    return
  fi
  info "Tearing down Docker Compose services..."
  cd "$PROJECT_ROOT"
  docker compose down 2>/dev/null || true
}

trap teardown EXIT

# ---------------------------------------------------------------------------
# Pre-flight checks
# ---------------------------------------------------------------------------

echo ""
echo "=============================================="
echo "  Docker Compose Validation"
echo "=============================================="
echo ""

# Verify docker compose command exists
if ! command -v docker &>/dev/null; then
  fail "docker command not found. Install Docker Desktop first."
  exit 1
fi

if ! docker compose version &>/dev/null; then
  fail "'docker compose' (v2) not available. Update Docker Desktop."
  exit 1
fi

ok "docker compose command available"

# Find project root (directory containing docker-compose.yml)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ ! -f "$PROJECT_ROOT/docker-compose.yml" ]; then
  fail "docker-compose.yml not found at $PROJECT_ROOT"
  exit 1
fi

ok "docker-compose.yml found at $PROJECT_ROOT"

cd "$PROJECT_ROOT"

# ---------------------------------------------------------------------------
# Step 1: Build and start services
# ---------------------------------------------------------------------------

echo ""
info "Building and starting Docker Compose services..."

if ! docker compose up -d --build 2>&1; then
  fail "docker compose up --build failed"
  exit 1
fi

ok "Docker Compose services started"

# ---------------------------------------------------------------------------
# Step 2: Wait for health endpoints
# ---------------------------------------------------------------------------

echo ""
info "Waiting for health endpoints (timeout: ${TIMEOUT}s, poll: ${POLL_INTERVAL}s)..."

# Services to check: name, port, expected json field
declare -a SERVICES=(
  "linear-integration:3001"
  "github-integration:3002"
  "slack-integration:3003"
  "agent-service:3004"
)

wait_for_health() {
  local name="$1"
  local port="$2"
  local url="http://localhost:${port}/health"
  local elapsed=0

  while [ "$elapsed" -lt "$TIMEOUT" ]; do
    local http_code
    local body
    body=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null) || true

    if [ "$body" = "200" ]; then
      # Double-check the response body contains "ok"
      local response
      response=$(curl -s "$url" 2>/dev/null) || true
      if echo "$response" | grep -q '"status"'; then
        ok "$name is healthy ($url)"
        record_pass
        return 0
      fi
    fi

    wait_msg "$name not ready (${elapsed}/${TIMEOUT}s)..."
    sleep "$POLL_INTERVAL"
    elapsed=$((elapsed + POLL_INTERVAL))
  done

  # Timeout reached
  fail "$name failed to become healthy within ${TIMEOUT}s"
  info "Dumping logs for $name:"
  echo "---"
  docker compose logs "$name" 2>&1 | tail -50
  echo "---"
  record_fail
  return 1
}

HEALTH_FAILED=false

for service_entry in "${SERVICES[@]}"; do
  IFS=':' read -r svc_name svc_port <<< "$service_entry"
  if ! wait_for_health "$svc_name" "$svc_port"; then
    HEALTH_FAILED=true
  fi
done

if [ "$HEALTH_FAILED" = true ]; then
  fail "One or more services failed health checks. Aborting."
  exit 1
fi

echo ""
ok "All health endpoints responding"

# ---------------------------------------------------------------------------
# Step 3: Send test event
# ---------------------------------------------------------------------------

echo ""
info "Sending test event to agent-service /events..."

TEST_EVENT='{
  "id": "validate-001",
  "type": "linear.issue.created",
  "source": "linear",
  "timestamp": "2026-02-03T00:00:00Z",
  "payload": {"issueId": "TEST-001"},
  "correlationId": "validation-run"
}'

EVENT_RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST \
  -H "Content-Type: application/json" \
  -d "$TEST_EVENT" \
  "http://localhost:3004/events" 2>/dev/null) || true

# Split response body and HTTP code
EVENT_HTTP_CODE=$(echo "$EVENT_RESPONSE" | tail -1)
EVENT_BODY=$(echo "$EVENT_RESPONSE" | sed '$d')

if [ "$EVENT_HTTP_CODE" = "200" ]; then
  ok "Test event returned HTTP 200"
  record_pass
else
  fail "Test event returned HTTP $EVENT_HTTP_CODE (expected 200)"
  fail "Response body: $EVENT_BODY"
  record_fail
fi

# Check response body contains "ignored" action
if echo "$EVENT_BODY" | grep -q '"action":"ignored"'; then
  ok "Test event correctly returned action: ignored"
  record_pass
elif echo "$EVENT_BODY" | grep -q '"action": "ignored"'; then
  # Handle pretty-printed JSON
  ok "Test event correctly returned action: ignored"
  record_pass
else
  fail "Test event response does not contain action: ignored"
  fail "Response body: $EVENT_BODY"
  record_fail
fi

# ---------------------------------------------------------------------------
# Step 4: Verify agent-service worker is running
# ---------------------------------------------------------------------------

echo ""
info "Checking agent-service logs for startup confirmation..."

if docker compose logs agent-service 2>&1 | grep -q "listening"; then
  ok "Agent service is listening (confirmed via logs)"
  record_pass
elif docker compose logs agent-service 2>&1 | grep -q "Agent service"; then
  ok "Agent service started (confirmed via logs)"
  record_pass
else
  fail "Could not confirm agent-service startup in logs"
  record_fail
fi

# ---------------------------------------------------------------------------
# Step 5: Results summary
# ---------------------------------------------------------------------------

echo ""
echo "=============================================="
echo "  Validation Results"
echo "=============================================="
echo ""

TOTAL=$((PASS_COUNT + FAIL_COUNT))

echo "  Checks passed: $PASS_COUNT / $TOTAL"

if [ "$FAIL_COUNT" -gt 0 ]; then
  echo ""
  fail "$FAIL_COUNT check(s) failed"
  echo ""
  exit 1
else
  echo ""
  ok "All checks passed"
  echo ""
  exit 0
fi
