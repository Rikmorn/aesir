# Phase 69: Entity Directory - Research

**Researched:** 2026-02-10
**Domain:** pgvector semantic search, Drizzle ORM schema extension, CLI seed scripts, agent tool registration
**Confidence:** HIGH

## Summary

Phase 69 adds a queryable entity directory to the agents schema so agents can discover each other by capability using semantic matching. The implementation builds entirely on infrastructure shipped in Phase 68 (pgvector extension, embedding service, HNSW indexing, cosine similarity queries) and follows the established patterns for services (`createDirectoryService`), tools (`directory:find`, `directory:get`), and seed scripts (`pnpm --filter @aesir/agents seed:directory`).

The technical surface is small: one new table (`agents.entity_directory`), one new service, two new tools, one seed script, and minor extensions to the YAML schema and tool-factories registration. The patterns for all of these exist in the codebase. The knowledge service (`knowledge-service.ts`) provides an exact template for pgvector queries with cosine distance, threshold filtering, and graceful degradation. The seed-permissions scripts in the integration packages provide the template for the seed script.

**Primary recommendation:** Follow the KnowledgeService pattern exactly for the DirectoryService. Reuse the existing `EmbeddingService` for generating capability embeddings at seed time. The `vectorColumn` customType from `schema.ts` handles unconstrained vector dimensions. The total code delta is modest -- roughly 300-400 lines of new code across 6-8 new files.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Capability Design:**
- Outcome-level capabilities, 3-7 statements per agent. Each describes what the agent delivers, not what tools it has
- Light convention: start with a verb, describe the deliverable, one sentence per capability. Not enforced by schema
- Single combined embedding per entity (concatenate all capabilities into one text block). Per-capability embedding deferred until scale justifies it (50+ entities with overlapping capabilities)
- Flat string list in definition.yaml -- no structured entries (label/description). The capability string serves both embedding source and display
- Bad examples to avoid: verbose wrappers ("This agent is responsible for..."), terse fragments ("Code. PRs."), filler ("including but not limited to")

**Seed Lifecycle:**
- Manual CLI command: `pnpm --filter @aesir/agents seed:directory`. Matches established `seed:permissions` pattern
- Script location: `packages/agents/scripts/seed-directory.ts`
- Idempotent: `ON CONFLICT DO UPDATE` with `last_seeded_at` timestamp
- Removed agents: mark `status='inactive'` for agent entries not in the current YAML set (scoped to `type='agent'`). Reversible -- re-add YAML and re-seed
- Skip embedding when capabilities haven't changed: compare stored capabilities array against YAML. Changed = full upsert with new embedding. Unchanged = metadata-only upsert (name, description, last_seeded_at)
- Optional startup staleness warning: log warning if YAML mtime > last_seeded_at (cheap check, no embedding needed)
- Deploy workflow: `pnpm db:migrate` -> `pnpm seed:permissions` -> `pnpm seed:directory`

**Search Result Shape:**
- `directory:find` input: just `query` (string). No type filter, limit, or tags
- Self-exclusion is automatic via `ctx.agentId` -- agents never find themselves
- Status filtering is automatic: `WHERE status = 'active'`
- `directory:find` returns per result: `id`, `name`, `type`, `description`, `capabilities`. Ordered by relevance
- No raw similarity score -- result ordering is the signal. Agents are bad at interpreting cosine distances
- Similarity threshold filtering (tunable, start around 0.3). All matches above threshold returned -- no pagination at 5-10 agents
- `directory:get` returns: everything from `find` plus `reach_via` and `metadata`. Returns not-found for inactive entities

**Definition.yaml Changes:**
- Only orchestrators get directory entries (dev-agent, product-agent). Sub-agents (coder, researcher, tester) are excluded
- Presence of `capabilities` field in YAML is the opt-in signal. No separate `directory: true` flag needed
- Zod schema: `capabilities: z.array(z.string().min(1)).optional()` in AgentRegistry. Light validation -- catches structural errors, not content quality

### Claude's Discretion
- Exact similarity threshold tuning for `directory:find`
- Entity directory table schema details (column types, indexes beyond HNSW)
- Error message format for not-found/inactive entities in `directory:get`
- Whether to add a startup staleness warning or defer it

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.

