# Phase 80: Richer Negotiation - Research

**Researched:** 2026-02-20
**Domain:** Delegation handshake expansion, cross-conversation signaling, task tool extensions, agent prompt design
**Confidence:** HIGH

## Summary

Phase 80 replaces the binary accept/reject delegation handshake with two new capabilities: counter-proposals (target agent proposes modified scope before starting work) and mid-task clarification (target agent asks questions during execution). Both capabilities build directly on the existing signal/wait_for infrastructure from Phase 71 without requiring new database columns or schema changes. The core work is: (1) extending `task:respond` with a discriminated union for `counter_propose`, (2) creating a new `task:clarify` tool, (3) adding new signal types (`task_counter_proposed`, `task_clarification`, `task_clarification_response`), (4) extending `wait_for_task` to listen for `task_clarification` signals, and (5) updating agent prompts with negotiation personality guidance.

The most important architectural concern is CRITICAL-1 from PITFALLS.md: clarification deadlock from nested wait-for. When a target agent asks a clarification question, the delegator must resume, answer, and re-pause. The delegator's `pending_wait` types must always include `task_clarification` alongside completion/failure/timeout signals. The solution is extending `wait_for_task` to include `task_clarification` in its auto-registered types, so agents never accidentally drop clarification signals by using plain `wait_for`.

All changes are within `packages/agents/` -- no integration packages, no database migrations, no new tables. The signal infrastructure already handles arbitrary string types, the `wait_for` tool already supports multi-type arrays, and the `signalMatchesPendingWait()` function already does taskId-scoped matching. This is primarily tool + signal + prompt work.

**Primary recommendation:** Implement in 5 plans: (1) counter-propose response type on `task:respond`, (2) `task:clarify` tool + clarification signal flow, (3) extend `wait_for_task` to include `task_clarification`, (4) dashboard representation of counter-proposals and clarifications, (5) prompt updates for negotiation personality across all delegation-capable agents.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Counter-proposal shape:**
- New `counter_propose` response type on existing `task:respond` tool (discriminated union) -- not a separate tool
- Parameters: `taskId`, `type: "counter_propose"`, `reason` (optional), `proposal` (required -- free-text modification description)
- Calling `task:respond({ type: "counter_propose" })` implicitly triggers `wait_for` on the target side -- two-round handshake
- `task_counter_proposed` signal resumes the delegator's `wait_for` with payload: original task summary, counter-proposal text, responding agent ID
- Delegator sees the counter-proposal and uses existing tools to act: accept the modified version, reject/cancel the task, or re-delegate to a different agent -- no new delegator-side tools needed
- Strictly accept/reject the counter-proposal -- no counter-counter-proposals. If the delegator doesn't like it, reject and re-delegate with refined scope (effectively a fresh negotiation)
- Handshake answers "will you do this?" (bounded). Clarification handles "how exactly?" (iterative). Those are the right boundaries.

**Clarification style:**
- Standalone `task:clarify` tool in the task namespace -- NOT an extension of `task:respond` (different lifecycle phase: execution vs handshake)
- Parameters: `taskId`, `question` (required -- free-text), `options` (optional -- structured choices when the question has discrete answers)
- `task:clarify` automatically enters `wait_for` -- asking and waiting is a single logical operation
- `task_clarification` signal resumes the delegator with the question and options. Delegator answers via signal back to target
- Delegator can always answer freely regardless of whether structured options were provided
- Clarification time counts against the task timeout -- single timeout model, no pause/resume clock mechanism
- Multi-round clarification naturally bounded by the task timeout -- no hard round limit

**Negotiation personality:**
- Accommodating by default -- counter-propose makes accommodating safe by enabling honest scoping
- Disposition hierarchy: prefer accepting > counter-proposing > rejecting. Move work forward.
- Counter-propose to honestly scope: "I can do this but not that part" beats accepting and delivering poorly
- Reserve rejection for genuine capability mismatches: "I'm a test runner, I can't write a product brief"
- Clarify when the ambiguity is about intent (what do you want?) -- proceed with assumptions when ambiguity is about implementation (how should I build it?)
- Cost-of-being-wrong framework: clarify when wrong assumption wastes significant work; assume when getting it wrong is cheap to fix
- Task timeout is the universal bound for both clarification rounds and delegation retry attempts -- no hard limits on either
- Generic negotiation principles for all agents in v2.9 -- role-specific calibration deferred to v3.0 Domain Modeling

