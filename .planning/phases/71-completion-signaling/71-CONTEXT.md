# Phase 71: Completion Signaling - Context

**Gathered:** 2026-02-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Delegating agents receive reliable notification when delegated work completes or fails. Covers: multi-type wait_for, TaskSignalDispatcher, orphan handling, callback routing through tasks, and delegation context preservation on resume. Bidirectional clarification signal is deferred (ASIG-01).

</domain>

<decisions>
## Implementation Decisions

### Signal Delivery Semantics
- Queue via existing `queued_signals` on conversation row, no interruption of running loops
- Three scenarios all handled by queue-then-match: (1) target finishes before delegator calls wait_for — signal queued, wait_for finds it immediately; (2) target finishes during wait_for — signal delivered, conversation resumes; (3) target finishes during other work — signal queued, delivered when delegator next pauses
- At-most-once delivery: write completion_result to task row (the commit point), then attempt signal delivery. If delivery fails, task row is the durable safety net
- No retry infrastructure for signal delivery. Recovery path: delegator's timeout fires → delegator checks task state → finds the result
- Existing `deduplicationId` on signals remains defensive, not mandatory

### Signal Dispatch Trigger
- TaskSignalDispatcher fires from the task service layer, not individual tools or database triggers
- TaskService.update() is the single funnel for all task state changes — detect terminal transitions there
- Only dispatch for delegated tasks (those with parent_id / callback target). Root tasks completing don't signal anyone
- All code paths that can terminate a task (complete_task, handoff_task, conversation failure, timeout) go through TaskService — no missed dispatch

### Multi-type wait_for API
- Backward-compatible: accept both `string` and `string[]` for the `type` field
- Normalize to array at the tool input boundary: `types = Array.isArray(input.type) ? input.type : [input.type]`
- Internal representation always array. `pending_wait.types` column stores array in DB
- Signal matching checks membership in the types array
- Existing single-type callers (handshake, approval, user_reply) continue working unchanged

### wait_for_task Tool
- Separate tool from wait_for, not a mode/flag. Distinct input semantics (taskId vs signal types)
- Input: `taskId` (required) + `timeout` (optional)
- Auto-registers for `["task_completion", "task_failure", "task_timeout"]` with taskId-scoped matching
- Signal matching filters by `signal.data.taskId` in addition to type — agent waiting on task A doesn't wake for task B
- Safety by design: no exposed types parameter means agents cannot forget failure/timeout signals

### Signal Type Taxonomy
- `task_handshake` — accept/reject (exists from Phase 70)
- `task_completion` — task finished successfully
- `task_failure` — task failed (agent error, conversation died)
- `task_timeout` — task exceeded expected duration
- task_timeout is distinct from task_failure — the task is still running, only the patience expired

### Timeout Behavior
- Agent sets the timeout, not infrastructure. The handshake estimate is context for agent judgment, not automatic input to a timer
- Flow: delegator sees estimate in handshake signal → reasons about appropriate patience → calls wait_for_task with explicit timeout
- Infrastructure honors the timeout string exactly as today (pg-boss delayed signal via TimeoutScheduler)
- Timeout signal is notification only — never auto-cancels the delegated task. Delegator decides: keep waiting (new wait_for_task), cancel, or escalate
- Target agent continues working unaware of the delegator's timeout

### Orphan Handling
- Store + log only. No re-trigger of terminal parent conversations
- completion_result JSONB written to task row regardless of callback conversation state — work product never lost
- `signal.orphaned` event logged in agent_events for audit trail and dashboard surfacing
- No retry infrastructure for orphaned signals. Task row is the durable record; human or future conversation can query it

### completion_result Shape
- JSONB column on tasks table, written once at dispatch time
- Includes signal payload + light delivery metadata:
  ```json
  {
    "signalType": "task_completion",
    "payload": { ... self-contained signal payload ... },
    "writtenAt": "2026-02-10T15:30:00Z",
    "deliveryStatus": "delivered | orphaned | failed",
    "targetConversationId": "conv_abc123"
  }
  ```
- No retention policy — lives with the task row. Task archival (if ever needed) handles cleanup
- Dashboard queries `completion_result->>'deliveryStatus' = 'orphaned'` for health indicators

### Signal Payload Shape (self-contained)
- Common fields across all task lifecycle signals: `taskId`, `originalDescription` (from task row), `entityId`
- Per signal type:
  - task_completion: `summary`, `artifacts` (prUrl, branch, filesChanged)
  - task_failure: `reason`, `partialResults`
  - task_timeout: `estimate`, `elapsedMs`
- Excludes: full message history, knowledge references, delegation chain, handshake details
- Self-containment test: agent with fully compacted history, seeing only active_delegations + signal payload, can reason about next steps

### Delegation Context on Resume
- `active_delegations` JSONB column on conversations — tracks currently pending delegations only, not historical log
- Entry added on `task:delegate`, removed when agent processes the completion/failure/timeout signal
- Entry shape: `{ taskId, targetEntityId, description, delegatedAt, handshakeStatus, estimate }`
- Context injected as part of the wait_for/wait_for_task tool result, not as a system message
- Tool result format: `<active_delegations>` block + signal payload — agent reads top-down for full orientation
- Non-delegation signals (user_reply, etc.) also include active_delegations block so agent knows what's in flight regardless of wake reason
- Removal happens after agent processes the signal, not at delivery time — delegation is still contextually "active" until the agent acts on it

### Claude's Discretion
- Exact TaskSignalDispatcher class/module structure
- SQL migration column details for pending_wait.types and active_delegations
- How the wait_for tool result is formatted (XML vs plain text for delegation context block)
- Error handling details in signal dispatch (logging, event recording)
- Exact Zod schema for backward-compatible type field (union vs transform)

</decisions>

<specifics>
## Specific Ideas

- "The signal is a notification optimization, not the source of truth. The task row is the durable record."
- "Write the fact, then try to notify. If notification fails, the interested party discovers the fact through timeout + polling." — standard durable record + best-effort notification pattern
- Signal type taxonomy mirrors a clean set: task_handshake (existing), task_completion, task_failure, task_timeout — four types covering the full delegation lifecycle
- wait_for_task exists specifically to prevent CRITICAL-3 deadlock — making the bug structurally impossible rather than relying on agents remembering all signal types
- active_delegations removal timing: remove when agent processes the signal, not at delivery — the agent needs to see it to correlate "I delegated X → X just completed"

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 71-completion-signaling*
*Context gathered: 2026-02-10*
