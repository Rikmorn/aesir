# Technology Stack: v2.3 Unified Agent Framework

**Project:** Aesir v2.3 -- Replace Temporal with Postgres-backed ConversationExecutor
**Researched:** 2026-02-01
**Research mode:** Stack dimension for subsequent milestone
**Overall confidence:** HIGH (custom build over library for core, pg-boss for scheduling)

---

## Executive Summary

The v2.3 migration from Temporal to a Postgres-backed ConversationExecutor does NOT require a new job queue library for the core conversation execution loop. The ConversationExecutor's primary job -- "run an agent loop for this conversation" -- is a simple `SELECT FOR UPDATE SKIP LOCKED` pattern that fits in ~50 lines of SQL, not a generic job queue problem. Adding pg-boss or graphile-worker for this core concern would introduce an abstraction layer that fights the conversation-specific semantics (signal queueing, pending wait matching, conversation-level locking).

However, **pg-boss IS recommended for timeout scheduling** -- the "wake this conversation in 72 hours" problem. This is a pure delayed-job problem that pg-boss solves with its `startAfter` API, PostgreSQL-backed persistence, and distributed worker support. Rolling a custom timeout scheduler would be reinventing pg-boss badly.

The event log is a straightforward append-only table with batch inserts and LISTEN/NOTIFY for reactive subscriptions. No event sourcing library is needed -- Drizzle ORM handles the schema, and the implementation is ~200 lines of TypeScript.

Conversation history stored as JSONB in a single row is viable for Aesir's scale (conversations with 100 tool calls = ~200KB-2MB). The 2KB TOAST threshold is not a concern because conversations are written infrequently (on pause/complete, not every tool call) and reads are full-row loads (no partial JSONB queries).

**Net dependency changes:** Add `pg-boss@^12.8.0`. Remove `@temporalio/client`, `@temporalio/worker`, `@temporalio/workflow`, `@temporalio/activity` (from `@aesir/agents`) and `@temporalio/client`, `@temporalio/worker`, `@temporalio/workflow` (from `@aesir/platform`). Remove Temporal server + UI from Docker Compose (saves ~1GB of container images and a dedicated PostgreSQL schema).

---

## 1. Postgres Job Queue for Conversation Execution

### Recommendation: Custom SKIP LOCKED (NOT a job queue library)

| Property | Value |
|----------|-------|
| Approach | Custom `SELECT FOR UPDATE SKIP LOCKED` on `conversations` table |
| Implementation | ~50 lines of SQL in a polling loop, ~150 lines TypeScript wrapper |
| Confidence | **HIGH** -- well-documented pattern, used by pg-boss and graphile-worker internally |

### Why custom over a library

The ConversationExecutor has conversation-specific semantics that generic job queues don't model:

1. **Signal queueing**: When a signal arrives for a running conversation, it must be appended to `queued_signals` on the conversation row -- not create a new job.
2. **Wait type matching**: When resuming a paused conversation, the executor must check `pending_wait.type` matches the signal type. Generic queues don't have this concept.
3. **Idempotent start**: `executor.start()` with an existing conversation ID returns the existing conversation -- not an error or duplicate job.
4. **Conversation-level locking**: Only one agent loop per conversation. This is a row-level lock on the conversation, not a queue-level concurrency limit.
5. **Status-based routing**: The executor needs to query `WHERE status = 'paused' AND pending_wait->>'type' = $1` -- this is a conversation query, not a job dequeue.

A generic job queue would force mapping these semantics into jobs/tasks/queues, adding indirection without value. The conversation table IS the queue.

### The core pattern

```sql
-- Dequeue a conversation that needs processing
BEGIN;
SELECT * FROM agents.conversations
  WHERE status = 'queued'  -- or 'resuming'
  ORDER BY updated_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

-- Mark as running (within same transaction)
UPDATE agents.conversations
  SET status = 'running', updated_at = NOW()
  WHERE id = $1;
COMMIT;

-- Run agent loop (outside transaction -- long-running)
-- On completion: UPDATE status = 'completed' / 'paused'
-- On crash: transaction was committed with 'running' status
--   -> stale job detector picks it up (see heartbeat pattern below)
```

### Crash recovery

Conversations in `running` status with `updated_at` older than the heartbeat threshold (e.g., 5 minutes) are considered stale and re-queued. The agent loop updates `updated_at` periodically (heartbeat) via a simple `UPDATE conversations SET updated_at = NOW() WHERE id = $1`.

