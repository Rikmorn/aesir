# Phase 81: Parallel Delegation - Research

**Researched:** 2026-02-20
**Domain:** Fan-out delegation with policy-driven completion semantics
**Confidence:** HIGH

## Summary

Phase 81 builds parallel delegation on top of the existing sequential delegation system shipped in v2.7 (Phase 70-71) and the richer negotiation from Phase 80. The core challenge is introducing a **group abstraction** that aggregates multiple independent delegated conversations under policy-driven completion semantics, while preserving the existing delegation mechanics (handshake, counter-propose, clarify, timeout, completion signaling) per-task within the group.

The implementation requires changes across five layers: (1) a new `task_groups` database table for group state, (2) three new agent tools (`delegate_group`, `wait_for_group`, `group_status`, `cancel_group`), (3) modifications to the task signal dispatcher to evaluate group policies on each task terminal event, (4) integration with the existing timeout scheduler for group-level timeouts, and (5) dashboard extensions to render group nodes in the React Flow delegation graph.

**Primary recommendation:** Implement as a relational `task_groups` table with tasks linking back via a nullable `group_id` foreign key. Group policy evaluation lives in the signal dispatcher (not in the tools or executor). The group is purely a delegator-side abstraction -- target agents are unaware.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Single atomic `delegate_group` tool call with all tasks defined inline -- not a group-then-add pattern
- Atomic creation: if any task fails validation (bad agentId), the entire group fails -- no partial-state groups
- Schema accommodates both `agentId` and `capability` per task (exactly one required, Zod refinement). `capability` returns a clear error until Phase 85 ships
- Response: human-readable string with groupId + per-task taskId mapping (title + agent). No echoed descriptions
- Separate `wait_for_group({ groupId })` tool for waiting on group completion
- Groups are immutable after creation -- no adding tasks to existing groups
- Three policies: `all_required`, `any_sufficient`, `min_required(N)` -- replaces the spec's `majority`
- `all_required` and `any_sufficient` are named shortcuts; `min_required(N)` covers everything in between
- Wake-up rules per policy: `all_required` wakes on first failure/rejection; `min_required(N)` wakes when `(total - failed - rejected) < N`; `any_sufficient` wakes only when all tasks have failed
- Policy satisfaction wakes for all policies; counter-proposals and clarifications always wake
- Signal content: state and context, not suggested actions
- Both group-level and per-task timeouts supported; whichever fires first wins
- Group timeout fires -> all remaining tasks cancelled, delegator wakes with group context
- `wait_for_group` optional `until` parameter: `"policy"` (default) or `"settled"`
- Full Phase 80 negotiation support per task; target agents don't know they're in a group
- `cancel_group` sends `task_cancelled` signal to each running task (not immediate termination)
- Agent gets one cleanup turn after `task_cancelled`, then conversation terminates (status: cancelled)
- Cascading cancellation to sub-agents and sub-delegations
- Cancellation pattern applies to all delegation (standalone and group)
- Residual tasks keep running after policy satisfaction
- `group_status` shows all tasks including cancelled ones -- numbers always add up
- Dashboard: extend existing delegation graph -- group as a distinct node type with policy badge and progress indicator
- Per-task status indicators on child nodes; state coloring on group node (green/yellow/red)
- No separate group management page, timeline view, or group comparison view

