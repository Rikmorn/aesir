# Phase 34: Smart Router - Context

**Gathered:** 2026-01-30
**Status:** Ready for planning

<domain>
## Phase Boundary

Hybrid event classification and routing. All incoming events (Slack, Linear, GitHub) flow through a single router service that decides which agent workflow to start or signal. Deterministic rules handle unambiguous events (button clicks, PR merges) with zero LLM latency. Ambiguous events (Slack mentions, Linear comments) go through an agentic loop that reasons about intent and uses tools to query/start/signal Temporal workflows.

Integration dispatcher routes are updated to point to the router.

</domain>

<decisions>
## Implementation Decisions

### Router architecture
- Unified entry point: all integrations dispatch to ONE router service (new service, port 3006)
- Hybrid dispatch: deterministic fast path for obvious events + agentic loop for ambiguous events
- HTTP gateway only -- no Temporal worker for the router itself. Router makes Temporal client calls to start/signal workflows on existing task queues (dev-agent, product-agent)
- Reliability: if router crashes mid-LLM-call, integration dispatcher retries the HTTP POST. No Temporal durability needed for sub-second routing decisions. Can revisit if reliability becomes a problem.

### Fast path (deterministic rules)
- Pattern-match on event type + payload for unambiguous events:
  - `slack.block_actions.approved` → signal dev-agent workflow with planApprovalSignal
  - `slack.block_actions.rejected` → signal dev-agent workflow with planApprovalSignal (rejected)
  - `slack.block_actions.escalation_retry` → signal dev-agent workflow with escalationResolvedSignal
  - `slack.block_actions.escalation_abort` → signal dev-agent workflow with escalationResolvedSignal (abort)
  - `github.pull_request.merged` → extract task ID from branch, signal prCompletionSignal
  - `github.pull_request.closed` → signal prCompletionSignal (closed)
  - `linear.agent_session.created` → start dev-agent Temporal workflow
- Zero LLM latency for these events -- pure rule matching

### Slow path (agentic loop)
- Ambiguous events go through `runAgentLoop()` with routing tools
- Events that need LLM reasoning:
  - `slack.app_mention.created` → Is this a product request? Which channel context?
  - `slack.message.created` in thread → Which workflow to signal? (userReplySignal to product-agent)
  - `linear.comment.created` → What's the intent? (approval, rejection, guidance, question, abort)
  - `github.pull_request.review_*` → What action to take based on review state?
  - Any unknown/new event type → LLM reasons about what to do
- Router iteration limit: 10 (should decide quickly)

### Inline reasoning for classification
- No separate `classify_intent` tool -- the LLM reads the event content and directly decides which tool to call
- The approval intent classifier from `dev-agent/classification/approval.ts` is absorbed into the router's inline reasoning
- Router system prompt includes guidance on intent patterns (approval, rejection, guidance, etc.)
- Tool calls are the observable output -- traces show what the router decided

### Cancellation detection stays with the agent
- Router does NOT detect cancellation intent in thread messages
- Router sends `userReplySignal` for all thread messages to existing workflows
- The product agent detects cancellation via LLM reasoning (already implemented in Phase 33 with `<cancellation_detection>` in system prompt)
- Principle: router makes routing decisions, agents make content decisions

### Integration rewiring
- All 3 integration dispatchers (Slack, GitHub, Linear) updated to dispatch events to the router service
- Current fixed routes (`app_mention → product-agent:3005`, `block_actions → dev-agent:3004`) replaced with unified route to router
- This is included in Phase 34 (not deferred to Phase 35) so the router is testable end-to-end

### Router tools
- `query_running_workflows(taskId?)` → list active workflow IDs and their state
- `start_workflow(agentType, input)` → start a Temporal workflow on the appropriate task queue
- `signal_workflow(workflowId, signal, payload)` → send signal to existing workflow
- `send_message(channel, text)` → for sending clarification or error messages via Slack

### Claude's Discretion
- Router model selection (Haiku vs Sonnet for the LLM path) -- evaluate based on classification accuracy vs latency
- Exact deterministic rule set -- which events are fast-path vs slow-path based on actual event analysis
- Router system prompt design -- what guidance helps the LLM make accurate routing decisions
- Error handling specifics -- how to alert when routing fails (ROUT-06 requires events are never silently dropped)
- Router HTTP service setup -- Express patterns, health check, env validation

</decisions>

<specifics>
## Specific Ideas

- "Focus is on capability and intelligence. Give them the tools instead of trying to predict." -- Router should be intelligent, not a glorified switch statement
- "A bit like Claude Code -- it can decide what to do, use available tools, delegate to an agent" -- Router reasons about events the way Claude Code reasons about user requests
- The spec's architecture diagram shows the router sitting above both agents -- it's the front door
- Phase 33's cancellation detection already proves the "agent decides" pattern works for content decisions

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope.

</deferred>

---

*Phase: 34-smart-router*
*Context gathered: 2026-01-30*