</user_constraints>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| drizzle-orm | ^0.45.1 | Schema definition + queries | Already used for all agents.* tables |
| drizzle-orm/pg-core | ^0.45.1 | Table/column/index definitions | pgSchema, customType for vectors |
| zod | 3.25.67 | Input validation + YAML schema | All existing schemas use Zod |
| yaml | ^2.8.2 | Parse definition.yaml files | AgentRegistry already uses this |
| pg | ^8.17.2 | PostgreSQL client (seed script) | Existing pattern for scripts |
| postgres | ^3.4.7 | Alternative PG client (seed script) | Used by seed-permissions scripts |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @aesir/platform | workspace:* | `loadEnvFromRoot()`, `createPinoLogger()` | Seed script env loading |
| @aesir/types | workspace:* | `createId` for prefixed IDs | Entity directory row IDs |
| voyageai | ^0.1.0 | Voyage AI embedding SDK | Production embedding generation |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| pgvector cosine similarity | pg_trgm text search | Misses semantic matches ("write code" != "implement features") |
| HNSW index | IVFFlat index | HNSW is better for small datasets (<10K rows), higher recall |
| Combined capability embedding | Per-capability embedding | Per-capability deferred; combined is simpler, sufficient for 5-10 entities |

**Installation:**
No new packages needed. All dependencies already in `@aesir/agents/package.json`.

## Architecture Patterns

### Recommended File Structure
```
packages/agents/
  definitions/
    dev-agent/
      definition.yaml          # ADD: capabilities field
    product-agent/
      definition.yaml          # ADD: capabilities field
  scripts/
    seed-directory.ts          # NEW: seed script
  src/
    shared/
      db/
        schema.ts              # ADD: entityDirectory table
        schema.drizzle.ts      # ADD: entityDirectory table (mirror)
        migrations/
          0008_add_entity_directory.sql  # NEW: migration
      services/
        directory-service.ts   # NEW: DirectoryService factory
      tools/
        directory/
          find.ts              # NEW: directory:find tool factory
          get.ts               # NEW: directory:get tool factory
          index.ts             # NEW: barrel export
    framework/
      types.ts                 # MODIFY: AgentDefinitionYamlSchema (add capabilities)
      tool-factories.ts        # MODIFY: register directory:find, directory:get
```

### Pattern 1: Service Factory (follow KnowledgeService exactly)
**What:** Factory function returning an interface with business methods + `health()` + `close()`
**When to use:** DirectoryService for find/get/upsert operations
**Example:**
```typescript
// Source: packages/agents/src/shared/services/knowledge-service.ts (existing pattern)
export interface DirectoryService {
  find(query: string, excludeAgentId: string): Promise<DirectoryEntry[]>;
  get(entityId: string): Promise<DirectoryEntry | null>;
  upsert(entry: UpsertDirectoryEntry): Promise<void>;
  deactivateStale(activeIds: string[]): Promise<number>;
  health(): Promise<{ healthy: boolean; latencyMs: number }>;
  close(): Promise<void>;
}

export function createDirectoryService(
  options: DirectoryServiceOptions,
): DirectoryService {
  const { db, embeddingService, logger } = options;
  // fail-fast validation
  if (!db) throw new Error("db is required for DirectoryService");
  // ... implementation
}
```

### Pattern 2: Tool Registration (follow knowledge tools exactly)
**What:** Tool factory functions registered in `tool-factories.ts` with `(Service, ToolContext) => ToolDefinition` signature
**When to use:** `directory:find` and `directory:get` tools
**Example:**
```typescript
// Source: packages/agents/src/framework/tool-factories.ts (existing pattern)
// In RegisterAllToolsOptions, add:
//   directoryService: DirectoryService;

// Registration:
const ds = options.directoryService;
registry.register("directory:find", (ctx) => createDirectoryFindTool(ds, ctx));
registry.register("directory:get", (ctx) => createDirectoryGetTool(ds, ctx));
```

