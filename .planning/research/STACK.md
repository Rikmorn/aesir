# Technology Stack: v2.7 Agent Collaboration

**Project:** Aesir v2.7 -- Multi-agent collaboration (shared memory, entity directory, task delegation, completion signaling, delegation graph observability, QA agent)
**Researched:** 2026-02-10
**Research mode:** Stack additions for subsequent milestone
**Overall confidence:** HIGH (most additions are well-established; Linear Agent SDK is developer preview -- MEDIUM)

---

## Executive Summary

v2.7 introduces **5 new npm dependencies** and **1 infrastructure change** (Docker image swap). The core additions are:

1. **`@linear/sdk` upgrade to ^75.0.0** -- for agent activity methods (`createAgentActivity`, `agentSessionId` tracking)
2. **Docker image swap from `postgres:15-alpine` to `pgvector/pgvector:pg15`** -- adds pgvector extension for vector similarity search
3. **`pgvector` npm package** -- type-safe vector operations with Drizzle ORM
4. **`voyageai` npm package** -- embedding generation via Voyage AI's TypeScript SDK (Anthropic's recommended provider)
5. **`@xyflow/react` + `@dagrejs/dagre`** -- delegation graph visualization in the dashboard

This is a significant but controlled expansion. The new dependencies are tightly scoped: pgvector + voyageai serve shared memory and entity directory; @xyflow/react + dagre serve dashboard visualization; @linear/sdk upgrade serves the Agent SDK migration. No new services are added -- all capabilities integrate into existing packages.

---

## Recommended Stack

### 1. Linear Agent SDK Migration (Phase 70)

#### @linear/sdk Upgrade

| Property | Value |
|----------|-------|
| Package | `@linear/sdk` |
| Current version | `^70.0.0` |
| Target version | `^75.0.0` |
| Location | `packages/integrations/linear/package.json` |
| Confidence | MEDIUM -- Agent SDK is developer preview as of 2025-07-30 |

**Why upgrade:** Version 75.0.0 (published 2026-02-10) includes the full Agent Interaction SDK: `createAgentActivity()` method, `AgentActivityCreateInput` types, agent session webhook event types. The current ^70.0.0 may already resolve to a version with these features (npm semver range), but pinning to ^75.0.0 ensures the agent activity API is available.

**Key SDK additions used:**

```typescript
// Agent activity creation (new in Agent SDK)
const { success, agentActivity } = await linearClient.createAgentActivity({
  agentSessionId: "session-uuid",
  content: {
    type: "response",    // thought | elicitation | action | response | error
    body: "Implementation complete. PR #42 created.",
  },
});
```

**Activity content types:**

| Type | Fields | Maps from |
|------|--------|-----------|
| `thought` | `body: string` | Reasoning blocks, internal notes |
| `elicitation` | `body: string` | `communication:ask` |
| `action` | `action: string, parameter: string, result?: string` | Tool invocations |
| `response` | `body: string` (Markdown) | `communication:reply` |
| `error` | `body: string` (Markdown) | Agent errors |

**No separate Agent SDK package.** Linear ships agent features within `@linear/sdk` itself -- there is no `@linear/agent-sdk` or similar. The SDK is auto-generated from Linear's GraphQL schema, so agent activity methods appear when the schema includes them.

#### OAuth Changes

| Property | Value |
|----------|-------|
| Parameter | `actor=app` added to OAuth authorization URL |
| New scopes | `app:assignable`, `app:mentionable` |
| Impact | Re-authorization required for existing installations |
| File | `packages/integrations/linear/src/oauth/flow.ts` (or wherever auth URL is constructed) |

**What `actor=app` does:** All mutations (issue creates, comments, status changes) are performed by the app itself, not on behalf of the installing user. The agent gets its own workspace identity with configurable name and avatar.

**Identity customization via mutation fields:**
- `createAsUser`: Display name for the app actor
- `displayIconUrl`: Avatar URL

