# Phase 41: Timeout Scheduling - Research

**Researched:** 2026-02-02
**Domain:** Delayed signal delivery via pg-boss for conversation timeout enforcement
**Confidence:** HIGH

## Summary

Phase 41 integrates pg-boss as the timeout scheduling mechanism for paused conversations. When an agent calls `wait_for` with a timeout (e.g., `"72h"`), the executor currently stores that timeout in `pending_wait.timeout` on the conversation row but does nothing with it. Phase 41 makes it work: after a conversation enters "waiting" status, a delayed pg-boss job is scheduled that fires after the timeout duration, delivering a `wait_timeout` signal through the same `executor.signal()` pathway used by external events (Slack, GitHub, Linear webhooks).

pg-boss v12.8.0 (current) is PostgreSQL-native, uses SKIP LOCKED internally (same pattern as our executor), and supports delayed jobs via the `startAfter` option and cancellation via `cancel(id)`. It can share the existing PostgreSQL connection pool through a simple `IDatabase` adapter (single `executeSql` method), avoiding a second connection pool. It manages its own schema (configurable, default `pgboss`) with auto-migration.

The integration is narrow and well-scoped: a `TimeoutScheduler` service that wraps pg-boss with three methods -- `schedule(conversationId, timeout)`, `cancel(conversationId)`, and `close()`. The worker loop calls `schedule()` when a conversation pauses with a timeout, and the pg-boss handler calls `executor.signal()` when the job fires. Cancellation happens when a signal arrives that resumes a conversation before the timeout.

**Primary recommendation:** Add pg-boss as a dependency, create a thin `TimeoutScheduler` wrapper, wire it into the worker loop's wait_for pause path and the executor's signal resume path. Use the existing `pg` Pool to create an `IDatabase` adapter for pg-boss. Store the pg-boss job ID on the conversation's `pending_wait` object for cancellation lookup.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| pg-boss | ^12.8.0 | Delayed job scheduling (timeout delivery) | Decision from STATE.md; PostgreSQL-native, shares existing DB, SKIP LOCKED internally |
| pg | existing (^8.17.2) | PostgreSQL connection pool (shared with pg-boss) | Already in project, pg-boss adapter wraps Pool.query |
| drizzle-orm | existing (^0.45.1) | All conversation table operations | Already used by executor, unchanged |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| zod | existing | Timeout duration string validation/parsing | Validating "72h", "7d" format |
| nanoid | existing | Job correlation IDs | If needed for dedup keys |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| pg-boss | setTimeout/setInterval in-process | Doesn't survive restarts -- timeout lost on crash |
| pg-boss | pg_cron extension | Requires PostgreSQL extension install, less granular control, no per-conversation scheduling |
| pg-boss | Custom delayed table + polling | Reinventing exactly what pg-boss does, more code to maintain |
| pg-boss | Temporal timer | Entire Temporal dependency just for timeouts -- massive overkill |

**Installation:**
```bash
pnpm --filter @aesir/agents add pg-boss
```

## Architecture Patterns

### Recommended File Structure
```
packages/agents/src/framework/
  timeout-scheduler.ts           # TimeoutScheduler factory + IDatabase adapter
  timeout-scheduler.test.ts      # Unit tests with mocked pg-boss
```

### Pattern 1: TimeoutScheduler Service
**What:** A thin wrapper around pg-boss that exposes schedule/cancel/close for conversation timeouts.
**When to use:** Whenever the executor pauses a conversation with a timeout, and when a signal resumes a conversation that has a pending timeout.
**Example:**
```typescript
// Source: pg-boss API + project factory pattern

import PgBoss from "pg-boss";
import type { Pool } from "pg";
import type { PinoLogger } from "@aesir/platform";
import type { ConversationExecutor, Signal } from "./types.js";

const TIMEOUT_QUEUE = "conversation-timeout";

interface TimeoutSchedulerOptions {
  pool: Pool;  // Existing pg connection pool
  logger: PinoLogger;
  schema?: string;  // pg-boss schema name (default: "pgboss")
}

interface TimeoutScheduler {
  /**
   * Initialize pg-boss (runs migrations, starts worker).
   * Must be called before schedule/cancel.
   */
  start(executor: ConversationExecutor): Promise<void>;

  /**
   * Schedule a timeout signal for a conversation.
   * Returns the pg-boss job ID for later cancellation.
   */
  schedule(conversationId: string, timeoutDuration: string, waitType: string): Promise<string>;

  /**
   * Cancel a pending timeout for a conversation.
   * No-op if the timeout already fired or was already cancelled.
   */
  cancel(jobId: string): Promise<void>;

  /**
   * Graceful shutdown: stop pg-boss.
   */
  close(): Promise<void>;
}
```

