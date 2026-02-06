# Technology Stack: v2.5 Agentic Conversations

**Project:** Aesir v2.5 -- Task primitives, conversation reopening, goal-oriented prompt rewrites
**Researched:** 2026-02-06
**Research mode:** Stack dimension for subsequent milestone
**Overall confidence:** HIGH (no new runtime dependencies; extends existing Postgres + Drizzle + Zod stack)

---

## Executive Summary

v2.5 requires **zero new runtime dependencies**. The task primitive, conversation reopening, integration correlation tables, and prompt rewrites are all implementable within the existing stack: PostgreSQL + Drizzle ORM for schema, Zod for validation, the existing ToolRegistry for new agent tools, and the existing @anthropic-ai/sdk for agent loops.

This is by design. The v2.5 spec describes a coordination layer built on top of the existing ConversationExecutor, not a replacement for it. The task primitive is a Postgres table with Drizzle schema definitions. The correlation tables live in integration schemas. The prompt rewrites are markdown files. The new tools are ToolFactory implementations registered in the existing registry.

The primary stack work is:
1. **New Drizzle schema definitions** for tasks, task_handoffs, and task_correlations tables
2. **New Zod schemas** for task lifecycle validation and tool input/output
3. **New tool factories** (6 task tools) registered in the existing ToolRegistry
4. **Prompt rewrites** following the existing PROMPT_GUIDE.md structure
5. **Executor modifications** for conversation reopening (signal handling on terminal states)
6. **Event router modifications** for task-based routing priority

No new libraries are needed. No architectural patterns change. The existing stack handles everything.

---

## 1. Task Primitive Schema (Drizzle ORM)

### Recommendation: Extend existing `agents` schema with new tables

| Property | Value |
|----------|-------|
| ORM | drizzle-orm@^0.45.1 (existing) |
| Schema namespace | `agents.*` (existing pgSchema) |
| Migration tool | drizzle-kit@^0.31.8 (existing) |
| ID generation | Extend `createId` in `@aesir/types` with `task` and `handoff` prefixes |
| Confidence | HIGH -- follows exact patterns used by conversations, agentEvents, agentSessions |

### Schema Implementation Approach

The spec defines three new tables: `tasks`, `task_handoffs`, and a `task_id` column addition to `conversations`. These follow established Drizzle patterns already in the codebase.

**Pattern to follow (from existing schema.ts):**

```typescript
// In packages/agents/src/shared/db/schema.ts
// Uses existing agentsSchema = pgSchema("agents")

export const taskStatusValues = [
  "created", "active", "paused", "completed", "cancelled"
] as const;
export type TaskStatus = (typeof taskStatusValues)[number];

export const handoffTypeValues = [
  "completion", "pause", "delegation", "escalation"
] as const;
export type HandoffType = (typeof handoffTypeValues)[number];

export const tasks = agentsSchema.table("tasks", {
  id: text("id").primaryKey().$defaultFn(() => createId.task()),
  parent_id: text("parent_id"),  // self-referential FK added via SQL migration
  creator_type: text("creator_type", { enum: ["agent", "human"] }).notNull(),
  creator_id: text("creator_id").notNull(),
  assignee_type: text("assignee_type", { enum: ["agent", "human"] }).notNull(),
  assignee_id: text("assignee_id").notNull(),
  status: text("status", { enum: taskStatusValues }).notNull().default("created"),
  title: text("title").notNull(),
  objective: text("objective"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  completed_at: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
  index("idx_tasks_assignee").on(table.assignee_type, table.assignee_id, table.status),
  index("idx_tasks_parent").on(table.parent_id),
  index("idx_tasks_status").on(table.status),
]);
```

**Critical implementation note:** The `parent_id` self-referential foreign key should be added in the raw SQL migration rather than in the Drizzle schema definition. Drizzle has known issues with self-referential FK declarations in table definitions. Use `references(() => tasks.id)` in the schema file for type safety, but verify the generated migration SQL is correct.