### Pattern 3: Seed Script (follow seed-permissions exactly)
**What:** CLI script using `loadEnvFromRoot()`, direct DB access, `ON CONFLICT DO UPDATE`
**When to use:** `seed-directory.ts` for populating entity_directory from YAML definitions
**Example:**
```typescript
// Source: packages/integrations/linear/scripts/seed-permissions.ts (existing pattern)
#!/usr/bin/env tsx
import { loadEnvFromRoot } from "@aesir/platform";
loadEnvFromRoot();

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
// ... read YAML files, generate embeddings, upsert to entity_directory
```

### Pattern 4: pgvector Cosine Similarity Query
**What:** Semantic search using `cosineDistance` from drizzle-orm with threshold filtering
**When to use:** `directory:find` implementation
**Example:**
```typescript
// Source: packages/agents/src/shared/services/knowledge-service.ts lines 297-314
const similarity = sql<number>`1 - (${cosineDistance(entityDirectory.capabilities_embedding, queryEmbedding)})`;

const rows = await db
  .select({ id, name, type, description, capabilities, similarity })
  .from(entityDirectory)
  .where(and(
    eq(entityDirectory.status, "active"),
    sql`${entityDirectory.id} != ${excludeAgentId}`,
    gt(similarity, SIMILARITY_THRESHOLD),
  ))
  .orderBy(desc(similarity));
```

### Pattern 5: Unconstrained Vector Column (already established)
**What:** customType for pgvector that accepts any dimension
**When to use:** `capabilities_embedding` column in entity_directory table
**Example:**
```typescript
// Source: packages/agents/src/shared/db/schema.ts lines 36-50
const vectorColumn = customType<{ data: number[]; driverData: string }>({
  dataType() { return "vector"; },
  toDriver(value: number[]): string { return `[${value.join(",")}]`; },
  fromDriver(value: string): number[] {
    return value.slice(1, -1).split(",").map(v => Number.parseFloat(v));
  },
});
```

### Anti-Patterns to Avoid
- **Creating a new EmbeddingService instance in the seed script:** The seed script needs embeddings but should create its OWN EmbeddingService from env vars, not depend on the running agent-service. The factory function `createEmbeddingService` is importable directly.
- **Adding the DirectoryService as a singleton:** Follow the same DI pattern as KnowledgeService -- created in `main.ts`, passed to `registerAllTools()`.
- **Filtering by embedding IS NOT NULL in queries:** Unlike knowledge entries (which may lack embeddings due to graceful degradation), directory entries should always have embeddings since they are seeded in a controlled script. If embedding generation fails in the seed script, log an error and skip that entity rather than seeding without an embedding.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Vector similarity search | Custom SQL or application-level cosine | `cosineDistance` from drizzle-orm + pgvector HNSW | Index-backed, tested, handles edge cases |
| Embedding generation | Raw HTTP to embedding APIs | `EmbeddingService` from `shared/embedding/` | Already handles Ollama/Voyage, timeouts, error handling |
| YAML parsing + validation | Manual parsing or raw `JSON.parse` | `yaml` package + Zod schema | Established pattern in AgentRegistry |
| ID generation | `crypto.randomUUID()` or raw nanoid | `createId.directoryEntry()` (add to ids.ts) | Consistent prefixed IDs across the system |
| Seed script DB connection | Manual Pool construction | `loadEnvFromRoot()` + `postgres` client | Matches seed-permissions pattern exactly |

**Key insight:** Every component this phase needs has an existing analog in the codebase. The KnowledgeService is the closest analog for DirectoryService. The seed-permissions scripts are the closest analog for seed-directory.

## Common Pitfalls

### Pitfall 1: Embedding Dimension Mismatch Between Seed Script and Runtime
**What goes wrong:** Seed script generates embeddings with Ollama (768 dims) but production runtime uses Voyage AI (1024 dims). The HNSW index and cosine similarity queries fail or return garbage results because the stored embeddings and query embeddings have different dimensions.
**Why it happens:** The seed script creates its own EmbeddingService instance and may use a different provider than the running agent-service.
**How to avoid:** The seed script MUST read `EMBEDDING_PROVIDER` and `EMBEDDING_DIMENSIONS` from env (same `.env` file). Use `createEmbeddingService` factory from `shared/embedding/index.ts` to ensure identical provider configuration. Document in deploy workflow that seed-directory must run in the same env as the agent-service.
**Warning signs:** `directory:find` returns empty results or wrong ordering despite having seeded entities.

