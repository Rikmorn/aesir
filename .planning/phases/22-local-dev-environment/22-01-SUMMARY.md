---
phase: 22-local-dev-environment
plan: 01
subsystem: integrations
tags: [docker, health-check, tini, init-process, database]
dependency-graph:
  requires: [16-linear-extraction, 17-github-extraction, 18-slack-extraction]
  provides: [container-signal-handling, database-aware-health-checks]
  affects: [22-02-docker-compose, 22-03-docker-compose]
tech-stack:
  added: [tini]
  patterns: [init-process, database-health-validation]
key-files:
  created: []
  modified:
    - packages/integrations/linear/Dockerfile
    - packages/integrations/github/Dockerfile
    - packages/integrations/slack/Dockerfile
    - packages/integrations/linear/src/main.ts
    - packages/integrations/github/src/main.ts
    - packages/integrations/slack/src/main.ts
    - packages/integrations/slack/src/api/routes.ts
decisions:
  - id: 22-01-01
    description: "Use tini as init process via apt-get in node:22-slim runtime stage"
  - id: 22-01-02
    description: "Upgrade Linear Dockerfile from node:20-slim to node:22-slim for consistency"
  - id: 22-01-03
    description: "Health checks validate database with SELECT 1 and return 503 on failure"
  - id: 22-01-04
    description: "Slack Socket Mode starts a dedicated HTTP server for health checks on same port"
metrics:
  duration: 4 min
  completed: 2026-01-24
---

# Phase 22 Plan 01: Docker Init Process and Health Checks Summary

Enhanced container infrastructure with proper signal handling and database-aware health checks.

## One-liner

tini init process for SIGTERM handling plus SELECT 1 database validation in health endpoints

## What Was Done

### Task 1: Add tini to Integration Dockerfiles

Added tini init process to all three integration Dockerfiles to solve the PID 1 signal handling problem:

**Changes:**
- Installed tini via `apt-get install -y --no-install-recommends tini`
- Added `ENTRYPOINT ["/usr/bin/tini", "--"]` before `CMD`
- Upgraded Linear Dockerfile from node:20-slim to node:22-slim for consistency

**Why tini matters:**
Node.js as PID 1 ignores signals (SIGTERM) unless explicitly handled. tini receives signals and forwards them to Node.js, enabling graceful shutdown. While Docker's `--init` flag does this, baking tini into the image ensures consistent behavior regardless of how the container is started.

**Commit:** `33322d2`

### Task 2: Enhance Health Checks with Database Validation

Updated health endpoints to validate database connectivity:

**Changes:**
- Added `SELECT 1` query to verify database connection
- Return 503 status when database is unreachable
- Added enhanced response with timestamp, uptime, and database status
- GitHub: Added health endpoint (previously missing)
- Slack Socket Mode: Added dedicated HTTP server for health checks

**Health response format:**
```json
{
  "status": "ok",
  "service": "linear-integration",
  "timestamp": 1706097600000,
  "uptime": 3600.5,
  "database": "healthy"
}
```

**Degraded response (503):**
```json
{
  "status": "degraded",
  "service": "linear-integration",
  "timestamp": 1706097600000,
  "uptime": 3600.5,
  "database": "unhealthy",
  "error": "Connection refused"
}
```

**Commit:** `e14d136`

## Decisions Made

| ID | Decision | Rationale |
|----|----------|-----------|
| 22-01-01 | Use tini via apt-get in node:22-slim | node:22-slim is Debian-based; tini available in Debian repos; minimal overhead |
| 22-01-02 | Upgrade Linear to node:22-slim | Consistency with GitHub and Slack integrations already on node:22 |
| 22-01-03 | SELECT 1 for database validation | Minimal query that confirms connection is valid; universal PostgreSQL support |
| 22-01-04 | Slack Socket Mode gets HTTP server | Socket Mode uses WebSocket only; Docker/K8s need HTTP health endpoint |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] GitHub main.ts missing health endpoint**
- **Found during:** Task 2
- **Issue:** GitHub integration had no health endpoint unlike Linear
- **Fix:** Added health endpoint with database validation
- **Files modified:** packages/integrations/github/src/main.ts
- **Commit:** e14d136

**2. [Rule 2 - Missing Critical] Slack Socket Mode missing health endpoint**
- **Found during:** Task 2
- **Issue:** Socket Mode only starts WebSocket connection, no HTTP server for health checks
- **Fix:** Added dedicated Express server on same port for health checks
- **Files modified:** packages/integrations/slack/src/main.ts
- **Commit:** e14d136

**3. [Rule 3 - Blocking] Slack routes.ts needed db parameter for health check**
- **Found during:** Task 2
- **Issue:** SlackRouterDeps interface lacked db parameter
- **Fix:** Added db to interface and passed through in createSlackRouter
- **Files modified:** packages/integrations/slack/src/api/routes.ts, packages/integrations/slack/src/main.ts
- **Commit:** e14d136

## Files Changed

| File | Change Type | Description |
|------|-------------|-------------|
| `packages/integrations/linear/Dockerfile` | Modified | Added tini install and entrypoint, upgraded to node:22-slim |
| `packages/integrations/github/Dockerfile` | Modified | Added tini install and entrypoint |
| `packages/integrations/slack/Dockerfile` | Modified | Added tini install and entrypoint |
| `packages/integrations/linear/src/main.ts` | Modified | Added database-aware health check |
| `packages/integrations/github/src/main.ts` | Modified | Added health endpoint with database validation |
| `packages/integrations/slack/src/main.ts` | Modified | Added health server for Socket Mode with database validation |
| `packages/integrations/slack/src/api/routes.ts` | Modified | Added db parameter and database-aware health check |

## Verification Results

- All three Dockerfiles have tini entrypoint: PASS
- All health endpoints execute SELECT 1: PASS
- All integration packages build successfully: PASS

## Next Phase Readiness

Plan 22-01 establishes container infrastructure prerequisites:
- Containers will properly receive and handle SIGTERM signals
- Health checks will verify actual readiness (database connectivity) not just process liveness
- Docker Compose depends_on can use health checks to order service startup

Ready to proceed with 22-02 (Docker networking) and 22-03 (Docker Compose configuration).
