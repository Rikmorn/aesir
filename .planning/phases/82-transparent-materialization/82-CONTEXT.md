# Phase 82: Transparent Materialization - Context

**Gathered:** 2026-02-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Delegated tasks can optionally create corresponding Linear tickets, giving human operators visibility into agent-to-agent work through their existing tools. The materialization is a projection -- internal task state is authoritative. Linear is for human consumption.

</domain>

<decisions>
## Implementation Decisions

### Linear Ticket Content
- Description contains: task objective (from delegate_task description) + delegator attribution ("Delegated by {agent name}") + dashboard link for full context
- Keep OUT: negotiation history, delegation chain, token budgets, conversation IDs as prose, group membership details
- Internal correlation data (task_id, conversation_id) stored in Linear labels or custom fields -- machine-readable for webhook routing, not in description
- The issue should read like a work item a human PM would write

### Priority & Target-Specific Properties
- Priority is a target-specific property in the materialization config, set by the delegating agent
- No universal priority enum -- each target defines its own property schema
- Materialization config shape: `{ type: "transparent", target: "linear", properties: { priority: "high", labels: ["agent-delegated"] } }`
- Optional with sensible default (Medium / No Priority if omitted)

### Team Placement (Resolution Chain)
1. Explicit `teamId` in materialization properties -- agent override
2. Parent issue's team -- if triggered by work on an existing Linear issue
3. `LINEAR_TEAM_ID` -- system default (existing env var)

### Issue Hierarchy
- Parent Linear issue exists → create as sub-issue (delegation IS decomposition)
- No parent Linear issue → create as standalone in the resolved team
- Nesting depth bounded by prompt guidance -- agents default to materializing immediate decomposition; deeper delegation stays internal
- Linear handles 2-3 levels fine; beyond that, both UI and delegation chain get unwieldy

### Badging
- Auto-apply `agent-work` Linear label on every materialized issue
- Label created once in Linear (part of setup/seed), reused on all materialized issues
- Filterable -- operators can create saved views for agent work
- No per-agent labels (avoids per-agent external identity)

### Status Sync (Internal → Linear)
- Map to Linear state types (unstarted, started, completed, canceled), not state names -- team-customized workflows vary
- Only 3 key transitions synced:
  - `active` → started (agent accepted, work began)
  - `completed` → completed (done)
  - `cancelled` → canceled (work abandoned)
- Internal lifecycle noise NOT synced: created, counter_proposed, paused -- these are internal process
- Initial creation state: unstarted type (e.g., "Todo")