### Claude's Discretion
- Data model design for groups (DB schema, JSONB vs relational)
- How group timeout interacts with pg-boss scheduling
- Exact signal type naming for group events
- Dashboard group node styling and layout within React Flow

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PAR-01 | Task groups -- `task:delegate_group` creates multiple delegations as a named group with a shared completion policy | `delegate_group` tool implementation pattern modeled on existing `delegate_task`; atomic creation via DB transaction; Zod schema with `agentId | capability` discriminated union per task |
| PAR-02 | Completion policies -- `all_required`, `any_sufficient`, `min_required(N)` defined at group creation | Policy stored in `task_groups.policy` JSONB; evaluation logic in signal dispatcher; three policy types with named shortcuts |
| PAR-03 | Partial completion handling -- first failure in `all_required` wakes delegator; delegator decides next steps | Signal dispatcher evaluates group state on each task terminal event; wake-up signal includes group context (counts, per-task status, policy assessment) |
| PAR-04 | Group status tool -- `task:group_status` returns aggregated group state | Read-only tool that queries `task_groups` + child tasks; formats human-readable with per-task breakdown |
| PAR-05 | Signal aggregation -- delegator signaled when policy satisfied, not on every completion | `wait_for_group` sets WaitForState with group-scoped metadata; signal dispatcher builds group signals with type `group_policy_satisfied` / `group_policy_unsatisfiable`; signal matching extended for group-level types |
| PAR-06 | Group cancellation -- cancel all remaining tasks in a group | `cancel_group` tool iterates running tasks; sends `task_cancelled` signal per task; one cleanup turn pattern; cascading via same mechanism |
| PAR-07 | Budget-aware group design -- data model accommodates future tree budget distribution | `task_groups` table includes nullable `token_budget` column; no budget enforcement in Phase 81 but schema is ready for Phase 4 (BUD-01) |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| drizzle-orm | existing | DB schema, queries, migrations | Already used throughout codebase |
| zod | existing | Input validation for new tools | Already used for all tool schemas |
| pg-boss | existing | Group timeout scheduling | Already used for `wait_for` timeouts |
| @xyflow/react | existing | Dashboard delegation graph | Already used for existing graph |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| nanoid | existing | ID generation (via `createId`) | Group ID prefix registration |
| dagre | existing | Graph layout | Already used via `graph-layout.tsx` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Relational `task_groups` table | JSONB column on conversations | Relational is better: groups span multiple conversations, need independent lifecycle, and require efficient querying. JSONB would couple group state to the delegator's conversation row |
| New signal types (`group_*`) | Reuse existing `task_*` signal types | New types are cleaner: avoids overloading `task_completion` semantics; group signals carry different payloads (policy assessment, multi-task context) |

## Architecture Patterns

### Recommended Structure
```
packages/agents/src/
├── shared/
│   ├── db/
│   │   ├── schema.ts           # Add task_groups table
│   │   ├── schema.drizzle.ts   # Mirror for drizzle-kit
│   │   └── migrations/
│   │       └── 0017_add_task_groups.sql
│   ├── services/
│   │   ├── group-service.ts    # CRUD for task_groups
│   │   └── task-signal-dispatcher.ts  # Extend with group policy evaluation
│   └── tools/
│       └── task/
│           ├── delegate-group.ts   # delegate_group tool
│           ├── group-status.ts     # group_status tool
│           ├── cancel-group.ts     # cancel_group tool
│           └── index.ts            # Re-export new tools
├── framework/
│   ├── wait-for-group-tool.ts  # wait_for_group tool (parallel to wait-for-task-tool.ts)
│   ├── types.ts                # Extend WaitForState, add GroupDeps to ToolContext
│   ├── tool-factories.ts       # Register new tools
│   └── worker-loop.ts          # Wire GroupDeps, wire wait_for_group
└── ...

packages/dashboard/src/
├── components/tasks/
│   ├── group-node.tsx          # New React Flow node type for groups
│   ├── graph-utils.ts          # Extend transformation for group nodes
│   └── delegation-graph.tsx    # Register group node type
└── services/
    └── tasks.ts                # Extend tree query for groups
```

### Pattern 1: Database Schema for Groups (Claude's Discretion -- RECOMMENDATION: Relational Table)

**What:** A dedicated `task_groups` table rather than JSONB on conversations.

**Why relational over JSONB:**
1. Groups span multiple conversations -- they are not owned by a single conversation row
2. Multiple delegators could query the same group (future expansion)
3. Group lifecycle (created -> satisfied -> cancelled -> settled) is independent of conversation lifecycle
4. Efficient querying: `SELECT * FROM task_groups WHERE id = ?` vs JSONB navigation
5. Integrity: FK from tasks.group_id ensures consistency
6. The tasks table already exists with parent_id; adding group_id is a natural extension