### Pitfall 2: Forgetting to Update schema.drizzle.ts
**What goes wrong:** The entity_directory table is added to `schema.ts` but not mirrored in `schema.drizzle.ts`. Future drizzle-kit migrations will see the table as "new" and try to generate a duplicate CREATE TABLE, or worse, might generate a DROP for the table it doesn't know about.
**Why it happens:** `schema.drizzle.ts` is a parallel copy without external dependencies (for drizzle-kit CJS bundler compatibility). It is easy to forget.
**How to avoid:** Every schema.ts change MUST be mirrored in schema.drizzle.ts. The drizzle version uses inline nanoid instead of `createId` from `@aesir/types`.
**Warning signs:** `pnpm db:generate` produces unexpected migration SQL.

### Pitfall 3: Seed Script Not Handling Missing Embedding Service
**What goes wrong:** `pnpm --filter @aesir/agents seed:directory` is run before Ollama is available (no Docker embedding service running). The embedding call returns null for every entity. Entities are seeded without embeddings. `directory:find` returns empty results because there are no vectors to compare against.
**Why it happens:** The EmbeddingService returns null on failure (graceful degradation). The seed script must NOT treat null embedding as acceptable.
**How to avoid:** Seed script should FAIL HARD if embedding generation returns null. Unlike runtime (where graceful degradation is correct), seeding is a deployment step that must succeed completely. Log the error and exit non-zero.
**Warning signs:** Seed script "succeeds" but `directory:find` returns nothing.

### Pitfall 4: Capability Change Detection with Array Ordering
**What goes wrong:** The seed script compares stored capabilities array against YAML to detect changes. But JSONB array comparison is order-sensitive. If the YAML capabilities are reordered (without changing content), the seed script detects a "change" and regenerates the embedding unnecessarily.
**Why it happens:** JSONB `=` comparison treats `["a","b"]` and `["b","a"]` as different.
**How to avoid:** Sort capabilities arrays before comparison (both stored and YAML). Or compare using a content hash. Since capabilities are short (3-7 items), sorting is simplest.
**Warning signs:** Unnecessary embedding regeneration on every seed run.

### Pitfall 5: Not Adding `directoryEntry` to createId
**What goes wrong:** The entity directory uses `createId.task()` or some random prefix, making IDs inconsistent with the rest of the system.
**Why it happens:** Forgetting to add a new prefix to `packages/types/src/utils/ids.ts`.
**How to avoid:** Add `directoryEntry: () => \`dent_${nanoid()}\`` to `createId` as the first step.
**Warning signs:** Entity IDs don't follow the `prefix_nanoid` convention.

### Pitfall 6: Not Registering Tools in Agent Definition YAML
**What goes wrong:** DirectoryService and tools exist, but agents can't call them because `directory:find` and `directory:get` are not in the agent's `tools` list in `definition.yaml`.
**Why it happens:** Tool registration in `tool-factories.ts` makes tools available to the ToolRegistry, but agents only get tools listed in their YAML definition.
**How to avoid:** Add `directory:find` and `directory:get` to dev-agent and product-agent `definition.yaml` tool lists. Sub-agents (coder, researcher, tester) do NOT get directory tools.
**Warning signs:** Agent tries to use directory tool and gets "tool not found" error.

## Code Examples

