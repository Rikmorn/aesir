# Phase 37: Database Schema + Event Log Core - Research

**Researched:** 2026-02-01
**Domain:** Drizzle ORM schema design, append-only event log, reactive session projection, buffered writes
**Confidence:** HIGH

## Summary

Phase 37 establishes the persistence layer for the entire v2.3 framework. It creates three new tables (`conversations`, `agent_events`, `agent_sessions`) in the existing `agents` PostgreSQL schema, implements the `EventLog` service for append-only event recording with buffered writes, and implements the `SessionProjection` service that reactively updates agent session state from events.

This is a well-understood domain. The codebase already has the exact patterns needed: Drizzle ORM schema definitions with `pgSchema("agents")`, migration generation via `drizzle-kit`, factory-based services with dependency injection (`createTraceRecorder`, `createTaskStore`), and buffered write patterns. The new code follows these established patterns directly.

The key design decisions are already locked: gapless sequences per conversation via `MAX(sequence) + 1` (safe because one loop runs at a time per conversation), JSONB `messages` column with persist-at-boundaries strategy (avoids write amplification), and buffered writes with synchronous flush at lifecycle boundaries. The phase has no external dependencies -- it is the first phase of v2.3.

**Primary recommendation:** Follow existing codebase patterns exactly. New schema in `schema.ts` + `schema.drizzle.ts`, new migration SQL file, factory-based `createEventLog()` and `createSessionProjection()` services. No new libraries needed.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| drizzle-orm | 0.45.1 | Schema definition, query building, type inference | Already used across all packages in monorepo |
| drizzle-kit | 0.31.8 | Migration generation from schema changes | Already used, generates SQL migrations |
| pg | 8.17.2 | PostgreSQL driver (node-postgres) | Already used as Drizzle driver via `drizzle-orm/node-postgres` |
| nanoid | 5.1.6 | Prefixed ID generation (`evt_`, `sess_`, `conv_`) | Already used via `@aesir/types` createId |
| zod | 3.25.67 | Event type validation, payload schemas | Already used throughout codebase |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @aesir/types | workspace:* | `createId` factory for prefixed IDs | All ID generation |
| @aesir/platform | workspace:* | `createPinoLogger` for structured logging | All service logging |
| neverthrow | 8.2.0 | Result types for error boundaries | Optional, for query methods |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom EventLog | pg-boss event system | pg-boss is for job queues, not append-only event logs. EventLog needs gapless sequences and conversation-scoped queries that pg-boss doesn't model. |
| Drizzle ORM raw SQL | Raw `pg` queries | Drizzle provides type safety and schema-as-code. Raw SQL loses type inference. |
| SERIAL/BIGSERIAL for sequence | MAX(sequence)+1 | SERIAL creates gaps on rollback. Gapless sequences are required per spec. MAX+1 is safe given one-loop-per-conversation invariant. |

**Installation:**
```bash
# No new packages needed -- all dependencies already in @aesir/agents
```

## Architecture Patterns

### Recommended Project Structure
```
packages/agents/src/
  shared/db/
    schema.ts              # ADD new tables alongside existing
    schema.drizzle.ts      # ADD matching drizzle-kit version
    migrations/
      0001_add_v23_tables.sql  # NEW migration
    index.ts               # ADD new exports
  framework/               # NEW directory
    event-log.ts           # EventLog factory + implementation
    event-log.test.ts      # Unit tests
    session-projection.ts  # SessionProjection factory + implementation
    session-projection.test.ts
    types.ts               # AgentEvent, AgentEventType, EventLog interface
```