### Pattern 2: IDatabase Adapter for Connection Sharing
**What:** A minimal adapter that wraps the existing `pg.Pool` to satisfy pg-boss's `IDatabase` interface, avoiding a second connection pool.
**When to use:** When creating the pg-boss instance.
**Example:**
```typescript
// Source: pg-boss IDatabase interface requirement

import type { Pool } from "pg";

/**
 * Adapt pg.Pool to pg-boss's IDatabase interface.
 * pg-boss only needs executeSql(text, values) => { rows }.
 */
function createPgBossAdapter(pool: Pool) {
  return {
    async executeSql(text: string, values?: unknown[]) {
      const result = await pool.query(text, values);
      return { rows: result.rows, rowCount: result.rowCount ?? 0 };
    },
  };
}
```

### Pattern 3: Timeout Duration Parsing
**What:** Parse the agent's timeout string (e.g., "72h", "7d") into a delay value that pg-boss understands.
**When to use:** When scheduling a timeout job.
**Example:**
```typescript
// Source: wait_for tool timeout format spec (Appendix B.1)

/**
 * Parse a timeout duration string into milliseconds.
 * Supported formats: "<number>h" (hours), "<number>d" (days).
 */
function parseTimeoutDuration(duration: string): number {
  const match = duration.match(/^(\d+)(h|d)$/);
  if (!match || !match[1] || !match[2]) {
    throw new Error(`Invalid timeout duration: "${duration}". Expected format: <number>h or <number>d`);
  }
  const value = parseInt(match[1], 10);
  const unit = match[2];
  if (unit === "h") return value * 60 * 60 * 1000;
  if (unit === "d") return value * 24 * 60 * 60 * 1000;
  throw new Error(`Unknown unit: ${unit}`);
}

// Usage with pg-boss: convert to startAfter Date
function computeStartAfter(duration: string): Date {
  const ms = parseTimeoutDuration(duration);
  return new Date(Date.now() + ms);
}
```

### Pattern 4: Timeout Signal Delivery via executor.signal()
**What:** When a pg-boss timeout job fires, deliver a `wait_timeout` signal through the standard signal pathway. The agent sees it as a normal signal and decides what to do (escalate, retry, complete).
**When to use:** In the pg-boss worker handler.
**Example:**
```typescript
// Source: v2.3 spec Appendix B.1 -- "On timeout" behavior

// Register pg-boss worker that delivers timeout signals
await boss.work<TimeoutJobData>(TIMEOUT_QUEUE, async ([job]) => {
  const { conversationId, waitType, reason } = job.data;

  const signal: Signal = {
    type: "wait_timeout",
    data: {
      originalWaitType: waitType,
      reason,
    },
    message: `Wait timeout: you have been paused waiting for '${waitType}'. No signal was received. Decide whether to escalate, retry, or complete.`,
    source: "internal:scheduler",
    deduplicationId: `timeout-${conversationId}-${job.id}`,
  };

  const result = await executor.signal(conversationId, signal);
  logger.info({ conversationId, action: result.action }, "Timeout signal delivered");
});
```

### Pattern 5: Job ID Storage for Cancellation
**What:** Store the pg-boss job ID in the conversation's `pending_wait` JSONB so it can be cancelled when a real signal arrives before the timeout fires.
**When to use:** After scheduling a timeout, and when signal() resumes a waiting conversation.
**Example:**
```typescript
// After scheduling timeout, update pending_wait with job ID
const jobId = await timeoutScheduler.schedule(conv.id, waitForState.timeout, waitForState.waitType);

// pending_wait structure with timeout job ID:
// {
//   type: "approval",
//   reason: "Waiting for human approval",
//   timeout: "72h",
//   metadata: { ... },
//   timeoutJobId: "pgboss-job-uuid"  // <-- NEW field
// }

// In executor.signal() when resuming a waiting conversation:
const pendingWait = row.pending_wait as Record<string, unknown> | null;
if (pendingWait?.timeoutJobId) {
  await timeoutScheduler.cancel(pendingWait.timeoutJobId as string);
}
```

