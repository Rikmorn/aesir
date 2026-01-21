---
phase: 14-platform-services
plan: 03
subsystem: integrations
tags: [webhook, idempotency, drizzle, postgresql, factory-pattern]

dependency-graph:
  requires:
    - phase: 13-data-layer
      provides: webhookDeliveries table schema
  provides:
    - DATA-03-webhook-idempotency
  affects: [webhook-handlers, linear-webhooks, github-webhooks, slack-events]

tech-stack:
  added: []
  patterns: [factory-pattern-service, atomic-insert-dedup]

key-files:
  created:
    - packages/integrations/src/services/webhook-idempotency.ts
    - packages/integrations/src/services/index.ts
  modified:
    - packages/integrations/src/index.ts

decisions:
  - id: "14-03-01"
    decision: "Use ON CONFLICT DO NOTHING with RETURNING for atomic deduplication"
    rationale: "If insert succeeds (row returned), it's new; if no row returned, it's duplicate. No race conditions."
  - id: "14-03-02"
    decision: "Log duplicates at debug level, not warn/error"
    rationale: "Duplicate webhooks are expected behavior when providers retry - not an error condition"

patterns-established:
  - "Factory pattern for services: createXService(options) returns XService interface"
  - "WEBHOOK_DELIVERY_HEADERS constant for provider-specific header names"

metrics:
  duration: "3 min"
  completed: "2026-01-21"
---

# Phase 14 Plan 03: Webhook Idempotency Service Summary

**One-liner:** Factory-pattern webhook idempotency service using PostgreSQL atomic insert for race-condition-safe duplicate detection

## Performance

- **Duration:** 3 min
- **Started:** 2026-01-21T10:27:12Z
- **Completed:** 2026-01-21T10:29:56Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Factory pattern service with dependency injection (db, logger)
- Atomic ON CONFLICT DO NOTHING deduplication - no race conditions
- Provider-specific header constants for Linear, GitHub, Slack
- health() method for connectivity checks
- Exported from @aesir/integrations package

## Task Commits

Each task was committed atomically:

1. **Task 1: Create webhook idempotency service** - `1a20c94` (feat)
2. **Task 2: Add services barrel export** - `3c9ddc2` (feat)

## Files Created/Modified

- `packages/integrations/src/services/webhook-idempotency.ts` - Core service with checkAndRecord, health, close methods (134 lines)
- `packages/integrations/src/services/index.ts` - Barrel export for services module
- `packages/integrations/src/index.ts` - Added services re-export

## Decisions Made

### 1. Atomic insert with ON CONFLICT DO NOTHING + RETURNING

**Choice:** Use Drizzle's `onConflictDoNothing().returning()` pattern

**Why:**
- If insert succeeds, row is returned (new delivery)
- If conflict occurs, no row returned (duplicate)
- Single atomic operation - no race conditions between check and insert
- Simpler than SELECT + INSERT with locking

### 2. Debug-level logging for duplicates

**Choice:** Log duplicate detections at `debug` level, not `warn` or `error`

**Why:** Duplicate webhooks are expected behavior when providers retry delivery. Logging them as warnings would create noise in logs during normal operation.

### 3. exactOptionalPropertyTypes compatibility

**Fix:** Added `| undefined` to optional `deliveryRecordId` property

**Why:** TypeScript's exactOptionalPropertyTypes requires explicit undefined in optional property types when returning `result[0]?.id`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] TypeScript exactOptionalPropertyTypes compatibility**
- **Found during:** Task 1 (build verification)
- **Issue:** `deliveryRecordId?: string` incompatible with `result[0]?.id` return
- **Fix:** Changed to `deliveryRecordId?: string | undefined`
- **Verification:** Build passes
- **Committed in:** 1a20c94 (part of Task 1 commit)

---

**Total deviations:** 1 auto-fixed (blocking)
**Impact on plan:** Minor type adjustment for TypeScript strictness. No scope creep.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

**Blockers:** None

**Ready for:**
- Plan 14-04 (Execution Tracker Service)
- Webhook handlers can now use this service for deduplication

**Integration pattern:**
```typescript
import { createWebhookIdempotencyService } from "@aesir/integrations";

const idempotencyService = createWebhookIdempotencyService({ db, logger });

// In webhook handler:
const { isDuplicate } = await idempotencyService.checkAndRecord(
  "linear",
  req.headers["linear-delivery"],
  "Issue.update"
);

if (isDuplicate) return; // Skip processing
```

---
*Phase: 14-platform-services*
*Completed: 2026-01-21*
