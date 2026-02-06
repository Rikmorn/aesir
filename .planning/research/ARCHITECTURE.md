# Architecture Patterns: v2.5 Agentic Conversations

**Domain:** Task primitives, conversation reopening, and integration correlation for an existing agentic development platform
**Researched:** 2026-02-06
**Confidence:** HIGH (based on direct codebase analysis of existing components)

## System Overview

v2.5 introduces three interconnected capabilities into the existing Aesir architecture:

1. **Task primitive** -- A first-class entity (`agents.tasks`) that groups related conversations and provides continuity across interactions
2. **Conversation reopening** -- Allowing terminal conversations (completed/failed) to receive a `reopen` signal and re-enter the work loop
3. **Integration correlation** -- Each integration maintains a `task_correlations` table to map external artifacts (PRs, issues, threads) back to tasks

These features touch every layer of the existing architecture but are designed to be additive -- no existing interfaces break, no existing behavior changes for conversations without tasks.

## Component Responsibilities

### New Components

| Component | Location | Responsibility |
|-----------|----------|---------------|
| TaskService | `packages/agents/src/framework/task-service.ts` | CRUD operations on `agents.tasks` and `agents.task_handoffs`, task lifecycle management, concurrency serialization |
| Task tools (6) | `packages/agents/src/shared/tools/task/` | Agent-facing tool implementations: create_task, complete_task, pause_task, handoff_task, list_tasks, get_task_context |
| Task correlation store | `packages/integrations/{integration}/src/db/correlation-store.ts` | Per-integration task_correlations CRUD (one per integration package) |
| Correlation middleware | `packages/integrations/{integration}/src/mcp/correlation-middleware.ts` | MCP response interceptor that records outgoing correlations |

### Modified Components

| Component | File | What Changes |
|-----------|------|-------------|
| ConversationExecutor | `packages/agents/src/framework/conversation-executor.ts` | `signal()` handles `reopen` on terminal conversations |
| EventRouter | `packages/agents/src/framework/event-router.ts` | No change (task routing added in caller) |
| Adapters | `packages/agents/src/adapters/*.ts` | Pass through `taskId` field from NormalizedEvent |
| NormalizedEvent schema | `packages/types/src/events/schema.ts` | Add optional `taskId` field |
| IncomingEvent schema | `packages/agents/src/adapters/types.ts` | Add optional `taskId` field |
| Router (core) | `packages/agents/src/router/router.ts` | Task-aware routing before trigger match |
| ToolContext | `packages/agents/src/framework/types.ts` | Add optional `taskId` to ToolContext (and rename existing `taskId` which is used for sandbox container) |
| Tool factories | `packages/agents/src/framework/tool-factories.ts` | Register 6 new task tools |
| DB schema | `packages/agents/src/shared/db/schema.ts` | Add tasks, task_handoffs tables; task_id FK on conversations |
| Worker loop | `packages/agents/src/framework/worker-loop.ts` | Inject task context into system prompt when conversation has task_id |
| createId | `packages/types/src/utils/ids.ts` | Add `task` and `handoff` ID generators |
| Service main | `packages/agents/src/service/main.ts` | Bootstrap TaskService, pass to executor and tool factories |
| API router | `packages/agents/src/service/api/router.ts` | Add reopen endpoint |
| Integration webhook handlers | `packages/integrations/*/src/api/webhooks.ts` | Look up task correlation before dispatching event |
| Integration MCP routes | `packages/integrations/*/src/api/mcp.ts` | Extract X-Task-ID header, record correlation on success |
| Integration DB schemas | `packages/integrations/*/src/db/schema.ts` | Add task_correlations table |
| MCP client | `packages/agents/src/shared/mcp/client.ts` | Add X-Task-ID header when taskId is set |
| MCP types | `packages/agents/src/shared/mcp/types.ts` | Add optional taskId to McpCallOptions |

### Unchanged Components

| Component | Why Unchanged |
|-----------|--------------|
| EventLog | Append-only events are per-conversation; conversations know their task |
| SessionProjection | Operates on conversation events, not tasks |
| HistoryManager | Compaction operates on message arrays; task context injected before history |
| TimeoutScheduler | Works on conversation-level wait_for timeouts |
| Agent definitions (YAML) | Only change: add new tool refs to `tools:` list |
| AgentRegistry | Loads YAML unchanged; new tools are registered, not defined in YAML structure |

## Schema Design

### tasks table

```sql
CREATE TABLE agents.tasks (
  id            TEXT PRIMARY KEY,  -- gen via createId.task() -> "task_<nanoid>"
  parent_id     TEXT REFERENCES agents.tasks(id),
  creator_type  TEXT NOT NULL CHECK (creator_type IN ('agent', 'human')),
  creator_id    TEXT NOT NULL,
  assignee_type TEXT NOT NULL CHECK (assignee_type IN ('agent', 'human')),
  assignee_id   TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'created'
                CHECK (status IN ('created', 'active', 'paused', 'completed', 'cancelled')),
  title         TEXT NOT NULL,
  objective     TEXT,
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ
);
```

