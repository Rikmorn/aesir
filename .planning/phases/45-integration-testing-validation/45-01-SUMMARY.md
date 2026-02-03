---
phase: 45-integration-testing-validation
plan: 01
subsystem: testing
tags: [testcontainers, supertest, vitest, postgresql, integration-tests, drizzle]

# Dependency graph
requires:
  - phase: 37-conversation-persistence
    provides: agents schema SQL (conversations, agent_events, agent_sessions tables)
  - phase: 40-conversation-executor
    provides: ConversationExecutor, AgentRegistry, ToolRegistry, EventRouter
  - phase: 20-testing-pyramid
    provides: test-utils package with setupPostgresContainer and runTestMigrations
provides:
  - agentsMigrationSql in @aesir/test-utils for integration test database setup
  - Shared integration test setup (setupTestContext, teardownTestContext, cleanupTables)
  - Mock agent loop helpers (mockAgentLoopCompletes, mockAgentLoopPauses, mockAgentLoopErrors, mockAgentLoopSequence)
  - Test factory helpers (createTestAgentRegistry, createTestToolRegistry, createTestEventRouter)
  - waitForStatus polling utility for async executor state transitions
  - Legacy Temporal tests marked as skipped for Phase 47 cleanup
affects: [45-02-executor-integration, 45-03-event-routing-integration, 47-temporal-deletion]

# Tech tracking
tech-stack:
  added: [supertest, @types/supertest]
  patterns: [testcontainer lifecycle management, mock agent loop pattern, WaitForState interception for testing]

key-files:
  created:
    - packages/test-utils/src/migrations/agents.ts
    - packages/agents/src/framework/__integration__/setup.ts
    - packages/agents/src/framework/__integration__/helpers.ts
  modified:
    - packages/test-utils/src/migrations/index.ts
    - packages/agents/package.json
    - packages/agents/tsconfig.json
    - packages/agents/src/shared/temporal/activities/orchestrator-activities.test.ts
    - packages/agents/src/shared/temporal/activities/linear-activities.test.ts
    - packages/agents/src/shared/temporal/activities/slack-activities.test.ts
    - packages/agents/src/shared/temporal/activities/product-agent-activity.test.ts
    - packages/agents/src/shared/temporal/workflows/orchestrator-workflow.test.ts
    - packages/agents/src/shared/temporal/workflows/product-agent-workflow.test.ts

key-decisions:
  - "agentsMigrationSql concatenates 3 SQL migration files with drizzle-kit markers stripped"
  - "cleanupTables truncates only v2.3 tables (agent_events, agent_sessions, conversations CASCADE)"
  - "Mock helpers configure vi.fn() implementations rather than using vi.mock() -- test files control wiring"
  - "e2e-validation tests left untouched -- they test agent-loop via Anthropic SDK mocking, not Temporal"
  - "Legacy tests wrapped in describe.skip with Phase 47 preservation comments"

patterns-established:
  - "Integration test lifecycle: setupTestContext (container+migrations) / cleanupTables (per-test) / teardownTestContext (shutdown)"
  - "Mock agent loop pattern: mockAgentLoopCompletes/Pauses/Errors/Sequence configure mock function behavior without vi.mock()"
  - "Test registries: createTestAgentRegistry/ToolRegistry/EventRouter build in-memory registries with dev-agent and product-agent definitions"
  - "waitForStatus polling: poll executor.get() at configurable intervals until expected status or timeout"

# Metrics
duration: 15min
completed: 2026-02-03
---

# Phase 45 Plan 01: Integration Test Infrastructure Summary

**Testcontainer-based integration test setup with agents migration SQL, mock agent loop helpers, and 168 legacy Temporal tests marked for Phase 47 cleanup**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-02-03T11:40:00Z
- **Completed:** 2026-02-03T11:59:00Z
- **Tasks:** 3/3
- **Files modified:** 13 (3 created, 10 modified, 1 deleted)

## Accomplishments

- Created `agentsMigrationSql` in test-utils concatenating all 3 agents schema migration files for testcontainer setup
- Built shared integration test infrastructure: setup/teardown lifecycle, table cleanup, mock agent loop helpers, test registries, and async status polling
- Marked 168 legacy Temporal tests as skipped across 6 test files with Phase 47 preservation comments, and deleted the empty integration.test.ts placeholder

