# Phase 70: Task Delegation - Research

**Researched:** 2026-02-10
**Domain:** Cross-conversation agent delegation via tasks, negotiation handshake, and async signal-based coordination
**Confidence:** HIGH

## Summary

Phase 70 enables agents to delegate work to other agents through the task system. A delegating agent calls `task:delegate` targeting a directory entity, which creates a task and starts a new conversation for the target agent via `executor.start()`. The target agent receives a focused `<delegation>` XML block (not the full message history), evaluates it, and responds via `task:respond` (accept/reject). The delegator pauses with `wait_for` and resumes when the handshake signal arrives. Depth enforcement prevents unbounded delegation chains.

This phase is entirely about composing existing infrastructure (tasks, conversations, signals, directory, wait_for) with two new tools (`task:delegate`, `task:respond`), a thin materialization layer, one schema migration (depth column on tasks), and prompt updates for delegation judgment. No new external dependencies are required. The primary risk is subtle race conditions in the async handshake flow, but the existing signal queueing and auto-resume mechanisms in the worker loop already handle this pattern.

**Primary recommendation:** Build `task:delegate` as a tool that orchestrates existing services (DirectoryService.get + TaskService.create + ConversationExecutor.start), add `task:respond` as a tool that fires a signal via the agent-service HTTP API, add a `depth` column to the tasks table, and update orchestrator prompts with delegation judgment criteria.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Delegation Brief Shape
- `task:delegate` has two required fields only: `targetEntityId: string` + `description: string`
- No structured priority, effort estimate, deadline, or knowledge reference fields -- the agent writes all context into the description as prose
- Agent-first principle: the tool is a thin routing mechanism, the intelligence lives in the agent's brief
- The delegate queries shared memory independently (DEL-10) -- no knowledge entry IDs passed structurally
- Priority, effort estimates, and structured expectations deferred until the system acts on them

#### Target Agent Initial Context
- Delegation brief injected as the initial user message using a `<delegation>` XML block
- Format: `<delegation task_id="task_abc123" from="product-agent" depth="2" max_depth="3">`
- Attributes carry machine-readable fields (task_id, from, depth, max_depth); body is the description string
- Consistent with existing XML patterns (`<task_context>`, `<summary>`)
- Target agent's prompt.md guides: evaluate the delegation, respond via handshake, then work if accepted

#### Delegate Return Behavior
- `task:delegate` returns immediately with task ID -- does NOT block for handshake
- Delegator calls `wait_for` (type: "task_handshake", taskId) to pause and await the response
- Async flow: delegate -> wait -> resume on handshake signal (accept/reject)
- 30s handshake timeout is a wait_for timeout via pg-boss (DEL-08), not a tool execution timeout
- Race condition handled: signals delivered to non-waiting conversations are queued, worker loop auto-resumes on match

#### Handshake Behavior
- `task:respond` tool schema: `taskId: string` (required), `response: "accept" | "reject"` (required), `estimate: string` (optional, with accept), `reason: string` (optional, with reject)
- Estimate is free-text ("~15 minutes", "should be quick") -- no structured duration field
- In Phase 70, estimate is informational for delegator context only; Phase 71 delegator uses it for timeout judgment
- Separate estimate/reason fields: estimate informs timeout planning, reason informs fallback routing
- Signal payload is self-contained: `{ taskId, response, estimate|reason, respondedBy }`
- No framework enforcement of handshake-before-work -- prompt-guided only (agent-first principle)
- 30s timeout without handshake = treated as rejection, delegator pivots

#### Rejection and Pivot Flow
- Agent judgment drives pivot strategy based on rejection reason
- Common path: try next candidate from existing `directory:find` results (no re-query)
- Rare path: rejection reveals wrong query ("you need a DBA, not a backend dev") -> re-query with refined terms
- Prompt guidance: "If rejected, consider the reason. Try next candidate from existing results. If the rejection suggests you need a different capability, re-query. If all candidates exhausted, report failure to your delegator."

