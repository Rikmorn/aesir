# Phase 29: Database Schema & Context Management - Research

**Researched:** 2026-01-29
**Domain:** Drizzle ORM PostgreSQL schema design, Temporal activity boundary context persistence, automatic execution tracing via agent loop callbacks
**Confidence:** HIGH

## Summary

Researched how to implement three new PostgreSQL tables (`context_snapshots`, `tasks`, `execution_traces`) in a new `agents` PostgreSQL schema namespace, plus the service layer for context persistence and automatic trace recording. The codebase has a well-established pattern for Drizzle ORM schema definitions, migration management, and database client setup -- Phase 29 follows these patterns exactly.

The key architectural insight is that Phase 28's `runAgentLoop()` already provides `onToolCall` and `onResponse` callbacks that fire on every iteration. Phase 29 connects these callbacks to database persistence via a `createTraceRecorder()` factory that produces callback functions writing to `agents.execution_traces`. Context management adds a `createContextManager()` service with `writeSnapshot()` and `readLatestSnapshot()` methods called at Temporal activity boundaries.

**Primary recommendation:** Follow the established codebase pattern (text IDs with nanoid prefixes, `pgSchema` for namespace isolation, dual `schema.ts`/`schema.drizzle.ts` files, hand-written SQL migrations). The `agents` package already depends on `drizzle-orm` -- add `drizzle-kit` as a dev dependency, create a `drizzle.config.ts`, and follow the exact same structure as `@aesir/observability` and `@aesir/integration-linear`.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `drizzle-orm` | ^0.45.1 | ORM for PostgreSQL schema definitions and queries | Already in `@aesir/agents` dependencies |
| `pg` | ^8.17.2 | PostgreSQL client for `drizzle-orm/node-postgres` driver | Already used by observability and platform packages |
| `drizzle-kit` | ^0.31.8 | Migration generation and execution | Already used by all packages with DB schemas |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `nanoid` | (via `@aesir/types`) | Prefixed ID generation | All new table IDs use `createId.*` pattern |
| `neverthrow` | ^8.2.0 | Result type for service layer | Already in agents deps, use for context/trace service errors |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Text IDs with nanoid | UUID (gen_random_uuid()) | Spec shows UUID, but entire codebase uses text IDs with prefixed nanoid. Consistency wins. |
| Hand-written SQL migrations | drizzle-kit generate | Some packages (linear, github, slack) hand-write initial schema migrations for clarity. Generated migrations work but are less readable. Recommendation: hand-write the initial migration for readability. |
| Separate agents DB package | Schema in agents package | Putting DB schema in agents is simpler and avoids a new package. Platform/observability own their schemas in their own packages. Agents should own its schema too. |

### Installation
```bash
pnpm --filter @aesir/agents add pg
pnpm --filter @aesir/agents add -D drizzle-kit @types/pg
```

**Note:** `drizzle-orm` (^0.45.1) is already in `@aesir/agents` dependencies. `pg` needs to be added for `drizzle-orm/node-postgres` driver. `drizzle-kit` is needed for migration generation/execution.

## Architecture Patterns

### Recommended Project Structure
```
packages/agents/
  src/
    shared/
      db/
        schema.ts              # Drizzle ORM schema (app code imports this)
        schema.drizzle.ts      # Drizzle Kit schema (migration generation only)
        client.ts              # Database client factory
        index.ts               # Barrel export
        context-manager.ts     # Context snapshot read/write service
        context-manager.test.ts
        trace-recorder.ts      # Trace recording callbacks for runAgentLoop
        trace-recorder.test.ts
        task-store.ts          # Task state read/write service
        task-store.test.ts
      db/migrations/
        0000_create_agents_schema.sql  # Hand-written initial migration
        meta/
          _journal.json
          0000_snapshot.json
  drizzle.config.ts            # Drizzle Kit config for agents schema
```

