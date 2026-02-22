---
phase: 84-scheduled-execution
verified: 2026-02-22T21:15:00Z
status: passed
score: 12/12 must-haves verified
re_verification: false
---

# Phase 84: Scheduled Execution Verification Report

**Phase Goal:** Agents can run on a schedule for periodic work like backlog grooming or monitoring, breaking the purely reactive event-driven model
**Verified:** 2026-02-22T21:15:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Agent definitions can declare schedule triggers with name, cron, and optional timezone | VERIFIED | `schedules` field in `AgentDefinitionYamlSchema` in `types.ts` lines 304-338 |
| 2 | Invalid cron expressions are rejected at YAML load time via Zod refinement | VERIFIED | `.refine()` on cron field using `CronExpressionParser.parse()` from cron-parser |
| 3 | Schedule registry can register, reconcile, and handle pg-boss cron jobs | VERIFIED | `createScheduleRegistry()` in `schedule-registry.ts` — `registerAll()` calls `boss.createQueue`, `boss.schedule`, `boss.work`, and reconciles stale `schedule:` prefix entries |
| 4 | Schedule handler builds synthetic IncomingEvent with schedule context and routes through EventRouter | VERIFIED | `handleScheduleFire()` builds `IncomingEvent` with type `schedule.triggered`; `main.ts` wires `scheduleRegistry.setEventHandler()` calling `eventRouter.handle()` then `executor.start()` |
| 5 | Overlap detection skips new runs when previous conversation is still active | VERIFIED | Pool query in `handleScheduleFire()` checks `status IN ('queued', 'running', 'waiting')`; skip logged as `event.routed`; manual trigger returns 409 |
| 6 | Schedule context XML block includes last run info, run count, and trigger type | VERIFIED | `buildScheduleContext()` returns `<schedule_context>` block with Schedule, Last run, Time since last run, Last run outcome, Last run summary, Run count, Trigger |
| 7 | EventRouter handles schedule.triggered events by extracting agentId from event data | VERIFIED | Step 1.5 in `event-router.ts` handle() method; 5 new tests all passing |
| 8 | Schedule registry is initialized and registered on worker startup in main.ts | VERIFIED | `scheduleRegistry` created at step 8a in `main.ts`, `registerAll(boss)` called in pg-boss startup block |
| 9 | Schedule state is updated when a scheduled conversation completes or fails | VERIFIED | `worker-loop.ts` extracts correlationKey from `conv.id`, checks for `:` separator, calls `scheduleRegistry.updateScheduleState()` on both completion and failure paths (fire-and-forget) |
| 10 | Manual trigger API creates a synthetic event and respects skip policy by default | VERIFIED | `POST /api/schedules/:agentId/:scheduleName/trigger` in `schedule-trigger.ts` — validates agent/schedule, checks overlap (409), builds context, routes via EventRouter |
| 11 | Agent list page shows schedule indicator on agents that have schedules | VERIFIED | `agent-list.tsx` renders `<Clock>` icon + count badge when `agent.schedules.length > 0` |
| 12 | Overview page shows upcoming schedules card with next 5 scheduled runs across agents | VERIFIED | `UpcomingSchedulesCard` rendered in `live-overview.tsx`; `app/page.tsx` fetches via `fetchAllScheduleStates()` in `Promise.all` |