**Fallback after rejection:**
- Entirely the delegator's responsibility -- agent-first principle. No system-level retry mechanism or alternative suggestions.
- Delegator's LLM reasons about next steps using existing tools: directory search (today), capability-based discovery (Phase 85)
- Rejection/counter-proposal-rejected signals carry: reason, original task summary, responding agent ID -- enough context for the delegator to reason without history lookup
- Consistent signal shape across all delegation signals (rejection, counter-proposal, counter-proposal-rejected, clarification)
- Re-delegation context is naturally included by the delegator's LLM in the new task description -- no `previousAttempts` system field needed
- The delegator decides what prior context is relevant to share with the new agent (sometimes the rejection reason matters, sometimes it doesn't)

### Claude's Discretion
- Signal naming conventions (exact signal type strings)
- Zod schema design for the discriminated union on `task:respond`
- `task:clarify` internal implementation and how it interacts with the wait_for mechanism
- Dashboard representation of counter-proposals and clarifications in the conversation timeline
- Prompt wording for the generic negotiation principles

### Deferred Ideas (OUT OF SCOPE)
- Role-specific negotiation calibration (e.g., "QA agent should be more selective about work outside testing scope") -- v3.0 Domain Modeling
- Counter-counter-proposals / multi-round handshake negotiation -- explicitly rejected, re-delegation handles this
- System-suggested alternative agents after rejection -- anti-pattern per agent-first principles
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| NEG-01 | Counter-propose response type -- target responds with modified scope, delegator decides: accept, reject, or try someone else | Discriminated union on `task:respond` Zod schema; `task_counter_proposed` signal type; delegator uses existing tools (wait_for_task, cancel, re-delegate) to respond |
| NEG-02 | Counter-propose as handshake strategy -- same `task:respond` tool with additional response type | Extends existing `RespondTaskInputSchema` from `respond-task.ts:17-32`; target's `task:respond({ type: "counter_propose" })` calls internal `wait_for` mechanism; needs WaitForState wiring similar to `task:clarify` |
| NEG-03 | Clarification signal type -- `task_clarification` signal from target to delegator with question and optional structured options | New signal type string `task_clarification`; signal payload includes `taskId`, `question`, `options[]`, `respondedBy`; delivered via `executor.signal()` to delegator's conversation |
| NEG-04 | `task:clarify` tool -- target agent sends clarification request back to delegating conversation | New tool factory `createClarifyTaskTool` in `packages/agents/src/shared/tools/task/`; requires `delegationDeps` (same as respond_task); auto-enters `wait_for` via WaitForState pattern |
| NEG-05 | Clarification response -- delegator answers via signal back to target | `task_clarification_response` signal from delegator to target's conversation; target's `wait_for` resumes with answer in context; delegator sends signal via `executor.signal()` found through `findActiveForTask()` |
| NEG-06 | Multi-round support -- clarification can go back and forth, bounded by task timeout | `wait_for_task` extended to include `task_clarification` in its types array; delegator's re-pause after answering uses same `wait_for_task`; task timeout is the universal bound (no round limit) |
| NEG-07 | Prompt guidance -- agents understand when to counter-propose vs reject, when to clarify vs proceed with assumptions | Prompt updates to dev-agent, qa-agent, and all delegation-capable agents; disposition hierarchy and cost-of-being-wrong framework from locked decisions |
</phase_requirements>

## Architecture Patterns

### Current Delegation Handshake Flow

Understanding the existing flow is critical for knowing where to insert counter-proposals and clarification.

```
Delegator                          Target
   |                                  |
   |-- delegate_task() ------------>  |  (starts target conversation)
   |-- wait_for("task_handshake") --> |  (delegator pauses)
   |                                  |-- respond_task("accept") or respond_task("reject")
   |                                  |   (sends task_handshake signal to delegator)
   |<-- signal: task_handshake ----   |
   |                                  |
   |  (if accepted)                   |
   |-- wait_for_task(taskId) -------> |  (delegator pauses for completion)
   |                                  |-- [does work]
   |                                  |-- complete_task()
   |                                  |   (triggers task_completion signal via dispatcher)
   |<-- signal: task_completion ---   |
   |-- [processes result]             |
```

**Key code paths:**
- `delegate-task.ts:66-219` - Creates task, starts conversation, writes `active_delegations`
- `respond-task.ts:41-161` - Sends `task_handshake` signal to delegator via `executor.signal()`
- `wait-for-task-tool.ts:55-92` - Sets `waitTypes: ["task_completion", "task_failure", "task_timeout"]`
- `signal-matching.ts:22-52` - Matches signals against `pending_wait.types` with taskId scoping
- `task-signal-dispatcher.ts:98-273` - Fires completion/failure signals on terminal task transitions

### New Flow: Counter-Propose

```
Delegator                          Target
   |                                  |
   |-- delegate_task() ------------>  |
   |-- wait_for("task_handshake") --> |
   |                                  |-- respond_task({ type: "counter_propose", proposal: "..." })
   |                                  |   (sends task_counter_proposed signal)
   |                                  |   (target enters wait_for("task_handshake") -- waiting for accept/reject)
   |<-- signal: task_counter_proposed |
   |                                  |
   |  [evaluates counter-proposal]    |
   |                                  |
   |  OPTION A: Accept modification   |
   |  sends task_handshake signal     |
   |  with response: "accepted"    -->|  (target resumes, begins work)
   |  then: wait_for_task(taskId)     |
   |                                  |
   |  OPTION B: Reject modification   |
   |  sends task_handshake signal     |
   |  with response: "rejected"    -->|  (target conversation terminates)
   |  then: re-delegate to someone else
```

**Implementation detail:** `task:respond({ type: "counter_propose" })` does TWO things atomically:
1. Sends `task_counter_proposed` signal to delegator's conversation
2. Enters `wait_for` on the target side, waiting for `task_handshake` (accept/reject the counter-proposal)

The target does NOT need a new tool to receive the accept/reject -- it uses the same `wait_for` mechanism. When the delegator accepts, it sends a `task_handshake` signal (type: `"task_handshake"`, data: `{ response: "accepted", taskId }`) to the target's conversation. The target resumes and begins work.

**How the delegator sends its response:** The delegator does not need new tools. When it receives the counter-proposal signal, its conversation resumes. It can:
- Accept: send a signal to the target's conversation via `executor.signal()` -- but the delegator doesn't have direct access to `executor.signal()`. Instead, the system needs a mechanism for the delegator to accept/reject counter-proposals.

**Resolution:** The delegator responds by calling `wait_for_task(taskId)` after evaluating the counter-proposal. But the target needs to know whether its proposal was accepted or rejected. Two approaches:

1. **New `task:accept_counter_proposal` tool** -- violates the "no new delegator-side tools" decision.
2. **Implicit acceptance via wait_for_task** -- the target detects it was accepted when the delegator transitions to `wait_for_task`. But signals don't work this way; the target is paused waiting for a `task_handshake` signal.

**Recommended approach:** The delegator's action after receiving a counter-proposal maps to signals:
- **Accept:** The delegator should explicitly call a tool that sends a `task_handshake` signal with `response: "accepted"` to the target. But the decision says "no new delegator-side tools needed." The existing tools that can accomplish this: the delegator could use `executor.signal()` indirectly. But agents don't have direct signal-sending tools.

**Actual implementation path:** Since the context says "Delegator sees the counter-proposal and uses existing tools to act: accept the modified version, reject/cancel the task, or re-delegate," the mechanism is:
- The counter-propose creates a new `wait_for` on the target side waiting for `task_handshake`
- The **system** (worker loop or tool) sends the accept/reject signal based on the delegator's actions:
  - If delegator calls `wait_for_task(taskId)`, that implicitly means acceptance -- the system can auto-send `task_handshake(accepted)` to the target
  - If delegator cancels the task or re-delegates, that implicitly means rejection -- the system can auto-send `task_handshake(rejected)` to the target or the target's timeout fires

However, this is implicit and fragile. A cleaner approach that still avoids a new tool: **`wait_for_task` on a counter-proposed task auto-sends acceptance**. When the delegator calls `wait_for_task(taskId)` and the task is in a "counter-proposed" state, the tool:
1. Sends `task_handshake({ response: "accepted" })` to the target's conversation
2. Transitions the task to "active"
3. Enters the normal `wait_for_task` wait

For rejection, the delegator can cancel the task or simply re-delegate. When the task is cancelled (or the delegator's conversation ends without accepting), the target's `wait_for` timeout fires.

This keeps the delegator's tool surface unchanged while making acceptance explicit. The task status tracks the state: `created` -> `counter_proposed` -> `active`.

### New Flow: Clarification

```
Delegator                          Target
   |                                  |
   |  (target is doing work)          |
   |                                  |-- task:clarify({ taskId, question: "..." })
   |                                  |   (sends task_clarification signal to delegator)
   |                                  |   (target enters wait_for, waiting for answer)
   |<-- signal: task_clarification    |
   |                                  |
   |  [reads question, formulates     |
   |   answer]                        |
   |  sends task_clarification_response
   |  signal to target's conversation |
   |  --> signal: task_clarification_response
   |                                  |  (target resumes with answer)
   |  re-enters wait_for_task(taskId) |  [continues work]
   |                                  |
   |                                  |-- (may clarify again, or complete)
```

**CRITICAL-1 deadlock prevention:** The delegator must re-enter `wait_for_task` after answering, not plain `wait_for`. Since `wait_for_task` registers for `["task_completion", "task_failure", "task_timeout"]`, we MUST extend it to also include `"task_clarification"`. This ensures the delegator can be woken by both clarification requests AND completion signals, regardless of which arrives first.

**How the delegator sends the answer:** Same problem as counter-proposal acceptance -- the delegator needs to send a signal to the target. The delegator doesn't have a direct signal-sending tool.

**Recommended approach:** A new tool `task:answer_clarification` (or fold the answer into the delegator's response to the clarification signal). But the context says the delegator "answers via signal back to target." The cleanest implementation: when the delegator's conversation resumes on a `task_clarification` signal, the delegator's response is captured by the agent loop, and a new tool `task:respond_clarification` or similar sends it. But the locked decisions say "Delegator can always answer freely regardless of whether structured options were provided" -- implying the delegator just acts (via a tool call or by generating a response).

**Simplest approach matching the decisions:** The delegator answers by calling a tool. Since clarification is in the `task` namespace and is different from the handshake, a tool like `task:answer` would work. However, the decisions don't mention a new delegator tool. Let me re-read: "Delegator answers via signal back to target."

The implementation needs SOME mechanism for the delegator to send a signal. Options:
1. **Automatic capture:** When the delegator's conversation resumes on a `task_clarification` signal, the next assistant message text is automatically sent as the answer signal. Too magic, too fragile.
2. **Explicit tool:** A `task:answer` or `task:respond_clarification` tool that sends `task_clarification_response` signal. This is clean but adds a delegator-side tool.
3. **Reuse existing:** The delegator could use `communication:reply` -- but that goes to the human channel, not the target agent.

**Recommendation:** Create a minimal `task:answer` tool (or name it `task:respond_clarification`) that sends a `task_clarification_response` signal to the target's conversation. This is NOT a "new delegator-side tool for counter-proposals" (which was rejected) -- it's a tool for the clarification flow specifically, and the locked decisions explicitly call this out: "Delegator answers via signal back to target." The signal must be sent somehow, and a tool is the appropriate mechanism in this architecture.

### Signal Type Naming Convention

Building on the existing taxonomy from `KNOWN_SIGNAL_TYPES` (framework/types.ts:480-492):

| Signal Type | Direction | Purpose | Payload |
|-------------|-----------|---------|---------|
| `task_handshake` | target -> delegator | Accept/reject (existing) | `{ taskId, response, estimate?, reason?, respondedBy }` |
| `task_counter_proposed` | target -> delegator | Counter-proposal | `{ taskId, proposal, reason?, originalDescription, respondedBy }` |
| `task_clarification` | target -> delegator | Mid-task question | `{ taskId, question, options?, respondedBy }` |
| `task_clarification_response` | delegator -> target | Answer to question | `{ taskId, answer, answeredBy }` |
| `task_completion` | target -> delegator (via dispatcher) | Work done | `{ taskId, summary, artifacts }` (existing) |
| `task_failure` | target -> delegator (via dispatcher) | Work failed | `{ taskId, reason, partialResults }` (existing) |
| `task_timeout` | system -> delegator | Patience expired | `{ taskId, estimate, elapsedMs }` (existing) |

All signal types follow the `task_*` naming pattern. New types: `task_counter_proposed`, `task_clarification`, `task_clarification_response`.

### Zod Schema for Discriminated Union on task:respond

The current schema (`respond-task.ts:17-32`):
```typescript
const RespondTaskInputSchema = z.object({
  taskId: z.string().min(1),
  response: z.enum(["accept", "reject"]),
  estimate: z.string().optional(),
  reason: z.string().optional(),
});
```

Recommended discriminated union approach:
```typescript
const AcceptResponse = z.object({
  taskId: z.string().min(1),
  type: z.literal("accept"),
  estimate: z.string().optional(),
});

const RejectResponse = z.object({
  taskId: z.string().min(1),
  type: z.literal("reject"),
  reason: z.string().optional(),
});

const CounterProposeResponse = z.object({
  taskId: z.string().min(1),
  type: z.literal("counter_propose"),
  proposal: z.string().min(1).describe("Free-text modification description"),
  reason: z.string().optional().describe("Why the original scope needs modification"),
});

const RespondTaskInputSchema = z.discriminatedUnion("type", [
  AcceptResponse,
  RejectResponse,
  CounterProposeResponse,
]);
```

**Backward compatibility note:** The current schema uses `response` field, the new schema uses `type` field. This is a BREAKING change to the tool's input schema. Since agents see the tool description and generate input dynamically, this is acceptable -- agents will adapt to the new schema on next invocation. However, any in-flight conversations that have already seen the old schema in their tool list will need the old format. The safest approach: support BOTH `response` and `type` fields during a transition period, or rename cleanly since all agents reload tools per conversation.

**Recommended:** Clean rename to `type` since tools are resolved fresh per `executeConversation()` call. No conversations persist tool schemas across pause/resume boundaries.

### task:clarify Tool Implementation

```typescript
// packages/agents/src/shared/tools/task/clarify-task.ts

const ClarifyTaskInputSchema = z.object({
  taskId: z.string().min(1).describe("The delegated task ID to clarify"),
  question: z.string().min(1).describe("The clarification question"),
  options: z.array(z.string()).optional().describe(
    "Optional structured choices when the question has discrete answers"
  ),
});
```

**Internal behavior:**
1. Look up the task to find its `parent_id`
2. Find the delegator's active conversation via `executor.findActiveForTask(parent_id)`
3. Build `task_clarification` signal with `{ taskId, question, options, respondedBy }`
4. Send signal to delegator via `executor.signal()`
5. Set `WaitForState` to wait for `task_clarification_response` (with taskId-scoped matching)

**WaitForState integration:** The `task:clarify` tool needs access to the `WaitForState` object, same as `wait_for` and `wait_for_task`. This means:
- The tool factory signature needs the `WaitForState` parameter (or access via `ToolContext`)
- The worker loop must wire the shared `WaitForState` to `task:clarify` the same way it does for `wait_for` and `wait_for_task`

**Two implementation options:**

1. **Tool sets WaitForState directly** (like `wait_for_task`): The tool sets `waitForState.triggered = true` and `waitForState.waitTypes = ["task_clarification_response"]` with `waitForState.metadata = { taskId }`. The executor intercepts this after the loop exits.

2. **Tool returns and agent calls wait_for**: The tool sends the signal and returns a result telling the agent to call `wait_for`. The agent then calls `wait_for("task_clarification_response")`.

Option 1 is cleaner (matches the decision: "asking and waiting is a single logical operation") and prevents the agent from forgetting to wait. The tool factory needs the `WaitForState` passed to it, similar to how `wait_for_task` gets it in `tool-factories.ts:337-340`.

**Implementation pattern:**
```typescript
export function createClarifyTaskTool(
  ctx: ToolContext,
  waitForState: WaitForState,
): ToolDefinition { ... }
```

The worker loop already has a pattern for wiring `WaitForState` to tools -- see `worker-loop.ts:1237-1263`. The same approach applies: resolve the tool via registry, then replace its `execute` function with one bound to the per-conversation `WaitForState`.

### wait_for_task Extension

Current `wait_for_task` types (`wait-for-task-tool.ts:73-77`):
```typescript
waitForState.waitTypes = [
  "task_completion",
  "task_failure",
  "task_timeout",
];
```

Must be extended to:
```typescript
waitForState.waitTypes = [
  "task_completion",
  "task_failure",
  "task_timeout",
  "task_clarification",
  "task_counter_proposed",
];
```

This ensures the delegator can be woken by ANY delegation-related signal. Without this, CRITICAL-1 deadlock occurs: a clarification signal arrives while the delegator is waiting for completion, but `task_clarification` is not in the types array, so the signal is rejected.

**Important nuance:** After the delegator handles a clarification (answers and re-pauses), it calls `wait_for_task` again. The tool auto-registers for all five types, so subsequent clarifications will also be matched. This is the key to enabling multi-round clarification without deadlock.

### Counter-Propose and wait_for_task Acceptance

When the delegator receives a `task_counter_proposed` signal (via `wait_for_task`), evaluates it, and decides to accept, the delegator needs to:
1. Send `task_handshake({ response: "accepted" })` to the target
2. Re-enter `wait_for_task` for completion

The cleanest approach: **`wait_for_task` auto-sends acceptance when the task is in `counter_proposed` state.** When the agent calls `wait_for_task(taskId)`:
1. Check task status. If `counter_proposed`, send `task_handshake({ response: "accepted", taskId })` to the target's conversation
2. Transition task to `active`
3. Enter the normal wait

For rejection: the delegator cancels the task (via existing tools) or re-delegates. When the task is cancelled, the target's `wait_for` timeout fires (or the cancellation signal is sent to the target).

This approach means `wait_for_task` gains a side effect (sending a signal) when the task is in `counter_proposed` state. This is acceptable because:
- It's semantically correct: calling `wait_for_task` after seeing a counter-proposal IS acceptance
- It requires no new tools
- The task status check makes it explicit (only fires for `counter_proposed` tasks)

### Task Status Transitions

Current valid transitions (`types.ts:11-17`):
```typescript
export const VALID_TRANSITIONS: Record<string, string[]> = {
  created: ["active"],
  active: ["paused", "completed", "cancelled"],
  paused: ["active", "cancelled"],
  completed: [],
  cancelled: [],
};
```

Must be extended:
```typescript
export const VALID_TRANSITIONS: Record<string, string[]> = {
  created: ["active", "counter_proposed"],
  counter_proposed: ["active", "cancelled"],
  active: ["paused", "completed", "cancelled"],
  paused: ["active", "cancelled"],
  completed: [],
  cancelled: [],
};
```

New `counter_proposed` status represents the state where a counter-proposal has been submitted but not yet accepted/rejected. Transition from `counter_proposed` -> `active` happens when the delegator accepts. Transition from `counter_proposed` -> `cancelled` happens when the delegator rejects (or the target's wait timeout fires).

**Schema change:** The `taskStatusValues` enum in `schema.ts:272-278` must add `"counter_proposed"`. This requires a database migration to add the enum value. Since the status column uses `text` with an enum constraint (not a PostgreSQL enum type), this may just require updating the Drizzle schema and the Zod validation -- no SQL migration if the column is plain `text`.

Actually, looking at the schema: `status: text("status", { enum: taskStatusValues })`. Drizzle `text` with `enum` is just a type hint -- it doesn't create a database-level constraint. So adding `"counter_proposed"` to the array is sufficient; no database migration needed.

### active_delegations Update for Counter-Proposals

The `computeUpdatedDelegations()` function in `worker-loop.ts:386-440` handles delegation tracking when signals arrive. It must be extended:

- `task_counter_proposed` signal: update the delegation entry's `handshakeStatus` to `"counter_proposed"` and store the proposal text
- When delegator accepts (via `wait_for_task`'s auto-acceptance): update to `"accepted"`

Current handling for `task_handshake`:
```typescript
if (signalType === "task_handshake") {
  if (response === "rejected") { /* remove */ }
  if (response === "accepted") { /* update status */ }
}
```

Extended handling:
```typescript
if (signalType === "task_counter_proposed") {
  // Update handshakeStatus to "counter_proposed", store proposal
}
```

### Dashboard Representation

The dashboard task detail panel (`task-detail-panel.tsx`) already shows handshake events from the timeline. Counter-proposals and clarifications will appear as new event types in the timeline:

- **Counter-proposal event:** tool.called/succeeded for `task:respond` with `type: "counter_propose"` -- the existing timeline filtering includes `task:respond` in `DELEGATION_TOOL_NAMES`
- **Clarification event:** tool.called/succeeded for `task:clarify` -- add `task:clarify` to `DELEGATION_TOOL_NAMES` set in `tasks.ts:157-162`
- **Signal events:** `signal.received` with `signalType: "task_counter_proposed"` or `"task_clarification"` -- already shown in timeline

**Minimal dashboard changes:**
1. Add `"task:clarify"` and `"task:answer"` to `DELEGATION_TOOL_NAMES` in dashboard `tasks.ts`
2. Add rendering for counter-proposal and clarification events in `task-detail-panel.tsx`
3. The `computeTreeHealth()` function may want to track counter-proposal rounds as a health indicator

### Files That Must Change

| File | Change Type | Description |
|------|------------|-------------|
| `shared/tools/task/respond-task.ts` | MODIFY | Discriminated union schema, counter_propose handling, WaitForState integration |
| `shared/tools/task/clarify-task.ts` | CREATE | New `task:clarify` tool factory |
| `shared/tools/task/answer-task.ts` | CREATE | New `task:answer` tool for delegator to answer clarifications |
| `shared/tools/task/index.ts` | MODIFY | Export new tools |
| `shared/tools/task/types.ts` | MODIFY | Add `counter_proposed` to VALID_TRANSITIONS |
| `shared/db/schema.ts` | MODIFY | Add `counter_proposed` to `taskStatusValues` |
| `framework/wait-for-task-tool.ts` | MODIFY | Add `task_clarification` and `task_counter_proposed` to types array |
| `framework/tool-factories.ts` | MODIFY | Register `task:clarify` and `task:answer` tools |
| `framework/types.ts` | MODIFY | Add new signal types to `KNOWN_SIGNAL_TYPES` |
| `framework/worker-loop.ts` | MODIFY | Wire WaitForState to `task:clarify`; extend `computeUpdatedDelegations` |
| `definitions/dev-agent/prompt.md` | MODIFY | Add negotiation personality guidance |
| `definitions/qa-agent/prompt.md` | MODIFY | Add negotiation personality guidance |
| `definitions/dev-agent/definition.yaml` | MODIFY | Add `task:clarify` and `task:answer` to tools list |
| `definitions/qa-agent/definition.yaml` | MODIFY | Add `task:clarify` to tools list |
| `dashboard/src/services/tasks.ts` | MODIFY | Add new tool names to `DELEGATION_TOOL_NAMES` |
| `dashboard/src/components/tasks/task-detail-panel.tsx` | MODIFY | Render counter-proposal and clarification events |

### Recommended Project Structure

New files only:
```
packages/agents/src/shared/tools/task/
├── clarify-task.ts          # task:clarify tool (NEW)
├── answer-task.ts           # task:answer tool (NEW -- delegator answers clarifications)
├── respond-task.ts          # (MODIFIED -- discriminated union)
├── types.ts                 # (MODIFIED -- counter_proposed status)
└── index.ts                 # (MODIFIED -- export new tools)
```

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Signal delivery | Custom cross-conversation messaging | Existing `executor.signal()` + `signalMatchesPendingWait()` | Battle-tested signal delivery with dedup, type matching, taskId scoping |
| Wait state management | New pause/resume mechanism | Existing `WaitForState` + mutable flag pattern | Executor already intercepts after loop exit; same pattern as wait_for and wait_for_task |
| Delegation context tracking | New database table | Existing `active_delegations` JSONB on conversations | Already survives history compaction, already formatted in XML for agent context |
| Task status tracking | Separate negotiation state | Existing `tasks.status` column | Just add `counter_proposed` value; no new columns needed |
| Signal dispatch on terminal | New dispatch mechanism | Existing `TaskSignalDispatcher` + `setDispatcher` callback | Already handles completion/failure; extend pattern for counter-proposal signals |

**Key insight:** This phase is primarily tool + signal work, not infrastructure work. Every mechanism needed (signal delivery, wait state, task status, delegation tracking) already exists. The work is wiring new tool inputs to existing signal outputs.

## Common Pitfalls

### Pitfall 1: CRITICAL-1 -- Clarification Deadlock from Nested Wait-For

**What goes wrong:** Target sends clarification, delegator resumes, answers, then re-pauses with `wait_for` (not `wait_for_task`). The new `pending_wait.types` doesn't include `task_completion`. Target completes but the completion signal is rejected by type mismatch. Both conversations eventually timeout.

**Why it happens:** Agents may call plain `wait_for` instead of `wait_for_task` after answering a clarification, since they're "waiting for the answer to be processed."

**How to avoid:**
- Extend `wait_for_task` types to always include `task_clarification` and `task_counter_proposed`
- Prompt guidance: "After answering a clarification, always use wait_for_task to resume waiting"
- The `task:answer` tool could auto-set the WaitForState (ask-and-wait pattern like `task:clarify`)

**Warning signs:** Conversations cycling between waiting/running more than 3 times on the same task

### Pitfall 2: Counter-Propose Creates Asymmetric Tool Availability (MINOR-2)

**What goes wrong:** Target has `task:respond` for counter-proposing. Delegator needs to accept/reject the counter-proposal but has no explicit tool for it.

**Why it happens:** The design intentionally avoids new delegator tools for counter-proposals.

**How to avoid:** `wait_for_task` auto-sends acceptance when task is in `counter_proposed` state. For rejection, delegator cancels or re-delegates. Prompt guidance makes this explicit.

**Warning signs:** Delegator stuck after receiving counter-proposal, not knowing how to respond

### Pitfall 3: WaitForState Wiring for task:clarify

**What goes wrong:** The `task:clarify` tool sets `waitForState.triggered = true`, but the WaitForState object wasn't properly wired by the worker loop. The tool's execute function operates on a default (disconnected) WaitForState, so the executor never sees the triggered flag.

**Why it happens:** The worker loop has explicit wiring for `wait_for` (line 1238-1250) and `wait_for_task` (line 1251-1263) by finding tools by name and replacing their execute functions. A new tool (`task:clarify`) needs the same wiring pattern.

**How to avoid:** Add the same replace-execute pattern in the worker loop for `clarify_task`. Or: create the tool factory to accept WaitForState as a parameter (like `createWaitForTaskTool`), and have tool-factories.ts pass it at resolve time.

**Warning signs:** `task:clarify` sends the signal but the conversation doesn't pause (continues running)

### Pitfall 4: Task Status Enum Extension

**What goes wrong:** Adding `counter_proposed` to `taskStatusValues` array in `schema.ts` without updating the Zod validation in `task-service.ts`. Or: the dashboard's health computation doesn't recognize the new status.

**Why it happens:** The status value appears in 3 places: `schema.ts` (DB type), `task-service.ts` (Zod validation), and `types.ts` (valid transitions). All three must be synchronized.

**How to avoid:** Update all three files atomically. Search for all references to `taskStatusValues` and `TaskStatusSchema`.

**Warning signs:** Task creation with `counter_proposed` status fails validation

### Pitfall 5: Clarification Answer Tool Missing from Delegation-Capable Agents

**What goes wrong:** The `task:answer` tool is created but not added to agent definitions that delegate work. Dev-agent delegates to QA-agent, QA asks a clarification, dev-agent's conversation resumes but has no tool to send the answer back.

**Why it happens:** Tool availability is declared in `definition.yaml`. Forgetting to add the new tool to all delegating agents.

**How to avoid:** Add `task:answer` to every agent that has `task:delegate` in its tools list. Currently: dev-agent and qa-agent.

**Warning signs:** Agent receives clarification signal but has no way to respond

## Code Examples

### Extending wait_for_task Types

```typescript
// packages/agents/src/framework/wait-for-task-tool.ts
// Source: current codebase + phase 80 extension

export function createWaitForTaskTool(
  waitForState: WaitForState,
): ToolDefinition {
  return {
    name: "wait_for_task",
    description:
      "Pause this conversation and wait for a delegated task to complete. " +
      "Automatically listens for task completion, failure, timeout, clarification, " +
      "and counter-proposal signals. The conversation resumes when any of these " +
      "signals arrive for the specified task.",
    inputSchema: WaitForTaskInputSchema,
    async execute(input: unknown): Promise<{ content: string; isError?: boolean }> {
      const parsed = WaitForTaskInputSchema.parse(input);

      waitForState.triggered = true;
      waitForState.waitTypes = [
        "task_completion",
        "task_failure",
        "task_timeout",
        "task_clarification",      // NEW: target asks a question
        "task_counter_proposed",    // NEW: target counter-proposes
      ];
      waitForState.reason = `Waiting for delegated task ${parsed.taskId}`;
      waitForState.timeout = parsed.timeout ?? null;
      waitForState.metadata = { taskId: parsed.taskId };
      waitForState.timeoutSignalType = "task_timeout";

      let message = `Conversation paused. Waiting for task ${parsed.taskId} to complete, fail, timeout, or send a clarification/counter-proposal.`;
      if (parsed.timeout) {
        message += ` Timeout: ${parsed.timeout}.`;
      }
      return { content: message };
    },
  };
}
```

### Discriminated Union for task:respond

```typescript
// packages/agents/src/shared/tools/task/respond-task.ts
// Source: current codebase + phase 80 extension

const AcceptResponseSchema = z.object({
  taskId: z.string().min(1).describe("The delegated task ID to respond to"),
  type: z.literal("accept").describe("Accept the delegation"),
  estimate: z.string().optional().describe(
    'Free-text estimate when accepting (e.g., "~15 minutes")',
  ),
});

const RejectResponseSchema = z.object({
  taskId: z.string().min(1).describe("The delegated task ID to respond to"),
  type: z.literal("reject").describe("Reject the delegation"),
  reason: z.string().optional().describe("Rejection reason"),
});

const CounterProposeResponseSchema = z.object({
  taskId: z.string().min(1).describe("The delegated task ID to respond to"),
  type: z.literal("counter_propose").describe(
    "Counter-propose with modified scope/approach",
  ),
  proposal: z.string().min(1).describe(
    "Free-text description of your proposed modification",
  ),
  reason: z.string().optional().describe(
    "Why the original scope needs modification",
  ),
});

const RespondTaskInputSchema = z.discriminatedUnion("type", [
  AcceptResponseSchema,
  RejectResponseSchema,
  CounterProposeResponseSchema,
]);
```

### task:clarify Tool Pattern

```typescript
// packages/agents/src/shared/tools/task/clarify-task.ts (sketch)

const ClarifyTaskInputSchema = z.object({
  taskId: z.string().min(1),
  question: z.string().min(1),
  options: z.array(z.string()).optional(),
});

export function createClarifyTaskTool(
  ctx: ToolContext,
  waitForState: WaitForState,
): ToolDefinition {
  return {
    name: "clarify_task",
    description: "Send a clarification question back to the delegating agent. " +
      "Automatically pauses this conversation until the answer arrives.",
    inputSchema: ClarifyTaskInputSchema,
    async execute(input: unknown): Promise<ToolResult> {
      const parsed = ClarifyTaskInputSchema.safeParse(input);
      if (!parsed.success) return { content: "...", isError: true };

      const deps = ctx.delegationDeps;
      if (!deps) return { content: "Delegation not available", isError: true };

      // Find delegator's conversation through task parent chain
      const task = await deps.taskService.get(parsed.data.taskId);
      if (!task?.parent_id) return { content: "No parent task", isError: true };

      const parentConv = await deps.executor.findActiveForTask(task.parent_id);
      if (!parentConv) return { content: "Delegator conversation not found", isError: true };

      // Send clarification signal
      const signal = {
        type: "task_clarification",
        data: {
          taskId: parsed.data.taskId,
          question: parsed.data.question,
          options: parsed.data.options,
          respondedBy: ctx.agentId,
        },
        message: `Clarification needed for task ${parsed.data.taskId}: ${parsed.data.question}`,
        source: `agent:${ctx.agentId}`,
      };
      await deps.executor.signal(parentConv.id, signal);

      // Auto-enter wait_for
      waitForState.triggered = true;
      waitForState.waitTypes = ["task_clarification_response"];
      waitForState.reason = `Waiting for clarification answer on task ${parsed.data.taskId}`;
      waitForState.timeout = null; // Task timeout is the bound
      waitForState.metadata = { taskId: parsed.data.taskId };

      return {
        content: `Clarification sent. Conversation paused until delegator responds.`,
      };
    },
  };
}
```

### Worker Loop WaitForState Wiring Pattern

```typescript
// In worker-loop.ts executeConversation(), after existing wait_for wiring:

// Wire task:clarify to the shared WaitForState
const clarifyToolIndex = resolvedTools.findIndex(
  (t) => t.name === "clarify_task",
);
if (clarifyToolIndex >= 0) {
  // The clarify tool needs both the WaitForState AND the delegationDeps.
  // Re-create with the per-conversation waitForState.
  const realClarifyTool = createClarifyTaskTool(toolContext, waitForState);
  const existingClarifyTool = resolvedTools[clarifyToolIndex];
  if (existingClarifyTool) {
    resolvedTools[clarifyToolIndex] = {
      ...existingClarifyTool,
      execute: realClarifyTool.execute,
    };
  }
}
```

## Agent Test Scenarios

Two new test scenarios should be added to `packages/agents/scripts/agent-tests/scenarios/`:

### Counter-Propose Scenario
- Test agents: `test-counter-propose-assigner` and `test-counter-propose-responder`
- Flow: assigner delegates, responder counter-proposes ("I can do this but need X"), assigner accepts modified scope, responder completes
- Verifies: counter-proposal signal delivered, auto-acceptance via wait_for_task, task completion

### Clarification Scenario
- Test agents: `test-clarify-assigner` and `test-clarify-responder`
- Flow: assigner delegates, responder asks clarification, assigner answers, responder completes
- Verifies: clarification signal delivered, answer signal delivered, no deadlock, task completion

## Open Questions

1. **task:answer tool naming and registration**
   - What we know: The delegator needs a mechanism to send `task_clarification_response` signals to the target
   - What's unclear: Should this be `task:answer`, `task:respond_clarification`, or something else? Should it auto-enter wait_for_task after answering (ask-answer-and-wait pattern)?
   - Recommendation: Name it `task:answer`. Have it auto-enter `wait_for_task` after sending the answer (single tool call for "answer and resume waiting"). This prevents CRITICAL-1 deadlock by ensuring the delegator always re-enters a proper wait state.

2. **Counter-proposal auto-acceptance in wait_for_task**
   - What we know: The delegator accepts a counter-proposal by calling `wait_for_task`; the system needs to signal the target
   - What's unclear: Should `wait_for_task` check task status and auto-send acceptance, or should this be a separate step?
   - Recommendation: Auto-send in `wait_for_task`. The tool already has access to `delegationDeps` (via `ToolContext`). Check task status: if `counter_proposed`, send `task_handshake({ response: "accepted" })` before entering wait. This keeps the delegator's tool surface minimal.

3. **Counter-proposal rejection mechanism**
   - What we know: Delegator can reject by cancelling the task or re-delegating
   - What's unclear: When the delegator re-delegates without explicitly cancelling, should the target's wait_for timeout fire naturally, or should the system auto-cancel?
   - Recommendation: The target's wait_for has a timeout (set during the counter-propose call). If the delegator re-delegates without cancelling, the target's timeout fires. For explicit rejection, the delegator can cancel the task (existing `executor.cancel()`). Either path terminates the target cleanly.

## Sources

### Primary (HIGH confidence)
- `packages/agents/src/shared/tools/task/respond-task.ts` -- Current respond tool schema and signal flow
- `packages/agents/src/framework/wait-for-task-tool.ts` -- Wait-for-task signal types
- `packages/agents/src/framework/signal-matching.ts` -- Signal matching with taskId scoping
- `packages/agents/src/framework/worker-loop.ts` -- WaitForState wiring, executeConversation lifecycle
- `packages/agents/src/shared/tools/task/types.ts` -- Valid status transitions
- `packages/agents/src/shared/services/task-signal-dispatcher.ts` -- Signal dispatch on terminal transitions
- `packages/agents/src/framework/conversation-executor.ts` -- Signal delivery, pending_wait handling
- `packages/agents/src/shared/db/schema.ts` -- Task/conversation table definitions
- `packages/agents/src/framework/types.ts` -- KNOWN_SIGNAL_TYPES, WaitForState interface
- `.planning/research/PITFALLS.md` -- CRITICAL-1 clarification deadlock analysis

### Secondary (MEDIUM confidence)
- `.planning/specs/2.9-platform-completion.md` -- Phase 1 requirements (NEG-01 through NEG-07)
- `.planning/phases/71-completion-signaling/71-RESEARCH.md` -- Signal infrastructure patterns from Phase 71

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new libraries, all existing infrastructure
- Architecture: HIGH -- direct codebase analysis of all touch points
- Pitfalls: HIGH -- PITFALLS.md provides thorough analysis; CRITICAL-1 is well-understood

**Research date:** 2026-02-20
**Valid until:** 2026-03-20 (stable -- no external dependencies)
