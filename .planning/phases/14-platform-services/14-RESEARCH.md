# Phase 14: Platform Services - Research

**Researched:** 2026-01-21
**Domain:** Service architecture, webhook idempotency, execution tracking, data cleanup
**Confidence:** HIGH

## Summary

Research focused on four critical domains for implementing platform services: dependency injection patterns (factory functions vs containers), webhook idempotency (PostgreSQL-based deduplication), execution tracking (observability schema), LangGraph checkpoint cleanup (custom SQL-based retention), and layer boundary enforcement (Biome + TypeScript project references).

**Key findings:**
- **Factory functions are the recommended DI pattern** for this project size: simple, testable, explicit dependencies without decorator magic or container complexity
- **Webhook idempotency via PostgreSQL `ON CONFLICT DO NOTHING`** is the standard pattern, using provider-specific delivery IDs (Linear-Delivery, X-GitHub-Delivery, Slack event_id)
- **LangGraph checkpoint cleanup requires custom SQL** - the OSS package has no built-in TTL/cleanup, but provides DELETE SQL statements for each table
- **Biome v2.2+ `noRestrictedImports` with patterns** enables layer boundary enforcement with clearer error messages than TypeScript project references alone

**Primary recommendation:** Use simple factory functions with options objects, PostgreSQL table for webhook deduplication with `INSERT ... ON CONFLICT DO NOTHING`, custom cleanup service using batch DELETE operations, and Biome import restrictions for layer enforcement.

## Standard Stack

The established patterns for Node.js service architecture in 2025-2026:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Drizzle ORM | 0.36+ | Database operations | Already in project, excellent for typed SQL operations |
| node-cron | 3.x | Scheduled jobs | Simple, reliable cron scheduler for Node.js |
| pino | 10.x | Structured logging | Already in project via @aesir/common |
| nanoid | 5.x | ID generation | Already in project via @aesir/common |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Temporal | 1.x | Scheduled workflows | Alternative to node-cron for durable scheduled jobs |
| minimist | 1.x | CLI argument parsing | Lightweight, built-in alternative to commander |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Factory functions | tsyringe/inversify | Decorators add complexity, reflection metadata required, overkill for project size |
| node-cron | Temporal scheduled workflows | Temporal is heavier but provides durability, already in project - Claude's discretion |
| PostgreSQL dedup | Redis TTL | Redis faster but adds infrastructure, PG sufficient for current scale |

**Installation:**
```bash
# Already available in project - no new dependencies needed
```

## Architecture Patterns

### Recommended Project Structure
```
packages/
├── platform/
│   └── src/
│       ├── services/
│       │   ├── webhook-idempotency.ts   # Webhook deduplication service
│       │   ├── execution-tracker.ts     # Agent execution recording
│       │   ├── cleanup.ts               # Retention cleanup service
│       │   └── health.ts                # Health check aggregator
│       └── db/
│           └── schema.ts                # Platform schema (workspaces, etc.)
├── observability/
│   └── src/
│       └── db/
│           └── schema.ts                # agent_executions table
├── integrations/
│   └── src/
│       └── db/
│           └── schema.ts                # webhook_deliveries, sync_cursors
└── agents/
    └── src/
        └── api/
            └── webhooks/                # Webhook handlers (consume services)
```

### Pattern 1: Factory Function with Options Object
**What:** Service creation via factory function accepting named options
**When to use:** All services requiring external dependencies (db, logger, config)
**Example:**
```typescript
// Source: Project decision in CONTEXT.md + DI best practices
import type { PinoLogger } from "@aesir/common";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

interface WebhookIdempotencyOptions {
  db: PostgresJsDatabase;
  logger: PinoLogger;
  ttlMs?: number; // Default: 1 hour
}

interface WebhookIdempotencyService {
  checkAndRecord(source: string, deliveryId: string): Promise<{ isDuplicate: boolean }>;
  health(): Promise<{ healthy: boolean; latencyMs: number }>;
  close(): Promise<void>;
}

export function createWebhookIdempotencyService(
  options: WebhookIdempotencyOptions
): WebhookIdempotencyService {
  const { db, logger, ttlMs = 60 * 60 * 1000 } = options;

  if (!db) throw new Error("db is required");
  if (!logger) throw new Error("logger is required");

  return {
    async checkAndRecord(source: string, deliveryId: string) {
      // Implementation
    },
    async health() {
      const start = Date.now();
      // Check db connectivity
      return { healthy: true, latencyMs: Date.now() - start };
    },
    async close() {
      // Cleanup if needed
    },
  };
}
```

