# Phase 76: Runtime Resilience - Context

**Gathered:** 2026-02-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Close the loop between failure observation and recovery. When a conversation fails, the system notifies the originating channel, classifies MCP errors for agent decision-making, injects recovery context on crash resume, and drains gracefully on shutdown. This phase does NOT add new notification channels, dashboard rendering (Phase 77), or work correlation (Phase 78).

</domain>

<decisions>
## Implementation Decisions

### Failure notifications

- **Trigger:** Terminal `failed` status only — when conversation reaches final failed state and will not be retried. No notifications during retry attempts or stale heartbeat re-enqueue (infrastructure self-healing).
- **Target:** Originating channel only — whichever channel is in `reply_context` on the conversation row. Slack thread, Linear issue, or GitHub PR comment. No broadcast to a central alerts channel.
- **No reply_context:** Log it and move on. Dashboard is the only visibility. Don't invent a fallback channel for this edge case.
- **Content always includes:**
  - Agent name (which agent failed)
  - Failure reason — classified: token budget exhausted, max iterations, MCP retries exhausted, agent aborted, unhandled exception. One line, not a stack trace.
  - Retry count — "failed after 2/2 retries" or "failed (non-retryable)" — distinguishes retry-exhausted from non-retryable (different investigation paths)
- **Content when available:**
  - Task context — if conversation has a task_id, include task title/identifier
  - Conversation ID — for log correlation
- **Don't include:** Stack traces, full message history, dashboard links (URL structure could change; conversation ID is enough to find it)
- **Format:** Plain text with light markdown (bold, newlines). Not Slack blocks, not channel-specific rich formatting. Passed through the existing denormalizer. Notifications run when something is already wrong — simplest possible code path.
- **Notification delivery failure:** Emit `notification.failed` event, log it. Dashboard surfaces it. No secondary channel fallback.

### MCP error handling

- **Classification:** HTTP status code is the boundary.
  - Permanent (4xx: 400, 401, 403, 404, 422) → return to agent immediately
  - Transient (429, 5xx) → infrastructure retries transparently
  - Network errors → transient (2-3 quick retries; container restart on Docker network resolves in seconds)
- **Retry policy (all transient classes, one policy):**
  - Max attempts: 3 total (initial + 2 retries)
  - Backoff: Exponential — 1s, 2s, 4s (multiplier 2x)
  - Jitter: Full jitter (randomize between 0 and calculated delay)
  - Max delay cap: 10 seconds per attempt
  - 429 with Retry-After: Respect header up to max delay cap. If server says >10s, return error to agent immediately — don't block a worker slot.
- **Retry location:** `callMcpTool` (shared MCP client layer). One place, one policy. No per-tool retry implementations. If a specific tool genuinely can't be retried, add a `retryable: false` flag on call options — still handled in callMcpTool.
- **Permanent error response shape (tool result, not exception):**
  ```json
  {
    "error": true,
    "status": 404,
    "tool": "linear:get_issue",
    "message": "Issue LIN-456 not found",
    "params": { "issueId": "LIN-456" }
  }
  ```
  - `error: true` flag for agent distinction. Key parameters only (not full payload). No stack traces, no HTTP headers.
- **Transient-exhausted error response includes:** Total attempts made, total time spent retrying, final status code or error type, original tool name.

### Recovery context

- **Checkpoint boundary:** `last_persisted_sequence` integer column on conversation row. Updated atomically with message persistence (same UPDATE). On resume, query events WHERE sequence > last_persisted_sequence.
- **Recovery window events to include:**
  1. Sub-agent completions (`agent.completed` with parent_instance_id) — most important; re-spawning is the most expensive mistake. Include agent role + truncated output preview (~200-300 chars).
  2. Successful tool calls (`tool.succeeded`) — especially write operations. Include tool name + key output (PR URL, issue ID).
  3. Failed tool calls (`tool.failed`) — include tool name + error message. Prevents rediscovering the same failure.
  4. Signals received (`signal.received`) — include signal type + data. Prevents waiting for already-arrived signals.
- **Skip:** `tool.called` (redundant), `llm.response` (agent re-reasons), `agent.started` (not actionable without completion)
- **Output truncation:** Cap each entry's output preview at 200-300 characters. Recovery context tells what happened, not every detail.
- **No event count cap:** Recovery window is bounded by one agent loop iteration (typically 5-15 tool calls).
- **Injection method:** User message, following existing pattern for `<task_context>` and `<active_delegations>`. Ordering: task context first, active delegations, recovery context last (most immediately actionable), then resume instruction.
- **Retry awareness in recovery block:**
  - Include current retry number and max retries ("retry 1 of 2" or "retry 2 of 2 (final attempt)")
  - Include failure reason from previous attempt ("interrupted: stale heartbeat" or "interrupted: unhandled exception")
  - Facts only, no behavioral prescriptions. Agent reasons about retry state naturally.
- **First-iteration crash (no checkpoint):** `last_persisted_sequence` is null/0. Recovery window is the entire event log for that conversation. Fine — it's short.

### Graceful shutdown

- **Drain timeout:** 30 seconds default (configurable via existing `config.service.forceShutdownTimeoutMs`). Enough for most LLM calls to complete. Orchestrator (Docker/K8s) grace period should match.
- **Goal:** Finish the current agent loop iteration and persist messages, not the entire conversation. Conversations resume later via stale heartbeat + recovery context.
- **Stop immediately on SIGTERM (before drain wait):**
  - HTTP server (`server.close()`) — stop accepting requests
  - SSE connections (`sseManager.closeAll()`) — clients reconnect to another instance
  - pg-boss — stop scheduling/processing background jobs
  - Knowledge cleanup timer
- **Stay open during drain:**
  - In-flight agent loop iterations — the only thing worth waiting for
  - Event log — in-flight iterations write events that recovery context reads
  - Database pool — needed for message persistence. Closes last.
- **Overflow (conversations don't finish in 30s):**
  - Abandon them. Worker exits, stale heartbeat detector picks them up. Same recovery path as worker crash — by design.
  - Log abandoned conversations at warn level (conversation IDs, agent names)
  - Flush event log before exit
  - Don't update conversation status or release locks — let heartbeat detector handle it
  - Don't mark as failed (they're interrupted, not terminal), don't send notifications
- **Observability:**
  - Log on SIGTERM: `info { drainingConversations: N, conversationIds: [...] } "Graceful shutdown initiated, draining"`
  - Health endpoint returns `{ status: "draining", inFlight: N }` with 503 during drain (uses existing `isShuttingDown` state)
  - No dedicated drain endpoint, no periodic drain status logs, no SSE events for drain state

### Claude's Discretion
- Exact event log query strategy for recovery context (sequence range query vs type-filtered query)
- How to handle the edge case of a sub-agent that started but hasn't completed (mention in recovery context or omit)
- Notification message template wording (exact phrasing of the plain text message)
- Whether to add a brief `<recovery_context>` mention to agent system prompts so they understand the block when they see it

</decisions>

<specifics>
## Specific Ideas

- Failure notification should follow the existing `sendRoutingAlertV2` pattern in router.ts — plain text, "check logs" approach
- MCP error classification follows HTTP semantics strictly — 401 is permanent because integration handles OAuth refresh internally
- Recovery context follows the `<task_context>` / `<active_delegations>` XML block pattern already used in resume messages
- Graceful shutdown leverages the existing shutdown sequence in main.ts (lines 380-430) — mostly confirming/extending existing order
- "The two features work together" — shorter grace period is acceptable because recovery context makes interruptions cheap

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 76-runtime-resilience*
*Context gathered: 2026-02-16*