### Pattern 1: Dual Schema Files (Established Codebase Pattern)
**What:** Every Drizzle schema has two versions: `schema.ts` (with `@aesir/types` imports for ID generation) and `schema.drizzle.ts` (with inline nanoid for drizzle-kit compatibility).
**When to use:** Always -- drizzle-kit's CJS bundler cannot resolve external ESM dependencies like `@aesir/types`.
**Example:**
```typescript
// schema.ts (runtime)
import { createId } from "@aesir/types";
export const agentEvents = agentsSchema.table("agent_events", {
  id: text("id").primaryKey().$defaultFn(() => createId.agentEvent()),
  // ...
});

// schema.drizzle.ts (drizzle-kit only)
import { customAlphabet } from "nanoid";
const nanoid = customAlphabet("0123456789ABCDEF...z", 24);
export const agentEvents = agentsSchema.table("agent_events", {
  id: text("id").primaryKey().$defaultFn(() => `aevt_${nanoid()}`),
  // ...
});
```

### Pattern 2: Factory-Based Service (Established Codebase Pattern)
**What:** Services created via factory functions that validate dependencies and return an interface.
**When to use:** All new services (EventLog, SessionProjection).
**Example:**
```typescript
// Source: packages/agents/src/shared/db/trace-recorder.ts (existing pattern)
export interface EventLogOptions {
  db: NodePgDatabase<typeof agentsSchemaModule>;
  logger: PinoLogger;
  flushIntervalMs?: number; // Default: 1000
  maxBufferSize?: number;   // Default: 100
}

export interface EventLog {
  append(event: Omit<NewAgentEvent, "id" | "timestamp">): void;
  query(conversationId: string, opts?: EventQueryOpts): Promise<AgentEvent[]>;
  flush(): Promise<void>;
  close(): Promise<void>;
}

export function createEventLog(options: EventLogOptions): EventLog {
  const { db, logger: parentLogger } = options;
  if (!db) throw new Error("db is required for EventLog");
  if (!logger) throw new Error("logger is required for EventLog");
  // ... implementation
}
```

### Pattern 3: Buffered Writes with Configurable Flush
**What:** Events buffered in memory, batch-inserted on timer or explicit flush. Identical to existing `createTraceRecorder()` pattern but with a timer.
**When to use:** EventLog implementation.
**Example:**
```typescript
// Buffer + timer pattern
const buffer: NewAgentEvent[] = [];
let flushTimer: NodeJS.Timeout | null = null;

function scheduleFlush(): void {
  if (!flushTimer) {
    flushTimer = setTimeout(async () => {
      flushTimer = null;
      await doFlush();
    }, flushIntervalMs);
  }
}

function append(event: ...): void {
  buffer.push(buildRecord(event));
  if (buffer.length >= maxBufferSize) {
    // Eager flush on buffer full
    void doFlush();
  } else {
    scheduleFlush();
  }
}

async function doFlush(): Promise<void> {
  if (buffer.length === 0) return;
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  const toInsert = [...buffer];
  buffer.length = 0;
  try {
    await db.insert(agentEvents).values(toInsert);
  } catch (error) {
    logger.error({ err: error, count: toInsert.length }, "Failed to flush events");
    // Best-effort: do NOT re-throw (same as trace-recorder pattern)
  }
}
```

### Pattern 4: Gapless Sequence via Application Logic
**What:** Sequence numbers assigned in application code using `MAX(sequence) + 1` per conversation, not database sequences.
**When to use:** Event sequence numbering.
**Why:** PostgreSQL SERIAL/BIGSERIAL creates gaps on transaction rollback. The spec requires gapless sequences. Since only one agent loop runs per conversation at a time, MAX+1 is race-free within a conversation scope.
**Example:**
```typescript
// For buffered writes, track sequence in memory per conversation
const sequenceCounters = new Map<string, number>();

function getNextSequence(conversationId: string): number {
  const current = sequenceCounters.get(conversationId) ?? 0;
  const next = current + 1;
  sequenceCounters.set(conversationId, next);
  return next;
}

// On first event for a conversation, initialize from DB
async function initSequence(conversationId: string): Promise<void> {
  const result = await db
    .select({ maxSeq: sql<number>`COALESCE(MAX(${agentEvents.sequence}), 0)` })
    .from(agentEvents)
    .where(eq(agentEvents.conversationId, conversationId));
  sequenceCounters.set(conversationId, result[0]?.maxSeq ?? 0);
}
```