**schema.drizzle.ts synchronization:** The new tables MUST also be added to `schema.drizzle.ts` (the drizzle-kit version). This file retains legacy tables (context_snapshots, tasks, execution_traces) from v1 -- the new `tasks` table has a name collision with the legacy one. The migration must handle this:
- Option A: Rename legacy `tasks` table to `legacy_tasks` in a prior migration step
- Option B: Drop the legacy table if confirmed unused (check: it exists in schema.drizzle.ts but not schema.ts, meaning the application code does not reference it)
- **Recommendation:** Option B. The legacy `tasks` table is a v1 artifact retained only to prevent drizzle-kit from generating DROP TABLE. Since we are adding a new `tasks` table with a completely different schema, we should drop the legacy one in the same migration. Verify the old table is empty first.

### ID Generation Extension

Add to `packages/types/src/utils/ids.ts`:

```typescript
/** Task ID (agents.tasks) */
task: () => `task_${nanoid()}`,

/** Task handoff ID (agents.task_handoffs) */
handoff: () => `hoff_${nanoid()}`,

/** Task correlation ID (integration correlation tables) */
taskCorrelation: () => `tcor_${nanoid()}`,
```

This follows the established prefix convention (`aevt_`, `conv_`, `cred_`, etc.) already in use.

### Confidence: HIGH

This is the same pattern used for every table in the system. No new ORM features, no new libraries, no migration tooling changes.

---

## 2. Integration Correlation Tables

### Recommendation: Per-integration tables in respective schemas

| Property | Value |
|----------|-------|
| Location | `linear.*`, `github.*`, `slack.*` schemas |
| Table name | `task_correlations` in each schema |
| Primary key | Composite `(external_type, external_ref)` |
| Confidence | HIGH -- follows existing per-schema pattern |

### How Production Systems Handle This

Research into webhook correlation patterns reveals two dominant approaches:

**Approach 1: Centralized correlation table** (common in monoliths)
A single table maps all external references to internal entities. Simple but creates coupling between services.

**Approach 2: Per-integration correlation** (common in microservices)
Each integration maintains its own mapping. The integration processes both outgoing artifact creation and incoming webhooks, so it has the most context for correlation.

The spec correctly chooses Approach 2. Each integration already owns its database schema and processes both sides of the lifecycle. GitHub creates PRs (outgoing) and receives PR review webhooks (incoming). Linear creates issues (outgoing) and receives issue update webhooks (incoming).

### Schema Pattern (per integration)

```typescript
// In packages/integrations/github/src/db/schema.ts
export const taskCorrelations = githubSchema.table("task_correlations", {
  external_type: text("external_type").notNull(),   // "pull_request", "branch", "issue"
  external_ref: text("external_ref").notNull(),      // "org/repo#42", "feature/abc"
  task_id: text("task_id").notNull(),                // "task_abc123..."
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  // Composite primary key
  unique("task_correlations_pk").on(table.external_type, table.external_ref),
  index("idx_task_correlations_task").on(table.task_id),
]);
```

### Correlation Flow

The key insight from the research: **the integration layer records correlations at artifact creation time, not the agent**.

Current flow: Agent calls `github:create_pull_request` via MCP -> GitHub integration creates PR -> returns PR URL.

v2.5 flow: Agent calls `github:create_pull_request` via MCP **with task_id in MCP headers** -> GitHub integration creates PR -> records `("pull_request", "org/repo#42", "task_abc123")` in `github.task_correlations` -> returns PR URL.

The `task_id` is passed via the existing MCP header mechanism. The agent already passes `X-Agent-ID` and `X-Correlation-ID` in MCP calls. Adding `X-Task-ID` follows the same pattern.

### What GitHub Webhooks Provide for Correlation

From GitHub docs research (HIGH confidence):
- `X-GitHub-Delivery`: Unique GUID per delivery (for idempotency -- already tracked in `webhook_deliveries`)
- `X-GitHub-Event`: Event type header (for routing)
- Payload contains: `repository.full_name`, `pull_request.number`, `issue.number`, `sender.login`

The correlation lookup is: extract `(external_type, external_ref)` from the webhook payload, query `task_correlations`, attach `task_id` to the forwarded event if found.

For GitHub PRs specifically: `external_type = "pull_request"`, `external_ref = "${owner}/${repo}#${number}"`.

### What Linear Webhooks Provide for Correlation

Linear webhooks include `data.id` (issue UUID) and `data.identifier` (e.g., "ABC-123"). The correlation lookup uses: `external_type = "issue"`, `external_ref = data.identifier`.

### What Slack Events Provide for Correlation

Slack events include `thread_ts` for threaded conversations. The correlation lookup uses: `external_type = "thread"`, `external_ref = "${channel_id}:${thread_ts}"`.

