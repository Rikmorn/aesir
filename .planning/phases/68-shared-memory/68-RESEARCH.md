# Phase 68: Shared Memory - Research

**Researched:** 2026-02-10
**Domain:** Knowledge storage with pgvector semantic search, embedding pipeline, Drizzle ORM schema
**Confidence:** HIGH

## Summary

Phase 68 introduces a knowledge persistence layer where agents store, query, and update classified knowledge entries with semantic search via pgvector in the existing PostgreSQL database. The technical domain is well-understood: Drizzle ORM v0.45+ has native `vector()` column type and `cosineDistance()` query support, pgvector provides HNSW indexing for approximate nearest neighbor search, and the embedding pipeline uses a provider-agnostic interface switching between Ollama (dev) and Voyage AI (production).

The implementation maps cleanly onto existing codebase patterns: a `KnowledgeService` following the `createTaskService()` factory pattern, three tool factories (`knowledge:store`, `knowledge:query`, `knowledge:update`) following the `createCreateTaskTool()` pattern, registration in `tool-factories.ts`, a new migration file for `agents.knowledge_entries`, and environment config extensions for embedding provider settings.

**Primary recommendation:** Use the Voyage AI TypeScript SDK (`voyageai` npm package, v0.1.0) for production embeddings rather than raw HTTP -- it handles retries, error types, and authentication. Use pg-boss `schedule()` with cron for the background cleanup job since the infrastructure already exists (timeout-scheduler.ts). Write the migration as raw SQL (not drizzle-kit generate) since pgvector column types and HNSW indexes require SQL that drizzle-kit's schema diffing may not handle cleanly.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Knowledge Tool UX:**
- `knowledge:store` -- 3 required fields: `type`, `topic`, `content`
- `type`: one of 6 fixed classifications (discovery, constraint, architecture_decision, thought, preference, test_result)
- `topic`: short label for deduplication (exact, case-insensitive, trimmed)
- `content`: max 2000 chars, reject with error if exceeded
- Auto-inferred: `author` (agentId), `expiry` (type defaults), `scope` (type defaults), `created_at`
- Optional: `scope` override, `tags`
- Response: `{ id, topic, type }` regardless of dedup
- `knowledge:query` -- params: `query`, optional `type`, `topic`, `limit` (default 10, max 25)
- Per result: `id`, `type`, `topic`, `content`, `author`, `createdAt`
- Similarity threshold to avoid garbage results
- No pagination, no total count
- `knowledge:update` -- two actions: `supersede` (new entry replaces old), `invalidate` (mark invalid with reason)
- No "extend" operation

**Scope & Visibility:**
- thought = private, all other 5 types = shared
- Invisible row-level security: shared entries + own private entries, never other agents' private
- No `scope` parameter on query
- Author returned for provenance

**Expiry & Deduplication:**
- Query-time filter: `WHERE expires_at > NOW()`
- Background cleanup: hard-delete entries expired 24h+
- discovery=24h, constraint=30d, architecture_decision=7d, thought=24h, preference=30d, test_result=7d
- Supersession resets expiry
- Dedup on store: exact topic (case-insensitive, trimmed) + same type -> auto-supersede
- No semantic dedup

**Embedding Pipeline:**
- `EMBEDDING_PROVIDER=ollama|voyage` env var, Zod validated
- `EMBEDDING_DIMENSIONS` env var (768 Ollama, 1024 Voyage)
- Ollama: Docker container, REST API, nomic-embed-text, no API key
- Voyage AI: `VOYAGE_API_KEY` env var
- EmbeddingService interface: `embed(text)` -> `number[] | null`, `embedBatch(texts)` -> `(number[] | null)[]`
- Embed source: `"{topic}: {content}"`
- Synchronous embed with graceful degradation (null vector on failure, still queryable by structured fields)
- Query fallback: failed embed -> structured-only search, no filters -> empty result

### Claude's Discretion

- Voyage AI SDK vs raw HTTP
- Embedding model version selection (voyage-3 vs newer, specific Ollama model)
- Ollama model selection for development
- Background cleanup job implementation (pg-boss cron vs setInterval)
- HNSW index parameters (ef_construction, m)
- Similarity threshold value (suggested 0.3 cosine)
- Content character limit exact value (suggested 2000)

