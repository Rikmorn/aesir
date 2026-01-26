---
phase: 25-product-agent-workflow
plan: 04
subsystem: agents
tags: [temporal, workflow, signals, slack, conversation]

requires:
  - phase: 25-01
    provides: Classification node for message routing
  - phase: 25-02
    provides: Confirmation node for user approval flow
  - phase: 25-03
    provides: Graph integration with classify/confirm nodes

provides:
  - Temporal workflow for multi-turn Slack conversations
  - Signal-based user reply and cancellation handling
  - 24h/72h timeout with reminder mechanism
  - Workflow types for input/output

affects: [25-05, 25-06, 25-07]

tech-stack:
  added: ["@temporalio/workflow"]
  patterns:
    - "Signal-based workflow communication"
    - "proxyActivities for activity binding"
    - "wf.condition for signal waiting with timeout"
    - "allHandlersFinished for clean termination"

key-files:
  created:
    - packages/agents/src/temporal/workflows/product-agent-workflow.ts
    - packages/agents/src/temporal/workflows/index.ts
    - packages/agents/src/temporal/workflows/product-agent-workflow.test.ts
  modified:
    - packages/agents/src/temporal/index.ts
    - packages/agents/src/temporal/signals.ts
    - packages/agents/src/temporal/types.ts
    - packages/agents/package.json

key-decisions:
  - "24h first reply timeout with 48h additional after reminder (72h total)"
  - "Max 20 iterations to prevent infinite conversation loops"
  - "Declined is success: true (correctly identified non-actionable)"
  - "Activity failures treated as timeout (graceful degradation)"

patterns-established:
  - "Signal handler pattern: wf.setHandler(signal, handler) with state mutation"
  - "Condition wait pattern: await wf.condition(() => predicate, timeout)"
  - "Clean termination: await wf.condition(wf.allHandlersFinished) before return"
  - "Optional fields via conditional assignment (exactOptionalPropertyTypes)"

duration: 8min
completed: 2026-01-26
---

# Phase 25 Plan 04: Product Agent Workflow Summary

**Temporal workflow for multi-turn Slack conversations with signal-based control and configurable timeouts**

## Performance

- **Duration:** 8 min
- **Started:** 2026-01-26T00:36:42Z
- **Completed:** 2026-01-26T00:44:41Z
- **Tasks:** 3
- **Files modified:** 7

## Accomplishments

- Created productAgentConversationWorkflow with signal handling for user replies and cancellation
- Implemented 24h/72h timeout mechanism with reminder after 24h inactivity
- Added comprehensive unit tests for signals, phase transitions, and workflow logic
- Fixed pre-existing test failures in graph.test.ts (AfterAnalysisRoute type mismatch)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add signals and types** - `b00c954` (feat)
2. **Task 2: Create workflow** - `b92d941` (feat)
3. **Task 3: Add workflow tests** - `09c1e86` (test)

## Files Created/Modified

- `packages/agents/src/temporal/workflows/product-agent-workflow.ts` - Main workflow with conversation loop
- `packages/agents/src/temporal/workflows/index.ts` - Workflow exports
- `packages/agents/src/temporal/workflows/product-agent-workflow.test.ts` - Unit tests
- `packages/agents/src/temporal/index.ts` - Updated to export workflows
- `packages/agents/src/temporal/signals.ts` - userReplySignal and cancelConversationSignal
- `packages/agents/src/temporal/types.ts` - WorkflowInput, WorkflowResult, WorkflowPhase
- `packages/agents/package.json` - Added @temporalio/workflow dependency

## Decisions Made

1. **24h/72h timeout structure**: First reply has 24h timeout, then reminder, then 48h more (72h total). This matches the CONTEXT.md specification while providing a reasonable user experience.

2. **Max iterations = 20**: Prevents infinite conversation loops while allowing extensive back-and-forth for complex requirements.

3. **Declined is success: true**: A declined message (question, off-topic) is a successful workflow outcome - the agent correctly identified non-actionable content.

4. **Activity failures as timeout**: When runProductAgentActivity fails, we treat it as timeout rather than a separate failure mode, simplifying the terminal state space.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed graph.test.ts AfterAnalysisRoute type mismatch**
- **Found during:** Task 1 (commit blocked by pre-commit hook)
- **Issue:** Tests referenced 'createTasks' but AfterAnalysisRoute changed to 'clarify' | 'confirm' in Plan 25-02
- **Fix:** Updated all test assertions to use 'confirm' instead of 'createTasks'
- **Files modified:** packages/agents/src/product-agent/graph.test.ts
- **Verification:** pnpm typecheck passes
- **Committed in:** b00c954 (part of Task 1 commit)

**2. [Rule 3 - Blocking] Added @temporalio/workflow dependency**
- **Found during:** Task 1 (import failed)
- **Issue:** signals.ts imports from @temporalio/workflow but package wasn't in agents dependencies
- **Fix:** Added @temporalio/workflow@^1.14.1 to agents package.json
- **Files modified:** packages/agents/package.json, pnpm-lock.yaml
- **Verification:** Import resolves, typecheck passes
- **Committed in:** b00c954 (part of Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking)
**Impact on plan:** Both auto-fixes necessary for plan execution. No scope creep.

## Issues Encountered

- TypeScript control flow analysis couldn't track that `state.userReply` is set by signal handlers, requiring `as unknown as string` assertion in one location. This is a known limitation when working with mutable state updated by async signal handlers.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Workflow structure complete, ready for activity implementation (Plan 25-05)
- Signal definitions in place for Slack dispatcher integration (Plan 25-06)
- Types exported for use by event handlers (Plan 25-07)
- Missing: runProductAgentActivity and sendSlackReplyActivity implementations

---
*Phase: 25-product-agent-workflow*
*Completed: 2026-01-26*
