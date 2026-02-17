---
phase: 76-runtime-resilience
verified: 2026-02-17T00:30:00Z
status: passed
score: 20/20 must-haves verified
re_verification: false
---

# Phase 76: Runtime Resilience Verification Report

**Phase Goal:** When a conversation fails, the system notifies all channels, classifies MCP errors for agent decision-making, and injects recovery context on crash resume
**Verified:** 2026-02-17T00:30:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Permanent MCP errors (4xx) returned to agent immediately without retrying | ✓ VERIFIED | client.ts lines 189-222: 4xx (except 429) throw immediately with classification "permanent", no retry loop |
| 2 | Transient MCP errors (429, 5xx) retry transparently with exponential backoff | ✓ VERIFIED | client.ts lines 224-319: 429 and 5xx retry with calculateDelay(), MAX_ATTEMPTS=3, full jitter |
| 3 | 429 Retry-After headers respected up to 10s cap | ✓ VERIFIED | client.ts lines 48-60: calculateDelay() parses Retry-After, returns -1 if >10s (MAX_DELAY_MS) |
| 4 | Agent receives structured error context (status, tool, message, params) | ✓ VERIFIED | types.ts lines 57-76: McpPermanentErrorResult and McpTransientExhaustedResult with status, tool, message, params/attempts |
| 5 | MCP observability events emittable via callback | ✓ VERIFIED | client.ts lines 206, 229, 256, 302: onMcpEvent?.() called with mcp.error, mcp.rate_limited, mcp.retries_exhausted |
| 6 | New event types in schema: mcp.error, mcp.rate_limited, mcp.retries_exhausted, notification.failed | ✓ VERIFIED | schema.ts lines 154-157: all 4 event types in agentEventTypeValues array |
| 7 | last_persisted_sequence column exists on conversations table | ✓ VERIFIED | schema.ts line 100: last_persisted_sequence column defined with default(0) |
| 8 | When conversation reaches failed status, notification sent to originating channel | ✓ VERIFIED | worker-loop.ts lines 814, 899, 932, 1708, 1811: notifyFailure called at all 5 failure paths |
| 9 | All 5 failure paths trigger notification | ✓ VERIFIED | worker-loop.ts: stale heartbeat (814), def not found (899, 932), non-retryable (1708), exception exhausted (1811) |
| 10 | When no reply_context, failure logged and skipped | ✓ VERIFIED | worker-loop.ts lines 489-497: notifyFailure checks reply_context, logs and returns early if missing |
| 11 | When notification fails, notification.failed event emitted | ✓ VERIFIED | worker-loop.ts lines 509-523: catch block emits notification.failed to eventLog on delivery failure |
| 12 | Worker stops claiming on SIGTERM, waits for in-flight | ✓ VERIFIED | worker-loop.ts lines 1887-1904: drain() sets draining=true, clears poll timer, waits for running.size === 0 |
| 13 | Drain timeout enforced, abandoned conversations logged | ✓ VERIFIED | worker-loop.ts lines 1919-1934: timeout race, logs abandoned with IDs, aborts controllers |
| 14 | Health endpoint 503 during shutdown | ✓ VERIFIED | main.ts lines 266-272: returns 503 + {status: "draining", inFlight: N} when isShuttingDown=true |
| 15 | Recovery context injected on crash resume | ✓ VERIFIED | worker-loop.ts lines 1060-1074: buildRecoveryContext called for isResumed, injected as user message |
| 16 | Recovery includes sub-agent completions, tool calls, signals | ✓ VERIFIED | worker-loop.ts lines 580-645: queries tool.succeeded, tool.failed, agent.completed, signal.received events |
| 17 | Recovery entries truncated to 200-300 chars | ✓ VERIFIED | worker-loop.ts lines 535-538: truncateOutput() helper, 200-300 char limits in switch cases |
| 18 | Recovery includes retry count and failure reason | ✓ VERIFIED | worker-loop.ts lines 577-585: retry count/max_retries and error_message in context header |
| 19 | First-iteration crashes query entire event log | ✓ VERIFIED | worker-loop.ts line 553: afterSequence = last_persisted_sequence ?? 0 (0 returns all events) |
| 20 | last_persisted_sequence updated at all persistence boundaries | ✓ VERIFIED | worker-loop.ts lines 1545, 1598, 1638, 1686, 1727, 1764: 6 persistence points set last_persisted_sequence |