### Anti-Patterns to Avoid
- **Running pg-boss in a separate process:** pg-boss should run in the same process as the agent service. It is lightweight and shares the same DB connection pool.
- **Using pg-boss for conversation execution:** pg-boss is ONLY for timeout scheduling. The executor uses SKIP LOCKED directly for conversation claiming (per STATE.md decision).
- **Cancelling by queue name instead of job ID:** Always cancel by specific job ID. Queue-level operations could affect other pending timeouts.
- **Using pg-boss cron scheduling:** Timeouts are one-shot delayed jobs, not recurring. Use `send()` with `startAfter`, not `schedule()`.
- **Creating a second database connection pool:** Use the `db` adapter to share the existing `pg.Pool`.
- **Storing timeout state outside the conversation:** The `pending_wait` JSONB column already holds timeout config. Just add `timeoutJobId` to it.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Delayed job execution | setTimeout or polling table | pg-boss `send()` with `startAfter` | Survives process restarts, PostgreSQL-backed durability |
| Job cancellation | DELETE from custom table | pg-boss `cancel(id)` | Handles race conditions (job in-flight during cancel) |
| Job deduplication | Custom dedup logic | pg-boss `singletonKey` + executor's existing signal dedup | Two layers: pg-boss prevents duplicate jobs, executor prevents duplicate signal delivery |
| Schema migrations | Manual SQL | pg-boss `migrate: true` option | Auto-creates and migrates its schema on `start()` |
| Connection pooling | Second Pool instance | `IDatabase` adapter wrapping existing Pool | One pool, less resource waste, simpler lifecycle |

**Key insight:** Phase 41 is an integration task, not a "build delayed execution" task. pg-boss provides the delayed job primitive. The executor provides the signal delivery pathway. Phase 41 wires them together.

## Common Pitfalls

### Pitfall 1: Timeout Fires After Conversation Already Resumed
**What goes wrong:** A real signal resumes the conversation, but the timeout job fires later anyway, delivering a stale `wait_timeout` signal to a running or completed conversation.
**Why it happens:** The timeout was not cancelled when the conversation resumed.
**How to avoid:** In `executor.signal()`, when a waiting conversation is resumed, cancel the pending timeout job BEFORE changing status. Store the pg-boss job ID in `pending_wait.timeoutJobId` so we know what to cancel.
**Warning signs:** `wait_timeout` signals arriving for conversations with status `completed` or `running`.

### Pitfall 2: Timeout Cancellation Race Condition
**What goes wrong:** The timeout job fires at the exact moment `cancel()` is called. Both the timeout handler and the resume code try to signal the conversation.
**Why it happens:** pg-boss `cancel()` only works for jobs in `created` state, not `active` state.
**How to avoid:** The executor's `signal()` method already handles this -- it's idempotent and checks conversation status. If the conversation was already resumed before the timeout handler runs, `signal()` returns `rejected` (terminal status) or `queued` (if running). The timeout handler should check the result and log appropriately rather than error.
**Warning signs:** Errors in timeout handler logs when `executor.signal()` returns `rejected`.

### Pitfall 3: pg-boss Schema Conflict with Agents Schema
**What goes wrong:** pg-boss creates its tables in the wrong schema, colliding with the `agents` schema or the default `public` schema.
**Why it happens:** pg-boss defaults to creating tables in the `pgboss` schema. If not configured, or if configured to use the same schema as agents, tables could conflict.
**How to avoid:** Explicitly set `schema: "pgboss"` in pg-boss constructor options. This is the default, but being explicit prevents accidental changes.
**Warning signs:** Unexpected tables in the `agents` schema, or permission errors if pg-boss tries to create tables where it shouldn't.

