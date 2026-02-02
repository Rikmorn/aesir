# Phase 40: Conversation Executor - Research

**Researched:** 2026-02-02
**Domain:** PostgreSQL-backed durable execution engine (worker loop, SKIP LOCKED claiming, heartbeat, signal routing, retry semantics)
**Confidence:** HIGH

## Summary

Phase 40 implements the ConversationExecutor -- the central execution engine that replaces Temporal workflows. It is a PostgreSQL-backed durable executor with a worker loop that claims queued conversations using `SELECT FOR UPDATE SKIP LOCKED`, runs agent loops with heartbeat monitoring, pauses via the `wait_for` tool, resumes on signal delivery, and provides at-least-once execution with crash recovery.

The research confirms that all technical components are well-understood and achievable with the existing stack. The `conversations` table already exists (created in Phase 37 migration 0001) with the executor columns (`claimed_by`, `claimed_at`, `last_heartbeat_at`). Drizzle ORM 0.45.1 supports `FOR UPDATE SKIP LOCKED` (both via the `.for()` API fixed in 0.43.0 and via raw SQL fallback). The `runAgentLoop()` function already has an `onHeartbeat` callback that maps directly to the heartbeat interval mechanism. LZ4 compression for the messages JSONB column is supported since PostgreSQL 14 via `ALTER TABLE ... ALTER COLUMN ... SET COMPRESSION lz4`.

The phase is primarily an integration challenge -- wiring together existing components (EventLog, SessionProjection, AgentRegistry, ToolRegistry, HistoryManager, runAgentLoop) into a worker loop with concurrency-safe claiming, heartbeat, retry, and graceful shutdown semantics. No new external dependencies are needed.

**Primary recommendation:** Build the executor as a set of composable internal functions (claim, execute, heartbeat, persist, recover) behind the ConversationExecutor interface, using the existing factory pattern. Use Drizzle's `.for("update", { skipLocked: true })` for claiming where possible, with raw SQL CTE as fallback for the atomic claim-and-update pattern.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| drizzle-orm | ^0.45.1 | DB operations, transactions, FOR UPDATE SKIP LOCKED | Already in project, 0.43.0+ has SKIP LOCKED fix |
| pg (node-postgres) | existing | PostgreSQL driver backing Drizzle | Already in project via platform |
| @anthropic-ai/sdk | existing | LLM calls via runAgentLoop() | Already in project, unchanged |
| zod | existing | Schema validation for signals, wait_for params | Already in project |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| nanoid | existing | Worker ID generation (claimed_by) | For unique worker instance identification |
| pino | existing | Structured logging for executor operations | All worker loop logging |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom SKIP LOCKED executor | pg-boss | Decided against (STATE.md): conversation semantics don't map to generic job abstractions |
| Custom SKIP LOCKED executor | graphile-worker | Same reason -- generic job queue, not conversation-aware |
| Polling for signal delivery | LISTEN/NOTIFY | Deferred to post-v2.3 optimization |

**Installation:**
No new packages required. All dependencies already in the project.

## Architecture Patterns

### Recommended File Structure
```
packages/agents/src/framework/
  conversation-executor.ts        # ConversationExecutor factory + interface
  conversation-executor.test.ts   # Unit tests with mocked DB
  worker-loop.ts                  # Worker polling loop (claim + execute + heartbeat)
  worker-loop.test.ts             # Worker loop unit tests
  wait-for-tool.ts                # wait_for tool implementation (framework-controlled)
  wait-for-tool.test.ts           # wait_for tool tests

packages/agents/src/shared/tools/coordination/
  wait-for.ts                     # Updated: real wait_for tool definition (replaces placeholder)
```