**Index design:**

```sql
-- Primary query: "what tasks is this agent working on?"
CREATE INDEX idx_tasks_assignee ON agents.tasks(assignee_type, assignee_id, status);

-- Subtask lookup: "what are the children of this task?"
CREATE INDEX idx_tasks_parent ON agents.tasks(parent_id) WHERE parent_id IS NOT NULL;

-- Active task queries (dashboard, routing)
CREATE INDEX idx_tasks_status ON agents.tasks(status) WHERE status IN ('created', 'active', 'paused');
```

**Rationale:**
- Composite `(assignee_type, assignee_id, status)` index covers the most common query: "find active tasks for agent X." The partial index on active statuses keeps the index small since most tasks eventually complete.
- The `parent_id` partial index excludes root tasks (where parent_id IS NULL) since those are never looked up by parent.
- No separate index on `creator_type/creator_id` -- creator queries are infrequent (analytics, not runtime routing).

**ID generation -- recommendation against human-readable sequential IDs:**

The spec mentions `gen_task_id()`. The recommendation is to use the existing `createId` pattern (`task_<nanoid>`) rather than a PostgreSQL sequence-based "T-001" style because:

1. **Existing convention**: Every table in Aesir uses `prefix_<nanoid>` IDs. Introducing a different pattern creates cognitive overhead.
2. **No collision across environments**: Sequential IDs collide when syncing dev/staging/production data.
3. **External reference is the human-readable ID**: Tasks correlate with Linear issue identifiers (e.g., AES-42) which are already human-readable. The task.metadata can store this mapping.
4. **Simplicity**: No function definition needed, no sequence management, works with Drizzle's `$defaultFn` pattern.

If human-readable task IDs are genuinely needed for debugging, add a `display_id` column with a DB sequence. But the primary key should remain nanoid-based.

### task_handoffs table

```sql
CREATE TABLE agents.task_handoffs (
  id                TEXT PRIMARY KEY,  -- gen via createId.handoff() -> "ho_<nanoid>"
  task_id           TEXT NOT NULL REFERENCES agents.tasks(id),
  conversation_id   TEXT NOT NULL REFERENCES agents.conversations(id),
  handoff_type      TEXT NOT NULL CHECK (handoff_type IN ('completion', 'pause', 'delegation', 'escalation')),
  context           JSONB NOT NULL,  -- agent-authored context
  author_type       TEXT NOT NULL CHECK (author_type IN ('agent', 'human')),
  author_id         TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_handoffs_task ON agents.task_handoffs(task_id, created_at);
```

**Design notes:**
- `context` is JSONB, not text. This allows structured handoff content (summary, key decisions, artifacts, open questions) rather than free-form text. The agent writes structured JSON via the tool schema.
- No `updated_at` -- handoffs are append-only records. A new handoff is created, not an update to an existing one.
- The `(task_id, created_at)` index supports "get most recent handoff for task" efficiently.

### conversations addition

```sql
ALTER TABLE agents.conversations ADD COLUMN task_id TEXT REFERENCES agents.tasks(id);
CREATE INDEX idx_conversations_task ON agents.conversations(task_id) WHERE task_id IS NOT NULL;
```

**Nullable FK rationale:** Backward compatibility. Existing conversations (and future conversations without tasks) don't require a task. The partial index keeps it efficient.

### Integration correlation tables

Each integration gets an identical table in its own schema:

```sql
-- In linear.*, github.*, slack.* schemas respectively
CREATE TABLE {schema}.task_correlations (
  external_type   TEXT NOT NULL,       -- e.g., 'pull_request', 'issue', 'thread'
  external_ref    TEXT NOT NULL,       -- e.g., '42' (PR number), 'AES-123' (issue ID), 'C123:1234.5678' (channel:ts)
  task_id         TEXT NOT NULL,       -- References agents.tasks(id) -- no FK (cross-schema)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (external_type, external_ref)
);

CREATE INDEX idx_task_correlations_task ON {schema}.task_correlations(task_id);
```

**Cross-schema FK decision:** No foreign key from `{integration}.task_correlations.task_id` to `agents.tasks.id`. Reason: integration packages are independently deployable and must not have schema-level dependencies on the agents schema. Task ID validity is enforced at the application layer.

**External type taxonomy:**

| Integration | external_type | external_ref format |
|-------------|--------------|-------------------|
| GitHub | `pull_request` | `{owner}/{repo}#{number}` e.g., `acme/api#42` |
| GitHub | `branch` | `{owner}/{repo}:{branch}` e.g., `acme/api:feature/AES-123` |
| Linear | `issue` | Linear issue ID e.g., `AES-123` |
| Slack | `thread` | `{channelId}:{thread_ts}` e.g., `C0123ABC:1706745600.123456` |
| Slack | `message` | `{channelId}:{message_ts}` |

## Data Flow

### Flow 1: Agent creates artifact with task correlation (outgoing)

