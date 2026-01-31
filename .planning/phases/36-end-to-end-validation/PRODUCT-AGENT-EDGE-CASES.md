# Product Agent Edge Cases

Identified during E2E validation (2026-01-31). Tracked for resolution now or in future sessions.

## High Priority

### 1. Conversation history grows unbounded
- **Status:** [x] Done
- **Component:** Orchestrator (`orchestrator.ts`)
- **Trigger:** Each workflow iteration appends user + agent messages to `conversationHistory`. After 10+ turns, history becomes a massive blob injected as the first user message.
- **Impact:** Agent's 50K token budget consumed by history alone. Later turns can't do meaningful work. With `maxIterations = 20`, this is realistic for complex clarification flows.
- **Resolution:** Implemented LLM-based compaction strategy in `compactConversationHistory()`. When history exceeds 16 messages, older messages are summarized by a fast model (haiku) into a `<conversation_summary>` block. Last 12 messages kept verbatim. Falls back to dropping older messages if the summary call fails. Full history preserved in Temporal workflow state for audit.
- **Files:** `packages/agents/src/product-agent/orchestrator/orchestrator.ts` (compactConversationHistory), `orchestrator.test.ts` (11 unit tests)

### 2. Unescaped XML in conversation history
- **Status:** [x] Done
- **Component:** Orchestrator (`orchestrator.ts`)
- **Trigger:** History injected inside `<conversation_history>` tags without escaping. User message like "I need a `<button>` component" breaks XML structure.
- **Impact:** Agent misparses history or treats user content as system instructions. Could cause unpredictable behavior.
- **Resolution:** Added `escapeXml()` helper that escapes `&`, `<`, `>` in message content. Applied via `formatMessage()` at all 5 history formatting sites (passthrough, compaction input, compaction fallback, compaction success, and the success path). Also escapes old agent phase tags in history so they aren't misinterpreted as current directives.
- **Files:** `packages/agents/src/product-agent/orchestrator/orchestrator.ts` (escapeXml, formatMessage), `orchestrator.test.ts` (6 escapeXml tests + 5 integration tests)

## Medium Priority

### 3. Router-level cancellation bypasses agent reasoning
- **Status:** [x] Done
- **Component:** Slack event handler / router / workflow
- **Trigger:** `events.ts` had `isCancellationMessage()` that pattern-matched before the message reached the agent. "wait, I want to cancel this approach but keep the feature" triggered workflow cancellation at infrastructure level.
- **Impact:** Bypassed the agent's nuanced `<cancellation_detection>` reasoning. Anti-v2.2 pattern -- semantic classification belongs to the agent, not a regex.
- **Resolution:** Removed `isCancellationMessage()` from `events.ts`. All thread replies now flow to the agent as `userReplySignal`. Also fixed a latent bug: the workflow did not handle `agentResult.phase === "cancelled"` as a terminal state (it fell through to `awaiting_reply`). Added the cancelled phase check in the workflow so agent-initiated cancellation works end-to-end. Updated router system prompt to clarify that `cancelConversation` signal is for infrastructure use only, not for Slack thread replies.
- **Files:** `packages/agents/src/product-agent/api/events.ts` (removed isCancellationMessage), `packages/agents/src/shared/temporal/workflows/product-agent-workflow.ts` (added cancelled phase handling), `packages/agents/src/shared/temporal/workflows/product-agent-workflow.test.ts` (split test into agent-initiated and signal-based), `packages/agents/src/router/system-prompt.ts` (clarified cancelConversation usage)

