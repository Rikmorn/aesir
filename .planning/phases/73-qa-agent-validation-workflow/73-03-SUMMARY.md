---
phase: 73-qa-agent-validation-workflow
plan: 03
subsystem: testing
tags: [validation-script, e2e, triangular-workflow, synthetic-events, cli]

# Dependency graph
requires:
  - phase: 73-qa-agent-validation-workflow
    provides: "QA agent definition (73-01) and delegation prompts (73-02)"
  - phase: 70-task-delegation
    provides: "task:delegate, wait_for_task, delegation materializer"
  - phase: 71-completion-signaling
    provides: "Multi-type wait_for, completion result delivery"
  - phase: 68-shared-memory
    provides: "knowledge:store/query tools for test_result entries"
  - phase: 72-delegation-graph-observability
    provides: "Dashboard task tree visualization and health indicators"
provides:
  - "validate:workflow script for triggering triangular product->dev->QA workflow"
  - "Synthetic NormalizedEvent construction matching schema"
  - "Manual verification checklist for v2.7 milestone validation"
  - "Optional --poll flag for CLI-based task tree monitoring"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "CLI validation script pattern with loadEnvFromRoot and health check polling"
    - "Synthetic NormalizedEvent construction for integration testing"

key-files:
  created:
    - packages/agents/scripts/validate-workflow.ts
  modified:
    - packages/agents/package.json

key-decisions:
  - "console.log/console.error for CLI output (not pino -- script, not service)"
  - "Global fetch (Node 18+) -- no additional HTTP dependencies"
  - "Optional --poll flag as convenience (primary observation via dashboard)"

patterns-established:
  - "Validation script pattern: health check -> synthetic event -> dashboard URLs -> checklist"

# Metrics
duration: 2min
completed: 2026-02-11
---

# Phase 73 Plan 03: Validation Script Summary

**CLI validation script posting synthetic slack.app_mention.created event to trigger triangular product->dev->QA workflow with dashboard URLs and manual verification checklist**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-11T19:30:32Z
- **Completed:** 2026-02-11T19:33:06Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Created validate-workflow.ts that constructs a valid NormalizedEvent and posts to /events
- Health check polls agent-service before posting (30s timeout, 1s interval)
- Optional --poll flag monitors task tree API every 10s for up to 5 minutes
- 6-item manual verification checklist covers task tree, handshakes, signals, health, knowledge, conversations
- Prerequisite reminder printed for infrastructure setup

## Task Commits

Each task was committed atomically:

1. **Task 1: Create validate-workflow.ts script** - `21e0854` (feat)
2. **Task 2: Add validate:workflow script to package.json** - `b96e346` (chore)

## Files Created/Modified
- `packages/agents/scripts/validate-workflow.ts` - Validation script: health check, synthetic event, dashboard URLs, checklist
- `packages/agents/package.json` - Added validate:workflow script entry

## Decisions Made
- Used console.log/console.error instead of pino (CLI script, not a long-running service)
- Used global fetch (Node 18+) rather than adding axios or node:http
- Made --poll optional since primary observation path is the dashboard
- No new dependencies needed (nanoid already in @aesir/agents, fetch is global)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Phase 73 (QA Agent + Validation Workflow) is fully complete
- v2.7 Agent Collaboration milestone is complete -- all phases 67-73 shipped
- To validate: start infrastructure and run `pnpm --filter @aesir/agents validate:workflow`

## Self-Check: PASSED

- [x] packages/agents/scripts/validate-workflow.ts exists
- [x] packages/agents/package.json has validate:workflow entry
- [x] Commit 21e0854 exists (Task 1)
- [x] Commit b96e346 exists (Task 2)
- [x] pnpm run typecheck passes

---
*Phase: 73-qa-agent-validation-workflow*
*Completed: 2026-02-11*