These fields on `issueCreate` and `commentCreate` mutations configure how the agent appears. For `createAgentActivity`, the app identity is used automatically.

**Webhook events (agent sessions):**
- `agent_session.created` -- new session triggered by mention or delegation; agent must respond within 10 seconds
- `agent_session.prompted` -- user sent follow-up message; prompt text in `agentActivity.body`

Both include `promptContext` (formatted string with issue details, comments, workspace guidance) and structured fields like `agentSession.issue`.

#### What NOT to add for Linear

| Temptation | Why Not |
|------------|---------|
| Separate Linear Agent SDK package | Does not exist. Agent features are in `@linear/sdk`. |
| Custom GraphQL client for agent mutations | The SDK wraps GraphQL. Use `linearClient.createAgentActivity()`, not raw mutations. |
| Webhook signature library change | Existing webhook verification is unchanged. Agent session events use the same delivery mechanism. |

---

### 2. Vector Search Infrastructure (Phases 71, 72)

#### pgvector Extension (Docker Image Swap)

| Property | Value |
|----------|-------|
| Current image | `postgres:15-alpine` |
| Target image | `pgvector/pgvector:pg15` |
| Location | `docker-compose.yml` line 53 |
| Extension | `CREATE EXTENSION IF NOT EXISTS vector;` |
| Confidence | HIGH -- pgvector is the standard Postgres vector extension; Docker image is officially maintained |

**Why swap the Docker image (not compile pgvector in Alpine):** The `postgres:15-alpine` image does not include pgvector. Options:

1. **`pgvector/pgvector:pg15`** -- Official pgvector Docker image based on the official PostgreSQL image. Drop-in replacement. Includes pgvector pre-compiled. **Use this.**
2. Custom Dockerfile extending `postgres:15-alpine` with `apk add` + compile -- fragile, slow builds, Alpine's musl libc can cause issues with pgvector's C code.
3. `ankane/pgvector` -- community image, less maintained than the official pgvector org image.

The `pgvector/pgvector:pg15` image is a thin layer over the official `postgres:15` image (Debian-based, not Alpine). This means the data directory format is compatible -- existing volumes will work. The image adds only the pgvector shared library.

**Migration note:** The first migration for Phase 71 must include `CREATE EXTENSION IF NOT EXISTS vector;` before any vector column definitions. This is a one-time operation per database.

#### pgvector npm Package

| Property | Value |
|----------|-------|
| Package | `pgvector` |
| Version | `^0.2.0` |
| Install in | `packages/agents/package.json` |
| Confidence | HIGH -- 430+ stars, supports Drizzle ORM, node-postgres, and postgres.js |

**Why this package:** Provides type registration for the `pg` driver (which the agents package uses) and utility functions for vector serialization. Drizzle ORM has built-in `vector()` column type support, but `pgvector` npm package adds:

1. `pgvector.registerTypes(client)` -- registers the vector type with node-postgres so query results return proper arrays instead of strings
2. `pgvector.toSql([1, 2, 3])` -- serializes arrays to PostgreSQL vector format for raw queries
3. Named distance function imports for use outside Drizzle

**Drizzle ORM vector support (already available, no new package):**

```typescript
import { index, pgTable, text, vector } from "drizzle-orm/pg-core";
import { cosineDistance, gt, sql, desc } from "drizzle-orm";

// Schema definition with vector column
export const knowledgeEntries = pgTable(
  "knowledge_entries",
  {
    id: text("id").primaryKey(),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 1024 }),
    // ... other columns
  },
  (table) => [
    index("knowledge_embedding_idx")
      .using("hnsw", table.embedding.op("vector_cosine_ops")),
  ],
);

// Similarity search query
const similarity = sql<number>`1 - (${cosineDistance(knowledgeEntries.embedding, queryEmbedding)})`;

const results = await db
  .select({ id: knowledgeEntries.id, content: knowledgeEntries.content, similarity })
  .from(knowledgeEntries)
  .where(gt(similarity, 0.5))
  .orderBy(desc(similarity))
  .limit(10);
```