### Pattern 2: Webhook Idempotency with ON CONFLICT DO NOTHING
**What:** Atomic insert-or-skip for duplicate detection
**When to use:** All webhook endpoints receiving delivery IDs
**Example:**
```typescript
// Source: PostgreSQL ON CONFLICT pattern + CONTEXT.md decisions
import { webhookDeliveries } from "./schema.js";
import { and, eq, sql } from "drizzle-orm";

async function checkAndRecord(
  source: string,
  deliveryId: string
): Promise<{ isDuplicate: boolean }> {
  const result = await db.insert(webhookDeliveries).values({
    provider: source,
    delivery_id: deliveryId,
    event_type: 'unknown', // Will be updated after processing
    created_at: new Date(),
  }).onConflictDoNothing({
    target: [webhookDeliveries.provider, webhookDeliveries.delivery_id],
  }).returning({ id: webhookDeliveries.id });

  // If no row returned, insert was skipped (duplicate)
  const isDuplicate = result.length === 0;

  if (isDuplicate) {
    logger.debug({ source, deliveryId }, "Duplicate webhook delivery");
  }

  return { isDuplicate };
}
```

### Pattern 3: Execution Tracking via Observability Schema
**What:** Record agent execution start/end with status
**When to use:** Webhook handlers that dispatch agent work
**Example:**
```typescript
// Source: CONTEXT.md execution tracking decisions
import { agentExecutions } from "@aesir/observability/db/schema";

export interface ExecutionTrackerOptions {
  db: PostgresJsDatabase;
  logger: PinoLogger;
}

export interface ExecutionTracker {
  start(params: {
    agentType: string;
    issueId: string;
    workspaceId: string;
  }): Promise<string>; // Returns execution ID

  complete(executionId: string): Promise<void>;

  fail(executionId: string, lastKnownState: string): Promise<void>;

  health(): Promise<{ healthy: boolean }>;
  close(): Promise<void>;
}

export function createExecutionTracker(
  options: ExecutionTrackerOptions
): ExecutionTracker {
  const { db, logger } = options;

  return {
    async start({ agentType, issueId, workspaceId }) {
      const id = createId.execution();
      await db.insert(agentExecutions).values({
        id,
        agent_type: agentType,
        issue_id: issueId,
        workspace_id: workspaceId,
        status: 'started',
        started_at: new Date(),
      });
      logger.info({ executionId: id, agentType, issueId }, "Execution started");
      return id;
    },

    async complete(executionId) {
      const endedAt = new Date();
      const [row] = await db.select({ startedAt: agentExecutions.started_at })
        .from(agentExecutions)
        .where(eq(agentExecutions.id, executionId));

      const durationMs = row ? endedAt.getTime() - row.startedAt.getTime() : null;

      await db.update(agentExecutions)
        .set({
          status: 'completed',
          ended_at: endedAt,
          duration_ms: durationMs,
        })
        .where(eq(agentExecutions.id, executionId));

      logger.info({ executionId, durationMs }, "Execution completed");
    },

    async fail(executionId, lastKnownState) {
      const endedAt = new Date();
      const [row] = await db.select({ startedAt: agentExecutions.started_at })
        .from(agentExecutions)
        .where(eq(agentExecutions.id, executionId));

      const durationMs = row ? endedAt.getTime() - row.startedAt.getTime() : null;

      await db.update(agentExecutions)
        .set({
          status: 'failed',
          ended_at: endedAt,
          duration_ms: durationMs,
          last_known_state: lastKnownState,
        })
        .where(eq(agentExecutions.id, executionId));

      logger.error({ executionId, lastKnownState, durationMs }, "Execution failed");
    },

    async health() { return { healthy: true }; },
    async close() {},
  };
}
```