```
Agent calls create_pull_request tool
  -> MCP wrapper adds X-Task-ID header from ToolContext.taskId
  -> callMcpTool() sends POST /mcp/tools/create_pull_request
     with X-Task-ID: task_abc123
  -> GitHub integration receives request
  -> Executes create_pull_request against GitHub API
  -> On success: records correlation
     INSERT INTO github.task_correlations
       (external_type, external_ref, task_id)
     VALUES ('pull_request', 'acme/api#42', 'task_abc123')
  -> Returns result to agent
```

**Where correlation recording happens:** In the MCP HTTP route handler (`packages/integrations/github/src/api/mcp.ts`), after the tool handler returns success. This is a post-success hook, not middleware, because we only record correlations for successful operations.

**Key design decision:** Correlation recording is fire-and-forget. If it fails (DB error), the tool result still returns success to the agent. A missing correlation means the incoming webhook won't auto-route to the task, but the event will still reach slow-path routing.

### Flow 2: Webhook arrives with task correlation (incoming)

```
GitHub sends PR review webhook
  -> GitHub integration verifies signature, deduplicates
  -> BEFORE normalizing: look up correlation
     SELECT task_id FROM github.task_correlations
     WHERE external_type = 'pull_request' AND external_ref = 'acme/api#42'
  -> Found task_id = 'task_abc123'
  -> Normalize event with task_id attached:
     NormalizedEvent { ..., taskId: 'task_abc123' }
  -> Dispatch to agent service POST /events
  -> Agent service adapter passes taskId through:
     IncomingEvent { ..., taskId: 'task_abc123' }
  -> Router: task reference exists!
     -> Look up active conversation for task
     -> If active/waiting: deliver as signal
     -> If no active conversation: create new conversation with handoff context
  -> Falls through to existing trigger/signal logic only if no task reference
```

### Flow 3: Conversation reopening

```
Dashboard user clicks "Reopen" on a completed conversation
  -> POST /conversations/:id/reopen { message: "PR review requires changes" }
  -> ConversationExecutor.signal(id, { type: 'reopen', message, source: 'dashboard' })
  -> signal() handler: conversation status is 'completed'
     -> Current behavior: reject (terminal status)
     -> NEW behavior for type === 'reopen':
        1. Transition status: completed -> queued
        2. Append signal as user message to existing messages array
        3. Reset retry_count to 0
        4. Clear error_message
        5. Append event: agent.reopened (new event type)
        6. Return { action: 'resumed' }
  -> Worker loop picks up queued conversation on next poll
  -> Agent receives full prior history + reopen context
```

**Race condition analysis:**

The race between "conversation completing" and "reopen signal arriving" is handled by the existing `FOR UPDATE` lock in `signal()`:

1. If signal arrives during the executor's post-loop DB write, the signal's `FOR UPDATE` will block until the executor's transaction commits.
2. Once the executor commits `status: 'completed'`, the signal's transaction sees the terminal status and can apply the reopen logic.
3. If the executor hasn't committed yet (status still 'running'), the signal queues normally and is consumed when the conversation transitions.

**This is safe because the existing SKIP LOCKED + FOR UPDATE pattern already serializes all mutations on a conversation row.**

### Flow 4: Task-aware event routing

```
Event arrives at routeEvent()
  |
  v
Adapter pipeline (existing)
  -> Produces IncomingEvent with optional taskId
  |
  v
Task-aware routing (NEW -- before EventRouter.handle())
  |
  +-- Has taskId?
  |     |
  |     +-- Look up task in DB
  |     |     |
  |     |     +-- Task has active/waiting conversation?
  |     |     |     -> Deliver as signal to that conversation
  |     |     |
  |     |     +-- Task has no active conversation?
  |     |           -> Start new conversation for task's assignee agent
  |     |           -> Inject most recent handoff as context
  |     |
  |     +-- Task not found? (stale correlation)
  |           -> Fall through to existing routing
  |
  +-- No taskId?
        -> Existing EventRouter.handle() (unchanged)
        -> start / signal / ignore / slow_path
```

**Where the task lookup happens:** In `routeEvent()` in `packages/agents/src/router/router.ts`, as a new code block BEFORE the existing `deps.eventRouter.handle(incomingEvent)` call. NOT in the adapter layer (adapters are pure transforms) and NOT in EventRouter (which is synchronous and should not do DB I/O).

## Architectural Patterns

### Pattern 1: TaskService as a Thin Persistence Layer

**What:** A factory function `createTaskService({ db, logger })` that provides CRUD for tasks and handoffs, plus task-level queries. No business logic beyond data validation.

**Why:** Task lifecycle decisions (when to complete, when to pause, what to hand off) belong to the agent via tools. The TaskService is infrastructure, not behavior. This follows the agent-first principle.

**Interface:**