**Available distance functions in Drizzle:**
- `cosineDistance` -- use this (normalized, matches Voyage AI output)
- `l2Distance` -- Euclidean distance
- `innerProduct` -- dot product
- `l1Distance`, `hammingDistance`, `jaccardDistance`

**Index type recommendation:** Use HNSW (Hierarchical Navigable Small World) over IVFFlat. HNSW provides better recall at query time without requiring periodic rebuilds. For the expected dataset size (thousands of knowledge entries, not millions), HNSW performance is excellent.

#### Embedding Generation: Voyage AI

| Property | Value |
|----------|-------|
| Package | `voyageai` |
| Version | `^0.1.0` |
| Install in | `packages/agents/package.json` |
| Model | `voyage-3.5-lite` (1024 dimensions, optimized for latency/cost) |
| Confidence | HIGH -- Anthropic's official recommendation; TypeScript SDK is production-ready |

**Why Voyage AI over OpenAI:**

| Factor | Voyage AI (`voyage-3.5-lite`) | OpenAI (`text-embedding-3-small`) |
|--------|-------------------------------|-----------------------------------|
| Anthropic alignment | Official Anthropic partner and recommendation | Competitor's service |
| Dimensions | 1024 (default), configurable 256/512/2048 | 1536 (fixed) |
| Pricing | $0.02/1M tokens (200M free tokens per account) | $0.02/1M tokens |
| Code optimized model | `voyage-code-3` available for code knowledge | No code-specific variant |
| Retrieval quality | Higher on MTEB benchmarks (68.6%) | Lower overall retrieval scores |
| TypeScript SDK | `voyageai` (0.1.0, official) | `openai` (6.18.0, mature) |

**Recommendation: Use `voyage-3.5-lite` for general knowledge, `voyage-code-3` for code-related knowledge.**

The platform already uses Anthropic for LLM -- aligning on Anthropic's recommended embedding provider simplifies vendor management. Voyage's `input_type` parameter (query vs document) improves retrieval quality for the knowledge:query use case.

**Usage pattern:**

```typescript
import { VoyageAIClient } from "voyageai";

const voyage = new VoyageAIClient({ apiKey: process.env.VOYAGE_API_KEY });

// Store: embed as document
const docResult = await voyage.embed({
  input: ["Auth middleware uses JWT, located at src/middleware/auth.ts"],
  model: "voyage-3.5-lite",
  inputType: "document",
});
const embedding = docResult.data[0].embedding; // number[1024]

// Query: embed as query
const queryResult = await voyage.embed({
  input: ["what do we know about authentication?"],
  model: "voyage-3.5-lite",
  inputType: "query",
});
```

**Environment variable:** `VOYAGE_API_KEY` -- add to `.env.example`, Docker Compose agent-service environment, and Zod env config.

**Fallback option:** If Voyage AI is not available or adds unacceptable latency, OpenAI `text-embedding-3-small` via the `openai` npm package (v6.18.0) is a drop-in alternative. The embedding dimension would change to 1536, requiring a schema migration. Design the embedding service as an abstraction layer to enable provider swapping.

#### Embedding Dimensions: 1024

**Use 1024 dimensions** across all vector columns. This matches `voyage-3.5-lite` default output and provides a good balance between retrieval quality and storage/index performance. Both the knowledge store (Phase 71) and entity directory (Phase 72) should use the same dimensionality for consistency.

If code-specific knowledge uses `voyage-code-3`, that model also defaults to 1024 dimensions, so no separate column dimension is needed.

---

### 3. Knowledge Store Schema (Phase 71)

#### PostgreSQL Schema Pattern

No new npm packages needed -- uses existing Drizzle ORM with pgvector support.

**Schema design for `agents.knowledge_entries`:**