### Pitfall 4: pg-boss Start Before Database Pool Ready
**What goes wrong:** `boss.start()` fails because the database pool isn't connected yet.
**Why it happens:** pg-boss runs migrations and schema setup in `start()`. If the pool is not ready, these fail.
**How to avoid:** Ensure the database pool is connected and ready before calling `boss.start()`. In the single service bootstrap, start pg-boss after the database connection is verified.
**Warning signs:** "connection refused" or "timeout" errors from pg-boss during startup.

### Pitfall 5: Missing Timeout Cancellation on Conversation Cancel
**What goes wrong:** A conversation is cancelled via `executor.cancel()`, but the pending timeout job is not cancelled. It fires later and tries to deliver a signal to a cancelled conversation.
**How to avoid:** The `executor.cancel()` method must also cancel any pending timeout job. Check `pending_wait.timeoutJobId` and call `timeoutScheduler.cancel()`.
**Warning signs:** `wait_timeout` signals appearing in logs for cancelled conversations.

### Pitfall 6: pg-boss Supervisor Overhead
**What goes wrong:** pg-boss's built-in supervisor (maintenance, monitoring, archive) adds unnecessary overhead for our simple use case.
**Why it happens:** pg-boss is designed as a full-featured job queue system. We only use delayed one-shot jobs.
**How to avoid:** Keep `supervise: true` (default) but tune intervals if needed. The supervisor handles archiving completed/cancelled jobs, which is useful. The overhead is minimal (periodic SQL queries) and the value (automatic cleanup) is real.
**Warning signs:** None expected -- this is an awareness item, not a likely failure.

## Code Examples

Verified patterns from official sources and existing codebase:

### Complete TimeoutScheduler Factory
```typescript
// Source: pg-boss API + project factory pattern + v2.3 spec

import PgBoss from "pg-boss";
import type { Pool } from "pg";
import type { PinoLogger } from "@aesir/platform";
import type { ConversationExecutor, Signal } from "./types.js";

const TIMEOUT_QUEUE = "conversation-timeout";

interface TimeoutJobData {
  conversationId: string;
  waitType: string;
  reason: string;
}

export interface TimeoutScheduler {
  start(executor: ConversationExecutor): Promise<void>;
  schedule(conversationId: string, timeoutDuration: string, waitType: string, reason: string): Promise<string>;
  cancel(jobId: string): Promise<void>;
  close(): Promise<void>;
}

export interface TimeoutSchedulerOptions {
  pool: Pool;
  logger: PinoLogger;
  schema?: string;
}

export function createTimeoutScheduler(options: TimeoutSchedulerOptions): TimeoutScheduler {
  const { pool, logger: parentLogger, schema = "pgboss" } = options;
  const logger = parentLogger.child({ component: "timeout-scheduler" });

  // Create IDatabase adapter for pg-boss
  const dbAdapter = {
    async executeSql(text: string, values?: unknown[]) {
      const result = await pool.query(text, values);
      return { rows: result.rows, rowCount: result.rowCount ?? 0 };
    },
  };

  const boss = new PgBoss({
    db: dbAdapter,
    schema,
    // Scheduling features not needed (we use send() with startAfter, not cron)
    schedule: false,
    // Migration handled automatically on start()
    migrate: true,
  });

  return {
    async start(executor: ConversationExecutor): Promise<void> {
      await boss.start();

      // Register timeout handler
      await boss.work<TimeoutJobData>(TIMEOUT_QUEUE, async ([job]) => {
        const { conversationId, waitType, reason } = job.data;

        const signal: Signal = {
          type: "wait_timeout",
          data: { originalWaitType: waitType, reason },
          message: `Wait timeout: you have been paused waiting for '${waitType}'. No signal was received. Decide whether to escalate, retry, or complete.`,
          source: "internal:scheduler",
          deduplicationId: `timeout-${conversationId}-${job.id}`,
        };

        const result = await executor.signal(conversationId, signal);

        if (result.action === "rejected") {
          logger.info(
            { conversationId, jobId: job.id },
            "Timeout signal rejected (conversation no longer waiting)",
          );
        } else {
          logger.info(
            { conversationId, action: result.action, jobId: job.id },
            "Timeout signal delivered",
          );
        }
      });

      logger.info("Timeout scheduler started");
    },

    async schedule(
      conversationId: string,
      timeoutDuration: string,
      waitType: string,
      reason: string,
    ): Promise<string> {
      const startAfter = computeStartAfter(timeoutDuration);

      const jobId = await boss.send(TIMEOUT_QUEUE, {
        conversationId,
        waitType,
        reason,
      }, {
        startAfter,
        singletonKey: conversationId,  // Prevents duplicate timeout jobs per conversation
      });

      if (!jobId) {
        throw new Error(`Failed to schedule timeout for conversation ${conversationId}`);
      }

      logger.info(
        { conversationId, timeoutDuration, jobId, startAfter: startAfter.toISOString() },
        "Timeout scheduled",
      );

      return jobId;
    },

    async cancel(jobId: string): Promise<void> {
      try {
        await boss.cancel(TIMEOUT_QUEUE, jobId);
        logger.info({ jobId }, "Timeout cancelled");
      } catch (error) {
        // Job may have already fired, been cancelled, or expired -- that's OK
        logger.debug({ jobId, err: error }, "Timeout cancel failed (may have already fired)");
      }
    },

    async close(): Promise<void> {
      await boss.stop();
      logger.info("Timeout scheduler stopped");
    },
  };
}

function computeStartAfter(duration: string): Date {
  const match = duration.match(/^(\d+)(h|d)$/);
  if (!match || !match[1] || !match[2]) {
    throw new Error(`Invalid timeout format: "${duration}". Expected <number>h or <number>d`);
  }
  const value = parseInt(match[1], 10);
  const unit = match[2];

  const ms = unit === "d"
    ? value * 24 * 60 * 60 * 1000
    : value * 60 * 60 * 1000;

  return new Date(Date.now() + ms);
}
```