### Confidence: HIGH

Follows existing integration schema patterns. No new libraries needed.

---

## 3. Task Lifecycle Tools (Zod + ToolRegistry)

### Recommendation: 6 new tools registered in existing ToolRegistry

| Property | Value |
|----------|-------|
| Tool registration | Existing `coordination:*` namespace pattern |
| Input validation | Zod schemas (existing pattern) |
| Tool count | 6 new tools (34 total, up from 28) |
| Confidence | HIGH -- follows exact ToolFactory pattern |

### New Tools

| Tool | Namespace:Name | Input Schema | Returns |
|------|---------------|--------------|---------|
| Create task | `task:create_task` | `{ title, objective?, assignee_type, assignee_id, parent_id?, metadata? }` | `{ task_id, status }` |
| Complete task | `task:complete_task` | `{ task_id, summary, artifacts? }` | `{ status }` |
| Pause task | `task:pause_task` | `{ task_id, reason, resume_conditions? }` | `{ status }` |
| Handoff task | `task:handoff_task` | `{ task_id, handoff_type, context, target_assignee_type?, target_assignee_id? }` | `{ handoff_id }` |
| List tasks | `task:list_tasks` | `{ assignee_type?, assignee_id?, status?, parent_id?, limit? }` | `{ tasks[] }` |
| Get task context | `task:get_task_context` | `{ task_id, include_handoffs?, include_conversations? }` | `{ task, handoffs[], conversations[] }` |

### Tool Namespace Decision

The spec describes these as "new tools available to all agents." The question is namespace: `coordination:create_task` or `task:create_task`?

**Recommendation: `task:*` namespace.** Rationale:
- The `coordination:*` namespace currently has 3 tools (spawn_agent, request_human_input, wait_for) that are about conversation-level coordination
- Task tools are about task-level coordination -- a higher abstraction
- A dedicated namespace makes it clear in agent definitions which tools are task-related
- The ToolRegistry supports any namespace (lowercase regex: `^[a-z]+:[a-z_]+$`)

This means the tool reference regex already supports it -- no framework changes needed.

### ToolFactory Implementation Pattern

Each task tool follows the existing factory pattern:

```typescript
// packages/agents/src/shared/tools/task/create-task.ts
export function createCreateTaskTool(ctx: ToolContext): ToolDefinition {
  return {
    name: "create_task",
    description: "Create a new task...",
    input_schema: { /* Zod-derived JSON schema */ },
    async execute(input) {
      const validated = CreateTaskInputSchema.parse(input);
      // DB insert into agents.tasks
      // Record in event log
      return { task_id, status: "created" };
    },
  };
}
```

**Critical design question:** Task tools need database access, but the current `ToolContext` does not include a `db` reference. Current tools either are stateless (coordination), use MCP HTTP calls (integration), or use a container manager (codebase).

**Options:**
1. Add `db` to ToolContext -- breaks existing interface, task tools become the only ones using it
2. Inject `db` via closure at registration time -- cleaner, task tool factories are curried
3. Task tools use MCP to talk to agent-service -- adds unnecessary HTTP hop for internal state

**Recommendation: Option 2 (closure injection).** The task tool factories receive `db` at registration time:

```typescript
// In tool-factories.ts
function taskAdapter(
  createFn: (db: NodePgDatabase, ctx: ToolContext) => ToolDefinition,
  db: NodePgDatabase,
): (ctx: ToolContext) => ToolDefinition {
  return (ctx: ToolContext) => createFn(db, ctx);
}

// Registration
registry.register("task:create_task", taskAdapter(createCreateTaskTool, db));
```

This follows the pattern already used by `codebaseAdapter` and `mcpAdapter` -- different adapters bridge different dependency shapes to the ToolContext interface.

### Confidence: HIGH

Follows existing ToolFactory and ToolRegistry patterns exactly. Zod for validation, Drizzle for persistence.

---

## 4. Conversation Reopening

### Recommendation: Extend ConversationExecutor.signal() to handle terminal states

| Property | Value |
|----------|-------|
| Framework changes | Modify `signal()` method in ConversationExecutor |
| New signal type | `reopen` |
| Status transitions | `completed` -> `queued`, `failed` -> `queued` |
| Confidence | HIGH -- minimal change to existing pattern |

### How Other Systems Handle This