### Reverse Sync (Linear → Internal)
- Asymmetric by design:
  - Human cancels Linear issue → `task_cancelled` signal (mechanical, same one-cleanup-turn pattern)
  - Human marks Done → informational signal (agent decides, NOT auto-completion -- complete_task produces results/artifacts a human click doesn't)
  - Other status changes → informational only, logged as context
- Human reassigns to themselves → treat as cancellation with reason "Reassigned to {human name} in Linear" (human takeover)
- No cross-agent reassignment (all agents share one Linear identity)

### Sync Failure Model
- Internal task state is authoritative. Linear is a projection.
- Internal completion never blocked by sync failures
- Linear updates fire asynchronously (non-blocking)
- Transient failures: retry with exponential backoff (existing MCP retry pattern)
- Retries exhausted: log failure, move on -- internal state is still correct
- Same principle for both directions (internal→Linear and Linear→internal)

### Echo & Loop Prevention
- No new dedup mechanism needed. Three-layer defense from existing infrastructure:
  1. v2.8 echo elimination (actor-based filtering catches self-originated webhooks)
  2. Signal deduplicationId (e.g., `mat-{issueId}-{webhookId}`) catches race conditions
  3. Agent reasoning (a no-op signal is handled naturally)
- Materialization adapter writes correlation record at creation (MAT-06) and includes deduplicationId on sync-triggered signals

### Operator Interaction via Comments
- Human comments on materialized issues become `user_reply` signals delivered to the agent conversation
- Agent responds ON the Linear issue via Linear MCP tools -- conversation happens where the human started it
- Echo filtering for comments: same actor-based pattern prevents comment loops
- No @mention parsing or threading for v1 -- refinements when there's real usage data

### Agent Completion Summary
- Agent posts a completion summary comment on the materialized issue (via prompt guidance, not infrastructure)
- Includes: summary of work, key artifacts (PR links), notable decisions, dashboard link
- Graceful degradation if agent doesn't post -- issue still moves to Done via status sync
- Prompt guidance, not infrastructure enforcement -- matches agent-first principles

### Materialization Trigger
- Per-delegation opt-in via tool parameter: `delegate_task({ materialization: { type: "transparent", target: "linear" } })`
- Default is internal (no materialization)
- Agent decides per-delegation, guided by prompt criteria:
  - Materialize when human-initiated work where they'd want to track progress
  - Keep internal for agent-internal decomposition (sub-tasks, research, code generation)
  - Heuristic: "Would a human PM create a ticket for this?"
- No definition-level default (too coarse -- same agent may materialize some delegations but not others)

### Group Delegation Materialization
- Individual issues per task (group is a coordination construct, not a work item)
- Group-level materialization parameter (all or nothing, not per-task within group)
- Parent Linear issue exists → each task becomes a sub-issue of that parent
- No parent → standalone issues in resolved team
- All tasks in group share a label (e.g., `group-{short-id}`) for filtering
- No synthetic group issue (no clear owner, description, or completion criteria)

### Creation Failure
- Delegation proceeds even if materialization fails -- graceful degradation
- Agent receives: "Delegation created successfully. Warning: materialization failed ({reason}). Task is running as internal."
- No async retry for initial creation (context needed at creation time, unpredictable timing)
- No "re-materialize later" for v1

### Extensibility
- Build LinearMaterializationAdapter, then extract MaterializationAdapter interface from its actual public surface
- Interface is the extensibility seam (create, syncStatus, handleWebhook)
- Dispatch is a simple switch on the `target` field
- No adapter registry, config-driven dispatch, or abstract base class until second target arrives
- `target` field in materialization config satisfies MAT-05 ("without changing the delegation tool")

### Claude's Discretion
- Correlation record schema design (what fields, where stored)
- Linear API call batching strategy for group materializations
- Exact label naming and setup/seed implementation
- Dashboard representation of materialized tasks (if in scope)

</decisions>

<specifics>
## Specific Ideas

- "The Linear issue should read like a work item a human PM would write, not a system debug dump"
- "Agents operate like coworkers within existing tools" -- comments are the killer feature, conversation happens where the human started it
- "A human closing a ticket writes a resolution comment. The agent should do the same."
- Materialization decision table (from discussion):
  - Product-agent → dev-agent (feature): Transparent (human-initiated, wants visibility)
  - Dev-agent → coder (code generation): Internal (agent-internal decomposition)
  - Dev-agent → researcher (exploration): Internal (ephemeral process)
  - Product-agent → qa-agent (verification): Transparent (human cares about test outcomes)

</specifics>

<deferred>
## Deferred Ideas

- Proper human handoff via task:handoff_task -- requires human directory entries (v3.1: HUM-01-04). Current workaround: reassign-to-human treated as cancellation with descriptive reason.
- Per-agent labels in Linear (dev-agent, qa-agent) -- tempting for filtering but edges toward per-agent external identity. Dashboard is the right place for agent-level detail.
- "Re-materialize later" if Linear comes back after initial creation failure -- scope creep for v1, practical answer: transient outages are rare.
- @mention parsing and threading in comments -- refinement for when there's real usage data.

</deferred>

---

*Phase: 82-transparent-materialization*
*Context gathered: 2026-02-20*
