# Docker Compose Validation Checklist

Manual QA guide for validating the v2.3 unified agent-service Docker Compose deployment. Use alongside the automated validation script for comprehensive coverage.

## Prerequisites

- [ ] Docker Desktop running (`docker info` succeeds)
- [ ] `.env` file configured (copy from `.env.example`, fill in API keys)
- [ ] Database migrations run (`pnpm db:migrate`)
- [ ] MCP permissions seeded:
  ```bash
  pnpm --filter @aesir/integration-linear seed:permissions
  pnpm --filter @aesir/integration-github seed:permissions
  pnpm --filter @aesir/integration-slack seed:permissions
  ```

## Quick Automated Validation

Run the automated script for a fast pass/fail check:

```bash
./scripts/validate-docker-compose.sh
```

The script will:
1. Build and start all Docker Compose services
2. Poll health endpoints until ready (120s timeout)
3. Send a test event and verify the response
4. Tear down all services

Options:
- `--keep` -- skip teardown for manual inspection after
- `--timeout 180` -- increase wait time for slower machines

## Manual Validation Steps

### Step 1: Service Startup

Start all services and verify they come up cleanly.

```bash
docker compose up -d
```

- [ ] `docker compose ps` shows all 6 services (postgresql, nginx, linear-integration, github-integration, slack-integration, agent-service)
- [ ] All services show status "healthy" or "running"
- [ ] No error logs in startup output:
  ```bash
  docker compose logs --tail=20
  ```
- [ ] PostgreSQL is accepting connections:
  ```bash
  docker compose exec postgresql pg_isready -U temporal
  ```

### Step 2: Health Endpoints (Direct Access)

Verify each service responds to health checks via direct ports.

- [ ] Linear integration:
  ```bash
  curl -s http://localhost:3001/health
  ```
  Expected: `{"status":"ok"}` with HTTP 200

- [ ] GitHub integration:
  ```bash
  curl -s http://localhost:3002/health
  ```
  Expected: `{"status":"ok"}` with HTTP 200

- [ ] Slack integration:
  ```bash
  curl -s http://localhost:3003/health
  ```
  Expected: `{"status":"ok"}` with HTTP 200

- [ ] Agent service:
  ```bash
  curl -s http://localhost:3004/health
  ```
  Expected: `{"status":"ok","service":"agent-service"}` with HTTP 200

### Step 3: Nginx Routing

Verify nginx proxies requests correctly to each service.

- [ ] Nginx health:
  ```bash
  curl -s http://localhost/health
  ```
  Expected: `{"status":"ok","service":"nginx"}` with HTTP 200

- [ ] Linear via nginx:
  ```bash
  curl -s http://localhost/linear/health
  ```
  Expected: `{"status":"ok"}` (proxied to linear-integration:3001)

- [ ] GitHub via nginx:
  ```bash
  curl -s http://localhost/github/health
  ```
  Expected: `{"status":"ok"}` (proxied to github-integration:3002)

- [ ] Slack via nginx:
  ```bash
  curl -s http://localhost/slack/health
  ```
  Expected: `{"status":"ok"}` (proxied to slack-integration:3003)

- [ ] Agent service via nginx:
  ```bash
  curl -s http://localhost/agent/health
  ```
  Expected: `{"status":"ok","service":"agent-service"}` (proxied to agent-service:3004)

- [ ] Nginx root route listing:
  ```bash
  curl -s http://localhost/
  ```
  Expected: JSON with available routes

### Step 4: Event Routing

Verify the agent-service correctly routes events.

- [ ] Send test event directly to agent-service:
  ```bash
  curl -s -X POST http://localhost:3004/events \
    -H "Content-Type: application/json" \
    -d '{
      "id": "manual-test-001",
      "type": "linear.issue.created",
      "source": "linear",
      "timestamp": "2026-02-03T00:00:00Z",
      "payload": {"issueId": "TEST-001"},
      "correlationId": "manual-validation"
    }'
  ```
  Expected: `{"received":true,"action":"ignored"}` with HTTP 200

- [ ] Send test event via nginx proxy:
  ```bash
  curl -s -X POST http://localhost/agent/events \
    -H "Content-Type: application/json" \
    -d '{
      "id": "manual-test-002",
      "type": "linear.issue.created",
      "source": "linear",
      "timestamp": "2026-02-03T00:00:00Z",
      "payload": {"issueId": "TEST-002"},
      "correlationId": "manual-validation-proxy"
    }'
  ```
  Expected: `{"received":true,"action":"ignored"}` (routed through nginx)

