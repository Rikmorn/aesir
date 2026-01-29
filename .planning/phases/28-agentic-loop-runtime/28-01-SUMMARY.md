---
phase: 28
plan: 01
subsystem: agent-loop-runtime
tags: [anthropic-sdk, types, token-budget, errors, agent-loop]
requires: []
provides:
  - "@anthropic-ai/sdk installed in @aesir/agents"
  - "Agent loop type definitions (AgentLoopOptions, AgentLoopResult, ToolDefinition, etc.)"
  - "TokenBudget interface and createTokenBudget() factory"
  - "AgentLoopError hierarchy (MaxIterationsError, TokenBudgetExhaustedError, AgentAbortedError)"
  - "Barrel exports from shared/agent-loop/"
affects:
  - "28-02 (runAgentLoop implementation depends on these types)"
  - "Phase 30 (tool definitions use ToolDefinition interface)"
  - "Phase 31 (orchestrator uses TokenBudget for sub-agent cost control)"
tech-stack:
  added:
    - "@anthropic-ai/sdk ^0.72.0"
  patterns:
    - "Mutable token budget passed by reference for shared cost tracking"
    - "Structured error classes with AgentLoopStatus for loop termination"
    - "import type for SDK types to avoid runtime dependency in type files"
key-files:
  created:
    - packages/agents/src/shared/agent-loop/types.ts
    - packages/agents/src/shared/agent-loop/token-budget.ts
    - packages/agents/src/shared/agent-loop/errors.ts
    - packages/agents/src/shared/agent-loop/index.ts
  modified:
    - packages/agents/package.json
    - packages/agents/src/shared/index.ts
    - pnpm-lock.yaml
key-decisions:
  - id: "28-01-D1"
    decision: "Import PinoLogger from @aesir/platform (not directly from pino)"
    reason: "Consistent with codebase pattern -- agents package does not have pino as a direct dependency; @aesir/platform re-exports the PinoLogger type"
  - id: "28-01-D2"
    decision: "Set error name in constructor body (not via override readonly property)"
    reason: "TypeScript readonly literal type narrowing prevents subclasses from overriding a readonly name property with a different literal value"
  - id: "28-01-D3"
    decision: "SDK resolved to ^0.72.0 (plan specified ^0.71.2)"
    reason: "pnpm resolved to latest compatible version; 0.72.0 is semver-compatible with the planned minimum"
duration: 4m
completed: 2026-01-29
---

# Phase 28 Plan 01: SDK Installation, Types, Token Budget, and Errors Summary

Anthropic SDK installed and full type foundation for agent loop runtime created -- ToolDefinition with Zod schemas, mutable TokenBudget for cross-agent cost tracking, and structured error hierarchy with AgentLoopStatus codes.

## Performance

- **Duration:** 4 minutes
- **Started:** 2026-01-29T23:21:28Z
- **Completed:** 2026-01-29T23:25:29Z
- **Tasks:** 2/2
- **Files:** 4 created, 3 modified

## Accomplishments

1. **Installed @anthropic-ai/sdk** (^0.72.0) in @aesir/agents -- provides native tool-use via `messages.create()`, replacing @langchain/anthropic for direct API access
2. **Created complete type system** for the agent loop runtime:
   - `ToolResult`, `ToolDefinition` (with Zod inputSchema), `ToolCallInfo`
   - `AgentLoopStatus` (5 terminal states), `TraceStep` (3 step types)
   - `AgentLoopOptions` (system prompt, tools, callbacks, budget, abort)
   - `AgentLoopResult` (status, output, token count, trace)
   - `LLMResponse` type alias for `Anthropic.Message`
3. **Created TokenBudget** -- mutable counter shared by reference across orchestrator and sub-agents, with `isExhausted()` check and `deduct()` method
4. **Created error hierarchy** -- `AgentLoopError` base with `MaxIterationsError`, `TokenBudgetExhaustedError`, `AgentAbortedError`, each carrying the corresponding `AgentLoopStatus`
5. **Wired barrel exports** -- `agent-loop/index.ts` re-exports all modules, `shared/index.ts` re-exports agent-loop

## Task Commits

| Task | Name | Commit | Key Changes |
|------|------|--------|-------------|
| 1 | Install Anthropic SDK | `e3ed6d4` | package.json, pnpm-lock.yaml |
| 2 | Create types, budget, errors, barrel | `9db2c99` | types.ts, token-budget.ts, errors.ts, index.ts, shared/index.ts |

## Files Created

| File | Purpose |
|------|---------|
| `packages/agents/src/shared/agent-loop/types.ts` | All type definitions (AgentLoopOptions, AgentLoopResult, ToolDefinition, etc.) |
| `packages/agents/src/shared/agent-loop/token-budget.ts` | TokenBudget interface + createTokenBudget() factory |
| `packages/agents/src/shared/agent-loop/errors.ts` | AgentLoopError, MaxIterationsError, TokenBudgetExhaustedError, AgentAbortedError |
| `packages/agents/src/shared/agent-loop/index.ts` | Barrel export for agent-loop module |

## Files Modified

| File | Change |
|------|--------|
| `packages/agents/package.json` | Added `@anthropic-ai/sdk: ^0.72.0` dependency |
| `packages/agents/src/shared/index.ts` | Added agent-loop re-export |
| `pnpm-lock.yaml` | Updated lockfile |

## Decisions Made

| ID | Decision | Rationale |
|----|----------|-----------|
| 28-01-D1 | Import PinoLogger from @aesir/platform | Consistent with codebase pattern; agents package doesn't have pino as direct dependency |
| 28-01-D2 | Set error name in constructor body | TypeScript readonly literal narrowing prevents override in subclasses |
| 28-01-D3 | SDK resolved to ^0.72.0 | pnpm resolved latest compatible; semver-compatible with planned ^0.71.2 |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed PinoLogger import source**
- **Found during:** Task 2 (typecheck)
- **Issue:** Plan specified `import type { Logger as PinoLogger } from "pino"` but `pino` types are not available in agents package
- **Fix:** Used `import type { PinoLogger } from "@aesir/platform"` matching codebase convention
- **Files modified:** types.ts
- **Commit:** 9db2c99

**2. [Rule 3 - Blocking] Fixed error class name override pattern**
- **Found during:** Task 2 (typecheck)
- **Issue:** `override readonly name = "SubclassName"` causes TS2416 because base class literal type can't be narrowed to different literal in subclass
- **Fix:** Set `this.name` in constructor body instead of using `override readonly` property
- **Files modified:** errors.ts
- **Commit:** 9db2c99

**3. [Rule 3 - Blocking] Fixed Biome import ordering**
- **Found during:** Task 2 (commit pre-commit hook)
- **Issue:** Biome requires alphabetically sorted imports and exports
- **Fix:** Reordered imports in types.ts, exports in index.ts, and exports in shared/index.ts
- **Files modified:** types.ts, index.ts, shared/index.ts
- **Commit:** 9db2c99

## Issues Encountered

None -- all issues were auto-fixed (see Deviations above).

## Next Phase Readiness

Plan 28-02 (core `runAgentLoop()` implementation) is unblocked:
- All types it needs are defined and exported
- TokenBudget factory is ready for integration
- Error classes are ready for loop termination paths
- SDK is installed and type-accessible via `import type Anthropic from "@anthropic-ai/sdk"`
- No outstanding blockers