```typescript
interface TaskService {
  create(params: CreateTaskParams): Promise<string>;       // Returns task ID
  get(taskId: string): Promise<Task | null>;
  update(taskId: string, updates: TaskUpdate): Promise<void>;
  list(filters: TaskListFilters): Promise<Task[]>;
  addHandoff(params: AddHandoffParams): Promise<string>;   // Returns handoff ID
  getLatestHandoff(taskId: string): Promise<TaskHandoff | null>;
  getHandoffs(taskId: string): Promise<TaskHandoff[]>;
  findActiveConversation(taskId: string): Promise<string | null>; // Returns conversation ID
}
```

**Database access pattern for tools:** Tools call TaskService methods, NOT raw DB queries. This provides a single point for validation, logging, and future concerns (notifications, audit trail).

```
Agent tool (create_task)
  -> TaskService.create({ ... })
    -> Validates: parent depth < 5, no cycles, creator/assignee valid
    -> INSERT INTO agents.tasks
    -> Returns task ID
```

### Pattern 2: MCP Header Extension for Task Context

**What:** Add `X-Task-ID` as an optional standard header in MCP calls. The MCP client adds it when ToolContext.taskId is set. Integration MCP handlers read it and pass to correlation recording.

**Why headers over parameters:**
1. **Non-invasive**: Existing tool parameter schemas don't change. No migration of tool definitions.
2. **Consistent**: Same pattern as X-Agent-ID and X-Correlation-ID.
3. **Optional**: Integrations that don't support correlation yet simply ignore the header.
4. **Already precedented**: The MCP protocol already uses X-Agent-ID and X-Correlation-ID headers.

**Changes to MCP client (`packages/agents/src/shared/mcp/client.ts`):**

```typescript
// In callMcpTool():
const headers: Record<string, string> = {
  'Content-Type': 'application/json',
  'X-Agent-ID': agentId,
  'X-Correlation-ID': correlationId,
};
if (options.taskId) {
  headers['X-Task-ID'] = options.taskId;
}
```

**Changes to McpCallOptions type (`packages/agents/src/shared/mcp/types.ts`):**

```typescript
interface McpCallOptions {
  integration: McpIntegration;
  tool: string;
  params: Record<string, unknown>;
  agentId: string;
  correlationId: string;
  taskId?: string;  // NEW
}
```

**Changes to MCP tool wrappers (`packages/agents/src/shared/tools/integration/`):**

The McpToolDeps interface gains an optional `taskId` field. Each integration's tool wrapper reads `ToolContext.taskId` and passes it through in the `callMcpTool()` options.

### Pattern 3: Conversation Reopening via Signal Extension

**What:** Extend the existing `signal()` method to handle a special `reopen` signal type on terminal conversations, rather than adding a separate `reopen()` method.

**Why signal extension over new method:**
1. **Signal is already the mechanism for external input** to conversations. Reopening is external input.
2. **Deduplication, validation, and event logging** are already handled by signal(). No duplication.
3. **The router can use the same dispatch path** -- route to signal, whether the conversation is waiting or completed.
4. **Dashboard reopen** is just `executor.signal(id, { type: 'reopen', ... })`.

**Specific changes to `signal()` in conversation-executor.ts (lines ~451-459):**

The current terminal status block:
```typescript
// Terminal status
logger.warn({ conversationId, status }, "Signal rejected: conversation in terminal state");
return { action: "rejected" };
```

Becomes:
```typescript
// Terminal status
if (signal.type === 'reopen') {
  // Build signal message
  const signalContent = signal.message ??
    `Conversation reopened. Data: ${JSON.stringify(signal.data ?? {})}`;
  const signalMessage = { role: 'user', content: signalContent };
  const updatedMessages = [...((row.messages ?? []) as unknown[]), signalMessage];

  await tx.update(conversations).set({
    status: 'queued',
    messages: updatedMessages,
    retry_count: 0,
    error_message: null,
    pending_wait: null,
    claimed_by: null,
    claimed_at: null,
    last_heartbeat_at: null,
    delivered_signal_ids: deliveredIds,
    updated_at: new Date(),
  }).where(eq(conversations.id, conversationId));

  // Append reopened event
  await eventLog.initSequence(conversationId);
  eventLog.append({
    conversationId,
    agentDefinitionId: row.agent_definition_id,
    agentDefinitionVersion: row.agent_definition_version,
    agentInstanceId: `reopen-${conversationId}`,
    type: 'agent.reopened',
    payload: {
      signalType: signal.type,
      source: signal.source,
      previousStatus: status,
    },
  });
  await eventLog.flush();

  logger.info({ conversationId, previousStatus: status }, 'Conversation reopened');
  return { action: 'resumed' };
}

// Other signals on terminal conversations remain rejected
logger.warn({ conversationId, status }, "Signal rejected: conversation in terminal state");
return { action: "rejected" };
```

**Full history preservation:** Yes. Reopened conversations keep their entire message history. The reopen signal is appended as a new user message. When the worker loop picks it up, it goes through the normal `isResumed` path (existingMessages.length > 1), gets history compaction via HistoryManager, and resumes with full context.