#### Depth Enforcement
- `depth` integer column on tasks table: root task = 0, delegated task = parent.depth + 1
- MAX_DELEGATION_DEPTH = 3 (depth 0, 1, 2 active -- two delegation hops max)
- Enforced in `task:delegate` tool before task creation -- agent gets immediate error: "Delegation depth limit reached (3). Handle this work directly."
- Depth and max_depth included in `<delegation>` block attributes as context (not enforcement)
- Target agent at max depth: (1) attempt work yourself if remotely capable, (2) fail task with specific capability reason, (3) store context in shared knowledge before failing
- Depth limits push problem-solving up the tree -- parent at depth 1 has full delegation capability

#### Prompt Judgment Criteria
- Guidance lives in each agent's prompt.md with role-specific examples (not framework-injected)
- **Spawn vs Delegate heuristic:** sub-agent spawn = "my job, need a specialist tool" (coder, researcher, tester); delegation = "someone else's job" (different agent capabilities)
- Simplest signal: if it's in your subAgents list, spawn. If you need directory:find, delegate.
- **When NOT to delegate:** work is within your capabilities (even if imperfect), task is small relative to delegation overhead, you already have the context from research
- **When to delegate:** genuine capability gap, distinct unit with clear deliverable, work justifies independent budget and tracking ("would you create a separate ticket for this?")
- **Anti-pattern:** management-layer agent that delegates everything and produces nothing. Delegation is for capability gaps, not preference.
- Universal principles duplicated across 2-3 orchestrators with agent-specific criteria (e.g., dev-agent: "don't delegate code writing", product-agent: "never delegate user conversation")

### Claude's Discretion
- Schema extensions on tasks table beyond depth (e.g., delegation_metadata JSONB vs separate columns)
- Exact `<delegation>` block content beyond specified attributes
- Error message wording for depth limit rejection
- Whether `task:delegate` also takes an optional `parentTaskId` explicitly or infers it from the current task context

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| drizzle-orm | Existing | Database schema, queries, migrations | Already used across the project |
| zod | Existing | Input validation for new tool schemas | Every tool uses Zod for schema validation |
| pg-boss | Existing | 30s handshake timeout via delayed signal | Already wired into TimeoutScheduler |
| express | Existing | HTTP routes for signal delivery | main.ts already running |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| nanoid | Existing | ID generation for tasks/handoffs | `createId.task()` already uses this |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| HTTP POST for handshake signal | Direct DB signal via executor.signal() | HTTP is cleaner for cross-conversation signaling since the target agent's conversation doesn't have direct executor access. But executor.signal() is the established pattern. Signal should go through executor.signal() invoked from tool code that has access to the executor (via the agent-service /events endpoint or direct service reference). |

**Installation:**
No new packages needed. All dependencies already present.

## Architecture Patterns

### Recommended Project Structure
```
packages/agents/src/
  shared/
    tools/
      task/
        delegate-task.ts       # task:delegate tool factory (NEW)
        respond-task.ts        # task:respond tool factory (NEW)
        types.ts               # Add MAX_DELEGATION_DEPTH constant, update existing
        index.ts               # Add exports for new tools
    services/
      task-service.ts          # Add depth-aware query methods
    db/
      schema.ts                # Add depth column to tasks table
      migrations/
        0009_add_task_depth.sql # Migration for depth column + delegation_metadata
  framework/
    tool-factories.ts          # Register task:delegate and task:respond
definitions/
  dev-agent/
    definition.yaml            # Add task:delegate, task:respond tools
    prompt.md                  # Add delegation judgment section
  product-agent/
    definition.yaml            # Add task:delegate, task:respond tools
    prompt.md                  # Add delegation judgment section
```

### Pattern 1: task:delegate Tool (Orchestrates Existing Services)
**What:** A tool that combines DirectoryService.get + TaskService.create + executor.start() into one atomic operation from the agent's perspective.
**When to use:** When delegating work to another agent discovered via directory:find.

**Key implementation details from codebase analysis:**

The tool needs access to: DirectoryService (to verify target entity), TaskService (to create the task), and a way to start a conversation for the target agent. The challenge is that tools don't have direct access to the ConversationExecutor.

**Solution: HTTP POST to the agent-service.** The target agent's conversation is started via an HTTP POST to the agent-service's internal API (similar to how router tools call `start_conversation`). Alternatively, the tool can receive the executor as a dependency injected via a new DelegationDeps field on ToolContext, following the same pattern as SpawnAgentDeps.

