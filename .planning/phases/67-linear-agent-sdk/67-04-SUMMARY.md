---
phase: 67-linear-agent-sdk
plan: 04
subsystem: communication
tags: [linear, agent-sdk, echo-filter, error-activity, prompt, webhook, cleanup]

# Dependency graph
requires:
  - phase: 67-03
    provides: "Denormalizer routing with agentSessionId, intent-to-activity-type mapping"
provides:
  - "Echo filter removed -- all comments dispatched without userId filtering"
  - "Error activity emission on conversation failure when Linear agent session present"
  - "Dev-agent prompt guidance for notify(reasoning) and notify(action) intents"
  - "LINEAR_BOT_USER_ID env var fully removed from codebase"
affects: [68-shared-memory]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Best-effort error activity: emitErrorActivity fires before status=failed, wrapped in try/catch, never masks original error"
    - "Contextual error messages: different messages for token budget exhaustion, agent abort, and generic failures"

key-files:
  created: []
  modified:
    - packages/integrations/linear/src/api/webhooks.ts
    - packages/integrations/linear/src/api/webhooks.test.ts
    - packages/integrations/linear/src/types/config.ts
    - packages/agents/src/framework/worker-loop.ts
    - packages/agents/definitions/dev-agent/prompt.md
    - .env.example

key-decisions:
  - "Error activity emission in worker-loop.ts (not conversation-executor.ts) because failure transitions happen in the worker loop's executeConversation function"
  - "Three contextual error messages based on failure type: token budget, agent abort, generic -- gives users actionable feedback"
  - "emitErrorActivity uses dynamic import for callMcpTool to avoid circular dependencies"

patterns-established:
  - "Error activity pattern: check replyContext.channel === 'linear' && replyContext.agentSessionId, then fire best-effort MCP call"

# Metrics
duration: 4min
completed: 2026-02-10
---

# Phase 67 Plan 04: Echo Filter Removal, Error Activity Emission, and Dev-Agent Prompt Update Summary

**Echo filter removed (dead code after agent activities), error activities emitted on conversation failure for Linear UX, dev-agent prompt teaches notify intent usage**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-10T15:49:16Z
- **Completed:** 2026-02-10T15:53:27Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Removed echo filter and LINEAR_BOT_USER_ID from webhook handler, config schema, env example, and tests
- Added emitErrorActivity helper in worker-loop that fires best-effort error activities to Linear when conversations fail
- Three contextual error messages: token budget exhausted, agent aborted, or generic failure
- Added "Communication on Linear" section to dev-agent prompt teaching notify(reasoning) and notify(action) usage
- All Phase 67 requirements (LSDK-01 through LSDK-07, LSDK-09) now satisfied

## Task Commits

Each task was committed atomically:

1. **Task 1: Remove echo filter and LINEAR_BOT_USER_ID from webhook handler and config** - `f33c77d` (feat)
2. **Task 2: Add error activity emission on failure and update dev-agent prompt** - `c774da3` (feat)

## Files Created/Modified
- `packages/integrations/linear/src/api/webhooks.ts` - Removed echo filter block, replaced with explanatory comment
- `packages/integrations/linear/src/api/webhooks.test.ts` - Rewrote tests to verify all comments dispatched without filtering
- `packages/integrations/linear/src/types/config.ts` - Removed LINEAR_BOT_USER_ID from env schema and config object
- `packages/agents/src/framework/worker-loop.ts` - Added emitErrorActivity helper and calls from two failure paths
- `packages/agents/definitions/dev-agent/prompt.md` - Added Communication on Linear section with activity intent guidance
- `.env.example` - Removed LINEAR_BOT_USER_ID entry and comments