### Pattern 4: Batch Deletion for Cleanup
**What:** Delete old records in batches to avoid long transactions
**When to use:** Retention cleanup jobs
**Example:**
```typescript
// Source: CONTEXT.md cleanup decisions + best practices
interface CleanupResult {
  deletedCount: number;
  deletedIds: string[];
}

async function cleanupOldRecords(
  table: typeof webhookDeliveries,
  timestampColumn: 'created_at',
  retentionDays: number,
  batchSize: number = 1000
): Promise<CleanupResult> {
  const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  let totalDeleted = 0;
  const allDeletedIds: string[] = [];

  while (true) {
    // Select batch of IDs to delete
    const toDelete = await db.select({ id: table.id })
      .from(table)
      .where(lt(table[timestampColumn], cutoffDate))
      .limit(batchSize);

    if (toDelete.length === 0) break;

    const ids = toDelete.map(r => r.id);

    // Delete batch
    await db.delete(table)
      .where(inArray(table.id, ids));

    // Log each deleted ID for audit trail
    for (const id of ids) {
      logger.info({ id, table: table._.name }, "Record deleted by cleanup");
    }

    totalDeleted += ids.length;
    allDeletedIds.push(...ids);

    // If we got less than batch size, we're done
    if (toDelete.length < batchSize) break;
  }

  return { deletedCount: totalDeleted, deletedIds: allDeletedIds };
}
```

### Pattern 5: LangGraph Checkpoint Cleanup
**What:** Delete old LangGraph checkpoints using native DELETE SQL
**When to use:** Scheduled cleanup service
**Example:**
```typescript
// Source: @langchain/langgraph-checkpoint-postgres SQL statements
import { getSQLStatements, getTablesWithSchema } from "@langchain/langgraph-checkpoint-postgres/dist/sql.js";

interface CheckpointCleanupOptions {
  db: Pool; // Raw pg Pool for direct SQL
  logger: PinoLogger;
  schema: string; // e.g., 'langgraph' or 'public'
  retentionDays: number;
  batchSize: number;
  protectInProgress: boolean; // Skip threads with active executions
}

async function cleanupCheckpoints(options: CheckpointCleanupOptions): Promise<{
  deletedThreads: number;
  deletedCheckpoints: number;
  deletedBlobs: number;
  deletedWrites: number;
}> {
  const { db, logger, schema, retentionDays, batchSize, protectInProgress } = options;
  const tables = getTablesWithSchema(schema);
  const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  // LangGraph checkpoint tables don't have timestamps by default
  // We need to join with agent_executions to find old threads
  // Or add a custom timestamp tracking approach

  // Approach: Find thread_ids from completed executions older than retention
  const oldThreadsQuery = `
    SELECT DISTINCT thread_id
    FROM ${tables.checkpoints}
    WHERE thread_id IN (
      SELECT CONCAT('approval-', issue_id)
      FROM observability.agent_executions
      WHERE status IN ('completed', 'failed')
      AND ended_at < $1
    )
    ${protectInProgress ? `
      AND thread_id NOT IN (
        SELECT CONCAT('approval-', issue_id)
        FROM observability.agent_executions
        WHERE status = 'started'
      )
    ` : ''}
    LIMIT $2
  `;

  const result = await db.query(oldThreadsQuery, [cutoffDate, batchSize]);
  const threadIds = result.rows.map(r => r.thread_id);

  let deletedCheckpoints = 0;
  let deletedBlobs = 0;
  let deletedWrites = 0;

  for (const threadId of threadIds) {
    // Delete in order: writes -> blobs -> checkpoints (no FK constraints, but logical order)
    const writes = await db.query(
      `DELETE FROM ${tables.checkpoint_writes} WHERE thread_id = $1`,
      [threadId]
    );
    deletedWrites += writes.rowCount ?? 0;

    const blobs = await db.query(
      `DELETE FROM ${tables.checkpoint_blobs} WHERE thread_id = $1`,
      [threadId]
    );
    deletedBlobs += blobs.rowCount ?? 0;

    const checkpoints = await db.query(
      `DELETE FROM ${tables.checkpoints} WHERE thread_id = $1`,
      [threadId]
    );
    deletedCheckpoints += checkpoints.rowCount ?? 0;

    logger.info({ threadId }, "Cleaned up checkpoint data for thread");
  }

  return {
    deletedThreads: threadIds.length,
    deletedCheckpoints,
    deletedBlobs,
    deletedWrites,
  };
}
```