```sql
CREATE TABLE agents.knowledge_entries (
  id            TEXT PRIMARY KEY,

  -- Classification
  type          TEXT NOT NULL CHECK (type IN ('discovery', 'architecture_decision', 'constraint', 'thought', 'test_result')),
  scope         TEXT NOT NULL DEFAULT 'shared' CHECK (scope IN ('shared', 'private')),

  -- Content
  content       TEXT NOT NULL,
  embedding     vector(1024),

  -- Metadata
  confidence    TEXT NOT NULL DEFAULT 'medium' CHECK (confidence IN ('low', 'medium', 'high')),
  author_agent  TEXT NOT NULL,
  conversation_id TEXT,
  tags          TEXT[] DEFAULT '{}',
  metadata      JSONB DEFAULT '{}',

  -- Lifecycle
  expires_at    TIMESTAMPTZ,
  superseded_by TEXT REFERENCES agents.knowledge_entries(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Vector similarity search index
CREATE INDEX knowledge_embedding_idx ON agents.knowledge_entries
  USING hnsw (embedding vector_cosine_ops);

-- Scoped queries (shared knowledge for all agents, private for specific agent)
CREATE INDEX knowledge_scope_type_idx ON agents.knowledge_entries(scope, type)
  WHERE superseded_by IS NULL AND (expires_at IS NULL OR expires_at > now());

-- Author lookup (for private notepad)
CREATE INDEX knowledge_author_idx ON agents.knowledge_entries(author_agent, scope)
  WHERE scope = 'private';
```

**Why NOT ltree for knowledge classification:** The knowledge classification is a flat taxonomy (type + tags), not a deep hierarchy. `ltree` is designed for deep tree structures (file paths, org charts). For a flat set of types with tag-based filtering, standard `TEXT CHECK` + `TEXT[]` is simpler and sufficient. If knowledge needs hierarchical topics later, add a `topic` ltree column -- but don't over-engineer for v1.

**Why NOT a separate vector database (Pinecone, Weaviate, Qdrant):** pgvector in PostgreSQL keeps the architecture simple. Knowledge entries need transactional consistency with other agent data (conversations, tasks). A separate vector DB adds operational complexity (another service, connection management, consistency issues) for a dataset that will be thousands of entries, not millions. pgvector handles this scale with HNSW indexes trivially.

---

### 4. Entity Directory Schema (Phase 72)

#### PostgreSQL Schema Pattern

No new npm packages needed -- uses existing Drizzle ORM with pgvector support.

**Schema design for `agents.entities`:**

```sql
CREATE TABLE agents.entities (
  id              TEXT PRIMARY KEY,
  type            TEXT NOT NULL CHECK (type IN ('agent', 'human')),
  name            TEXT NOT NULL,
  description     TEXT,

  -- Capabilities (natural language, embedded for semantic search)
  capabilities    TEXT[] NOT NULL DEFAULT '{}',
  capability_embedding vector(1024),

  -- Reachability
  reach_via       JSONB DEFAULT '{}',  -- { "slack": "#aesir-dev", "linear": true }

  -- Metadata
  source          TEXT NOT NULL CHECK (source IN ('yaml', 'config', 'manual')),
  metadata        JSONB DEFAULT '{}',

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Semantic capability search
CREATE INDEX entity_capability_idx ON agents.entities
  USING hnsw (capability_embedding vector_cosine_ops);

-- Type-based queries
CREATE INDEX entity_type_idx ON agents.entities(type);
```

**Capability matching strategy:** Combine the capabilities array into a single text for embedding: `"implement code changes, open pull requests, write tests"`. The `directory:find` tool embeds the query ("who can implement code changes?") and performs cosine similarity against `capability_embedding`. This is more flexible than keyword matching -- "code implementation" matches "implement code changes" semantically.

**Why embed capabilities (not just text search):** Text search (`tsvector`) requires exact keyword overlap. An agent asking "who can review PRs?" should match an entity with capability "code review and pull request approval" -- semantic similarity handles this naturally. The entity directory is small (tens of entities), so embedding at seed time is cheap.

---

