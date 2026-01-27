# Phase 27: Human-in-the-Loop - Context

**Gathered:** 2026-01-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Implement approval signals, feedback loops, and task completion flows. Humans can approve plans and provide feedback through Linear and Slack, with either channel resuming Temporal workflows. PR merge triggers task completion.

Phase 26 built the workflow that reaches `awaiting_approval` and posts to both channels. Phase 27 implements the signal handling that resumes workflow execution.

</domain>

<decisions>
## Implementation Decisions

### Approval Detection
- **Primary: LLM interprets intent** - Human says anything ("looks good", "go ahead", "ship it"), LLM classifies as approve/reject
- **Secondary: Button fallback** - Slack buttons available as quick shortcut
- **Both channels accept approval** - First response wins (either Slack message/button OR Linear comment/reaction)
- **Anyone can approve** - No authorization checks for now, any channel member can approve

### Cross-Channel Sync
- When approval comes from Slack, Linear issue gets:
  - Comment: "Plan approved via Slack by @user"
  - Status update (e.g., to "Executing")
- First response wins in case of conflicting signals across channels

### Approval Message Updates
- **Slack message updated in-place** after approval (removes buttons)
- Updated message shows: "Approved by @user at 2:34 PM"
- Acknowledgment added to same message: "Executing... Estimated time: ~X min"
- ETA estimation approach: Claude's discretion based on plan complexity

### Rejection & Feedback Flow
- **No modal** - User clicks Reject, then provides feedback naturally in thread
- Agent **asks immediately** after rejection: "Got it - what would you like me to change?"
- **No hard iteration limit** - LLM detects if going in circles and advises appropriately
- Revised plans stay in **Slack thread only** - Linear only gets final approved plan

### PR Feedback Handling
- **LLM classifies intent** of PR comments (actionable feedback vs question vs FYI)
- Questions answered **in PR comment** (not Slack)
- After addressing feedback, **auto re-request review** from same reviewer(s)
- If agent can't address feedback, asks for clarification in PR comment (GitHub sends notifications)
- Commit messages: LLM decides appropriate format
- Summary of changes: LLM decides, but lean towards summary for complex changes

### Completion Triggers
- **PR merge OR close** triggers completion
- Closed-without-merge: LLM interprets signals (closing comment, Linear activity) to determine if cancelled/abandoned
- Linear status updated to "Done" (but issue not auto-closed)
- No extra PR-Linear linking needed (rely on existing GitHub-Linear integration)

### Completion Notification
- Posted to **main channel** (not thread)
- Includes **full summary + stats**: what was done + files changed + lines changed + time from request to merge

### Timeout Behavior
- **24h/72h timeouts** - First reminder at 24h, workflow ends at 72h
- Reminder: Simple nudge "Plan waiting for approval for 24h. Still want to proceed?"
- Single reminder only (no intermediate reminders between 24h and 72h)
- On timeout: Workflow ends, notify in Slack, cleanup container immediately
- Container always cleaned up - can spin up fresh anytime
- Restart instructions: Claude's discretion

### Claude's Discretion
- ETA estimation method (fixed range vs based on plan complexity)
- Timeout durations for different wait states (plan approval vs PR feedback vs escalation)
- Whether timeout notification includes restart instructions
- Commit message format when addressing PR feedback
- Whether to summarize changes in PR comment after fixes
- Container cleanup timing on completion

</decisions>

<specifics>
## Specific Ideas

- Approval should feel conversational, not mechanical - LLM interprets natural language
- AB test potential: button-only vs LLM interpretation vs both
- Stats in completion notification help track agent effectiveness over time

</specifics>

<deferred>
## Deferred Ideas

- **LLM-driven architecture** - Rather than explicit event handlers, let LLM interpret any input and decide which tools to call. Would make approval/feedback handling more flexible but requires rearchitecting how events flow through the system. Captured as potential future direction.

- **Configurable timeouts** - Per-team or per-issue-priority timeout settings

- **Metrics tracking** - Time from issue to merge, revision counts, feedback iterations

- **Authorized approvers list** - Restrict who can approve plans

</deferred>

---

*Phase: 27-human-in-the-loop*
*Context gathered: 2026-01-27*
