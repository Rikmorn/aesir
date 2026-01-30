---
phase: 30-agent-tool-library
plan: 03
subsystem: agents
tags: [coordination-tools, toolkits, spawn-agent, human-input, tool-composition, agent-delegation]

# Dependency graph
requires:
  - phase: 28-agentic-loop-runtime
    provides: runAgentLoop, ToolDefinition, ToolResult, AgentLoopOptions, TokenBudget
  - phase: 29-db-schema-context
    provides: TraceRecorderCallbacks for observability
  - plan: 30-01
    provides: Codebase tool factories (read_file, write_file, search_codebase, list_directory, run_command)
  - plan: 30-02
    provides: MCP integration tool factories (Linear, GitHub, Slack)
provides:
  - spawn_agent tool with nested runAgentLoop() and shared TokenBudget
  - request_human_input tool with HUMAN_INPUT_MARKER sentinel return
  - 4 toolkit factories (orchestrator=14, researcher=4, coder=4, tester=3)
  - agentInstance ID generator in @aesir/types
  - Full barrel exports from tools/index.ts and shared/index.ts
affects: [31-dev-agent-orchestrator, 32-product-agent-orchestrator]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Recursive runAgentLoop() for sub-agent spawning with shared TokenBudget"
    - "Sentinel return pattern for HITL (HUMAN_INPUT_MARKER in tool result)"
    - "Toolkit composition: role-based tool set assembly from factories"
    - "Mutable-then-conditional-set for exactOptionalPropertyTypes compliance"
    - "Sub-agent configs (system prompt + tools + limits) embedded in orchestrator toolkit"

key-files:
  created:
    - packages/agents/src/shared/tools/coordination/spawn-agent.ts
    - packages/agents/src/shared/tools/coordination/request-human-input.ts
    - packages/agents/src/shared/tools/coordination/index.ts
    - packages/agents/src/shared/tools/toolkits.ts
    - packages/agents/src/shared/tools/index.ts
    - packages/agents/src/shared/tools/coordination/coordination-tools.test.ts
    - packages/agents/src/shared/tools/toolkits.test.ts
  modified:
    - packages/types/src/utils/ids.ts
    - packages/agents/src/shared/index.ts

key-decisions:
  - id: 30-03-01
    decision: "Recursive runAgentLoop() for sub-agent spawning (not Temporal activity)"
    rationale: "In-process spawning keeps shared TokenBudget reference and avoids serialization"
  - id: 30-03-02
    decision: "Sentinel HUMAN_INPUT_MARKER in tool result (no loop modification)"
    rationale: "Temporal activity wrapper parses the marker; keeps agent loop generic"
  - id: 30-03-03
    decision: "Integration tool filtering by name for orchestrator subset"
    rationale: "Create all tools via factory, filter by name -- avoids duplicating tool configs"
  - id: 30-03-04
    decision: "Placeholder sub-agent system prompts in toolkits.ts"
    rationale: "Detailed prompts will be defined in Phase 31 when agents are fully specified"

duration: ~10 minutes
completed: 2026-01-30
---

# Phase 30 Plan 03: Coordination Tools & Toolkit Assembly Summary

Coordination tools (spawn_agent, request_human_input) and 4 per-agent toolkit factories composing 25 unique tool definitions with recursive sub-agent spawning via shared TokenBudget.

## Performance

| Metric | Value |
|--------|-------|
| Tasks completed | 2/2 |
| Tests added | 34 |
| Total tools tests | 98 (across 4 test files) |
| Files created | 7 |
| Files modified | 2 |
| Duration | ~10 minutes |

## Accomplishments

1. **spawn_agent tool** -- Creates nested `runAgentLoop()` invocation with restricted tools and shared `TokenBudget`. Sub-agents (researcher, coder, tester) get only codebase tools. Trace recorder captures spawn/complete events for observability.

2. **request_human_input tool** -- Returns a sentinel `HUMAN_INPUT_MARKER` JSON result that the Temporal activity wrapper can parse to pause workflow execution. No modification to the agent loop required. LLM is instructed to stop after calling this tool.