### Entity Directory Table Schema
```typescript
// Source: pattern from schema.ts knowledge_entries, adapted for directory
export const entityDirectoryStatusValues = ["active", "inactive"] as const;
export type EntityDirectoryStatus = (typeof entityDirectoryStatusValues)[number];

export const entityDirectoryTypeValues = ["agent", "human"] as const;
export type EntityDirectoryType = (typeof entityDirectoryTypeValues)[number];

export const entityDirectory = agentsSchema.table(
  "entity_directory",
  {
    id: text("id").primaryKey(),
    type: text("type", { enum: entityDirectoryTypeValues }).notNull(),
    name: text("name").notNull(),
    description: text("description"),
    capabilities: jsonb("capabilities").$type<string[]>().notNull().default([]),
    capabilities_embedding: vectorColumn("capabilities_embedding"),
    reach_via: jsonb("reach_via").$type<Record<string, unknown> | null>(),
    status: text("status", { enum: entityDirectoryStatusValues })
      .notNull()
      .default("active"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    last_seeded_at: timestamp("last_seeded_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_directory_type_status").on(table.type, table.status),
    index("idx_directory_name").on(table.name),
    // HNSW index for semantic capability matching
    // Created in migration SQL, not Drizzle (Drizzle doesn't support HNSW params)
  ],
);
```

### Migration SQL
```sql
-- Phase 69: Entity Directory
CREATE TABLE agents.entity_directory (
  id                      TEXT PRIMARY KEY,
  type                    TEXT NOT NULL CHECK (type IN ('agent', 'human')),
  name                    TEXT NOT NULL,
  description             TEXT,
  capabilities            JSONB NOT NULL DEFAULT '[]',
  capabilities_embedding  vector,
  reach_via               JSONB,
  status                  TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  metadata                JSONB DEFAULT '{}',
  last_seeded_at          TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

--> statement-breakpoint

CREATE INDEX idx_directory_type_status ON agents.entity_directory(type, status);

--> statement-breakpoint

CREATE INDEX idx_directory_name ON agents.entity_directory(name);

--> statement-breakpoint

-- HNSW cosine similarity index for semantic capability matching
CREATE INDEX idx_directory_embedding_cosine
  ON agents.entity_directory
  USING hnsw (capabilities_embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

### Definition.yaml Capabilities Extension
```yaml
# dev-agent/definition.yaml -- new field added
capabilities:
  - "implement features by writing code, creating branches, and opening pull requests"
  - "debug failures, investigate issues, and deliver fixes"
  - "research codebases to understand architecture, patterns, and dependencies"
  - "run test suites and validate code changes meet requirements"
  - "address pull request review feedback and iterate until approved"
```

### Zod Schema Extension
```typescript
// Source: framework/types.ts AgentDefinitionYamlSchema -- add to existing schema
capabilities: z.array(z.string().min(1)).optional(),
```

### DirectoryService find() Implementation Pattern
```typescript
// Source: knowledge-service.ts query() method, adapted for directory
async find(query: string, excludeAgentId: string): Promise<DirectoryEntry[]> {
  const queryEmbedding = await embeddingService.embed(query);
  if (!queryEmbedding) {
    // DIR-06: graceful degradation -- return empty on embedding failure
    log.warn("Embedding generation failed for directory query, returning empty");
    return [];
  }

  const similarity = sql<number>`1 - (${cosineDistance(
    entityDirectory.capabilities_embedding,
    queryEmbedding,
  )})`;

  const rows = await db
    .select({
      id: entityDirectory.id,
      name: entityDirectory.name,
      type: entityDirectory.type,
      description: entityDirectory.description,
      capabilities: entityDirectory.capabilities,
    })
    .from(entityDirectory)
    .where(
      and(
        eq(entityDirectory.status, "active"),
        sql`${entityDirectory.id} != ${excludeAgentId}`,
        gt(similarity, SIMILARITY_THRESHOLD),
      ),
    )
    .orderBy(desc(similarity));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type as "agent" | "human",
    description: row.description ?? "",
    capabilities: row.capabilities as string[],
  }));
}
```

### Seed Script Upsert Pattern
```typescript
// Source: seed-permissions.ts pattern, extended for directory
for (const def of definitions) {
  if (!def.capabilities || def.capabilities.length === 0) continue;

  // Check if capabilities changed
  const [existing] = await db
    .select({ capabilities: entityDirectory.capabilities })
    .from(entityDirectory)
    .where(eq(entityDirectory.id, def.id))
    .limit(1);

  const capsChanged = !existing ||
    JSON.stringify(sortedCaps(existing.capabilities)) !==
    JSON.stringify(sortedCaps(def.capabilities));

  let embedding: number[] | null = null;
  if (capsChanged) {
    const capsText = def.capabilities.join(". ");
    embedding = await embeddingService.embed(capsText);
    if (!embedding) {
      console.error(`  FAILED: Could not generate embedding for ${def.id}`);
      process.exit(1);  // Hard fail -- seeding must succeed completely
    }
  }

  await db
    .insert(entityDirectory)
    .values({
      id: def.id,  // Use agent definition ID directly (e.g., "dev-agent")
      type: "agent",
      name: def.name,
      description: def.description,
      capabilities: def.capabilities,
      capabilities_embedding: capsChanged ? embedding : undefined,
      status: "active",
      last_seeded_at: new Date(),
    })
    .onConflictDoUpdate({
      target: entityDirectory.id,
      set: {
        name: def.name,
        description: def.description,
        capabilities: def.capabilities,
        ...(capsChanged && embedding ? { capabilities_embedding: embedding } : {}),
        status: "active",
        last_seeded_at: new Date(),
        updated_at: new Date(),
      },
    });
}
```

### Tool Factory Registration
```typescript
// In tool-factories.ts, add to RegisterAllToolsOptions:
//   directoryService: DirectoryService;