**Recommended approach:** Inject delegation dependencies via ToolContext, following SpawnAgentDeps precedent:

```typescript
export interface DelegationDeps {
  executor: ConversationExecutor;
  directoryService: DirectoryService;
  taskService: TaskService;
}

// In ToolContext:
delegationDeps?: DelegationDeps | undefined;
```

The worker loop populates `delegationDeps` when the agent definition includes `task:delegate` in its tools, mirroring the pattern used for `spawnDeps` with `coordination:spawn_agent`.

```typescript
// delegate-task.ts (simplified)
const DelegateTaskInputSchema = z.object({
  targetEntityId: z.string().min(1),
  description: z.string().min(1),
  parentTaskId: z.string().optional(), // Discretion: explicit or inferred from ctx.taskId
});

async execute(input): Promise<ToolResult> {
  const deps = ctx.delegationDeps;
  if (!deps) return { content: "Delegation not available.", isError: true };

  // 1. Verify target entity exists and is active
  const entity = await deps.directoryService.get(parsed.targetEntityId);
  if (!entity) return { content: `Entity not found: ${parsed.targetEntityId}`, isError: true };

  // 2. Check depth
  const parentId = parsed.parentTaskId ?? ctx.taskId;
  const parentDepth = parentId ? await getTaskDepth(deps.taskService, parentId) : -1;
  if (parentDepth + 1 >= MAX_DELEGATION_DEPTH) {
    return { content: "Delegation depth limit reached (3). Handle this work directly.", isError: true };
  }

  // 3. Create task
  const task = await deps.taskService.create({
    parentId: parentId ?? undefined,
    creatorType: "agent",
    creatorId: ctx.agentId,
    assigneeType: entity.type,
    assigneeId: entity.id,
    title: parsed.description.slice(0, 100),
    objective: parsed.description,
    metadata: { depth: parentDepth + 1, delegatedBy: ctx.agentId },
  });

  // 4. Build <delegation> block as initial message
  const delegationBlock = buildDelegationBlock({
    taskId: task.id,
    from: ctx.agentId,
    depth: parentDepth + 1,
    maxDepth: MAX_DELEGATION_DEPTH,
    description: parsed.description,
  });

  // 5. Start target conversation via executor
  const conversationId = await deps.executor.start({
    agentDefinitionId: entity.id,
    correlationKey: task.id, // Task ID as correlation key = deterministic conversation ID
    initialMessage: delegationBlock,
    taskId: task.id,
  });

  // 6. Link the new conversation to the task
  await deps.taskService.linkConversation(task.id, conversationId);

  return {
    content: `Delegation sent to ${entity.name} (${entity.id}).\n` +
      `Task: ${task.id}\n` +
      `Conversation: ${conversationId}\n\n` +
      `Call wait_for with type "task_handshake" and metadata { taskId: "${task.id}" } to wait for the response.\n` +
      `The 30s handshake timeout will be applied automatically.`,
  };
}
```

### Pattern 2: task:respond Tool (Fires Signal Back to Delegator)
**What:** A tool the target agent uses to accept or reject a delegation, sending a signal to the delegating conversation.
**When to use:** After receiving a `<delegation>` block and evaluating whether to accept the work.

**Key challenge:** The target agent needs to signal the *delegating agent's conversation*, not its own. This requires knowing the delegator's conversation ID. The task's `parent_id` links back to the parent task, and `executor.findActiveForTask()` already exists to resolve the latest active conversation for a task.

