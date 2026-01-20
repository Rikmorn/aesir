---
phase: 12-observability
plan: 07
subsystem: logging
tags:
  - pino
  - correlation-id
  - webhooks
  - observability
dependency-graph:
  requires:
    - 12-01 (pino logger foundation)
    - 12-03 (correlation utilities)
  provides:
    - Per-request correlation in webhook handlers
  affects:
    - Any debugging/tracing of webhook requests
tech-stack:
  patterns:
    - Request-scoped child loggers
    - Correlation ID propagation
key-files:
  modified:
    - packages/agents/src/api/webhooks/github-pr-review.ts
    - packages/agents/src/api/webhooks/linear-agent-session.ts
decisions: []
metrics:
  duration: 3 min
  completed: 2026-01-20
---

# Phase 12 Plan 07: Webhook Correlation Wiring Summary

Per-request correlation ID generation in webhook handlers using child loggers.

## What Was Built

This plan wired correlation ID generation into both webhook handlers to close verification gap OBSV-02. Each HTTP request now generates a unique correlation ID that appears in all resulting log entries.

### Changes Applied

**GitHub PR Review Webhook (`github-pr-review.ts`):**
- Renamed module-level `logger` to `baseLogger`
- Import `generateCorrelationId` and `createChildLogger` from `@aesir/common`
- Generate correlation ID at start of `prReviewWebhookHandler`: `generateCorrelationId("req")`
- Create child logger: `createChildLogger(baseLogger, { correlationId })`
- Pass logger to `handlePRReviewEvent` with optional parameter (backward compatible)

**Linear AgentSession Webhook (`linear-agent-session.ts`):**
- Same pattern as GitHub webhook
- Renamed module-level `logger` to `baseLogger`
- Generate correlation ID in `linearWebhookHandler`
- Create child logger with correlationId binding
- Pass logger to `handleAgentSessionWebhook`

### Log Output Example

Before:
```json
{"level":"info","timestamp":"2026-01-20T...","component":"agents:webhooks:github-pr-review","prNumber":123,"msg":"PR review received"}
```

After:
```json
{"level":"info","timestamp":"2026-01-20T...","correlationId":"req_V1StGXR8Z5jdHi6","component":"agents:webhooks:github-pr-review","prNumber":123,"msg":"PR review received"}
```

## Verification Gap Closed

**Gap 1 (OBSV-02):** HTTP Correlation IDs Not Wired

The plan chose the "generate correlation ID in each webhook handler" approach from the verification report rather than wiring the HTTP middleware. This is simpler for the current architecture where webhooks are directly handled rather than going through an Express app with middleware stack.

## Commits

| Hash | Description |
|------|-------------|
| 04e366d | feat(12-07): add per-request correlation to GitHub webhook handler |
| 34bfd99 | feat(12-07): add per-request correlation to Linear webhook handler |

## Success Criteria Verification

| Criteria | Status |
|----------|--------|
| Webhook handlers generate unique correlation ID per HTTP request | VERIFIED |
| Correlation ID appears in all log entries from that request | VERIFIED |
| No module-level logger calls remain in request path | VERIFIED |
| Build passes, existing tests pass | VERIFIED |
| Gap 1 from 12-VERIFICATION.md is closed | VERIFIED |

## Deviations from Plan

None - plan executed exactly as written.

## Files Modified

| File | Changes |
|------|---------|
| `packages/agents/src/api/webhooks/github-pr-review.ts` | +14/-3 lines |
| `packages/agents/src/api/webhooks/linear-agent-session.ts` | +14/-3 lines |

## Next Steps

- Plan 12-08 will wire Temporal logger adapter to Runtime.install (Gap 2)
- Consider adding HTTP middleware wiring if Express app is introduced later

---
*Completed: 2026-01-20*
*Duration: 3 min*
