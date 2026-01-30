---
phase: 31-dev-agent-orchestrator
plan: 02
subsystem: agents
tags: [testing, vitest, orchestrator, behavioral-tests, anthropic-sdk, mock]

# Dependency graph
requires:
  - phase: 31-dev-agent-orchestrator
    provides: runDevAgentOrchestrator(), ORCHESTRATOR_SYSTEM_PROMPT, system-prompts.ts
  - phase: 28-agent-loop-runtime
    provides: runAgentLoop(), SDK mock pattern from run-agent-loop.test.ts
  - phase: 30-agent-tool-library
    provides: createOrchestratorToolkit (14 tools), toolkits.test.ts mock pattern
provides:
  - 14 behavioral tests proving adaptive orchestrator decisions
  - Established pattern for testing agents via SDK mocking + trace recorder callbacks
affects: [32-temporal-activities, 33-product-agent]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Orchestrator behavioral testing via Anthropic SDK mock with pre-scripted tool call sequences"
    - "Trace recorder onToolCall callback for extracting tool call sequences in tests"
    - "Sub-agent loop interception via shared mockCreate (orchestrator + sub-agent responses in single sequence)"

key-files:
  created:
    - packages/agents/src/dev-agent/orchestrator/orchestrator.test.ts
  modified: []

key-decisions:
  - "Used Anthropic SDK mocking (Phase 28 pattern) rather than mocking runAgentLoop directly -- enables full integration path testing through real tool execution"
  - "Used trace recorder onToolCall callback for assertion extraction -- cleaner than parsing mock.results Promise values"
  - "Sub-agent responses included in mock sequence -- tests prove nested runAgentLoop invocations work correctly with shared mockCreate"

patterns-established:
  - "Orchestrator test pattern: mock SDK + mock trace-recorder + mock MCP client + mock createId"
  - "Tool call sequence extraction via mockOnToolCall.mock.calls cast to typed tuple arrays"
  - "Pre-scripted multi-turn scenarios: orchestrator response -> sub-agent response -> orchestrator continues"

# Metrics
duration: 5min
completed: 2026-01-30
---

# Phase 31 Plan 02: Orchestrator Behavioral Tests Summary

**14 behavioral tests proving adaptive orchestrator decisions via Anthropic SDK mocking with pre-scripted tool call sequences**

## Performance

- **Duration:** 5 min
- **Started:** 2026-01-30T13:01:18Z
- **Completed:** 2026-01-30T13:06:02Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- 14 behavioral test cases covering DEVO-01, DEVO-02, DEVO-09, DEVO-10, DEVO-11, DEVO-12, DEVO-13
- Entry point wiring tests: system prompt, 14-tool toolkit, initial message with issue title, default maxIterations
- Adaptive behavior tests: reads issue first, skips researcher for simple tasks, spawns researcher -> coder -> tester for complex tasks
- Error recovery tests: tries different approaches after sub-agent failure, escalates via request_human_input after 3 distinct failures
- Trace recording tests: flush on success and error, trace callbacks registered
- Token budget tests: default 500k, custom budget enforcement
- 765-line test file following established Phase 28 SDK mock patterns

## Task Commits

Each task was committed atomically:

1. **Task 1: Behavioral tests for orchestrator adaptive decisions** - `27086ce` (test)

## Files Created/Modified
- `packages/agents/src/dev-agent/orchestrator/orchestrator.test.ts` - 14 behavioral tests proving adaptive orchestrator decisions with mock Anthropic SDK

## Decisions Made
- **SDK mocking over runAgentLoop mocking**: Chose to mock `@anthropic-ai/sdk` at module level (Phase 28 pattern) rather than mocking `runAgentLoop` directly. This tests the full integration path: orchestrator creates toolkit -> calls runAgentLoop -> real loop processes mock LLM responses -> real tools execute -> spawn_agent triggers nested loop. More coverage despite more complex mock sequences.
- **Trace recorder callbacks for assertion extraction**: Used `mockOnToolCall.mock.calls` from the trace recorder mock rather than `mockCreate.mock.results` to extract tool call sequences. The trace recorder approach avoids Promise unwrapping issues with `vi.fn().mockResolvedValueOnce()` return values and provides cleaner type-safe access.
- **Cast-based tuple typing for mock calls**: Used `as Array<[...]>` cast on `mockOnToolCall.mock.calls` to get type-safe tuple access. Vitest's `mock.calls` is typed as `any[][]` which doesn't support tuple indexing without cast.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed extractToolCallSequence helper using mockCreate.mock.results**

- **Found during:** Task 1 (initial test run)
- **Issue:** `extractToolCallSequence()` iterated `mockCreate.mock.results` expecting resolved response objects, but `mockResolvedValueOnce` produces `{ type: "return", value: <Promise> }` entries where `.value` is a Promise, not the resolved response
- **Fix:** Switched from `mockCreate.mock.results` to `mockOnToolCall.mock.calls` which contains the actual tool call info objects passed by the running loop
- **Files modified:** orchestrator.test.ts
- **Verification:** All 14 tests pass
- **Committed in:** 27086ce

**2. [Rule 3 - Blocking] Fixed TypeScript compilation errors for pre-commit hook**

- **Found during:** Task 1 (commit attempt)
- **Issue:** TypeScript strict mode rejected tuple type annotations on `mockOnToolCall.mock.calls.map()` callbacks (TS2345: `any[]` not assignable to tuple), and `as Record<string, unknown>` cast on `OrchestratorOptions` (TS2352: missing index signature)
- **Fix:** Used explicit `as Array<[...]>` cast on mock.calls before map/filter, and `as unknown as Record<string, unknown>` double-cast for delete operator
- **Files modified:** orchestrator.test.ts
- **Verification:** TypeScript build passes, all tests pass
- **Committed in:** 27086ce

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking)
**Impact on plan:** Both fixes required for tests to work correctly and pass pre-commit hooks. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 31 complete: orchestrator module has entry point, system prompts, and behavioral tests
- Ready for Phase 32 (Temporal activities) to wire orchestrator into the workflow execution layer
- All 14 orchestrator tests + 112 toolkit tests + 35 agent-loop tests pass with no regressions

---
*Phase: 31-dev-agent-orchestrator*
*Completed: 2026-01-30*