**Temporal Continue-As-New (HIGH confidence -- official docs verified):**
Temporal's approach creates a *new* workflow execution with the same Workflow ID but a different Run ID. It explicitly clears event history and starts fresh, passing only selected state forward as arguments. This is designed for event history size limits (50K events / 50MB), not for conversation reopening.

**Key insight:** Temporal does NOT reopen workflows. It creates new executions linked by Workflow ID. The old execution is immutable.

**LangGraph Checkpointing (MEDIUM confidence -- multiple sources agree):**
LangGraph uses checkpointers (MemorySaver, PostgresSaver) that save state at every node execution. Conversations are resumed by loading the checkpoint for a `thread_id`. This is closer to Aesir's model -- the same conversation is continued, not a new one created.

**Key insight:** LangGraph preserves full history on resume. The agent sees everything that happened before.

**Zendesk Ticket Reopening (HIGH confidence -- official docs verified):**
Zendesk follows a state machine: New -> Open -> Pending -> Solved -> Reopened. When a requester replies to a solved ticket, it transitions to "Reopened" status and is reassigned to the agent who solved it. The full conversation history is preserved.

**Key insight:** Zendesk tracks reopening as a distinct status, not just reverting to "open". This provides observability into how often tickets are reopened.

### Aesir's Approach Validated

The spec's approach (signal on terminal conversation -> transition to `queued` -> agent receives full prior history plus signal context) aligns with the LangGraph/Zendesk pattern rather than the Temporal pattern. This is correct because:

1. **Aesir conversations have manageable history** -- the HistoryManager already handles compaction for long conversations
2. **Full context matters** -- the agent needs to understand what it did before to handle follow-up events correctly
3. **Temporal's "new execution" pattern is for scale limits** that don't apply here (Aesir conversations are 50-500 messages, not 50K events)

**Implementation is minimal:** The `signal()` method currently rejects signals on `completed`/`failed` conversations with `{ action: "rejected" }`. The change is:
- For `type: "reopen"` signals on terminal conversations: transition status to `queued`, append the signal to the message history, and return `{ action: "resumed" }`
- All other signal types on terminal conversations: still rejected

**Should we add a "reopened" status like Zendesk?** No. The existing status values (`queued`, `running`, `waiting`, `completed`, `failed`, `cancelled`) are sufficient. The reopening is an event (recorded in agent_events), not a persistent status. Once reopened, the conversation is `queued` and follows the normal lifecycle. Adding a "reopened" status would require changes throughout the executor, worker loop, and dashboard for minimal observability gain -- the event log already records the reopening.

### Confidence: HIGH

Minimal executor change. No new libraries. Validated by patterns in LangGraph and Zendesk.

---

## 5. Event Router Modifications for Task-Based Routing

### Recommendation: Add task lookup before existing routing logic

| Property | Value |
|----------|-------|
| Change location | EventRouter.handle() and integration adapters |
| New routing priority | task reference -> start rule -> signal rule -> slow path |
| Confidence | HIGH -- additive change to existing router |

### Current Router Flow

```
1. Ignore check (IGNORE_EVENT_TYPES set)
2. Start rule check (eventType -> agentDefinitionId)
3. Signal rule check (SIGNAL_AGENT_MAP)
4. Slow-path fallthrough
```

### v2.5 Router Flow

```
0. Task reference check (event.taskId from integration correlation)
1. Ignore check
2. Start rule check (also creates a task for new starts)
3. Signal rule check
4. Slow-path fallthrough
```

The key change: `IncomingEvent` gains an optional `taskId` field. Integration adapters populate this field by querying their `task_correlations` table before forwarding events.

```typescript
// Extend IncomingEventSchema
export const IncomingEventSchema = z.object({
  type: z.string().min(1),
  data: z.record(z.unknown()),
  source: z.string().min(1),
  correlationKey: z.string().optional(),
  deduplicationId: z.string().optional(),
  message: z.string().optional(),
  taskId: z.string().optional(),  // NEW: from integration correlation lookup
});
```

When `taskId` is present, the router queries the task to find:
- Active/waiting conversation -> deliver as signal (serialized via existing signal mechanism)
- No active conversation -> create new conversation in task with most recent handoff as initial context

This query requires database access, which the current synchronous `handle()` method does not have. The router needs to become async for the task lookup path, or the task lookup happens in the caller (webhook handler) before calling `handle()`.