### 4. Thread reply before workflow fully started
- **Status:** [x] Done
- **Component:** Slack event handler (`events.ts`)
- **Trigger:** Slack delivers a thread reply before `workflow.start()` completes. Signal hits "workflow not found" and is silently dropped.
- **Impact:** Signal is silently lost. User sees no response.
- **Resolution:** Added `signalWorkflowWithRetry()` helper that retries the signal up to 2 times with 500ms → 1000ms backoff delays on "not found" errors. Total retry window is 1.5s, which covers the typical `workflow.start()` latency (<500ms). Non-"not found" errors are thrown immediately. If the workflow is still not found after retries, it's logged and treated as a completed conversation.
- **Files:** `packages/agents/src/product-agent/api/events.ts` (signalWorkflowWithRetry)

### 5. Cancel signal races with completion
- **Status:** [x] Mitigated (no code change needed)
- **Component:** Workflow (`product-agent-workflow.ts`)
- **Trigger:** Agent creates an issue (phase = "complete") but cancel signal arrives simultaneously.
- **Impact:** Originally concerned that workflow would return "cancelled" even though issue exists in Linear.
- **Analysis:** After review, this race is not possible in the current code flow. The `cancelRequested` check (line 196) only runs at the TOP of the next iteration. After an activity returns, the workflow checks `agentResult.phase` synchronously — if "complete", it returns immediately before any cancel check. Additionally, after edge case #3, `cancelConversationSignal` only comes from infrastructure actions (admin), not from thread replies, making the race window even narrower.
- **Files:** N/A (no change required)

## Lower Priority

### 6. Missing or unexpected phase tag
- **Status:** [x] Done
- **Component:** Activity (`product-agent-activity.ts`)
- **Trigger:** Agent doesn't emit `<phase>...</phase>` tag (truncated output, budget exhaustion) or emits unexpected value.
- **Impact:** Defaults to `awaiting_reply`. Workflow waits for user reply that may never come. Conversation stalls.
- **Resolution:** Added `inferPhaseFromTrace()` fallback in `extractPhase()`. When no phase tag is found, checks the execution trace: if `linear_create_issue` returned valid issue data (parseable JSON with id/identifier), infers "complete". Otherwise falls back to "awaiting_reply" (safe default). Uses the existing `extractIssueInfo()` function to determine success vs failure.
- **Files:** `packages/agents/src/shared/temporal/activities/product-agent-activity.ts` (extractPhase, inferPhaseFromTrace), `product-agent-activity.test.ts` (+4 fallback tests)

### 7. Malformed issue JSON from Linear MCP
- **Status:** [ ] Open
- **Component:** Activity (`product-agent-activity.ts`)
- **Trigger:** `linear_create_issue` MCP response format changes or returns unexpected structure.
- **Impact:** `extractIssueInfo()` returns null. Workflow thinks creation failed even though issue exists in Linear. Could cause duplicate creation on retry.
- **Fix:** Add schema validation of Linear tool results. Log warnings when expected fields are missing.
- **Files:** `packages/agents/src/shared/temporal/activities/product-agent-activity.ts` (lines 178-219)

### 8. Token budget exhaustion mid-tool-call
- **Status:** [ ] Open
- **Component:** Agent loop (`run-agent-loop.ts`)
- **Trigger:** LLM response consumes remaining budget. Next iteration detects exhaustion and terminates.
- **Impact:** If issue creation was in-flight, results are undefined. Agent may have called `linear_create_issue` but never sent Slack confirmation.
- **Fix:** Ensure wrap-up logic checks for in-flight tool results before terminating.
- **Files:** `packages/agents/src/shared/agent-loop/run-agent-loop.ts` (lines 231-240)

### 9. Activity failure misreported as timeout
- **Status:** [ ] Open
- **Component:** Workflow (`product-agent-workflow.ts`)
- **Trigger:** `runProductAgentActivity` throws (DB unavailable, MCP service down, etc.)
- **Impact:** Catch block at line 238 sets phase to "timeout". Real cause (infrastructure failure) is masked.
- **Fix:** Distinguish between activity timeout and activity error. Return different phase or include error context in result.
- **Files:** `packages/agents/src/shared/temporal/workflows/product-agent-workflow.ts` (lines 238-247)