// Registration section:
// -- Directory tools (2) --
const ds = options.directoryService;
registry.register("directory:find", (ctx) => createDirectoryFindTool(ds, ctx));
registry.register("directory:get", (ctx) => createDirectoryGetTool(ds, ctx));
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No agent discovery | Hardcoded agent IDs in prompts | Pre-v2.7 | Agents cannot dynamically choose delegation targets |
| No shared memory | Knowledge entries with pgvector | Phase 68 (2026-02-10) | Embedding pipeline established and reusable |
| Fixed vector dimensions | Unconstrained vectorColumn customType | Phase 68 | No schema changes needed for provider switching |

**Already established (from Phase 68):**
- pgvector extension enabled in PostgreSQL
- Docker image: `pgvector/pgvector:pg15` (already swapped)
- HNSW index pattern with `m=16, ef_construction=64`
- `cosineDistance` from drizzle-orm for similarity queries
- `EmbeddingService` interface with Ollama/Voyage providers
- Unconstrained `vectorColumn` customType
- `SIMILARITY_THRESHOLD = 0.3` in knowledge service

## Design Recommendations (Claude's Discretion Areas)

### Similarity Threshold: Start at 0.3
**Recommendation:** Use the same `SIMILARITY_THRESHOLD = 0.3` as the knowledge service. With only 2 entities (dev-agent, product-agent), the threshold is almost irrelevant -- both will either match or not based on query relevance. The threshold becomes meaningful when more agents are added (Phase 73 QA agent). Define as a constant, not a config value, until tuning data exists.
**Confidence:** MEDIUM -- the 0.3 threshold works well for knowledge queries based on Phase 68 testing, but directory capabilities are shorter text blocks which may behave differently. Monitor and adjust.

### Entity ID Strategy: Use Agent Definition ID Directly
**Recommendation:** Use the agent's `id` from `definition.yaml` (e.g., `"dev-agent"`, `"product-agent"`) as the entity directory `id`, NOT a generated `dent_` prefixed ID. Rationale:
1. Entity IDs must be stable across seed runs for `ON CONFLICT` to work
2. The agent definition ID is the natural key -- it is what agents would reference when delegating
3. Future human entries would use a `hum_` prefix or a config-defined ID
4. This avoids the need for a lookup step between "agent name" and "directory entry ID"

However, `createId.directoryEntry()` should still be added to `ids.ts` for future human entries which won't have a natural key from a YAML file.

### Error Messages for directory:get
**Recommendation:**
- Active entity found: return full entity details
- Entity not found (no row): `"Entity not found: {entityId}"`
- Entity exists but inactive: `"Entity '{name}' is currently inactive"`
- This distinguishes "never existed" from "was deactivated" which is useful for debugging stale directory references.