**Worker loop changes for reopened conversations:** NONE. Reopened conversations are `status: 'queued'` -- the worker loop claims and executes them identically to any other queued conversation. No special claiming logic needed.

**New event type:** Add `agent.reopened` to `agentEventTypeValues` in schema.ts. This is purely observability -- the framework doesn't branch on it.

### Pattern 4: Task Context Injection into Prompts

**What:** When the worker loop starts executing a conversation with a `task_id`, it fetches the most recent handoff and injects it as a `<task_context>` block in the initial message.

**Where:** In `executeConversation()` in `worker-loop.ts`, after loading the agent definition (step 1) and before building the `AgentLoopOptions` (step 8). Specifically, after the queued-signal check (step 6) and before history compaction (step 7). This is the same pattern used in `routeEvent()` for workspace_context and slack_context injection.

**Implementation approach:**

```typescript
// In executeConversation(), between step 6 and step 7:
if (conv.task_id && taskService) {
  const task = await taskService.get(conv.task_id);
  const latestHandoff = await taskService.getLatestHandoff(conv.task_id);

  if (task) {
    const taskContextLines: string[] = [
      '<task_context>',
      `Task: ${task.title}`,
      `Task ID: ${task.id}`,
      `Status: ${task.status}`,
    ];

    if (task.objective) taskContextLines.push(`Objective: ${task.objective}`);

    if (latestHandoff) {
      taskContextLines.push('');
      taskContextLines.push('Most recent handoff:');
      taskContextLines.push(`Type: ${latestHandoff.handoff_type}`);
      // Truncate handoff context to prevent token budget blowout
      const contextStr = JSON.stringify(latestHandoff.context);
      const truncated = contextStr.length > 4000
        ? contextStr.slice(0, 4000) + '... [truncated, use get_task_context for full history]'
        : contextStr;
      taskContextLines.push(`Context: ${truncated}`);
    }

    taskContextLines.push('</task_context>');

    // Prepend to first message
    const taskContextBlock = taskContextLines.join('\n');
    const firstMsg = currentMessages[0];
    if (firstMsg && typeof firstMsg.content === 'string') {
      currentMessages[0] = {
        ...firstMsg,
        content: `${taskContextBlock}\n\n${firstMsg.content}`,
      };
    }
  }
}
```

**Token budget considerations:** Handoff context is agent-authored (agents control the size). The `get_task_context` tool provides full history for agents that need it; the auto-injected context is just the latest handoff. This keeps the injection bounded. A 4000-character cap on the handoff JSON provides a safety net -- agents needing more context use the tool.

### Pattern 5: Task-Level Event Serialization

**What:** When two events arrive for the same task simultaneously, only one gets a conversation. The second becomes a signal queued on that conversation.

**Why:** The spec says "one problem at a time." Concurrent conversations for the same task would create conflicting work (two agents editing the same branch, two PRs for the same issue).

**Implementation:**

Serialization happens at the router level using `SELECT ... FOR UPDATE` on the task row:

```typescript
// In routeEvent(), task-aware routing block:
async function routeToTask(
  taskId: string,
  event: IncomingEvent,
  deps: RouteEventDeps
): Promise<RouteEventResult | null> {
  return await deps.db.transaction(async (tx) => {
    // Lock task row -- serializes concurrent events for same task
    const [task] = await tx
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .for('update');

    if (!task) return null; // Stale correlation, fall through

    // Find active conversation for this task
    const [activeConv] = await tx
      .select({ id: conversations.id, status: conversations.status })
      .from(conversations)
      .where(
        and(
          eq(conversations.task_id, taskId),
          inArray(conversations.status, ['running', 'queued', 'waiting'])
        )
      )
      .limit(1);

    if (activeConv) {
      // Signal will be delivered after transaction commits
      return { type: 'signal', conversationId: activeConv.id };
    }

    // No active conversation -- will start new one after transaction commits
    return { type: 'start', agentDefinitionId: task.assignee_id };
  });
  // Then outside the transaction: execute the routing decision
}
```

**Row-level lock on task, not conversation:** The lock is on `agents.tasks` row, not `agents.conversations`. This serializes at the task level -- even when no conversation exists yet, the second event waits for the first's conversation creation to commit.

**Lock duration:** Very short. The transaction only does SELECT + SELECT, then returns a routing decision. The actual conversation creation/signal delivery happens OUTSIDE the transaction via executor.start() or executor.signal(). This prevents long-held locks.

**RouteEventDeps change:** The routeEvent deps need access to a database client. Currently RouteEventDeps has executor, eventRouter, logger, and config values. Add `db` (or `taskService` which wraps db) so the task lookup query can execute.

### Pattern 6: Tool Namespace for Tasks

**What:** New `task:` namespace with 6 tools, registered via the existing ToolRegistry pattern.

**Why a new namespace (not coordination):** Tasks are a domain concept, not coordination infrastructure. Coordination tools (spawn_agent, wait_for, request_human_input) manage the execution lifecycle. Task tools manage the work lifecycle. Separating them keeps the namespaces semantically clean and allows agents to have task tools without coordination tools (or vice versa).

