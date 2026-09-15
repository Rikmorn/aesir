---
paths:
  - "packages/**/db/**"
  - "packages/**/drizzle.config.ts"
---

# PostgreSQL Fundamentals

Things PostgreSQL does (or doesn't do) that affect how you write schemas, queries, and migrations in Aesir.

## Gotchas

- **FK columns are NOT auto-indexed.** PostgreSQL creates indexes for PRIMARY KEY and UNIQUE constraints, but NOT for FOREIGN KEY columns. Always add an explicit index on FK columns — without one, joins are slow and parent row deletes/updates take table locks.
- **UNIQUE allows multiple NULLs.** `UNIQUE(a, b)` permits `(1, NULL)` and `(1, NULL)` as separate rows. Use `NULLS NOT DISTINCT` (PG15+) if you need at most one NULL combination.
- **Unquoted identifiers are lowercased.** `CREATE TABLE MyTable` becomes `mytable`. Stick to `snake_case` (which Aesir already does) and never use quoted identifiers.
- **Sequences have gaps.** Identity columns (and old serial columns) skip numbers on rollbacks, crashes, and concurrent transactions. This is normal — never try to make IDs consecutive.
- **NULL passes CHECK constraints.** `CHECK (price > 0)` allows NULL prices. Combine with `NOT NULL` when you want to prevent both null and invalid values.
- **No clustered primary keys.** Unlike SQL Server/MySQL InnoDB, PostgreSQL stores rows in insertion order, not PK order. The `CLUSTER` command is a one-time reorg, not maintained on subsequent inserts.
- **MVCC creates dead tuples.** Every UPDATE creates a new row version; the old one becomes a dead tuple cleaned up by autovacuum. Tables with frequent status changes (like `conversations`) accumulate bloat — keep updated columns narrow.

## Data Types — Do and Don't

| Don't use | Use instead | Why |
|-----------|-------------|-----|
| `timestamp` (without tz) | `timestamptz` | Stores UTC, converts on display. Without tz, timezone info is silently discarded. |
| `char(n)` / `varchar(n)` | `text` | No performance difference in PostgreSQL. `text` avoids arbitrary length errors. Use `CHECK (length(col) <= n)` if you need a limit. |
| `money` type | `numeric(p,s)` | `money` has locale-dependent formatting and rounding quirks. |
| `serial` | `generated always as identity` | `serial` creates an implicit sequence with surprising ownership semantics. Identity columns are the SQL standard. |
| `real` / `float4` | `double precision` | Unless storage is critical, `double precision` avoids precision surprises. Use `numeric` for exact decimal arithmetic (money, rates). |
| `json` | `jsonb` | `jsonb` is binary, indexable, and faster for reads. Use `json` only if you must preserve key ordering. |

Aesir uses `text` IDs with `createId.{entity}()` — this is intentional for deterministic conversation IDs and human-readable prefixes. The standard PostgreSQL advice to use `bigint identity` doesn't apply here.

## Index Strategy

**B-tree** (default): Equality and range queries (`=`, `<`, `>`, `BETWEEN`, `ORDER BY`). Most Aesir indexes are B-tree.

**GIN**: JSONB containment (`@>`), key existence (`?`), array overlap (`&&`), full-text search (`@@`). Use for columns like `metadata jsonb`, `tags jsonb`, `delivered_signal_ids jsonb`.

**GiST**: Range types, geometric data, exclusion constraints. Rarely needed in Aesir currently.

**Composite indexes**: Column order matters. The index is usable when queries filter on a **leftmost prefix**. `CREATE INDEX ON tbl (a, b)` helps `WHERE a = ?` and `WHERE a = ? AND b > ?` but NOT `WHERE b = ?` alone.

**Partial indexes**: Index a subset of rows. Aesir already uses these for soft deletes (`WHERE deleted_at IS NULL`). Also useful for status-based queries: `CREATE INDEX ON conversations (definition_id) WHERE status = 'waiting'`.

**Covering indexes**: `CREATE INDEX ON tbl (id) INCLUDE (name, status)` lets PostgreSQL answer queries from the index alone without visiting the table (index-only scans).

**Expression indexes**: Index a computed value. `CREATE INDEX ON tbl (lower(email))` — the expression in your WHERE clause must match exactly.

## JSONB Indexing

Aesir uses JSONB extensively (messages, metadata, policies, tags). Indexing strategies:

- **Default GIN**: `CREATE INDEX ON tbl USING GIN (col)` — supports containment (`@>`), key existence (`?`, `?|`, `?&`). Good general-purpose choice.
- **jsonb_path_ops**: `CREATE INDEX ON tbl USING GIN (col jsonb_path_ops)` — smaller and faster but only supports containment (`@>`), not key existence queries.
- **Scalar field extraction**: If you frequently filter on a specific JSONB field, extract it as a generated column or use an expression index: `CREATE INDEX ON tbl ((col->>'status'))`.

## Schema Evolution Safety

- **Transactional DDL**: Most DDL runs in transactions and can be rolled back. Use `BEGIN; ALTER TABLE...; ROLLBACK;` to test.
- **CREATE INDEX CONCURRENTLY**: Doesn't block writes but can't run inside a transaction. Use for production index creation on live tables.
- **Volatile defaults cause full table rewrites**: Adding a `NOT NULL` column with a volatile default (`now()`, `gen_random_uuid()`) rewrites every row. Non-volatile defaults (constants, expressions PostgreSQL can evaluate once) are instant.
- **Dropping columns**: Drop constraints first, then the column, to avoid dependency errors.

## Update-Heavy Tables

The `conversations` table has frequent status transitions. For update-heavy tables:

- **Keep updated columns narrow** — status as short `text`, not large JSONB.
- **Avoid indexing columns that change frequently** — prevents beneficial HOT (Heap-Only Tuple) updates. HOT updates skip index maintenance when no indexed column changes.
- **fillfactor**: Setting `fillfactor = 90` leaves 10% free space per page for HOT updates. Worth considering for tables with very high update rates.
- **Autovacuum tuning**: High-churn tables may need more aggressive autovacuum settings (`autovacuum_vacuum_scale_factor`, `autovacuum_analyze_scale_factor`) to keep dead tuple bloat in check.

# Schema Conventions

## Dual Schema Pattern

Every package with DB access has TWO schema files that must stay in sync:

- **`schema.ts`** (runtime) — can import from `@aesir/types` (createId functions, custom types)
- **`schema.drizzle.ts`** (migration generation) — pure Drizzle definitions, NO external imports. Drizzle-kit's CJS bundler cannot resolve external packages.

When adding a table or column, update BOTH files.

## schema.drizzle.ts Retention Rule

Never delete old table definitions from `schema.drizzle.ts`. Drizzle-kit compares current schema against snapshots to generate migrations. Removing a table definition generates a `DROP TABLE` migration. Old definitions are intentional — they prevent destructive migrations.

## Naming Conventions

- Tables: snake_case plural (`conversations`, `agent_events`, `knowledge_entries`)
- Columns: snake_case (`conversation_id`, `created_at`, `last_heartbeat_at`)
- Indexes: descriptive (`status_idx`, `conversation_sequence_idx`)
- Migration tables: `__drizzle_{service}_migrations` per namespace
- Schema namespaces match package names: `agents`, `platform`, `observability`, `linear`, `github`, `slack`

## Common Column Patterns

- **IDs**: `text` type with `createId.{entity}()` default (deterministic or random depending on entity)
- **Timestamps**: `timestamp("created_at", { withTimezone: true }).defaultNow().notNull()`
- **JSONB**: For flexible data (messages, metadata, tags, policies). No runtime schema validation in DB — Zod at boundaries only.
- **Soft deletes**: `deleted_at` timestamp + partial index `WHERE deleted_at IS NULL`
- **Updated_at triggers**: PostgreSQL trigger function per schema, applied in migration SQL

## Service Factory Pattern

All DB services follow: interface + options object (db, logger) + factory function.

```typescript
export interface MyService {
  doThing(input: Input): Promise<Output>;
  health(): Promise<{ healthy: boolean; latencyMs: number }>;
  close(): Promise<void>;
}

export function createMyService(options: MyServiceOptions): MyService {
  const { db, logger } = options;
  if (!db) throw new Error("db is required");
  if (!logger) throw new Error("logger is required");
  return { /* implementation */ };
}
```

Always include `health()` (SELECT 1) and `close()` for lifecycle management.

# Query Patterns

## Drizzle Query Builder

Standard select:
```typescript
const rows = await db.select().from(table).where(and(eq(col, val), gt(col2, val2))).orderBy(desc(col)).limit(10);
```

Insert:
```typescript
await db.insert(table).values(row);
await db.insert(table).values(batchArray); // Batch insert
```

Update:
```typescript
await db.update(table).set({ status: "completed" }).where(eq(table.id, id));
```

## Raw SQL (for patterns Drizzle doesn't support)

DISTINCT ON:
```typescript
const rows = await db.execute(sql`
  SELECT DISTINCT ON (document_type) *
  FROM agents.identity_documents
  WHERE agent_id = ${agentId}
  ORDER BY document_type, version DESC
`);
```

Worker claim (FOR UPDATE SKIP LOCKED):
```typescript
const claimed = await db.select().from(conversations)
  .where(eq(conversations.status, "queued"))
  .limit(concurrencyLimit)
  .for(sql.raw("UPDATE SKIP LOCKED"));
```

## Vector Search (pgvector)

```typescript
import { cosineDistance } from "drizzle-orm";

db.select().from(knowledgeEntries)
  .where(and(
    eq(knowledgeEntries.scope, "shared"),
    lt(cosineDistance(knowledgeEntries.embedding, vector), 1 - threshold),
  ));
```

Custom vector column (supports variable dimensions):
```typescript
const vectorColumn = customType<{ data: number[]; driverData: string }>({
  dataType() { return "vector"; },
  toDriver(value) { return `[${value.join(",")}]`; },
  fromDriver(value) { return value.slice(1, -1).split(",").map(Number.parseFloat); },
});
```

## Type Exports

Always export both select and insert types from schema:
```typescript
export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
```

## Connection Patterns

- Core packages (agents, platform): max 20 connections, lazy-loaded singleton
- Integrations: max 10 connections, Proxy pattern for optional initialization
- All pools: 30s idle timeout, 5s connection timeout
