# Phase 71: Completion Signaling - Research

**Researched:** 2026-02-10
**Domain:** Signal dispatch, multi-type wait, delegation lifecycle, PostgreSQL schema evolution
**Confidence:** HIGH

## Summary

This phase closes the delegation loop by ensuring delegating agents are reliably notified when delegated work completes or fails. The codebase already has a mature signal infrastructure (`wait_for` tool, `executor.signal()`, `pending_wait` JSONB, `queued_signals` array, `TimeoutScheduler` via pg-boss) and a complete task service (`TaskService.update()`, `transitionWithHandoff()`). The work is primarily **wiring these together** with four new pieces: (1) multi-type `wait_for` and a `wait_for_task` convenience tool, (2) a `TaskSignalDispatcher` that fires signals on terminal task transitions, (3) orphan-safe `completion_result` storage and `signal.orphaned` event logging, and (4) `active_delegations` context that survives history compaction.

All changes are within `packages/agents/` -- no integration package changes. The key technical risks are the signal matching upgrade (single-type to array membership) which touches both the executor and worker loop, and the `TaskService.update()` hook which must dispatch signals without breaking existing callers. Both are well-scoped because the existing codebase follows consistent patterns.

**Primary recommendation:** Implement in 4 plans: (1) multi-type wait_for + wait_for_task tool, (2) TaskSignalDispatcher + callback routing, (3) orphan handling + completion_result + signal.orphaned, (4) active_delegations + delegation context preservation.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Signal Delivery Semantics:**
- Queue via existing `queued_signals` on conversation row, no interruption of running loops
- Three scenarios all handled by queue-then-match: (1) target finishes before delegator calls wait_for -- signal queued, wait_for finds it immediately; (2) target finishes during wait_for -- signal delivered, conversation resumes; (3) target finishes during other work -- signal queued, delivered when delegator next pauses
- At-most-once delivery: write completion_result to task row (the commit point), then attempt signal delivery. If delivery fails, task row is the durable safety net
- No retry infrastructure for signal delivery. Recovery path: delegator's timeout fires -> delegator checks task state -> finds the result
- Existing `deduplicationId` on signals remains defensive, not mandatory

**Signal Dispatch Trigger:**
- TaskSignalDispatcher fires from the task service layer, not individual tools or database triggers
- TaskService.update() is the single funnel for all task state changes -- detect terminal transitions there
- Only dispatch for delegated tasks (those with parent_id / callback target). Root tasks completing don't signal anyone
- All code paths that can terminate a task (complete_task, handoff_task, conversation failure, timeout) go through TaskService -- no missed dispatch

**Multi-type wait_for API:**
- Backward-compatible: accept both `string` and `string[]` for the `type` field
- Normalize to array at the tool input boundary: `types = Array.isArray(input.type) ? input.type : [input.type]`
- Internal representation always array. `pending_wait.types` column stores array in DB
- Signal matching checks membership in the types array
- Existing single-type callers (handshake, approval, user_reply) continue working unchanged

**wait_for_task Tool:**
- Separate tool from wait_for, not a mode/flag. Distinct input semantics (taskId vs signal types)
- Input: `taskId` (required) + `timeout` (optional)
- Auto-registers for `["task_completion", "task_failure", "task_timeout"]` with taskId-scoped matching
- Signal matching filters by `signal.data.taskId` in addition to type -- agent waiting on task A doesn't wake for task B
- Safety by design: no exposed types parameter means agents cannot forget failure/timeout signals

**Signal Type Taxonomy:**
- `task_handshake` -- accept/reject (exists from Phase 70)
- `task_completion` -- task finished successfully
- `task_failure` -- task failed (agent error, conversation died)
- `task_timeout` -- task exceeded expected duration
- task_timeout is distinct from task_failure -- the task is still running, only the patience expired