### Startup Staleness Warning: Include It
**Recommendation:** Add a lightweight staleness check in `main.ts` during bootstrap. It is a single stat() + SELECT comparison, costs nothing, and helps catch forgotten seed runs during development. Implementation:
```typescript
// After agentRegistry.list()
const defs = await agentRegistry.list();
for (const def of defs.filter(d => d.capabilities?.length)) {
  const yamlMtime = await stat(join(DEFINITIONS_DIR, def.id, "definition.yaml"));
  const [entry] = await db.select({ lastSeeded: entityDirectory.last_seeded_at })
    .from(entityDirectory).where(eq(entityDirectory.id, def.id)).limit(1);
  if (!entry || !entry.lastSeeded || yamlMtime.mtimeMs > entry.lastSeeded.getTime()) {
    logger.warn({ agentId: def.id }, "Entity directory may be stale -- run seed:directory");
  }
}
```
This is opt-in (runs only if the entity_directory table exists) and non-blocking.

## Open Questions

1. **Package.json script entry**
   - What we know: The seed script goes to `packages/agents/scripts/seed-directory.ts` and is invoked via `pnpm --filter @aesir/agents seed:directory`
   - What's unclear: The agents `package.json` currently has no `seed:*` scripts (unlike the integration packages). Need to add `"seed:directory": "tsx scripts/seed-directory.ts"` to agents `package.json`
   - Recommendation: Add it; follows established convention

2. **AgentDefinition interface extension**
   - What we know: `AgentDefinitionYamlSchema` needs `capabilities` added. The `AgentDefinition` interface extends `AgentDefinitionYamlSchema` so it inherits the field automatically via Zod inference.
   - What's unclear: Does `loadDefinition()` in `agent-registry.ts` need to explicitly handle the optional `capabilities` field like it does for `temperature`, `subAgents`, and `triggers`?
   - Recommendation: Yes, for `exactOptionalPropertyTypes` compliance. The `loadDefinition()` function uses manual property assignment for optional fields. Add `capabilities` to that block.

3. **Agent definition.yaml tool list ordering**
   - What we know: `directory:find` and `directory:get` need to be added to orchestrator YAMLs
   - What's unclear: Whether knowledge tools should also be added in this phase or if that happened in Phase 68
   - Recommendation: Check if knowledge tools are already in YAML. If not, add both knowledge and directory tools to orchestrator definitions in this phase as a single step.

## Sources

### Primary (HIGH confidence)
- `packages/agents/src/shared/services/knowledge-service.ts` -- pgvector query patterns, cosineDistance usage, similarity threshold, graceful degradation
- `packages/agents/src/shared/db/schema.ts` -- vectorColumn customType, table definition patterns, JSONB types
- `packages/agents/src/shared/db/migrations/0007_add_knowledge_entries.sql` -- HNSW index creation, statement-breakpoint syntax
- `packages/agents/src/framework/types.ts` -- AgentDefinitionYamlSchema, ToolContext, ToolFactory, AgentRegistry interface
- `packages/agents/src/framework/tool-factories.ts` -- tool registration patterns, RegisterAllToolsOptions
- `packages/agents/src/framework/agent-registry.ts` -- YAML loading, mtime cache, definition loading
- `packages/agents/src/shared/embedding/types.ts` -- EmbeddingService interface, EmbeddingConfig
- `packages/agents/src/shared/embedding/factory.ts` -- createEmbeddingService factory
- `packages/agents/src/service/main.ts` -- bootstrap sequence, service injection pattern
- `packages/integrations/linear/scripts/seed-permissions.ts` -- seed script pattern, loadEnvFromRoot, postgres client
- `packages/types/src/utils/ids.ts` -- createId prefix convention

### Secondary (MEDIUM confidence)
- `.planning/research/ARCHITECTURE.md` -- entity_directory table design, DirectoryService interface
- `.planning/specs/2.7-agent-collaboration.md` -- Phase 72 spec (original numbering), success criteria

### Tertiary (LOW confidence)
- None -- all findings verified against existing codebase

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already in use, no new dependencies
- Architecture: HIGH -- every pattern has a direct analog in the existing codebase
- Pitfalls: HIGH -- identified from actual codebase patterns and Phase 68 learnings
- Schema design: HIGH -- follows established knowledge_entries pattern exactly

**Research date:** 2026-02-10
**Valid until:** 2026-03-10 (stable -- no external dependency changes expected)