### Deferred Ideas (OUT OF SCOPE)

- YAML-based scope overrides
- Confidence scores on knowledge entries
- Extend operation on knowledge:update
- Active knowledge curation (agent/human reviews and prunes)
</user_constraints>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| drizzle-orm | ^0.45.1 (already installed) | ORM with native pgvector support | Already the project ORM; v0.31+ added `vector()` column type, `cosineDistance()`, HNSW index definition |
| pgvector (PostgreSQL extension) | 0.8.1 (via Docker image) | Vector similarity search in PostgreSQL | Project decision: no separate vector DB. pgvector/pgvector:pg15 Docker image replaces postgres:15-alpine |
| voyageai | ^0.1.0 (new dependency) | Production embedding provider SDK | Official TypeScript SDK with retry logic, typed errors, batch support. Simpler than raw HTTP with manual retry. |
| pg-boss | ^12.8.0 (already installed) | Background cleanup job scheduling | Already used for timeout-scheduler.ts. Cron scheduling built-in with `schedule()` method. |
| zod | 3.25.67 (already installed) | Input validation for tool schemas | Project standard for all external data boundaries |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pgvector (npm) | ^0.2.0 | Vector type serialization for raw SQL | Only needed if Drizzle's built-in vector handling is insufficient for INSERT/UPDATE. Drizzle's native vector() should handle this. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Voyage AI SDK | Raw HTTP fetch + retry | More control but must handle auth headers, error parsing, retry logic, rate limiting manually. SDK handles all of this. SDK is small (0.1.0), maintained by Voyage AI. **Recommendation: Use SDK.** |
| pg-boss cron | setInterval | setInterval is simpler but doesn't survive process restarts, lacks distributed locking (multiple workers would double-cleanup), and has no built-in monitoring. pg-boss cron survives restarts, has exactly-once semantics via SKIP LOCKED. **Recommendation: Use pg-boss.** |
| nomic-embed-text (768d) | mxbai-embed-large (1024d) | mxbai-embed-large is larger (334M vs 137M params) and produces 1024d vectors matching Voyage AI. But nomic-embed-text is the established Ollama embedding model, lighter, and 768d is sufficient for dev. Dimension mismatch between dev/prod is expected and handled by `EMBEDDING_DIMENSIONS` env. **Recommendation: Use nomic-embed-text for dev.** |
| voyage-3 (1024d) | voyage-3.5 (1024d, newer) | voyage-3.5 is newer, supports output_dimension truncation (256/512/1024/2048), and is the recommended model. Same default dimensions. **Recommendation: Use voyage-3.5 for production. Falls back to voyage-3 if needed.** |

**Installation:**
```bash
pnpm --filter @aesir/agents add voyageai
```

No other new dependencies needed -- drizzle-orm, pg-boss, zod are already installed. The pgvector npm package is likely unnecessary since Drizzle ORM handles vector type natively.

## Architecture Patterns

### Recommended Project Structure

```
packages/agents/src/shared/
├── embedding/                     # NEW: Embedding pipeline
│   ├── types.ts                   # EmbeddingService interface
│   ├── ollama.ts                  # OllamaEmbedding implementation
│   ├── voyage.ts                  # VoyageEmbedding implementation
│   ├── factory.ts                 # createEmbeddingService(config) factory
│   └── embedding.test.ts          # Unit tests for both providers
├── services/
│   ├── task-service.ts            # Existing pattern to follow
│   └── knowledge-service.ts       # NEW: KnowledgeService (CRUD + dedup + expiry)
├── tools/
│   └── knowledge/                 # NEW: Knowledge tool factories
│       ├── store.ts               # knowledge:store tool
│       ├── query.ts               # knowledge:query tool
│       ├── update.ts              # knowledge:update tool
│       ├── index.ts               # Barrel export
│       ├── types.ts               # Shared types and constants
│       └── knowledge-tools.test.ts # Unit tests
├── db/
│   ├── schema.ts                  # ADD: knowledge_entries table definition
│   ├── schema.drizzle.ts          # ADD: mirror for drizzle-kit
│   └── migrations/
│       └── 0007_add_knowledge_entries.sql  # NEW: migration
└── env/
    └── config.ts                  # MODIFY: add embedding env vars
```