- [ ] Verify invalid event is rejected:
  ```bash
  curl -s -X POST http://localhost:3004/events \
    -H "Content-Type: application/json" \
    -d '{"bad": "data"}'
  ```
  Expected: HTTP 400 with validation error

### Step 5: Management Endpoints

Verify conversation management endpoints handle edge cases correctly.

- [ ] Get nonexistent conversation:
  ```bash
  curl -s -w "\n%{http_code}" http://localhost:3004/conversations/nonexistent
  ```
  Expected: HTTP 404 with `{"error":"Conversation not found"}`

- [ ] Cancel nonexistent conversation:
  ```bash
  curl -s -w "\n%{http_code}" -X POST http://localhost:3004/conversations/nonexistent/cancel
  ```
  Expected: HTTP 409 with `{"error":"Conversation already in terminal state"}` or HTTP 500

### Step 6: Worker Loop Verification

Verify the agent-service worker loop is running.

- [ ] Check logs for startup confirmation:
  ```bash
  docker compose logs agent-service 2>&1 | grep -i "listening"
  ```
  Expected: Line containing "Agent service listening"

- [ ] No recurring errors after 30 seconds of running:
  ```bash
  sleep 30 && docker compose logs --tail=30 agent-service 2>&1 | grep -i "error"
  ```
  Expected: No error lines (or only expected startup warnings)

### Step 7: Graceful Shutdown

Verify the agent-service shuts down cleanly.

- [ ] Stop agent-service:
  ```bash
  docker compose stop agent-service
  ```

- [ ] Check shutdown logs:
  ```bash
  docker compose logs --tail=10 agent-service
  ```
  Expected: "Graceful shutdown initiated" and "Graceful shutdown complete"

- [ ] Restart agent-service:
  ```bash
  docker compose up -d agent-service
  ```

- [ ] Verify it becomes healthy again:
  ```bash
  sleep 15 && curl -s http://localhost:3004/health
  ```
  Expected: `{"status":"ok","service":"agent-service"}`

### Step 8: Service Independence

Verify services can operate independently.

- [ ] Stop agent-service while integrations keep running:
  ```bash
  docker compose stop agent-service
  curl -s http://localhost:3001/health  # Should still work
  curl -s http://localhost:3002/health  # Should still work
  curl -s http://localhost:3003/health  # Should still work
  ```
  Expected: All 3 integration health endpoints still respond with 200

- [ ] Restart agent-service:
  ```bash
  docker compose up -d agent-service
  sleep 15 && curl -s http://localhost:3004/health
  ```
  Expected: Agent service starts and becomes healthy after integrations are already running

## Post-Validation

### Tear Down

```bash
docker compose down
```

### Clean Up Volumes (if needed)

**WARNING: This destroys all database data (credentials, migrations, etc.).**

```bash
docker compose down -v
```

After destroying volumes, you must re-run migrations and seed permissions.

## Known Cosmetic Issues (Phase 47)

These are documented for cleanup in Phase 47 and do NOT affect functionality:

1. **POSTGRES_USER/PASSWORD/DB are "temporal"** -- Named after original Temporal usage; functionally the database serves all schemas. Rename to `aesir` in Phase 47.
2. **Volume name is "aesir-temporal-postgresql"** -- Kept unchanged to preserve existing PostgreSQL data across service consolidation. Will be renamed when safe.
3. **Temporal service references removed but naming lingers** -- Environment variables and configs still reference temporal naming conventions.

## Validation Matrix

| Check | Direct | Via Nginx | Status |
|-------|--------|-----------|--------|
| Linear health | :3001/health | /linear/health | |
| GitHub health | :3002/health | /github/health | |
| Slack health | :3003/health | /slack/health | |
| Agent health | :3004/health | /agent/health | |
| Nginx health | N/A | /health | |
| Event routing | :3004/events | /agent/events | |
| Conversation GET | :3004/conversations/:id | /agent/conversations/:id | |
| Conversation cancel | :3004/conversations/:id/cancel | /agent/conversations/:id/cancel | |
| Graceful shutdown | docker compose stop | N/A | |
| Service independence | docker compose stop agent-service | N/A | |