3. **4 toolkit factories** -- Role-specific tool set composition:
   - `createOrchestratorToolkit`: 14 tools (3 codebase + 2 coordination + 9 integration)
   - `createResearcherToolkit`: 4 tools (read_file, search_codebase, list_directory, run_command)
   - `createCoderToolkit`: 4 tools (read_file, write_file, search_codebase, run_command)
   - `createTesterToolkit`: 3 tools (read_file, search_codebase, run_command)

4. **agentInstance ID generator** -- Added `ainst_` prefixed ID to `@aesir/types` createId factory.

5. **Barrel exports** -- Full export chain: coordination/index.ts -> tools/index.ts -> shared/index.ts.

## Task Commits

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Coordination tools, toolkits, and barrel exports | f76db71 | spawn-agent.ts, request-human-input.ts, toolkits.ts, tools/index.ts |
| 2 | Coordination and toolkit tests | a2c9940 | coordination-tools.test.ts, toolkits.test.ts |

## Files Created

- `packages/agents/src/shared/tools/coordination/spawn-agent.ts` -- spawn_agent tool factory
- `packages/agents/src/shared/tools/coordination/request-human-input.ts` -- request_human_input tool factory
- `packages/agents/src/shared/tools/coordination/index.ts` -- Coordination barrel export
- `packages/agents/src/shared/tools/toolkits.ts` -- 4 toolkit factory functions
- `packages/agents/src/shared/tools/index.ts` -- Tools barrel export
- `packages/agents/src/shared/tools/coordination/coordination-tools.test.ts` -- 17 coordination tests
- `packages/agents/src/shared/tools/toolkits.test.ts` -- 17 toolkit tests

## Files Modified

- `packages/types/src/utils/ids.ts` -- Added agentInstance ID generator
- `packages/agents/src/shared/index.ts` -- Added tools module re-export

## Decisions Made

1. **Recursive runAgentLoop() for sub-agent spawning** -- In-process spawning keeps the shared TokenBudget reference intact (by-reference, not by-value). Avoids Temporal activity serialization overhead.

2. **Sentinel HUMAN_INPUT_MARKER in tool result** -- The request_human_input tool returns structured JSON with a marker type. The Temporal activity wrapper will parse this to pause the workflow. This keeps the agent loop generic and reusable.

3. **Integration tool filtering by name for orchestrator** -- Rather than duplicating tool configurations, create all tools via factory then filter by name. This ensures the orchestrator's tool subset always matches the full tool definitions.

4. **Placeholder sub-agent system prompts** -- Minimal system prompts defined in toolkits.ts as constants. Detailed prompts with task-specific instructions will be defined in Phase 31 when agents are fully specified.

## Deviations from Plan

None -- plan executed exactly as written.

## Issues Encountered

1. **exactOptionalPropertyTypes compliance** -- The SpawnAgentDeps.abortSignal optional field required the mutable-then-conditional-set pattern when constructing the spawn deps object in createOrchestratorToolkit. Standard `{ abortSignal: deps.abortSignal }` fails when the value might be `undefined`.

2. **Project references build order** -- Adding agentInstance to @aesir/types required building the types package before the agents package could see the new declaration. Resolved by running `tsc --build packages/types/tsconfig.json` first.

3. **Biome import ordering** -- Type imports must precede value imports from the same module when using combined import statements. Auto-fixed by Biome.

## Next Phase Readiness

Phase 30 is now **complete**. All 3 plans delivered:
- 30-01: 5 codebase tools (44 tests)
- 30-02: 19 integration tools (20 tests)
- 30-03: 2 coordination tools + 4 toolkits (34 tests)

**Total: 25 tool factories, 4 toolkit factories, 98 tests.**

The agent tool library is ready for Phase 31 (Dev Agent Orchestrator) which will:
- Use `createOrchestratorToolkit()` to provide tools to the orchestrator agent loop
- Use `createResearcherToolkit()`, `createCoderToolkit()`, `createTesterToolkit()` for sub-agents
- Define detailed system prompts replacing the placeholder prompts
- Wire HUMAN_INPUT_MARKER parsing into Temporal activity wrappers