### Pattern 1: KnowledgeService Factory (mirrors TaskService)

**What:** Factory-based service with Zod validation, following `createTaskService()` pattern exactly.
**When to use:** All knowledge CRUD operations. Tools call the service; service handles DB.

```typescript
// Source: Existing pattern from packages/agents/src/shared/services/task-service.ts
interface KnowledgeServiceOptions {
  db: NodePgDatabase<typeof agentsSchemaModule>;
  embeddingService: EmbeddingService;
  logger: PinoLogger;
}

interface KnowledgeService {
  store(params: StoreKnowledgeParams): Promise<KnowledgeEntry>;
  query(params: QueryKnowledgeParams): Promise<KnowledgeEntry[]>;
  supersede(entryId: string, params: SupersedeParams): Promise<KnowledgeEntry>;
  invalidate(entryId: string, reason?: string): Promise<void>;
  cleanupExpired(): Promise<number>; // Returns count of deleted entries
  health(): Promise<{ healthy: boolean; latencyMs: number }>;
  close(): Promise<void>;
}
```

### Pattern 2: Tool Factory with Service + Context (mirrors task tools)

**What:** Tool factories that take `(KnowledgeService, ToolContext)` and return `ToolDefinition`.
**When to use:** All three knowledge tools.

```typescript
// Source: Existing pattern from packages/agents/src/shared/tools/task/create-task.ts
export function createKnowledgeStoreTool(
  knowledgeService: KnowledgeService,
  ctx: ToolContext,
): ToolDefinition {
  return {
    name: "knowledge_store",
    description: "Store a knowledge entry...",
    inputSchema: KnowledgeStoreInputSchema,
    async execute(input: unknown): Promise<ToolResult> {
      // Validate, infer defaults from ctx.agentId, call service
    },
  };
}
```

### Pattern 3: EmbeddingService Provider Abstraction

**What:** Interface with two implementations, selected by factory based on env config.
**When to use:** All embedding operations (store-time and query-time).

```typescript
// Provider-agnostic interface
interface EmbeddingService {
  embed(text: string): Promise<number[] | null>;
  embedBatch(texts: string[]): Promise<(number[] | null)[]>;
}

// Factory selects implementation based on EMBEDDING_PROVIDER
function createEmbeddingService(config: EmbeddingConfig): EmbeddingService {
  switch (config.provider) {
    case "ollama":
      return createOllamaEmbedding(config);
    case "voyage":
      return createVoyageEmbedding(config);
    default:
      throw new Error(`Unknown embedding provider: ${config.provider}`);
  }
}
```

### Pattern 4: Tool Registration in tool-factories.ts

**What:** Register `knowledge:store`, `knowledge:query`, `knowledge:update` following existing namespace:tool_name pattern.
**When to use:** During bootstrap in `registerAllTools()`.

```typescript
// Source: Existing pattern from packages/agents/src/framework/tool-factories.ts
// In RegisterAllToolsOptions, add: knowledgeService: KnowledgeService

// In registerAllTools():
const ks = options.knowledgeService;
registry.register("knowledge:store", (ctx) => createKnowledgeStoreTool(ks, ctx));
registry.register("knowledge:query", (ctx) => createKnowledgeQueryTool(ks, ctx));
registry.register("knowledge:update", (ctx) => createKnowledgeUpdateTool(ks, ctx));
```

### Pattern 5: Drizzle Schema with pgvector

**What:** Table definition using Drizzle's native `vector()` type with HNSW index.