### Pattern 5: Reactive Session Projection (Subscribe to EventLog)
**What:** SessionProjection subscribes to EventLog events and reactively updates the `agent_sessions` table.
**When to use:** Keeping session state (status, timing, artifacts) in sync with the event stream.
**Example:**
```typescript
export function createSessionProjection(options: SessionProjectionOptions): SessionProjection {
  const { db, logger, eventLog } = options;

  // Subscribe to lifecycle and tool events
  eventLog.subscribe(
    { types: ["agent.started", "agent.completed", "agent.paused", "agent.resumed", "agent.failed", "tool.succeeded"] },
    async (event) => {
      await updateSession(event);
    }
  );

  async function updateSession(event: AgentEvent): Promise<void> {
    // Upsert session row
    await db.insert(agentSessions).values({
      conversationId: event.conversationId,
      agentDefinitionId: event.agentDefinitionId,
      status: deriveStatus(event.type),
      lastEventType: event.type,
      lastEventAt: event.timestamp,
      artifacts: {},
    }).onConflictDoUpdate({
      target: agentSessions.conversationId,
      set: {
        status: deriveStatus(event.type),
        lastEventType: event.type,
        lastEventAt: event.timestamp,
        updatedAt: new Date(),
      },
    });

    // Extract artifacts from tool.succeeded events
    if (event.type === "tool.succeeded" && event.payload?.artifactKey) {
      await updateArtifact(event);
    }
  }
}
```

### Anti-Patterns to Avoid
- **Don't use database sequences for gapless ordering:** PostgreSQL sequences skip on rollback. Use MAX(sequence)+1 in application code.
- **Don't flush events on every append:** This defeats the purpose of buffering. Only flush on timer, buffer full, or explicit flush() call.
- **Don't make EventLog.append() async:** Callers should never wait for persistence. Keep it synchronous (void return) to avoid blocking the agent loop.
- **Don't store duplicate data in conversations and agent_sessions:** agent_sessions is a projection FROM events. Conversations table stores messages/status for the executor (Phase 40). They have different owners and different update patterns.
- **Don't add foreign key constraints between agent_events and conversations:** Events are append-only and may arrive from sub-agents with different conversation scoping. Keep tables loosely coupled via conversationId text column.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ID generation | Custom UUID or random string | `createId` from `@aesir/types` | Consistent prefixed IDs across codebase (e.g., `aevt_`, `sess_`) |
| JSON payload truncation | Custom size limiter | `truncateJsonPayload()` from trace-recorder.ts | Already handles strings, objects, arrays, edge cases. Copy or extract to shared utility. |
| Schema definition | Raw SQL | Drizzle ORM `pgSchema().table()` | Type inference, migration generation, existing pattern |
| Updated_at triggers | Application-level timestamp updates | PostgreSQL trigger function | Already exists: `agents.update_updated_at_column()` created in migration 0000 |
| Connection pooling | Per-service pool setup | Existing `client.ts` pattern with `pg.Pool` | Pool management already handled |

**Key insight:** Phase 37 has zero novel technical challenges. Every pattern exists in the codebase already. The value is in correctly composing established patterns for the new domain.

## Common Pitfalls

### Pitfall 1: JSONB Write Amplification on Events Payload
**What goes wrong:** If event payloads are large (tool results can be 10KB+), batch INSERTs of many events with large payloads create significant WAL entries.
**Why it happens:** PostgreSQL TOAST compresses JSONB > 2KB, but each INSERT still writes full WAL.
**How to avoid:** Truncate large payloads before inserting (existing `truncateJsonPayload()` pattern from trace-recorder.ts). Set a reasonable max payload size (10KB default from existing code). The event log records WHAT happened, not full tool output.
**Warning signs:** WAL growth exceeding expectations, INSERT latency increasing.

