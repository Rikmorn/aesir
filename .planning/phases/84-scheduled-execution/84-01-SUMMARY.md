---
phase: 84-scheduled-execution
plan: 01
subsystem: framework
tags: [pg-boss, cron, schedule, zod, drizzle, vitest]

# Dependency graph
requires: []
provides:
  - "AgentDefinitionYamlSchema with schedules field and cron validation"
  - "agents.schedule_state table for tracking schedule execution history"
  - "createScheduleRegistry() factory for pg-boss cron registration and overlap detection"
  - "ScheduleRegistry, ScheduleState, ScheduleDefinition types"
  - "Schedule context XML builder for scheduled conversation injection"
affects: [84-02 (event-router integration), 84-03 (dashboard schedules)]

# Tech tracking
tech-stack:
  added: [cron-parser (direct dependency for Zod validation)]
  patterns: [schedule queue naming convention (schedule:{agentId}:{scheduleName}), late-bound event handler pattern, overlap skip policy via conversation status query]

key-files:
  created:
    - packages/agents/src/framework/schedule-registry.ts
    - packages/agents/src/framework/schedule-registry.test.ts
    - packages/agents/src/shared/db/migrations/0019_add_schedule_state.sql
  modified:
    - packages/agents/src/framework/types.ts
    - packages/agents/src/framework/index.ts
    - packages/agents/src/shared/db/schema.ts
    - packages/agents/src/shared/db/schema.drizzle.ts
    - packages/agents/package.json

key-decisions:
  - "cron-parser added as direct dependency (pnpm strict isolation prevents transitive resolution from pg-boss)"
  - "ScheduleRegistry uses late-bound setEventHandler() for main.ts wiring instead of constructor dependency"
  - "PgBoss type referenced via import('pg-boss').PgBoss (named export, not default)"
  - "Overlap detection queries conversations table directly via pool (not through executor)"
  - "Skip events logged as event.routed with conversation_id 'scheduler' (same pattern as router events)"
  - "Composite PK on schedule_state uses drizzle-orm primaryKey() helper (first usage in this schema)"

patterns-established:
  - "Schedule queue naming: schedule:{agentId}:{scheduleName}"
  - "Overlap policy: skip when active conversation exists for same correlationKey"
  - "Schedule context XML block: <schedule_context> with last run info, time since, run count, trigger type"

requirements-completed: [SCH-01, SCH-02, SCH-03, SCH-04, SCH-05, SCH-06]

# Metrics
duration: 9min
completed: 2026-02-22
---

# Phase 84 Plan 01: Schedule Foundation Summary

**Schedule YAML schema with cron-parser validation, agents.schedule_state table, and createScheduleRegistry() with pg-boss cron registration, reconciliation, overlap detection (skip policy), and schedule context XML builder**

## Performance

- **Duration:** 9 min
- **Started:** 2026-02-22T20:37:28Z
- **Completed:** 2026-02-22T20:47:00Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- AgentDefinitionYamlSchema extended with `schedules` field: name, cron (with cron-parser validation), and optional timezone
- agents.schedule_state table created for tracking per-schedule execution history (composite PK on agent_id + schedule_name)
- createScheduleRegistry() factory implemented with full pg-boss cron lifecycle: createQueue, schedule, work, reconciliation
- Overlap detection prevents duplicate runs when active conversation exists (skip policy)
- Schedule context XML builder provides last run info, time since last run, run count, and trigger type
- 12 unit tests covering registration, reconciliation, overlap detection, context building, and state management

## Task Commits

Each task was committed atomically:

1. **Task 1: YAML schema extension + database migration** - `6c5450e` (feat)
2. **Task 2: Schedule registry module** - `17ae452` (feat)

## Files Created/Modified
- `packages/agents/src/framework/types.ts` - Added schedules field to AgentDefinitionYamlSchema, ScheduleDefinition type, ScheduleState/ScheduleRegistry/ScheduleRegistryOptions interfaces
- `packages/agents/src/shared/db/migrations/0019_add_schedule_state.sql` - agents.schedule_state table with composite PK
- `packages/agents/src/shared/db/schema.ts` - scheduleState Drizzle table definition with primaryKey()
- `packages/agents/src/shared/db/schema.drizzle.ts` - Mirror of scheduleState for drizzle-kit
- `packages/agents/src/framework/schedule-registry.ts` - createScheduleRegistry() factory with registration, reconciliation, overlap, context builder
- `packages/agents/src/framework/schedule-registry.test.ts` - 12 unit tests
- `packages/agents/src/framework/index.ts` - Export createScheduleRegistry, SCHEDULE_QUEUE_PREFIX, buildScheduleQueueName
- `packages/agents/package.json` - Added cron-parser direct dependency

## Decisions Made
- **cron-parser as direct dependency:** pnpm strict isolation prevents transitive resolution from pg-boss. Added as direct dependency to agents package for Zod refine validation.
- **Late-bound event handler:** ScheduleRegistry uses setEventHandler() method instead of requiring the handler at construction time. This allows main.ts to create the registry before the route function is wired.
- **PgBoss type as named export:** pg-boss v12 exports PgBoss as a named class, not default. Used `import("pg-boss").PgBoss` in the interface definition.
- **Direct pool query for overlap:** Overlap detection queries the conversations table directly via pool.query() instead of going through ConversationExecutor, keeping the dependency graph simpler.
- **Composite PK via drizzle-orm primaryKey():** First table in this schema to use Drizzle's primaryKey() helper instead of defining the PK only in migration SQL.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added cron-parser as direct dependency**
- **Found during:** Task 1 (YAML schema extension)
- **Issue:** Plan assumed cron-parser was resolvable as transitive dependency of pg-boss, but pnpm strict isolation prevents this
- **Fix:** Added cron-parser as direct dependency via `pnpm --filter @aesir/agents add cron-parser`
- **Files modified:** packages/agents/package.json, pnpm-lock.yaml
- **Verification:** `require("cron-parser")` resolves from agents package context
- **Committed in:** 6c5450e (Task 1 commit)

**2. [Rule 1 - Bug] Fixed PgBoss type reference**
- **Found during:** Task 1 (types.ts ScheduleRegistry interface)
- **Issue:** Used `import("pg-boss").default` but pg-boss exports PgBoss as named export, not default
- **Fix:** Changed to `import("pg-boss").PgBoss`
- **Files modified:** packages/agents/src/framework/types.ts
- **Verification:** `pnpm run typecheck` passes
- **Committed in:** 6c5450e (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** Both auto-fixes necessary for correct compilation. No scope creep.

## Issues Encountered
None beyond the auto-fixed deviations above.

## User Setup Required
None - no external service configuration required. The migration (0019_add_schedule_state.sql) will be applied via `pnpm db:migrate` when the database is next initialized.

## Next Phase Readiness
- Schedule registry ready for wiring in main.ts (Plan 02)
- EventRouter needs schedule.triggered handling (Plan 02)
- Dashboard needs schedule types and components (Plan 03)
- ScheduleRegistry.setEventHandler() must be called during main.ts bootstrap

---
*Phase: 84-scheduled-execution*
*Completed: 2026-02-22*