```typescript
// Source: https://orm.drizzle.team/docs/extensions/pg (verified)
import { vector, index } from "drizzle-orm/pg-core";

export const knowledgeEntries = agentsSchema.table(
  "knowledge_entries",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),         // 6 fixed types
    topic: text("topic").notNull(),        // dedup key
    content: text("content").notNull(),    // max 2000 chars
    author: text("author").notNull(),      // agentId
    scope: text("scope").notNull(),        // 'shared' | 'private'
    tags: jsonb("tags").$type<string[]>().default([]),
    embedding: vector("embedding", { dimensions: 1024 }), // nullable for graceful degradation
    superseded_by: text("superseded_by"),  // FK to self for chain tracking
    invalidated: boolean("invalidated").default(false),
    invalidation_reason: text("invalidation_reason"),
    expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_knowledge_type_topic").on(table.type, table.topic),
    index("idx_knowledge_scope_author").on(table.scope, table.author),
    index("idx_knowledge_expires").on(table.expires_at),
    index("idx_knowledge_embedding_cosine")
      .using("hnsw", table.embedding.op("vector_cosine_ops")),
  ],
);
```

**Important:** The `dimensions` parameter in the schema definition must match the configured `EMBEDDING_DIMENSIONS` env var. Since migrations are run once per environment, this is set at migration time. The migration SQL should use a fixed dimension (1024 for production-first, matching Voyage AI default).

### Pattern 6: Background Cleanup via pg-boss Cron

**What:** Scheduled job that hard-deletes entries expired 24h+ ago.
**When to use:** Single cron schedule registered at startup alongside timeout-scheduler.

```typescript
// pg-boss cron schedule (runs every hour)
await boss.schedule("knowledge-cleanup", "0 * * * *", {});

// Worker deletes entries where expires_at < NOW() - INTERVAL '24 hours'
await boss.work("knowledge-cleanup", async () => {
  const deleted = await knowledgeService.cleanupExpired();
  logger.info({ deletedCount: deleted }, "Knowledge cleanup completed");
});
```

### Anti-Patterns to Avoid

- **Don't use pgvector npm for Drizzle queries:** Drizzle ORM has native `vector()` type and `cosineDistance()`. The pgvector npm package is for raw pg queries. Using both creates confusion about which serialization to trust.
- **Don't embed at query time if embedding fails:** Return structured-only results or empty. Never block on a failed embed call.
- **Don't create a separate database connection for embeddings:** The embedding service is called synchronously during store operations. It uses HTTP calls to Ollama/Voyage, not database connections.
- **Don't use drizzle-kit generate for the migration:** pgvector extension activation (`CREATE EXTENSION IF NOT EXISTS vector`) and HNSW index syntax are not well-handled by drizzle-kit's schema diffing. Write the migration SQL manually, as done for all previous migrations in this project.
- **Don't add `knowledge:*` tools to agent definitions yet:** The tools should be registered in tool-factories.ts but not added to any definition.yaml in this phase. Agent prompt updates and tool wiring happen in a separate plan (or the next phase).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Vector similarity search | Custom cosine distance SQL | Drizzle's `cosineDistance()` + pgvector HNSW index | Drizzle generates correct `<=>` operator syntax and handles vector serialization |
| Embedding retry logic | Custom fetch + retry wrapper | Voyage AI SDK (`voyageai` package) has built-in retry with exponential backoff | SDK handles 429 rate limits, timeout, abort signals, typed errors |
| Scheduled cleanup | Custom setInterval + distributed lock | pg-boss `schedule()` with cron expression | Already used in project (timeout-scheduler.ts), has exactly-once via SKIP LOCKED, survives restarts |
| ID generation | Custom UUID or random | Existing `createId` pattern from `@aesir/types` | Add `knowledgeEntry: () => \`ke_\${nanoid()}\`` to match project convention |
| Env validation | Manual env checks | Extend existing Zod schema in `config.ts` | Project pattern: Zod validates all env at startup with fail-fast |

**Key insight:** Every infrastructure problem in this phase has an existing solution in the codebase or standard library. The novel work is the knowledge domain logic (scope rules, dedup, expiry), not the plumbing.

## Common Pitfalls