## Task Commits

Each task was committed atomically:

1. **Task 1: Install supertest + create agents migration SQL** - `19448a6` (chore)
2. **Task 2: Create shared integration test setup and helpers** - `a110695` (feat)
3. **Task 3: Mark legacy Temporal tests as skipped + delete placeholder** - `a4e152c` (chore)

## Files Created/Modified

- `packages/test-utils/src/migrations/agents.ts` - Concatenated agents schema SQL for testcontainer migrations
- `packages/test-utils/src/migrations/index.ts` - Added agentsMigrationSql export
- `packages/agents/src/framework/__integration__/setup.ts` - Testcontainer lifecycle (setup/teardown/cleanup)
- `packages/agents/src/framework/__integration__/helpers.ts` - Mock agent loop helpers, test registries, waitForStatus
- `packages/agents/package.json` - Added supertest, @types/supertest, @aesir/test-utils devDependencies
- `packages/agents/tsconfig.json` - Added test-utils project reference
- `packages/agents/src/shared/temporal/activities/orchestrator-activities.test.ts` - Wrapped in describe.skip (45 tests)
- `packages/agents/src/shared/temporal/activities/linear-activities.test.ts` - Wrapped in describe.skip (5 tests)
- `packages/agents/src/shared/temporal/activities/slack-activities.test.ts` - Wrapped in describe.skip (6 tests)
- `packages/agents/src/shared/temporal/activities/product-agent-activity.test.ts` - Wrapped in describe.skip (29 tests)
- `packages/agents/src/shared/temporal/workflows/orchestrator-workflow.test.ts` - Wrapped in describe.skip (59 tests)
- `packages/agents/src/shared/temporal/workflows/product-agent-workflow.test.ts` - Wrapped in describe.skip (24 tests)
- `packages/agents/src/dev-agent/integration.test.ts` - Deleted (empty Temporal placeholder)

## Decisions Made

- **agentsMigrationSql concatenation approach**: Followed existing pattern from linear.ts, github.ts, slack.ts in test-utils/migrations -- concatenate raw SQL with drizzle-kit markers stripped
- **cleanupTables scope**: Only truncates v2.3 tables (agent_events, agent_sessions, conversations) -- avoids touching schema/trigger definitions that don't change between tests
- **Mock helper design**: Helpers configure mock function implementations (not vi.mock()) so test files control the wiring -- more flexible and explicit
- **e2e-validation tests untouched**: These test agent-loop via Anthropic SDK mocking, not Temporal workflows -- they are v2.2+ tests that should remain active
- **describe.skip wrapping strategy**: Used outer describe.skip("LEGACY: ... -- Phase 47 cleanup") with preservation comments preventing premature deletion

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added @aesir/test-utils as devDependency to agents package**
- **Found during:** Task 2 (Create shared integration test setup)
- **Issue:** setup.ts imports from @aesir/test-utils but it was not in agents package.json dependencies
- **Fix:** Added @aesir/test-utils as devDependency and test-utils to tsconfig.json project references
- **Files modified:** packages/agents/package.json, packages/agents/tsconfig.json
- **Verification:** typecheck passes, imports resolve
- **Committed in:** a110695 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Essential for test infrastructure imports. No scope creep.

## Issues Encountered

- **Biome formatting on describe.skip wrappers**: The describe.skip wrapper adds a new indentation level, causing Biome to require re-indentation of all wrapped code. Resolved by running `pnpm run format` before committing Task 3.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Integration test infrastructure ready for 45-02 (ConversationExecutor integration tests)
- agentsMigrationSql available via @aesir/test-utils for any package needing agents schema in tests
- Mock agent loop helpers ready for controlling LLM behavior without real API calls
- Test registries provide in-memory AgentRegistry/ToolRegistry/EventRouter for isolated testing
- 168 legacy Temporal tests safely skipped (will run 0 tests) pending Phase 47 deletion

---
*Phase: 45-integration-testing-validation*
*Completed: 2026-02-03*