### Pattern 6: Layer Boundary Enforcement via Biome
**What:** Biome noRestrictedImports rule to prevent illegal layer imports
**When to use:** biome.json configuration
**Example:**
```json
// Source: https://biomejs.dev/linter/rules/no-restricted-imports/
{
  "linter": {
    "rules": {
      "style": {
        "noRestrictedImports": {
          "level": "error",
          "options": {
            "paths": {},
            "patterns": [
              {
                "group": ["@aesir/agents", "@aesir/agents/*"],
                "message": "Platform layer cannot import from agents layer (Agents -> Integrations -> Platform)"
              }
            ]
          }
        }
      }
    }
  },
  "overrides": [
    {
      "includes": ["packages/platform/**"],
      "linter": {
        "rules": {
          "style": {
            "noRestrictedImports": {
              "level": "error",
              "options": {
                "patterns": [
                  {
                    "group": ["@aesir/agents", "@aesir/agents/*"],
                    "message": "Platform cannot import from agents"
                  },
                  {
                    "group": ["@aesir/integrations", "@aesir/integrations/*"],
                    "message": "Platform cannot import from integrations"
                  }
                ]
              }
            }
          }
        }
      }
    },
    {
      "includes": ["packages/integrations/**"],
      "linter": {
        "rules": {
          "style": {
            "noRestrictedImports": {
              "level": "error",
              "options": {
                "patterns": [
                  {
                    "group": ["@aesir/agents", "@aesir/agents/*"],
                    "message": "Integrations cannot import from agents"
                  }
                ]
              }
            }
          }
        }
      }
    }
  ]
}
```

### Pattern 7: Service Health Aggregation
**What:** Combine health checks from multiple services
**When to use:** /health endpoint implementation
**Example:**
```typescript
// Source: Best practices for health endpoints
interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  services: Record<string, {
    healthy: boolean;
    latencyMs?: number;
    error?: string;
  }>;
  timestamp: string;
}

export function createHealthAggregator(services: {
  name: string;
  check: () => Promise<{ healthy: boolean; latencyMs?: number }>;
}[]): () => Promise<HealthStatus> {
  return async () => {
    const results: HealthStatus['services'] = {};

    for (const service of services) {
      try {
        const result = await service.check();
        results[service.name] = result;
      } catch (error) {
        results[service.name] = {
          healthy: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    const allHealthy = Object.values(results).every(r => r.healthy);
    const anyHealthy = Object.values(results).some(r => r.healthy);

    return {
      status: allHealthy ? 'healthy' : anyHealthy ? 'degraded' : 'unhealthy',
      services: results,
      timestamp: new Date().toISOString(),
    };
  };
}
```

### Anti-Patterns to Avoid
- **Global singleton services:** Don't export `const service = createService()` at module level. Services should be created in main.ts with explicit dependencies.
- **Decorator-based DI:** Avoid tsyringe/inversify decorators for this project size. They add reflection complexity without sufficient benefit.
- **Implicit environment access:** Don't read `process.env` inside services. Pass config as dependency.
- **Synchronous health checks:** Always use async health checks, even if current implementation is sync.
- **Mixed batching and individual deletes:** Pick one deletion strategy per table. Batch deletes are more efficient.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Scheduled jobs | Custom setTimeout loops | node-cron or Temporal scheduled workflows | Proper cron syntax, missed execution handling, timezone support |
| Webhook signature verification | Custom HMAC | Provider-specific functions already in project | Each provider (Linear, GitHub, Slack) has unique signature format |
| Checkpoint table deletion | Custom table introspection | @langchain/langgraph-checkpoint-postgres SQL exports | Package exports exact table names and DELETE statements |
| Import boundary enforcement | Custom TypeScript plugin | Biome noRestrictedImports | Existing tool, clearer error messages, faster feedback |
| Idempotency key generation | Custom hashing | Use provider's delivery ID | Linear-Delivery, X-GitHub-Delivery, event_id are designed for this |

**Key insight:** Webhook idempotency deduplication is about using what providers already give you. Don't hash payloads when providers include unique delivery IDs.

## Common Pitfalls

### Pitfall 1: Checking Idempotency After Processing
**What goes wrong:** Duplicate side effects (double notifications, duplicate database records)
**Why it happens:** Idempotency check placed after business logic instead of before
**How to avoid:** Check idempotency as FIRST step after signature verification, before any processing
**Warning signs:** Duplicate Slack messages, duplicate workflow starts, duplicate database entries

### Pitfall 2: Concurrent Duplicate Webhooks
**What goes wrong:** Two identical webhooks arrive within milliseconds, both pass idempotency check
**Why it happens:** SELECT-then-INSERT is not atomic, race condition window
**How to avoid:** Use `INSERT ... ON CONFLICT DO NOTHING` with check on `rowCount` - it's atomic
**Warning signs:** Occasional duplicates despite idempotency table, especially under load