### Pitfall 1: Dimension Mismatch Between Environments
**What goes wrong:** Dev uses 768-dim Ollama embeddings, prod uses 1024-dim Voyage. Existing entries become incompatible if you switch environments with data in place.
**Why it happens:** pgvector column is dimension-specific. A `vector(768)` column rejects 1024-dim inserts.
**How to avoid:** Accept that dev and prod have different dimensions. The `EMBEDDING_DIMENSIONS` env var is set per environment. The migration should use a fixed dimension for the column definition -- use 1024 (production) as the migration default. For dev with Ollama (768d), the migration can be re-run with a different dimension, OR the column can be defined without a fixed dimension constraint (just `vector` without size) and the HNSW index rebuilt. **Recommendation:** Use `vector` without fixed dimensions in the SQL column, but specify dimensions in the HNSW index via `WITH (m = 16, ef_construction = 64)`. This allows mixed-dimension inserts but semantic search only works correctly when all vectors have the same dimension. Since each environment is consistent (all 768 or all 1024), this works.
**Warning signs:** Insert errors mentioning "expected X dimensions but got Y".

### Pitfall 2: HNSW Index on Nullable Column
**What goes wrong:** pgvector HNSW indexes skip NULL values. Entries stored without embeddings (graceful degradation) are excluded from semantic search but still need to appear in structured queries.
**Why it happens:** The embedding is nullable (null on embedding failure). HNSW index only covers non-null vectors.
**How to avoid:** This is by design. Structured queries (WHERE type = X AND topic = Y) use the standard B-tree indexes. Semantic queries use the HNSW index. Entries with null embeddings appear in structured results but not semantic results. Document this clearly.
**Warning signs:** Query returns fewer results than expected when embedding service was down.

### Pitfall 3: Drizzle-Kit Migration Generation with pgvector
**What goes wrong:** Running `drizzle-kit generate` produces migrations that don't include `CREATE EXTENSION IF NOT EXISTS vector` or generate incorrect HNSW index syntax.
**Why it happens:** Drizzle-kit's schema diffing doesn't fully understand pgvector extension activation or custom index operators.
**How to avoid:** Write migration SQL by hand (0007_add_knowledge_entries.sql). The project already does this -- all 6 existing migrations are hand-written SQL with `--> statement-breakpoint` separators for drizzle-kit's migration runner.
**Warning signs:** Migration fails with "type vector does not exist" or "operator class vector_cosine_ops does not exist".

### Pitfall 4: Case-Sensitive Topic Deduplication
**What goes wrong:** Agent stores "Auth Middleware" and later stores "auth middleware" -- no dedup triggers, creating duplicates.
**Why it happens:** PostgreSQL text comparison is case-sensitive by default.
**How to avoid:** Use `LOWER(TRIM(topic))` in the dedup query. Or store topics normalized (lowercased, trimmed) at write time. **Recommendation:** Normalize at write time -- simpler queries and the UNIQUE index works naturally. Store the original casing in a separate display field if needed (probably not needed for v1).
**Warning signs:** Duplicate entries with same topic but different casing in the knowledge store.

### Pitfall 5: Embedding Latency Blocking Store Operations
**What goes wrong:** Agent calls `knowledge:store`, embedding provider takes 2+ seconds, agent loop stalls waiting for the tool result.
**Why it happens:** Embedding is a synchronous HTTP call to Ollama/Voyage during the store operation.
**How to avoid:** This is expected and acceptable. Embedding calls are typically 100-500ms for single texts. The 2000-char content limit keeps payload small. The `null` fallback on timeout ensures the tool never hangs indefinitely. Set a reasonable timeout (5s for Ollama, 10s for Voyage) in the embedding service.
**Warning signs:** Tool execution duration consistently > 1s in event logs.

### Pitfall 6: Expiry Cleanup Deleting Recently-Stored Entries
**What goes wrong:** Entry with 24h expiry stored at 11:59 PM, cleanup job runs at midnight, entry is deleted within minutes.
**Why it happens:** Cleanup deletes entries where `expires_at < NOW() - INTERVAL '24 hours'`. But if `expires_at = created_at + 24h`, the 24h buffer means the entry survives 48h total (24h expiry + 24h cleanup buffer).
**How to avoid:** This is correct by design. The 24h buffer in the cleanup query means entries live for (expiry_duration + 24h) in the database. Query-time filter (`WHERE expires_at > NOW()`) ensures correctness -- entries are invisible after their expiry regardless of cleanup timing.
**Warning signs:** None -- this is working as intended.

## Code Examples

### Drizzle Vector Column Definition

