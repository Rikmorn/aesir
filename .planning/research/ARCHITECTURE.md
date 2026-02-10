# Architecture Patterns: v2.7 Agent Collaboration

**Domain:** Multi-agent collaboration features for an existing agentic development platform
**Researched:** 2026-02-10
**Overall confidence:** HIGH (extensive codebase review, official docs for external dependencies)

---

## Recommended Architecture

The v2.7 collaboration features integrate into the existing architecture through three patterns: **new tables in existing schemas**, **new tool namespaces in the existing ToolRegistry**, and **new services following the existing factory pattern**. No new packages or services are needed -- everything lives in `@aesir/agents` and `@aesir/integration-linear`.

### Architecture Principle: Extend, Don't Restructure

The existing architecture was designed with collaboration in mind (polymorphic creator/assignee on tasks, event log as ground truth, tool-based control flow). v2.7 adds capabilities by:
1. Adding tables to `agents.*` schema (knowledge, directory)
2. Adding tool namespaces (`knowledge:*`, `directory:*`) to ToolRegistry
3. Extending existing services (TaskService gains delegation, denormalizer gains Linear activities)
4. Adding new services following the same factory pattern (KnowledgeService, DirectoryService)

Nothing about the ConversationExecutor, WorkerLoop, or EventRouter fundamentals changes.

---

## Component Architecture

### 1. Shared Memory (Knowledge Store)

**Where it lives:** `@aesir/agents` -- new tables in `agents.*` schema, new service, new tools.

**Storage approach: pgvector in existing Postgres** because:
- Already using PostgreSQL for everything. No new infrastructure service to deploy or maintain.
- Drizzle ORM has first-class pgvector support via `vector()` column type and distance functions (`cosineDistance`, `l2Distance`).
- Knowledge entries are dual-indexed: structured metadata queries (type, scope, author, expiry) via standard columns + semantic search via pgvector embeddings.
- The volume of knowledge entries is moderate (hundreds to low thousands per workspace), well within pgvector's comfortable range.
- Alternative (dedicated vector DB like Pinecone/Weaviate) adds operational complexity for marginal benefit at this scale.

