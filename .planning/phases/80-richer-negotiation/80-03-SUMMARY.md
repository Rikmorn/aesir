---
phase: 80-richer-negotiation
plan: 03
subsystem: agents
tags: [negotiation, delegation, agent-prompts, task-tools, clarification]

# Dependency graph
requires:
  - phase: 80-01
    provides: "task:clarify and task:answer tool implementations in tool-factories.ts"
provides:
  - "All delegation-capable agents (dev-agent, qa-agent, product-agent) equipped with task:clarify and task:answer tools"
  - "Generic negotiation personality guidance in all three agent prompts"
affects: [80-04, agent-definitions, prompt-updates]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Negotiation section as <negotiation> XML block within <domain_knowledge>"
    - "Cost-of-being-wrong framework for clarification decisions"
    - "Disposition hierarchy: accept > counter-propose > reject"

key-files:
  created: []
  modified:
    - packages/agents/definitions/dev-agent/definition.yaml
    - packages/agents/definitions/dev-agent/prompt.md
    - packages/agents/definitions/qa-agent/definition.yaml
    - packages/agents/definitions/qa-agent/prompt.md
    - packages/agents/definitions/product-agent/definition.yaml
    - packages/agents/definitions/product-agent/prompt.md

key-decisions:
  - "Same negotiation text for all three agents -- generic principles per locked decisions, no role-specific calibration"
  - "Placed <negotiation> section at end of <domain_knowledge> after delegation-related content in each prompt"
  - "No MUST/ALWAYS/NEVER directives in negotiation guidance -- follows PROMPT_GUIDE.md judgment-over-rules principle"

patterns-established:
  - "Negotiation guidance uses goal-oriented language, not procedural state machines"
  - "Intent vs implementation distinction for clarification decisions"

requirements-completed: [NEG-07]

# Metrics
duration: 2min
completed: 2026-02-20
---

# Phase 80 Plan 03: Agent Negotiation Definitions Summary

**task:clarify and task:answer tools added to all delegation-capable agents with cost-of-being-wrong negotiation guidance in prompts**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-20T18:55:57Z
- **Completed:** 2026-02-20T18:58:17Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Added task:clarify and task:answer to dev-agent, qa-agent, and product-agent definition.yaml tool lists
- Added generic negotiation personality guidance to all three agent prompts following the accommodating disposition hierarchy
- Guidance uses cost-of-being-wrong framework: clarify intent ambiguity, assume implementation ambiguity

## Task Commits

Each task was committed atomically:

1. **Task 1: Add task:clarify and task:answer to agent definitions** - `620b4c0` (feat)
2. **Task 2: Add negotiation personality guidance to agent prompts** - `fb299bd` (feat)

## Files Created/Modified
- `packages/agents/definitions/dev-agent/definition.yaml` - Added task:clarify and task:answer tools
- `packages/agents/definitions/qa-agent/definition.yaml` - Added task:clarify and task:answer tools
- `packages/agents/definitions/product-agent/definition.yaml` - Added task:clarify and task:answer tools
- `packages/agents/definitions/dev-agent/prompt.md` - Added <negotiation> section with delegation negotiation guidance
- `packages/agents/definitions/qa-agent/prompt.md` - Added <negotiation> section with delegation negotiation guidance
- `packages/agents/definitions/product-agent/prompt.md` - Added <negotiation> section with delegation negotiation guidance

## Decisions Made
- Used identical negotiation text across all three agents per locked decision that generic principles apply in v2.9 (role-specific calibration deferred to v3.0)
- Placed negotiation section at end of domain_knowledge in each prompt, after delegation-related content, to extend existing delegation guidance
- Avoided MUST/ALWAYS/NEVER directives in negotiation section per PROMPT_GUIDE.md -- used judgment-oriented phrasing ("Prefer", "Reserve rejection for", "Ask for clarification when")

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All delegation-capable agents can now use task:clarify and task:answer tools
- Agents have negotiation personality guidance for when to counter-propose vs reject and when to clarify vs assume
- Ready for 80-04 (dashboard negotiation timeline) or any integration testing

## Self-Check: PASSED

All 6 modified files exist. Both task commits (620b4c0, fb299bd) verified in git log.

---
*Phase: 80-richer-negotiation*
*Completed: 2026-02-20*