**Recommendation:** Keep `handle()` synchronous for non-task events (performance). Add a separate `handleWithTask()` async method for task-aware routing. The webhook handler calls the integration adapter (which does correlation lookup), then calls the appropriate router method based on whether `taskId` is present.

### Confidence: HIGH

Additive change. Existing routing paths unchanged. No new libraries.

---

## 6. Prompt Engineering Patterns

### Recommendation: Follow PROMPT_GUIDE.md structure with validated patterns

| Property | Value |
|----------|-------|
| Prompt structure | identity -> constraints -> examples -> tools -> context (existing guide) |
| New techniques | Constitutional constraints, few-shot with reasoning, selective CoT |
| Confidence | HIGH -- validated by Anthropic's official prompt engineering docs |

### Research Findings on Prompt Patterns

**Anthropic's Official Guidance (HIGH confidence -- official docs, February 2026):**

1. **Be explicit with instructions** -- Claude Opus 4.6 follows instructions more precisely. Reduce MUST/ALWAYS/NEVER to normal language ("Use this tool when..." not "CRITICAL: You MUST use this tool").

2. **XML tags for structure** -- Official recommendation for separating sections. `<identity>`, `<constraints>`, `<examples>`, `<context>` -- exactly the pattern in PROMPT_GUIDE.md.

3. **Context awareness** -- Claude 4.5+ models track remaining context window. Long-lived task conversations benefit from prompts that tell the agent about context compaction: "Your context window will be compacted as it approaches limits. Save progress state before transitions."

4. **Avoid directive stacking** -- Claude Opus 4.6 overtriggers on aggressive language from older prompts. The existing product-agent prompt has exactly this problem (CRITICAL, IMPORTANT, MUST throughout).

5. **Action-oriented by default** -- Claude Opus 4.6 defaults to taking action. The prompt should guide when NOT to act rather than when TO act.

6. **Subagent orchestration is native** -- Claude Opus 4.6 recognizes when to delegate. The dev-agent prompt can rely more on model judgment and less on prescriptive delegation rules.

**OpenAI Agents SDK Prompt Patterns (MEDIUM confidence -- official docs):**

The OpenAI Agents SDK uses minimal prompts with structured handoff descriptions. Agents receive an `instructions` field (equivalent to system prompt) plus dynamically generated tool descriptions. Handoffs are represented as tool descriptions, not prompt sections -- the model decides when to hand off based on the handoff tool's description.

Relevant pattern for Aesir: Task handoff tools should have descriptive tool descriptions that guide the model's decision, rather than encoding handoff logic in the system prompt.

**Claude Code System Prompt Analysis (MEDIUM confidence -- community extraction):**

Claude Code's system prompt (as of v2.1.33, February 2026) uses:
- Hierarchical sections with XML tags
- `<available_skills>` dynamically generated per request
- Context-dependent sections that are conditionally included
- A compact identity section followed by tool descriptions

Relevant pattern: The `<tools>` section in Aesir prompts is currently static. With task tools added, the tool list grows to 34+ tools. Consider the Claude Code pattern of grouping tools by category in the description.

### Prompt Rewrite Strategy

The existing prompts have specific issues that the rewrite addresses:

**product-agent prompt issues:**
- Full state machine in `<behavior>` section (CLEAR REQUEST, VAGUE REQUEST, USER CONFIRMS, etc.)
- Prescriptive tool sequences ("1. FIRST, search... 2. If duplicates... 3. If no duplicates...")
- Directive stacking ("CRITICAL RULES", "IMPORTANT: Steps 1-5 happen in ONE turn")
- Intent classification lists ("yes", "looks good", "go ahead", "create it", "ship it")

**dev-agent prompt issues:**
- Complexity classification gate (SIMPLE TASKS, MODERATE TASKS, COMPLEX TASKS)
- Prescriptive tool sequences per complexity level
- Error recovery flowchart with step numbers
- Explicit sub-agent brief template that's overly rigid

Both prompts should be rewritten to:
1. **Goal-oriented identity** (2-3 sentences)
2. **Constitutional constraints** (5-8 genuine safety boundaries)
3. **Few-shot examples with reasoning** (3-5 scenarios per agent)
4. **Tool section** (framework-injected, but can include category descriptions)
5. **Context section** (per-conversation, includes task handoff if reopening)