### Pitfall 3: Services Created Inside Request Handlers
**What goes wrong:** Connection pool exhaustion, memory leaks, inconsistent state
**Why it happens:** Creating new service instances per request instead of at startup
**How to avoid:** Create services once in main.ts, pass to handlers as dependencies
**Warning signs:** "too many clients" database errors, memory growth over time

### Pitfall 4: Cleanup Deleting In-Progress Executions
**What goes wrong:** Active agent work loses its checkpoint state
**Why it happens:** Cleanup job uses time-based deletion without checking execution status
**How to avoid:** WHERE clause excludes records linked to 'started' status executions
**Warning signs:** Agents failing mid-run with missing checkpoint errors

### Pitfall 5: Blocking Cleanup in Long Transaction
**What goes wrong:** Table locks held too long, other queries blocked
**Why it happens:** DELETE of many rows in single transaction
**How to avoid:** Batch deletes (1000 records at a time), commit between batches
**Warning signs:** Slow query logs, connection timeouts during cleanup window

### Pitfall 6: Hardcoded Webhook Delivery ID Headers
**What goes wrong:** Idempotency fails when provider changes header format
**Why it happens:** Magic strings like 'X-GitHub-Delivery' scattered throughout code
**How to avoid:** Define header names per provider in configuration, single source of truth
**Warning signs:** New provider requires code changes in multiple files

### Pitfall 7: Forgetting Biome Override Scope
**What goes wrong:** Layer restrictions not enforced, or restrictions break everything
**Why it happens:** noRestrictedImports in root applies to all packages including tests
**How to avoid:** Use `overrides` with `includes` to scope restrictions to specific packages
**Warning signs:** Lint errors in test files, restrictions not catching actual violations

## Code Examples

Verified patterns from official sources and project context:

### Example 1: Webhook Delivery ID Headers by Provider
```typescript
// Source: Linear API docs, GitHub docs, Slack Events API docs
export const WEBHOOK_DELIVERY_HEADERS = {
  linear: 'Linear-Delivery',     // UUID per delivery
  github: 'X-GitHub-Delivery',   // UUID per delivery (same on retry redelivery)
  slack: null,                   // Use event_id from payload body
} as const;

export const WEBHOOK_SIGNATURE_HEADERS = {
  linear: 'Linear-Signature',
  github: 'X-Hub-Signature-256',
  slack: 'X-Slack-Signature',
} as const;

// Slack requires special handling - event_id is in the JSON body
export function getSlackEventId(payload: { event_id?: string }): string | null {
  return payload.event_id ?? null;
}
```

### Example 2: Agent Executions Schema (Observability)
```typescript
// Source: CONTEXT.md execution tracking decisions
import { createId } from "@aesir/common";
import { pgSchema, text, timestamp, integer, index } from "drizzle-orm/pg-core";

export const observabilitySchema = pgSchema("observability");

export const agentExecutions = observabilitySchema.table(
  "agent_executions",
  {
    id: text("id").primaryKey().$defaultFn(() => createId.execution()),
    workspace_id: text("workspace_id").notNull(),
    agent_type: text("agent_type").notNull(), // 'dev-agent', 'product-agent'
    issue_id: text("issue_id").notNull(),     // Linear issue ID (string, not FK)
    status: text("status", {
      enum: ['started', 'completed', 'failed']
    }).notNull(),
    started_at: timestamp("started_at", { withTimezone: true }).notNull(),
    ended_at: timestamp("ended_at", { withTimezone: true }),
    duration_ms: integer("duration_ms"),
    last_known_state: text("last_known_state"), // Captured on failure
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    // Index for querying recent failures
    index("agent_executions_status_started_idx")
      .on(table.status, table.started_at),
    // Index for workspace filtering
    index("agent_executions_workspace_idx")
      .on(table.workspace_id),
  ]
);

export type AgentExecution = typeof agentExecutions.$inferSelect;
export type NewAgentExecution = typeof agentExecutions.$inferInsert;
```