### 5. Task Tree Schema (Phase 73)

#### Existing Infrastructure (No New Packages)

The task tree structure already exists in the `agents.tasks` table:

```sql
-- Already exists in migration 0005_add_task_tables.sql
parent_id TEXT REFERENCES agents.tasks(id)
```

**What needs to be added for delegation:**

```sql
-- New columns for delegation (migration 0007 or similar)
ALTER TABLE agents.tasks
  ADD COLUMN callback_conversation_id TEXT REFERENCES agents.conversations(id),
  ADD COLUMN delegation_status TEXT CHECK (delegation_status IN ('pending', 'accepted', 'rejected', 'completed', 'failed', 'timed_out')),
  ADD COLUMN delegated_to_entity TEXT,
  ADD COLUMN delegation_context JSONB DEFAULT '{}',
  ADD COLUMN estimated_duration_ms BIGINT,
  ADD COLUMN deadline_at TIMESTAMPTZ;
```

**Tree query pattern -- recursive CTE (not ltree):**

```sql
-- Get full task tree from root
WITH RECURSIVE task_tree AS (
  SELECT id, parent_id, title, status, delegation_status, 0 AS depth
  FROM agents.tasks
  WHERE id = $1  -- root task ID

  UNION ALL

  SELECT t.id, t.parent_id, t.title, t.status, t.delegation_status, tt.depth + 1
  FROM agents.tasks t
  JOIN task_tree tt ON t.parent_id = tt.id
)
SELECT * FROM task_tree ORDER BY depth, created_at;
```

**Why recursive CTE (not ltree):** Task trees are shallow (3-4 levels in practice) and write-heavy (new tasks created frequently). ltree requires maintaining a materialized path column, which adds trigger complexity for no performance benefit at shallow depths. Recursive CTEs are the idiomatic PostgreSQL solution for task trees and are well-supported by Drizzle ORM's `sql` template literal.

---

### 6. Dashboard Visualization (Phase 75)

#### @xyflow/react (React Flow)

| Property | Value |
|----------|-------|
| Package | `@xyflow/react` |
| Version | `^12.10.0` |
| Install in | `packages/dashboard/package.json` |
| Confidence | HIGH -- actively maintained, React 19 compatible, Next.js examples available |

**Why @xyflow/react (not react-d3-tree or custom SVG):**

| Factor | @xyflow/react | react-d3-tree | Custom SVG |
|--------|---------------|---------------|------------|
| React 19 | Yes (v12.10.0, updated Oct 2025) | Unclear (last published ~1 year ago) | N/A |
| Interactivity | Built-in pan, zoom, click, selection | Basic click handling | Must build everything |
| Node customization | Full React components as nodes | Limited via `renderCustomNodeElement` | Full control but high effort |
| Edge routing | Bezier, step, smoothstep, straight | Fixed tree links | Must implement |
| Layout algorithms | Dagre, ELK via examples | Built-in D3 tree only | Must implement |
| Ecosystem | 23K+ GitHub stars, active maintenance | 1K stars, infrequent updates | N/A |
| Dashboard fit | shadcn/ui + Tailwind compatible | Harder to style consistently | Full control |

React Flow is the de facto standard for interactive node-based UIs in React. The delegation graph (task tree with conversation links and signal edges) maps directly to React Flow's node + edge model. Custom node components can render task status, agent identity, and timing information inline.

**Usage pattern:**

```typescript
import { ReactFlow, Background, Controls } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

// Task tree nodes
const nodes = taskTree.map((task) => ({
  id: task.id,
  type: "taskNode", // custom node component
  position: { x: 0, y: 0 }, // computed by dagre
  data: { task },
}));

// Delegation edges
const edges = taskTree
  .filter((t) => t.parentId)
  .map((task) => ({
    id: `${task.parentId}-${task.id}`,
    source: task.parentId,
    target: task.id,
    type: "smoothstep",
    animated: task.status === "active",
  }));
```

#### @dagrejs/dagre (Layout Algorithm)