### What NOT to Change in Prompts

- `<phase>` tags MUST remain -- the executor parses them
- `wait_for` guidance must remain -- this is framework behavior, not agent judgment
- `<slack_context>` handling in product-agent must remain -- these are runtime parameters
- The `<reasoning>` block pattern for orchestrators is good -- keep it

### Confidence: HIGH

Anthropic's official docs validate the PROMPT_GUIDE.md approach. The specific rewrite targets are clear from examining the existing prompts.

---

## 7. What NOT to Use (and Why)

### No Task Queue Library for Task Lifecycle

Considered: pg-boss for task lifecycle management.

**Why not:** Tasks are not jobs. Tasks are long-lived coordination entities that persist across multiple conversations and can remain active for days or weeks. pg-boss is designed for fire-and-forget job execution with retries and timeouts. The task lifecycle (created -> active -> paused -> completed) is managed by agents through tools, not by a job queue.

pg-boss remains in use for its existing purpose: timeout scheduling for `wait_for` signals.

### No State Machine Library for Task Status

Considered: xstate, robot, or similar state machine libraries for task status transitions.

**Why not:** Task status transitions are simple: `created -> active -> paused -> completed/cancelled`, with `paused <-> active` being bidirectional. This fits in a Zod enum with a transition validation function (~20 lines). A state machine library adds dependency weight for a trivial problem. The conversations table already manages a similar state machine without one.

### No Vector Database for Task Search

Considered: pgvector extension for semantic task search.

**Why not:** Task search is by assignee, status, and parent -- all exact-match queries on indexed columns. The `list_tasks` tool uses SQL WHERE clauses, not semantic similarity. If semantic search becomes needed later (e.g., "find tasks related to authentication"), it can be added without changing the schema -- pgvector extends existing tables.

### No Separate Correlation Service

Considered: Dedicated microservice for event-to-task correlation.

**Why not:** Integrations already process both sides of the lifecycle. Adding a separate service means either:
- Integrations call the correlation service (adds latency and a new failure mode)
- The correlation service duplicates integration logic (maintainability nightmare)

The integration owning its own correlation table is simpler and more reliable.

### No Workflow Engine for Task Orchestration

Considered: Temporal, Inngest, or similar workflow engines for orchestrating multi-conversation tasks.

**Why not:** The entire point of v2.3 was removing Temporal in favor of Postgres-backed execution. Task orchestration is agent-decided, not framework-orchestrated. The agent reasons about what to do next; the framework provides persistence and tool access. Adding a workflow engine would be the anti-pattern the CLAUDE.md explicitly warns against: "Adding deterministic overrides that fight the agent for control."

### No Change to LLM SDK

Considered: Switching to Vercel AI SDK, LangChain.js, or similar abstraction layers.

**Why not:** The existing `@anthropic-ai/sdk` is used directly for tool-use loops. The agent loop (~200 lines) calls the Anthropic API, processes tool calls, and loops. Adding an abstraction layer provides no value -- Aesir only uses one LLM provider, and the direct SDK gives full control over message format, tool schemas, and error handling.

---

## 8. Existing Stack Versions (Verified)

| Package | Version | Status | Notes |
|---------|---------|--------|-------|
| drizzle-orm | ^0.45.1 | Current | Supports all needed features (pgSchema, composite indexes, self-refs) |
| drizzle-kit | ^0.31.8 | Current | Generates migrations from schema diffs |
| zod | 3.25.67 | Current | Exact version pinned; used for all validation |
| @anthropic-ai/sdk | ^0.72.0 | Current | Native tool-use loops |
| pg-boss | ^12.8.0 | Current | Timeout scheduling only (not for tasks) |
| nanoid | ^5.1.6 | Current | ID generation with prefixes |
| zod-to-json-schema | ^3.24.5 | Current | Tool input schema generation |

No version bumps needed for v2.5 features.

---

## 9. Patterns from Production Agent Frameworks

### OpenAI Agents SDK Handoff Pattern (HIGH confidence)

**How it works:** Handoffs are represented as tools to the LLM. Each handoff becomes a `transfer_to_<agent_name>` tool. When the LLM selects this tool:
1. The `on_handoff` callback runs (can validate input, transform state)
2. `input_filter` transforms the conversation history for the receiving agent
3. The receiving agent takes over with the filtered history

