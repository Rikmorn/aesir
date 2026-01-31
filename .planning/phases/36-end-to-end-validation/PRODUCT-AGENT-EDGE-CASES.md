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
- **Status:** [ ] Open
- **Component:** Slack event handler / router
- **Trigger:** Router has `isCancellationMessage()` that pattern-matches before the message reaches the agent. "wait, I want to cancel this approach but keep the feature" triggers workflow cancellation at infrastructure level.
- **Impact:** Bypasses the agent's nuanced `<cancellation_detection>` reasoning. Anti-v2.2 pattern -- semantic classification belongs to the agent, not a regex.
- **Fix:** Remove `isCancellationMessage()` from router. Let all thread replies flow to the agent. The agent already handles cancellation detection via prompt.
- **Files:** Slack event handler (check `isCancellationMessage` function location in router/events code)

### 4. Thread reply before workflow fully started
- **Status:** [ ] Open
- **Component:** Slack event handler / router
- **Trigger:** Slack delivers a thread reply before `workflow.start()` completes. Router tries to signal a non-existent workflow.
- **Impact:** Signal is silently lost. User sees no response.
- **Fix:** Add retry-with-backoff on "workflow not found" when signaling replies, or queue the signal.
- **Files:** Slack event handler (workflow signal code)

### 5. Cancel signal races with completion
- **Status:** [ ] Open
- **Component:** Workflow (`product-agent-workflow.ts`)
- **Trigger:** Agent creates an issue (phase = "complete") but cancel signal arrives simultaneously. Workflow checks `cancelRequested` (line 196) BEFORE checking agent phase (line 269).
- **Impact:** Workflow returns "cancelled" even though issue exists in Linear. External systems don't know the issue was created.
- **Fix:** Check agent phase result before cancel flag, or add "complete takes precedence over cancel" rule.
- **Files:** `packages/agents/src/shared/temporal/workflows/product-agent-workflow.ts` (lines 196, 269)

## Lower Priority

### 6. Missing or unexpected phase tag
- **Status:** [ ] Open
- **Component:** Activity (`product-agent-activity.ts`)
- **Trigger:** Agent doesn't emit `<phase>...</phase>` tag (truncated output, budget exhaustion) or emits unexpected value.
- **Impact:** Defaults to `awaiting_reply`. Workflow waits for user reply that may never come. Conversation stalls.
- **Fix:** Add fallback reasoning -- if no phase tag and agent called `linear_create_issue` successfully, infer "complete". If no tools called, infer based on last Slack message content.
- **Files:** `packages/agents/src/shared/temporal/activities/product-agent-activity.ts` (lines 130-151)

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