### Worker Loop Integration Points
```typescript
// Source: existing worker-loop.ts -- modifications needed

// In executeConversation(), after the waitForState.triggered block:
if (waitForState.triggered) {
  // ... existing code to set status "waiting" and persist pending_wait ...

  // NEW: Schedule timeout if specified
  let timeoutJobId: string | undefined;
  if (waitForState.timeout) {
    timeoutJobId = await timeoutScheduler.schedule(
      conv.id,
      waitForState.timeout,
      waitForState.waitType ?? "unknown",
      waitForState.reason ?? "Agent paused",
    );
  }

  // Update pending_wait with timeoutJobId
  await db.update(conversations).set({
    status: "waiting",
    messages: finalMessages,
    pending_wait: {
      type: waitForState.waitType,
      reason: waitForState.reason,
      timeout: waitForState.timeout,
      metadata: waitForState.metadata,
      ...(timeoutJobId ? { timeoutJobId } : {}),
    },
    // ... existing fields
  }).where(eq(conversations.id, conv.id));
}
```

### Executor Signal Integration Points
```typescript
// Source: existing conversation-executor.ts -- modifications needed

// In signal() method, when status === "waiting" and type matches:
if (status === "waiting") {
  // ... existing type match check ...

  // NEW: Cancel pending timeout before resuming
  const pendingWait = row.pending_wait as Record<string, unknown> | null;
  if (pendingWait?.timeoutJobId) {
    await timeoutScheduler.cancel(pendingWait.timeoutJobId as string);
  }

  // ... existing resume logic (append signal message, set status queued) ...
}
```