```typescript
// Source: https://orm.drizzle.team/docs/extensions/pg (verified via WebFetch)
import { pgTable, vector, index, text, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";

export const knowledgeEntries = agentsSchema.table(
  "knowledge_entries",
  {
    id: text("id").primaryKey(),
    type: text("type", {
      enum: ["discovery", "constraint", "architecture_decision", "thought", "preference", "test_result"] as const,
    }).notNull(),
    topic: text("topic").notNull(),
    content: text("content").notNull(),
    author: text("author").notNull(),
    scope: text("scope", { enum: ["shared", "private"] as const }).notNull(),
    tags: jsonb("tags").$type<string[]>().default([]),
    embedding: vector("embedding", { dimensions: 1024 }), // nullable
    superseded_by: text("superseded_by"),
    invalidated: boolean("invalidated").notNull().default(false),
    invalidation_reason: text("invalidation_reason"),
    expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_knowledge_type_topic").on(table.type, table.topic),
    index("idx_knowledge_scope_author").on(table.scope, table.author),
    index("idx_knowledge_expires").on(table.expires_at),
    index("idx_knowledge_embedding_cosine")
      .using("hnsw", table.embedding.op("vector_cosine_ops")),
  ],
);
```

### Cosine Similarity Query with Drizzle

```typescript
// Source: https://orm.drizzle.team/docs/guides/vector-similarity-search (verified)
import { cosineDistance, gt, sql, and, eq, desc } from "drizzle-orm";

async function queryKnowledge(
  db: NodePgDatabase,
  queryEmbedding: number[],
  agentId: string,
  filters?: { type?: string; topic?: string; limit?: number },
): Promise<KnowledgeEntry[]> {
  const similarity = sql<number>`1 - (${cosineDistance(knowledgeEntries.embedding, queryEmbedding)})`;
  const threshold = 0.3;

  const conditions = [
    gt(similarity, threshold),
    sql`${knowledgeEntries.expires_at} > NOW()`,
    eq(knowledgeEntries.invalidated, false),
    sql`${knowledgeEntries.superseded_by} IS NULL`,
    // Scope: shared OR (private AND own author)
    sql`(${knowledgeEntries.scope} = 'shared' OR (${knowledgeEntries.scope} = 'private' AND ${knowledgeEntries.author} = ${agentId}))`,
  ];

  if (filters?.type) conditions.push(eq(knowledgeEntries.type, filters.type));
  if (filters?.topic) conditions.push(sql`LOWER(TRIM(${knowledgeEntries.topic})) = LOWER(TRIM(${filters.topic}))`);

  return db
    .select()
    .from(knowledgeEntries)
    .where(and(...conditions))
    .orderBy(desc(similarity))
    .limit(filters?.limit ?? 10);
}
```

### Voyage AI SDK Usage

```typescript
// Source: https://github.com/voyage-ai/typescript-sdk (verified via WebFetch)
import { VoyageAIClient, VoyageAIError } from "voyageai";

function createVoyageEmbedding(config: { apiKey: string; model: string }): EmbeddingService {
  const client = new VoyageAIClient({ apiKey: config.apiKey });

  return {
    async embed(text: string): Promise<number[] | null> {
      try {
        const response = await client.embed({
          input: text,
          model: config.model,  // "voyage-3.5"
          inputType: "document",
        });
        return response.data?.[0]?.embedding ?? null;
      } catch (err) {
        if (err instanceof VoyageAIError) {
          logger.warn({ statusCode: err.statusCode }, "Voyage embed failed");
        }
        return null;
      }
    },

    async embedBatch(texts: string[]): Promise<(number[] | null)[]> {
      try {
        const response = await client.embed({
          input: texts,
          model: config.model,
          inputType: "document",
        });
        return texts.map((_, i) => response.data?.[i]?.embedding ?? null);
      } catch {
        return texts.map(() => null);
      }
    },
  };
}
```

### Ollama Embedding via REST API