```sql
-- Stale job recovery (runs on a timer, e.g., every 60 seconds)
UPDATE agents.conversations
  SET status = 'queued', updated_at = NOW()
  WHERE status = 'running'
    AND updated_at < NOW() - INTERVAL '5 minutes';
```

### Polling + LISTEN/NOTIFY hybrid

- **LISTEN/NOTIFY** for instant wakeup when a new conversation is queued or signaled
- **Polling fallback** every 5 seconds to catch any missed notifications (LISTEN/NOTIFY is ephemeral)
- This is the exact pattern graphile-worker uses internally

```typescript
// Pseudocode for the worker loop
const POLL_INTERVAL = 5000; // 5 seconds

async function startWorker(pool: Pool) {
  // Set up LISTEN for instant notification
  const listenConn = await pool.connect();
  await listenConn.query('LISTEN conversation_ready');
  listenConn.on('notification', () => tryProcessNext());

  // Polling fallback
  setInterval(() => tryProcessNext(), POLL_INTERVAL);
}
```

### Performance characteristics

| Metric | Expected Value | Source |
|--------|---------------|--------|
| Dequeue latency (LISTEN/NOTIFY) | <3ms | Graphile Worker benchmarks |
| Dequeue latency (polling, 5s interval) | 0-5000ms avg 2500ms | Math |
| Throughput (queue) | ~99,600 jobs/sec (12-core DB) | Graphile Worker benchmarks |
| Throughput (process) | N/A -- limited by LLM API, not queue | Agent loops are minutes, not milliseconds |
| Concurrent conversations | Limited by Node.js concurrency + LLM rate limits | Practically 5-20 concurrent |

For Aesir's workload (agent loops that run for minutes, limited by LLM API throughput), queue performance is irrelevant. The bottleneck is always the Anthropic API, not the job dequeue.

### Alternatives considered and rejected

| Library | Version | Why Not |
|---------|---------|---------|
| **pg-boss** | 12.8.0 | Good library, but adds abstraction over what is fundamentally a conversation table query. pg-boss manages its own schema (`pgboss.*`), its own connection pool, and its own job lifecycle. The ConversationExecutor needs to query conversations by status, pending_wait type, and conversation ID -- these are domain queries that don't map to pg-boss's queue/job model cleanly. Would need to maintain both a pg-boss job AND a conversation record, with synchronization between them. |
| **graphile-worker** | 0.16.6 | Same issue as pg-boss plus: last published 2+ years ago (0.16.6), unstable API (0.x versioning, "updating to a new minor version may require code modifications"), manages its own schema (`graphile_worker.*`). Excellent for generic background jobs but overkill for conversation-specific execution. |
| **BullMQ** | N/A | Requires Redis. Adding Redis to the infrastructure contradicts the v2.3 goal of Postgres-only local dev. |
| **PGMQ** | 1.9.0 | Postgres extension (requires `CREATE EXTENSION pgmq`). Not available on all managed Postgres providers. TypeScript clients are immature (pgmq-js, pgmq-ts). Designed for inter-service messaging, not conversation execution. |

---

## 2. Timeout Scheduling ("Wake in 72 Hours")

### Recommendation: pg-boss for delayed jobs

| Property | Value |
|----------|-------|
| Package | `pg-boss` |
| Version | `^12.8.0` (latest: 12.8.0, published 2026-01-30) |
| Purpose | Schedule timeout wakeups for paused conversations |
| Confidence | **HIGH** -- verified via npm, GitHub |
| License | MIT |
| Weekly downloads | ~215,000 |
| PostgreSQL | 13+ required |

### Why pg-boss for timeouts (but not for the core executor)

Timeouts are a pure delayed-job problem: "run this function at a specific future time." This is exactly what pg-boss's `startAfter` API does. The conversation executor should not poll the conversations table every minute checking for expired timeouts -- that's wasteful and adds latency.

```typescript
import PgBoss from 'pg-boss';

const boss = new PgBoss(databaseUrl);
await boss.start();

// When agent calls wait_for with timeout "72h":
await boss.send('conversation-timeout', {
  conversationId: 'conv_abc',
  waitType: 'approval',
  reason: 'Plan approval timed out',
}, {
  startAfter: 72 * 3600, // seconds
  singletonKey: `timeout-conv_abc`, // prevents duplicate timeouts
});

// Worker processes timeouts:
await boss.work('conversation-timeout', async (job) => {
  await executor.signal(job.data.conversationId, {
    type: 'wait_timeout',
    data: {
      originalWaitType: job.data.waitType,
      reason: job.data.reason,
    },
    source: 'internal:scheduler',
  });
});
```