**Tool adapter pattern:**

```typescript
function taskToolAdapter(
  createFn: (service: TaskService, ctx: ToolContext) => ToolDefinition,
  taskService: TaskService,
): (ctx: ToolContext) => ToolDefinition {
  return (ctx: ToolContext) => createFn(taskService, ctx);
}

// In registerAllTools():
export function registerAllTools(options: RegisterAllToolsOptions): void {
  const { registry, logger, taskService } = options;  // taskService added to options

  // ... existing 28 tools ...

  // Task tools (6)
  if (taskService) {
    registry.register('task:create_task', taskToolAdapter(createCreateTaskTool, taskService));
    registry.register('task:complete_task', taskToolAdapter(createCompleteTaskTool, taskService));
    registry.register('task:pause_task', taskToolAdapter(createPauseTaskTool, taskService));
    registry.register('task:handoff_task', taskToolAdapter(createHandoffTaskTool, taskService));
    registry.register('task:list_tasks', taskToolAdapter(createListTasksTool, taskService));
    registry.register('task:get_task_context', taskToolAdapter(createGetTaskContextTool, taskService));
  }
}
```

**Handoff tool -- what context the agent provides:**

The `handoff_task` tool schema:
```json
{
  "task_id": "string (required)",
  "handoff_type": "enum: completion | pause | delegation | escalation (required)",
  "context": {
    "summary": "string (required) -- what happened",
    "key_decisions": "string[] (optional) -- important decisions made",
    "artifacts": "object (optional) -- references to created artifacts",
    "open_questions": "string[] (optional) -- unresolved issues",
    "next_steps": "string (optional) -- recommendation for next agent"
  }
}
```

The agent decides what to include. The tool validates the required `summary` field but doesn't enforce the optional fields. This follows the "agents author handoffs" principle.

## Anti-Patterns to Avoid

### Anti-Pattern 1: Task State Machine in Framework Code

**What to avoid:** Don't add framework code that pattern-matches on handoff_type or auto-transitions task status based on external signals.

**Why:** Per the spec's expansion constraints: "Don't pattern-match on handoff_type in framework code" and "Task completion is agent-decided." The framework stores and delivers; the agent interprets.

**Exception:** The `complete_task` and `pause_task` tools DO transition task status -- but these are agent-initiated, not framework-initiated. The agent calls the tool when it decides the task is done.

### Anti-Pattern 2: Correlation in Router Instead of Integration

**What to avoid:** Don't do correlation lookup in the agent-service's EventRouter or adapter layer.

**Why:** The integration processes both sides of the artifact lifecycle (outgoing creation + incoming webhook). It has the most context for reliable correlation. If the router did correlation, it would need to query integration-owned tables (cross-schema dependency) or maintain a separate correlation store (duplication).

### Anti-Pattern 3: Auto-Completing Tasks on External Signals

**What to avoid:** Don't add framework logic like "when PR merged, auto-complete the task."

**Why:** The agent should decide when a task is complete. A merged PR might not mean the task is done (could need docs, follow-up, verification). The agent receives the PR merged signal, evaluates whether the task is complete, and calls `complete_task` if so.

## Critical Integration Detail: ToolContext.taskId Collision

**Existing usage:** `ToolContext.taskId` already exists in `packages/agents/src/framework/types.ts` (line 320):

```typescript
export interface ToolContext {
  agentId: string;
  correlationId: string;
  containerManager?: DevContainerManager | undefined;
  taskId?: string | undefined;  // <-- Currently used as sandbox container identifier
  logger: PinoLogger;
  spawnDeps?: SpawnAgentDeps | undefined;
}
```

This `taskId` is set to the conversation ID (`conv.id`) in the worker loop (line 465) and passed to DevContainerManager for sandbox identification:

```typescript
const toolContext: ToolContext = {
  agentId: conv.agent_definition_id,
  correlationId: conv.id,
  logger: childLogger,
  ...(needsSandbox && sandboxManager && {
    containerManager: sandboxManager,
    taskId: conv.id,  // <-- conversation ID used as container ID
  }),
  // ...
};
```

**Resolution:** Rename the existing field to `sandboxId` (or `containerId`). This is an internal interface change affecting:
1. `packages/agents/src/framework/types.ts` -- ToolContext interface
2. `packages/agents/src/framework/worker-loop.ts` -- where it's set
3. `packages/agents/src/shared/tools/codebase/*.ts` -- where it's read (5 tool factories)
4. `packages/agents/src/shared/tools/types.ts` -- CodebaseToolDeps type if it references taskId

Then `taskId` can be used for the v2.5 task primitive (the `agents.tasks.id`), set from `conv.task_id`.

**This should be done in the same phase as the task primitive schema** to avoid a confusing intermediate state where `taskId` means "container ID."

## Dashboard API Endpoints

### POST /conversations/:id/reopen