**Timeout Behavior:**
- Agent sets the timeout, not infrastructure. The handshake estimate is context for agent judgment, not automatic input to a timer
- Flow: delegator sees estimate in handshake signal -> reasons about appropriate patience -> calls wait_for_task with explicit timeout
- Infrastructure honors the timeout string exactly as today (pg-boss delayed signal via TimeoutScheduler)
- Timeout signal is notification only -- never auto-cancels the delegated task. Delegator decides: keep waiting (new wait_for_task), cancel, or escalate
- Target agent continues working unaware of the delegator's timeout

**Orphan Handling:**
- Store + log only. No re-trigger of terminal parent conversations
- completion_result JSONB written to task row regardless of callback conversation state -- work product never lost
- `signal.orphaned` event logged in agent_events for audit trail and dashboard surfacing
- No retry infrastructure for orphaned signals. Task row is the durable record; human or future conversation can query it

**completion_result Shape:**
- JSONB column on tasks table, written once at dispatch time
- Includes signal payload + light delivery metadata:
  ```json
  {
    "signalType": "task_completion",
    "payload": { ... },
    "writtenAt": "2026-02-10T15:30:00Z",
    "deliveryStatus": "delivered | orphaned | failed",
    "targetConversationId": "conv_abc123"
  }
  ```
- No retention policy -- lives with the task row

**Signal Payload Shape (self-contained):**
- Common fields: `taskId`, `originalDescription` (from task row), `entityId`
- Per signal type: task_completion has `summary`, `artifacts`; task_failure has `reason`, `partialResults`; task_timeout has `estimate`, `elapsedMs`
- Self-containment test: agent with fully compacted history, seeing only active_delegations + signal payload, can reason about next steps

**Delegation Context on Resume:**
- `active_delegations` JSONB column on conversations -- tracks currently pending delegations only, not historical log
- Entry added on `task:delegate`, removed when agent processes the completion/failure/timeout signal
- Entry shape: `{ taskId, targetEntityId, description, delegatedAt, handshakeStatus, estimate }`
- Context injected as part of the wait_for/wait_for_task tool result, not as a system message
- Tool result format: `<active_delegations>` block + signal payload -- agent reads top-down for full orientation
- Non-delegation signals (user_reply, etc.) also include active_delegations block so agent knows what's in flight regardless of wake reason
- Removal happens after agent processes the signal, not at delivery time

### Claude's Discretion
- Exact TaskSignalDispatcher class/module structure
- SQL migration column details for pending_wait.types and active_delegations
- How the wait_for tool result is formatted (XML vs plain text for delegation context block)
- Error handling details in signal dispatch (logging, event recording)
- Exact Zod schema for backward-compatible type field (union vs transform)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| drizzle-orm | Existing | Database queries, schema, migrations | Already used throughout project |
| zod | Existing | Input validation, schema definitions | Already used throughout project |
| pg-boss | Existing (v10+) | Delayed signal delivery for timeouts | Already wired in TimeoutScheduler |
| vitest | Existing | Unit testing | Already used throughout project |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| nanoid | Existing | ID generation | Already used for IDs throughout |

No new dependencies required. This phase is entirely internal wiring.

## Architecture Patterns

### Recommended File Structure
```
packages/agents/src/
  framework/
    wait-for-tool.ts           # MODIFY: multi-type support, types array
    wait-for-task-tool.ts      # NEW: wait_for_task tool (separate file)
    types.ts                   # MODIFY: WaitForState.waitTypes array
    conversation-executor.ts   # MODIFY: signal matching uses types array
    worker-loop.ts             # MODIFY: signal matching uses types array,
                               #         active_delegations injection on resume
    tool-factories.ts          # MODIFY: register wait_for_task tool
  shared/
    services/
      task-service.ts          # MODIFY: dispatcher hook in update()
      task-signal-dispatcher.ts # NEW: signal dispatch on task terminal states
    tools/task/
      delegate-task.ts         # MODIFY: write active_delegations entry
    db/
      schema.ts                # MODIFY: completion_result column, active_delegations column
      schema.drizzle.ts        # MODIFY: mirror schema changes
      migrations/
        0010_completion_signaling.sql # NEW: schema migration
```