### Pattern 1: Dual Schema Files (schema.ts + schema.drizzle.ts)
**What:** Two schema files -- one for application code with `@aesir/types` imports, one for drizzle-kit that avoids external dependencies
**When to use:** Always -- drizzle-kit's CJS bundler cannot resolve `@aesir/types`
**Why:** Every package in the codebase follows this pattern (platform, observability, linear, github, slack)

```typescript
// schema.ts -- used by application code
import { createId } from "@aesir/types";
import { index, integer, jsonb, pgSchema, text, timestamp } from "drizzle-orm/pg-core";

export const agentsSchema = pgSchema("agents");

export const contextSnapshots = agentsSchema.table(
  "context_snapshots",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId.contextSnapshot()),
    // ... columns
  },
);

// schema.drizzle.ts -- used by drizzle-kit only
import { customAlphabet } from "nanoid";
const nanoid = customAlphabet("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz", 24);

export const agentsSchema = pgSchema("agents");

export const contextSnapshots = agentsSchema.table(
  "context_snapshots",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => `ctx_${nanoid()}`),
    // ... same columns
  },
);
```

### Pattern 2: Text IDs with Nanoid Prefixes
**What:** All primary keys are `text` columns with prefixed nanoid values (e.g., `ctx_abc123...`, `task_def456...`, `trace_ghi789...`)
**When to use:** Every new table in this project
**Why:** Established codebase convention. Every package uses this pattern via `createId.*` from `@aesir/types`. The spec's `UUID PRIMARY KEY DEFAULT gen_random_uuid()` does NOT match the codebase.

New `createId` entries needed:
```typescript
// Add to packages/types/src/utils/ids.ts
export const createId = {
  // ... existing entries ...
  /** Context snapshot ID (agents.context_snapshots) */
  contextSnapshot: () => `ctx_${nanoid()}`,
  /** Agent task ID (agents.tasks) */
  agentTask: () => `atask_${nanoid()}`,
  /** Execution trace ID (agents.execution_traces) */
  executionTrace: () => `trace_${nanoid()}`,
} as const;
```

### Pattern 3: Database Client Factory
**What:** Per-package database client with connection pooling, following the exact pattern from platform and observability
**When to use:** Every package that owns database tables

```typescript
// Source: packages/platform/src/db/client.ts (existing pattern)
import { createPinoLogger } from "@aesir/platform";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

const logger = createPinoLogger({ component: "agents:db" });

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      host: process.env.DB_HOST || "localhost",
      port: Number.parseInt(process.env.DB_PORT || "5432", 10),
      user: process.env.DB_USER || "temporal",
      password: process.env.DB_PASSWORD || "temporal",
      database: process.env.DB_NAME || "temporal",
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
    pool.on("error", (err) => {
      logger.error({ err }, "Unexpected database pool error");
    });
  }
  return pool;
}

export const db = drizzle(getPool(), { schema });

export async function closeDatabase(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info("Database pool closed");
  }
}
```

### Pattern 4: Service Factory with Dependency Injection
**What:** Services are created via factory functions that receive `db` and `logger` as dependencies
**When to use:** Context manager, trace recorder, task store

```typescript
// Source: packages/observability/src/services/execution-tracker.ts (existing pattern)
interface ContextManagerOptions {
  db: PostgresJsDatabase;
  logger: PinoLogger;
}

export function createContextManager(options: ContextManagerOptions): ContextManager {
  const { db, logger } = options;
  if (!db) throw new Error("db is required for ContextManager");
  if (!logger) throw new Error("logger is required for ContextManager");

  return {
    async writeSnapshot(params) { /* ... */ },
    async readLatestSnapshot(taskId, workflowId) { /* ... */ },
    async health() { /* ... */ },
    async close() { /* ... */ },
  };
}
```

### Pattern 5: Trace Recorder as Callback Factory
**What:** A factory that produces `onToolCall` and `onResponse` callback functions pre-bound to a database connection and agent context
**When to use:** Connecting `runAgentLoop()` callbacks to database persistence (TRAC-02, TRAC-05)
**Why:** The `onToolCall`/`onResponse` callbacks from Phase 28 are simple function signatures. The trace recorder wraps them with database write logic.