**Score:** 12/12 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/agents/src/framework/types.ts` | `schedules` field in AgentDefinitionYamlSchema | VERIFIED | `schedules` Zod array with name, cron (with refine), timezone fields present |
| `packages/agents/src/shared/db/migrations/0019_add_schedule_state.sql` | `agents.schedule_state` table with composite PK | VERIFIED | File exists, creates table with agent_id+schedule_name composite PK |
| `packages/agents/src/framework/schedule-registry.ts` | Schedule registration, reconciliation, cron handling, context builder | VERIFIED | 379 lines; `createScheduleRegistry()` exported; all 5 interface methods implemented with real logic |
| `packages/agents/src/framework/schedule-registry.test.ts` | Unit tests for schedule registry (min 80 lines) | VERIFIED | 522 lines, 12 tests, all passing |
| `packages/agents/src/framework/event-router.ts` | schedule.triggered event handling | VERIFIED | Step 1.5 handler present; 5 dedicated tests |
| `packages/agents/src/service/api/schedule-trigger.ts` | POST /api/schedules/:agentId/:scheduleName/trigger endpoint | VERIFIED | 233 lines; `createScheduleTriggerRouter()` exported; includes GET /states endpoint co-located |
| `packages/agents/src/service/main.ts` | Schedule registry bootstrap wiring | VERIFIED | `scheduleRegistry` created at step 8a, `setEventHandler` wired, `registerAll` called |
| `packages/dashboard/src/lib/agent-service.ts` | ScheduleState type and schedule fetch functions | VERIFIED | `ScheduleState` interface, `fetchScheduleStates()`, `fetchAllScheduleStates()`, `triggerSchedule()` all present |
| `packages/dashboard/src/components/agents/agent-schedule-panel.tsx` | AgentSchedulePanel component | VERIFIED | 337 lines, client component, `triggerSchedule()` wired, health dots, inline trigger feedback |
| `packages/dashboard/src/components/overview/upcoming-schedules-card.tsx` | UpcomingSchedulesCard for overview page | VERIFIED | 111 lines, sorts by nextRunAt, shows health dot + relative time, links to agent pages |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `schedule-registry.ts` | `types.ts` | AgentDefinition schedules field | VERIFIED | Imports `ScheduleRegistry`, `ScheduleRegistryOptions`, `ScheduleState` from `./types.js`; reads `def.schedules` in `registerAll()` |
| `schedule-registry.ts` | `schema.ts` | schedule_state table for context injection | VERIFIED | `buildScheduleContext()` queries `agents.schedule_state` via pool; `updateScheduleState()` upserts to same table |
| `event-router.ts` | `main.ts` | schedule.triggered events processed by routeEvent pipeline | VERIFIED | `main.ts` wires `scheduleRegistry.setEventHandler()` calling `eventRouter.handle(event)` + `executor.start()` |
| `schedule-trigger.ts` | `schedule-registry.ts` | Manual trigger creates synthetic event via schedule registry | VERIFIED | `schedule-trigger.ts` imports `ScheduleRegistry` type; calls `scheduleRegistry.buildScheduleContext()` and `scheduleRegistry.getAllScheduleStates()` |
| `worker-loop.ts` | `schedule-registry.ts` | Post-completion hook updates schedule state | VERIFIED | `options.scheduleRegistry.updateScheduleState()` called on both completion (outcome="completed") and failure (outcome="failed") paths |
| `agent-schedule-panel.tsx` | `agent-service.ts` | ScheduleState type and triggerSchedule function | VERIFIED | Imports `ScheduleState` type and `triggerSchedule` function from `@/lib/agent-service` |
| `app/page.tsx` | `upcoming-schedules-card.tsx` | UpcomingSchedulesCard rendered in overview grid | VERIFIED | `fetchAllScheduleStates()` called in `Promise.all`, passed to `LiveOverview` which renders `<UpcomingSchedulesCard scheduleStates={scheduleStates} />` |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| SCH-01 | 84-01 | Agents declare `schedule` triggers in definition.yaml with name, cron, timezone | SATISFIED | `AgentDefinitionYamlSchema.schedules` field in `types.ts` |
| SCH-02 | 84-01 | Cron expression validated at definition load time | SATISFIED | `.refine()` using `CronExpressionParser.parse()` rejects invalid expressions |
| SCH-03 | 84-01, 84-02 | On startup, register pg-boss scheduled jobs for all agents with schedules | SATISFIED | `scheduleRegistry.registerAll(boss)` called in `main.ts` during pg-boss startup block |
| SCH-04 | 84-01, 84-02 | When schedule fires, create synthetic `IncomingEvent` with `schedule.triggered` type; EventRouter processes it | SATISFIED | `handleScheduleFire()` builds `IncomingEvent`; `event-router.ts` step 1.5 routes to `executor.start()` |
| SCH-05 | 84-01, 84-02 | Overlap prevention — skip policy (drop if previous run active). Note: spec simplified from "configurable" to skip-only (no queue policy) | SATISFIED | Overlap query in `handleScheduleFire()` + 409 in manual trigger; spec explicitly removed queue policy |
| SCH-06 | 84-01 | Scheduled conversations receive `<schedule_context>` block with last run info | SATISFIED | `buildScheduleContext()` returns full XML block injected into `event.message` |
| SCH-07 | 84-02, 84-03 | Manual trigger API + dashboard button | SATISFIED | `POST /api/schedules/:agentId/:scheduleName/trigger` with force flag; `AgentSchedulePanel` "Run now" button calling `triggerSchedule()` |
| SCH-08 | 84-03 | Schedule visibility in dashboard — next run time, last run status, run history | SATISFIED | Agent list badge, `AgentSchedulePanel` on agent detail, `UpcomingSchedulesCard` on overview |

**Notes on SCH-05:** REQUIREMENTS.md preserves the original "configurable: skip or queue" language, but `.planning/specs/2.9-platform-completion.md` explicitly simplified this to skip-only ("No `queue` policy — queuing stale runs creates cascading backlogs with outdated context"). The implementation correctly follows the spec. This is not a gap.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | — | — | — | — |

No TODO/FIXME markers, placeholder returns, empty handlers, or console.log calls found in any phase 84 artifacts.

---

### Test Results

| Test Suite | Tests | Result |
|-----------|-------|--------|
| `schedule-registry.test.ts` | 12/12 | All passing |
| `event-router.test.ts` (schedule.triggered section) | 5/5 | All passing |
| `pnpm run typecheck` (all packages) | — | Clean — no errors |

---

### Human Verification Required

The following behaviors cannot be verified programmatically:

#### 1. End-to-end schedule fire in running service

**Test:** Define a test agent with a `schedules:` entry using a very frequent cron (e.g., `* * * * *`), start the service, and wait for pg-boss to fire the schedule.
**Expected:** A new conversation appears in the dashboard within 2 minutes. The conversation's initial message contains `<schedule_context>` with "Never" as the last run. After a second fire, the block shows the previous run's timestamp and outcome.
**Why human:** Requires a live pg-boss instance, running agent service, and real-time database observation.

#### 2. Manual trigger button skip detection with toast feedback

**Test:** With an agent that has a schedule, start a long-running conversation via the schedule. Navigate to the agent detail page and click "Run now" before the conversation completes.
**Expected:** The button shows a "Previous run still active" inline message (or equivalent feedback), and a "Force run" option appears.
**Why human:** Requires live service state and UI interaction to verify the 409 path translates to correct visual feedback.

#### 3. Upcoming Schedules card next run time accuracy

**Test:** Configure a schedule for a known time (e.g., `0 12 * * *` for noon UTC). Check the overview page's Upcoming Schedules card.
**Expected:** The card shows the correct relative time to the next noon UTC (e.g., "in 3h 42m" if it's currently 08:18 UTC).
**Why human:** Next run is computed server-side via cron-parser; accuracy requires a visual spot-check with known inputs.

---

### Gaps Summary

No gaps. All 12 observable truths are verified. Every SCH-01 through SCH-08 requirement has direct implementation evidence in the codebase. Tests pass, typecheck is clean, and key links are wired end-to-end.

The REQUIREMENTS.md SCH-05 language ("configurable: skip or queue") does not match the implementation (skip-only), but this is intentional — the spec decision document at `.planning/specs/2.9-platform-completion.md` explicitly simplified this requirement before implementation. The implementation is correct per the authoritative spec.

---

_Verified: 2026-02-22T21:15:00Z_
_Verifier: Claude (gsd-verifier)_