### Pattern 1: TaskSignalDispatcher as Observer on TaskService

**What:** Rather than adding dispatch logic inside each tool that can complete a task, hook into `TaskService.update()` as the single funnel point.

**When to use:** When a task reaches terminal state (completed/failed/cancelled) and has a `parent_id`.

**Recommended approach:**

```typescript
// task-signal-dispatcher.ts
export interface TaskSignalDispatcher {
  onTaskUpdate(taskId: string, oldStatus: string, newStatus: string): Promise<void>;
}

export function createTaskSignalDispatcher(deps: {
  taskService: TaskService;
  executor: ConversationExecutor;
  eventLog: EventLog;
  logger: PinoLogger;
}): TaskSignalDispatcher {
  return {
    async onTaskUpdate(taskId, oldStatus, newStatus) {
      // Only act on terminal transitions
      if (!['completed', 'failed', 'cancelled'].includes(newStatus)) return;
      // Only for delegated tasks (have parent_id)
      const task = await deps.taskService.get(taskId);
      if (!task?.parent_id) return;
      // Build signal, resolve callback, attempt delivery, handle orphans
    }
  };
}
```

**Key design decision:** The dispatcher is injected into TaskService as an optional callback, not tightly coupled. TaskService calls `dispatcher.onTaskUpdate()` after persisting the state change. This preserves TaskService's current clean shape while enabling the dispatch side-effect.

**Source:** Codebase pattern -- follows existing dependency injection pattern from `ConversationExecutorOptions`, `WorkerLoopOptions`.

### Pattern 2: Multi-type Signal Matching (Array Membership)

**What:** Upgrade `pending_wait` from storing a single `type` string to a `types` string array. Signal matching changes from `===` to `includes()`.

**Current code (conversation-executor.ts line 380):**
```typescript
if (pendingWait?.type && pendingWait.type !== signal.type) {
  // reject
}
```

**Target code:**
```typescript
const types = (pendingWait?.types ?? []) as string[];
if (types.length > 0 && !types.includes(signal.type)) {
  // reject
}
```

**Backward compatibility:** The migration writes `pending_wait.types` array, but existing waiting conversations may still have `pending_wait.type` (singular). Signal matching should handle both:
```typescript
const types = pendingWait?.types
  ? (pendingWait.types as string[])
  : pendingWait?.type
    ? [pendingWait.type as string]
    : [];
```

**Source:** Direct analysis of `conversation-executor.ts` lines 374-389, `worker-loop.ts` lines 825-868.

### Pattern 3: wait_for_task with TaskId-Scoped Matching

**What:** The `wait_for_task` tool auto-registers for `["task_completion", "task_failure", "task_timeout"]` and stores the taskId in pending_wait metadata for scoped matching.

**Design:**
```typescript
// pending_wait stored in DB:
{
  types: ["task_completion", "task_failure", "task_timeout"],
  reason: "Waiting for delegated task task_xyz",
  timeout: "2h",
  metadata: { taskId: "task_xyz" }
}
```

**Signal matching enhancement:** When `pending_wait.metadata.taskId` exists, also check `signal.data.taskId === pending_wait.metadata.taskId`. This prevents agent waiting on task A from waking for task B's completion.

**Source:** CONTEXT.md decision on wait_for_task scoped matching.

### Pattern 4: Callback Routing Through Tasks

**What:** When dispatching a completion signal, resolve the callback conversation through the task tree, not static conversation IDs.

**Flow:**
1. Task reaches terminal state, has `parent_id`
2. Find the parent task
3. Call `executor.findActiveForTask(parentTaskId)` -- returns latest active conversation (running/waiting/queued)
4. If active conversation found: `executor.signal(conversationId, signal)`
5. If no active conversation: orphan path (store completion_result, log signal.orphaned)

**Why this survives re-triggers:** `findActiveForTask` already exists on the executor (added in Phase 70) and queries conversations by task_id with active status filter, ordered by created_at DESC. If a conversation is re-triggered (e.g., `dev-agent-task_123-r2`), the new conversation inherits the task_id, so `findActiveForTask` finds it.

