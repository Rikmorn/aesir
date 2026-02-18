---
phase: 74-quick-fixes
plan: 02
subsystem: testing
tags: [agent-definitions, yaml, vitest, structural-validation]

# Dependency graph
requires:
  - phase: 73-qa-agent
    provides: "13 test agent definitions with communication:notify"
provides:
  - "Cleaned test agent definitions without communication:notify"
  - "Structural validation test for all agent definitions"
affects: [agent-tests, agent-definitions]

# Tech tracking
tech-stack:
  added: []
  patterns: ["structural validation test loading real definitions through registry"]

key-files:
  created:
    - packages/agents/src/framework/agent-definitions.test.ts
  modified:
    - packages/agents/definitions/test-delegate-assigner/definition.yaml
    - packages/agents/definitions/test-timeout-assigner/definition.yaml
    - packages/agents/definitions/test-reject-assigner/definition.yaml
    - packages/agents/definitions/test-chain-initiator/definition.yaml
    - packages/agents/definitions/test-handoff-assigner/definition.yaml
    - packages/agents/definitions/test-tool-exerciser/definition.yaml
    - packages/agents/definitions/test-tool-exerciser/prompt.md
    - packages/agents/scripts/agent-tests/scenarios/tools.ts

key-decisions:
  - "Used biome-ignore for __dirname ESM polyfill naming convention"
  - "Updated test-tool-exerciser description to reference task namespace instead of communication"

patterns-established:
  - "Structural validation: load all definitions through registry to catch drift at test time"

requirements-completed: [QF-04]

# Metrics
duration: 3min
completed: 2026-02-16
---

# Phase 74 Plan 02: Remove communication:notify from test agents and add structural validation test

**Removed communication:notify from 6 test agents lacking channel context and added a structural validation test that loads all 19+ agent definitions through the registry at pnpm test time**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-16T21:59:45Z
- **Completed:** 2026-02-16T22:02:52Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- Removed communication:notify from 6 test agent definitions (delegate-assigner, timeout-assigner, reject-assigner, chain-initiator, handoff-assigner, tool-exerciser)
- Updated test-tool-exerciser prompt and tools scenario to stay in sync with cleaned definitions
- Created structural validation test that loads all definitions through the real AgentRegistry, catching Zod schema violations, missing prompt.md, and forbidden tools

## Task Commits

Each task was committed atomically:

1. **Task 1: Remove communication:notify from 6 test agent definitions and update tool-exerciser** - `61f16e2` (fix)
2. **Task 2: Add structural validation test for all agent definitions** - `231b0ca` (test)

## Files Created/Modified
- `packages/agents/definitions/test-delegate-assigner/definition.yaml` - Removed communication:notify from tools
- `packages/agents/definitions/test-timeout-assigner/definition.yaml` - Removed communication:notify from tools
- `packages/agents/definitions/test-reject-assigner/definition.yaml` - Removed communication:notify from tools
- `packages/agents/definitions/test-chain-initiator/definition.yaml` - Removed communication:notify from tools
- `packages/agents/definitions/test-handoff-assigner/definition.yaml` - Removed communication:notify from tools
- `packages/agents/definitions/test-tool-exerciser/definition.yaml` - Removed communication:notify, updated description
- `packages/agents/definitions/test-tool-exerciser/prompt.md` - Removed notify step, renumbered to 5 steps
- `packages/agents/scripts/agent-tests/scenarios/tools.ts` - Removed notify from description, expectations, and tags
- `packages/agents/src/framework/agent-definitions.test.ts` - New structural validation test (3 test cases)

## Decisions Made
- Used biome-ignore for __dirname ESM polyfill naming convention (standard ESM pattern, not worth renaming)
- Updated test-tool-exerciser YAML description to reference "task, knowledge, directory" instead of "knowledge, directory, communication" for consistency

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All test agent definitions are clean and consistent
- Structural validation test prevents future definition drift
- Ready for remaining Phase 74 plans

## Self-Check: PASSED

All 9 files verified present on disk. Both task commits (`61f16e2`, `231b0ca`) verified in git log.

---
*Phase: 74-quick-fixes*
*Completed: 2026-02-16*
