---
phase: 44-single-service-consolidation
plan: 02
subsystem: infra
tags: [docker, nginx, docker-compose, service-consolidation]

# Dependency graph
requires:
  - phase: 44-01
    provides: Service entry point (packages/agents/src/service/main.ts) and env schema
provides:
  - Updated docker-compose.yml with agent-service replacing 6 old services
  - Updated nginx.conf with unified /agent/* routing
  - Updated .env.example with agent service configuration vars
  - Updated Dockerfile CMD to dist/service/main.js
affects: [45-hitl-migration, 46-cleanup]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Single-process agent service replacing multi-service Temporal architecture

key-files:
  created: []
  modified:
    - docker-compose.yml
    - docker-config/nginx.conf
    - .env.example
    - Dockerfile

key-decisions:
  - "Removed 6 services (temporal, temporal-ui, router, dev-agent, dev-agent-worker, product-agent) replaced by single agent-service"
  - "Volume name temporal-postgresql kept to preserve existing data"

patterns-established:
  - "agent-service is the sole agent runtime with Docker socket mount and root user"

# Metrics
duration: 3min
completed: 2026-02-03
---

# Phase 44 Plan 02: Docker Infrastructure Migration Summary

**Docker Compose reduced from 12 services to 6 by replacing temporal, temporal-ui, router, dev-agent, dev-agent-worker, and product-agent with a single agent-service**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-03T10:47:41Z
- **Completed:** 2026-02-03T10:50:39Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Removed 6 service definitions from docker-compose.yml, halving service count
- All 3 integration services now route events to agent-service:3004/events
- nginx.conf consolidated from 6 upstream blocks to 4 (linear, github, slack, agent-service)
- .env.example documents new service vars (AGENT_SERVICE_PORT, MAX_CONCURRENT_CONVERSATIONS, WORKER_POLL_INTERVAL_MS, FORCE_SHUTDOWN_TIMEOUT_MS, ROUTER_ALERTS_CHANNEL) and removes Temporal vars
- Dockerfile CMD defaults to node dist/service/main.js

## Task Commits

Each task was committed atomically:

1. **Task 1: Update docker-compose.yml -- replace 6 services with agent-service** - `f7b9494` (feat)
2. **Task 2: Update nginx.conf, .env.example, and Dockerfile** - `ab229fa` (feat)

## Files Created/Modified

- `docker-compose.yml` - Removed 6 services, added agent-service with Docker socket mount, stop_grace_period, healthcheck
- `docker-config/nginx.conf` - 3 upstreams replaced by 1, 3 location blocks replaced by 1
- `.env.example` - Temporal section removed, Agent Service Configuration section added
- `Dockerfile` - CMD changed to dist/service/main.js, removed Temporal SDK comment

## Decisions Made

- Kept volume name `temporal-postgresql` unchanged to preserve existing PostgreSQL data across the migration
- Removed PRODUCT_AGENT_URL from .env.example since events now route through unified service

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Docker infrastructure fully migrated to single agent-service architecture
- Integration services configured to dispatch events to agent-service
- Ready for Phase 45 (HITL migration) and Phase 46 (cleanup)

---
*Phase: 44-single-service-consolidation*
*Completed: 2026-02-03*
