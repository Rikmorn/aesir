# Phase 67: Linear Agent SDK - Context

**Gathered:** 2026-02-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Migrate the Linear integration from comment-based communication to Linear's native Agent SDK. Agents get their own identity (`actor=app`), typed activities replace comments, echo filtering is eliminated by design, and OAuth tokens refresh automatically. Product-agent's comment-based flow (no agent session) continues to work alongside the new activity-based flow.

</domain>

<decisions>
## Implementation Decisions

### Activity presentation
- Communication tool intents map to Linear activity types:
  - `reply` → `response`
  - `ask` → `elicitation`
  - `notify(reasoning)` → `thought`
  - `notify(action)` → `action`
  - Infrastructure-emitted → `error` (on conversation failure)
- Thoughts are **explicit only** — the agent decides when to surface thinking via `notify(reasoning)`. No auto-emission from `<reasoning>` blocks. The infrastructure does not inspect agent output to emit activities.
- Action activities are **explicit only** — the agent judges which actions are worth surfacing (e.g., "Created branch feature/auth") via `notify(action)`. Infrastructure does not auto-detect tool calls.
- The 10-second initial thought on session creation is a **generic acknowledgment** (e.g., "Processing your request..."). No payload parsing, no dynamic context. Infrastructure owns this lifecycle event.
- On conversation failure, the **executor emits an error activity** with a brief message (e.g., "Token budget exhausted") before updating session state to `error`. Infrastructure owns lifecycle boundaries.
- Principle: Infrastructure owns two moments (session creation acknowledgment, session failure notification). Agent owns everything in between.

### Migration cutover
- **Hard cutover, no feature flag.** Deploy `actor=app` + activity tools + echo filter removal in one release. Old comment-based code is deleted.
- **No rollback path.** If something breaks, fix forward or revert the commit. Dev system, low risk.
- **OAuth re-auth is manual.** Update the OAuth flow to request `actor=app` + new scopes (`app:assignable`, `app:mentionable`). Re-authorize through Linear's OAuth flow after deployment. No migration script.
- **In-flight conversations break.** Accept breakage for conversations in `waiting` state from before the cutover. They can be re-triggered.
- **Agent name/avatar** configured in the Linear developer portal (OAuth app settings), not via API. Update portal settings before re-auth.

### Token refresh behavior
- **Dual-layer refresh:** proactive (setInterval at 80% token lifetime ~19h) + reactive (401 triggers immediate refresh + retry of failed request).
- **Proactive timer:** Simple `setInterval` in the Linear integration service. No pg-boss. On service restart, the interval restarts and reads expiry from DB. If the token expired during downtime, the reactive 401 path catches it.
- **Refresh failure handling:** The middleware retries the refresh a couple times with backoff. If all attempts fail, the MCP tool call returns an error to the agent. The agent decides what to do (retry, skip Linear, fail). No queuing of operations hoping the token comes back.
- **Revoked token alerting:** When refresh fails with a non-transient error (revoked, `invalid_grant`), log at ERROR level with clear message ("Linear refresh token revoked — manual re-authorization required") and emit a Slack notification to the ops channel. This doesn't recover on its own — proactive alerting prevents hours of silent failure.

### Agent Plans (LSDK-08)
- **Cut from Phase 67.** Agent Plans (checklist-style progress in Linear UI mapped from task steps) is deferred to the backlog. Focus on core SDK migration.

### Claude's Discretion
- Exact wording of the generic 10-second acknowledgment thought
- Whether to investigate API-driven agent name/avatar as a bonus (portal config is the primary path)
- Error message wording for the error activity on conversation failure
- Retry count and backoff timing for token refresh middleware

</decisions>

<specifics>
## Specific Ideas

- The `notify(action)` → `action` mapping fills a gap in LSDK-05's original mapping. Research should verify Linear's `action` activity type behavior and rendering in the issue sidebar.
- Product-agent continues using `create_comment` for Linear issue comments (no agent session context). The denormalizer checks `replyContext.agentSessionId`: present → activity tools, absent → comment tools. Both paths coexist per spec resolution.
- Session lifecycle mapping (already resolved in spec): `queued`→`pending`, `running`→`active`, `waiting`→`awaitingInput`, `completed`→`complete`, `failed`→`error`.

</specifics>

<deferred>
## Deferred Ideas

- **Agent Plans (LSDK-08):** Checklist-style progress in Linear UI mapped from task steps. Cut from v2.7 Phase 67. Add to backlog for future phase.
- **API-driven agent identity:** Investigate whether the Linear API supports setting agent display name and avatar programmatically (in addition to portal config). Nice-to-have, not blocking.

</deferred>

---

*Phase: 67-linear-agent-sdk*
*Context gathered: 2026-02-10*