```typescript
interface TraceRecorderOptions {
  db: PostgresJsDatabase;
  logger: PinoLogger;
  taskId: string;
  workflowId: string;
  agentType: string;
  agentInstanceId: string;
  parentAgentInstanceId?: string;
}

interface TraceRecorderCallbacks {
  onToolCall: (call: ToolCallInfo) => void;
  onResponse: (response: LLMResponse) => void;
  /** Call when agent spawns a sub-agent */
  onAgentSpawn: (childInstanceId: string, childType: string, brief: unknown) => void;
  /** Call when agent completes */
  onAgentComplete: (result: unknown) => void;
  /** Flush any pending writes (call at end of activity) */
  flush: () => Promise<void>;
}

export function createTraceRecorder(options: TraceRecorderOptions): TraceRecorderCallbacks {
  // Returns callbacks that write to agents.execution_traces
  // Uses a step counter per agent instance
  // Batches writes for performance (flush at end)
}
```

### Pattern 6: Context Write/Read at Temporal Activity Boundaries
**What:** Context snapshots are written at the END of each Temporal activity and read at the START of the next
**When to use:** Any Temporal activity that runs `runAgentLoop()` (CTXM-03, CTXM-04)

```
Temporal Activity 1 (pre-approval):
  1. runAgentLoop() executes research + planning
  2. At end, LLM self-summarizes via a final "summarize" call
  3. Programmatic extraction captures structured fields
  4. contextManager.writeSnapshot() persists to DB
  5. Activity returns plan for approval

[Temporal wait for approval signal]

Temporal Activity 2 (post-approval):
  1. contextManager.readLatestSnapshot(taskId, workflowId) loads context
  2. Context injected into runAgentLoop() system prompt as context string
  3. Agent has full understanding of research/plan from pre-approval phase
  4. Executes implementation, tests, creates PR
  5. contextManager.writeSnapshot() persists final state
```

### Pattern 7: Drizzle Config for Agents Schema
**What:** Drizzle Kit configuration for the agents schema namespace
**When to use:** Migration generation and execution

```typescript
// drizzle.config.ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./src/shared/db/migrations",
  schema: "./src/shared/db/schema.drizzle.ts",
  dialect: "postgresql",
  dbCredentials: {
    host: process.env.DB_HOST ?? "localhost",
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USER ?? "temporal",
    password: process.env.DB_PASSWORD ?? "temporal",
    database: process.env.DB_NAME ?? "temporal",
    ssl: false,
  },
  migrations: {
    table: "__drizzle_agents_migrations",
    schema: "agents",
  },
  schemaFilter: ["agents"],
});
```

### Anti-Patterns to Avoid
- **Using UUID for primary keys:** The entire codebase uses `text` with nanoid prefixes. Don't introduce UUIDs even though the v2.2 spec shows them.
- **Putting schema in a separate package:** The agents package already depends on `drizzle-orm`. Keep the schema co-located with the code that uses it.
- **Synchronous trace writes blocking the agent loop:** The `onToolCall`/`onResponse` callbacks must not `await` database writes synchronously within the loop iteration. Buffer writes and flush periodically or at activity end.
- **Storing full conversation history in context snapshots:** Context snapshots hold LLM-generated summaries, not raw conversation arrays. The whole point is compact semantic state.
- **Using JSONB for critical structured data:** PR number, branch name, container ID go in typed columns (CTXM-02). Only semantic/flexible data goes in JSONB.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ID generation | Custom random IDs | `createId.*` from `@aesir/types` | Established pattern, prefixed for debugging |
| Database connection pooling | Custom pool management | `drizzle-orm/node-postgres` with `pg.Pool` | Existing pattern across all packages |
| Migration management | Raw SQL scripts run manually | `drizzle-kit migrate` | Established workflow via `pnpm db:migrate` |
| Schema namespace isolation | Manual `CREATE SCHEMA` | `pgSchema("agents")` from Drizzle | Type-safe, consistent with all other packages |
| JSON serialization for JSONB | Custom JSON handling | `jsonb()` column type from Drizzle | Handles serialization/deserialization automatically |
| Updated_at trigger | Application-level timestamp | PostgreSQL trigger function | Existing pattern from linear schema migration |

