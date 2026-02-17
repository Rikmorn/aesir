---
phase: 76-runtime-resilience
plan: 01
subsystem: agents
tags: [mcp, retry, error-classification, backoff, observability]

# Dependency graph
requires:
  - phase: 75-echo-elimination
    provides: event pipeline foundation
provides:
  - Custom MCP retry loop with HTTP error classification (permanent/transient/network)
  - McpError extended with httpStatus, classification, retryAttempts, totalRetryMs
  - onMcpEvent callback for decoupled observability event emission
  - 4 new agent event types (mcp.error, mcp.rate_limited, mcp.retries_exhausted, notification.failed)
  - last_persisted_sequence column on conversations table for recovery context
  - McpPermanentErrorResult and McpTransientExhaustedResult structured types
affects: [76-02 failure notification routing, 76-03 recovery context]

# Tech tracking
tech-stack:
  added: []
  removed: [fetch-retry-ts]
  patterns: [exponential-backoff-with-full-jitter, http-error-classification, observability-callback-decoupling]

key-files:
  created:
    - packages/agents/src/shared/db/migrations/0012_add_resilience.sql
  modified:
    - packages/agents/src/shared/mcp/client.ts
    - packages/agents/src/shared/mcp/client.test.ts
    - packages/agents/src/shared/mcp/errors.ts
    - packages/agents/src/shared/mcp/types.ts
    - packages/agents/src/shared/db/schema.ts
    - packages/agents/src/shared/db/schema.drizzle.ts
    - packages/agents/package.json

key-decisions:
  - "Replaced fetch-retry-ts with custom retry loop -- library cannot distinguish permanent from transient errors or expose HTTP status codes"
  - "Full jitter (not decorrelated jitter) for retry delays -- simpler, sufficient for 3-attempt budget"
  - "429 with Retry-After > 10s returns error immediately rather than waiting -- prevents agent from blocking"
  - "Application-level errors (200 + isError) classified as permanent -- integration processed request but tool failed"

patterns-established:
  - "calculateDelay: exponential backoff (1s/2s/4s base) with full jitter and 10s cap"
  - "onMcpEvent callback pattern: decouples MCP client from EventLog -- caller provides event emission"
  - "McpError carries classification metadata enabling callers to build structured tool results"

requirements-completed: [RESIL-04, RESIL-05, RESIL-06, RESIL-07]

# Metrics
duration: 7min
completed: 2026-02-17
---

# Phase 76 Plan 01: MCP Error Classification Summary

**Custom MCP retry loop replacing fetch-retry-ts with permanent/transient/network error classification, exponential backoff with full jitter, and decoupled observability callbacks**

## Performance

- **Duration:** 7 min
- **Started:** 2026-02-16T23:57:22Z
- **Completed:** 2026-02-17T00:04:22Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Replaced fetch-retry-ts with custom retry loop that classifies HTTP errors as permanent (4xx), transient (429/5xx), or network
- Permanent errors (e.g., "issue not found") throw immediately with structured McpError carrying httpStatus and classification
- Transient errors retry with exponential backoff + full jitter (1s/2s/4s base, 10s cap per attempt)
- 429 Retry-After header respected up to 10s cap; errors >10s returned immediately to avoid blocking agents
- onMcpEvent callback decouples MCP client from EventLog -- emits mcp.error, mcp.rate_limited, mcp.retries_exhausted events
- Added 4 new agent event types and last_persisted_sequence column for subsequent plans
- Comprehensive test suite: 32 tests covering all error paths, retry behavior, and observability events

## Task Commits

Each task was committed atomically:

1. **Task 1: Schema foundation -- new event types, last_persisted_sequence column, MCP types** - `5229041` (feat)
2. **Task 2: Rewrite callMcpTool with custom retry, error classification, and observability** - `9a9bff0` (feat)

## Files Created/Modified
- `packages/agents/src/shared/mcp/client.ts` - Rewritten MCP client with custom retry loop and error classification
- `packages/agents/src/shared/mcp/client.test.ts` - Comprehensive test suite (32 tests) for all error paths
- `packages/agents/src/shared/mcp/errors.ts` - McpError extended with httpStatus, classification, retry metadata
- `packages/agents/src/shared/mcp/types.ts` - McpErrorClassification, onMcpEvent callback, retryable flag, structured error result types
- `packages/agents/src/shared/db/schema.ts` - 4 new event types, last_persisted_sequence column
- `packages/agents/src/shared/db/schema.drizzle.ts` - Mirror of schema.ts changes
- `packages/agents/src/shared/db/migrations/0012_add_resilience.sql` - Migration for last_persisted_sequence column
- `packages/agents/package.json` - Removed fetch-retry-ts dependency

## Decisions Made
- Replaced fetch-retry-ts with custom retry loop because the library cannot distinguish permanent from transient errors or expose HTTP status codes for classification
- Used full jitter (not decorrelated jitter) for retry delays -- simpler implementation, sufficient for 3-attempt budget
- 429 with Retry-After > 10s returns error immediately rather than waiting -- prevents agent conversations from blocking for excessive periods
- Application-level errors (HTTP 200 + isError: true) classified as permanent -- the integration processed the request but the tool operation failed

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- MCP client error classification is ready for Plan 02 (failure notification routing) to consume
- onMcpEvent callback provides the hook for Plan 02 to wire event emission into the EventLog
- last_persisted_sequence column and new event types provide schema foundation for Plan 03 (recovery context)
- All 779 tests pass (38 test files), no regressions

---
*Phase: 76-runtime-resilience*
*Completed: 2026-02-17*