**Score:** 20/20 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/agents/src/shared/mcp/client.ts` | Custom retry loop with calculateDelay | ✓ VERIFIED | 374 lines, calculateDelay() at lines 48-69, retry loop lines 148-358, onMcpEvent calls present |
| `packages/agents/src/shared/mcp/errors.ts` | McpError with statusCode, classification | ✓ VERIFIED | 98 lines, httpStatus/classification/retryAttempts/totalRetryMs fields lines 18-25 |
| `packages/agents/src/shared/mcp/types.ts` | McpErrorClassification, onMcpEvent callback | ✓ VERIFIED | 119 lines, McpErrorClassification lines 23-26, onMcpEvent lines 44-48 |
| `packages/agents/src/shared/db/schema.ts` | 4 event types, last_persisted_sequence | ✓ VERIFIED | Event types lines 154-157, column line 100 |
| `packages/agents/src/shared/db/schema.drizzle.ts` | Mirror of schema.ts changes | ✓ VERIFIED | Contains matching event types and last_persisted_sequence column |
| `packages/agents/src/shared/db/migrations/0012_add_resilience.sql` | Migration for column | ✓ VERIFIED | 8 lines, ALTER TABLE adds last_persisted_sequence |
| `packages/agents/src/framework/worker-loop.ts` | notifyFailure, buildRecoveryContext, drain timeout | ✓ VERIFIED | 1970 lines, notifyFailure lines 478-524, buildRecoveryContext 546-646, drain timeout 1887-1945 |
| `packages/agents/src/service/main.ts` | Shutdown sequence, health endpoint draining | ✓ VERIFIED | Health endpoint 503 status lines 266-272, drain timeout calculation in shutdown |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| client.ts | errors.ts | McpError construction | ✓ WIRED | 6 `new McpError` calls with httpStatus and classification |
| client.ts | types.ts | onMcpEvent callback | ✓ WIRED | 5 onMcpEvent?.() invocations with mcp.* event types |
| worker-loop.ts | denormalizer | notifyFailure calls denormalize | ✓ WIRED | 3 grep matches: import, invocation in notifyFailure |
| worker-loop.ts | schema | notification.failed event type | ✓ WIRED | 3 grep matches: eventLog.append with notification.failed |
| main.ts | worker-loop.ts | drain() call with timeout | ✓ VERIFIED | Shutdown calls executor.stopWorker() which threads timeoutMs to drain() |
| worker-loop.ts | EventLog.query | recovery context | ✓ VERIFIED | buildRecoveryContext calls eventLog.query with afterSequence filter |
| worker-loop.ts | last_persisted_sequence | updates at persistence | ✓ WIRED | 6 persistence boundaries update last_persisted_sequence via eventLog.getSequence() |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| RESIL-01 | 76-02 | All channels receive failure notification on terminal failed status | ✓ SATISFIED | notifyFailure uses denormalize (Slack, Linear, GitHub), wired at all 5 failure paths |
| RESIL-02 | 76-02 | All failure paths trigger notification | ✓ SATISFIED | 5 failure paths identified and wired: stale heartbeat, def not found x2, non-retryable, exception |
| RESIL-03 | 76-02 | notification.failed event when notification fails | ✓ SATISFIED | worker-loop.ts catch block emits notification.failed, event type in schema |
| RESIL-04 | 76-01 | MCP errors classified permanent vs transient | ✓ SATISFIED | client.ts 4xx immediate (189-222), 429/5xx retry (224-319), McpErrorClassification type |
| RESIL-05 | 76-01 | Permanent errors return structured context | ✓ SATISFIED | McpPermanentErrorResult and McpTransientExhaustedResult types with status/tool/message/params |
| RESIL-06 | 76-01 | Transient errors retried with backoff | ✓ SATISFIED | calculateDelay exponential backoff (1s/2s/4s), full jitter, 10s cap, MAX_ATTEMPTS=3 |
| RESIL-07 | 76-01 | MCP observability events emitted | ✓ SATISFIED | mcp.error, mcp.rate_limited, mcp.retries_exhausted via onMcpEvent callback |
| RESIL-08 | 76-03 | Recovery context injected on crash resume | ✓ SATISFIED | buildRecoveryContext queries event log after last_persisted_sequence, injected at resume |
| RESIL-09 | 76-03 | Retry count and status in recovery context | ✓ SATISFIED | Recovery header includes retry N/M, error_message from previous attempt |
| RESIL-10 | 76-02 | Worker drains on SIGTERM with deadline | ✓ SATISFIED | drain() timeout enforcement, AbortController abort, health 503, pg-boss stop before drain |

**Coverage:** 10/10 requirements satisfied (100%)

### Anti-Patterns Found

None. All implementation files free of TODO/FIXME/placeholder comments and console.log statements.

### Technical Validation

**Dependency cleanup:**
- ✓ fetch-retry-ts removed from package.json (verified via grep)

**Test coverage:**
- ✓ All tests pass: 779 tests passed (38 test files)
- ✓ New MCP client tests: 32 tests covering error classification, retry behavior, observability
- ✓ Worker loop tests: 58 tests including drain timeout and heartbeat

**Type safety:**
- ✓ pnpm run typecheck passes across all 9 packages
- ✓ No type errors in extended McpError, McpCallOptions, EventLog interface

**Database migration:**
- ✓ Migration 0012_add_resilience.sql exists and adds last_persisted_sequence column
- ✓ Schema and drizzle schema in sync

### Commits Verified

All 3 plans completed with atomic commits:

**Plan 01 (2 commits):**
- 5229041: Schema foundation (event types, last_persisted_sequence, MCP types)
- 9a9bff0: Custom retry loop with error classification

**Plan 02 (2 commits):**
- 79ca48d: notifyFailure replacing emitErrorActivity
- fa94f07: Graceful shutdown with drain timeout

**Plan 03 (2 commits):**
- b3acfca: Track last_persisted_sequence at persistence boundaries
- b293612: Build and inject recovery context

---

## Verification Summary

**All phase success criteria verified:**

1. ✓ Failure notifications delivered to originating channel (Slack, Linear, GitHub) via denormalizer
2. ✓ notification.failed event emitted when notification delivery fails (dashboard backstop)
3. ✓ MCP error classification: 4xx immediate, 429/5xx retry with backoff, structured context to agent
4. ✓ Recovery context on crash resume: query event log after last_persisted_sequence, format as XML block
5. ✓ Worker drains on SIGTERM: stops claiming, waits with timeout, aborts on deadline, health 503

**Phase goal achieved:** The system now notifies all channels on conversation failure, classifies MCP errors for agent decision-making, and injects recovery context on crash resume. All must-haves implemented, all requirements satisfied, all tests passing.

---

_Verified: 2026-02-17T00:30:00Z_
_Verifier: Claude (gsd-verifier)_