| Property | Value |
|----------|-------|
| Package | `@dagrejs/dagre` |
| Version | `^2.0.3` |
| Install in | `packages/dashboard/package.json` |
| Confidence | HIGH -- standard layout library for React Flow, 137 dependents |

**Why dagre (not elkjs or custom):** Dagre is a directed graph layout algorithm specifically designed for hierarchical/tree layouts. It is the recommended layout library in React Flow's documentation. ELK (Eclipse Layout Kernel) is more powerful but adds significant bundle size (~400KB vs dagre's ~30KB) and is overkill for task trees.

**Layout computation:**

```typescript
import dagre from "@dagrejs/dagre";

function getLayoutedElements(nodes, edges) {
  const g = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", ranksep: 80, nodesep: 40 });

  nodes.forEach((node) => g.setNode(node.id, { width: 280, height: 120 }));
  edges.forEach((edge) => g.setEdge(edge.source, edge.target));

  dagre.layout(g);

  return {
    nodes: nodes.map((node) => {
      const pos = g.node(node.id);
      return { ...node, position: { x: pos.x - 140, y: pos.y - 60 } };
    }),
    edges,
  };
}
```

#### What NOT to add for dashboard

| Temptation | Why Not |
|------------|---------|
| D3.js directly | React Flow wraps D3 concepts in React idioms. Direct D3 + React is painful (imperative vs declarative mismatch). |
| Mermaid.js for diagrams | Static rendering, no interactivity. Task trees need click-through to conversations. |
| vis.js / vis-network | Not React-native. Requires ref-based imperative code. Poor fit with Next.js RSC. |
| elkjs for layout | 10x bundle size of dagre for features we don't need (port constraints, layer optimization). Use dagre. |
| Recharts for tree viz | Recharts is for charts (bar, line, area). Already in dashboard for metrics. Not for graph layouts. |

---

### 7. Completion Signaling (Phase 74)

#### No New Packages

Completion signaling builds entirely on existing infrastructure:

- **pg-boss** (already at `^12.8.0` in agents) -- for timeout scheduling. Delegation timeouts use `pg-boss.send()` with a delay, same pattern as `wait_for` timeouts.
- **Signal infrastructure** -- existing `signal()` method on ConversationExecutor handles waking waiting conversations.
- **Task state machine** -- new status transitions (`pending` -> `accepted` -> `completed`/`failed`) trigger signal dispatch via event log subscribers.

The `callbackConversationId` on tasks (see Section 5) enables routing: when a task completes, the system looks up the callback conversation and delivers a completion signal.

---

### 8. QA Agent (Phase 76)

#### No New Packages

The QA agent is a new agent definition (YAML + prompt.md) that uses existing tool namespaces:
- `codebase:run_command` -- for test execution
- `codebase:read_file`, `codebase:search_codebase` -- for PR diff review
- `knowledge:store`, `knowledge:query` -- for storing/retrieving test results
- `directory:find`, `directory:get` -- for discovering dev-agent
- `task:delegate` -- for delegating fixes back
- `communication:reply`, `communication:ask` -- for reporting results

No new runtime dependencies. The QA agent exercises existing collaboration primitives.

---

## Full Dependency Summary

### New Dependencies (5 packages)

| Package | Version | Install in | Purpose | Phase |
|---------|---------|------------|---------|-------|
| `voyageai` | `^0.1.0` | `@aesir/agents` | Embedding generation for knowledge store + entity directory | 71, 72 |
| `pgvector` | `^0.2.0` | `@aesir/agents` | Vector type registration for node-postgres driver | 71, 72 |
| `@xyflow/react` | `^12.10.0` | `@aesir/dashboard` | Interactive delegation graph visualization | 75 |
| `@dagrejs/dagre` | `^2.0.3` | `@aesir/dashboard` | Hierarchical layout algorithm for task trees | 75 |
| `@xyflow/react` CSS | (included) | `@aesir/dashboard` | Required stylesheet for React Flow | 75 |