```typescript
const RespondTaskInputSchema = z.object({
  taskId: z.string().min(1),
  response: z.enum(["accept", "reject"]),
  estimate: z.string().optional(), // With accept
  reason: z.string().optional(),   // With reject
});

async execute(input): Promise<ToolResult> {
  // 1. Get the delegated task
  const task = await deps.taskService.get(parsed.taskId);
  if (!task) return { content: `Task not found: ${parsed.taskId}`, isError: true };
  if (!task.parent_id) return { content: "This task has no parent -- nothing to respond to.", isError: true };

  // 2. Find the parent task's active conversation (the delegator)
  const parentConv = await deps.executor.findActiveForTask(task.parent_id);
  if (!parentConv) {
    // Orphan case: delegator conversation is gone. Log but don't fail.
    return { content: "Delegator conversation not found. Your response has been recorded on the task.", isError: false };
  }

  // 3. Build and send signal
  const signal: Signal = {
    type: "task_handshake",
    data: {
      taskId: parsed.taskId,
      response: parsed.response,
      ...(parsed.estimate && { estimate: parsed.estimate }),
      ...(parsed.reason && { reason: parsed.reason }),
      respondedBy: ctx.agentId,
    },
    message: parsed.response === "accept"
      ? `Delegation accepted for task ${parsed.taskId}. ${parsed.estimate ? `Estimate: ${parsed.estimate}` : ""}`
      : `Delegation rejected for task ${parsed.taskId}. Reason: ${parsed.reason ?? "Not specified"}`,
    source: `agent:${ctx.agentId}`,
    deduplicationId: `handshake-${parsed.taskId}`,
  };

  const result = await deps.executor.signal(parentConv.id, signal);

  return {
    content: `Handshake ${parsed.response} sent for task ${parsed.taskId}. Signal: ${result.action}.`,
  };
}
```

### Pattern 3: <delegation> XML Block Construction
**What:** The initial user message for the target agent's conversation, containing the delegation brief in a structured XML block.
**When to use:** In `task:delegate` when building the initial message for `executor.start()`.

```typescript
function buildDelegationBlock(params: {
  taskId: string;
  from: string;
  depth: number;
  maxDepth: number;
  description: string;
}): string {
  return [
    `<delegation task_id="${params.taskId}" from="${params.from}" depth="${params.depth}" max_depth="${params.maxDepth}">`,
    params.description,
    `</delegation>`,
  ].join("\n");
}
```

This follows the established pattern of `<task_context>`, `<world_state>`, `<workspace_context>`, and `<reply_context>` XML blocks used throughout the codebase.

### Pattern 4: Depth Column and Enforcement
**What:** A `depth` integer column on the tasks table, enforced in `task:delegate` before creation.
**When to use:** Every delegated task gets depth = parent.depth + 1.

**Recommendation on Claude's Discretion item (schema extensions):** Use `metadata` JSONB for delegation-specific fields rather than adding dedicated columns. The tasks table already has a `metadata` JSONB column. Store `depth` as a proper column (it's queried and enforced), but put `delegatedBy`, `handshakeResponse`, and any other delegation-specific context in `metadata`. This avoids schema sprawl while keeping the enforced field (depth) queryable.

**Migration:**
```sql
-- 0009_add_task_depth.sql
ALTER TABLE agents.tasks ADD COLUMN depth INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_tasks_depth ON agents.tasks(depth);
```

### Pattern 5: DelegationDeps Injection (Worker Loop)
**What:** The worker loop injects delegation dependencies into ToolContext when the agent has `task:delegate` in its tool list.
**When to use:** In the `executeConversation` function of worker-loop.ts, following the SpawnAgentDeps pattern.

```typescript
// In worker-loop.ts executeConversation():
const hasDelegation = definition.tools.includes("task:delegate");
const toolContext: ToolContext = {
  // ... existing fields ...
  ...(hasDelegation && {
    delegationDeps: {
      executor,       // Need to pass executor reference
      directoryService,
      taskService,
    },
  }),
};
```

**Challenge:** The worker loop doesn't currently have a reference to the ConversationExecutor (only the executor creates the worker loop, not vice versa). This is solved by passing the executor reference via WorkerLoopOptions, the same way timeoutScheduler is passed. Add `executor?: ConversationExecutor` to WorkerLoopOptions.

Actually, looking more carefully, the timeoutScheduler gets its executor reference via `start(executor)` at bootstrap time. For delegationDeps, the cleanest approach is: pass DirectoryService and TaskService through WorkerLoopOptions (like taskService already is), and for the executor reference, use a similar lazy-init pattern or pass it at `start()` time.

**Recommended approach:** Add `directoryService` and `executor` to WorkerLoopOptions. The `executor` reference is set via a late-binding pattern -- the executor is created with the worker loop, then the loop's executor reference is set before `start()`. This is similar to how `timeoutScheduler.start(executor)` works.