### Key pg-boss features used

| Feature | How Used |
|---------|----------|
| `startAfter` | Schedule timeout at specific future time (seconds, ISO string, or Date) |
| `singletonKey` | Prevent duplicate timeouts per conversation (cancel old, create new on re-pause) |
| Dead letter queue | Capture failed timeout deliveries for debugging |
| Retry with backoff | Retry if signal delivery fails (e.g., database temporarily unavailable) |
| `deleteQueue` / job cancellation | Cancel pending timeout when conversation resumes before timeout fires |

### Integration with existing stack

pg-boss creates its own schema (`pgboss` by default, configurable). It manages its own connection pool internally but can be initialized with a connection string that points to the existing Aesir PostgreSQL instance. No separate database needed.

```typescript
// In the single service bootstrap:
const boss = new PgBoss({
  connectionString: config.database.url,
  schema: 'pgboss', // Separate schema, no conflicts with agents.*
});
await boss.start();
```

pg-boss handles its own migration on first `start()` call -- no manual migration needed. It also handles cleanup of completed jobs automatically.

### Alternatives considered and rejected

| Approach | Why Not |
|----------|---------|
| **pg_cron** | PostgreSQL extension -- requires `CREATE EXTENSION pg_cron` which needs superuser privileges and is not available on all managed Postgres instances. Also can only execute SQL, not Node.js functions. Would need a pg_cron job that inserts into a polling table, which the Node.js process then polls -- adding unnecessary indirection. |
| **Custom polling** | Polling the conversations table every minute for expired timeouts works but adds database load proportional to the number of paused conversations. pg-boss's `startAfter` is indexed and only checks jobs that are due -- O(ready jobs) not O(all paused conversations). |
| **node-cron / setTimeout** | In-memory only. Lost on process restart. setTimeout maxes out at ~24 days (2^31 ms). Not suitable for 72-hour or 7-day timeouts that must survive restarts. |
| **graphile-worker run_at** | Would work technically (graphile-worker supports `runAt` for future scheduling). But graphile-worker 0.16.6 was last published 2+ years ago, has 0.x versioning indicating unstable API, and has 3x fewer weekly downloads than pg-boss. pg-boss is the safer long-term bet. |

---

## 3. Event Log Implementation

### Recommendation: Custom append-only table with buffered writes

| Property | Value |
|----------|-------|
| Approach | Custom `agent_events` table, batch INSERT via Drizzle ORM |
| Buffer strategy | In-memory buffer, flush every 1 second OR every 50 events (whichever first) |
| Subscription | LISTEN/NOTIFY for reactive projections + in-process EventEmitter |
| Confidence | **HIGH** -- standard pattern, no library needed |

### Why no event sourcing library

TypeScript event sourcing libraries (e.g., `@eventstore/db-client`, `emmett`) are designed for multi-aggregate event stores with projections, snapshots, and read models. Aesir's event log is simpler:

- Single aggregate type (conversation)
- Append-only (no versioning conflicts)
- Two consumers (session projection + observability)
- No need for event replay/rebuilding (conversation history is the source of truth, not the event log)

The event log is fundamentally a logging table with structured data. Drizzle ORM + a ~200-line TypeScript wrapper handles this cleanly.

### Buffered write implementation

```typescript
class PostgresEventLog implements EventLog {
  private buffer: AgentEvent[] = [];
  private flushTimer: NodeJS.Timeout;

  append(event: AgentEvent): void {
    this.buffer.push(event);
    if (this.buffer.length >= 50) {
      void this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer.splice(0);
    await db.insert(agentEvents).values(batch);

    // Notify subscribers via LISTEN/NOTIFY
    for (const event of batch) {
      await db.execute(sql`NOTIFY agent_events, ${event.conversationId}`);
    }

    // In-process subscribers (session projection)
    for (const event of batch) {
      this.emitter.emit('event', event);
    }
  }
}
```

### LISTEN/NOTIFY for subscriptions

Used for the session projection to update `agent_sessions` reactively. The notification carries the conversation ID; the projection queries the event log for new events.

**Important limitation**: LISTEN/NOTIFY payloads are limited to ~8000 bytes. Do NOT put event data in the notification -- only the conversation ID. The subscriber queries the event log for full event data.