```typescript
// Source: https://ollama.com/blog/embedding-models (verified via WebFetch)
// Endpoint: POST http://{OLLAMA_URL}/api/embed
// Note: /api/embed is the current endpoint (not /api/embeddings which is older)

function createOllamaEmbedding(config: { url: string; model: string }): EmbeddingService {
  return {
    async embed(text: string): Promise<number[] | null> {
      try {
        const response = await fetch(`${config.url}/api/embed`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: config.model, input: text }),
          signal: AbortSignal.timeout(5000), // 5s timeout
        });
        if (!response.ok) return null;
        const data = await response.json();
        return data.embeddings?.[0] ?? null;
      } catch {
        return null;
      }
    },

    async embedBatch(texts: string[]): Promise<(number[] | null)[]> {
      // Ollama does NOT support batch embeddings (confirmed: "Coming soon" per blog)
      // Process sequentially
      return Promise.all(texts.map((t) => this.embed(t)));
    },
  };
}
```

### Migration SQL Example

```sql
-- Phase 68: Shared Memory - Knowledge Entries
-- Requires pgvector extension for vector column and HNSW index

CREATE EXTENSION IF NOT EXISTS vector;

--> statement-breakpoint

CREATE TABLE agents.knowledge_entries (
  id                  TEXT PRIMARY KEY,
  type                TEXT NOT NULL CHECK (type IN ('discovery', 'constraint', 'architecture_decision', 'thought', 'preference', 'test_result')),
  topic               TEXT NOT NULL,
  content             TEXT NOT NULL,
  author              TEXT NOT NULL,
  scope               TEXT NOT NULL CHECK (scope IN ('shared', 'private')),
  tags                JSONB DEFAULT '[]',
  embedding           vector,  -- dimension enforced by HNSW index ops, nullable for graceful degradation
  superseded_by       TEXT REFERENCES agents.knowledge_entries(id),
  invalidated         BOOLEAN NOT NULL DEFAULT false,
  invalidation_reason TEXT,
  expires_at          TIMESTAMPTZ NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

--> statement-breakpoint

CREATE INDEX idx_knowledge_type_topic ON agents.knowledge_entries(type, LOWER(TRIM(topic)));

--> statement-breakpoint

CREATE INDEX idx_knowledge_scope_author ON agents.knowledge_entries(scope, author);

--> statement-breakpoint

CREATE INDEX idx_knowledge_expires ON agents.knowledge_entries(expires_at) WHERE expires_at > NOW();

--> statement-breakpoint

CREATE INDEX idx_knowledge_not_superseded ON agents.knowledge_entries(id) WHERE superseded_by IS NULL AND invalidated = false;

--> statement-breakpoint

-- HNSW index for cosine similarity search
-- Parameters: m=16 (connections per node), ef_construction=64 (build quality)
-- These are conservative defaults suitable for low-thousands of entries
CREATE INDEX idx_knowledge_embedding_cosine ON agents.knowledge_entries
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| pgvector IVFFlat index | HNSW index | pgvector 0.5.0+ (2023) | HNSW provides better recall at query time without needing periodic reindexing. IVFFlat requires `VACUUM` after large inserts. Use HNSW for live-updated tables. |
| Drizzle custom SQL for vectors | Drizzle native `vector()` type | drizzle-orm 0.31.0 (2024) | No more `sql\`vector(N)\`` hacks. Native column type, distance functions, index operators. |
| Voyage AI raw HTTP | Voyage AI TypeScript SDK | voyageai 0.1.0 (2025) | Official SDK with typed errors, retry, abort signal support. |
| Ollama `/api/embeddings` | Ollama `/api/embed` | Ollama 0.3+ (2024) | Newer endpoint, same response format. `/api/embeddings` still works but `/api/embed` is canonical. |
| voyage-3 | voyage-3.5 / voyage-4 | 2025-2026 | voyage-3.5 adds Matryoshka dimensions (256/512/1024/2048). voyage-4 series is newest. For this project, voyage-3.5 is the sweet spot: 1024d default, well-tested. |

**Deprecated/outdated:**
- `pgvector/drizzle` npm package: Unnecessary with Drizzle ORM 0.31+ native support
- `voyageai` Python SDK patterns: TypeScript SDK has different API surface
- Ollama batch embeddings: Not yet available (marked "Coming soon")

## Open Questions