**Schema:**
```sql
-- New table: agents.task_groups
CREATE TABLE agents.task_groups (
  id TEXT PRIMARY KEY,                    -- grp_<nanoid>
  delegator_conversation_id TEXT NOT NULL REFERENCES agents.conversations(id),
  policy JSONB NOT NULL,                  -- { type: "all_required" | "any_sufficient" | "min_required", threshold?: number }
  status TEXT NOT NULL DEFAULT 'active',  -- active | satisfied | unsatisfiable | cancelled | settled
  timeout_duration TEXT,                  -- e.g., "2h" (null = no group timeout)
  timeout_job_id TEXT,                    -- pg-boss job ID for group timeout
  token_budget INTEGER,                   -- Phase 4 (PAR-07): nullable, no enforcement yet
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add group_id FK to tasks
ALTER TABLE agents.tasks ADD COLUMN group_id TEXT REFERENCES agents.task_groups(id);
CREATE INDEX idx_tasks_group ON agents.tasks(group_id);
```

**Group status lifecycle:**
- `active` -- group created, tasks running
- `satisfied` -- policy met (happy path)
- `unsatisfiable` -- policy can no longer be met (enough failures)
- `cancelled` -- explicitly cancelled via `cancel_group`
- `settled` -- all tasks in terminal state (completed/failed/cancelled)

**Why this works:** The group row is the single source of truth for policy evaluation. The signal dispatcher reads the group, evaluates the policy against current task states, updates group status, and decides whether to signal the delegator. No distributed coordination needed.

### Pattern 2: Group Policy Evaluation in Signal Dispatcher

**What:** Extend `TaskSignalDispatcher.onTaskUpdate()` to evaluate group policies when a task with a `group_id` reaches terminal state.

**Why in the dispatcher (not the tools):**
- The dispatcher is already the callback for task terminal transitions
- It already has access to executor, taskService, eventLog, db
- Policy evaluation is infrastructure (state machine), not agent behavior
- Centralizing ensures consistency -- no matter how a task completes, the group is evaluated

**Flow:**
```
Task completes/fails → TaskService.update() → dispatcher.onTaskUpdate()
  1. Check if task has group_id
  2. If no group_id → existing behavior (signal parent task's conversation)
  3. If group_id → evaluate group policy:
     a. Query all tasks in group
     b. Count completed, failed, cancelled, running
     c. Evaluate policy satisfaction / unsatisfiability
     d. Update group status if changed
     e. If wake condition met → build group signal → signal delegator conversation
     f. If no wake condition → return (other tasks still running)
```