### Pattern 6: parentTaskId -- Infer or Explicit
**Claude's Discretion area.** Recommendation: **Infer from ctx.taskId by default, allow optional override.**

Rationale: The delegating agent already has a `ctx.taskId` set (its own task). The delegated task should be a child of that task. Making `parentTaskId` optional with default to `ctx.taskId` is the ergonomic choice -- the common case (delegate from current task) requires no extra argument. The override exists for edge cases where an agent wants to create a delegation under a different parent.

```typescript
const parentId = parsed.parentTaskId ?? ctx.taskId;
```

### Anti-Patterns to Avoid
- **Blocking delegation tool:** `task:delegate` must NOT block waiting for the handshake. The async delegate -> wait_for -> signal pattern composes with existing infrastructure. A blocking tool would hold the agent loop hostage during the 30s timeout.
- **Direct executor imports in tools:** Tools should receive dependencies via ToolContext injection, not import the executor module directly. This maintains testability and the clean separation between tools and framework.
- **Framework-enforced handshake ordering:** The prompt says "evaluate first, respond, then work" -- no executor-level state machine that filters tools before handshake. Agent-first principle.
- **Full message history on handoff:** The `<delegation>` block carries only the task description. The target agent queries shared memory independently. Never serialize the delegator's conversation history.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Signal delivery to delegator | Custom inter-conversation messaging | `executor.signal()` via DelegationDeps | Signal infrastructure already handles queuing, dedup, type matching, timeout cancellation |
| Handshake timeout | Custom timer/polling | `wait_for` with `timeout: "30s"` (requires adding "s" unit to parseTimeoutDuration or using "1m") | pg-boss TimeoutScheduler already handles delayed signal delivery |
| Finding delegator conversation | Walk conversation table manually | `executor.findActiveForTask(parentTaskId)` | Already implemented, handles re-trigger edge case |
| Depth calculation | Walk parent chain every time | `depth` column on tasks table (set at creation) | O(1) lookup vs O(n) chain walk; migration is trivial |
| Entity validation | Query directory table directly | `directoryService.get(entityId)` | Handles inactive status, consistent null semantics |
| Task creation with linking | Multiple separate DB calls | `taskService.create()` + `taskService.linkConversation()` | Existing service methods, Zod validation included |
| Correlation key for conversation | Random ID | `task.id` as correlation key | Deterministic: same delegation -> same conversation ID (idempotent start) |

**Key insight:** Phase 70 is a composition phase, not a new infrastructure phase. Every piece of infrastructure needed already exists. The new tools (`task:delegate`, `task:respond`) are orchestrators of existing services.

## Common Pitfalls

### Pitfall 1: Timeout Duration Format
**What goes wrong:** The existing `parseTimeoutDuration()` supports `m`, `h`, `d` units. The 30-second handshake timeout requires a seconds unit or workaround.
**Why it happens:** The timeout parser was designed for longer waits (hours, days). 30 seconds is a new use case.
**How to avoid:** Either extend `parseTimeoutDuration()` to support `s` (seconds) unit, or use `1m` (60 seconds) as the closest approximation. The 30s value is a guideline, not a hard requirement -- 60s is acceptable. **Recommendation:** Add `s` support to `parseTimeoutDuration()` -- it's a 3-line change and future-proofs for short timeouts.
**Warning signs:** Test that `wait_for` with `timeout: "30s"` works end-to-end.

### Pitfall 2: Signal Type Matching for Handshake
**What goes wrong:** The current `pending_wait.type` is a single string matched exactly against the signal's `type`. The handshake signal type must be `"task_handshake"` to match the `wait_for` call.
**Why it happens:** The delegator calls `wait_for(type: "task_handshake", ...)` and the target sends a signal with `type: "task_handshake"`. This works with the existing single-type matching. However, Phase 71 (Completion Signaling) introduces multi-type `wait_for` -- Phase 70 should not pre-empt that design.
**How to avoid:** Use a single, specific signal type `"task_handshake"` for Phase 70. Do NOT try to make wait_for accept multiple types yet -- that's SIG-02 in Phase 71. The current single-type matching works perfectly for the handshake use case.
**Warning signs:** If you find yourself wanting to listen for both "task_handshake" and "task_completion" simultaneously, stop -- that's Phase 71 scope.