## Decisions Made
- **Error activity in worker-loop.ts:** The plan specified conversation-executor.ts, but actual failure transitions happen in worker-loop.ts's `executeConversation` function. The executor only handles data operations (start, signal, get, cancel, list). Placing the error activity emission in the worker loop is correct because that's where conversations transition to `failed` status.
- **Dynamic import for callMcpTool:** Used `await import("../shared/mcp/client.js")` inside the helper to avoid adding a top-level import that could introduce circular dependencies or unnecessary module loading.
- **Two failure paths covered:** Non-retryable error path (token budget exhausted, agent aborted, max retries) and unexpected error catch block. Stale recovery path not covered because the conversation row isn't fully available there (would need additional DB read for minimal benefit).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Error activity emission added to worker-loop.ts instead of conversation-executor.ts**
- **Found during:** Task 2 (error activity emission)
- **Issue:** Plan specified conversation-executor.ts but that file contains only data operations. Actual failure transitions (status -> "failed") happen in worker-loop.ts's executeConversation function.
- **Fix:** Added emitErrorActivity helper and calls in worker-loop.ts instead
- **Files modified:** packages/agents/src/framework/worker-loop.ts
- **Verification:** Typecheck passes, error paths correctly call emitErrorActivity before DB update
- **Committed in:** c774da3 (Task 2 commit)

**2. [Rule 1 - Bug] Updated webhook tests for removed echo filter**
- **Found during:** Task 1 (echo filter removal)
- **Issue:** Existing test file tested echo filter behavior that was just removed. Tests would fail with stale assertions.
- **Fix:** Rewrote test file to verify new behavior (all comments dispatched, no filtering)
- **Files modified:** packages/integrations/linear/src/api/webhooks.test.ts
- **Verification:** All 3 tests pass, removed unused afterEach import flagged by Biome
- **Committed in:** f33c77d (Task 1 commit)

**3. [Rule 1 - Bug] Removed LINEAR_BOT_USER_ID from root .env.example**
- **Found during:** Task 1 (echo filter removal)
- **Issue:** Plan mentioned checking linear integration directory for .env.example, but the actual .env.example was at the monorepo root with LINEAR_BOT_USER_ID documented
- **Fix:** Removed the 5-line block (comment + env var) from root .env.example
- **Files modified:** .env.example
- **Verification:** No remaining LINEAR_BOT_USER_ID references in source code or config files
- **Committed in:** f33c77d (Task 1 commit)

---

**Total deviations:** 3 auto-fixed (2 bug fixes, 1 blocking)
**Impact on plan:** All auto-fixes necessary for correctness. No scope creep. The worker-loop.ts change is architecturally equivalent to the plan's intent -- same behavior, correct location.

## Issues Encountered
- Biome pre-commit hook caught unused `afterEach` import in rewritten test file. Resolved by removing the import and amending the commit.

## User Setup Required
None - no external service configuration required. Operators with `LINEAR_BOT_USER_ID` in their `.env` will see no effect (Zod's safeParse ignores unknown keys).

## Next Phase Readiness
- Phase 67 (Linear Agent SDK) is now complete. All 4 plans executed.
- LSDK-01 (token refresh): Shipped in 67-01
- LSDK-03 (activity tools): Shipped in 67-02
- LSDK-04 (session state): Shipped in 67-02
- LSDK-05 (activity intents): Shipped in 67-03 + 67-04
- LSDK-06 (acknowledgment): Shipped in 67-03
- LSDK-07 (echo filter removal): Shipped in 67-04
- LSDK-09 (error activity): Shipped in 67-04
- LSDK-08 (comprehensive tests): Deferred per plan
- Ready to proceed to Phase 68 (Shared Memory)

## Self-Check: PASSED

- All 6 modified files exist on disk
- All commit hashes verified (f33c77d, c774da3)
- Must-have artifacts verified:
  - Echo filter code removed from webhooks.ts (replaced with explanatory comment)
  - LINEAR_BOT_USER_ID removed from config.ts schema and buildConfig
  - emitErrorActivity in worker-loop.ts with create_agent_activity error type
  - Dev-agent prompt contains "Communication on Linear" section with notify intent guidance

---
*Phase: 67-linear-agent-sdk*
*Completed: 2026-02-10*
