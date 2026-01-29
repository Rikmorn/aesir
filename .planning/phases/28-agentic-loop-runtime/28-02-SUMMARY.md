---
phase: 28
plan: 02
subsystem: agent-loop-runtime
tags: [anthropic-sdk, agent-loop, tool-use, betaZodTool, run-agent-loop]
requires:
  - "28-01: SDK install, types, token budget, errors"
provides:
  - "runAgentLoop() core function -- foundation for all v2.2 agents"
  - "Full LLM tool-use loop with Anthropic SDK native integration"
  - "betaZodTool Zod-to-JSON-Schema conversion (no LangChain)"
  - "35 comprehensive tests proving all LOOP requirements"
affects:
  - "Phase 29+: All agent implementations will call runAgentLoop()"
tech-stack:
  added: []
  patterns:
    - "Custom Anthropic SDK tool-use loop (replaces LangGraph)"
    - "betaZodTool for Zod schema to JSON Schema conversion"
    - "Mutable token budget sharing across orchestrator and sub-agents"
    - "Tool errors returned to LLM for reasoning (not thrown)"
key-files:
  created:
    - "packages/agents/src/shared/agent-loop/run-agent-loop.ts"
    - "packages/agents/src/shared/agent-loop/run-agent-loop.test.ts"
  modified:
    - "packages/agents/src/shared/agent-loop/index.ts"
key-decisions:
  - decision: "Cast betaZodTool result via unknown to Anthropic.Tool"
    reason: "BetaRunnableTool union type is too broad -- includes non-custom tool types lacking description/input_schema. Since betaZodTool always returns type:'custom', the cast is safe."
  - decision: "Use description from original ToolDefinition instead of converted result"
    reason: "exactOptionalPropertyTypes causes Anthropic.Tool.description (string) incompatibility with BetaRunnableTool.description (string | undefined). Using the source value avoids the issue."
  - decision: "Build llmTraceStep as mutable then conditionally set stopReason"
    reason: "exactOptionalPropertyTypes prevents assigning string | undefined to optional string property. Conditional assignment avoids the type error."
duration: "12min"
completed: "2026-01-29"
---

# Phase 28 Plan 02: Core runAgentLoop() Implementation Summary

Custom Anthropic SDK tool-use loop with betaZodTool schema conversion, iteration/token/abort guards, tracing callbacks, and all stop_reason handling -- the foundation every v2.2 agent calls.

## Performance

- **Duration:** 12 minutes
- **Started:** 2026-01-29T23:30:31Z
- **Completed:** 2026-01-29T23:42:28Z
- **Tasks:** 2/2
- **Files changed:** 3 (2 created, 1 modified)
- **Lines:** 1,457 total (475 implementation, 970 tests, 12 barrel)
- **Tests:** 35 pass, 0 fail

## Accomplishments

### Task 1: Implement runAgentLoop() core function
- Created `run-agent-loop.ts` (475 lines) -- the single most critical piece of v2.2
- Full LLM tool-use loop: call -> tool execution -> result feedback -> repeat
- `betaZodTool()` from `@anthropic-ai/sdk/helpers/beta/zod` for Zod-to-JSON-Schema conversion
- Internal helpers: `toAnthropicTool()`, `mapStopReasonToStatus()`, `extractTextOutput()`, `buildResult()`
- Configurable iteration limit (default 50), token budget, AbortSignal
- `onToolCall` and `onResponse` callbacks fire every iteration
- All 6+ stop_reason values handled: end_turn, tool_use, max_tokens, stop_sequence, refusal, model_context_window_exceeded, pause_turn, null, unknown
- Parallel tool calls handled correctly (all results in single user message)
- Tool errors returned to LLM for reasoning (not thrown)
- Structured output parsed from JSON when present
- Updated barrel export in `index.ts`