### Example 3: Cleanup Service with Dry-Run Mode
```typescript
// Source: CONTEXT.md cleanup decisions
interface CleanupServiceOptions {
  db: PostgresJsDatabase;
  pool: Pool; // For raw SQL (LangGraph tables)
  logger: PinoLogger;
  retentionDays: number;
  batchSize: number;
  langGraphSchema: string;
}

interface CleanupService {
  run(options: { dryRun: boolean }): Promise<CleanupReport>;
  health(): Promise<{ healthy: boolean }>;
  close(): Promise<void>;
}

interface CleanupReport {
  webhookDeliveries: { deleted: number; scanned: number };
  agentExecutions: { deleted: number; scanned: number; skipped: number };
  checkpoints: { threads: number; checkpoints: number; blobs: number; writes: number };
  dryRun: boolean;
  durationMs: number;
}

export function createCleanupService(options: CleanupServiceOptions): CleanupService {
  const { db, pool, logger, retentionDays, batchSize, langGraphSchema } = options;

  return {
    async run({ dryRun }) {
      const start = Date.now();
      logger.info({ dryRun, retentionDays, batchSize }, "Starting cleanup run");

      const report: CleanupReport = {
        webhookDeliveries: { deleted: 0, scanned: 0 },
        agentExecutions: { deleted: 0, scanned: 0, skipped: 0 },
        checkpoints: { threads: 0, checkpoints: 0, blobs: 0, writes: 0 },
        dryRun,
        durationMs: 0,
      };

      // Implementation would call cleanup functions for each table
      // If dryRun, SELECT counts instead of DELETE

      report.durationMs = Date.now() - start;
      logger.info({ report }, "Cleanup run completed");
      return report;
    },

    async health() {
      return { healthy: true };
    },

    async close() {},
  };
}
```

### Example 4: Service Wiring in main.ts
```typescript
// Source: CONTEXT.md DI patterns - service wiring in app's main.ts
import { config, createPinoLogger } from "@aesir/common";
import { createPool } from "./db/pool.js";
import { createWebhookIdempotencyService } from "./services/webhook-idempotency.js";
import { createExecutionTracker } from "./services/execution-tracker.js";
import { createCleanupService } from "./services/cleanup.js";
import { createHealthAggregator } from "./services/health.js";

async function main() {
  const logger = createPinoLogger({ component: "app:main" });

  // Create shared database pool
  const pool = createPool(config.database);
  const db = drizzle(pool);

  // Create services at startup (eager, not lazy)
  const webhookIdempotency = createWebhookIdempotencyService({
    db,
    logger: logger.child({ service: "webhook-idempotency" }),
    ttlMs: 60 * 60 * 1000, // 1 hour
  });

  const executionTracker = createExecutionTracker({
    db,
    logger: logger.child({ service: "execution-tracker" }),
  });

  const cleanup = createCleanupService({
    db,
    pool,
    logger: logger.child({ service: "cleanup" }),
    retentionDays: config.retention?.days ?? 14,
    batchSize: 1000,
    langGraphSchema: 'langgraph',
  });

  // Aggregate health checks
  const getHealth = createHealthAggregator([
    { name: 'database', check: () => db.execute(sql`SELECT 1`).then(() => ({ healthy: true })) },
    { name: 'webhook-idempotency', check: () => webhookIdempotency.health() },
    { name: 'execution-tracker', check: () => executionTracker.health() },
  ]);

  // Graceful shutdown
  const shutdown = async () => {
    logger.info("Shutting down...");
    await webhookIdempotency.close();
    await executionTracker.close();
    await cleanup.close();
    await pool.end();
    logger.info("Shutdown complete");
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Pass services to HTTP handlers, scheduled jobs, etc.
  // ...
}

main().catch(console.error);
```

### Example 5: TypeScript Project References for Layer Enforcement
```json
// packages/platform/tsconfig.json
// Source: TypeScript project references docs
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "composite": true
  },
  "include": ["src/**/*"],
  "references": [
    { "path": "../common" }
    // NO reference to integrations or agents - enforces layer boundary
  ]
}
```