1. **Vector column dimension constraint vs unconstrained**
   - What we know: pgvector supports both `vector(1024)` (fixed) and `vector` (any dimension) column types. Fixed dimensions reject mismatched inserts (safety). Unconstrained allows mixed dimensions (flexibility).
   - What's unclear: Whether Drizzle ORM's `vector({ dimensions: 1024 })` maps to `vector(1024)` in SQL or if it's a Drizzle-only constraint.
   - Recommendation: Use unconstrained `vector` in migration SQL for flexibility across dev/prod dimensions. Add a CHECK constraint or application-level validation if dimension enforcement is needed. The HNSW index will only work correctly with consistent dimensions, which is guaranteed by the per-environment EMBEDDING_DIMENSIONS setting.

2. **Voyage AI response schema details**
   - What we know: SDK returns response with `data` array containing embedding objects. Each has an `embedding` field (number array).
   - What's unclear: Exact TypeScript types from the SDK (the npm package is v0.1.0, docs are sparse).
   - Recommendation: Check SDK types at implementation time. The interface abstraction means only the Voyage implementation needs to know the response shape.

3. **Docker Compose Ollama service configuration**
   - What we know: Need an Ollama container in docker-compose.yml for dev embedding. nomic-embed-text model needs to be pulled at first run.
   - What's unclear: Whether to use a custom entrypoint that auto-pulls the model, or require manual `ollama pull nomic-embed-text` after container starts.
   - Recommendation: Use the standard `ollama/ollama` image with a healthcheck that validates the model is available. Add a startup script or init container that pulls the model. OR: document `docker exec ollama ollama pull nomic-embed-text` as a first-time setup step.

4. **schema.drizzle.ts vector column**
   - What we know: Drizzle-kit uses `schema.drizzle.ts` for migration generation. This file must mirror `schema.ts` but without external dependencies.
   - What's unclear: Whether `vector` from `drizzle-orm/pg-core` works in the drizzle-kit CJS bundler context (schema.drizzle.ts exists because of CJS bundling issues).
   - Recommendation: Test at implementation time. If `vector` import fails in drizzle-kit context, define the column as `text("embedding")` in schema.drizzle.ts (drizzle-kit won't generate migrations for this table anyway since we write SQL by hand).

## Sources

### Primary (HIGH confidence)
- [Drizzle ORM - PostgreSQL extensions (pgvector)](https://orm.drizzle.team/docs/extensions/pg) - vector column type, HNSW index, distance functions
- [Drizzle ORM - Vector similarity search guide](https://orm.drizzle.team/docs/guides/vector-similarity-search) - cosineDistance query patterns
- [pgvector-node GitHub](https://github.com/pgvector/pgvector-node) - pg/drizzle integration, HNSW index creation (verified via WebFetch)
- [Voyage AI TypeScript SDK](https://github.com/voyage-ai/typescript-sdk) - VoyageAIClient API, embed method, error handling (verified via WebFetch)
- [Voyage AI Embeddings docs](https://docs.voyageai.com/docs/embeddings) - API endpoint, models, dimensions, batch limits (verified via WebFetch)
- [Ollama embedding models blog](https://ollama.com/blog/embedding-models) - /api/embed endpoint, model list (verified via WebFetch)

### Secondary (MEDIUM confidence)
- [pgvector Docker Hub](https://hub.docker.com/r/pgvector/pgvector) - Docker image tags (pg15, pg16, version 0.8.1)
- [nomic-embed-text on HuggingFace](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5) - 768 dimensions default, Matryoshka support
- [pgvector GitHub](https://github.com/pgvector/pgvector) - HNSW parameters (m, ef_construction defaults)

### Tertiary (LOW confidence)
- Ollama batch embedding support: Blog says "Coming soon" but no date. Workaround is sequential calls. Validate at implementation time.
- voyageai npm package version: Listed as 0.1.0 on npm. May have updated. Check at install time.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all libraries verified via official docs and existing codebase patterns
- Architecture: HIGH - directly maps to existing TaskService/task-tools pattern in the codebase
- Pitfalls: HIGH - pgvector dimension handling and Drizzle migration issues are well-documented
- Embedding pipeline: MEDIUM - Voyage AI SDK is v0.1.0 (early), Ollama batch not yet available

**Research date:** 2026-02-10
**Valid until:** 2026-03-10 (30 days - stable domain, well-established libraries)
