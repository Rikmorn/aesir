---
phase: 49-dashboard-infrastructure
plan: 02
subsystem: database
tags: [drizzle-orm, postgres, service-layer, read-only]

# Dependency graph
requires:
  - phase: 49-01
    provides: Next.js dashboard package with TypeScript config and build pipeline
provides:
  - Drizzle ORM database client with read-only connection pool
  - Local schema definitions for conversations, agent_events, agent_sessions
  - Service layer pattern with listConversations and countConversationsByStatus
affects: [50-conversation-list, 51-agent-detail, 52-event-timeline, 53-session-dashboard, 54-real-time, 55-docker-integration]

# Tech tracking
tech-stack:
  added: [drizzle-orm, pg, "@types/pg"]
  patterns: [service-layer-abstraction, local-schema-definitions, snake-to-camelCase-mapping]

key-files:
  created:
    - packages/dashboard/src/lib/db.ts
    - packages/dashboard/src/lib/schema.ts
    - packages/dashboard/src/services/conversations.ts
  modified:
    - packages/dashboard/package.json
    - pnpm-lock.yaml

key-decisions:
  - "Approach B (local schema) chosen over importing from @aesir/agents to avoid pulling full agents dependency tree"
  - "ConversationStatus cast used for Drizzle eq() type safety with string filter parameters"
  - "Service layer returns camelCase interfaces mapped from snake_case DB columns"

patterns-established:
  - "Service layer pattern: services/*.ts files abstract all DB queries behind typed async functions"
  - "Local schema pattern: lib/schema.ts mirrors agents schema without runtime dependency on @aesir/agents"
  - "DB client singleton: lib/db.ts exports a single configured Drizzle instance for all services"

# Metrics
duration: 4min
completed: 2026-02-04
---

# Phase 49 Plan 02: Database Client and Service Layer Summary

**Drizzle ORM read-only client with local schema definitions and conversations service layer pattern**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-04T13:40:53Z
- **Completed:** 2026-02-04T13:44:49Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Drizzle ORM configured with read-only connection pool (max 5 connections, idle 30s, connect 5s)
- Local schema definitions for all three agents tables (conversations, agent_events, agent_sessions) without dependency on @aesir/agents
- Service layer with `listConversations` (pagination, status filter) and `countConversationsByStatus` query functions
- Full TypeScript type safety including Drizzle enum types for status fields

## Task Commits

Each task was committed atomically:

1. **Task 1: Add database dependencies and create Drizzle client** - `43f0baa` (feat)
2. **Task 2: Create conversations service layer** - `cdba29b` (feat)

**Plan metadata:** (pending)

## Files Created/Modified

- `packages/dashboard/src/lib/db.ts` - Drizzle ORM client with pg.Pool configuration
- `packages/dashboard/src/lib/schema.ts` - Local Drizzle table definitions for agents.conversations, agents.agent_events, agents.agent_sessions
- `packages/dashboard/src/services/conversations.ts` - Typed query functions: listConversations, countConversationsByStatus
- `packages/dashboard/package.json` - Added drizzle-orm, pg, @types/pg dependencies

## Decisions Made

1. **Approach B (local schema) over Approach A (import from @aesir/agents)**: The agents package has heavy dependencies (Anthropic SDK, Slack Bolt, pg-boss, etc.) that would unnecessarily bloat the dashboard. Local schema definitions trade slight duplication for complete independence. Schema changes are infrequent and the dashboard is read-only.

2. **ConversationStatus type cast for filter parameter**: Drizzle's `eq()` requires the right operand to match the column's enum type. The `status` filter parameter is typed as `string` (for API flexibility), so it's cast to `ConversationStatus` at the query boundary.

3. **Service layer returns camelCase interfaces**: Database uses snake_case (`agent_definition_id`), but TypeScript consumers get camelCase (`agentDefinitionId`). Mapping happens inside the service, keeping the interface clean.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed Drizzle eq() type mismatch for status filter**
- **Found during:** Task 2 (conversations service layer)
- **Issue:** `eq(conversations.status, opts.status)` failed typecheck because `opts.status` is `string` but the column expects `ConversationStatus` enum literal union
- **Fix:** Cast filter value: `eq(conversations.status, opts.status as ConversationStatus)`
- **Files modified:** packages/dashboard/src/services/conversations.ts
- **Verification:** `pnpm --filter @aesir/dashboard run typecheck` passes
- **Committed in:** cdba29b (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Minor type-safety fix required for Drizzle ORM's strict enum typing. No scope change.

## Issues Encountered

- Biome formatter required single-line import formatting for shorter imports (auto-fixed via `pnpm run format`)
- Task 1 commit accidentally included untracked Dockerfile from 49-01 that was in the working tree; harmless since it was already planned work

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Database client and service layer ready for all future view phases (50-55)
- Additional service files (events.ts, sessions.ts) can follow the same pattern
- The `lib/schema.ts` file should be updated if the agents schema changes (source of truth: `packages/agents/src/shared/db/schema.ts`)
- Docker-compose.yml has pending changes from 49-01 (dashboard service definition) that should be committed with plan 49-03

---
*Phase: 49-dashboard-infrastructure*
*Completed: 2026-02-04*
