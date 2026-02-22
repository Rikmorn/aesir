# Phase 84: Scheduled Execution - Research

**Researched:** 2026-02-22
**Status:** Ready for planning

---

## 1. pg-boss Cron Scheduling API

### Version & Dependencies
- pg-boss **v12.8.0** (already in `packages/agents/package.json` as `^12.8.0`)
- Internally uses `cron-parser@^5.5.0` for cron expression parsing/validation
- Cron scheduling is **already enabled** -- the PgBoss constructor in `timeout-scheduler.ts` passes `schedule: true`

### Core Schedule Methods (from `index.d.ts`)

```typescript
// Register/update a cron schedule (idempotent -- INSERT ... ON CONFLICT UPDATE)
schedule(name: string, cron: string, data?: object | null, options?: ScheduleOptions): Promise<void>;

// Remove a schedule by name + optional key
unschedule(name: string, key?: string): Promise<void>;

// List schedules (optional name/key filter)
getSchedules(name?: string, key?: string): Promise<Schedule[]>;
```

### Key Types

```typescript
interface Schedule {
  name: string;      // Queue name the cron fires into
  key: string;       // Additional key (empty string if not set)
  cron: string;      // 5-field cron expression
  timezone: string;  // IANA timezone
  data?: object;     // Data payload for created jobs
  options?: SendOptions;
}

type ScheduleOptions = SendOptions & {
  tz?: string;   // Timezone (default UTC)
  key?: string;  // Schedule key for differentiation
};
```

### How pg-boss Cron Works Internally
1. `schedule()` stores the schedule in the `pgboss.schedule` table (INSERT ON CONFLICT UPDATE -- truly idempotent)
2. A timekeeper monitors at `cronMonitorIntervalSeconds` (default 30s, max 45s)
3. On each check, it calls `cron-parser` to determine if each schedule should fire
4. Matching schedules create jobs via `boss.insert()` into a `__pgboss__send-it` internal queue
5. A worker on that queue dispatches the actual job to the named queue
6. **Important**: The schedule fires a job into the queue named `name`. You must have `boss.work(name, handler)` registered to process it.

### Schedule Persistence
- Stored in `pgboss.schedule` table (managed by pg-boss, not our migrations)
- `schedule()` is an upsert -- safe to call on every startup
- `unschedule()` deletes the row -- used for reconciliation

### Existing Usage Pattern (main.ts lines 420-439)

```typescript
const boss = timeoutScheduler.getBoss();
if (boss) {
  const DEDUP_CLEANUP_QUEUE = "webhook-dedup-cleanup";
  await boss.createQueue(DEDUP_CLEANUP_QUEUE);
  await boss.schedule(DEDUP_CLEANUP_QUEUE, "0 * * * *", {});
  await boss.work(DEDUP_CLEANUP_QUEUE, async () => { /* handler */ });
}
```

This is the exact template for schedule registration. The pattern is: createQueue -> schedule -> work.

### Boss Instance Access
- `timeoutScheduler.getBoss()` returns the PgBoss instance after `start()` is called
- Available after `executor.startWorker()` in main.ts (line 418)
- The boss instance is shared across timeout scheduling, dedup cleanup, and now cron schedules

---

## 2. Agent Definition Schema Extension

### Current Schema (`types.ts` lines 254-303)

The `AgentDefinitionYamlSchema` is a Zod schema. The `triggers` field is the peer for the new `schedules` field:

```typescript
triggers: z.array(z.object({
  event: z.string().min(1),
})).optional(),
```

### Where to Add `schedules`

Add as a peer field to `triggers` in `AgentDefinitionYamlSchema`:

```typescript
schedules: z.array(z.object({
  name: z.string().min(1),
  cron: z.string().min(1),       // 5-field cron expression
  timezone: z.string().optional(), // IANA timezone, defaults to UTC
})).optional(),
```

### Flow Through the System

