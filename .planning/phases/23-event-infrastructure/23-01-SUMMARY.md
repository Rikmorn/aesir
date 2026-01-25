---
phase: 23-event-infrastructure
plan: 01
subsystem: events
tags: [zod, nginx, event-dispatch, normalized-events]

# Dependency graph
requires:
  - phase: 22-local-dev-environment
    provides: nginx reverse proxy and docker compose setup
provides:
  - NormalizedEventSchema and NormalizedEvent type for cross-integration events
  - createId.event() for unique event ID generation
  - nginx webhook timeout and buffering configuration
affects: [23-02, 23-03, 23-04, 23-05, agents]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Normalized event schema with dotted type notation (source.resource.action)"
    - "Event ID prefix pattern (evt_) for event dispatch IDs"

key-files:
  created:
    - packages/common/src/events/schema.ts
    - packages/common/src/events/index.ts
  modified:
    - packages/common/src/utils/ids.ts
    - packages/common/src/index.ts
    - nginx/nginx.conf

key-decisions:
  - "Event type uses dotted notation (source.resource.action) for consistent parsing"
  - "Event IDs use evt_ prefix matching existing ID patterns (cred_, exec_, ws_)"
  - "nginx proxy buffering disabled for faster webhook response times"

patterns-established:
  - "NormalizedEvent schema: id, type, source, timestamp, correlationId, payload"
  - "Event type regex validation: ^(linear|github|slack)\\.[a-z_]+\\.[a-z_]+$"

# Metrics
duration: 4min
completed: 2026-01-25
---

# Phase 23 Plan 01: Foundation Event Infrastructure Summary

**NormalizedEvent Zod schema with dotted type notation, evt_ ID generator, and nginx webhook timeout hardening**

## Performance

- **Duration:** 4 min
- **Started:** 2026-01-25T21:46:00Z
- **Completed:** 2026-01-25T21:50:00Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments
- Created NormalizedEventSchema for cross-integration event dispatch with Zod validation
- Added createId.event() for generating unique event IDs (evt_ prefix)
- Hardened nginx configuration with webhook-appropriate timeouts and disabled buffering

## Task Commits

Each task was committed atomically:

1. **Task 1: Create NormalizedEvent schema and types** - `2ff9b79` (feat)
2. **Task 2: Add event ID generator to createId** - `b6581e6` (feat)
3. **Task 3: Harden nginx configuration for webhooks** - `e67933e` (chore)

## Files Created/Modified
- `packages/common/src/events/schema.ts` - NormalizedEventSchema and EventSourceSchema with Zod validation
- `packages/common/src/events/index.ts` - Barrel export for events module
- `packages/common/src/utils/ids.ts` - Added createId.event() for evt_ prefixed IDs
- `packages/common/src/index.ts` - Added events module export
- `nginx/nginx.conf` - Added webhook timeouts (5s connect, 60s read/send) and disabled buffering

## Decisions Made
- **Event type format:** Dotted notation (source.resource.action) enables consistent parsing and routing
- **Event ID prefix:** `evt_` follows existing pattern (cred_, exec_, ws_) for type identification
- **nginx timeouts:** 5s connect, 60s read/send balances responsiveness with webhook processing time
- **Buffering disabled:** Ensures faster response to webhook providers (reduces timeout risk)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- **nginx config test outside Docker:** The nginx test fails when run outside Docker Compose because upstream hostnames (linear-integration, github-integration, etc.) aren't resolvable. This is expected behavior - nginx requires DNS at startup. Configuration is valid and works correctly in Docker Compose environment.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- NormalizedEventSchema and createId.event() exported from @aesir/common
- All integrations can now import these for event normalization
- nginx ready for webhook processing with appropriate timeouts
- Ready for Plan 02: Linear event normalizer implementation

---
*Phase: 23-event-infrastructure*
*Completed: 2026-01-25*
