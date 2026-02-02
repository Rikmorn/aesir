---
phase: 42-event-router-adapters
plan: 01
subsystem: agents
tags: [adapters, event-routing, zod, normalized-event, domain-types]

# Dependency graph
requires:
  - phase: 37-event-log
    provides: NormalizedEvent schema in @aesir/types
  - phase: 40-conversation-executor
    provides: Signal type and ConversationExecutor interface
provides:
  - IncomingEvent Zod schema and type for domain-language event representation
  - EventAdapter function type for NormalizedEvent-to-IncomingEvent transformation
  - Three adapter pure functions (Slack, GitHub, Linear) covering 10 fast-path rules
  - SIGNAL_TYPE_MAP for Temporal-to-v2.3 signal name migration reference
  - IGNORE_EVENT_TYPES set for explicitly ignored events
  - ALL_ADAPTERS barrel array for pipeline consumption
affects: [42-02-event-router, 42-03-router-integration, 47-cleanup]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure function adapter pattern: (NormalizedEvent) -> IncomingEvent | null"
    - "Start events preserve original dotted type for agent trigger matching"
    - "Signal events use domain-language types for wait_for matching"

key-files:
  created:
    - packages/agents/src/adapters/types.ts
    - packages/agents/src/adapters/slack.ts
    - packages/agents/src/adapters/github.ts
    - packages/agents/src/adapters/linear.ts
    - packages/agents/src/adapters/index.ts
    - packages/agents/src/adapters/slack.test.ts
    - packages/agents/src/adapters/github.test.ts
    - packages/agents/src/adapters/linear.test.ts
  modified: []

key-decisions:
  - "Start events preserve original dotted type (slack.app_mention.created, linear.agent_session.created) while signal events use domain-language types (approval, pr_merged, escalation_resolved)"
  - "GitHub adapter returns null when branch name does not match BRANCH_TASK_REGEX -- unresolvable correlation falls through to slow-path"
  - "Linear issue.created and issue.updated are adapted (not null) so IGNORE_EVENT_TYPES matching works in EventRouter"

patterns-established:
  - "Adapter pure function: stateless, no side effects, (NormalizedEvent) -> IncomingEvent | null"
  - "Source guard first: each adapter checks event.source before processing"
  - "Correlation key extraction: adapter-specific logic for conversation ID resolution"

# Metrics
duration: 3min
completed: 2026-02-02
---

# Phase 42 Plan 01: Adapter Functions Summary

**IncomingEvent domain type and three adapter pure functions transforming NormalizedEvent into domain-language types for EventRouter consumption**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-02T21:10:31Z
- **Completed:** 2026-02-02T21:14:07Z
- **Tasks:** 2
- **Files created:** 8

## Accomplishments
- IncomingEvent Zod schema with type, data, source, correlationKey, deduplicationId, and message fields
- Slack adapter covering 5 event types: approval (approved/rejected), escalation_resolved (retry/abort), app_mention start trigger
- GitHub adapter covering 2 event types: pr_merged and pr_closed with BRANCH_TASK_REGEX correlation extraction
- Linear adapter covering 3 event types: agent_session.created start trigger, issue.created/updated ignore events
- 22 new tests validating all 10 fast-path event type mappings plus slow-path null returns

## Task Commits

Each task was committed atomically:

1. **Task 1: IncomingEvent type and adapter types** - `7ce613c` (feat)
2. **Task 2: Three adapter pure functions with tests** - `a7d3b99` (feat)

## Files Created/Modified
- `packages/agents/src/adapters/types.ts` - IncomingEvent schema, EventAdapter type, SIGNAL_TYPE_MAP, IGNORE_EVENT_TYPES
- `packages/agents/src/adapters/slack.ts` - Slack adapter: approval, escalation, app_mention
- `packages/agents/src/adapters/github.ts` - GitHub adapter: pr_merged, pr_closed with branch regex
- `packages/agents/src/adapters/linear.ts` - Linear adapter: agent_session, issue.created/updated
- `packages/agents/src/adapters/index.ts` - Barrel exports and ALL_ADAPTERS array
- `packages/agents/src/adapters/slack.test.ts` - 8 tests for Slack adapter
- `packages/agents/src/adapters/github.test.ts` - 8 tests for GitHub adapter
- `packages/agents/src/adapters/linear.test.ts` - 6 tests for Linear adapter

## Decisions Made
- Start events preserve original dotted type (e.g., `slack.app_mention.created`) because agent definition triggers match on those types. Signal events use domain-language types (e.g., `approval`, `pr_merged`) because agents' wait_for calls match on those types.
- GitHub adapter returns null when branch name doesn't match `BRANCH_TASK_REGEX` (e.g., `fix/some-bugfix`) -- these events can't be correlated to a conversation and fall through to slow-path.
- Linear `issue.created` and `issue.updated` are adapted (producing IncomingEvent) rather than returning null, so the EventRouter can match them against IGNORE_EVENT_TYPES for explicit ignore handling.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Adapters and IncomingEvent type are ready for EventRouter (Plan 02) to consume
- ALL_ADAPTERS array provides the adapter pipeline for the top-level event handler
- IGNORE_EVENT_TYPES set provides ignore matching for EventRouter
- SIGNAL_TYPE_MAP documents the Temporal-to-v2.3 signal name migration for reference
- Total test count: 1229 passing (22 new, up from 1207)

---
*Phase: 42-event-router-adapters*
*Completed: 2026-02-02*