1. **YAML file** (`definitions/{agent}/definition.yaml`) -- declares schedules
2. **AgentRegistry** (`agent-registry.ts`) -- loads YAML, validates with Zod, produces `AgentDefinition`
3. **AgentDefinition** (`types.ts` line 318) -- `interface AgentDefinition extends AgentDefinitionYaml` -- automatically picks up new fields
4. **AgentRegistrySummary/Detail** (`api/agents-registry.ts`) -- `toSummary()` spreads all non-systemPrompt fields, so schedules flow through to the API automatically
5. **Dashboard** (`lib/agent-service.ts`) -- `AgentSummary` interface needs `schedules` added manually (dashboard maintains its own types)

### Cron Validation

pg-boss uses `cron-parser@^5.5.0` internally. The `schedule()` method calls `CronExpressionParser.parse(cron, { tz, strict: false })` and throws on invalid cron. Two options:

1. **Validate at YAML load time** (AgentRegistry) -- import `cron-parser` directly, fail fast on boot
2. **Validate at registration time** (schedule registration) -- let pg-boss `schedule()` throw on invalid cron

Recommendation: Validate at YAML load time with `cron-parser` (already a transitive dependency via pg-boss). This catches errors at boot instead of silently having an agent with an invalid schedule. Could add a Zod `.refine()` to the cron field.

---

## 3. Schedule Registration & Reconciliation

### Registration Location

After `executor.startWorker()` in `main.ts` (line 418), where `timeoutScheduler.getBoss()` becomes available. This is the same location as the existing dedup cleanup schedule (line 420-439).

### Registration Flow

For each agent definition with `schedules`:
1. Create the queue: `boss.createQueue(queueName)` -- queue name like `schedule:${agentId}:${scheduleName}`
2. Register the schedule: `boss.schedule(queueName, cronExpr, { agentId, scheduleName, ... }, { tz })`
3. Register the worker: `boss.work(queueName, handler)` -- handler creates synthetic event

### Reconciliation on Startup

Per CONTEXT.md: "Reconcile on startup: register everything from definitions, unregister pg-boss jobs that no longer match any definition."

1. Load all definitions with schedules via `agentRegistry.list()`
2. Build a set of expected schedule names
3. Call `boss.getSchedules()` to get all registered schedules
4. Filter to schedule-prefixed queues (e.g., `schedule:*`)
5. `unschedule()` any that are not in the expected set
6. `schedule()` all expected ones (idempotent upsert)

### New Module Location

Create `packages/agents/src/framework/schedule-scheduler.ts` (parallel to `timeout-scheduler.ts`). Alternatively, a `schedule-registry.ts` name would better convey its purpose since it registers schedules rather than scheduling timeouts.

---

## 4. Synthetic Event Creation & Routing

### Event Structure

Per CONTEXT.md: Synthetic event type `schedule.triggered`, source `scheduler`.

The synthetic event should conform to `IncomingEvent` schema:

```typescript
const syntheticEvent: IncomingEvent = {
  type: "schedule.triggered",
  source: "scheduler",
  correlationKey: `${agentId}:${scheduleName}`,
  data: {
    agentId,
    scheduleName,
    cron,
    lastRunAt,
    lastRunOutcome,
    lastRunOutcomeSummary,
    runCount,
    trigger: "scheduled",  // or "manual"
  },
  message: `Scheduled run: ${scheduleName}`,
};
```

### Routing Path Options

**Option A: Direct EventRouter.handle()** -- Add `schedule.triggered` as a start rule. The EventRouter's `loadStartRules()` builds start rules from agent triggers. Adding synthetic trigger entries for scheduled agents would let the existing routing pipeline handle them.

**Option B: Direct executor.start()** -- The schedule worker handler calls `executor.start()` directly, bypassing EventRouter. This is simpler since the schedule handler already knows the agentId and correlationKey.

**Recommendation**: Option B (direct `executor.start()`) is cleaner because:
- Schedule handler already knows the exact target agent (no routing needed)
- Avoids polluting EventRouter start rules with synthetic types
- The correlationKey is deterministic (`${agentId}:${scheduleName}`)
- Still uses the same ConversationExecutor idempotency
- Similar to how delegation starts conversations directly via `executor.start()`

However, per CONTEXT.md: "Scheduled runs go through EventRouter (not direct ConversationExecutor.start())." This is a **locked decision** -- must go through EventRouter.

