---
phase: 82-transparent-materialization
plan: 02
subsystem: agents
tags: [prompts, materialization, delegation, linear]

# Dependency graph
requires:
  - phase: 80-delegation-negotiation
    provides: "Delegation tools (delegate_task, delegate_group) and negotiation guidance"
provides:
  - "Materialization decision guidance in dev-agent and product-agent prompts"
  - "Agents know materialization parameter shape, heuristics, nesting depth, and completion summary practice"
affects: [82-transparent-materialization, agent-definitions]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Judgment-oriented materialization guidance per PROMPT_GUIDE.md"

key-files:
  created: []
  modified:
    - packages/agents/definitions/dev-agent/prompt.md
    - packages/agents/definitions/product-agent/prompt.md

key-decisions:
  - "Materialization section placed within domain_knowledge after Task Delegation (dev-agent) and Implementation Delegation (product-agent)"
  - "Dev-agent guidance emphasizes keeping sub-agent work internal; product-agent emphasizes transparent for dev-agent and qa-agent delegations"
  - "Used 'tend to', 'prefer', 'think about whether' language -- zero strong directives in new sections"

patterns-established:
  - "Materialization guidance pattern: what it is, parameter shape, decision heuristic, nesting depth, completion summary"

requirements-completed: [MAT-04]

# Metrics
duration: 1min
completed: 2026-02-20
---

# Phase 82 Plan 02: Agent Prompt Materialization Guidance Summary

**Materialization decision guidance added to dev-agent and product-agent prompts, enabling judgment-based transparent vs internal delegation choices**

## Performance

- **Duration:** 1 min
- **Started:** 2026-02-20T22:53:29Z
- **Completed:** 2026-02-20T22:55:06Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments
- Dev-agent prompt has materialization guidance emphasizing internal for sub-agent work (coder, researcher, tester)
- Product-agent prompt has materialization guidance emphasizing transparent for human-initiated delegations (dev-agent, qa-agent)
- Both agents know the parameter shape (`{ type: "transparent", target: "linear", properties: { priority: "high" } }`)
- Guidance covers decision heuristics, nesting depth, and completion summary practice
- Zero MUST/ALWAYS/NEVER directives in new sections per PROMPT_GUIDE.md

## Task Commits

Each task was committed atomically:

1. **Task 1: Add materialization guidance to dev-agent and product-agent prompts** - `83cf78f` (feat)

## Files Created/Modified
- `packages/agents/definitions/dev-agent/prompt.md` - Added materialization section with internal-first heuristic for sub-agents
- `packages/agents/definitions/product-agent/prompt.md` - Added materialization section with transparent-first heuristic for human-initiated work

## Decisions Made
- Placed materialization sections within `<domain_knowledge>` -- after Task Delegation (dev-agent) and after Implementation Delegation (product-agent) for natural reading flow
- Dev-agent guidance specifically calls out coder/researcher/tester as "almost always implementation details" to stay internal
- Product-agent guidance specifically calls out dev-agent and qa-agent delegations as good materialization candidates
- Used "think about whether a human PM would create a separate ticket" as the shared heuristic across both agents

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Agent prompts are ready for materialization tooling (Plans 03-05)
- Both agents understand the parameter shape that delegate_task/delegate_group will accept
- Prompt guidance will activate naturally once the materialization parameter is implemented in the tools

## Self-Check: PASSED

- [x] packages/agents/definitions/dev-agent/prompt.md exists
- [x] packages/agents/definitions/product-agent/prompt.md exists
- [x] 82-02-SUMMARY.md exists
- [x] Commit 83cf78f exists

---
*Phase: 82-transparent-materialization*
*Completed: 2026-02-20*