### Pitfall 2: Sequence Counter Initialization Race
**What goes wrong:** If two events for the same conversation are appended before `initSequence()` completes, they get duplicate sequence numbers.
**Why it happens:** The EventLog may receive events for a conversation it hasn't seen before, and the async DB query to get MAX(sequence) hasn't completed.
**How to avoid:** The one-loop-per-conversation invariant means this shouldn't happen in practice (only one agent loop generates events for a conversation). But defensively: use `initSequence()` in `agent.started` handler before any other events, and never allow events without a sequence counter initialized.
**Warning signs:** Unique constraint violation on `(conversation_id, sequence)`.

### Pitfall 3: Timer-Based Flush Leaks Events on Process Shutdown
**What goes wrong:** Process exits before the flush timer fires. Events in buffer are lost.
**Why it happens:** `setTimeout` doesn't prevent Node.js from exiting.
**How to avoid:** The `close()` method must call `flush()` synchronously. The service bootstrap must call `eventLog.close()` during graceful shutdown. Additionally, the spec requires synchronous flush at lifecycle boundaries (pause, complete, fail) -- these explicit flushes catch most events before they would be lost.
**Warning signs:** Missing events for the last few tool calls before a crash/restart.

### Pitfall 4: Session Projection Fails Silently
**What goes wrong:** The subscribe handler throws an error (DB connection issue, schema mismatch), and the session projection falls behind without anyone noticing.
**Why it happens:** Subscribe handlers are async callbacks. Errors in callbacks don't propagate to the event producer.
**How to avoid:** Log errors with full context in the subscribe handler. Add a health check to SessionProjection that verifies it's processing events (compare last processed event time to last event time in agent_events). Never swallow errors silently in subscribe handlers.
**Warning signs:** agent_sessions table shows stale data (lastEventAt far behind current time).

### Pitfall 5: Drizzle-Kit Schema Drift
**What goes wrong:** Changes to `schema.ts` aren't mirrored in `schema.drizzle.ts`, causing migration generation to produce incorrect SQL.
**Why it happens:** Two files must stay in sync manually. Easy to forget one.
**How to avoid:** Always edit both files together. The existing codebase has this pattern -- follow it. Consider a brief comment at the top of each file reminding developers to keep them in sync (already present in existing files).
**Warning signs:** `drizzle-kit generate` produces unexpected migration SQL.

### Pitfall 6: Index Name Collisions Across Schemas
**What goes wrong:** Drizzle-generated index names collide with indexes in other schemas if they use the same base name.
**Why it happens:** PostgreSQL indexes are database-scoped, not schema-scoped. Two schemas can't have indexes with the same name.
**How to avoid:** Prefix all index names with a distinctive prefix. Existing codebase uses descriptive names like `context_snapshots_task_idx`, `tasks_status_idx`. For new tables, use `agent_events_*`, `agent_sessions_*`, `conversations_*` prefixes.
**Warning signs:** Migration fails with "relation already exists" error.

## Code Examples

Verified patterns from the existing codebase:

### Schema Definition (Following Existing Pattern)
```typescript
// Source: packages/agents/src/shared/db/schema.ts (existing pattern)
import { createId } from "@aesir/types";
import {
  index, integer, jsonb, pgSchema, text, timestamp, unique,
} from "drizzle-orm/pg-core";

export const agentsSchema = pgSchema("agents");

// New ID prefixes to add to @aesir/types createId:
// agentEvent: () => `aevt_${nanoid()}`
// agentSession: () => `sess_${nanoid()}`
// conversation: () => `conv_${nanoid()}`

// ─── Agent Events (append-only event log) ─────────────────────
export const agentEvents = agentsSchema.table(
  "agent_events",
  {
    id: text("id").primaryKey().$defaultFn(() => createId.agentEvent()),
    conversationId: text("conversation_id").notNull(),
    agentDefinitionId: text("agent_definition_id").notNull(),
    agentDefinitionVersion: text("agent_definition_version").notNull(),
    agentInstanceId: text("agent_instance_id").notNull(),
    parentInstanceId: text("parent_instance_id"),
    sequence: integer("sequence").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull().default({}),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
    tokenCountInput: integer("token_count_input"),
    tokenCountOutput: integer("token_count_output"),
    durationMs: integer("duration_ms"),
  },
  (table) => [
    unique("uq_agent_events_conv_seq").on(table.conversationId, table.sequence),
    index("idx_agent_events_conversation").on(table.conversationId, table.sequence),
    index("idx_agent_events_type").on(table.type),
    index("idx_agent_events_instance").on(table.agentInstanceId),
  ],
);

// ─── Agent Sessions (materialized projection) ────────────────
export const agentSessions = agentsSchema.table("agent_sessions", {
  conversationId: text("conversation_id").primaryKey(),
  agentDefinitionId: text("agent_definition_id").notNull(),
  status: text("status").notNull(),
  lastEventType: text("last_event_type").notNull(),
  lastEventAt: timestamp("last_event_at", { withTimezone: true }).notNull(),
  artifacts: jsonb("artifacts").notNull().default({}),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Conversations (executor state) ──────────────────────────
export const conversations = agentsSchema.table(
  "conversations",
  {
    id: text("id").primaryKey(),
    agentDefinitionId: text("agent_definition_id").notNull(),
    agentDefinitionVersion: text("agent_definition_version").notNull(),
    messages: jsonb("messages").notNull().default([]),
    status: text("status").notNull(),
    pendingWait: jsonb("pending_wait"),
    queuedSignals: jsonb("queued_signals").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_conversations_status").on(table.status),
    index("idx_conversations_definition").on(table.agentDefinitionId),
  ],
);

// ─── Type Exports ────────────────────────────────────────────
export type AgentEvent = typeof agentEvents.$inferSelect;
export type NewAgentEvent = typeof agentEvents.$inferInsert;
export type AgentSession = typeof agentSessions.$inferSelect;
export type NewAgentSession = typeof agentSessions.$inferInsert;
export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
```

### EventLog Factory (Following trace-recorder.ts Pattern)
```typescript
// Source pattern: packages/agents/src/shared/db/trace-recorder.ts
export function createEventLog(options: EventLogOptions): EventLog {
  const { db, logger: parentLogger, flushIntervalMs = 1000, maxBufferSize = 100 } = options;

  if (!db) throw new Error("db is required for EventLog");
  if (!parentLogger) throw new Error("logger is required for EventLog");

  const logger = parentLogger.child({ component: "event-log" });
  const buffer: NewAgentEvent[] = [];
  const subscribers: Map<string, EventSubscriber> = new Map();
  let flushTimer: NodeJS.Timeout | null = null;
  let closed = false;

  return {
    append(event) {
      if (closed) throw new Error("EventLog is closed");
      const record = buildRecord(event);
      buffer.push(record);
      // Notify subscribers immediately (in-memory, before persistence)
      notifySubscribers(record);
      if (buffer.length >= maxBufferSize) {
        void doFlush();
      } else {
        scheduleFlush();
      }
    },

    async query(conversationId, opts) {
      // Flush pending events for this conversation first for consistency
      await doFlush();
      return queryEvents(conversationId, opts);
    },

    subscribe(filter, handler) {
      const id = createId.event();
      subscribers.set(id, { filter, handler });
      return () => { subscribers.delete(id); };
    },

    async flush() {
      await doFlush();
    },

    async close() {
      closed = true;
      if (flushTimer) clearTimeout(flushTimer);
      await doFlush();
      subscribers.clear();
      logger.info("EventLog closed");
    },
  };
}
```

### Batch Insert (Following Existing Pattern)
```typescript
// Source: packages/agents/src/shared/db/trace-recorder.ts flush()
async function doFlush(): Promise<void> {
  if (buffer.length === 0) return;
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }

  const count = buffer.length;
  const toInsert = [...buffer];
  buffer.length = 0; // Clear buffer regardless of success/failure

  try {
    await db.insert(agentEvents).values(toInsert);
    logger.debug({ count }, "Flushed events to database");
  } catch (error) {
    logger.error({ err: error, count }, "Failed to flush events to database");
    // Best-effort: do NOT re-throw (matches trace-recorder pattern)
  }
}
```