**Hybrid approach**: The session projection subscribes both via in-process EventEmitter (for events generated locally) and via LISTEN/NOTIFY (for events generated by other processes). The in-process path is the primary path; LISTEN/NOTIFY is for multi-process scenarios.

### Performance characteristics

| Metric | Expected Value | Notes |
|--------|---------------|-------|
| Event write throughput | ~10,000 events/sec (batched) | Well within Postgres batch INSERT capability |
| Event write latency (caller) | 0ms (fire-and-forget) | `append()` is void, returns immediately |
| Event write latency (persistence) | 1-50ms (batch flush) | 1s timer or 50-event threshold |
| LISTEN/NOTIFY latency | <5ms | Postgres built-in, very fast |
| Event query (by conversation) | <10ms | Indexed on `(conversation_id, sequence)` |
| Storage per event | ~200-500 bytes | JSONB payload + metadata columns |
| Storage for 100-event conversation | ~20-50 KB | Well under TOAST threshold for individual events |

### Event payload sizing

Individual events are small (tool name, parameters, result summary). The large tool outputs (file contents, search results) are in the conversation history, not duplicated in events. Events record WHAT happened (tool called, tool succeeded) with metadata, not the full tool input/output.

This keeps individual event rows well under the 2KB TOAST threshold, avoiding the performance cliff documented in PostgreSQL JSONB research.

---

## 4. Conversation History Persistence

### Recommendation: JSONB column on conversations table, full row replacement on write

| Property | Value |
|----------|-------|
| Storage | `messages JSONB NOT NULL DEFAULT '[]'` on `agents.conversations` |
| Write pattern | Full replacement (`UPDATE ... SET messages = $1`) on pause/complete |
| Read pattern | Full row load (`SELECT * FROM conversations WHERE id = $1`) |
| Confidence | **HIGH** -- standard pattern, TOAST is acceptable for write-rarely/read-fully |

### Row size analysis

A conversation with 100 tool calls includes:
- ~100 `tool_use` content blocks (tool name + input): ~200 bytes each = ~20KB
- ~100 `tool_result` content blocks (tool output): ~500 bytes to 5KB each
- ~50 assistant text blocks (reasoning): ~200 bytes each = ~10KB
- ~10 user messages: ~500 bytes each = ~5KB

**Estimated sizes:**

| Conversation Type | Tool Calls | Estimated JSONB Size | TOAST? |
|-------------------|-----------|---------------------|--------|
| Product agent (simple) | 5-10 | 10-30 KB | Yes, but read-only so acceptable |
| Product agent (complex) | 20-30 | 50-100 KB | Yes |
| Dev agent (research+plan) | 30-50 | 100-300 KB | Yes |
| Dev agent (full lifecycle) | 80-100 | 200 KB - 2 MB | Yes |
| Dev agent (with large files) | 100+ | 1-5 MB | Yes, approaching upper comfort zone |

**After history compaction (Phase 1 tool output pruning):**

| Conversation Type | Before Compaction | After Compaction |
|-------------------|------------------|-----------------|
| Product agent | 10-100 KB | 5-30 KB |
| Dev agent (research+plan) | 100-300 KB | 30-80 KB |
| Dev agent (full lifecycle) | 200 KB - 2 MB | 50-200 KB |

### Why single JSONB column is acceptable

1. **Write frequency is LOW**: Conversations are written on pause (hours between writes) and complete (once). Not on every tool call. This avoids the TOAST write amplification problem.

2. **Reads are full-row**: When resuming a conversation, the executor loads the entire messages array to pass to `runAgentLoop()`. No partial JSONB queries, no path-based access. TOAST decompression happens once per load.

3. **No indexing on messages**: We never query "find conversations where tool X was called." The event log handles that. Messages are an opaque blob from PostgreSQL's perspective.

4. **History compaction keeps sizes manageable**: Phase 1 pruning (tool output truncation) reduces conversation sizes by 60-80%. A 2MB pre-compaction conversation becomes ~400KB after pruning.

5. **Anthropic API limit is 16MB**: The API itself caps total text bytes at 16MB. Conversations that approach this are already too large for the LLM and will trigger compaction. PostgreSQL can store up to 255MB in JSONB.

### Alternative considered: normalized messages table

Storing each message as a separate row (`conversation_id`, `sequence`, `role`, `content JSONB`) would avoid TOAST entirely for most messages. However:

- **Reconstruction cost**: Loading 100+ rows and assembling them into an ordered array adds query complexity and latency.
- **Atomic writes**: Updating conversation history on pause requires inserting/updating multiple rows atomically (transaction), vs. a single UPDATE.
- **Compaction complexity**: Pruning old tool outputs requires updating individual rows, not replacing the whole array.
- **No real benefit**: The write-rarely/read-fully pattern makes TOAST acceptable. The overhead of TOAST decompression on a 500KB blob is ~1-5ms -- negligible compared to the LLM API call that follows.

**Verdict**: Single JSONB column is the pragmatic choice. If conversations grow beyond 5MB regularly (unlikely with compaction), revisit this decision.

### LZ4 compression recommendation

PostgreSQL 14+ supports LZ4 TOAST compression, which is faster than the default pglz:

```sql
ALTER TABLE agents.conversations
  ALTER COLUMN messages SET COMPRESSION lz4;
```

This reduces TOAST decompression time for large conversations. Since Aesir already uses PostgreSQL 15 (per docker-compose.yml: `postgres:15-alpine`), LZ4 is available.

---

## 5. Concurrency Control

### Recommendation: SELECT FOR UPDATE SKIP LOCKED for conversation processing, advisory locks NOT needed

| Property | Value |
|----------|-------|
| Primary mechanism | `SELECT FOR UPDATE SKIP LOCKED` on conversations table |
| Heartbeat | `UPDATE updated_at` every 60 seconds during agent loop |
| Stale detection | Conversations with `status = 'running'` and `updated_at > 5 minutes ago` |
| Confidence | **HIGH** -- standard PostgreSQL pattern |

### Why SKIP LOCKED, not advisory locks

| Criterion | `SELECT FOR UPDATE SKIP LOCKED` | Advisory Locks |
|-----------|-------------------------------|----------------|
| Tied to row? | Yes -- locks the conversation row | No -- arbitrary integer key |
| Automatic release | Transaction end | Session end (or explicit unlock) |
| Risk of leak | Low -- transaction scope | Higher -- session scope can outlive intent |
| Queue pattern | Native support | Must implement manually |
| Visibility | `pg_locks` shows row locks | `pg_locks` shows advisory locks |
| Use in Aesir | Worker dequeues conversation, locks row, processes, commits | Would need `pg_advisory_xact_lock(hash(conv_id))` -- same effect, more ceremony |

Advisory locks would work but add unnecessary complexity:
- Must hash conversation IDs to integers (advisory locks use bigint keys)
- Must choose between session-level (risk of leak if connection pooling) and transaction-level (same as FOR UPDATE)
- No benefit over row-level locking for this use case

### Dual-phase locking pattern

The conversation processing uses two phases:

**Phase 1: Dequeue (short transaction)**
```sql
BEGIN;
SELECT id, messages, agent_definition_id, ...
  FROM agents.conversations
  WHERE status = 'queued'
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

UPDATE agents.conversations
  SET status = 'running', updated_at = NOW()
  WHERE id = $1;
COMMIT;
-- Lock released here
```

**Phase 2: Process (no transaction held)**
The agent loop runs for minutes. No database transaction is held open during this time. The `status = 'running'` flag IS the lock -- other workers won't dequeue it because it's not `queued`.

Heartbeat updates (`UPDATE updated_at WHERE id = $1 AND status = 'running'`) are individual short transactions, not part of a long-held lock.

**Phase 3: Complete (short transaction)**
```sql
BEGIN;
UPDATE agents.conversations
  SET status = 'paused',  -- or 'completed' / 'failed'
      messages = $2,
      pending_wait = $3,
      updated_at = NOW()
  WHERE id = $1 AND status = 'running';
COMMIT;
```

### Signal delivery concurrency

When a signal arrives for a conversation that is currently `running`:

```sql
-- Atomic append to queued_signals (no lock needed -- single UPDATE)
UPDATE agents.conversations
  SET queued_signals = queued_signals || $2::jsonb,
      updated_at = NOW()
  WHERE id = $1;
```

This uses PostgreSQL's JSONB concatenation operator (`||`), which is atomic. No explicit lock needed -- the UPDATE itself acquires a row-level lock for the duration of the statement.

When a signal arrives for a `paused` conversation with matching wait type:

```sql
BEGIN;
SELECT * FROM agents.conversations
  WHERE id = $1 AND status = 'paused'
  FOR UPDATE;  -- Not SKIP LOCKED -- we want THIS specific conversation

UPDATE agents.conversations
  SET status = 'queued',  -- Ready for worker to pick up
      updated_at = NOW()
  WHERE id = $1;
COMMIT;

-- Notify worker
NOTIFY conversation_ready;
```