### Executor Cancel Integration Points
```typescript
// Source: existing conversation-executor.ts -- modifications needed

// In cancel() method, before transitioning to "cancelled":
if (row.status === "waiting") {
  const pendingWait = row.pending_wait as Record<string, unknown> | null;
  if (pendingWait?.timeoutJobId) {
    await timeoutScheduler.cancel(pendingWait.timeoutJobId as string);
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Temporal `wf.condition(() => ..., timeout)` | pg-boss delayed job + executor.signal() | v2.3 Phase 41 | Same timeout semantics, no Temporal dependency |
| In-process setTimeout for timeouts | PostgreSQL-backed delayed jobs | v2.3 Phase 41 | Timeouts survive process restarts |
| Per-signal timeout handling | Unified signal pathway (wait_timeout is just another signal type) | v2.3 Phase 41 | No special code path for timeouts |

**Deprecated/outdated:**
- Temporal `heartbeatTimeout` for conversation timeouts: Replaced by pg-boss scheduled jobs
- In-process timer approaches: Don't survive restarts

## Open Questions

1. **pg-boss Pool adapter correctness**
   - What we know: pg-boss's `IDatabase` interface requires `executeSql(text, values) => { rows }`. The `pg.Pool.query()` returns `{ rows, rowCount }` which satisfies this.
   - What's unclear: Whether pg-boss uses any Pool-specific features (like `pool.connect()` for transactions) that the adapter would miss.
   - Recommendation: Start with the simple adapter. pg-boss uses `executeSql` for all operations, including its own transactions (it wraps them in SQL `BEGIN`/`COMMIT`). The adapter should work. Validate in testing. If issues arise, fall back to passing the pool's connection string directly (pg-boss creates its own pool, less ideal but guaranteed to work).

2. **singletonKey behavior for timeout jobs**
   - What we know: `singletonKey` prevents duplicate jobs with the same name + key combination. Using `conversationId` as the key prevents multiple timeout jobs per conversation.
   - What's unclear: Whether `singletonKey` blocks scheduling a new timeout after a previous one was cancelled. The docs say it only applies to jobs in `created` or `active` state.
   - Recommendation: Use `singletonKey: conversationId` for safety. If a conversation pauses, resumes, and pauses again, the first timeout should be cancelled before the second is scheduled, making the singleton key available again.

3. **pg-boss schema migration in CI/testing**
   - What we know: `migrate: true` runs schema setup automatically on `start()`. The schema lives in its own namespace (`pgboss`).
   - What's unclear: Whether `pnpm db:migrate` (Drizzle-based) needs to also handle pg-boss schema, or if pg-boss manages itself.
   - Recommendation: pg-boss manages its own schema entirely via `migrate: true`. No Drizzle migration needed for pg-boss tables. The `pgboss` schema is created and migrated by pg-boss on startup.

## Sources

### Primary (HIGH confidence)
- pg-boss GitHub repository: [github.com/timgit/pg-boss](https://github.com/timgit/pg-boss) -- TypeScript source for types, API
- pg-boss source types.ts: `SendOptions.startAfter`, `IDatabase.executeSql`, `ConstructorOptions` interfaces
- Existing codebase: `packages/agents/src/framework/worker-loop.ts` -- wait_for pause handling (lines 451-482)
- Existing codebase: `packages/agents/src/framework/conversation-executor.ts` -- signal() method (lines 289-443)
- Existing codebase: `packages/agents/src/framework/wait-for-tool.ts` -- WaitForState with timeout field
- Existing codebase: `packages/agents/src/shared/db/schema.ts` -- conversations table with pending_wait JSONB
- v2.3 spec: `2.3-spec.md` Appendix B.1 -- wait_for tool and "On timeout" behavior

### Secondary (MEDIUM confidence)
- [LogSnag: Scheduled and Background Jobs with pg-boss in TypeScript](https://logsnag.com/blog/deep-dive-into-background-jobs-with-pg-boss-and-typescript) -- TypeScript usage patterns
- [pg-boss issue #444: Documentation for PgBoss constructor db option](https://github.com/timgit/pg-boss/issues/444) -- IDatabase adapter pattern community usage
- [barrad.me: Type-Safe Background Jobs with pg-boss, Zod, and TypeScript](https://www.barrad.me/post/job-system-pgboss-typescript/) -- Zod integration pattern

### Tertiary (LOW confidence)
- [npm: pg-boss](https://www.npmjs.com/package/pg-boss) -- Version and basic usage
- WebSearch results for pg-boss cancellation patterns -- community usage confirmed

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- pg-boss decision locked in STATE.md, API verified from source code
- Architecture: HIGH -- Integration points clearly identified in existing executor/worker code, pg-boss API well-understood
- Pitfalls: HIGH -- Race conditions analyzed against existing signal dedup and idempotency mechanisms
- Code examples: MEDIUM -- Synthesized from pg-boss source types and existing codebase; adapter pattern needs runtime validation

**Research date:** 2026-02-02
**Valid until:** 2026-03-04 (stable domain -- pg-boss API is mature, executor code is freshly built)
