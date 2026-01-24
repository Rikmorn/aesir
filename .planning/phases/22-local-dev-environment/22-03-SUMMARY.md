---
phase: 22-local-dev-environment
plan: 03
subsystem: infra
tags: [docker, docker-compose, watch, hot-reload, development]

# Dependency graph
requires:
  - phase: 22-local-dev-environment/22-01
    provides: Integration services in docker-compose.yml
  - phase: 22-local-dev-environment/22-02
    provides: Agent services in docker-compose.yml
provides:
  - Docker Compose watch configuration for all application services
  - File-change triggered container rebuilds for source directories
  - Documentation for opt-in hot reload workflow
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "develop.watch with rebuild action for compiled services"
    - "Watch paths include src/, package.json, and dependent packages"

key-files:
  created: []
  modified:
    - "docker-compose.yml"

key-decisions:
  - "Use rebuild action instead of sync since services run from compiled dist/"
  - "Watch common/src for integrations, common+platform/src for agents"
  - "Documentation in header makes watch mode opt-in (not default)"

patterns-established:
  - "Watch mode is opt-in via docker compose watch command"
  - "Source changes trigger full container rebuild"

# Metrics
duration: 2min
completed: 2026-01-24
---

# Phase 22 Plan 03: Docker Compose Watch Configuration Summary

**Docker Compose watch mode for hot reload with rebuild action across all 5 application services**

## Performance

- **Duration:** 2 min
- **Started:** 2026-01-24T12:53:59Z
- **Completed:** 2026-01-24T12:55:58Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- Added develop.watch configuration to all application services (linear-integration, github-integration, slack-integration, dev-agent, product-agent)
- Configured rebuild action for source changes since services run from compiled dist/
- Documented watch mode usage in docker-compose.yml header with clear examples

## Task Commits

Each task was committed atomically:

1. **Task 1: Add Docker Compose watch configuration** - `bb24235` (feat)
2. **Task 2: Document watch mode in README or header** - `f8dffa0` (docs)

## Files Created/Modified
- `docker-compose.yml` - Added develop.watch to 5 services, updated header documentation

## Decisions Made
- **Rebuild over sync:** Used rebuild action instead of sync because services run from pre-compiled dist/. Syncing TypeScript source files would not work without an in-container build step.
- **Dependent package watching:** Integration services watch common/src, agent services watch common/src and platform/src to detect dependency changes.
- **Opt-in approach:** Watch mode documented as explicit command (docker compose watch) rather than default behavior, providing stable predictable startup.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Watch mode infrastructure complete
- Ready for Plan 22-05 (tunnel configuration) or Phase 22 completion
- All local development environment infrastructure now in place

---
*Phase: 22-local-dev-environment*
*Completed: 2026-01-24*