---

## 6. Temporal Dependency Removal

### What gets removed

#### npm packages

| Package | Current Location | Impact |
|---------|-----------------|--------|
| `@temporalio/client` | `@aesir/agents`, `@aesir/platform` | Temporal client for starting/signaling workflows |
| `@temporalio/worker` | `@aesir/agents`, `@aesir/platform` | Temporal worker runtime (includes native bridge binary ~50MB) |
| `@temporalio/workflow` | `@aesir/agents`, `@aesir/platform` | Temporal workflow definitions (determinism constraints) |
| `@temporalio/activity` | `@aesir/agents` | Temporal activity context (heartbeat, info) |

**Installation impact**: The `@temporalio/worker` package includes a native Rust binary (`@temporalio/core-bridge`) that is ~50MB and requires platform-specific builds. Removing it significantly reduces `node_modules` size and eliminates platform-specific build issues.

#### Source files affected

**Files importing from `@temporalio/*` (26 files total):**

In `@aesir/agents` (active code, must be replaced/deleted):
- `src/shared/temporal/` -- entire directory (workflows, activities, signals, types)
- `src/router/types.ts` -- `Client` type from `@temporalio/client`
- `src/router/main.ts` -- `Client, Connection` from `@temporalio/client`
- `src/router/tools/start-workflow.ts` -- `WorkflowExecutionAlreadyStartedError`
- `src/dev-agent/main.ts` -- `Client, Connection` from `@temporalio/client`
- `src/dev-agent/worker.ts` -- Worker, NativeConnection from `@temporalio/worker`
- `src/dev-agent/api/events.ts` -- `Client` type
- `src/dev-agent/api/routes.ts` -- `Client` type
- `src/dev-agent/api/signal-handler.ts` -- `Client` type
- `src/dev-agent/integration.test.ts` -- `Client` type
- `src/product-agent/main.ts` -- `Client, Connection` from `@temporalio/client`
- `src/product-agent/worker.ts` -- Worker, NativeConnection from `@temporalio/worker`
- `src/product-agent/api/events.ts` -- `Client` type

In `@aesir/platform` (shared infrastructure):
- `src/temporal/worker.ts` -- `NativeConnection, Runtime, Worker`
- `src/temporal/client.ts` -- `Client, Connection, WorkflowHandle`
- `src/temporal/signals.ts` -- `wf` from `@temporalio/workflow`
- `src/temporal/workflows/approval-workflow.ts` -- `wf`, `proxyActivities`

In `.planning/` (documentation only, not runtime):
- 8 files in planning docs reference Temporal -- these need doc updates, not code changes

#### Docker Compose changes

Services to remove from `docker-compose.yml`:

| Service | Image | Purpose | Impact |
|---------|-------|---------|--------|
| `temporal` | `temporalio/auto-setup:1.24.2` | Temporal server + schema auto-setup | Frees port 7233, removes PostgreSQL schema |
| `temporal-ui` | `temporalio/ui:2.26.2` | Temporal Web UI | Frees port 8080 |
| `dev-agent-worker` | Custom (Dockerfile) | Temporal worker for dev-agent | Merged into single service |

Services to modify:

| Service | Change |
|---------|--------|
| `dev-agent` | Remove `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE` env vars. Change command. Remove dependency on `temporal`. |
| `product-agent` | **Delete entirely** -- merged into single agent service |
| `router` | Remove `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE` env vars. Merge into single agent service. |
| `nginx` | Update routing -- fewer upstream services |

Services to add:

| Service | Purpose |
|---------|---------|
| `agent-service` | Single service replacing dev-agent + product-agent + router + dev-agent-worker |

**Net Docker change**: Remove 3 services (temporal, temporal-ui, dev-agent-worker), delete 2 services (product-agent, router), modify 1 (dev-agent -> agent-service). From 10 services to 6 services.

#### Volume changes

The `temporal-postgresql` volume stores Temporal's internal schema and workflow history. This can be removed. The Aesir PostgreSQL database (`temporal` user/db) is shared with Temporal -- after removing Temporal, consider renaming the database to `aesir` in a future cleanup, though this is cosmetic.

#### PostgreSQL schema impact

Temporal's `auto-setup` creates several schemas in the shared PostgreSQL database:
- `temporal` schema (workflow execution history, tasks, visibility)
- `temporal_visibility` schema (search attributes)

These schemas will no longer be used and can be dropped. The `agents.*` schema gets new tables (`agent_events`, `agent_sessions`, updated `conversations`) and drops old tables (`tasks`, `context_snapshots`, `execution_traces`).