### EventRouter Integration

The EventRouter's start rules are built from agent definition triggers. Schedule events need a different path since they're synthetic:

1. Add `schedule.triggered` as a trigger event in each scheduled agent's definition? **No** -- that would conflate triggers (external events) with schedules (internal cron).
2. Add special handling in `EventRouter.handle()` for `schedule.triggered` events? **Yes** -- the event data contains `agentId`, so the router can extract it directly without needing a start rule.

The handler would check: if `event.type === "schedule.triggered"`, extract `agentId` from `event.data`, use `event.correlationKey` for the conversation ID, and return a `start` decision.

### CorrelationKey & Overlap Detection

Per CONTEXT.md: `correlationKey: ${agentId}:${scheduleName}` (deterministic).

The `executor.start()` idempotency mechanism already handles overlap:
- `baseId = ${agentDefinitionId}-${correlationKey}` = `${agentId}-${agentId}:${scheduleName}`
- If a conversation with that ID is in an active status (queued/running/waiting), `start()` returns the existing ID (idempotent no-op)
- If terminal, it creates a re-triggered conversation with `-r{N}` suffix

**Wait** -- this means the correlationKey `${agentId}:${scheduleName}` produces a conversation ID like `product-agent-product-agent:weekly-grooming`. The agent ID is duplicated. Should the correlationKey just be `${scheduleName}` instead? Let's check...

Per CONTEXT.md: "CorrelationKey: `${agentId}:${scheduleName}` -- deterministic, enables start() idempotency." This is a locked decision. The duplication in the conversation ID is acceptable -- it ensures global uniqueness across agents with the same schedule name.

### Overlap Policy (Skip)

The existing `start()` idempotency already implements skip:
1. If active conversation exists -> returns existing ID (no new conversation created)
2. If terminal -> creates new conversation with re-trigger suffix

The schedule handler just needs to detect the "already active" case and log it as a skipped run. The pg-boss worker handler:

```typescript
const convId = await executor.start({ agentDefinitionId: agentId, correlationKey, ... });
// start() is idempotent -- if conversation was already active, convId is the existing one
// Check if it was a new creation or idempotent return to determine skip
```

But `start()` doesn't distinguish between "created new" and "returned existing." We need to either:
1. Check conversation status before calling `start()` (extra query)
2. Modify `start()` return to include a flag (breaking change)
3. Accept the idempotency behavior as sufficient (the run "happens" even if it merges with an existing one)

Per CONTEXT.md: "Skipped runs are logged as events (for dashboard history)." This requires detecting the skip. Option 1 (pre-check) is simplest: query conversation status by the deterministic ID before calling start(). If active, log skip event and return.

---

## 5. Schedule Context Injection

### Pattern: XML Block in Initial Message

Per CONTEXT.md: "Format: structured XML block in the initial message (same pattern as delegation context blocks)."

### Existing Patterns

**Delegation context** (`delegate-task.ts` line 58):
```typescript
`<delegation task_id="${params.taskId}" from="${params.from}" depth="${params.depth}" max_depth="${params.maxDepth}">
${params.instruction}
...
</delegation>`
```

**Task context** (`worker-loop.ts` line 275):
```typescript
function buildTaskContextBlock(task, latestHandoff, handoffCount): string {
  const lines: string[] = ["<task_context>"];
  lines.push(`Task: ${task.id}`);
  // ... structured fields
  lines.push("</task_context>");
}
```

### Schedule Context Block

Per CONTEXT.md, fields: schedule name, last run timestamp, time since last run, last run outcome, run count.

```xml
<schedule_context>
Schedule: weekly-grooming
Last run: 2026-02-21T09:00:00Z
Time since last run: 7d 0h
Last run outcome: completed
Last run summary: Groomed 12 issues, triaged 3 new bugs, updated sprint priorities.
Run count: 15
Trigger: scheduled
</schedule_context>
```

### Schedule State for Context Injection

Per CONTEXT.md: "Lightweight schedule state cached (lastRunAt, lastRunOutcome, lastRunConversationId) for SCH-06 context injection without querying conversations."

