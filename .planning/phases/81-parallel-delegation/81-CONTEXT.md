# Phase 81: Parallel Delegation - Context

**Gathered:** 2026-02-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Fan-out delegation with policy-driven completion semantics. Orchestrator agents create groups of parallel tasks with configurable completion policies, get signaled based on policy satisfaction, and manage group lifecycle (status, cancellation). Each delegation within a group runs as an independent conversation with full negotiation support.

</domain>

<decisions>
## Implementation Decisions

### Tool interface design
- Single atomic `delegate_group` tool call with all tasks defined inline — not a group-then-add pattern
- Atomic creation: if any task fails validation (bad agentId), the entire group fails — no partial-state groups
- Schema accommodates both `agentId` and `capability` per task (exactly one required, Zod refinement). `capability` returns a clear error until Phase 85 ships
- Response: human-readable string with groupId + per-task taskId mapping (title + agent). No echoed descriptions
- Separate `wait_for_group({ groupId })` tool for waiting on group completion
- Groups are immutable after creation — no adding tasks to existing groups. Re-delegation uses standalone `delegate_task` or fresh `delegate_group`

### Completion policies
- Three policies: `all_required`, `any_sufficient`, `min_required(N)` — replaces the spec's `majority` with an explicit threshold
- `all_required` and `any_sufficient` are named shortcuts for common cases; `min_required(N)` covers everything in between
- The delegator sets the threshold explicitly — no ambiguous "majority" semantics

### Wake-up rules (per policy)
- `all_required`: first failure or rejection wakes the delegator immediately (policy broken)
- `min_required(N)`: wake only when `(total - failed - rejected) < N` — policy becomes unsatisfiable
- `any_sufficient`: wake only when all tasks have failed — no remaining task can satisfy
- Policy satisfaction (happy path) wakes the delegator for all policies
- Counter-proposals and clarifications always wake the delegator regardless of policy
- Triggering result delivered in the signal; other results available via `group_status`

### Signal content
- State and context, not suggested actions — agent reasons about next steps (agent-first principle)
- Failure signals include: policy assessment, per-task failure reasons, current group state (completed/failed/running counts), completed task summaries
- Summaries keep signals lightweight; full results via `group_status` tool

### Timeouts
- Both group-level and per-task timeouts supported; whichever fires first wins
- Per-task timeout is inherited from existing delegation behavior — unchanged
- Group-level timeout is new: caps total wall time for the fan-out operation
- Per-task timeout is optional within groups; group timeout is the primary bound
- Group timeout fires → all remaining tasks cancelled, delegator wakes with group context

### wait_for_group re-entry
- Optional `until` parameter: `"policy"` (default) or `"settled"`
- `until: "policy"`: wake on policy satisfaction, unsatisfiability, counter-proposals, clarifications
- `until: "settled"`: wake only when all tasks reach terminal state (completed/failed/cancelled), plus counter-proposals and clarifications
- `"settled"` mode prevents noisy re-wakes when the delegator has already handled a failure and wants to collect remaining results

### Negotiation within groups
- Full Phase 80 negotiation support per task — counter-propose and clarify work identically in groups
- Groups are a delegator-side abstraction; target agents don't know they're in a group
- Counter-proposals and clarifications are handled per-task while waiting on the group — same multiplexing pattern as failure handling

### Cancellation behavior
- `cancel_group` sends `task_cancelled` signal to each running task (not immediate termination)
- Agent gets one cleanup turn after receiving `task_cancelled` — enough to save artifacts, add comments, mark status
- After cleanup turn, conversation terminates (status: cancelled)
- Cascading: cancelled tasks' own sub-agents and delegations also receive `task_cancelled` with one-turn cleanup
- This cancellation pattern applies to all delegation (standalone and group), not just groups
- Residual tasks keep running after policy satisfaction — delegator decides whether to cancel or collect via `cancel_group` or `wait_for_group({ until: "settled" })`

### Group status tool
- `group_status` shows all tasks including cancelled ones — numbers always add up
- Completed tasks: results (from `complete_task`). Failed: failure reasons. Cancelled: status only (no formal result)
- Displays policy, satisfaction state, and per-task breakdown

### Dashboard representation
- Extend existing delegation graph (React Flow) — group as a distinct node type with policy badge and progress indicator
- Per-task status indicators on child nodes (completed, failed, running, cancelled)
- State coloring on group node: green (satisfied), yellow (in progress), red (unsatisfiable)
- No separate group management page, timeline view, or group comparison view

### Claude's Discretion
- Data model design for groups (DB schema, JSONB vs relational)
- How group timeout interacts with pg-boss scheduling
- Exact signal type naming for group events
- Dashboard group node styling and layout within React Flow

</decisions>

<specifics>
## Specific Ideas

- `delegate_group` response should follow existing `content: string` tool result pattern — human-readable with structured info:
  ```
  Group created (groupId: grp-abc123) with 3 tasks:
  - task-1: "Research API v2" -> researcher
  - task-2: "Research API v3" -> researcher
  - task-3: "Research competitors" -> researcher
  Policy: any_sufficient. Call wait_for_group({ groupId: "grp-abc123" }) to wait for results.
  ```
- Failure signal should include group context so the agent can decide without a separate `group_status` call:
  ```
  Task task-3 failed in group grp-abc123: "Agent rejected - no access to private repo"
  Group state: 2 completed, 1 failed, 2 running. Policy: all_required (no longer satisfiable).
  ```
- `task_cancelled` signal follows the same lifecycle pattern as existing `task_timeout` — agents receive signals, not kills

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 81-parallel-delegation*
*Context gathered: 2026-02-20*