**Key insight:** Phase 29 introduces no new libraries or patterns. Every piece follows an existing pattern in the codebase. The only new thing is the `agents` schema namespace and the specific tables/services.

## Common Pitfalls

### Pitfall 1: drizzle-kit CJS Bundler Fails on @aesir/types Import
**What goes wrong:** `drizzle-kit generate` or `drizzle-kit migrate` crashes with import resolution errors
**Why it happens:** drizzle-kit uses a CJS bundler internally that cannot resolve TypeScript workspace package imports like `@aesir/types`
**How to avoid:** Always maintain a `schema.drizzle.ts` file that duplicates the schema WITHOUT `@aesir/types` imports. Use inline nanoid instead.
**Warning signs:** `Cannot find module '@aesir/types'` during migration generation

### Pitfall 2: Synchronous Trace Writes Slowing the Agent Loop
**What goes wrong:** Agent loop iterations take 100ms+ longer due to database round-trips for trace recording
**Why it happens:** If `onToolCall`/`onResponse` callbacks directly await database inserts, each LLM iteration adds a DB write to the critical path
**How to avoid:** Buffer trace steps in memory during the loop. Flush to database either: (a) periodically every N steps, (b) at the end of the agent loop, or (c) using fire-and-forget with error logging. Recommendation: buffer in-memory, flush at end of `runAgentLoop()` or when the Temporal activity completes.
**Warning signs:** Agent loop duration significantly higher than LLM API call time alone

### Pitfall 3: JSONB Default Values Must Be Valid JSON
**What goes wrong:** Drizzle ORM fails to create the default value or PostgreSQL rejects the migration
**Why it happens:** JSONB defaults must be valid JSON strings, not JavaScript objects
**How to avoid:** Use `jsonb("column").default(sql`'[]'::jsonb`)` or `.default([])` (Drizzle handles serialization). The existing codebase uses `.default({})` which Drizzle serializes correctly for node-postgres driver.
**Warning signs:** Migration fails with syntax errors on default values

### Pitfall 4: Missing Schema Creation in Migration
**What goes wrong:** `relation "agents.context_snapshots" does not exist`
**Why it happens:** The migration creates tables but forgets `CREATE SCHEMA IF NOT EXISTS "agents"`
**How to avoid:** Always include `CREATE SCHEMA IF NOT EXISTS "agents"` at the top of the initial migration. All existing packages do this (see linear, github, slack migrations).
**Warning signs:** Any `relation does not exist` error on first migration run

### Pitfall 5: Context Snapshot Write Failure Kills the Temporal Activity
**What goes wrong:** A transient DB error writing the context snapshot causes the entire Temporal activity to fail and retry from scratch
**Why it happens:** If `writeSnapshot()` throws and isn't caught, the Temporal activity fails
**How to avoid:** Context snapshot writes should be best-effort with error logging. If the write fails, log the error and continue -- the agent can still function; it just won't have the snapshot for crash recovery. Use `try/catch` around context writes.
**Warning signs:** Temporal activity retries caused by DB errors during context writing

### Pitfall 6: Integer Overflow on token_count_input/output
**What goes wrong:** PostgreSQL `integer` columns overflow for very large token counts
**Why it happens:** PostgreSQL `integer` is 32-bit (-2B to +2B). Individual LLM calls rarely exceed thousands of tokens, but cumulative counts could grow large.
**How to avoid:** Use `integer` for per-step counts (these are small). The cumulative totals live in context_snapshots as JSONB, not as integer columns. Per-step values will never overflow integer.
**Warning signs:** Negative token counts in the database (integer overflow wraps)

## Code Examples