### Migration SQL (Following Existing Pattern)
```sql
-- Following pattern from 0000_create_agents_schema.sql
-- New tables added to existing agents schema

-- Agent events table (append-only event log)
CREATE TABLE IF NOT EXISTS "agents"."agent_events" (
  "id" text PRIMARY KEY NOT NULL,
  "conversation_id" text NOT NULL,
  "agent_definition_id" text NOT NULL,
  "agent_definition_version" text NOT NULL,
  "agent_instance_id" text NOT NULL,
  "parent_instance_id" text,
  "sequence" integer NOT NULL,
  "type" text NOT NULL,
  "payload" jsonb NOT NULL DEFAULT '{}',
  "timestamp" timestamp with time zone DEFAULT now() NOT NULL,
  "token_count_input" integer,
  "token_count_output" integer,
  "duration_ms" integer,
  CONSTRAINT "uq_agent_events_conv_seq" UNIQUE("conversation_id", "sequence")
);

CREATE INDEX IF NOT EXISTS "idx_agent_events_conversation"
  ON "agents"."agent_events" ("conversation_id", "sequence");
CREATE INDEX IF NOT EXISTS "idx_agent_events_type"
  ON "agents"."agent_events" ("type");
CREATE INDEX IF NOT EXISTS "idx_agent_events_instance"
  ON "agents"."agent_events" ("agent_instance_id");

-- Agent sessions table (materialized projection from events)
CREATE TABLE IF NOT EXISTS "agents"."agent_sessions" (
  "conversation_id" text PRIMARY KEY NOT NULL,
  "agent_definition_id" text NOT NULL,
  "status" text NOT NULL,
  "last_event_type" text NOT NULL,
  "last_event_at" timestamp with time zone NOT NULL,
  "artifacts" jsonb NOT NULL DEFAULT '{}',
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Conversations table (executor state)
CREATE TABLE IF NOT EXISTS "agents"."conversations" (
  "id" text PRIMARY KEY NOT NULL,
  "agent_definition_id" text NOT NULL,
  "agent_definition_version" text NOT NULL,
  "messages" jsonb NOT NULL DEFAULT '[]',
  "status" text NOT NULL,
  "pending_wait" jsonb,
  "queued_signals" jsonb NOT NULL DEFAULT '[]',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_conversations_status"
  ON "agents"."conversations" ("status");
CREATE INDEX IF NOT EXISTS "idx_conversations_definition"
  ON "agents"."conversations" ("agent_definition_id");

-- Updated_at triggers for new tables
DROP TRIGGER IF EXISTS update_agent_sessions_updated_at ON agents.agent_sessions;
CREATE TRIGGER update_agent_sessions_updated_at
  BEFORE UPDATE ON agents.agent_sessions
  FOR EACH ROW
  EXECUTE FUNCTION agents.update_updated_at_column();

DROP TRIGGER IF EXISTS update_conversations_updated_at ON agents.conversations;
CREATE TRIGGER update_conversations_updated_at
  BEFORE UPDATE ON agents.conversations
  FOR EACH ROW
  EXECUTE FUNCTION agents.update_updated_at_column();
```

## State of the Art

| Old Approach (v2.2) | Current Approach (v2.3 Phase 37) | When Changed | Impact |
|---------------------|----------------------------------|--------------|--------|
| `execution_traces` (no tool results) | `agent_events` (includes tool.succeeded with results) | v2.3 | Complete tool lifecycle recorded |
| `tasks` (imperatively updated) | `agent_sessions` (reactively projected from events) | v2.3 | Ground-truth artifacts from events, not scanning |
| `context_snapshots` (LLM summaries) | `conversations.messages` (full history, compacted) | v2.3 | No lossy summarization at boundaries |
| Step numbering per agent instance | Gapless sequence per conversation | v2.3 | Events ordered within conversation scope |
| Flush at end of Temporal activity | Flush at configurable interval + lifecycle boundaries | v2.3 | Continuous observability, not just activity-end |