### Pitfall 3: Circular Reference Between Executor and Worker Loop
**What goes wrong:** The worker loop needs an executor reference for `delegationDeps`, but the executor creates the worker loop.
**Why it happens:** Circular dependency between conversation executor and worker loop.
**How to avoid:** Use late binding. The timeout scheduler already solves this: `timeoutScheduler.start(executor)` is called after both are created. For delegation, pass the executor reference through WorkerLoopOptions as an optional field, set it after executor construction but before `startWorker()`. Alternatively, use a factory pattern where DelegationDeps are resolved lazily.
**Warning signs:** Import cycles or undefined references at startup.

### Pitfall 4: Task Depth vs Parent Chain Walk
**What goes wrong:** Without a `depth` column, calculating depth requires walking the parent chain via multiple DB queries. With moderate chains, this is slow and fragile if a parent is deleted.
**Why it happens:** The current `checkDepth()` in create-task.ts already walks the chain -- it works but is O(n).
**How to avoid:** Add the `depth` column and set it at task creation time: `depth = parent.depth + 1`. The enforcement check becomes a single DB read of the parent task's depth. **Note:** The existing `MAX_TASK_DEPTH = 5` in task types.ts needs to coexist with `MAX_DELEGATION_DEPTH = 3`. These are separate limits: MAX_TASK_DEPTH is the total task nesting depth (any subtask), MAX_DELEGATION_DEPTH is specifically for delegation chains. Recommendation: rename MAX_TASK_DEPTH to be clearer or document the distinction.
**Warning signs:** Confusion between "task depth" (any subtask) and "delegation depth" (cross-agent delegation only).

### Pitfall 5: findActiveForTask Returns Wrong Conversation
**What goes wrong:** The delegator's conversation may have completed/failed between the delegation and the handshake response. `findActiveForTask()` returns null.
**Why it happens:** 30-second timeout is short, but the delegator could time out via the existing wait_for timeout before the target responds.
**How to avoid:** In `task:respond`, handle the null case gracefully -- record the handshake on the task's metadata for observability, return a message to the target agent. The work is not lost; Phase 71 (Completion Signaling) adds orphan handling. For Phase 70, a missing delegator conversation means the response is "best effort" -- the target agent should still proceed if they accepted.
**Warning signs:** `task:respond` returning errors that confuse the target agent. Use non-error messaging for the orphan case.

### Pitfall 6: Race Between delegate and wait_for
**What goes wrong:** The target agent responds before the delegator calls `wait_for`. The signal arrives at a non-waiting conversation.
**Why it happens:** `task:delegate` returns immediately, and the delegator must make a separate `wait_for` call. Between those calls, the target agent could start and respond.
**How to avoid:** This is already handled by the existing signal infrastructure. From `conversation-executor.ts` line 455: if the conversation status is `"running"` or `"queued"`, the signal is queued (not rejected). The worker loop checks `queued_signals` when entering the wait state (worker-loop.ts lines 802-845 and 1030-1098). If a matching signal was queued during execution, it's consumed and the conversation re-enqueues instead of pausing. **This race condition is fully handled by existing infrastructure.**
**Warning signs:** None expected -- this is a known-safe pattern. Test to confirm.

### Pitfall 7: Updating Existing MAX_TASK_DEPTH
**What goes wrong:** The existing `MAX_TASK_DEPTH = 5` in `types.ts` applies to all task nesting. `MAX_DELEGATION_DEPTH = 3` is a separate, stricter limit for delegation chains. If we reuse MAX_TASK_DEPTH for delegation, we violate the DEL-07 requirement.
**Why it happens:** Conceptual overlap between "task depth" (any parent-child relationship) and "delegation depth" (cross-agent handoff).
**How to avoid:** Keep both constants. `MAX_TASK_DEPTH = 5` remains the upper bound for any task nesting. `MAX_DELEGATION_DEPTH = 3` is enforced specifically in `task:delegate`. Add the `depth` column to tasks to track delegation depth separately from structural nesting depth.
**Warning signs:** Tests that pass with depth 4 subtasks but fail because someone assumed delegation depth was the same as task depth.

## Code Examples