### What does NOT break

| Component | Why Safe |
|-----------|---------|
| MCP layer | Zero Temporal dependency. Pure HTTP. |
| Integration packages | Zero Temporal dependency. Independent services. |
| Agent loop (`runAgentLoop`) | Zero Temporal dependency. Pure Anthropic SDK. |
| Tool definitions | Zero Temporal dependency. Pure functions. |
| Platform (db, logging, config, sandbox) | Temporal code is in its own `temporal/` subdirectory. Other platform code is unaffected. |
| Drizzle ORM migrations | Independent of Temporal. |
| Docker networking | Temporal used its own port (7233). Removing it doesn't affect service-to-service networking. |

### Migration risk: Running workflows during cutover

Current Temporal workflows (orchestrator + product-agent) are long-running (can be paused for days waiting for approval). The migration plan must account for:

1. **Drain existing workflows**: Stop accepting new events that would start Temporal workflows. Let running workflows complete naturally or force-terminate them.
2. **No mixed-mode**: Do NOT run old Temporal workflows and new ConversationExecutor simultaneously. The signal routing (webhook -> which system?) would be ambiguous.
3. **Acceptable data loss**: In-flight workflows at cutover time will be lost. This is acceptable because: (a) workflows are retryable (just re-trigger from Linear/Slack), (b) the number of in-flight workflows at any time is typically 0-3.

---

## Recommended Stack Summary

### New Dependencies

| Package | Version | Purpose | Confidence |
|---------|---------|---------|------------|
| `pg-boss` | `^12.8.0` | Timeout scheduling for paused conversations | HIGH |

### Removed Dependencies

| Package | Current Version | Package(s) |
|---------|----------------|------------|
| `@temporalio/client` | ^1.14.1 | `@aesir/agents`, `@aesir/platform` |
| `@temporalio/worker` | ^1.14.1 | `@aesir/agents`, `@aesir/platform` |
| `@temporalio/workflow` | ^1.14.1 | `@aesir/agents`, `@aesir/platform` |
| `@temporalio/activity` | ^1.14.1 | `@aesir/agents` |

### Unchanged Dependencies (used by new code)

| Package | Version | Used For |
|---------|---------|----------|
| `drizzle-orm` | ^0.45.1 | Schema definition for new tables, queries |
| `postgres` | ^3.4.7 | PostgreSQL client (LISTEN/NOTIFY, raw queries) |
| `pg` | ^8.17.2 | PostgreSQL client (pg-boss uses this internally) |
| `zod` | 3.25.67 | Schema validation for AgentDefinition, events |
| `@anthropic-ai/sdk` | ^0.72.0 | Agent loop (unchanged) |
| `express` | ^4.21.0 | HTTP server for single agent service |
| `nanoid` | ^5.1.6 | ID generation for events, conversations |
| `pino` (via @aesir/platform) | N/A | Logging |

### Installation

```bash
# Add new dependency
pnpm --filter @aesir/agents add pg-boss@^12.8.0

# Remove Temporal from agents
pnpm --filter @aesir/agents remove @temporalio/client @temporalio/worker @temporalio/workflow @temporalio/activity

# Remove Temporal from platform
pnpm --filter @aesir/platform remove @temporalio/client @temporalio/worker @temporalio/workflow
```

---

## Decision Matrix

| Concern | Recommendation | Alternatives Rejected | Rationale |
|---------|---------------|----------------------|-----------|
| Conversation execution | Custom SKIP LOCKED | pg-boss, graphile-worker, BullMQ | Conversation semantics don't map to generic job queues |
| Timeout scheduling | pg-boss `startAfter` | pg_cron, node-cron, custom polling | Pure delayed-job problem; pg-boss solves it with zero infrastructure |
| Event log writes | Custom batch INSERT | PGMQ, Kafka, event sourcing libs | Simple append-only table; no library needed |
| Event subscriptions | LISTEN/NOTIFY + polling | PGMQ, Redis pub/sub | Hybrid approach: instant notification + reliable fallback |
| Conversation storage | JSONB column | Normalized messages table | Write-rarely/read-fully pattern makes TOAST acceptable |
| Concurrency control | SELECT FOR UPDATE SKIP LOCKED | Advisory locks, application-level locks | Row-level locking is the natural fit for conversation processing |
| Stale job recovery | Heartbeat + polling | External health checker | Simple, self-contained, no additional infrastructure |