### Table: agents.context_snapshots (CTXM-01, CTXM-06)
```typescript
// Source: Derived from v2.2 spec + codebase patterns
import { createId } from "@aesir/types";
import { index, jsonb, pgSchema, text, timestamp } from "drizzle-orm/pg-core";

export const agentsSchema = pgSchema("agents");

export const contextSnapshots = agentsSchema.table(
  "context_snapshots",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId.contextSnapshot()),
    task_id: text("task_id").notNull(),
    workflow_id: text("workflow_id").notNull(),
    agent_type: text("agent_type").notNull(), // "dev-orchestrator", "product", etc.
    stage: text("stage").notNull(), // "post-research", "post-approval", "post-execution"

    // Semantic context (LLM-generated + programmatic)
    summary: text("summary").notNull(),
    completed_actions: jsonb("completed_actions").$type<string[]>().default([]),
    pending_intent: text("pending_intent"),
    known_issues: jsonb("known_issues").$type<string[]>().default([]),
    project_context: jsonb("project_context").$type<Record<string, unknown>>().default({}),
    key_files: jsonb("key_files").$type<string[]>().default([]),
    research_findings: jsonb("research_findings"),
    plan: jsonb("plan"),

    // Metadata
    tool_call_count: integer("tool_call_count").notNull().default(0),
    token_count: jsonb("token_count").$type<{ input: number; output: number }>().default({ input: 0, output: 0 }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("context_snapshots_task_idx").on(table.task_id),
    index("context_snapshots_workflow_idx").on(table.workflow_id),
  ],
);
```

**Note:** Import `integer` from `drizzle-orm/pg-core` alongside the other column types.

### Table: agents.tasks (CTXM-02, CTXM-06)
```typescript
export const tasks = agentsSchema.table(
  "tasks",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId.agentTask()),
    task_id: text("task_id").notNull().unique(), // e.g., Linear issue UUID
    issue_id: text("issue_id"),
    issue_identifier: text("issue_identifier"), // e.g., "AES-42"
    agent_type: text("agent_type").notNull(), // "dev" or "product"
    workflow_id: text("workflow_id"),
    status: text("status")
      .$type<"pending" | "researching" | "planning" | "approved" | "executing" | "complete" | "failed">()
      .notNull()
      .default("pending"),

    // Critical structured data (typed columns, not JSONB)
    container_id: text("container_id"),
    branch_name: text("branch_name"),
    pr_number: integer("pr_number"),
    pr_url: text("pr_url"),
    approval_status: text("approval_status")
      .$type<"pending" | "approved" | "rejected">()
      .default("pending"),
    approval_feedback: text("approval_feedback"),

    // Error tracking
    error: text("error"),
    escalation_reason: text("escalation_reason"),

    // Slack context
    slack_channel: text("slack_channel"),
    slack_message_ts: text("slack_message_ts"),

    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("tasks_workflow_idx").on(table.workflow_id),
    index("tasks_status_idx").on(table.status),
  ],
);
```

### Table: agents.execution_traces (TRAC-01, TRAC-04)
```typescript
export const executionTraces = agentsSchema.table(
  "execution_traces",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId.executionTrace()),
    task_id: text("task_id").notNull(),
    workflow_id: text("workflow_id").notNull(),
    agent_type: text("agent_type").notNull(), // "dev-orchestrator", "researcher", "coder", etc.
    agent_instance_id: text("agent_instance_id").notNull(), // Unique per agent invocation
    parent_agent_instance_id: text("parent_agent_instance_id"), // null for orchestrator, set for sub-agents
    step_number: integer("step_number").notNull(),

    type: text("type")
      .$type<"tool_call" | "tool_result" | "llm_response" | "agent_spawn" | "agent_complete">()
      .notNull(),
    tool_name: text("tool_name"), // null for LLM responses
    input: jsonb("input"), // Tool params or spawn context
    output: jsonb("output"), // Tool result or agent result

    // Cost tracking (TRAC-03)
    token_count_input: integer("token_count_input"),
    token_count_output: integer("token_count_output"),
    duration_ms: integer("duration_ms"),

    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("execution_traces_task_idx").on(table.task_id),
    index("execution_traces_instance_idx").on(table.agent_instance_id),
    index("execution_traces_parent_idx").on(table.parent_agent_instance_id),
    index("execution_traces_workflow_idx").on(table.workflow_id),
  ],
);
```