### Example 1: Database Migration for Depth Column
```sql
-- 0009_add_task_depth.sql
-- Phase 70: Task Delegation - Add depth tracking for delegation chains

ALTER TABLE agents.tasks
  ADD COLUMN depth INTEGER NOT NULL DEFAULT 0;

--> statement-breakpoint

CREATE INDEX idx_tasks_depth ON agents.tasks(depth);
```

### Example 2: Updated Tasks Schema (schema.ts)
```typescript
// Add to tasks table definition:
depth: integer("depth").notNull().default(0),
```

### Example 3: Delegation Block Builder
```typescript
function buildDelegationBlock(params: {
  taskId: string;
  from: string;
  depth: number;
  maxDepth: number;
  description: string;
}): string {
  return [
    `<delegation task_id="${params.taskId}" from="${params.from}" depth="${params.depth}" max_depth="${params.maxDepth}">`,
    params.description,
    "</delegation>",
  ].join("\n");
}
```

### Example 4: Tool Registration Pattern
```typescript
// In tool-factories.ts registerAllTools():
const ds = options.directoryService;
const ts = options.taskService;

registry.register("task:delegate", (ctx) =>
  createDelegateTaskTool(ts, ds, ctx),
);
registry.register("task:respond", (ctx) =>
  createRespondTaskTool(ts, ctx),
);
```

Note: `task:delegate` needs additional dependencies (executor, directoryService) beyond TaskService. These come through `ctx.delegationDeps`. The tool-factories.ts registration only needs TaskService and DirectoryService for validation; the executor comes from ToolContext at resolve time.

### Example 5: Seconds Support in TimeoutScheduler
```typescript
// In timeout-scheduler.ts parseTimeoutDuration():
// Add case for seconds:
case "s":
  return value * 1000;
```

### Example 6: wait_for Call Pattern for Delegation
```
// What the delegating agent's tool calls look like:
1. directory:find("implement code changes") -> [{ id: "dev-agent", ... }]
2. task:delegate({ targetEntityId: "dev-agent", description: "Implement feature X..." })
   -> returns task ID
3. wait_for({ type: "task_handshake", timeout: "30s", reason: "Waiting for dev-agent handshake", metadata: { taskId: "task_abc" } })
   -> pauses conversation
4. [Signal arrives: { type: "task_handshake", data: { response: "accept", estimate: "~10 min" } }]
5. Agent resumes, sees acceptance, continues work
```