### Upgraded Dependencies (1 package)

| Package | From | To | Install in | Purpose | Phase |
|---------|------|----|------------|---------|-------|
| `@linear/sdk` | `^70.0.0` | `^75.0.0` | `@aesir/integration-linear` | Agent activity API, session types | 70 |

### Infrastructure Changes (1 change)

| Change | From | To | Location | Phase |
|--------|------|----|----------|-------|
| Docker image | `postgres:15-alpine` | `pgvector/pgvector:pg15` | `docker-compose.yml` | 71 |

### New Environment Variables (2 variables)

| Variable | Service | Purpose | Phase |
|----------|---------|---------|-------|
| `VOYAGE_API_KEY` | agent-service | Voyage AI API key for embedding generation | 71 |
| `VOYAGE_MODEL` | agent-service | Model name override (default: `voyage-3.5-lite`) | 71 |

### No-Change Dependencies (confirmed sufficient)

| Package | Current | Used for | Why sufficient |
|---------|---------|----------|----------------|
| `drizzle-orm` | `^0.45.1` | Vector column type, distance functions | Built-in pgvector support since v0.28.0 |
| `pg` | `^8.17.2` | PostgreSQL driver | Works with pgvector npm package for type registration |
| `pg-boss` | `^12.8.0` | Delegation timeout scheduling | Same delayed job pattern as wait_for timeouts |
| `zod` | `3.25.67` | New tool schemas, knowledge entry validation | Already used everywhere |
| `nanoid` | `^5.1.6` | ID generation for knowledge entries, entities | Already used for all IDs |
| `@anthropic-ai/sdk` | `^0.72.0` | Agent loops | Unchanged |
| `recharts` | `^2.15.4` | Dashboard metrics charts | Not used for graph visualization |

---

## Installation

```bash
# Phase 70: Linear Agent SDK
pnpm --filter @aesir/integration-linear add @linear/sdk@^75.0.0

# Phase 71-72: Vector search (shared memory + entity directory)
pnpm --filter @aesir/agents add voyageai@^0.1.0 pgvector@^0.2.0

# Phase 75: Dashboard visualization (delegation graph)
pnpm --filter @aesir/dashboard add @xyflow/react@^12.10.0 @dagrejs/dagre@^2.0.3

# Docker image swap (docker-compose.yml)
# Change: image: postgres:15-alpine
# To:     image: pgvector/pgvector:pg15

# Database migration (first vector-enabled migration)
# Include: CREATE EXTENSION IF NOT EXISTS vector;
```

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Embedding provider | Voyage AI (`voyage-3.5-lite`) | OpenAI (`text-embedding-3-small`) | Anthropic recommends Voyage; 1024 dims vs 1536; code-specific model available; same pricing |
| Embedding provider | Voyage AI | Local model (e.g., `all-MiniLM-L6-v2`) | Adds model serving infrastructure; lower quality; not worth complexity for agent knowledge |
| Vector database | pgvector (in PostgreSQL) | Pinecone / Weaviate / Qdrant | Separate service adds operational complexity; knowledge dataset is small (thousands, not millions); pgvector handles this trivially |
| Graph visualization | @xyflow/react | react-d3-tree | Unclear React 19 support; less interactive; limited customization |
| Graph visualization | @xyflow/react | vis.js / vis-network | Not React-native; imperative API; poor fit with Next.js |
| Graph layout | @dagrejs/dagre | elkjs | 10x bundle size for features not needed; dagre handles hierarchical trees perfectly |
| Hierarchical queries | Recursive CTE | PostgreSQL ltree | Task trees are shallow (3-4 levels); ltree adds trigger maintenance overhead for no performance benefit |
| Linear agent features | @linear/sdk upgrade | Custom GraphQL client | SDK provides typed methods; no benefit to bypassing it |
| Embedding SDK | `voyageai` npm | Raw fetch to Voyage HTTP API | SDK provides retry, timeout, TypeScript types; raw fetch loses all of this |