**Signal types for groups (Claude's Discretion -- RECOMMENDATION):**
- `group_policy_satisfied` -- policy met, group satisfied
- `group_policy_unsatisfiable` -- policy can no longer be met
- `group_settled` -- all tasks terminal (used with `until: "settled"`)
- `group_task_failed` -- a task failed (for `all_required` immediate wake)
- Reuse existing `task_clarification` and `task_counter_proposed` per-task (these always wake)

**Alternative considered:** Using existing `task_completion` / `task_failure` types with group metadata in the data field. Rejected because: (a) the signal matching logic would need to distinguish group vs standalone signals, (b) the payloads are structurally different (group signals include policy assessment, per-task counts), and (c) new types are cleaner and avoid semantic overloading.

### Pattern 3: wait_for_group Tool (Parallel to wait_for_task)

**What:** A new `wait_for_group` tool that follows the exact same mutable WaitForState pattern as `wait_for_task`.

**How it differs from wait_for_task:**
- Metadata contains `groupId` instead of `taskId`
- Wait types are group-specific: `["group_policy_satisfied", "group_policy_unsatisfiable", "group_settled", "group_task_failed", "task_clarification", "task_counter_proposed"]`
- The `until` parameter controls which types are included:
  - `"policy"` (default): `["group_policy_satisfied", "group_policy_unsatisfiable", "group_task_failed", "task_clarification", "task_counter_proposed"]`
  - `"settled"`: `["group_settled", "task_clarification", "task_counter_proposed"]`
- Signal matching needs group-scoped matching: `pendingWait.metadata.groupId` must match signal's `data.groupId`

**Worker loop wiring:** Same pattern as `wait_for_task` -- find the tool in resolvedTools, replace execute with one bound to the per-conversation WaitForState.

### Pattern 4: Cancellation with Cleanup Turn

**What:** `task_cancelled` signal gives the target agent one turn to clean up, then the conversation is force-terminated.

**Implementation approach:**
1. `cancel_group` (or standalone cancel) sends `task_cancelled` signal to each running task's conversation via `executor.signal()`
2. The signal resumes the conversation (normal signal flow)
3. The signal message includes: `"Your task has been cancelled. You have one turn to clean up (save artifacts, add comments, mark status)."`
4. The worker loop, after the agent loop completes, checks for a new flag: if the conversation was woken by `task_cancelled`, transition to `cancelled` instead of allowing further wait_for
5. Cascading: if the cancelled agent has active_delegations, send `task_cancelled` to each

**How to detect "one cleanup turn":** The simplest approach is to set a flag on the conversation row (e.g., `pending_cancellation: true`) when the `task_cancelled` signal is delivered. The worker loop checks this flag after the agent loop exits:
- If `pending_cancellation` and `waitForState.triggered` -> override: transition to `cancelled` (don't honor the wait_for)
- If `pending_cancellation` and loop completed normally -> transition to `cancelled`
- This ensures exactly one turn regardless of what the agent does

**Alternative: conversation-level `cancel()` with injected message.** Rejected because: the agent needs to see the cancellation context and reason to do meaningful cleanup. A direct `executor.cancel()` skips the agent entirely.

### Pattern 5: Dashboard Group Node

**What:** A new React Flow node type that represents a group in the delegation graph.

**Visual design (Claude's Discretion -- RECOMMENDATION):**
- Wider than task nodes (280px vs 220px) to accommodate policy badge and progress
- Top row: policy badge ("all_required", "any: 1/3", "min: 2/5") + group status icon
- Middle: progress bar or fraction (e.g., "2/5 completed")
- Bottom: status text with timing
- Border color follows group status: green (satisfied), yellow/amber (in progress), red (unsatisfiable)
- Group node connects to child task nodes via edges (same dagre layout)

**Graph transformation changes:**
- `getTaskTree` query needs to include group information (join task_groups)
- `TaskTreeNode` type extended with optional `groupId`, `groupPolicy`, `groupStatus`
- `transformTreeToGraph` creates group nodes for tasks that share a group_id
- Group nodes become parent of their child task nodes in the graph
- The delegator node connects to the group node, not individual tasks

### Anti-Patterns to Avoid
- **Group logic in agent prompts:** Group policy evaluation is infrastructure, not agent behavior. The agent says "delegate to 3 agents with all_required" -- the framework handles the rest.
- **Modifying target agents for group awareness:** Target agents must remain unaware of groups. The group is a delegator-side abstraction. If targets needed group awareness, every existing agent definition would need updates.
- **Auto-cancellation on policy satisfaction:** The user explicitly decided against this. Residual tasks keep running -- the delegator decides.
- **JSONB for group state:** Groups need their own lifecycle, efficient querying, and FK relationships. JSONB on conversations couples group state to a single row.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Group timeout scheduling | Custom timer | pg-boss (existing TimeoutScheduler) | Already handles delayed signal delivery, cancellation, singleton keys; group timeout is just another scheduled job |
| Atomic multi-task creation | Manual SQL | Drizzle transaction | Existing pattern: delegate_task uses `deps.executor.start()` in sequence; delegate_group wraps all starts in a transaction with rollback on any failure |
| Signal matching for groups | New matching system | Extend existing `signalMatchesPendingWait` | The existing system already supports metadata-scoped matching (taskId); adding groupId is identical |
| Graph layout | Custom positioning | dagre (existing `getLayoutedElements`) | Already handles hierarchical graphs; adding group nodes is a tree shape change, not a layout algorithm change |

**Key insight:** Almost every mechanism needed for parallel delegation already exists in the codebase. The primary new work is the group abstraction (DB table, service, policy evaluation) and the tooling layer. The executor, worker loop, signal matching, and timeout scheduler need extensions, not rewrites.

## Common Pitfalls

### Pitfall 1: Race Conditions in Group Policy Evaluation
**What goes wrong:** Two tasks in the same group complete near-simultaneously. Both trigger `onTaskUpdate`, both evaluate the policy, both decide to signal the delegator. Result: duplicate wake-up signals.
**Why it happens:** The signal dispatcher is called per-task, not per-group. Without coordination, parallel completions race.
**How to avoid:** Use `SELECT ... FOR UPDATE` on the `task_groups` row when evaluating the policy. This serializes concurrent evaluations for the same group. The first evaluation wins; the second sees the updated group status and skips signaling.
**Warning signs:** Delegator wakes up twice for the same policy event; duplicate `group_policy_satisfied` signals.

### Pitfall 2: Signal Type Confusion Between Group and Task Signals
**What goes wrong:** The delegator is waiting for group signals but receives a per-task `task_completion` from the signal dispatcher's existing logic. Or: the signal dispatcher sends both per-task and group signals, causing double wake-ups.
**Why it happens:** The existing dispatcher always sends `task_completion` / `task_failure` for terminal tasks. Adding group logic without disabling per-task signaling creates both paths.
**How to avoid:** When a task has a `group_id`, the dispatcher should suppress the per-task signal to the delegator and only evaluate the group policy. The per-task signal is effectively "absorbed" by the group. The delegator's pending_wait will be listening for group signal types, not task signal types.
**Warning signs:** `signal rejected: type mismatch` logs where the delegator is waiting for `group_policy_satisfied` but receives `task_completion`.

### Pitfall 3: Cancellation Cascade Infinite Loop
**What goes wrong:** Agent A's task is cancelled, which cascades to Agent A's sub-delegation B, which cascades to B's sub-delegation C. If any of these have circular references or re-delegation, the cascade never terminates.
**Why it happens:** Cascading cancellation follows active_delegations, which could theoretically loop if the graph has cycles (shouldn't happen given MAX_DELEGATION_DEPTH, but defensive coding matters).
**How to avoid:** Track visited conversation IDs during cascade. If a conversation is already in the visited set, skip it. Alternatively, set a cascade depth limit matching MAX_DELEGATION_DEPTH.
**Warning signs:** CPU spike during cancellation, conversation status stuck in running after cancel_group.

### Pitfall 4: Group Timeout vs Per-Task Timeout Interaction
**What goes wrong:** A per-task timeout fires for one task in the group, transitioning that task to failed. The group evaluator then wakes the delegator (for `all_required`, this breaks the policy). Meanwhile, the group timeout fires later and tries to cancel already-terminated tasks.
**Why it happens:** Two independent timeout mechanisms (per-task via `wait_for_task` timeout, group via `delegate_group` timeout) operating on the same set of tasks.
**How to avoid:** When the group timeout fires, check each task's status before sending `task_cancelled`. Skip tasks already in terminal state. When a per-task timeout fires within a group, the normal group policy evaluation handles it (the task fails, the group evaluator is called). Document clearly: per-task timeouts cause individual failure; group timeout cancels everything remaining.
**Warning signs:** "Signal rejected" errors for cancelled signals sent to already-terminal conversations.

### Pitfall 5: Delegator Conversation Gone When Group Signals Arrive
**What goes wrong:** The delegator's conversation times out, crashes, or is cancelled between `delegate_group` and group completion. Group signals arrive but there's no conversation to deliver them to.
**Why it happens:** Same orphan scenario as existing delegation, but multiplied -- the delegator may have many tasks in flight.
**How to avoid:** Same pattern as existing `TaskSignalDispatcher` orphan handling: check for active conversation, write to completion_result if orphaned, emit `signal.orphaned` event. The group status should transition to `settled` (or appropriate terminal) even without the delegator.
**Warning signs:** `signal.orphaned` events with group context in the event log.

### Pitfall 6: WaitForState Conflict with Multiple Group Operations
**What goes wrong:** The delegator calls `delegate_group` and then `wait_for_group`. But in a complex workflow, the agent might also call `wait_for_task` for a standalone delegation. Since WaitForState is a single mutable object, the last tool call wins, potentially overwriting a previous wait.
**Why it happens:** WaitForState is designed for one wait per agent loop run. Multiple waits are not supported.
**How to avoid:** This is the expected behavior -- the agent should only call one wait tool per turn. Document in the tool descriptions that `wait_for_group` and `wait_for_task` are mutually exclusive within a single turn. The prompt guidance should clarify this.
**Warning signs:** Agent attempts to call both `wait_for_task` and `wait_for_group` in the same turn.

## Code Examples

### Example 1: delegate_group Tool Schema
```typescript
// packages/agents/src/shared/tools/task/delegate-group.ts

const TaskInGroupSchema = z.object({
  agentId: z.string().min(1).optional(),
  capability: z.string().min(1).optional(),
  description: z.string().min(1),
  timeout: z.string().optional()
    .describe("Per-task timeout (e.g., '1h'). Optional within groups."),
}).refine(
  (task) => (task.agentId != null) !== (task.capability != null),
  "Exactly one of agentId or capability must be provided"
);

const CompletionPolicySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("all_required") }),
  z.object({ type: z.literal("any_sufficient") }),
  z.object({
    type: z.literal("min_required"),
    threshold: z.number().int().min(1),
  }),
]);

const DelegateGroupInputSchema = z.object({
  tasks: z.array(TaskInGroupSchema).min(2)
    .describe("Tasks to delegate in parallel (minimum 2)"),
  policy: CompletionPolicySchema
    .describe("Completion policy for the group"),
  timeout: z.string().optional()
    .describe("Group-level timeout (e.g., '2h'). Caps total wall time."),
});
```

### Example 2: Group Policy Evaluation Logic
```typescript
// packages/agents/src/shared/services/task-signal-dispatcher.ts (extension)

interface GroupState {
  total: number;
  completed: number;
  failed: number;
  cancelled: number;
  running: number;
}

function evaluateGroupPolicy(
  policy: { type: string; threshold?: number },
  state: GroupState,
): { satisfied: boolean; unsatisfiable: boolean } {
  switch (policy.type) {
    case "all_required":
      return {
        satisfied: state.completed === state.total,
        unsatisfiable: state.failed > 0 || state.cancelled > 0,
      };
    case "any_sufficient":
      return {
        satisfied: state.completed > 0,
        unsatisfiable: state.failed + state.cancelled === state.total,
      };
    case "min_required": {
      const threshold = policy.threshold ?? 1;
      const remaining = state.total - state.failed - state.cancelled;
      return {
        satisfied: state.completed >= threshold,
        unsatisfiable: remaining < threshold,
      };
    }
    default:
      return { satisfied: false, unsatisfiable: false };
  }
}
```

### Example 3: Signal Matching Extension for Groups
```typescript
// packages/agents/src/framework/signal-matching.ts (extension)

// Existing taskId-scoped matching:
if (metadata?.taskId) {
  const signalTaskId = signal.data?.taskId;
  if (signalTaskId !== metadata.taskId) return false;
}

// New groupId-scoped matching (added):
if (metadata?.groupId) {
  const signalGroupId = signal.data?.groupId;
  if (signalGroupId !== metadata.groupId) return false;
}
```

### Example 4: Cancellation with One Cleanup Turn
```typescript
// In cancel_group tool:
for (const task of runningTasks) {
  const conv = await deps.executor.findActiveForTask(task.id);
  if (!conv) continue;

  await deps.executor.signal(conv.id, {
    type: "task_cancelled",
    data: {
      taskId: task.id,
      groupId: groupId,
      reason: "Group cancelled by delegator",
    },
    message: "Your task has been cancelled. You have one turn to clean up.",
    source: `agent:${ctx.agentId}`,
    deduplicationId: `cancel-${task.id}`,
  });

  // Mark conversation for post-loop termination
  // (pending_cancellation flag on conversations row)
}
```

### Example 5: wait_for_group WaitForState Setup
```typescript
// packages/agents/src/framework/wait-for-group-tool.ts

waitForState.triggered = true;
waitForState.reason = `Waiting for group ${parsed.groupId} (policy: ${groupPolicy})`;
waitForState.timeout = null; // group timeout is separate (pg-boss)
waitForState.metadata = { groupId: parsed.groupId };

if (parsed.until === "settled") {
  waitForState.waitTypes = [
    "group_settled",
    "task_clarification",
    "task_counter_proposed",
  ];
} else {
  // Default: "policy"
  waitForState.waitTypes = [
    "group_policy_satisfied",
    "group_policy_unsatisfiable",
    "group_task_failed",
    "task_clarification",
    "task_counter_proposed",
  ];
}
waitForState.timeoutSignalType = "group_timeout";
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Sequential delegation only | Sequential delegation (v2.7 Phase 70) | 2026-02-13 | Single-task delegation works; no parallel support |
| Accept/reject handshake | Counter-propose + clarify (Phase 80) | 2026-02-20 | Full negotiation per task; Phase 81 preserves this per-task within groups |
| No cancellation mechanism | None yet (Phase 81 introduces) | This phase | Cancellation with cleanup turn is new for all delegation, not just groups |

**Existing infrastructure reused:**
- `TaskSignalDispatcher` -- extended with group policy evaluation
- `TimeoutScheduler` (pg-boss) -- used for group timeout scheduling
- `signalMatchesPendingWait` -- extended with groupId-scoped matching
- `WaitForState` mutable pattern -- used for `wait_for_group`
- React Flow delegation graph -- extended with group node type
- `createId` prefix system -- new `taskGroup: () => "grp_<nanoid>"`

## Open Questions

1. **Conversation `pending_cancellation` flag**
   - What we know: The cancellation with cleanup turn pattern needs a way to force-terminate after one turn. Adding a boolean column to conversations is simple but adds a column for a narrow use case.
   - What's unclear: Whether a JSONB field in `pending_wait` or a separate mechanism is cleaner.
   - Recommendation: Use a simple boolean column `pending_cancellation` on conversations. It is checked once in the worker loop post-agent-loop logic. The column is useful for both group and standalone cancellation, so it earns its place in the schema.

2. **Group signal types for counter-proposals and clarifications within groups**
   - What we know: Counter-proposals and clarifications always wake the delegator regardless of policy. These are per-task signals (`task_counter_proposed`, `task_clarification`) that the delegator handles while waiting on the group.
   - What's unclear: Whether the delegator's `wait_for_group` pending_wait should match per-task signal types directly, or whether these should be wrapped in group-specific signal types.
   - Recommendation: Include per-task signal types (`task_clarification`, `task_counter_proposed`) directly in the `wait_for_group` wait types. The signal matching already supports taskId-scoped matching via metadata. Adding `groupId` to the signal data lets the delegator's pending_wait match on groupId, and the signal's `data.taskId` identifies which task within the group needs attention. No wrapping needed.

3. **Where to evaluate group settled state**
   - What we know: After policy satisfaction/unsatisfiability, the delegator may call `wait_for_group({ until: "settled" })`. The system needs to detect when all tasks are terminal.
   - What's unclear: Whether `settled` should be computed on each task terminal event (in the dispatcher) or on-demand when the delegator re-enters `wait_for_group`.
   - Recommendation: Compute in the dispatcher. On each task terminal event, after policy evaluation, also check if all tasks are terminal. If the group status is already `satisfied` or `unsatisfiable` and all tasks are terminal, transition group to `settled` and signal the delegator with `group_settled` if they're waiting for it.

## Sources

### Primary (HIGH confidence)
- Codebase: `packages/agents/src/shared/tools/task/delegate-task.ts` -- existing delegation pattern
- Codebase: `packages/agents/src/shared/services/task-signal-dispatcher.ts` -- existing signal dispatch
- Codebase: `packages/agents/src/framework/wait-for-task-tool.ts` -- WaitForState pattern
- Codebase: `packages/agents/src/framework/signal-matching.ts` -- signal matching logic
- Codebase: `packages/agents/src/framework/conversation-executor.ts` -- signal delivery
- Codebase: `packages/agents/src/framework/worker-loop.ts` -- tool wiring, wait state interception
- Codebase: `packages/agents/src/framework/timeout-scheduler.ts` -- pg-boss integration
- Codebase: `packages/agents/src/shared/db/schema.ts` -- DB schema patterns
- Codebase: `packages/dashboard/src/components/tasks/delegation-graph.tsx` -- React Flow graph
- Codebase: `packages/dashboard/src/components/tasks/graph-utils.ts` -- graph transformation logic
- Codebase: `packages/dashboard/src/services/tasks.ts` -- task tree queries

### Secondary (MEDIUM confidence)
- Codebase: `.planning/specs/2.9-platform-completion.md` -- Phase 2 spec requirements
- Codebase: `.planning/phases/81-parallel-delegation/81-CONTEXT.md` -- user decisions

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new external dependencies; all existing libraries
- Architecture: HIGH -- extends existing patterns (delegation, signal dispatch, WaitForState, React Flow) rather than introducing new ones
- Pitfalls: HIGH -- identified from direct codebase analysis of race conditions, signal routing, and lifecycle management
- Data model: HIGH -- relational table recommended with strong reasoning; JSONB alternative considered and rejected

**Research date:** 2026-02-20
**Valid until:** 2026-03-20 (stable -- internal codebase, no external dependency changes)