```json
// packages/integrations/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "composite": true
  },
  "include": ["src/**/*"],
  "references": [
    { "path": "../common" },
    { "path": "../platform" }
    // NO reference to agents
  ]
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Constructor injection with new | Factory functions with options object | 2023-2024 | Simpler, no class syntax required, better tree-shaking |
| Decorator-based DI (inversify) | Plain factory functions | 2024-2025 | No reflect-metadata, works without TypeScript decorators proposal |
| Global singleton services | Explicit dependency passing | 2024-2025 | Better testability, clearer dependencies, no hidden state |
| Redis for webhook dedup | PostgreSQL ON CONFLICT | Always valid | Reduces infrastructure, PG sufficient for webhook-scale traffic |
| Custom cron implementations | node-cron or Temporal | 2023-2024 | Battle-tested scheduling, proper edge case handling |
| ESLint no-restricted-imports | Biome noRestrictedImports | 2024-2025 | Faster, integrated formatter, patterns support in v2.2+ |

**Deprecated/outdated:**
- **tsyringe decorators**: Still works but adds complexity for small-medium projects
- **Manual setTimeout scheduling**: Doesn't handle missed executions, no cron syntax
- **File-based idempotency tracking**: Doesn't scale, no atomic operations

## Open Questions

Things that couldn't be fully resolved:

1. **Scheduled Cleanup Mechanism**
   - What we know: Both node-cron and Temporal scheduled workflows work
   - What's unclear: Which fits better with existing Temporal usage
   - Recommendation: Claude's discretion - Temporal if already using for other scheduled work, node-cron if simpler is preferred

2. **Slack Event Idempotency Edge Cases**
   - What we know: Slack uses event_id in payload body, not a header
   - What's unclear: Edge cases where multiple events have same event_ts but different event_ids
   - Recommendation: Use event_id as primary, consider fallback to event_ts+channel composite for message events

3. **Service Shape: Classes vs Plain Objects**
   - What we know: Both work, plain objects are lighter
   - What's unclear: Whether class syntax helps with extending/composing services later
   - Recommendation: Claude's discretion per CONTEXT.md - plain objects unless abstraction benefits emerge

4. **LangGraph Checkpoint Timestamps**
   - What we know: LangGraph tables don't have created_at timestamps
   - What's unclear: Best way to correlate checkpoints with execution age
   - Recommendation: Use agent_executions.ended_at as proxy for checkpoint age via thread_id naming convention

## Sources

### Primary (HIGH confidence)
- [Biome noRestrictedImports](https://biomejs.dev/linter/rules/no-restricted-imports/) - Pattern option syntax and configuration
- [Linear Webhooks Documentation](https://linear.app/developers/webhooks) - Linear-Delivery header, signature verification
- [GitHub Webhook Best Practices](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks) - X-GitHub-Delivery header
- [Slack Events API](https://docs.slack.dev/apis/events-api/) - event_id field, retry headers
- [@langchain/langgraph-checkpoint-postgres source](./node_modules/@langchain/langgraph-checkpoint-postgres/dist/sql.js) - Table schema and DELETE SQL statements
- [TypeScript Project References](https://nx.dev/blog/typescript-project-references) - Boundary enforcement mechanism

### Secondary (MEDIUM confidence)
- [Hookdeck: Implement Webhook Idempotency](https://hookdeck.com/webhooks/guides/implement-webhook-idempotency) - ON CONFLICT DO NOTHING pattern
- [7 Best Practices for Idempotent Node.js APIs](https://arunangshudas.medium.com/7-best-practices-for-idempotent-node-js-apis-7c1ab4377cab) - Database-level idempotency patterns
- [Design Patterns: DI and Factory in Node.js](https://carlosfmvaz.com/posts/dependency-injection-factory-pattern/) - Factory function patterns
- [LangGraphJS Issue #1138](https://github.com/langchain-ai/langgraphjs/issues/1138) - Checkpoint cleanup approaches

### Tertiary (LOW confidence - flagged for validation)
- Biome patterns option behavior for monorepo packages - needs testing with actual package names
- node-cron vs Temporal scheduled workflows performance comparison - not independently verified

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Using existing project dependencies, no new libraries needed
- Architecture: HIGH - Patterns directly from official docs and CONTEXT.md decisions
- Pitfalls: HIGH - Common issues documented in multiple sources with clear mitigations
- Layer enforcement: MEDIUM - Biome patterns option is new (v2.2+), needs validation
- LangGraph cleanup: MEDIUM - Custom SQL approach, no official TTL support in OSS package

**Research date:** 2026-01-21
**Valid until:** 30-60 days (patterns are stable, Biome updates frequently but maintains compatibility)

**Key insight for planning:**
The majority of Phase 14 is about wiring existing patterns together correctly. The webhook idempotency table schema already exists in integrations. The execution tracking schema needs to be added to observability. The services are straightforward factory functions. The complexity is in:
1. Correct ordering (idempotency check BEFORE processing)
2. Graceful shutdown (close methods on all services)
3. Biome configuration (per-package overrides)
4. Cleanup job scheduling (Claude's discretion on mechanism)