### Example 7: Prompt Pattern for Delegation Judgment (dev-agent)
```markdown
## Task Delegation

You can delegate work to other agents when a task requires capabilities you don't have.

**Spawn vs Delegate:**
- **Spawn** (researcher, coder, tester): Work that's part of YOUR job but needs a specialist tool. Sub-agents share your budget and sandbox. Use when the task is in your subAgents list.
- **Delegate** (via directory:find + task:delegate): Work that belongs to a DIFFERENT agent's capability set. Creates a new conversation with its own budget. Use when you need to discover who can help.

**When to delegate:**
- Genuine capability gap -- the work requires tools or expertise you don't have
- Distinct unit of work with a clear deliverable
- The work justifies a separate conversation and budget ("would you create a separate ticket for this?")

**When NOT to delegate:**
- The work is within your capabilities, even if imperfect
- The task is small relative to the overhead of delegation (handshake, new conversation, signal routing)
- You already have the context from research -- delegating forces context re-discovery

**Don't delegate code writing.** You have a coder sub-agent for implementation. Delegation is for when the work doesn't belong in your domain at all.

**Handling rejection:**
If a delegation is rejected, consider the reason. Try the next candidate from your existing directory:find results. If the rejection suggests you need a different capability ("you need a DBA, not a backend dev"), re-query the directory. If all candidates are exhausted, report failure.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Product-agent creates Linear ticket, human assigns dev-agent | Agent discovers collaborator via directory, delegates directly | Phase 70 (this phase) | Removes human intervention from agent-to-agent handoffs |
| Sub-agent spawn (same conversation, shared budget) | Sub-agent spawn + cross-conversation delegation | Phase 70 (this phase) | Two collaboration mechanisms for different granularity |
| Single wait_for type matching | Still single type for Phase 70 | Phase 71 adds multi-type | Phase 70 uses "task_handshake" signal type, Phase 71 generalizes |

## Open Questions

1. **How does task:respond find the executor to send signals?**
   - What we know: The tool needs to call `executor.signal()` on the delegator's conversation. It can access the executor through `DelegationDeps` on ToolContext.
   - What's unclear: Should `task:respond` use the same DelegationDeps, or should there be a lighter-weight SignalDeps? The target agent may not have `task:delegate` in its tools but does need `task:respond`.
   - Recommendation: Create a shared `DelegationDeps` that both tools use. Both `task:delegate` and `task:respond` are always added together to agent definitions. The deps include executor, directoryService, and taskService.

2. **Should delegated tasks start in "created" or "active" status?**
   - What we know: Regular tasks are created with `status: "active"`. Delegated tasks go through a handshake that could result in rejection.
   - What's unclear: Should the task be "created" until accepted, then "active"? Or "active" immediately?
   - Recommendation: Start as "created" (pending handshake). On accept, the target agent transitions to "active" before starting work. On reject or timeout, the delegator cancels it. This gives clearer task lifecycle semantics: created = awaiting handshake, active = work in progress.

3. **How to handle the 30s timeout as seconds in wait_for?**
   - What we know: `parseTimeoutDuration()` currently supports m, h, d. The handshake needs ~30s.
   - What's unclear: Should we add "s" support or just use "1m"?
   - Recommendation: Add "s" support -- it's trivial (3 lines) and provides accurate timeout. Using "1m" doubles the wait, which is acceptable but unnecessarily imprecise.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `packages/agents/src/framework/conversation-executor.ts` -- executor.start() API, signal() API, findActiveForTask()
- Codebase analysis: `packages/agents/src/framework/worker-loop.ts` -- queued signal handling (lines 802-845, 1030-1098), SpawnAgentDeps injection pattern
- Codebase analysis: `packages/agents/src/framework/types.ts` -- ToolContext, WaitForState, StartConversationParams, Signal schema
- Codebase analysis: `packages/agents/src/shared/tools/task/*.ts` -- existing task tool patterns, MAX_TASK_DEPTH, TaskToolDeps
- Codebase analysis: `packages/agents/src/shared/services/task-service.ts` -- TaskService interface, create/get/update/linkConversation
- Codebase analysis: `packages/agents/src/shared/services/directory-service.ts` -- DirectoryService.get(), find()
- Codebase analysis: `packages/agents/src/framework/tool-factories.ts` -- tool registration patterns, adapter patterns
- Codebase analysis: `packages/agents/src/framework/timeout-scheduler.ts` -- parseTimeoutDuration(), pg-boss timeout scheduling
- Codebase analysis: `packages/agents/src/shared/tools/coordination/spawn-agent.ts` -- SpawnAgentDeps injection pattern (the model for DelegationDeps)
- Codebase analysis: `packages/agents/src/shared/db/schema.ts` -- tasks table schema, conversations table schema
- Codebase analysis: `packages/agents/src/shared/db/migrations/0005_add_task_tables.sql` -- migration pattern for ALTER TABLE
- Codebase analysis: `packages/agents/definitions/dev-agent/definition.yaml` -- current tools list, capabilities, subAgents
- Codebase analysis: `packages/agents/definitions/dev-agent/prompt.md` -- XML block patterns (`<task_context>`, `<reply_context>`)
- Phase context: `.planning/phases/70-task-delegation/70-CONTEXT.md` -- locked decisions
- Spec: `.planning/specs/2.7-agent-collaboration.md` -- Phase 73 (spec phase numbering) requirements and design questions

### Secondary (MEDIUM confidence)
- Requirements: `.planning/REQUIREMENTS.md` -- DEL-01 through DEL-07

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new dependencies, all existing infrastructure
- Architecture: HIGH - Patterns directly modeled on existing SpawnAgentDeps, tool factory, and signal infrastructure
- Pitfalls: HIGH - Race conditions verified against actual worker-loop.ts code
- Schema: HIGH - Migration pattern verified against existing 0005, 0008 migrations

**Research date:** 2026-02-10
**Valid until:** 2026-03-10 (stable -- internal architecture, no external dependencies)
