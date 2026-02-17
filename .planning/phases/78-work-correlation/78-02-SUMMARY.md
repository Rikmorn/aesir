---
phase: 78-work-correlation
plan: 02
subsystem: adapters
tags: [event-routing, entity-ref, linear, github, slack, correlation]

# Dependency graph
requires:
  - phase: 78-work-correlation
    provides: "EntityRefSchema and entityRef field on IncomingEventSchema (Plan 01)"
provides:
  - "entityRef extraction on all Linear issue events (entityType: linear_issue)"
  - "entityRef extraction on all GitHub PR events (entityType: github_pr)"
  - "entityRef extraction on all Slack thread events (entityType: slack_thread)"
affects: [78-work-correlation, event-routing, correlation-router]

# Tech tracking
tech-stack:
  added: []
  patterns: ["conditional entityRef spread for events where entity fields may be absent"]

key-files:
  created: []
  modified:
    - packages/agents/src/adapters/types.ts
    - packages/agents/src/adapters/linear.ts
    - packages/agents/src/adapters/github.ts
    - packages/agents/src/adapters/slack.ts

key-decisions:
  - "Linear issue.created/updated use fallback (payload.issueId ?? payload.id) since payload shape varies"
  - "GitHub entityRef uses owner/repo#number format from repository payload (not config) for portability"
  - "Slack block action events include entityRef only when threadTs is present (conditional spread)"
  - "EntityRefSchema and entityRef added to IncomingEventSchema as part of Plan 01 parallel execution"

patterns-established:
  - "entityRef conditional spread: use ...(field && { entityRef: { ... } }) when entity fields may be absent"
  - "GitHub entity ID format: owner/repo#number (from payload.repository, not config)"
  - "Slack entity ID format: channelId:threadTs"

requirements-completed: [CORR-01]

# Metrics
duration: 5min
completed: 2026-02-17
---

# Phase 78 Plan 02: Adapter Entity Ref Extraction Summary

**Entity reference extraction added to all three adapters (Linear, GitHub, Slack) with typed entityRef for correlation routing**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-17T23:06:05Z
- **Completed:** 2026-02-17T23:10:45Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Linear adapter produces entityRef with entityType 'linear_issue' on all 5 issue-related event cases
- GitHub adapter produces entityRef with entityType 'github_pr' on all 3 PR event cases (merged, closed, reviews)
- Slack adapter produces entityRef with entityType 'slack_thread' on all 6 thread-based event cases
- Events without clear entity references (missing IDs, workspace-level) omit entityRef entirely

## Task Commits

Each task was committed atomically:

1. **Task 1: Add entityRef extraction to Linear adapter** - `8215c1c` (feat) -- committed alongside Plan 01 schema changes due to parallel execution overlap
2. **Task 2: Add entityRef extraction to GitHub and Slack adapters** - `de2d52e` (feat)

## Files Created/Modified
- `packages/agents/src/adapters/types.ts` - Added EntityRefSchema and entityRef optional field to IncomingEventSchema
- `packages/agents/src/adapters/linear.ts` - entityRef on all 5 issue-related event cases (agent_session.created, issue.created, issue.updated, comment.created, agent_session.prompted)
- `packages/agents/src/adapters/github.ts` - entityRef on all 3 PR event cases (pr_merged, pr_closed, pr_review)
- `packages/agents/src/adapters/slack.ts` - entityRef on all 6 thread-based event cases (4 block actions with threadTs, app_mention, thread_reply)

## Decisions Made
- **Linear issue.created/updated fallback:** Used `(payload.issueId ?? payload.id)` since the raw Linear webhook payload may provide the issue ID under different field names depending on the event source.
- **GitHub entity ID from payload, not config:** Used `repository.owner/repository.name#prNumber` from the event payload rather than the config's `githubOwner/githubRepo`. This is more accurate when the webhook could come from forked repos or when config doesn't match the actual event.
- **Slack block actions conditional entityRef:** Block action events (approval, escalation) only include entityRef when both `channelId` and `threadTs` are present. These events are interaction-based and may not always have thread context.
- **EntityRefSchema co-located with IncomingEventSchema:** Added to `adapters/types.ts` rather than a separate file since it's intrinsically part of the IncomingEvent shape.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added EntityRefSchema and entityRef to IncomingEventSchema**
- **Found during:** Task 1 (Linear adapter entityRef extraction)
- **Issue:** Plan 01 had not yet committed the EntityRefSchema type definition that this plan depends on. TypeScript would reject entityRef on IncomingEvent objects.
- **Fix:** Added EntityRefSchema Zod object and entityRef optional field to IncomingEventSchema in types.ts. These changes were then committed by the parallel Plan 01 executor as part of its `8215c1c` commit.
- **Files modified:** packages/agents/src/adapters/types.ts
- **Verification:** pnpm run typecheck passes
- **Committed in:** 8215c1c (Plan 01 commit, parallel execution overlap)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary type definition for adapter changes to compile. No scope creep -- this was Plan 01's responsibility, resolved via parallel execution.

## Issues Encountered
- Parallel execution with Plan 01: Task 1's Linear adapter changes and types.ts changes were picked up by the Plan 01 executor's `git add` and committed in `8215c1c`. This is the known parallel execution git staging overlap. Task 1 work is verified correct in that commit. Task 2 committed cleanly as a separate commit.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All three adapters now produce entityRef on entity-related events
- The correlation router (Plan 05) can use entityRef for work correlation lookup
- Entity ID formats are stable: Linear=issueId, GitHub=owner/repo#number, Slack=channelId:threadTs

## Self-Check: PASSED

All files verified present. All commits verified in git log.

---
*Phase: 78-work-correlation*
*Completed: 2026-02-17*
