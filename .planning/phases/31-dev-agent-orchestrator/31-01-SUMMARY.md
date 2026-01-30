---
phase: 31-dev-agent-orchestrator
plan: 01
subsystem: agents
tags: [system-prompts, orchestrator, agent-loop, sub-agents, anthropic-sdk]

# Dependency graph
requires:
  - phase: 28-agent-loop-runtime
    provides: runAgentLoop(), AgentLoopOptions, AgentLoopResult, TokenBudget
  - phase: 29-agent-persistence
    provides: createTraceRecorder, agents DB schema, createId.agentInstance
  - phase: 30-agent-tool-library
    provides: createOrchestratorToolkit, 25 tool factories, 4 toolkit factories
provides:
  - 4 static system prompts (orchestrator, researcher, coder, tester)
  - runDevAgentOrchestrator() entry point wiring toolkit + prompt + loop
  - Production sub-agent prompts replacing Phase 30 placeholders
affects: [31-02-integration-wiring, 32-temporal-activities, 33-product-agent]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "XML-tagged system prompt sections for structured LLM guidance"
    - "Static string prompts (no template interpolation) for predictability"
    - "Orchestrator entry point pattern: budget + trace + toolkit + loop"

key-files:
  created:
    - packages/agents/src/dev-agent/orchestrator/system-prompts.ts
    - packages/agents/src/dev-agent/orchestrator/orchestrator.ts
    - packages/agents/src/dev-agent/orchestrator/index.ts
  modified:
    - packages/agents/src/shared/tools/toolkits.ts

key-decisions:
  - "XML-tagged prompt sections for structured LLM guidance (identity, constraints, workflow_guidance, sub_agent_delegation, error_recovery, available_tools)"
  - "3-tier complexity model in orchestrator prompt: simple/moderate/complex with adaptive behavior"
  - "Cross-boundary import (shared/tools -> dev-agent/orchestrator) acceptable for agent-specific content"

patterns-established:
  - "System prompt pattern: static exported const with XML sections"
  - "Orchestrator entry point pattern: create budget, trace, toolkit, then runAgentLoop()"
  - "Sub-agent brief guidance: objective, context, output format, boundaries"

# Metrics
duration: 5min
completed: 2026-01-30
---

# Phase 31 Plan 01: Orchestrator Prompts & Entry Point Summary

**4 XML-structured system prompts and runDevAgentOrchestrator() entry point wiring orchestrator toolkit + ORCHESTRATOR_SYSTEM_PROMPT + runAgentLoop()**

## Performance

- **Duration:** 5 min
- **Started:** 2026-01-30T12:52:30Z
- **Completed:** 2026-01-30T12:57:05Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- 4 static system prompts: orchestrator (~2000 words with 6 XML sections), researcher, coder, tester (~350 words each with 4 XML sections)
- runDevAgentOrchestrator() entry point that creates token budget, trace recorder, toolkit, and launches runAgentLoop()
- Production sub-agent prompts replace Phase 30 placeholder one-liners in toolkits.ts
- All 17 existing toolkit tests pass unchanged

## Task Commits

Each task was committed atomically:

1. **Task 1: System prompts and orchestrator entry point** - `e2763ec` (feat)
2. **Task 2: Update toolkits.ts with production prompts** - `69c7b3f` (refactor)

## Files Created/Modified
- `packages/agents/src/dev-agent/orchestrator/system-prompts.ts` - 4 static system prompts with XML-tagged sections
- `packages/agents/src/dev-agent/orchestrator/orchestrator.ts` - runDevAgentOrchestrator() entry point function
- `packages/agents/src/dev-agent/orchestrator/index.ts` - Barrel export for orchestrator module
- `packages/agents/src/shared/tools/toolkits.ts` - Replaced placeholder prompts with imports from system-prompts.ts

## Decisions Made
- **XML-tagged prompt sections**: Used XML tags (identity, constraints, workflow_guidance, etc.) for structured LLM guidance. This gives the model clear section boundaries to parse without ambiguity.
- **3-tier complexity model**: Orchestrator prompt defines simple/moderate/complex task categories with different workflows, but emphasizes "use your judgment" -- no hardcoded rules.
- **Cross-boundary import**: toolkits.ts in shared/ imports from dev-agent/orchestrator/. Acceptable because prompts are agent-specific content and toolkits composes agent-specific configurations. Product agent (Phase 33) will have its own prompts.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Orchestrator module complete with entry point and system prompts
- Ready for 31-02 (integration wiring) to connect orchestrator to Temporal activities and HTTP handlers
- All exports available via barrel file for downstream consumers

---
*Phase: 31-dev-agent-orchestrator*
*Completed: 2026-01-30*