### Pattern 1: Atomic Claim with CTE (SELECT FOR UPDATE SKIP LOCKED)
**What:** Single SQL statement that atomically selects, locks, and updates a conversation from queued/re-enqueued status to running.
**When to use:** Every poll cycle when the worker has capacity for more conversations.
**Example:**
```typescript
// Source: PostgreSQL docs + community best practices
// Drizzle raw SQL for atomic claim
async function claimConversation(
  tx: Transaction,
  workerId: string,
  limit: number,
): Promise<Conversation[]> {
  const now = new Date();
  const result = await tx.execute(sql`
    WITH claimable AS (
      SELECT id
      FROM agents.conversations
      WHERE status = 'queued'
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    UPDATE agents.conversations
    SET status = 'running',
        claimed_by = ${workerId},
        claimed_at = ${now},
        last_heartbeat_at = ${now},
        updated_at = ${now}
    FROM claimable
    WHERE agents.conversations.id = claimable.id
    RETURNING agents.conversations.*
  `);
  return result.rows as Conversation[];
}
```

### Pattern 2: Heartbeat via setInterval Callback
**What:** Periodic database UPDATE of `last_heartbeat_at` during agent loop execution, wired through the existing `onHeartbeat` callback on `AgentLoopOptions`.
**When to use:** Every 30 seconds during a running agent loop.
**Example:**
```typescript
// Wire heartbeat into runAgentLoop's onHeartbeat callback
function createHeartbeatCallback(
  db: Database,
  conversationId: string,
  logger: PinoLogger,
): { onHeartbeat: () => void; stop: () => void } {
  let lastBeat = Date.now();
  const INTERVAL_MS = 30_000;

  const onHeartbeat = () => {
    const now = Date.now();
    if (now - lastBeat >= INTERVAL_MS) {
      lastBeat = now;
      // Fire-and-forget heartbeat update
      void db.update(conversations)
        .set({ last_heartbeat_at: new Date(), updated_at: new Date() })
        .where(eq(conversations.id, conversationId))
        .catch((err) => logger.error({ err, conversationId }, "Heartbeat update failed"));
    }
  };

  return { onHeartbeat, stop: () => { /* no cleanup needed for fire-and-forget */ } };
}
```

### Pattern 3: Stale Conversation Recovery
**What:** Periodic scan for conversations with expired heartbeats that re-enqueues them for claiming.
**When to use:** Every poll cycle, alongside claiming new work.
**Example:**
```typescript
// Re-enqueue stale conversations (heartbeat > 5 minutes old)
async function recoverStaleConversations(
  db: Database,
  staleThresholdMs: number,
  logger: PinoLogger,
): Promise<number> {
  const threshold = new Date(Date.now() - staleThresholdMs);
  const result = await db.update(conversations)
    .set({
      status: sql`CASE
        WHEN retry_count < max_retries THEN 'queued'
        ELSE 'failed'
      END`,
      claimed_by: null,
      claimed_at: null,
      last_heartbeat_at: null,
      retry_count: sql`retry_count + 1`,
      updated_at: new Date(),
    })
    .where(and(
      eq(conversations.status, 'running'),
      lt(conversations.last_heartbeat_at, threshold),
    ))
    .returning({ id: conversations.id });
  return result.length;
}
```

### Pattern 4: wait_for Tool as Framework-Controlled Interceptor
**What:** The `wait_for` tool is a special tool that the executor intercepts -- it does not execute like normal tools. When the agent calls it, the executor pauses the conversation.
**When to use:** When the agent needs to pause and wait for an external signal.
**Implementation approach:**
The tool definition lives in the ToolRegistry as a normal tool, but the executor wraps it. Before passing tools to `runAgentLoop()`, the executor replaces the `wait_for` tool's `execute` function with one that throws a special `WaitForSignal` error (or sets a flag). The executor catches this signal after the loop iteration, persists state, and exits cleanly.

**Critical insight:** `runAgentLoop()` returns normally (the tool result is fed back to the LLM, the LLM generates an `end_turn` response). The wait_for tool returns a confirmation message. The LLM then stops calling tools (end_turn). The executor detects that `wait_for` was called (via a flag or by inspecting the conversation state) and transitions to "waiting" status.

### Pattern 5: Graceful Shutdown with Drain
**What:** On SIGTERM, stop accepting new work; let running conversations finish at their next natural persist boundary.
**When to use:** Container stop, deployment, scaling down.
**Example:**
```typescript
class WorkerLoop {
  private draining = false;
  private runningConversations = new Map<string, AbortController>();

  async start(): Promise<void> {
    process.on('SIGTERM', () => this.drain());
    process.on('SIGINT', () => this.drain());
    // ... polling loop
  }

  private drain(): void {
    this.draining = true;
    this.logger.info("Draining: stopping new claims, waiting for running conversations");
    // Do NOT abort running conversations -- let them finish naturally
    // The Docker stop_grace_period (60-120s) provides the deadline
  }
}
```

### Anti-Patterns to Avoid
- **Polling from within the agent loop:** The worker loop polls for work; the agent loop runs synchronously within one iteration. Never nest polling.
- **Direct tool_result injection for signals:** Signals are appended as user messages (plain text), not as tool_result blocks. The agent sees them as normal conversation turns.
- **Persisting messages on every tool call:** This is the CRITICAL-1 write amplification trap explicitly rejected in CONTEXT.md. Messages persist only at lifecycle boundaries (pause, complete, fail).
- **Using NOWAIT instead of SKIP LOCKED:** NOWAIT throws errors when rows are locked. SKIP LOCKED silently skips them -- correct for multi-worker claiming.
- **Re-using conversation ID suffix format inconsistently:** The `-r2`, `-r3` suffix for re-triggers must be deterministic and parseable. Use a counter, not timestamps.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Unique worker instance ID | UUID generation | `nanoid` with `wrkr_` prefix via `createId` pattern | Consistent with project's ID generation pattern |
| Heartbeat timing | Custom timer management | `onHeartbeat` callback on `runAgentLoop` + timestamp check | Already built into agent loop, just wire it to DB update |
| Signal deduplication | Custom dedup logic at executor level | Existing `WebhookIdempotencyService` + signal delivery tracking on conversation | Webhook dedup already handles most cases; executor tracks delivered_signal_ids |
| Token estimation for history | Custom tokenizer | `estimateMessageTokens` from history-manager.ts | Already implemented and tested |
| Event log recording | Custom event persistence | `EventLog.append()` from event-log.ts | Already built in Phase 37 with buffered writes |
| Session status tracking | Custom status management | `SessionProjection` subscribing to EventLog | Already built in Phase 37, reactively updates status |
| Retry backoff calculation | Custom exponential math | Simple `baseDelay * 2^(attempt-1)` + jitter | Standard pattern, 2 retries with 30s/60s per CONTEXT.md |
| JSONB compression | Custom compression layer | PostgreSQL LZ4 column compression (`SET COMPRESSION lz4`) | Database-level, transparent, no application code needed |

**Key insight:** Phase 40 is primarily a wiring/orchestration challenge, not a "build new infrastructure" challenge. The individual components (EventLog, SessionProjection, AgentRegistry, ToolRegistry, HistoryManager, runAgentLoop) are already implemented. The executor's job is to compose them into a durable execution loop with proper concurrency and lifecycle management.

## Common Pitfalls

### Pitfall 1: Write Amplification on Messages Column
**What goes wrong:** Persisting the full messages JSONB array on every tool call creates massive I/O (hundreds of writes per conversation, each rewriting the entire TOAST blob).
**Why it happens:** It seems safe to "just persist after each step" for durability. But TOAST rewrites the full blob on any change, and agent loops make 10-100+ tool calls.
**How to avoid:** Persist messages ONLY at lifecycle boundaries (pause, complete, fail) per CONTEXT.md decision. In-memory messages between persist points are intentionally volatile.
**Warning signs:** If you see `UPDATE conversations SET messages = ...` inside the tool execution loop, that's wrong.

### Pitfall 2: Race Between Signal Arrival and wait_for Call
**What goes wrong:** A signal arrives while the agent is still running (before calling wait_for). If not queued, the signal is lost.
**Why it happens:** External events (webhooks) are asynchronous. The agent may take minutes to reach a wait_for call.
**How to avoid:** Queue signals on the conversation record (JSONB `queued_signals` column). When wait_for is called, check queued_signals first. If a matching signal exists, consume it immediately -- the conversation never actually pauses.
**Warning signs:** If signal delivery requires the conversation to already be in "waiting" status, you have a race condition.

### Pitfall 3: Double-Execution After Stale Detection
**What goes wrong:** Worker A is slow (not crashed), its heartbeat expires, worker B re-enqueues and claims the conversation. Now both workers are running the same conversation.
**Why it happens:** The 5-minute stale threshold is a heuristic. A slow LLM call or network partition could exceed it without the worker being truly dead.
**How to avoid:** When a conversation is recovered/re-enqueued, clear `claimed_by`. When a worker finishes execution, verify it still owns the conversation (`WHERE id = $id AND claimed_by = $workerId`) before persisting. If ownership changed, discard results and log.
**Warning signs:** Two workers logging activity for the same conversation ID simultaneously.

### Pitfall 4: Drizzle `.for()` API Limitations
**What goes wrong:** Using `.for("update", { skipLocked: true })` may not compose correctly with CTEs needed for atomic claim-and-update.
**Why it happens:** Drizzle's `.for()` API was undocumented until recently and the CTE pattern requires raw SQL for the `WITH` clause.
**How to avoid:** Use `tx.execute(sql\`...\`)` for the claim query (raw SQL with Drizzle's `sql` template for parameterization). Use Drizzle's query builder for simpler operations (heartbeat updates, status changes).
**Warning signs:** If the claim query doesn't atomically SELECT + UPDATE in one statement, you have a TOCTOU race.

### Pitfall 5: Forgetting to Initialize EventLog Sequence on Resume
**What goes wrong:** After resuming a conversation, `eventLog.append()` throws "Sequence not initialized" because `initSequence()` wasn't called for this conversation ID.
**Why it happens:** The EventLog tracks per-conversation sequence counters in memory. On resume, the counter needs to be re-initialized from the database.
**How to avoid:** Always call `eventLog.initSequence(conversationId)` before appending any events for a conversation (both on initial start and on resume).
**Warning signs:** "Sequence not initialized for conversation" errors in logs.

### Pitfall 6: Conversation ID Suffix Collision on Re-triggers
**What goes wrong:** Two re-triggers of the same conversation race, both trying to create `-r2`.
**Why it happens:** The suffix counter is derived from querying existing conversations, creating a TOCTOU window.
**How to avoid:** Use INSERT with ON CONFLICT handling. Generate the suffix by querying MAX existing suffix + 1, wrapped in a transaction. Or use a simple INSERT that catches unique constraint violations and increments.
**Warning signs:** Unique constraint violations on conversation ID.

### Pitfall 7: LZ4 Compression Not Applied to Existing Rows
**What goes wrong:** After setting LZ4 compression on the messages column, existing rows still use pglz.
**Why it happens:** `ALTER TABLE ... ALTER COLUMN ... SET COMPRESSION lz4` only affects NEW writes. Existing data keeps its original compression.
**How to avoid:** This is acceptable for Phase 40 -- new conversations will use LZ4. Existing data doesn't need recompression since the conversations table is new (created in Phase 37). Just ensure the compression is set in the migration BEFORE any data is written.
**Warning signs:** `pg_column_compression()` returning 'pglz' for rows written after the ALTER.

### Pitfall 8: Not Handling runAgentLoop Errors vs. Completions
**What goes wrong:** The executor treats all loop exits the same, losing the distinction between clean completion, error, max_iterations, and max_tokens.
**Why it happens:** `runAgentLoop()` returns `AgentLoopResult` with a `status` field, but the executor needs to map these to different conversation outcomes.
**How to avoid:** Map `AgentLoopResult.status` explicitly:
- `completed` -> conversation completed (if no wait_for was called)
- `max_iterations` / `max_tokens` / `error` -> check if retryable; if so, re-enqueue with retry count increment; if not, mark failed
- `aborted` -> conversation cancelled (abort signal from graceful shutdown)

## Code Examples

### Complete Worker Loop Skeleton
```typescript
// Source: Pattern synthesis from research + existing codebase patterns

interface WorkerLoopOptions {
  db: Database;
  eventLog: EventLog;
  sessionProjection: SessionProjection;
  agentRegistry: AgentRegistry;
  toolRegistry: ToolRegistry;
  historyManager: HistoryManager;
  logger: PinoLogger;
  pollIntervalMs?: number;      // default: 5000
  concurrencyLimit?: number;    // default: 3
  heartbeatIntervalMs?: number; // default: 30000
  staleThresholdMs?: number;    // default: 300000 (5 min)
}

function createWorkerLoop(options: WorkerLoopOptions) {
  const {
    db, eventLog, sessionProjection, agentRegistry,
    toolRegistry, historyManager, logger,
    pollIntervalMs = 5000,
    concurrencyLimit = 3,
    heartbeatIntervalMs = 30000,
    staleThresholdMs = 300000,
  } = options;

  const workerId = `wrkr_${nanoid()}`;
  const running = new Map<string, AbortController>();
  let draining = false;
  let pollTimer: NodeJS.Timeout | null = null;

  async function poll(): Promise<void> {
    if (draining) return;

    // 1. Recover stale conversations
    await recoverStaleConversations(db, staleThresholdMs, logger);

    // 2. Claim work if capacity available
    const capacity = concurrencyLimit - running.size;
    if (capacity > 0) {
      const claimed = await db.transaction(async (tx) => {
        return claimConversation(tx, workerId, capacity);
      });

      for (const conv of claimed) {
        const controller = new AbortController();
        running.set(conv.id, controller);
        // Fire-and-forget execution (errors handled inside)
        void executeConversation(conv, controller.signal)
          .finally(() => running.delete(conv.id));
      }
    }

    // Schedule next poll
    if (!draining) {
      pollTimer = setTimeout(() => void poll(), pollIntervalMs);
    }
  }

  async function executeConversation(
    conv: Conversation,
    abortSignal: AbortSignal,
  ): Promise<void> {
    // ... load definition, resolve tools, apply history compaction,
    // wire heartbeat, run agent loop, persist results
  }

  return {
    start: () => void poll(),
    drain: () => { draining = true; /* ... */ },
    close: async () => { /* ... */ },
  };
}
```

### Signal Delivery with Queue Check
```typescript
// Source: Spec section on signal queueing (Topic 6)

async function deliverSignal(
  db: Database,
  conversationId: string,
  signal: Signal,
  logger: PinoLogger,
): Promise<{ action: "resumed" | "queued" | "rejected" | "deduplicated" }> {
  return await db.transaction(async (tx) => {
    // Lock the conversation row
    const [conv] = await tx.select()
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .for("update");

    if (!conv) {
      return { action: "rejected" as const };
    }

    // Check signal deduplication
    const deliveredIds = (conv.delivered_signal_ids as string[]) ?? [];
    const signalDedup = `${signal.source}:${signal.deduplicationId}`;
    if (signal.deduplicationId && deliveredIds.includes(signalDedup)) {
      return { action: "deduplicated" as const };
    }

    // Track delivered signal
    const newDeliveredIds = signal.deduplicationId
      ? [...deliveredIds, signalDedup]
      : deliveredIds;

    if (conv.status === "waiting") {
      // Check type match
      const pendingWait = conv.pending_wait as { type: string } | null;
      if (pendingWait?.type !== signal.type) {
        logger.warn({ conversationId, expected: pendingWait?.type, got: signal.type },
          "Signal type mismatch");
        return { action: "rejected" as const };
      }

      // Resume: append signal as user message, set status to queued
      const messages = conv.messages as unknown[];
      const signalMessage = {
        role: "user",
        content: signal.message ?? `Signal received: ${signal.type}. Data: ${JSON.stringify(signal.data)}`,
      };
      messages.push(signalMessage);

      await tx.update(conversations).set({
        status: "queued",
        messages,
        pending_wait: null,
        delivered_signal_ids: newDeliveredIds,
        updated_at: new Date(),
      }).where(eq(conversations.id, conversationId));

      return { action: "resumed" as const };
    }

    if (conv.status === "running" || conv.status === "queued") {
      // Queue signal for later consumption
      const queued = (conv.queued_signals as unknown[]) ?? [];
      queued.push(signal);

      await tx.update(conversations).set({
        queued_signals: queued,
        delivered_signal_ids: newDeliveredIds,
        updated_at: new Date(),
      }).where(eq(conversations.id, conversationId));

      return { action: "queued" as const };
    }

    return { action: "rejected" as const };
  });
}
```

### wait_for Tool Implementation
```typescript
// Source: Spec Appendix B.1

import { z } from "zod";
import type { ToolDefinition } from "../shared/agent-loop/types.js";

/**
 * Sentinel error thrown by wait_for to signal the executor.
 * The executor catches this to transition the conversation to "waiting" status.
 */
export class WaitForSignalError extends Error {
  constructor(
    public readonly waitType: string,
    public readonly reason: string,
    public readonly timeout?: string,
    public readonly metadata?: Record<string, unknown>,
  ) {
    super(`wait_for: ${waitType}`);
    this.name = "WaitForSignalError";
  }
}

export function createWaitForTool(): ToolDefinition {
  return {
    name: "wait_for",
    description:
      "Pause this conversation and wait for an external signal before continuing. " +
      "Use when you need: human approval for a plan, user reply in a conversation, " +
      "PR review feedback, CI results, or any external input. " +
      "The conversation will resume automatically when the signal arrives or the timeout expires.",
    inputSchema: z.object({
      type: z.string().describe(
        "What to wait for. Must match the signal type that will wake this conversation. " +
        "Common types: 'approval', 'user_reply', 'pr_review', 'pr_merged', 'escalation_resolved'."
      ),
      reason: z.string().describe(
        "Why you are pausing. Logged for observability and included in timeout notifications."
      ),
      timeout: z.string().optional().describe(
        "Max time to wait before auto-waking with a timeout signal. " +
        "Format: '<number><unit>' where unit is h (hours) or d (days). E.g., '72h', '7d'."
      ),
      metadata: z.record(z.unknown()).optional().describe(
        "Additional context stored with the pause."
      ),
    }),
    async execute(input: unknown): Promise<{ content: string; isError?: boolean }> {
      const parsed = input as {
        type: string;
        reason: string;
        timeout?: string;
        metadata?: Record<string, unknown>;
      };

      // Return a confirmation message to the LLM.
      // The executor detects wait_for was called via a flag or post-loop inspection.
      return {
        content: `Conversation paused. Waiting for: ${parsed.type}. Reason: ${parsed.reason}.` +
          (parsed.timeout ? ` Timeout: ${parsed.timeout}.` : ""),
      };
    },
  };
}
```

**Note on wait_for execution model:** There are two viable implementation approaches:
1. **Flag-based:** The executor wraps the wait_for execute function to set a flag. After runAgentLoop returns, check the flag to decide whether to pause.
2. **Post-loop inspection:** After runAgentLoop returns with "completed" status, inspect the trace for a "wait_for" tool call. If found, transition to waiting.

The flag-based approach is cleaner because it avoids trace parsing. The executor creates a closure that captures a mutable `waitForState` object, wraps the tool's execute to set it, and checks it after the loop.

### Idempotent Start with Re-trigger
```typescript
// Source: CONTEXT.md decisions on duplicate start & re-trigger behavior

async function startConversation(
  db: Database,
  params: StartConversationParams,
): Promise<string> {
  const baseId = params.conversationId ??
    `${params.agentDefinitionId}-${params.correlationKey}`;

  return await db.transaction(async (tx) => {
    // Check for existing conversation
    const [existing] = await tx.select()
      .from(conversations)
      .where(eq(conversations.id, baseId))
      .for("update");

    if (existing) {
      if (existing.status === "running" || existing.status === "queued" || existing.status === "waiting") {
        // Idempotent: return existing (no-op)
        return existing.id;
      }

      // Terminal state: create new conversation with suffix
      const suffix = await findNextSuffix(tx, baseId);
      const newId = `${baseId}-r${suffix}`;
      await insertNewConversation(tx, newId, params, existing);
      return newId;
    }

    // New conversation
    await insertNewConversation(tx, baseId, params);
    return baseId;
  });
}

async function findNextSuffix(tx: Transaction, baseId: string): Promise<number> {
  // Find highest existing suffix: baseId-r2, baseId-r3, etc.
  const rows = await tx.execute(sql`
    SELECT id FROM agents.conversations
    WHERE id LIKE ${baseId + '-r%'}
    ORDER BY id DESC
    LIMIT 1
  `);
  if (rows.rows.length === 0) return 2;
  const lastId = rows.rows[0].id as string;
  const match = lastId.match(/-r(\d+)$/);
  return match ? parseInt(match[1], 10) + 1 : 2;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Temporal workflows for agent orchestration | Custom PostgreSQL executor with SKIP LOCKED | v2.3 (this phase) | Removes Temporal dependency, full conversation history preservation |
| LangGraph checkpointer for state | JSONB messages column on conversations table | v2.3 (this phase) | Simpler persistence, no LangGraph dependency |
| Signal definitions (`defineSignal<[T]>`) | Freeform string types on IncomingEvent | v2.3 (this phase) | Adding new signal types requires zero framework changes |
| Per-activity context snapshots | Full conversation history with compaction | v2.3 Phase 39 (done) | No lossy summarization at boundaries |
| Separate services per agent | Single service with agent registry | v2.3 Phase 38 (done) | Zero infrastructure changes for new agents |

**Deprecated/outdated:**
- `@temporalio/*` packages: Replaced by ConversationExecutor
- `execution_traces` table: Replaced by `agent_events` (EventLog)
- `tasks` table: Replaced by `agent_sessions` (SessionProjection)
- `context_snapshots` table: Replaced by conversation history with HistoryManager compaction

## Open Questions

1. **Drizzle `.for("update", { skipLocked: true })` in practice**
   - What we know: The `noWait` bug was fixed in 0.43.0; project uses 0.45.1. The `skipLocked` option likely works correctly since it uses two words (matching PostgreSQL syntax).
   - What's unclear: Whether `.for()` composes with CTEs for the atomic claim-and-update pattern.
   - Recommendation: Start with raw SQL CTE for the claim query (most critical path). Use `.for("update")` for simpler lock scenarios (signal delivery). Validate `.for("update", { skipLocked: true })` early in implementation -- if it works, use it for cleaner code.

2. **Additional columns needed on conversations table**
   - What we know: The table exists with `claimed_by`, `claimed_at`, `last_heartbeat_at` (added in Phase 37).
   - What's unclear: Need to add `retry_count` (integer, default 0), `max_retries` (integer, default 2), `error_message` (text, nullable), `delivered_signal_ids` (JSONB array, default []), and `parent_conversation_id` (text, nullable for sub-agent tracking).
   - Recommendation: Create a new migration (0002) for these columns. Verify with the team whether `max_retries` should be per-conversation or derived from framework config.

3. **LZ4 compression migration timing**
   - What we know: `ALTER TABLE ... ALTER COLUMN ... SET COMPRESSION lz4` only affects new writes. The conversations table was created in migration 0001.
   - What's unclear: Whether the 0002 migration should set LZ4 compression, or if it should be part of a separate migration.
   - Recommendation: Include in the 0002 migration that adds the new columns. Since the table is new (no existing data to worry about), all future writes will use LZ4.

4. **Docker stop_grace_period configuration**
   - What we know: CONTEXT.md specifies 60-120s for Docker stop_grace_period.
   - What's unclear: The exact value depends on typical agent loop duration and the force-persist timeout.
   - Recommendation: Start with 90 seconds. This gives ~60s for natural completion + 30s safety margin. Can be tuned based on observed drain times.

## Sources

### Primary (HIGH confidence)
- Existing codebase: `packages/agents/src/framework/` (types.ts, event-log.ts, session-projection.ts, agent-registry.ts, tool-registry.ts, tool-factories.ts, history-manager.ts)
- Existing codebase: `packages/agents/src/shared/agent-loop/run-agent-loop.ts` (runAgentLoop, onHeartbeat callback)
- Existing codebase: `packages/agents/src/shared/db/schema.ts` (conversations table schema with executor columns)
- Existing codebase: `packages/agents/src/shared/temporal/workflows/orchestrator-workflow.ts` (current Temporal workflow being replaced)
- v2.3 spec: `2.3-spec.md` (full architecture, acceptance criteria, signal handling)
- Phase 40 CONTEXT.md: Implementation decisions (message persistence, worker model, failure semantics, re-trigger behavior)

### Secondary (MEDIUM confidence)
- [PostgreSQL SKIP LOCKED documentation](https://www.postgresql.org/docs/current/sql-select.html) - Official SELECT docs on FOR UPDATE SKIP LOCKED
- [Drizzle ORM issue #3554](https://github.com/drizzle-team/drizzle-orm/issues/3554) - NOWAIT bug fixed in 0.43.0, confirms SKIP LOCKED works
- [PostgreSQL LZ4 TOAST compression](https://www.enterprisedb.com/blog/configurable-lz4-toast-compression) - EDB article on LZ4 compression since PG14
- [Netdata: SKIP LOCKED for Queue-Based Workflows](https://www.netdata.cloud/academy/update-skip-locked/) - CTE pattern for atomic claim
- [Inferable: Unreasonable Effectiveness of SKIP LOCKED](https://www.inferable.ai/blog/posts/postgres-skip-locked) - Best practices and scaling considerations
- [Depesz: JSON/JSONB pglz vs lz4](https://www.depesz.com/2025/11/29/using-json-json-vs-jsonb-pglz-vs-lz4-key-optimization-parsing-speed/) - LZ4 performance benchmarks for JSONB

### Tertiary (LOW confidence)
- [Express.js: Healthcheck & Graceful Shutdown](https://expressjs.com/en/advanced/healthcheck-graceful-shutdown.html) - Standard Node.js shutdown pattern
- [Medium: PostgreSQL as Message Queue](https://medium.com/@the_atomic_architect/postgresql-replaced-my-message-queue-and-taught-me-skip-locked-along-the-way-87d59e5b9525) - Community experience with SKIP LOCKED at scale

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All components already exist in the codebase; no new dependencies needed
- Architecture: HIGH - Spec is detailed, decisions are locked, patterns are well-established PostgreSQL idioms
- Pitfalls: HIGH - Verified against spec decisions, existing Temporal workflow code, and community SKIP LOCKED documentation
- Code examples: MEDIUM - Synthesized from multiple sources and existing codebase patterns; need validation against actual Drizzle API behavior for SKIP LOCKED

**Research date:** 2026-02-02
**Valid until:** 2026-03-04 (stable domain -- PostgreSQL patterns, no fast-moving libraries)