**Confidence:** HIGH -- Drizzle pgvector integration verified via [official Drizzle docs](https://orm.drizzle.team/docs/guides/vector-similarity-search). pgvector extension is widely supported in managed Postgres (RDS, Supabase, Neon).

```
agents.knowledge_entries (NEW TABLE)
  id                  TEXT PK
  workspace_id        TEXT NOT NULL (future multi-tenancy ready)
  scope               TEXT NOT NULL ('shared' | 'private')
  author_agent_id     TEXT NOT NULL (agent that stored this)
  author_conversation_id TEXT (conversation context)
  entry_type          TEXT NOT NULL ('discovery' | 'architecture_decision' | 'constraint' | 'pattern' | 'thought')
  topic               TEXT NOT NULL (human-readable topic)
  content             TEXT NOT NULL (the actual knowledge)
  confidence          REAL (0.0-1.0, agent's confidence)
  embedding           VECTOR(1536) (for semantic search)
  metadata            JSONB (extensible key-value)
  superseded_by       TEXT REFERENCES knowledge_entries(id) (chain)
  expires_at          TIMESTAMPTZ (optional TTL)
  created_at          TIMESTAMPTZ NOT NULL
  updated_at          TIMESTAMPTZ NOT NULL

  INDEXES:
  - idx_knowledge_scope ON (scope, workspace_id)
  - idx_knowledge_type ON (entry_type)
  - idx_knowledge_author ON (author_agent_id)
  - idx_knowledge_topic ON (topic) -- text search
  - idx_knowledge_embedding USING hnsw (embedding vector_cosine_ops) -- semantic search
  - idx_knowledge_expiry ON (expires_at) WHERE expires_at IS NOT NULL
```

**New service: `KnowledgeService`**

```
packages/agents/src/shared/services/knowledge-service.ts

Interface:
  store(params: StoreKnowledgeParams): Promise<KnowledgeEntry>
  query(params: QueryKnowledgeParams): Promise<KnowledgeEntry[]>
  update(id: string, fields: UpdateKnowledgeParams): Promise<KnowledgeEntry>
  invalidate(id: string, supersededBy?: string): Promise<void>
  health(): Promise<{ healthy: boolean; latencyMs: number }>
  close(): Promise<void>

Dependencies:
  db: NodePgDatabase  (existing pool)
  logger: PinoLogger
  embeddingModel?: string (default: text-embedding-3-small)
```

Query supports dual-mode: structured filters (type, scope, topic ILIKE) AND semantic similarity (cosine distance on embedding). Results are scored by combining relevance and recency, excluding expired/superseded entries.

**Embedding generation:** Call Anthropic/OpenAI embeddings API at store time. The KnowledgeService generates embeddings synchronously on store -- the latency (50-100ms) is acceptable since `knowledge:store` is not in the hot path of every tool call.

**New tools: `knowledge:store`, `knowledge:query`, `knowledge:update`**

```
packages/agents/src/shared/tools/knowledge/
  store.ts       -- knowledge:store tool factory
  query.ts       -- knowledge:query tool factory
  update.ts      -- knowledge:update tool factory
  index.ts       -- barrel export
```

Registered in `tool-factories.ts` using a new `knowledgeAdapter` following the existing `communicationAdapter` pattern -- extracts agentId and correlationId from ToolContext, passes to KnowledgeService.

**Private notepad:** Uses the same table with `scope = 'private'`. Query tool filters: private entries only visible when `author_agent_id` matches the querying agent. This is a query-time filter, not a separate table -- simpler and the security model is sufficient (agents don't have direct DB access).

### 2. Entity Directory

**Where it lives:** `@aesir/agents` -- new table in `agents.*` schema, new service, new tools, seed script.

```
agents.entity_directory (NEW TABLE)
  id                  TEXT PK
  entity_type         TEXT NOT NULL ('agent' | 'human')
  name                TEXT NOT NULL
  description         TEXT
  capabilities        TEXT[] NOT NULL (natural language capability strings)
  capabilities_embedding VECTOR(1536) (semantic search on combined capabilities)
  reach_via           JSONB (how to contact: channel type + target)
  source_definition   TEXT (for agents: definition.yaml path, for seeding)
  status              TEXT NOT NULL DEFAULT 'active' ('active' | 'inactive')
  metadata            JSONB DEFAULT '{}'
  created_at          TIMESTAMPTZ NOT NULL
  updated_at          TIMESTAMPTZ NOT NULL

  INDEXES:
  - idx_directory_type ON (entity_type, status)
  - idx_directory_capabilities USING hnsw (capabilities_embedding vector_cosine_ops)
  - idx_directory_name ON (name)
```

**Capability matching: semantic similarity** because:
- Agents query with intent descriptions ("who can implement code changes?"), not exact strings.
- Capability descriptions are short natural language phrases -- embeddings handle synonyms and paraphrases naturally.
- Same pgvector infrastructure as knowledge store -- no additional complexity.
- Alternative (keyword search, pg_trgm) would miss semantic matches like "write code" matching "implement features".

**Seeding pattern:** `pnpm seed:directory` reads YAML definitions, extracts `id`, `name`, `description`, and new `capabilities` field (list of strings), generates embedding from combined capabilities text, upserts to `entity_directory`. Follows the same pattern as `pnpm seed:permissions`. Human entries from a config file or environment variable (JSON array).

```
packages/agents/scripts/seed-directory.ts

Reads: definitions/*/definition.yaml (capabilities field)
Reads: DIRECTORY_HUMANS env var or .directory-humans.json config
Writes: agents.entity_directory (upsert on id)
```

**AgentDefinitionYamlSchema extension:** Add optional `capabilities` field:

```yaml
# definition.yaml addition
capabilities:
  - "Implement code changes and create pull requests"
  - "Research codebases and analyze architecture"
  - "Run tests and verify implementations"
```

```typescript
// types.ts schema addition
capabilities: z.array(z.string()).optional(),
```

**New service: `DirectoryService`**

```
packages/agents/src/shared/services/directory-service.ts

Interface:
  find(query: string, opts?: { type?: 'agent' | 'human'; limit?: number }): Promise<DirectoryEntry[]>
  get(entityId: string): Promise<DirectoryEntry | null>
  upsert(entry: UpsertDirectoryEntry): Promise<DirectoryEntry>
  health(): Promise<{ healthy: boolean; latencyMs: number }>
  close(): Promise<void>
```

`find()` generates an embedding for the query string, then runs cosine similarity search against `capabilities_embedding`. Returns ranked results with similarity scores. The `type` filter enables searching for only agents or only humans.

**New tools: `directory:find`, `directory:get`**

```
packages/agents/src/shared/tools/directory/
  find.ts        -- directory:find tool factory
  get.ts         -- directory:get tool factory
  index.ts       -- barrel export
```

**Integration with existing ToolRegistry:** Same registration pattern as other namespaces. DirectoryService injected via `RegisterAllToolsOptions` extension (same as TaskService).

### 3. Task Delegation

**Where it lives:** `@aesir/agents` -- extends existing TaskService, new tool, new materialization layer.

**`task:delegate` tool is NOT a new TaskService method.** It is a composite tool that orchestrates multiple existing and new services:

```
task:delegate tool execution flow:
  1. Creates task via TaskService.create() with parentTaskId
  2. Sets callbackConversationId in task metadata
  3. Triggers materialization layer
  4. Returns task ID to the agent
```

**Materialization layer:** A new module that sits between task creation and conversation start / external delivery.

```
packages/agents/src/shared/services/materialization.ts

Interface:
  materialize(task: Task, entity: DirectoryEntry): Promise<MaterializationResult>

Dispatch logic:
  entity.type === 'agent':
    - Internal: calls ConversationExecutor.start() with taskId
    - Transparent: creates Linear ticket (via MCP) + starts conversation
  entity.type === 'human':
    - Slack: sends approval-style message with task details
    - Linear: creates issue assigned to human (future)
```

The materialization layer extends the denormalizer pattern: task:delegate creates a task, then the materializer dispatches based on entity type and team policy. The policy decision (internal vs transparent) comes from task metadata or a workspace config -- it is NOT hardcoded.

**Interaction with existing ConversationExecutor:** The materializer calls `executor.start()` for agent-to-agent delegation. This is the same `start()` used by the EventRouter -- no new executor methods needed.

```typescript
// Materialization for agent recipient (internal)
const conversationId = await executor.start({
  agentDefinitionId: entity.id,      // target agent
  correlationKey: `task:${task.id}`,  // deterministic ID from task
  initialMessage: task.objective ?? task.title,
  taskId: task.id,                    // links conversation to task
  context: buildDelegationContext(task, sourceConversation),
});
```

**Task table extension:**

```sql
ALTER TABLE agents.tasks
  ADD COLUMN callback_conversation_id TEXT,    -- who to signal on completion
  ADD COLUMN delegation_depth INTEGER DEFAULT 0, -- for cycle detection
  ADD COLUMN expectations JSONB;                -- priority, estimated_effort, deadline
```

**Negotiation handshake:** Implemented as a signal exchange, not a separate mechanism:

1. Delegator creates task (status='created') + calls `wait_for` with type='delegation_response'
2. Materializer starts target conversation with task context
3. Target agent evaluates and calls `task:respond` (accept/reject/estimate)
4. `task:respond` tool updates task status + fires signal to callbackConversationId
5. Delegator wakes, reads response, decides to proceed or pivot

```
New tool: task:respond
  - Sets task status to 'active' (accept) or 'cancelled' (reject)
  - Fires signal to callback_conversation_id
  - Carries: accepted, estimate, reason (on reject)
```

This reuses the existing `signal()` infrastructure entirely. No new signal delivery mechanism needed.

### 4. Completion Signaling

**Where it lives:** `@aesir/agents` -- extends existing task lifecycle events, new event subscriber, signal dispatch.

**Core mechanism: task state change triggers signal dispatch.**

When a task transitions to a terminal state (completed, failed, cancelled), the system fires a signal to `callback_conversation_id`. This is a new subscriber on the task state change, not a modification to the ConversationExecutor.

```
packages/agents/src/shared/services/task-signal-dispatcher.ts

Interface:
  TaskSignalDispatcher:
    initialize(): void  // subscribes to task events
    close(): void       // unsubscribes
```

**How it works:**

```
Task state changes (via task:complete_task, task:pause_task, etc.)
  |
  v
TaskService emits state change (new: add EventEmitter or event log append)
  |
  v
TaskSignalDispatcher catches state change
  |
  v
If task.callback_conversation_id exists:
  |
  v
ConversationExecutor.signal(callbackConversationId, {
  type: 'task_completed' | 'task_failed' | 'task_clarification',
  data: { taskId, status, summary, artifacts },
  source: 'task-system'
})
```

**Implementation approach for task state change notification:** Two options:

1. **EventEmitter on TaskService** (recommended) -- TaskService gains an `on('stateChange', handler)` method. TaskSignalDispatcher subscribes at bootstrap. Lightweight, in-process, follows the EventLog subscriber pattern.

2. **Database trigger + pg_notify** -- Postgres LISTEN/NOTIFY on task status changes. Heavier, but survives process restarts. Overkill for v1 where all services are in one process.

Recommend option 1 for simplicity. The TaskService emits after successful `update()` or `transitionWithHandoff()`.

**Signal types added:**

| Signal Type | When | Payload |
|-------------|------|---------|
| `delegation_response` | Target responds to delegation | `{ accepted, estimate?, reason? }` |
| `task_completed` | Delegated task finishes | `{ taskId, summary, artifacts }` |
| `task_failed` | Delegated task fails | `{ taskId, reason, partialResults? }` |
| `task_clarification` | Target needs more info | `{ taskId, question }` |
| `task_timeout` | Estimated time exceeded | `{ taskId, elapsedMs, estimatedMs }` |

These are domain-typed signals exactly like existing `approval`, `pr_review`, etc. -- the signal infrastructure handles them identically.

**Timeout mechanism:** Uses existing pg-boss TimeoutScheduler. When the delegator accepts an estimate, it calls `wait_for` with a timeout matching the estimate. If the timeout fires before completion, the delegator receives `task_timeout` and decides to keep waiting, cancel, or escalate. Zero new timeout infrastructure needed.

**Orphan handling:** If `signal()` returns `rejected` (conversation in terminal state), the TaskSignalDispatcher logs an `orphaned_completion` event to the event log. Dashboard can query these for visibility.

### 5. Linear Agent SDK Migration

**Where it lives:** `@aesir/integration-linear` -- modifies existing OAuth, adds new MCP tools, updates webhook handling.

**Confidence:** MEDIUM -- Linear Agent APIs are in "Developer Preview" per [Linear docs](https://linear.app/developers/agents). API surface may change. All implementation should be behind feature flags.

**OAuth changes (`linear/src/oauth/flow.ts`):**

Current: `createLinearClientFromDatabase()` uses user OAuth token.
New: Add `actor=app` parameter to authorization URL, request `app:assignable` + `app:mentionable` scopes.

```typescript
// OAuth URL modification
const authUrl = `https://linear.app/oauth/authorize?${params.toString()}&actor=app`;
```

The `actor=app` parameter makes Linear create a dedicated app user in the workspace. This user appears in mention menus and can be assigned issues. The access token represents the app, not the installing user.

**New MCP tools (replace `create_comment` for agent sessions):**

```
linear:create_agent_activity
  Input: { agentSessionId, type, body?, action?, parameter?, result? }
  Maps to: linearClient.createAgentActivity({ agentSessionId, content })
  Activity types: thought, response, elicitation, action, error

linear:update_agent_session
  Input: { agentSessionId, state?, externalUrl? }
  Maps to: linearClient.agentSessionUpdate(...)
```

**ReplyContext extension:**

```typescript
// LinearReplyContextSchema gains agentSessionId
export const LinearReplyContextSchema = z.object({
  channel: z.literal("linear"),
  issueId: z.string(),
  agentSessionId: z.string().optional(), // NEW: for agent activity routing
});
```

**Denormalizer modification:**

When `replyContext.agentSessionId` is present, the denormalizer routes to `linear:create_agent_activity` instead of `linear:create_comment`. The communication-to-activity type mapping:

| Communication Intent | Activity Type |
|---------------------|---------------|
| `reply` | `response` |
| `ask` | `elicitation` |
| `notify` | `thought` |

**Webhook handling changes:**

- `agent_session.created` -- already handled, but adapter now extracts `agentSessionId` into replyContext
- `agent_session.prompted` -- already handled as `agent_prompt`, replyContext now includes `agentSessionId`
- Echo filter removal -- `LINEAR_BOT_USER_ID` filtering in webhooks becomes unnecessary since agent activities and user prompts are structurally distinct types

**Agent session tracking:** The `agentSessionId` is carried in the `replyContext` (already persisted in the `reply_context` JSONB column on conversations). No new table needed -- the session ID flows through the existing replyContext pipeline.

### 6. Delegation Graph Observability

**Where it lives:** Dashboard reads from existing + new tables, agent-service exposes new API endpoints.

**Data sources -- no new tables needed:**

The delegation graph is fully derivable from existing data:
- `agents.tasks` -- tree structure via `parent_id`, with new `callback_conversation_id`
- `agents.task_handoffs` -- handoff events in the delegation chain
- `agents.conversations` -- linked via `task_id`
- `agents.agent_events` -- signal delivery, lifecycle events
- `agents.knowledge_entries` -- knowledge shared during delegation

**New API endpoints on agent-service:**

```
GET /api/tasks/:taskId/tree
  Returns: full task tree with subtasks, statuses, linked conversations

GET /api/tasks/:taskId/timeline
  Returns: chronological delegation events across the tree

GET /api/tasks/:taskId/signals
  Returns: signals exchanged between conversations in the tree
```

These endpoints query across tasks, conversations, and events using existing indexed columns (`parent_id`, `task_id`, `conversation_id`).

**Dashboard additions:**

```
packages/dashboard/src/
  app/tasks/[taskId]/tree/page.tsx      -- task tree view
  components/task-tree.tsx               -- tree visualization component
  components/delegation-timeline.tsx     -- chronological event view
  components/signal-flow.tsx             -- signal edges between conversations
  services/task-tree.ts                  -- data fetching for tree queries
```

Dashboard mirrors the new tables in its local `lib/schema.ts` (read-only copies, same pattern as existing).

---

## Data Flow Diagrams

### Delegation Flow (Agent-to-Agent)

```
Product-Agent conversation
  |
  | 1. directory:find("implement code changes")
  |    -> DirectoryService.find() -> returns dev-agent
  |
  | 2. task:delegate({target: "dev-agent", description: "..."})
  |    -> TaskService.create({parentId, callbackConversationId})
  |    -> MaterializationLayer.materialize(task, entity)
  |       -> ConversationExecutor.start({agentDefinitionId: "dev-agent", taskId})
  |    -> Agent calls wait_for({type: "delegation_response"})
  |
  v
Dev-Agent conversation (new, with task context injected)
  |
  | 3. Evaluates task, calls task:respond({accept: true, estimate: "30m"})
  |    -> TaskService.update(taskId, {status: "active"})
  |    -> Signal dispatched to product-agent: {type: "delegation_response", data: {accepted: true}}
  |
  v
Product-Agent resumes
  |
  | 4. Reads acceptance, calls wait_for({type: "task_completed", timeout: "30m"})
  |
  v
Dev-Agent works... completes... calls task:complete_task
  |
  | 5. TaskService.transitionWithHandoff(taskId, "completed", handoff)
  |    -> TaskSignalDispatcher fires signal to callbackConversationId
  |    -> Signal: {type: "task_completed", data: {summary, artifacts}}
  |
  v
Product-Agent resumes with completion results
```

### Knowledge Flow

```
Dev-Agent discovers architecture pattern
  |
  | knowledge:store({
  |   type: "architecture_decision",
  |   topic: "auth middleware",
  |   content: "JWT-based, located at src/middleware/auth.ts",
  |   confidence: 0.95
  | })
  |    -> KnowledgeService.store()
  |    -> Generates embedding
  |    -> Inserts into agents.knowledge_entries
  |
  v
Later: Different QA-Agent conversation
  |
  | knowledge:query({ query: "what do we know about authentication?" })
  |    -> KnowledgeService.query()
  |    -> Semantic search via cosine distance on embedding
  |    -> Filters: scope='shared', not expired, not superseded
  |    -> Returns ranked results
  |
  v
QA-Agent has context without re-discovering
```

### Linear Agent SDK Flow

```
User mentions @aesir-agent on Linear issue
  |
  v
Linear webhook: agent_session.created
  payload: { issueId, agentSessionId, promptContext }
  |
  v
Linear Integration (port 3001)
  -> Webhook verification
  -> NormalizedEvent to agent-service POST /events
  |
  v
Linear Adapter
  -> Extracts issueId, agentSessionId
  -> ReplyContext: { channel: "linear", issueId, agentSessionId }
  |
  v
EventRouter -> start dev-agent conversation
  |
  v
Dev-Agent works, calls communication:reply
  |
  v
Denormalizer checks replyContext.agentSessionId
  YES -> callMcpTool("linear", "create_agent_activity", {
           agentSessionId, content: { type: "response", body: text }
         })
  NO  -> callMcpTool("linear", "create_comment", { issueId, body: text })
  |
  v
Agent appears in Linear UI with native activity types
```

---

## Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| **KnowledgeService** | Store/query/update knowledge entries, manage embeddings, enforce scope | DB (agents.knowledge_entries), Embedding API |
| **DirectoryService** | Entity CRUD, capability-based semantic search | DB (agents.entity_directory), Embedding API |
| **MaterializationLayer** | Dispatch delegated tasks to appropriate channel based on entity type | ConversationExecutor, Slack MCP, Linear MCP |
| **TaskSignalDispatcher** | React to task state changes, fire signals to callback conversations | TaskService (events), ConversationExecutor.signal() |
| **Knowledge tools** (`knowledge:*`) | Agent-facing interface to KnowledgeService | KnowledgeService via ToolRegistry |
| **Directory tools** (`directory:*`) | Agent-facing interface to DirectoryService | DirectoryService via ToolRegistry |
| **Delegation tool** (`task:delegate`) | Composite: create task + materialize + wait | TaskService, DirectoryService, MaterializationLayer |
| **Response tool** (`task:respond`) | Negotiation: accept/reject delegation | TaskService, ConversationExecutor.signal() |
| **Linear activity MCP tools** | `create_agent_activity`, `update_agent_session` | Linear SDK (via OAuth app token) |
| **Updated denormalizer** | Routes to activity tools when agentSessionId present | Linear MCP (activity or comment) |

---

## New Tables, Migrations, Indexes Summary

### New Tables

| Table | Schema | Purpose |
|-------|--------|---------|
| `agents.knowledge_entries` | Phase 71 | Shared knowledge store with vector embeddings |
| `agents.entity_directory` | Phase 72 | Entity directory (agents + humans) |

### Table Modifications

| Table | Change | Phase |
|-------|--------|-------|
| `agents.tasks` | Add `callback_conversation_id TEXT`, `delegation_depth INTEGER DEFAULT 0`, `expectations JSONB` | Phase 73 |
| `agents.tasks` | Add index `idx_tasks_callback` on `callback_conversation_id` | Phase 73 |

### Migration Plan

```
Phase 70: No schema changes (Linear integration only)
Phase 71: Migration 1 - CREATE EXTENSION vector; CREATE TABLE agents.knowledge_entries with indexes
Phase 72: Migration 2 - CREATE TABLE agents.entity_directory with indexes
Phase 73: Migration 3 - ALTER TABLE agents.tasks ADD COLUMN callback_conversation_id, delegation_depth, expectations
Phase 74: No schema changes (uses existing signal infrastructure)
Phase 75: No schema changes (reads from existing tables)
Phase 76: No schema changes (new agent definition only)
```

**Important: pgvector extension must be created before knowledge_entries table.** The migration must include `CREATE EXTENSION IF NOT EXISTS vector;` before the table creation. This requires superuser or extension-creation privileges on the Postgres instance. Docker Compose Postgres image has this by default; managed services (RDS, Cloud SQL) require enabling the extension via console/CLI first.

### Existing Schema Retention

Per CLAUDE.md: `schema.drizzle.ts` retains old table definitions to prevent destructive DROP TABLE migrations. New tables must be added to BOTH `schema.ts` (runtime) and `schema.drizzle.ts` (drizzle-kit migration generation).

---

## New vs Modified Components

### New Components (create from scratch)

| Component | Location | Phase |
|-----------|----------|-------|
| `KnowledgeService` | `agents/src/shared/services/knowledge-service.ts` | 71 |
| Knowledge tools (3) | `agents/src/shared/tools/knowledge/` | 71 |
| `DirectoryService` | `agents/src/shared/services/directory-service.ts` | 72 |
| Directory tools (2) | `agents/src/shared/tools/directory/` | 72 |
| Seed directory script | `agents/scripts/seed-directory.ts` | 72 |
| `MaterializationLayer` | `agents/src/shared/services/materialization.ts` | 73 |
| `task:delegate` tool | `agents/src/shared/tools/task/delegate.ts` | 73 |
| `task:respond` tool | `agents/src/shared/tools/task/respond.ts` | 73 |
| `TaskSignalDispatcher` | `agents/src/shared/services/task-signal-dispatcher.ts` | 74 |
| Linear activity MCP tools | `linear/src/mcp/tools/activities.ts` | 70 |
| Task tree API endpoints | `agents/src/service/api/task-tree.ts` | 75 |
| Dashboard task tree views | `dashboard/src/app/tasks/`, `dashboard/src/components/task-*` | 75 |
| QA agent definition | `agents/definitions/qa-agent/` | 76 |

### Modified Components (extend existing)

| Component | Location | Change | Phase |
|-----------|----------|--------|-------|
| `tool-factories.ts` | `agents/src/framework/` | Register knowledge:*, directory:*, task:delegate, task:respond | 71-73 |
| `RegisterAllToolsOptions` | `agents/src/framework/tool-factories.ts` | Add knowledgeService, directoryService, materializationLayer | 71-73 |
| `schema.ts` | `agents/src/shared/db/` | Add knowledge_entries, entity_directory tables; extend tasks | 71-73 |
| `schema.drizzle.ts` | `agents/src/shared/db/` | Mirror schema.ts changes for drizzle-kit | 71-73 |
| `main.ts` | `agents/src/service/` | Bootstrap new services, pass to registerAllTools | 71-74 |
| `api/router.ts` | `agents/src/service/api/` | Mount task tree API routes | 75 |
| `AgentDefinitionYamlSchema` | `agents/src/framework/types.ts` | Add optional `capabilities` field | 72 |
| `LinearReplyContextSchema` | `agents/src/shared/communication/types.ts` | Add optional `agentSessionId` | 70 |
| `denormalizer.ts` | `agents/src/shared/communication/` | Route to activity tools when agentSessionId present | 70 |
| `linear/src/oauth/flow.ts` | Linear integration | Add `actor=app` to auth URL | 70 |
| `linear/src/mcp/server.ts` | Linear integration | Register new activity tools | 70 |
| `linear/src/mcp/schemas.ts` | Linear integration | Add activity schemas | 70 |
| `linear/scripts/seed-permissions.ts` | Linear integration | Add permissions for new tools | 70 |
| `agents/src/adapters/linear.ts` | Agents adapters | Extract agentSessionId into replyContext | 70 |
| Agent definition YAMLs | `agents/definitions/*/definition.yaml` | Add capabilities, new tool refs | 72-76 |
| Agent prompts | `agents/definitions/*/prompt.md` | Add delegation/knowledge guidance | 71-76 |
| Dashboard `lib/schema.ts` | Dashboard | Mirror new agents schema tables | 75 |
| TaskService | `agents/src/shared/services/task-service.ts` | Add EventEmitter for state changes | 74 |

---

## Patterns to Follow

### Pattern 1: Service Factory with Tool Adapter

**What:** New services (KnowledgeService, DirectoryService) follow the existing `createService(options)` factory pattern. Tools use adapter functions to bridge ToolContext to service dependencies.

**When:** Always -- this is the established pattern for all services in Aesir.

**Example:**

```typescript
// Service factory (same as createTaskService)
export function createKnowledgeService(options: KnowledgeServiceOptions): KnowledgeService {
  const { db, logger } = options;
  if (!db) throw new Error("db is required for KnowledgeService");
  if (!logger) throw new Error("logger is required for KnowledgeService");

  return {
    async store(params) { /* ... */ },
    async query(params) { /* ... */ },
    async health() { /* ... */ },
    async close() { /* ... */ },
  };
}

// Tool adapter (same as task tools)
function knowledgeAdapter(
  createFn: (ks: KnowledgeService, ctx: ToolContext) => ToolDefinition,
  knowledgeService: KnowledgeService,
): (ctx: ToolContext) => ToolDefinition {
  return (ctx: ToolContext) => createFn(knowledgeService, ctx);
}
```

### Pattern 2: Signal-Based Inter-Conversation Communication

**What:** Conversations communicate via signals through the existing ConversationExecutor.signal() mechanism. Task lifecycle events trigger signals to callback conversations.

**When:** Whenever one conversation needs to notify another (delegation response, task completion, clarification requests).

**Example:**

```typescript
// TaskSignalDispatcher subscribes to task state changes
const dispatcher = createTaskSignalDispatcher({
  executor,  // for signal()
  taskService,  // for task lookups
  eventLog,  // for orphan logging
  logger,
});

// When task completes:
await executor.signal(task.callback_conversation_id, {
  type: "task_completed",
  data: { taskId: task.id, summary: handoff.context.summary },
  source: "task-system",
});
```

### Pattern 3: Denormalizer Extension for New Channels

**What:** The outbound denormalizer gains a new dispatch path for Linear agent activities, following the existing channel-based routing pattern.

**When:** Extending the denormalizer for any new outbound delivery mechanism.

**Example:**

```typescript
// denormalizer.ts extension
case "linear": {
  if (replyContext.agentSessionId) {
    // Agent SDK path: use activity types
    return callMcpTool({
      integration: "linear",
      tool: "create_agent_activity",
      params: {
        agentSessionId: replyContext.agentSessionId,
        content: { type: activityType, body: text },
      },
      ...mcpBase,
    });
  }
  // Legacy path: comment on issue
  return callMcpTool({ /* existing create_comment call */ });
}
```

### Pattern 4: Seed Scripts for Data Initialization

**What:** New seed scripts follow the existing pattern from `seed:permissions` -- standalone tsx scripts that use `loadEnvFromRoot()`, connect to the database, and upsert data.

**When:** Initializing entity directory from YAML definitions, seeding permissions for new MCP tools.

**Example:**

```typescript
#!/usr/bin/env tsx
import { loadEnvFromRoot } from "@aesir/platform";
loadEnvFromRoot();

// Read YAML definitions, extract capabilities, generate embeddings, upsert to DB
```

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Orchestrator-Driven Delegation

**What:** Building a central orchestrator that decides which agent delegates to which.
**Why bad:** Violates agent-first principles. Agents decide when to delegate through their tools and reasoning. A central orchestrator creates a bottleneck and single point of failure.
**Instead:** Agents discover capabilities via `directory:find`, decide to delegate via their own judgment, and use `task:delegate` as a tool. The agent makes the decision; the infrastructure executes it.

### Anti-Pattern 2: Separate Vector Database

**What:** Running Pinecone, Weaviate, or Qdrant alongside Postgres for knowledge embeddings.
**Why bad:** Operational complexity for low-volume use case. Consistency issues between Postgres metadata and external vector store. Extra infrastructure to deploy, monitor, and maintain.
**Instead:** pgvector in existing Postgres. Single source of truth, transactional consistency, adequate performance for the expected volume (hundreds to low thousands of entries).

### Anti-Pattern 3: Knowledge Store as Message Passing

**What:** Using the knowledge store for real-time communication between agents instead of signals.
**Why bad:** Knowledge is for persistent, queryable facts. Real-time coordination uses signals. Mixing these creates stale-data bugs where agents read knowledge entries that are mid-update.
**Instead:** Signals for real-time coordination (delegation response, task completion). Knowledge for persistent facts that outlive conversations.

### Anti-Pattern 4: Task Status as Framework Logic

**What:** Adding `if (task.status === 'completed') { fireSignal() }` in the ConversationExecutor or WorkerLoop.
**Why bad:** The executor manages conversation lifecycle, not task lifecycle. Mixing these creates coupling.
**Instead:** TaskSignalDispatcher is a separate service that subscribes to task state changes and dispatches signals independently. The executor only knows about conversations and signals.

### Anti-Pattern 5: Modifying ConversationExecutor for Delegation

**What:** Adding delegation-specific methods or branching to the ConversationExecutor or WorkerLoop.
**Why bad:** The executor is the most critical, most tested component. Adding delegation concerns increases its surface area and risk of regression.
**Instead:** Delegation uses the existing `executor.start()` and `executor.signal()` methods. The MaterializationLayer and TaskSignalDispatcher sit alongside the executor, not inside it.

---

## Scalability Considerations

| Concern | At Current Scale (~10 agents) | At 100 Agents | At 1000 Agents |
|---------|------------------------------|---------------|----------------|
| Knowledge entries | pgvector fine, no partitioning | pgvector fine, HNSW index handles 100K+ entries | Consider partitioning by workspace, HNSW tuning |
| Directory queries | In-memory cache viable | pgvector search, ~5ms per query | pgvector with aggressive caching |
| Delegation depth | Max 3 levels sufficient | May need deeper trees, cycle detection | Delegation graph analysis, depth limits |
| Embedding generation | Sync call acceptable | Batch embedding for bulk operations | Async embedding queue |
| Signal volume | Low, existing infra handles | Moderate, existing infra handles | May need dedicated signal queue |
| Task tree queries | Simple recursive CTE | Indexed, millisecond range | Materialized task tree projection |

---

## Build Order Rationale

```
Phase 70 (Linear Agent SDK) + Phase 71 (Shared Memory) -- PARALLEL
  |
  v
Phase 72 (Entity Directory)
  Depends on: Phase 70 (agent identity must be resolved for directory)
  |
  v
Phase 73 (Task Delegation)
  Depends on: Phase 72 (agents need to discover who to delegate to)
  |
  v
Phase 74 (Completion Signaling)
  Depends on: Phase 73 (signals need tasks to signal about)
  |
  v
Phase 75 (Delegation Graph Observability)
  Depends on: Phase 74 (full lifecycle must exist before visualization)
  |
  v
Phase 76 (QA Agent + Validation Workflow)
  Depends on: Phase 75 (all infrastructure must be in place)
```

**Why this order:**

1. **Phases 70+71 parallel** -- No dependencies between Linear SDK and knowledge store. Different packages, different concerns. Parallel execution cuts timeline.

2. **Phase 72 after 70** -- The directory needs to know about agent identity. With `actor=app`, the agent has a real Linear identity that should be reflected in the directory. Building directory before agent identity is resolved risks misalignment.

3. **Phase 73 after 72** -- Delegation requires knowing WHO to delegate to. Without the directory, delegation is blind. The directory enables informed delegation decisions.

4. **Phase 74 after 73** -- Completion signaling only makes sense after delegation exists. The callback routing mechanism depends on task structure created in 73.

5. **Phase 75 after 74** -- You cannot visualize what doesn't exist yet. Observability requires the full delegation lifecycle.

6. **Phase 76 last** -- The QA agent exercises everything. Building it before the infrastructure is complete would require constant rework.

---

## Open Architecture Questions

1. **Embedding provider choice** -- OpenAI `text-embedding-3-small` (1536 dims) is the pragmatic default. Anthropic does not yet offer an embeddings API. Should we use OpenAI, or a local embedding model (e.g., via Ollama) to avoid the external dependency? Trade-off: OpenAI is simpler but adds a dependency; local is self-contained but adds infra.

2. **MaterializationLayer and ConversationExecutor coupling** -- The materializer needs access to `executor.start()`. Passing the executor to the materializer creates a circular-feeling dependency (executor -> tools -> materializer -> executor). In practice this is fine (it is a runtime call, not an import cycle), but the DI wiring in `main.ts` needs careful ordering.

3. **Task state change notification mechanism** -- EventEmitter on TaskService vs. event log append with subscriber. EventEmitter is simpler but in-memory only. Event log approach is durable but heavier. For v1 where everything is one process, EventEmitter wins. If services split later, switch to event log.

4. **Linear API stability** -- Agent SDK is "Developer Preview." Changes may require adaptation. All Linear Agent SDK code should be behind a feature flag (`LINEAR_AGENT_SDK_ENABLED=true`) so the system can fall back to comment-based communication.

---

## Sources

- Linear Agent SDK: [Getting Started](https://linear.app/developers/agents), [Agent Interaction](https://linear.app/developers/agent-interaction), [Changelog](https://linear.app/changelog/2025-07-30-agent-interaction-guidelines-and-sdk)
- pgvector + Drizzle ORM: [Vector Similarity Search Guide](https://orm.drizzle.team/docs/guides/vector-similarity-search), [PostgreSQL Extensions](https://orm.drizzle.team/docs/extensions/pg)
- pgvector general: [pgvector-node GitHub](https://github.com/pgvector/pgvector-node), [pgvector 2026 guide](https://www.instaclustr.com/education/vector-database/pgvector-key-features-tutorial-and-pros-and-cons-2026-guide/)
- Existing codebase: `packages/agents/src/framework/`, `packages/agents/src/shared/`, `packages/integrations/linear/src/`, `packages/dashboard/src/`