**Deprecated/outdated:**
- `execution_traces` table: Replaced by `agent_events` (Phase 47 drops it)
- `tasks` table: Replaced by `agent_sessions` (Phase 47 drops it)
- `context_snapshots` table: Replaced by `conversations.messages` (Phase 47 drops it)
- `createTraceRecorder()`: Will be replaced by EventLog (but keep until Phase 47 cleanup)

## Open Questions

Things that couldn't be fully resolved:

1. **EventLog.subscribe() implementation for in-process vs cross-process**
   - What we know: Phase 37 only needs in-process subscription (SessionProjection subscribes in same process). LISTEN/NOTIFY deferred to FUT-08.
   - What's unclear: Whether subscribe handlers should be sync or async. If async, how to handle backpressure.
   - Recommendation: Make subscribe handlers async (they do DB writes for projection). Fire-and-forget with error logging. No backpressure needed at Aesir's scale.

2. **Artifact extraction mapping: where does tool-to-artifact-key config live?**
   - What we know: The spec says "tool registry maps tools to artifact keys." Phase 38 (Tool Registry) is where this config lives.
   - What's unclear: Phase 37 builds SessionProjection but doesn't have ToolRegistry yet. How does it know which tool.succeeded events have artifacts?
   - Recommendation: SessionProjection receives artifact config as a parameter (a `Map<string, string>` of toolName -> artifactKey). Phase 38 passes this from ToolRegistry. For Phase 37 unit tests, pass a hardcoded map. This keeps Phase 37 independent of Phase 38.

3. **Should conversations table have additional columns for Phase 40 (Executor)?**
   - What we know: Phase 40 needs `claimed_by`, `last_heartbeat_at`, `claimed_at` for the executor's SKIP LOCKED pattern. The spec's conversations table doesn't include these.
   - What's unclear: Whether to add executor-specific columns now or in Phase 40's migration.
   - Recommendation: Add them now. A single migration is cleaner than two sequential migrations for the same table. The columns have sensible defaults (NULL) and don't affect Phase 37's scope. This avoids a migration coordination headache later.

4. **Event payload size limits**
   - What we know: Existing `truncateJsonPayload()` uses 10KB default.
   - What's unclear: Whether 10KB is right for all event types. `tool.succeeded` payloads with artifact data may need more space. `llm.response` payloads are typically smaller.
   - Recommendation: Use 10KB default (matches existing pattern). Make it configurable per event type if needed later. Artifact data in `tool.succeeded` events is typically small (PR URL, branch name) -- not full tool output.

## Sources

### Primary (HIGH confidence)
- Existing codebase: `packages/agents/src/shared/db/schema.ts` -- Drizzle schema patterns
- Existing codebase: `packages/agents/src/shared/db/schema.drizzle.ts` -- Drizzle-kit compatible schema
- Existing codebase: `packages/agents/src/shared/db/trace-recorder.ts` -- Buffered write pattern
- Existing codebase: `packages/agents/src/shared/db/task-store.ts` -- Factory-based service pattern
- Existing codebase: `packages/agents/drizzle.config.ts` -- Migration configuration
- Existing codebase: `packages/types/src/utils/ids.ts` -- Prefixed ID generation
- v2.3 spec: `2.3-spec.md` Section 2 (Event Log) and Appendix B.3 (Database Schema)
- v2.3 research: `.planning/research/SUMMARY.md` -- Architecture decisions and pitfalls

### Secondary (MEDIUM confidence)
- v2.3 research: `.planning/research/ARCHITECTURE.md` -- Event log integration patterns
- v2.3 research: `.planning/research/DATA.md` -- PostgreSQL schema design patterns

### Tertiary (LOW confidence)
- None -- all findings verified against existing codebase patterns

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already in use, versions verified in package.json and node_modules
- Architecture: HIGH -- every pattern exists in the codebase already (dual schema files, factory services, buffered writes, batch inserts)
- Pitfalls: HIGH -- based on existing codebase patterns and v2.3 research findings
- Schema design: HIGH -- based on spec's Appendix B.3 with adjustments from research findings

**Research date:** 2026-02-01
**Valid until:** Indefinite (stack is locked by existing codebase, no external dependencies to update)
