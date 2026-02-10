---
phase: 70-task-delegation
plan: 03
subsystem: agents
tags: [delegation, prompts, agent-definitions, yaml, task-delegation]

# Dependency graph
requires:
  - phase: 70-01
    provides: "task:delegate and task:respond tool factories registered in tool-factories.ts"
provides:
  - "task:delegate and task:respond tool references in dev-agent and product-agent definitions"
  - "Delegation judgment guidance in both orchestrator prompts"
  - "Spawn vs delegate heuristic for dev-agent"
  - "Role-specific delegation criteria for both orchestrators"
affects: [70-completion-signaling, qa-agent]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Delegation judgment as prompt guidance (agent-first, not executor code)"
    - "Spawn vs delegate heuristic: subAgents list = spawn, directory lookup = delegate"

key-files:
  created: []
  modified:
    - packages/agents/definitions/dev-agent/definition.yaml
    - packages/agents/definitions/dev-agent/prompt.md
    - packages/agents/definitions/product-agent/definition.yaml
    - packages/agents/definitions/product-agent/prompt.md

key-decisions:
  - "Delegation guidance as prompt section, not executor logic (agent-first principle)"
  - "Spawn vs delegate distinction: sub-agents for internal work, delegation for cross-domain work"

patterns-established:
  - "Task Delegation prompt section pattern for orchestrator agents"

# Metrics
duration: 2min
completed: 2026-02-10
---

# Phase 70 Plan 03: Orchestrator Agent Definitions Summary

**task:delegate and task:respond tool references plus delegation judgment guidance in dev-agent and product-agent prompts**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-10T21:56:30Z
- **Completed:** 2026-02-10T21:58:22Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Added task:delegate and task:respond to both orchestrator agent definitions (dev-agent, product-agent)
- Wrote Task Delegation section in dev-agent prompt with spawn vs delegate heuristic and role-specific criteria
- Wrote Task Delegation section in product-agent prompt with product-domain-specific delegation criteria
- Both prompts follow PROMPT_GUIDE.md principles: goal-oriented, judgment-based, minimal directives

## Task Commits

Each task was committed atomically:

1. **Task 1: Add task:delegate and task:respond to orchestrator definitions** - `ca9720f` (feat)
2. **Task 2: Write delegation judgment guidance in orchestrator prompts** - `2797e82` (feat)

## Files Created/Modified
- `packages/agents/definitions/dev-agent/definition.yaml` - Added task:delegate and task:respond tool references
- `packages/agents/definitions/dev-agent/prompt.md` - Added Task Delegation section with spawn vs delegate heuristic
- `packages/agents/definitions/product-agent/definition.yaml` - Added task:delegate and task:respond tool references
- `packages/agents/definitions/product-agent/prompt.md` - Added Task Delegation section with product-specific criteria

## Decisions Made
- Delegation guidance as prompt section, not executor logic -- follows agent-first principle where behavior is controlled via prompts
- Spawn vs delegate distinction: sub-agents (in subAgents list) are spawned for internal specialist work; delegation (via directory:find + task:delegate) is for cross-domain work with independent conversations

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Both orchestrator agents now have delegation tools and judgment guidance
- Ready for Phase 70 completion (all 3 plans done) and subsequent completion signaling phase
- Agents can discover peers via directory:find and delegate via task:delegate once the full delegation flow is wired

## Self-Check: PASSED

- All 4 modified files exist on disk
- Commit ca9720f (Task 1) found in git log
- Commit 2797e82 (Task 2) found in git log

---
*Phase: 70-task-delegation*
*Completed: 2026-02-10*
