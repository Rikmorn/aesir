---
paths:
  - "packages/**/db/**"
  - "packages/**/drizzle.config.ts"
---

# PostgreSQL in aesir

Aesir's schema conventions, and the PostgreSQL behaviours that have already bitten it.

## Gotchas

- **UNIQUE allows multiple NULLs.** `UNIQUE(a, b)` permits `(1, NULL)` and `(1, NULL)` as separate rows. Use `NULLS NOT DISTINCT` (PG15+) if you need at most one NULL combination. It left `slack.installations` open to duplicate active rows, since `enterprise_id` is NULL for every ordinary install (#67), and #62's test tripped on it.
- **MVCC creates dead tuples.** Every UPDATE creates a new row version; the old one becomes a dead tuple cleaned up by autovacuum. Tables with frequent status changes (like `conversations`) accumulate bloat — keep updated columns narrow.

## Dual Schema Pattern

Every package with DB access has TWO schema files that must stay in sync:

- **`schema.ts`** (runtime) — can import from `@aesir/types` (createId functions, custom types)
- **`schema.drizzle.ts`** (migration generation) — pure Drizzle definitions, NO external imports. Drizzle-kit's CJS bundler cannot resolve external packages.

When adding a table or column, update BOTH files.

## Naming Conventions

- Tables: snake_case plural (`conversations`, `agent_events`, `knowledge_entries`)
- Columns: snake_case (`conversation_id`, `created_at`, `last_heartbeat_at`)
- Indexes: descriptive (`status_idx`, `conversation_sequence_idx`)
- Migration tables: `__drizzle_{service}_migrations` per namespace
- Schema namespaces match package names: `agents`, `platform`, `observability`, `linear`, `github`, `slack`

## Common Column Patterns

- **IDs**: `text` type with `createId.{entity}()` default (deterministic or random depending on entity). This is deliberate, for deterministic conversation IDs and human-readable prefixes, so the usual advice to use `bigint identity` doesn't apply.
- **Timestamps**: `timestamp("created_at", { withTimezone: true }).defaultNow().notNull()`
- **JSONB**: For flexible data (messages, metadata, tags, policies). No runtime schema validation in DB — Zod at boundaries only.
- **Soft deletes**: `deleted_at` timestamp + partial index `WHERE deleted_at IS NULL`
- **Updated_at triggers**: PostgreSQL trigger function per schema, applied in migration SQL

## Type Exports

Always export both select and insert types from schema:
```typescript
export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
```