This implies a storage mechanism for schedule state. Options:
1. **pg-boss job `data` field** -- store state in the schedule's data payload. But `schedule()` data is the *input* data for the job, not mutable state.
2. **Lightweight DB table** -- `agents.schedule_state` with fields: `agent_id`, `schedule_name`, `last_run_at`, `last_run_outcome`, `last_run_conversation_id`, `run_count`. Updated after each run completes.
3. **Conversation query** -- derive from existing conversations table by correlationKey pattern. Slower but no new table.

Recommendation: **Lightweight DB table** (`agents.schedule_state`). Simple, fast reads for context injection, avoids complex conversation queries. Updated by the schedule handler (on start) and the worker loop (on completion). Migration: `0019_add_schedule_state.sql`.

### Getting Last Run Outcome Summary

Per CONTEXT.md: "Final assistant message from previous conversation serves as natural summary."

When building the schedule context, query:
1. `schedule_state` table for `lastRunConversationId`
2. The conversation's `messages` array for the last assistant message
3. Extract text content as the summary

This is a single DB read (conversation row by ID) -- acceptable overhead for the context injection.

---

## 6. Manual Trigger API

### Endpoint

Per CONTEXT.md: `POST /api/schedules/:agentId/:scheduleName/trigger` with `{ force?: boolean }` body.

### Location

New sub-router in `packages/agents/src/service/api/`. Mount in `api/router.ts` alongside existing routers. The factory needs access to:
- `agentRegistry` (to validate agent/schedule exists)
- `executor` (to start conversations)
- `pool` or schedule state table access (to read schedule state)

### Skip Policy

Default: check if previous run is active. If active, return 409 or similar with skip message.
Force: bypass the check, use a timestamp-suffixed correlationKey to create a unique conversation.

Per CONTEXT.md: "Force run uses distinct correlationKey (timestamp suffix) to bypass idempotency."

```typescript
const correlationKey = force
  ? `${agentId}:${scheduleName}:${Date.now()}`
  : `${agentId}:${scheduleName}`;
```

### Manual vs Scheduled Differentiation

Per CONTEXT.md: "Manual runs get `trigger: 'manual'` field on synthetic event."

The `trigger` field in the event data distinguishes scheduled from manual runs. The schedule context block should also reflect this.

---

## 7. Dashboard Integration

### Current Agent Pages Architecture

**Agent list page** (`app/agents/page.tsx`):
- Fetches `AgentSummary[]` from agent-service HTTP API
- Renders cards with agent name, description, model, tools count
- Needs: schedule badge/indicator (e.g., clock icon + "N schedules" chip)

**Agent detail page** (`app/agents/[id]/page.tsx`):
- Fetches `AgentDetail` + recent conversations
- Two-column layout: sidebar (config panel) + tabbed content (prompt, tools, conversations)
- Needs: schedules tab or section in the sidebar

**Overview page** (`app/page.tsx`):
- Fetches status counts, active conversations, errors, token usage
- Uses grid cards layout
- Needs: "Upcoming Schedules" card

### Data Flow for Schedules

**Schedule definitions** already flow through the agent-service API:
- `AgentRegistry` loads definitions with schedules
- `AgentRegistrySummary` (the spread in `toSummary()`) automatically includes schedules
- Dashboard `AgentSummary` type needs the `schedules` field added

**Schedule runtime state** (last run, next run, status) needs a new API endpoint:
- `GET /api/schedules` -- list all schedule states across agents
- `GET /api/schedules/:agentId` -- schedule states for a specific agent
- Returns: schedule name, cron, timezone, next run time, last run (timestamp, outcome, conversation link), health state

### Dashboard Type Extensions

```typescript
// In lib/agent-service.ts
interface AgentSummary {
  // ... existing fields
  schedules?: Array<{
    name: string;
    cron: string;
    timezone?: string;
  }>;
}

// New types for schedule runtime state
interface ScheduleState {
  agentId: string;
  scheduleName: string;
  cron: string;
  timezone: string;
  nextRunAt: string;      // ISO timestamp
  lastRunAt: string | null;
  lastRunOutcome: string | null;
  lastRunConversationId: string | null;
  runCount: number;
  health: "healthy" | "failed" | "missed";
}
```

