# Phase 57: Conversation Reopening - Context

**Gathered:** 2026-02-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Enable completed or failed conversations to receive a reopen signal and re-enter the work loop with awareness of what changed since they last ran. Only the `reopen` signal type triggers this transition. Dashboard provides manual trigger; no automatic reopening. Cancelled is not a conversation status and is not in scope.

</domain>

<decisions>
## Implementation Decisions

### Reopen Signal Design
- Signal payload is `reason: string`, required, non-empty -- free text, not structured delta
- Reason serves both retry (failed) and reopen (completed) cases naturally -- "GitHub API was down, retry" vs "PR #42 received changes requested review"
- Single API endpoint: `POST /conversations/:id/reopen` with `{ reason: string }` body
- Endpoint rejects non-terminal conversations with 400 (only completed and failed are reopenable)
- Race condition on simultaneous reopens handled by database -- first request transitions status, second finds non-terminal and gets 400

### World-State Injection
- Injected as a **user message** appended to conversation history (not system prompt modification)
- Creates a clean boundary in history: everything before is the previous run, everything after is the reopened run
- Format:
  ```
  <world_state>
  This conversation was reopened. Context: {reason}

  The world may have changed since you last acted. Verify the current state of any artifacts you previously created before taking new actions.
  </world_state>
  ```
- Forces explicit agent acknowledgment -- agent's first action is to process the world_state and verify artifact state

### Agent Prompt Constraint
- Add constitutional constraint to product-agent and dev-agent prompts **in this phase** (ships with the feature, not deferred to Phase 59)
- Constraint: "When resuming a previous conversation, verify the current state of any artifacts you previously created before acting on them."
- Small, mechanical addition to constraints section -- not a prompt rewrite

### Dashboard Reopen UX
- Reopen/Retry button in the **top action bar** of conversation detail view (like GitHub's "Reopen issue" placement)
- Dashboard shows "Retry" label on failed conversations, "Reopen" on completed ones -- same endpoint underneath
- Reopen count badge visible on conversation card and detail view (e.g., "Reopened 2x")

### Claude's Discretion
- Interaction flow for the reopen button (inline text field vs modal dialog)
- Post-reopen navigation behavior (stay on detail view vs navigate to list)

### History and Resumption Behavior
- No special history handling on reopen -- HistoryManager runs as normal with its existing threshold logic
- Short conversations get full history, long ones get compacted -- HistoryManager doesn't know or care about reopening
- **Reset all execution limits on reopen**: iteration count, token budget, and retry count all reset to definition YAML defaults
- A reopened conversation is a new run with prior context -- needs full budget to verify state, reason about changes, and act

### Reopen Tracking
- Add `reopen_count` column to conversations table (integer, default 0, increment on each reopen)
- `reopen_count` is separate from `retries` -- reopen is manual/deliberate, retry is automatic/framework
- Retry count resets on reopen (new run gets fresh retry attempts)
- **Defer threshold warning UX** -- ship the counter, defer the "consider starting fresh" warning until real usage data exists

### Signal Dedup and Edge Cases
- Cap `delivered_signal_ids` at 100 entries with FIFO eviction on insert (drop oldest when adding entry #101)
- Single JSONB operation on insert, no background jobs
- `agent.reopened` event type emitted to event log (REOPEN-09) -- visible as boundary marker in dashboard timeline between previous and reopened run

</decisions>

<specifics>
## Specific Ideas

- Dashboard reopen button should require a meaningful reason -- text field with placeholder like "What changed since this conversation completed?" rather than a bare button with no context
- The `agent.reopened` event in the timeline should visually separate the previous run from the reopened run -- a clear boundary marker
- Retry (failed) and reopen (completed) are different UX labels but identical system behavior -- the agent knows which case it's in from its own conversation history

</specifics>

<deferred>
## Deferred Ideas

- Reopen threshold warning ("This conversation has been reopened 3+ times, consider starting fresh") -- defer until real usage data shows whether this is a problem
- Cancelled conversation status and manual abort mechanism -- separate feature, not in v2.5 scope
- Automatic reopening from event routing -- Phase 58.4 creates new conversations within tasks, not reopens of existing ones

</deferred>

---

*Phase: 57-conversation-reopening*
*Context gathered: 2026-02-06*