```typescript
// In main.ts, alongside existing conversation endpoints:
app.post('/conversations/:id/reopen', async (req, res) => {
  try {
    const { message } = req.body as { message?: string };
    const result = await executor.signal(req.params.id, {
      type: 'reopen',
      message: message || 'Conversation reopened via dashboard',
      source: 'dashboard',
      data: {},
    });

    if (result.action === 'rejected') {
      // Conversation might not exist or might not be in terminal state
      res.status(409).json({ error: 'Cannot reopen this conversation' });
      return;
    }
    res.json({ reopened: true, action: result.action });
  } catch (error) {
    logger.error({ err: error, conversationId: req.params.id },
      'POST /conversations/:id/reopen failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

**No separate retry endpoint needed.** Reopening IS the retry mechanism. The reopened conversation goes through the normal execution path with full history context.

## Suggested Build Order (Dependency-Driven)

### Phase 1: Prompt Rewrites (independent, no code changes)
- Rewrite product-agent/prompt.md and dev-agent/prompt.md
- No framework changes, no schema changes
- Can be done in parallel with Phase 2

### Phase 2: Conversation Reopening
**Dependencies:** None (extends existing executor)
**Files changed:**
1. `packages/agents/src/shared/db/schema.ts` -- add `agent.reopened` to event type enum
2. `packages/agents/src/shared/db/schema.drizzle.ts` -- mirror the enum change
3. Migration file for the enum change
4. `packages/agents/src/framework/conversation-executor.ts` -- reopen handling in signal()
5. `packages/agents/src/service/main.ts` -- add POST /conversations/:id/reopen endpoint
6. Dashboard: add reopen button (minimal -- single HTTP POST)

**Why first (after prompts):** Simplest infrastructure change. No new tables, no new tools. Establishes the "signal on terminal conversation" pattern that task routing depends on.

### Phase 3: Task Primitive (schema + service + tools)
**Dependencies:** Phase 2 (reopening used by task-aware routing)

**3a: Schema + Service + ToolContext Rename**
1. Rename ToolContext.taskId to sandboxId (codebase tools, worker-loop, types)
2. Add tasks, task_handoffs tables to schema.ts + schema.drizzle.ts
3. Add task_id column to conversations
4. Migration
5. Add `task` and `handoff` to createId in ids.ts
6. Implement TaskService factory (`framework/task-service.ts`)
7. Bootstrap TaskService in main.ts

**3b: Agent Tools**
1. Create 6 tool implementations in `shared/tools/task/`
2. Register in tool-factories.ts (new `task:` namespace)
3. Add tools to agent definition YAML files
4. Wire TaskService into registerAllTools via options
5. Add taskId to ToolContext, set from conv.task_id in worker-loop

**3c: Task-Aware Routing**
1. Add taskId to NormalizedEvent schema, IncomingEvent schema
2. Pass through in adapters
3. Add task routing pre-check in routeEvent()
4. Implement task-level serialization (FOR UPDATE on task row)
5. Add db/taskService to RouteEventDeps
6. Task context injection in worker-loop executeConversation()

### Phase 4: Integration Correlation
**Dependencies:** Phase 3a (tasks table must exist)

**4a: Integration Schema + Store (per integration)**
1. Add task_correlations table to each integration's schema.ts + schema.drizzle.ts
2. Implement correlation store per integration
3. Migration per integration

**4b: Outgoing Correlation (MCP changes)**
1. Add taskId to McpCallOptions in mcp/types.ts
2. Add X-Task-ID header in mcp/client.ts callMcpTool()
3. Update MCP tool wrapper (McpToolDeps) to pass taskId from ToolContext
4. Add correlation recording in each integration's MCP route handler (post-success hook)

**4c: Incoming Correlation (Webhook changes)**
1. Add correlation lookup in each integration's webhook handler
2. Attach taskId to NormalizedEvent before dispatch
3. End-to-end test: create artifact via MCP -> receive webhook -> auto-route to task

### Phase 5: Prompt Evolution
**Dependencies:** Phase 3b (task tools exist), Phase 4 (correlation works)
- Update all agent prompts to leverage task lifecycle
- Add handoff examples to few-shot sections
- Guide agents on when to create/complete/hand off tasks

## Concurrency Deep Dive

### Race: Two events for the same task arrive simultaneously

**Scenario:** PR review and CI failure both arrive for task T123 within milliseconds.

**Mechanism:** Both events hit `routeEvent()`. Both attempt the task-aware routing block.

**Serialization:** The `SELECT ... FOR UPDATE` on the task row in the routing transaction means:
1. Event A acquires lock on task T123
2. Event A sees no active conversation, creates one via `executor.start()`
3. Event A's transaction commits, releasing the lock
4. Event B acquires lock on task T123
5. Event B sees the newly created active conversation
6. Event B delivers as signal to that conversation

**Lock contention is minimal** because the routing transaction is short (two SELECTs + a routing decision return). The actual conversation creation happens outside the transaction.

### Race: Signal arrives during conversation completion write

**Already handled** by the existing `FOR UPDATE` in `signal()`. The signal's FOR UPDATE blocks until the executor's write transaction commits, then sees the final status and acts accordingly.

### Race: Two agents create artifacts referencing the same external entity

**Scenario:** Two conversations both create a PR for the same repo.

**Handled by:** The `PRIMARY KEY (external_type, external_ref)` on task_correlations. The second INSERT fails with a unique violation. The correlation recording is fire-and-forget, so this silently fails. The first correlation wins.

**This is correct behavior:** The first task to create the artifact "owns" it for routing purposes.

### Race: Conversation reopened while task is being completed by another conversation

**Scenario:** Dashboard user clicks "reopen" on conversation A while conversation B (for the same task) calls `complete_task`.

**Not a data integrity issue:** Reopening conversation A doesn't affect the task status. The reopened conversation will see the task's current status when it resumes. If the task is completed, the agent can check via `get_task_context` and decide whether to do more work or gracefully exit.

## Sources

All findings are based on direct analysis of the existing Aesir codebase:

**Framework core:**
- `packages/agents/src/framework/conversation-executor.ts` -- signal handling, terminal status logic (lines 296-460)
- `packages/agents/src/framework/event-router.ts` -- routing decision structure, SIGNAL_AGENT_MAP
- `packages/agents/src/framework/worker-loop.ts` -- conversation execution, context injection, sandbox setup
- `packages/agents/src/framework/types.ts` -- ToolContext (line 312-325), interfaces, schemas
- `packages/agents/src/framework/tool-factories.ts` -- tool registration patterns (28 tools, 4 namespaces)
- `packages/agents/src/framework/tool-registry.ts` -- namespace:tool_name resolution

**Router and adapters:**
- `packages/agents/src/router/router.ts` -- routeEvent() flow, enrichment patterns
- `packages/agents/src/router/types.ts` -- RouteEventDeps, RouteEventResult
- `packages/agents/src/adapters/types.ts` -- IncomingEvent, SIGNAL_TYPE_MAP
- `packages/agents/src/adapters/github.ts` -- adapter transform pattern, BRANCH_TASK_REGEX

**Database schemas:**
- `packages/agents/src/shared/db/schema.ts` -- conversations, agent_events, agent_sessions definitions
- `packages/agents/src/shared/db/schema.drizzle.ts` -- drizzle-kit version (retains legacy tables)
- `packages/integrations/github/src/db/schema.ts` -- credentials, webhook_deliveries, mcp_tool_permissions
- `packages/integrations/linear/src/db/schema.ts` -- same pattern as github
- `packages/integrations/slack/src/db/schema.ts` -- installations, event_deliveries, mcp_tool_permissions

**MCP protocol:**
- `packages/agents/src/shared/mcp/client.ts` -- callMcpTool(), header pattern
- `packages/agents/src/shared/mcp/types.ts` -- McpCallOptions interface
- `packages/types/src/mcp/types.ts` -- MCPToolContext, MCPToolResult (server-side)
- `packages/integrations/github/src/api/mcp.ts` -- MCP HTTP route handler pattern

**Integration event flow:**
- `packages/integrations/github/src/api/webhooks.ts` -- webhook handler, dispatch flow
- `packages/integrations/github/src/dispatcher/client.ts` -- fire-and-forget HTTP dispatch
- `packages/integrations/github/src/dispatcher/normalize.ts` -- event normalization
- `packages/types/src/events/schema.ts` -- NormalizedEvent schema

**Service and bootstrapping:**
- `packages/agents/src/service/main.ts` -- bootstrap sequence, route deps
- `packages/agents/src/service/api/router.ts` -- API endpoint pattern
- `packages/types/src/utils/ids.ts` -- createId pattern

**Spec documents:**
- `.planning/specs/2.5-agentic-conversations.md` -- implementation spec
- `.planning/specs/2.5-design-vision.md` -- architectural rationale and expansion constraints

## Confidence Assessment

| Area | Confidence | Reason |
|------|------------|--------|
| Schema design | HIGH | Based on existing Drizzle patterns, Postgres conventions, and direct codebase analysis |
| Conversation reopening | HIGH | Clean extension of existing signal() with well-understood FOR UPDATE serialization |
| MCP header extension | HIGH | Follows established X-Agent-ID / X-Correlation-ID pattern exactly |
| Task-aware routing | HIGH | routeEvent() is the correct injection point; FOR UPDATE provides serialization |
| Tool registration | HIGH | Follows exact pattern of existing 28 tools across 4 namespaces |
| Integration correlation | MEDIUM | Design is sound but implementation touches 3 independent packages; needs per-integration testing |
| ToolContext.taskId rename | HIGH | Confirmed collision via direct code reading; rename is straightforward but touches ~10 files |
| Token budget for task context | MEDIUM | 4000-char cap is a reasonable heuristic; needs tuning based on real handoff sizes |
| Build order | HIGH | Dependency chain is clear from code analysis; each phase builds on verified prior work |