### Next Run Calculation

To show "next run time" in the dashboard, use `cron-parser` to compute the next occurrence from the cron expression + timezone. This can be done:
- **Server-side** in the schedule state API endpoint (recommended -- keeps cron parsing server-side)
- **Client-side** in the dashboard (would require shipping cron-parser to the browser)

### "Upcoming Schedules" Card

Per CONTEXT.md: "Overview page: 'Upcoming Schedules' card showing next 3-5 scheduled runs across all agents, sorted by time."

Requires: API endpoint that returns upcoming runs across all agents. The schedule state API can serve this by computing next runs from cron expressions.

---

## 8. Schedule State Storage

### Option A: Lightweight DB Table (Recommended)

```sql
CREATE TABLE agents.schedule_state (
  agent_id TEXT NOT NULL,
  schedule_name TEXT NOT NULL,
  last_run_at TIMESTAMP WITH TIME ZONE,
  last_run_outcome TEXT,           -- 'completed', 'failed', 'cancelled'
  last_run_conversation_id TEXT,
  last_run_summary TEXT,           -- Final assistant message excerpt
  run_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (agent_id, schedule_name)
);
```

**Pros**: Fast reads, simple updates, no complex queries. Primary key is the natural composite key.
**Cons**: New table + migration. Must be updated on conversation completion.

### Option B: Derive from Conversations

Query `conversations` table where `id LIKE '{agentId}-{agentId}:{scheduleName}%'` ordered by `created_at DESC LIMIT 1`.

**Pros**: No new table. Single source of truth.
**Cons**: Complex LIKE query on every context injection and dashboard render. Fragile pattern matching on conversation IDs. No `run_count` without COUNT query.

### Option C: pg-boss Schedule Metadata

Store state in the schedule's `data` field by re-calling `schedule()` with updated data after each run.

**Pros**: No new table. Colocated with schedule definition.
**Cons**: `schedule()` is an upsert that replaces data entirely. Race condition if a cron fires while we're updating. pg-boss schedule table is an internal detail we shouldn't depend on for application state.

### Recommendation: Option A

Option A is the cleanest. The table is small (one row per agent-schedule pair), the reads are by primary key, and updates are straightforward. The worker loop already has post-completion hooks where the update can happen.

---

## 9. Event Logging for Skip Visibility

Per CONTEXT.md: "Skipped runs are logged as events (for dashboard history)."

### How to Log Skipped Runs

When the schedule handler detects an overlap (active conversation exists), log a skip event. Options:

1. **agent_events table** -- requires a conversation_id, which doesn't exist for skipped runs. Could use the active conversation's ID or a synthetic one.
2. **New event type** -- add `schedule.skipped` to `agentEventTypeValues`. But agent events are conversation-scoped.
3. **Schedule state table** -- add a `last_skip_at` column and optionally a `skip_count`.
4. **Standalone events log** -- separate from conversation-scoped agent events.

Simplest approach: Log to the existing `agent_events` table using the active conversation's ID with a new event type `schedule.skipped` (or use `event.routed` with a skip payload, similar to how router events are logged with `conversation_id: "router"`).

Actually, the existing pattern from `router.ts` lines 44-75 shows `event.routed` events being inserted with `conversation_id: "router"` and `sequence: 0`. Schedule skip events can follow the same pattern: direct DB insert with a synthetic conversation ID.

---

## 10. Key Integration Points Summary

### Files That Need Modification

| File | Change |
|------|--------|
| `framework/types.ts` | Add `schedules` to `AgentDefinitionYamlSchema` |
| `framework/event-router.ts` | Handle `schedule.triggered` event type in `handle()` |
| `service/main.ts` | Schedule registration on startup, reconciliation |
| `service/api/router.ts` | Mount schedule trigger API sub-router |
| `shared/db/schema.ts` | Add `schedule_state` table (if lightweight table approach) |
| `shared/db/schema.drizzle.ts` | Mirror `schedule_state` table |
| `shared/db/migrations/0019_*.sql` | Create `schedule_state` table |
| `dashboard/src/lib/agent-service.ts` | Add `schedules` to `AgentSummary`, schedule state types |
| `dashboard/src/services/agents.ts` | Add schedule state fetching |
| `dashboard/src/services/overview.ts` | Add upcoming schedules query |
| `dashboard/src/app/agents/page.tsx` | Add schedule badge to agent cards |
| `dashboard/src/app/agents/[id]/page.tsx` | Add schedules section |
| `dashboard/src/app/page.tsx` | Add "Upcoming Schedules" card |