### Context Manager Service (CTXM-03, CTXM-04, CTXM-05)
```typescript
interface ContextManager {
  writeSnapshot(params: WriteSnapshotParams): Promise<string>; // returns snapshot ID
  readLatestSnapshot(taskId: string, workflowId: string): Promise<ContextSnapshot | null>;
  readLatestSnapshotForStage(taskId: string, stage: string): Promise<ContextSnapshot | null>;
  health(): Promise<{ healthy: boolean; latencyMs: number }>;
  close(): Promise<void>;
}

interface WriteSnapshotParams {
  taskId: string;
  workflowId: string;
  agentType: string;
  stage: string;
  summary: string;
  completedActions?: string[];
  pendingIntent?: string;
  knownIssues?: string[];
  projectContext?: Record<string, unknown>;
  keyFiles?: string[];
  researchFindings?: unknown;
  plan?: unknown;
  toolCallCount: number;
  tokenCount: { input: number; output: number };
}
```

### Trace Recorder Callbacks (TRAC-02, TRAC-05)
```typescript
// Usage in a Temporal activity:
const traceRecorder = createTraceRecorder({
  db,
  logger,
  taskId: "AES-42",
  workflowId: "dev-agent-AES-42",
  agentType: "dev-orchestrator",
  agentInstanceId: `orch_${nanoid()}`,
});

const result = await runAgentLoop({
  systemPrompt: "...",
  tools: [...],
  initialMessage: "...",
  onToolCall: traceRecorder.onToolCall,
  onResponse: traceRecorder.onResponse,
});

// Flush buffered trace steps to DB
await traceRecorder.flush();
```

### Task Store Service (CTXM-02)
```typescript
interface TaskStore {
  createTask(params: CreateTaskParams): Promise<string>; // returns task ID
  updateTask(taskId: string, updates: Partial<TaskUpdate>): Promise<void>;
  getTask(taskId: string): Promise<AgentTask | null>;
  health(): Promise<{ healthy: boolean; latencyMs: number }>;
  close(): Promise<void>;
}
```