---

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| JSONB conversation exceeds 5MB | LOW | History compaction triggers at 80K tokens (~320KB). Conversations should rarely exceed 1MB after compaction. |
| pg-boss schema conflicts with agents schema | LOW | pg-boss uses its own schema (`pgboss`). No namespace collision. |
| LISTEN/NOTIFY message loss | LOW | Polling fallback every 5 seconds. Messages only contain conversation IDs, not data. |
| Custom executor has bugs Temporal wouldn't | MEDIUM | The executor is much simpler than Temporal (no replay, no versioning, no determinism constraints). Integration tests cover start/pause/signal/resume/timeout/cancel lifecycle. |
| pg-boss version instability | LOW | pg-boss is at v12.8.0 (mature), MIT licensed, 215K weekly downloads. Actively maintained. |
| Long-running transactions during agent loop | LOW | Agent loop runs OUTSIDE any transaction. Only short transactions for dequeue/status-update/complete. Heartbeat updates are individual statements. |

---

## Sources

### Postgres Job Queues
- [Graphile Worker GitHub](https://github.com/graphile/worker) -- MIT, 0.16.6, ~87K weekly downloads
- [pg-boss GitHub](https://github.com/timgit/pg-boss) -- MIT, 12.8.0, ~215K weekly downloads
- [The Unreasonable Effectiveness of SKIP LOCKED](https://www.inferable.ai/blog/posts/postgres-skip-locked) -- Pattern documentation
- [Using FOR UPDATE SKIP LOCKED for Queue-Based Workflows](https://www.netdata.cloud/academy/update-skip-locked/) -- Crash safety and batch processing

### LISTEN/NOTIFY
- [Scaling Postgres LISTEN/NOTIFY](https://pgdog.dev/blog/scaling-postgres-listen-notify) -- Limitations and scaling
- [PostgreSQL LISTEN/NOTIFY for Instant Updates](https://medium.com/@nevilpatel05317/day-4-forget-polling-using-postgresql-listen-notify-for-instant-updates-991d96da72bc)
- [Cybertec: LISTEN/NOTIFY](https://www.cybertec-postgresql.com/en/listen-notify-automatic-client-notification-in-postgresql/) -- Ephemeral nature documented

### JSONB Performance
- [5mins of Postgres: JSONB TOAST Performance Cliffs](https://pganalyze.com/blog/5mins-postgres-jsonb-toast) -- 2KB threshold documentation
- [When To Avoid JSONB](https://www.heap.io/blog/when-to-avoid-jsonb-in-a-postgresql-schema) -- Storage overhead analysis
- [Postgres Large JSON Value Query Performance](https://www.evanjones.ca/postgres-large-json-performance.html) -- 2-10x slowdown benchmarks

### Event Sourcing
- [Event Storage in Postgres](https://dev.to/kspeakman/event-storage-in-postgres-4dk2) -- Append-only table patterns
- [Aggregateless Event Store with TypeScript and PostgreSQL](https://ricofritzsche.me/how-i-built-an-aggregateless-event-store-with-typescript-and-postgresql/) -- TypeScript implementation

### Concurrency Control
- [PostgreSQL Advisory Locks](https://www.kostolansky.sk/posts/postgresql-advisory-locks/) -- When to use advisory locks
- [Distributed Locking with Postgres Advisory Locks](https://rclayton.silvrback.com/distributed-locking-with-postgres-advisory-locks) -- Comparison with row locks
- [PostgreSQL Explicit Locking Documentation](https://www.postgresql.org/docs/current/explicit-locking.html) -- Official reference

### Timeout Scheduling
- [pg_cron GitHub](https://github.com/citusdata/pg_cron) -- Requires extension, SQL-only execution
- [pg-boss Deep Dive](https://logsnag.com/blog/deep-dive-into-background-jobs-with-pg-boss-and-typescript) -- startAfter API
- [pg-boss npm](https://www.npmjs.com/package/pg-boss) -- v12.8.0, latest release

### PGMQ
- [PGMQ GitHub](https://github.com/pgmq/pgmq) -- v1.9.0, requires extension
- [pgmq-ts](https://github.com/baz-scm/pgmq-ts) -- TypeScript client, nascent

### Temporal
- [Temporal TypeScript SDK GitHub](https://github.com/temporalio/sdk-typescript) -- Package structure, migration notes
- [Temporal TypeScript Troubleshooting](https://legacy-documentation-sdks.temporal.io/typescript/troubleshooting) -- Native bridge issues