**Source:** `conversation-executor.ts` lines 727-749, `findActiveForTask()`.

### Pattern 5: active_delegations JSONB Lifecycle

**What:** Track currently pending delegations on the conversation row so context survives history compaction.

**Lifecycle:**
1. **Add entry** on `task:delegate` success: write `{ taskId, targetEntityId, description, delegatedAt, handshakeStatus: "pending" }` to `active_delegations` JSONB array
2. **Update entry** on `task_handshake` signal: update `handshakeStatus` to `accepted`/`rejected`, add `estimate` if provided
3. **Remove entry** when agent processes a terminal signal (task_completion, task_failure, task_timeout) -- NOT at delivery time
4. **Inject context** on resume: when a conversation resumes from waiting, the worker loop reads `active_delegations` and prepends it to the signal message as an `<active_delegations>` block

**Storage location:** New column on `agents.conversations` table -- JSONB array, default `[]`.

**Compaction safety:** History manager compacts `messages` JSONB. `active_delegations` is a separate column, never touched by compaction.

### Anti-Patterns to Avoid

- **Adding dispatch logic in individual tools:** The `complete_task` tool should NOT call `executor.signal()` directly. All dispatch goes through `TaskSignalDispatcher` triggered from `TaskService.update()`. This prevents missed dispatch paths when tasks are terminated by conversation failure or timeout.

- **Parsing handshake estimates into durations:** The estimate is free-text ("~15 minutes", "2 tool calls"). The agent sets the `wait_for_task` timeout based on judgment. No `parseEstimate()` function.

- **Storing full message history in completion_result:** The signal payload is self-contained but lightweight. No conversation replay -- just task description, summary, and artifacts.

- **Modifying pending_wait column type from JSONB:** Keep it as JSONB. The change is within the JSON shape (`.type` string becomes `.types` string[]). No column type migration needed.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Delayed signal delivery | Custom timer/cron | pg-boss (TimeoutScheduler) | Already integrated, handles crashes, job deduplication |
| Event logging | Raw SQL inserts | EventLog.append() + flush() | Buffered, sequence-gapped, with subscriber notifications |
| ID generation | uuid or random | createId.task(), createId.handoff() | Consistent prefix-based IDs throughout codebase |
| Schema validation | Manual checks | Zod schemas | Already used for all external boundaries |
| Task state transitions | Inline status checks | VALID_TRANSITIONS map | Already defined in task/types.ts |

**Key insight:** The existing infrastructure handles 90% of the mechanics. This phase is wiring, not building. The `wait_for` tool, `executor.signal()`, `TimeoutScheduler`, `TaskService`, and `EventLog` are all mature -- they need to be connected, not rebuilt.

## Common Pitfalls

### Pitfall 1: Breaking Existing Single-Type Callers
**What goes wrong:** Changing `pending_wait.type` to `pending_wait.types` breaks all existing code that sets or reads the old field.
**Why it happens:** Multiple locations read/write `pending_wait`: conversation-executor signal matching, worker-loop queued signal matching, wait_for tool output, tests.
**How to avoid:** The migration is purely within JSONB shape -- no column rename. Write `types` (array) going forward, but signal matching code handles both `types` and `type` (singular) with a normalization helper. Do NOT modify existing waiting conversations in the migration -- they'll be handled by the backward-compat code. Run existing tests after the change to verify.
**Warning signs:** `wait_for_tool.test.ts`, `conversation-executor.test.ts`, `worker-loop.test.ts` failures.

### Pitfall 2: Signal Race Between Task Update and Dispatch
**What goes wrong:** TaskService.update() persists the task status change, then TaskSignalDispatcher fires. If the process crashes between these two steps, the task is terminal but no signal was sent.
**Why it happens:** Two operations (task update + signal dispatch) are not atomic.
**How to avoid:** This is acceptable by design (CONTEXT.md: "at-most-once delivery"). The `completion_result` is written to the task row as part of the update transaction. The signal dispatch is best-effort after the commit. The delegator's timeout will fire and the agent can check task state.
**Warning signs:** None -- this is the expected behavior, not a bug.