### Hand-Written Migration SQL (CTXM-07)
```sql
-- Initial agents schema migration
-- Creates agents.* PostgreSQL schema namespace for agent-specific data.

CREATE SCHEMA IF NOT EXISTS "agents";
--> statement-breakpoint

-- Context snapshots table
CREATE TABLE IF NOT EXISTS "agents"."context_snapshots" (
  "id" text PRIMARY KEY NOT NULL,
  "task_id" text NOT NULL,
  "workflow_id" text NOT NULL,
  "agent_type" text NOT NULL,
  "stage" text NOT NULL,
  "summary" text NOT NULL,
  "completed_actions" jsonb DEFAULT '[]',
  "pending_intent" text,
  "known_issues" jsonb DEFAULT '[]',
  "project_context" jsonb DEFAULT '{}',
  "key_files" jsonb DEFAULT '[]',
  "research_findings" jsonb,
  "plan" jsonb,
  "tool_call_count" integer NOT NULL DEFAULT 0,
  "token_count" jsonb DEFAULT '{"input":0,"output":0}',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "context_snapshots_task_idx" ON "agents"."context_snapshots" ("task_id");
--> statement-breakpoint
CREATE INDEX "context_snapshots_workflow_idx" ON "agents"."context_snapshots" ("workflow_id");
--> statement-breakpoint

-- Tasks table
CREATE TABLE IF NOT EXISTS "agents"."tasks" (
  "id" text PRIMARY KEY NOT NULL,
  "task_id" text NOT NULL UNIQUE,
  "issue_id" text,
  "issue_identifier" text,
  "agent_type" text NOT NULL,
  "workflow_id" text,
  "status" text NOT NULL DEFAULT 'pending',
  "container_id" text,
  "branch_name" text,
  "pr_number" integer,
  "pr_url" text,
  "approval_status" text DEFAULT 'pending',
  "approval_feedback" text,
  "error" text,
  "escalation_reason" text,
  "slack_channel" text,
  "slack_message_ts" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "tasks_workflow_idx" ON "agents"."tasks" ("workflow_id");
--> statement-breakpoint
CREATE INDEX "tasks_status_idx" ON "agents"."tasks" ("status");
--> statement-breakpoint

-- Execution traces table
CREATE TABLE IF NOT EXISTS "agents"."execution_traces" (
  "id" text PRIMARY KEY NOT NULL,
  "task_id" text NOT NULL,
  "workflow_id" text NOT NULL,
  "agent_type" text NOT NULL,
  "agent_instance_id" text NOT NULL,
  "parent_agent_instance_id" text,
  "step_number" integer NOT NULL,
  "type" text NOT NULL,
  "tool_name" text,
  "input" jsonb,
  "output" jsonb,
  "token_count_input" integer,
  "token_count_output" integer,
  "duration_ms" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "execution_traces_task_idx" ON "agents"."execution_traces" ("task_id");
--> statement-breakpoint
CREATE INDEX "execution_traces_instance_idx" ON "agents"."execution_traces" ("agent_instance_id");
--> statement-breakpoint
CREATE INDEX "execution_traces_parent_idx" ON "agents"."execution_traces" ("parent_agent_instance_id");
--> statement-breakpoint
CREATE INDEX "execution_traces_workflow_idx" ON "agents"."execution_traces" ("workflow_id");
--> statement-breakpoint

-- Updated_at trigger function for agents schema
CREATE OR REPLACE FUNCTION agents.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- Triggers for updated_at columns
DROP TRIGGER IF EXISTS update_context_snapshots_updated_at ON agents.context_snapshots;
--> statement-breakpoint
CREATE TRIGGER update_context_snapshots_updated_at
  BEFORE UPDATE ON agents.context_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION agents.update_updated_at_column();
--> statement-breakpoint

DROP TRIGGER IF EXISTS update_tasks_updated_at ON agents.tasks;
--> statement-breakpoint
CREATE TRIGGER update_tasks_updated_at
  BEFORE UPDATE ON agents.tasks
  FOR EACH ROW
  EXECUTE FUNCTION agents.update_updated_at_column();
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| LangGraph `PostgresSaver` checkpoints | Semantic context snapshots (this phase) | v2.2 decision | LLM-generated summaries replace serialized graph state |
| LangGraph callback handler for tracing | Custom `onToolCall`/`onResponse` callbacks to DB | v2.2 decision (Phase 28 provides hooks, Phase 29 connects them) | Per-step trace with parent/child correlation |
| `DevAgentState` Zod schema (16 fields) | `agents.tasks` table + `agents.context_snapshots` | v2.2 decision | Structured data in typed columns, semantic data in JSONB |

**Key architectural shift:** LangGraph persisted full graph state at every node transition (including the entire conversation history in the checkpoint). Phase 29 persists only semantic summaries and critical structured data. The conversation history lives in-memory during the `runAgentLoop()` call and is discarded after the activity completes. Only the LLM-generated summary survives across activity boundaries.

## Open Questions

1. **Trace write buffering strategy**
   - What we know: `onToolCall`/`onResponse` callbacks must not block the loop. Buffering in memory is the right approach.
   - What's unclear: Should we flush every N steps, at the end of the loop, or at the end of the Temporal activity? Flushing at end-of-loop is simplest but risks data loss if the activity crashes mid-loop.
   - Recommendation: Flush at the end of `runAgentLoop()` (via a new `onComplete` callback or by having the caller invoke `flush()`). If the activity crashes, Temporal retries from the beginning anyway -- trace data from the failed attempt is less critical. For v2.2, end-of-loop flush is sufficient.

2. **Large JSONB payloads in execution_traces.input/output**
   - What we know: Tool inputs/outputs can be large (file contents from `read_file`, codebase search results). Storing all of this in JSONB could cause storage bloat.
   - What's unclear: Should we truncate large payloads or store them as-is?
   - Recommendation: Truncate `input` and `output` JSONB to 10KB each during trace recording. Full payloads are not needed for debugging -- a truncated preview with a `[truncated]` marker is sufficient. Implement truncation in the trace recorder, not the schema.

3. **Context self-summarization prompt design**
   - What we know: CTXM-03 requires an LLM self-summarization call at the end of each activity. This is a single `runAgentLoop()` call (or direct `messages.create()`) with a prompt like "Summarize your work so far for the next agent who will continue."
   - What's unclear: The exact prompt wording and whether it should be a separate `messages.create()` call or appended to the agent's final loop iteration.
   - Recommendation: Use a separate `messages.create()` call with the conversation history and a specific "write a handoff summary" prompt. This is simpler than modifying the agent loop and produces a clean, focused summary. Defer prompt design to the planning phase.

4. **Sub-agent context briefing format (CTXM-05)**
   - What we know: The orchestrator produces focused briefs for sub-agents (researcher, coder, tester). This is done by the orchestrator's system prompt instructing it how to construct the brief.
   - What's unclear: Whether CTXM-05 needs a database table or is purely in-memory (the orchestrator constructs the brief as a string for `runAgentLoop().context`).
   - Recommendation: CTXM-05 is in-memory only. The orchestrator constructs the brief string from its own context and passes it as the `context` option to `runAgentLoop()`. No database storage needed for sub-agent briefs -- they're ephemeral. The Phase 30/31 planning will define the brief construction logic.

## Sources

### Primary (HIGH confidence)
- Existing codebase analysis -- all schema patterns, migration patterns, service patterns, and Drizzle ORM usage verified by reading actual source files:
  - `packages/platform/src/db/schema.ts` -- pgSchema pattern, text IDs, JSONB, timestamps
  - `packages/platform/src/db/schema.drizzle.ts` -- dual schema file pattern
  - `packages/platform/src/db/client.ts` -- database client factory pattern
  - `packages/platform/drizzle.config.ts` -- Drizzle Kit configuration
  - `packages/observability/src/db/schema.ts` -- observability schema pattern
  - `packages/observability/src/services/execution-tracker.ts` -- service factory pattern
  - `packages/integrations/linear/src/db/schema.ts` -- integration schema pattern with MCP permissions
  - `packages/integrations/linear/src/db/migrations/0000_create_linear_schema.sql` -- hand-written migration pattern
  - `packages/types/src/utils/ids.ts` -- createId pattern with nanoid
  - `packages/agents/src/shared/agent-loop/types.ts` -- TraceStep, onToolCall, onResponse callback types
  - `packages/agents/src/shared/agent-loop/run-agent-loop.ts` -- loop implementation with callback hooks
  - `packages/agents/package.json` -- existing dependencies (drizzle-orm ^0.45.1 already present)

### Secondary (MEDIUM confidence)
- [Drizzle ORM PostgreSQL Column Types](https://orm.drizzle.team/docs/column-types/pg) -- JSONB, text, integer, timestamp column APIs
- [Drizzle ORM Schema Declaration](https://orm.drizzle.team/docs/sql-schema-declaration) -- pgSchema, index, table patterns
- v2.2 spec (`2.2-spec.md`) -- context_snapshots, tasks, execution_traces table designs

### Tertiary (LOW confidence)
- Trace write buffering strategy -- recommendation based on engineering judgment, not verified with real-world benchmarks

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- drizzle-orm already in agents deps, all patterns verified from existing code
- Architecture: HIGH -- follows exact patterns from 5+ existing packages in the codebase
- Schema design: HIGH -- derived from v2.2 spec table designs, adapted to codebase conventions (text IDs vs UUID)
- Service layer: HIGH -- follows execution-tracker.ts factory pattern exactly
- Trace recorder integration: MEDIUM -- callback approach is sound (Phase 28 provides the hooks) but buffering/flushing strategy needs validation during implementation
- Context self-summarization: MEDIUM -- the LLM summarization step is well-understood conceptually but prompt design is deferred

**Research date:** 2026-01-29
**Valid until:** 2026-02-28 (30 days -- Drizzle ORM is stable, schema patterns don't change)