**Relevance to Aesir v2.5:** The task handoff tools in the spec are conceptually similar -- they are tools that the agent calls to transfer work. Key difference: OpenAI handoffs happen within a single run (synchronous transfer), while Aesir handoffs happen across conversations (asynchronous, mediated by task).

**Pattern to adopt:** The `input_filter` concept maps to Aesir's "context pressure management." When a task has many handoffs, only the most recent is delivered as context. This is exactly what OpenAI's `input_filter` does -- selectively passing history.

**Pattern to NOT adopt:** OpenAI represents each possible target agent as a separate handoff tool. Aesir should use a single `task:handoff_task` tool with a `handoff_type` parameter. The agent decides the type; the framework doesn't need a separate tool per handoff target.

### CrewAI Task Delegation (MEDIUM confidence)

**How it works:** CrewAI defines `Task` objects with `description` and `expected_output` fields. An agent analyzes the task and decides between local execution or delegation to another agent. The `allow_delegation` flag controls whether delegation is possible.

**Relevance to Aesir v2.5:** The `Task` schema in CrewAI is simpler than Aesir's spec but validates the core concept: tasks have a description (objective), expected output (acceptance criteria), and delegation capability. CrewAI's `trust_remote_completion_status` flag (whether to trust the delegatee's completion signal) maps to the spec's "Task completion is agent-decided" principle.

**Pattern to adopt:** CrewAI's explicit `expected_output` field is worth considering as a structured field in the `tasks` table instead of relying solely on the `objective` text. However, since Aesir agents already handle this through handoff context, a separate field adds complexity without clear benefit.

### AutoGen Conversation Patterns (MEDIUM confidence)

**How it works:** AutoGen supports sequential, concurrent, hierarchical, and group chat patterns. Agents communicate through message-passing in shared conversation threads. A supervisor agent can direct subordinate agents.

**Relevance to Aesir v2.5:** AutoGen's hierarchical pattern (supervisor -> workers) maps to Aesir's orchestrator -> sub-agent pattern. The key difference: AutoGen agents share a conversation context, while Aesir agents have isolated conversations linked by tasks. Aesir's approach is more robust (isolation prevents context pollution) but requires explicit handoff context.

**Pattern validation:** AutoGen's hierarchical pattern confirms that the spec's model (orchestrator creates tasks, workers execute, orchestrator summarizes) is a well-established pattern in the multi-agent community.

### Temporal Continue-As-New (HIGH confidence)

**How it works:** Creates a new workflow execution with the same Workflow ID but different Run ID. Event history is cleared. Selected state is passed forward as arguments to the new execution.

**Relevance to Aesir v2.5:** This is the wrong pattern for conversation reopening. Temporal's Continue-As-New is for event history limits, not for continuing a conversation. Aesir's approach (reopen existing conversation with full history) is correct because:
- Conversation history is manageable (HistoryManager handles compaction)
- Context matters for follow-up handling
- The agent needs to know what it did before

**However:** Temporal's concept of an "Execution Chain" (linked executions sharing a Workflow ID) validates the spec's concept of a task linking multiple conversations. A task IS the equivalent of a Temporal Workflow ID -- it provides continuity across multiple conversation executions.

---

## 10. Integration Points with Existing Stack

### ToolContext Extension

The `ToolContext` interface may need a `taskId` field for task tools to know which task they're operating within:

```typescript
export interface ToolContext {
  agentId: string;
  correlationId: string;
  containerManager?: DevContainerManager | undefined;
  taskId?: string | undefined;        // existing but different semantics
  logger: PinoLogger;
  spawnDeps?: SpawnAgentDeps | undefined;
  currentTaskId?: string | undefined;  // NEW: the active task for task tools
}
```

Note: There is already a `taskId` field in ToolContext, but it refers to the dev container task ID, not the v2.5 task primitive. A new field name (`currentTaskId` or `activeTaskId`) avoids semantic confusion.

### MCP Header Extension

Add `X-Task-ID` header to MCP calls when the conversation is associated with a task. Integration MCP handlers read this header and record correlation:

```typescript
// In mcp-wrapper.ts (existing pattern)
headers: {
  "Content-Type": "application/json",
  "X-Agent-ID": deps.agentId,
  "X-Correlation-ID": deps.correlationId,
  "X-Task-ID": deps.taskId ?? "",  // NEW
}
```

### Event Router Integration

The `IncomingEvent` type gains `taskId?: string`. Integration adapters perform the correlation lookup (async DB query) before constructing the event. The router's synchronous `handle()` method does not need to change -- it receives the pre-resolved task reference.

### Dashboard Integration

The Next.js dashboard at `packages/dashboard/` will need updates to display:
- Task list view (new page)
- Task detail view (linked conversations, handoffs, status timeline)
- Conversation detail view: show parent task if associated

These are frontend-only changes using the existing dashboard patterns (Server Components, local schema, SSE for live updates).

---

## 11. Migration Strategy

### Migration Order

1. **Schema migration first:** Create `agents.tasks` and `agents.task_handoffs` tables. Add `task_id` column to `agents.conversations`. Create `task_correlations` tables in each integration schema.

2. **ID generation second:** Add `task`, `handoff`, and `taskCorrelation` to `createId` in `@aesir/types`.

3. **Tool factories third:** Implement task tool factories and register in `tool-factories.ts`.

4. **Agent definitions fourth:** Add `task:*` tools to agent YAML definitions.

5. **Prompt rewrites fifth:** Rewrite `prompt.md` files for product-agent and dev-agent.

6. **Executor changes sixth:** Modify `signal()` for conversation reopening.

7. **Router changes seventh:** Add task-based routing to event router.

8. **Integration adapter changes eighth:** Add correlation lookup to integration adapters.

### Backward Compatibility

- `task_id` on conversations is nullable -- existing conversations work unchanged
- New tools are added to agent definitions, not removed
- Prompt rewrites are backward-compatible (same phase tags, same wait_for patterns)
- Event router changes are additive (new routing priority before existing logic)

---

## Sources

### Official Documentation (HIGH confidence)
- [Anthropic Prompting Best Practices (Claude 4.6)](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-4-best-practices)
- [Anthropic Prompt Engineering Overview](https://platform.claude.com/docs/en/docs/build-with-claude/prompt-engineering/overview)
- [OpenAI Agents SDK Handoffs](https://openai.github.io/openai-agents-python/handoffs/)
- [Temporal Continue-As-New](https://docs.temporal.io/workflow-execution/continue-as-new)
- [GitHub Webhook Events and Payloads](https://docs.github.com/en/webhooks/webhook-events-and-payloads)
- [Zendesk Ticket Lifecycle](https://support.zendesk.com/hc/en-us/articles/8263915942938-About-the-ticket-lifecycle-and-ticket-statuses)
- [Drizzle ORM Schema Declaration](https://orm.drizzle.team/docs/sql-schema-declaration)
- [Drizzle ORM Migrations](https://orm.drizzle.team/docs/migrations)

### Community Sources (MEDIUM confidence)
- [CrewAI A2A Agent Delegation](https://docs.crewai.com/en/learn/a2a-agent-delegation)
- [LangGraph Checkpointing Best Practices 2025](https://sparkco.ai/blog/mastering-langgraph-checkpointing-best-practices-for-2025)
- [Claude Code System Prompts Repository](https://github.com/Piebald-AI/claude-code-system-prompts)
- [AutoGen Multi-Agent Patterns 2025](https://sparkco.ai/blog/deep-dive-into-autogen-multi-agent-patterns-2025)
- [Temporal + OpenAI Agents SDK Integration](https://temporal.io/blog/announcing-openai-agents-sdk-integration)

### Codebase Sources (HIGH confidence)
- `packages/agents/src/shared/db/schema.ts` -- existing Drizzle schema patterns
- `packages/agents/src/framework/types.ts` -- ToolContext, ToolFactory interfaces
- `packages/agents/src/framework/tool-factories.ts` -- registration pattern
- `packages/agents/src/framework/event-router.ts` -- current routing logic
- `packages/agents/src/adapters/types.ts` -- IncomingEvent schema
- `packages/types/src/utils/ids.ts` -- ID generation patterns
- `packages/integrations/github/src/db/schema.ts` -- integration schema pattern
- `packages/integrations/linear/src/db/schema.ts` -- integration schema pattern
- `packages/agents/definitions/PROMPT_GUIDE.md` -- prompt authoring guide
- `.planning/specs/2.5-agentic-conversations.md` -- v2.5 implementation spec
- `.planning/specs/2.5-design-vision.md` -- v2.5 design vision