### New Files

| File | Purpose |
|------|---------|
| `framework/schedule-registry.ts` | Schedule registration, reconciliation, cron handler |
| `service/api/schedule-trigger.ts` | Manual trigger API endpoint |
| `dashboard/src/components/agents/agent-schedule-panel.tsx` | Schedule display component |
| `dashboard/src/components/overview/upcoming-schedules-card.tsx` | Overview card |

### File Ownership Boundaries (for parallel execution)

- **Framework/backend plans**: `framework/`, `service/`, `shared/db/`, `adapters/`
- **Dashboard plans**: `dashboard/src/`
- **Definition plans**: `definitions/`
- **Shared boundary**: `framework/types.ts` (schema), `service/api/` (API endpoints)

---

## 11. Testing Approach

### Unit Tests

- `schedule-registry.test.ts` -- registration, reconciliation, cron handler
- `schedule-trigger.test.ts` -- manual trigger API endpoint
- `event-router.test.ts` -- add test for `schedule.triggered` routing
- Schedule context block builder function

### Integration Test Considerations

Testing cron timing is inherently slow. Options:
- Test the handler directly (mock pg-boss, verify executor.start() is called)
- Test registration/reconciliation (mock boss.schedule/unschedule/getSchedules)
- Test overlap detection (mock executor.start() idempotency behavior)
- Dashboard: verify schedule data renders (mock API responses)

### Test Agent Definitions

Could add a `test-scheduled-agent/` definition with a fast cron for automated testing, but cron-based tests are fragile. Better to test the handler function directly.

---

## 12. Human-Readable Cron Formatting

Per CONTEXT.md (Claude's Discretion): "Human-readable cron expression formatting approach."

Options:
1. **`cronstrue`** -- popular library (2M+ weekly downloads) that converts cron to human-readable English. "0 9 * * 1" -> "At 09:00 AM, only on Monday"
2. **Custom formatter** -- build a simple one for common patterns. Limited but zero dependencies.
3. **`cron-parser` next()** -- already a transitive dependency. Can compute "next N occurrences" but doesn't produce human-readable descriptions.

Recommendation: `cronstrue` is the standard choice. Small library, well-maintained, handles edge cases. Add as a dashboard dependency (client-side formatting) or agent-service dependency (API-level formatting).

---

## 13. Risks and Considerations

### pg-boss Single Schedule Table
All schedules across all agents share one pg-boss `schedule` table. Queue naming convention (`schedule:{agentId}:{scheduleName}`) prevents collisions. Reconciliation must only touch schedule-prefixed entries to avoid deleting the dedup cleanup schedule.

### Worker Registration Lifecycle
`boss.work()` registers a worker for a queue. If an agent's schedule is removed, the worker remains registered until the process restarts. The reconciliation should also call `boss.offWork()` for removed schedules, or accept that orphaned workers are harmless (they'll just never receive jobs).

### Multi-Worker Deployment
pg-boss cron scheduling has leader election built in -- only one instance monitors cron and fires jobs. Multiple workers can process the fired jobs. The overlap check (via executor.start() idempotency) is process-safe because it uses `FOR UPDATE SKIP LOCKED`.

### Schedule State Consistency
The schedule state table must be updated atomically with conversation lifecycle events. The worker loop's post-completion hook is the right place. If the worker crashes between conversation completion and state update, the state becomes stale. On next run, the context will show outdated last_run info -- acceptable for non-critical context data.

### Dashboard Performance
Computing next run times from cron expressions on every page load is cheap (microseconds). Caching the schedule state API at 30-60s revalidation is sufficient.

---

*Phase: 84-scheduled-execution*
*Research completed: 2026-02-22*