---

## Confidence Assessment

| Area | Confidence | Reason |
|------|------------|--------|
| pgvector + Drizzle ORM | HIGH | Well-documented integration, official Drizzle guide, widely used |
| Voyage AI embeddings | HIGH | Anthropic's official recommendation, TypeScript SDK exists, competitive pricing |
| @xyflow/react + dagre | HIGH | Industry standard for React graph visualization, React 19 compatible, active maintenance |
| @linear/sdk agent activities | MEDIUM | Agent SDK is developer preview (launched 2025-07-30); API surface may evolve; schema is generated from GraphQL so types are correct when available |
| Docker image swap | HIGH | pgvector/pgvector:pg15 is official, drop-in replacement for postgres:15 |
| Task tree recursive CTE | HIGH | Standard PostgreSQL pattern, shallow trees, well-supported by Drizzle |
| Schema design patterns | MEDIUM | Knowledge classification taxonomy and entity capability embedding strategy need validation with real agent usage |

---

## Sources

### Linear Agent SDK
- [Getting Started -- Linear Agents](https://linear.app/developers/agents) -- OAuth scopes, actor=app, agent identity
- [Agent Interaction -- Linear Developers](https://linear.app/developers/agent-interaction) -- Activity types, createAgentActivity, webhook events
- [OAuth Actor Authorization](https://linear.app/developers/oauth-actor-authorization) -- actor=app flow, identity customization
- [@linear/sdk npm](https://www.npmjs.com/package/@linear/sdk) -- Version 75.0.0, auto-generated from GraphQL schema
- [Agent Interaction SDK Changelog](https://linear.app/changelog/2025-07-30-agent-interaction-guidelines-and-sdk) -- Developer preview announcement

### pgvector + Drizzle ORM
- [Drizzle ORM -- Vector similarity search](https://orm.drizzle.team/docs/guides/vector-similarity-search) -- Full setup guide, distance functions, HNSW indexes
- [Drizzle ORM -- PostgreSQL extensions](https://orm.drizzle.team/docs/extensions/pg) -- Extension enablement
- [pgvector/pgvector-node GitHub](https://github.com/pgvector/pgvector-node) -- TypeScript support, Drizzle ORM integration
- [pgvector Docker Hub](https://hub.docker.com/r/pgvector/pgvector) -- pg15 tag confirmed available

### Embedding Generation
- [Anthropic Embeddings Guide](https://platform.claude.com/docs/en/build-with-claude/embeddings) -- Official Voyage AI recommendation, model comparison, usage patterns
- [Voyage AI TypeScript SDK](https://github.com/voyage-ai/typescript-sdk) -- Version 0.1.0, client API, input_type parameter
- [Voyage AI Pricing](https://docs.voyageai.com/docs/pricing) -- $0.02/1M tokens for voyage-3.5-lite, 200M free tokens
- [Best Embedding Models 2026](https://elephas.app/blog/best-embedding-models) -- Comparative benchmark data

### Dashboard Visualization
- [React Flow -- Quick Start](https://reactflow.dev/learn) -- Version 12.10.0, API overview
- [React Flow -- Dagre Tree Example](https://reactflow.dev/examples/layout/dagre) -- Layout integration pattern
- [React Flow UI Components -- React 19 + Tailwind 4](https://reactflow.dev/whats-new/2025-10-28) -- React 19 compatibility confirmed
- [@dagrejs/dagre npm](https://www.npmjs.com/package/@dagrejs/dagre) -- Version 2.0.3, 137 dependents

### PostgreSQL Patterns
- [PostgreSQL ltree vs WITH RECURSIVE](https://www.cybertec-postgresql.com/en/postgresql-ltree-vs-with-recursive/) -- Performance comparison, use case guidance
- [Modeling Hierarchical Tree Data](https://leonardqmarcq.com/posts/modeling-hierarchical-tree-data) -- Pattern comparison for PostgreSQL hierarchies