### Pitfall 3: wait_for_task TaskId Scoping Not Applied in Worker Loop
**What goes wrong:** Worker loop's queued signal matching (lines 825-868) checks `sig.type === pendingWait.type` but doesn't check `sig.data.taskId`. Agent waiting on task A wakes for task B's completion.
**Why it happens:** The worker loop has its own signal matching code separate from executor.signal(). Both need the taskId scope check.
**How to avoid:** Extract signal matching into a shared helper function used by both conversation-executor.ts and worker-loop.ts. Both currently have inline matching logic that will need the same `metadata.taskId` check.
**Warning signs:** Test: create two delegation tasks, complete one, verify only the correct waiting conversation wakes.

### Pitfall 4: signal.orphaned Event Type Not in agentEventTypeValues
**What goes wrong:** EventLog rejects `signal.orphaned` events because the type enum doesn't include it.
**Why it happens:** `agentEventTypeValues` in schema.ts is a const array that needs to be extended. The Drizzle schema uses `text("type", { enum: agentEventTypeValues })`.
**How to avoid:** Add `"signal.orphaned"` to `agentEventTypeValues` in both `schema.ts` and `schema.drizzle.ts`. Add it to the database via migration (`ALTER TABLE ... ADD CHECK ...` or handle via the existing text column which in practice doesn't have a DB-level CHECK constraint since Drizzle text enums are TypeScript-only).
**Warning signs:** Verify by checking if the DB has an actual CHECK constraint on the type column -- if not (which is typical for Drizzle text enums), the change is TypeScript-only. If there IS a CHECK, the migration must `ALTER` it.

### Pitfall 5: active_delegations Removal Timing
**What goes wrong:** Removing the delegation entry from `active_delegations` at signal delivery time means the agent wakes up with no context about what just completed.
**Why it happens:** Temptation to clean up state eagerly.
**How to avoid:** Per CONTEXT.md: removal happens after the agent processes the signal, not at delivery time. This means the worker loop (on resume from wait_for_task) reads active_delegations, formats them into the signal message, and removes the entry after the agent loop completes.
**Warning signs:** Agent resumes and says "I don't have any pending delegations" when it should know about the one that just completed.

### Pitfall 6: Dispatcher Needs ConversationExecutor But TaskService is Created First
**What goes wrong:** TaskSignalDispatcher needs `executor.signal()` and `executor.findActiveForTask()`. But the executor is created with TaskService as a dependency. Circular dependency.
**Why it happens:** The executor depends on TaskService (for task context injection in worker loop), and the dispatcher depends on the executor.
**How to avoid:** Late-bind the dispatcher to the executor, same pattern used for `options.executor` in the worker loop. Create TaskService first, create executor second, then wire `dispatcher.setExecutor(executor)`. Or inject the dispatcher into TaskService after both are constructed. The existing codebase already handles this pattern -- `loopOpts.executor = executor` in conversation-executor.ts line 131.
**Warning signs:** Undefined executor at dispatch time.

## Code Examples

### Example 1: Backward-Compatible wait_for Type Schema

```typescript
// Zod schema that accepts both string and string[]
const WaitForInputSchema = z.object({
  type: z
    .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
    .describe(
      "What to wait for. Single type string or array of types. " +
      "Signal matching checks membership in the array."
    ),
  reason: z.string().min(1).describe("Why you are pausing."),
  timeout: z.string().optional().describe("Max time to wait."),
  metadata: z.record(z.unknown()).optional(),
});

// Normalize at boundary
const types = Array.isArray(parsed.type) ? parsed.type : [parsed.type];
```

**Source:** CONTEXT.md: "Normalize to array at the tool input boundary"

### Example 2: Signal Matching Helper (Shared)

```typescript
/**
 * Check if a signal matches a pending wait.
 * Handles both old-format (type string) and new-format (types array).
 * When metadata.taskId is set, also checks signal.data.taskId.
 */
export function signalMatchesPendingWait(
  signal: { type: string; data?: Record<string, unknown> },
  pendingWait: Record<string, unknown> | null,
): boolean {
  if (!pendingWait) return false;

  // Normalize types
  const types = pendingWait.types
    ? (pendingWait.types as string[])
    : pendingWait.type
      ? [pendingWait.type as string]
      : [];

  if (types.length === 0) return false;
  if (!types.includes(signal.type)) return false;

  // TaskId-scoped matching
  const waitTaskId = (pendingWait.metadata as Record<string, unknown> | undefined)?.taskId;
  if (waitTaskId && signal.data?.taskId !== waitTaskId) return false;

  return true;
}
```

**Source:** Analysis of existing matching logic in conversation-executor.ts (line 380) and worker-loop.ts (line 826).

### Example 3: TaskSignalDispatcher Dispatch Flow

```typescript
async function dispatchCompletionSignal(
  task: Task,
  signalType: 'task_completion' | 'task_failure' | 'task_timeout',
  payload: Record<string, unknown>,
): Promise<void> {
  if (!task.parent_id) return; // Root tasks don't signal

  // 1. Build completion_result for durable storage
  const completionResult = {
    signalType,
    payload,
    writtenAt: new Date().toISOString(),
    deliveryStatus: 'pending' as string,
    targetConversationId: null as string | null,
  };

  // 2. Resolve callback conversation through parent task
  const callbackConv = await executor.findActiveForTask(task.parent_id);

  if (!callbackConv) {
    // Orphan path
    completionResult.deliveryStatus = 'orphaned';
    await taskService.update(task.id, {
      metadata: { ...(task.metadata as Record<string, unknown>), completion_result: completionResult },
    });
    // Log signal.orphaned event
    eventLog.append({
      conversationId: `orphan-${task.id}`,
      agentDefinitionId: task.assignee_id,
      agentDefinitionVersion: 'n/a',
      agentInstanceId: `dispatcher-${task.id}`,
      type: 'signal.orphaned',
      payload: { taskId: task.id, signalType, parentTaskId: task.parent_id },
    });
    await eventLog.flush();
    return;
  }

  // 3. Build and deliver signal
  const signal = {
    type: signalType,
    data: { taskId: task.id, ...payload },
    message: buildSignalMessage(signalType, task, payload),
    source: `task:${task.id}`,
    deduplicationId: `${signalType}-${task.id}`,
  };

  completionResult.targetConversationId = callbackConv.id;
  const result = await executor.signal(callbackConv.id, signal);
  completionResult.deliveryStatus = result.action === 'rejected' ? 'failed' : 'delivered';

  // 4. Persist completion_result on task
  await taskService.update(task.id, {
    metadata: { ...(task.metadata as Record<string, unknown>), completion_result: completionResult },
  });
}
```

**Source:** Synthesis of CONTEXT.md decisions + existing executor.signal() patterns.

### Example 4: SQL Migration for Phase 71

```sql
-- Phase 71: Completion Signaling
-- Add completion_result to tasks, active_delegations to conversations

-- 1. completion_result JSONB column on tasks
ALTER TABLE agents.tasks ADD COLUMN completion_result JSONB;

--> statement-breakpoint

-- 2. active_delegations JSONB column on conversations
ALTER TABLE agents.conversations ADD COLUMN active_delegations JSONB DEFAULT '[]';

--> statement-breakpoint

-- Note: pending_wait column stays as JSONB. The shape changes
-- from { type: string } to { types: string[] } at the application
-- layer. No column type change needed.
-- Existing waiting conversations with old { type: "..." } format
-- are handled by backward-compat normalization in signal matching code.
```

**Source:** Analysis of existing migrations pattern in `packages/agents/src/shared/db/migrations/`.

### Example 5: active_delegations Context Block on Resume

```typescript
// Format active_delegations for injection into signal message
function formatActiveDelegations(
  delegations: Array<{
    taskId: string;
    targetEntityId: string;
    description: string;
    delegatedAt: string;
    handshakeStatus: string;
    estimate?: string;
  }>,
): string {
  if (delegations.length === 0) return '';

  const lines = ['<active_delegations>'];
  for (const d of delegations) {
    lines.push(`  <delegation task_id="${d.taskId}" target="${d.targetEntityId}" status="${d.handshakeStatus}">`);
    lines.push(`    ${d.description}`);
    if (d.estimate) lines.push(`    Estimate: ${d.estimate}`);
    lines.push(`    Delegated: ${d.delegatedAt}`);
    lines.push('  </delegation>');
  }
  lines.push('</active_delegations>');
  return lines.join('\n');
}
```

**Source:** Follows XML block pattern used in `<task_context>` (worker-loop.ts) and `<delegation>` (delegate-task.ts).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single-type `pending_wait.type` | Multi-type `pending_wait.types` array | This phase | Signal matching becomes array membership check |
| No task-to-conversation signaling | TaskSignalDispatcher fires on terminal transitions | This phase | Closes the delegation loop |
| Static callback conversation ID | Callback routing through tasks (findActiveForTask) | This phase | Survives conversation re-triggers |
| No completion result storage | `completion_result` JSONB on tasks | This phase | Work product never lost to orphaned signals |
| No delegation awareness on resume | `active_delegations` column survives compaction | This phase | Agent resumes with full delegation context |

## Key Codebase Touch Points

### Files That Must Change

| File | Change | Reason |
|------|--------|--------|
| `framework/wait-for-tool.ts` | `type` field accepts `string\|string[]`, output stores `types` array in WaitForState | SIG-02 multi-type wait |
| `framework/types.ts` | `WaitForState.waitType` becomes `waitTypes: string[]` | Internal representation change |
| `framework/conversation-executor.ts` | Signal matching checks `types` array (with backward compat for `type`) | SIG-02 matching |
| `framework/worker-loop.ts` | Queued signal matching uses `types` array; active_delegations injection on resume | SIG-02, SIG-07 |
| `framework/tool-factories.ts` | Register `coordination:wait_for_task` | SIG-03 tool |
| `shared/services/task-service.ts` | Dispatcher hook in `update()` and `transitionWithHandoff()` | SIG-01 dispatch trigger |
| `shared/db/schema.ts` | `completion_result` JSONB on tasks, `active_delegations` JSONB on conversations, `signal.orphaned` in event types | SIG-04, SIG-07, SIG-11 |
| `shared/db/schema.drizzle.ts` | Mirror schema.ts changes | Drizzle-kit sync |
| `shared/tools/task/delegate-task.ts` | Write active_delegations entry after successful delegation | SIG-07 context |

### Files That Must Be Created

| File | Purpose |
|------|---------|
| `framework/wait-for-task-tool.ts` | `wait_for_task` tool factory |
| `shared/services/task-signal-dispatcher.ts` | Signal dispatch on task terminal states |
| `shared/db/migrations/0010_completion_signaling.sql` | Schema migration |
| `framework/signal-matching.ts` | Shared signal matching helper (extracted from executor + worker loop) |

### Files That Need Test Updates

| File | Why |
|------|-----|
| `framework/wait-for-tool.test.ts` | Multi-type input, types array output |
| `framework/conversation-executor.test.ts` | Array-based signal matching, orphan path |
| `framework/worker-loop.test.ts` | Queued signal matching with types array, taskId scoping |
| `framework/tool-factories.test.ts` | New wait_for_task registration |
| `shared/tools/task/complete-task.test.ts` | Verify dispatcher is called on completion |

### Event Type Addition

The `agentEventTypeValues` array in `schema.ts` needs `"signal.orphaned"` added:
```typescript
export const agentEventTypeValues = [
  "tool.called", "tool.succeeded", "tool.failed",
  "llm.response",
  "agent.started", "agent.completed", "agent.paused", "agent.resumed", "agent.reopened",
  "signal.received",
  "signal.orphaned",  // NEW: Phase 71
] as const;
```

The `schema.drizzle.ts` must mirror this. The database column is `text` type with Drizzle enum validation (TypeScript-only, no DB CHECK constraint), so no ALTER needed -- just the code change.

### Migration Journal Update

The `_journal.json` needs a new entry for `0010_completion_signaling`:
```json
{
  "idx": 6,
  "version": "7",
  "when": 1739174400000,
  "tag": "0010_completion_signaling",
  "breakpoints": true
}
```

Note: Entries for migrations 0007-0009 are missing from the journal (they were hand-written). The new entry should use idx 6 (next after current max idx 5) or follow whatever the actual next index is at implementation time.

## Open Questions

1. **completion_result as column vs metadata JSONB field**
   - What we know: CONTEXT.md says "JSONB column on tasks table." The tasks table already has a `metadata` JSONB column that tools write to (e.g., `{ depth: N, delegatedBy: "..." }`).
   - What's unclear: Should `completion_result` be a dedicated column (cleaner queries, explicit schema) or stored within existing `metadata` (no migration, simpler)?
   - Recommendation: **Dedicated column.** The CONTEXT.md explicitly says "JSONB column on tasks table" and the dashboard queries `completion_result->>'deliveryStatus' = 'orphaned'` -- this reads as a top-level column, not `metadata->'completion_result'->>'deliveryStatus'`. A dedicated column is more queryable, self-documenting, and cleanly separable from task metadata that agents write.

2. **TaskSignalDispatcher injection pattern**
   - What we know: Dispatcher needs ConversationExecutor. Executor needs TaskService. TaskService is currently clean (no executor dependency).
   - What's unclear: Best pattern for wiring.
   - Recommendation: **Dispatcher is a separate service wired in main.ts.** TaskService gains an optional `onTaskUpdate` callback set post-construction (same late-bind pattern as worker loop's executor reference). Dispatcher is created after executor, then wired: `taskService.setDispatcher(dispatcher)`. This keeps TaskService's create/get/update interface clean while enabling the dispatch hook.

3. **Where does active_delegations removal happen?**
   - What we know: CONTEXT.md says "removal happens after agent processes the signal, not at delivery time."
   - What's unclear: The exact mechanism -- does the worker loop remove entries after the agent loop completes? Or does the agent call a tool to acknowledge?
   - Recommendation: **Worker loop removes entries.** After the agent loop completes (the `executeConversation` function in worker-loop.ts), check if the resuming signal was a task lifecycle signal, and if so, remove the matching entry from `active_delegations` before persisting final messages. This is transparent to the agent -- it saw the delegation context during its loop, and the cleanup happens at the persistence boundary.

## Sources

### Primary (HIGH confidence)
- Direct codebase analysis: `wait-for-tool.ts`, `conversation-executor.ts`, `worker-loop.ts`, `timeout-scheduler.ts`, `task-service.ts`, `types.ts`, `schema.ts`, `schema.drizzle.ts`
- Direct codebase analysis: `delegate-task.ts`, `respond-task.ts`, `complete-task.ts`, `handoff-task.ts`
- Direct codebase analysis: Migration files `0005_add_task_tables.sql`, `0009_add_task_depth.sql`, `_journal.json`
- CONTEXT.md locked decisions

### Secondary (MEDIUM confidence)
- `.planning/specs/2.7-agent-collaboration.md` (Phase 74 section)
- `.planning/REQUIREMENTS.md` (SIG-01 through SIG-07)
- `.planning/ROADMAP.md` (Phase 71 estimated plans)
- `.planning/research/PITFALLS.md` (CRITICAL-1 orphan handling)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all existing tools
- Architecture: HIGH -- all patterns derived from direct codebase analysis
- Pitfalls: HIGH -- each pitfall traced to specific code locations
- Signal matching: HIGH -- analyzed both executor.signal() and worker-loop queued signal paths

**Research date:** 2026-02-10
**Valid until:** 2026-03-10 (stable internal architecture)