### Task 2: Comprehensive tests for runAgentLoop()
- Created `run-agent-loop.test.ts` (970 lines) with 35 test cases
- Mocked `@anthropic-ai/sdk` constructor and `messages.create()` method
- Mocked `betaZodTool` for schema conversion verification
- Test coverage: basic completion, tool execution, parallel tools, iteration limit, token budget, AbortSignal, callbacks, all stop_reason values, error handling, conversation format, context prepending, structured output, trace steps

## Task Commits

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Implement runAgentLoop() core function | `45cdb80` | run-agent-loop.ts, index.ts |
| 2 | Comprehensive tests for runAgentLoop() | `6759fe5` | run-agent-loop.test.ts |

## Files Created/Modified

### Created
- `packages/agents/src/shared/agent-loop/run-agent-loop.ts` (475 lines) -- Core loop function
- `packages/agents/src/shared/agent-loop/run-agent-loop.test.ts` (970 lines) -- 35 tests

### Modified
- `packages/agents/src/shared/agent-loop/index.ts` -- Added runAgentLoop export

## Decisions Made

1. **Cast betaZodTool result via unknown to Anthropic.Tool** -- BetaRunnableTool is a union type that includes non-custom tool types (BetaToolBash, BetaMemoryTool, etc.) which lack `description` and `input_schema`. Since `betaZodTool()` always returns `type: "custom"` with all properties, the cast is safe.

2. **Use description from original ToolDefinition** -- The `exactOptionalPropertyTypes` tsconfig setting makes `Anthropic.Tool.description` (required string) incompatible with `BetaRunnableTool.description` (string | undefined). Using the source `tool.description` directly avoids this.

3. **Build trace step as mutable object then conditionally set stopReason** -- `exactOptionalPropertyTypes` prevents assigning `string | undefined` to an optional `string` property. Building the object first, then conditionally adding the property, avoids the type error.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] BetaRunnableTool union type incompatibility**
- **Found during:** Task 1, typecheck
- **Issue:** `betaZodTool()` returns `BetaRunnableTool` which is a union of all beta tool types. TypeScript couldn't prove that `description` and `input_schema` exist on all union members.
- **Fix:** Cast result via `unknown as Anthropic.Tool`, use original `tool.description` for the description field.
- **Files modified:** `run-agent-loop.ts`

**2. [Rule 3 - Blocking] exactOptionalPropertyTypes conflict with stopReason**
- **Found during:** Task 1, typecheck
- **Issue:** `response.stop_reason ?? undefined` produces `string | undefined` which isn't assignable to optional `string` property.
- **Fix:** Build TraceStep as mutable object, conditionally set `stopReason` only when non-null.
- **Files modified:** `run-agent-loop.ts`

**3. [Rule 3 - Blocking] Biome noNonNullAssertion in test file**
- **Found during:** Task 2, pre-commit hook
- **Issue:** Non-null assertions (`!`) forbidden by Biome lint rule. Needed for array index access in tests.
- **Fix:** Created helper functions (`getMockCall`, `getLastMessage`, `getMessageAt`) that throw on missing values, plus `?.` optional chains for array element access in assertions.
- **Files modified:** `run-agent-loop.test.ts`

## Issues Encountered

None. Both tasks executed successfully with only type-system and lint deviations handled inline.

## Next Phase Readiness

Phase 28 is now complete with Plan 02 delivering the core `runAgentLoop()` function. The agent-loop module provides:

- **Types:** `AgentLoopOptions`, `AgentLoopResult`, `ToolDefinition`, `ToolResult`, `TraceStep`
- **Token Budget:** `createTokenBudget()` for mutable shared budgets
- **Errors:** `AgentLoopError`, `MaxIterationsError`, `TokenBudgetExhaustedError`, `AgentAbortedError`
- **Core Loop:** `runAgentLoop()` -- the foundation every v2.2 agent calls

**Ready for Phase 29:** Tool definition framework can now build on the `ToolDefinition` interface and `runAgentLoop()` function.
