# Phase 62: Router Updates - Context

**Gathered:** 2026-02-08
**Status:** Ready for planning

<domain>
## Phase Boundary

The router propagates replyContext from incoming events through signal delivery (both fast-path and slow-path), and handles Linear comments as a routing path equivalent to Slack thread replies. This phase modifies router tools, router prompt, and fast-path routing code. It does NOT build communication tools (Phase 64), the outbound denormalizer (Phase 63), or agent prompt changes (Phase 65).

</domain>

<decisions>
## Implementation Decisions

### replyContext Forwarding

- **Infrastructure auto-injects** replyContext from the incoming event into signal_conversation and start_conversation calls as the default
- **LLM can override** via an optional top-level replyContext field on both tool schemas; LLM-provided value takes precedence over auto-injected
- **Fast-path routes** also propagate replyContext — a one-liner per fast-path branch: `incomingEvent.replyContext` passed to `executor.start()` or signal construction. Both `StartConversationParams` and `Signal` already have replyContext fields from Phase 61
- **Reopen flow**: replyContext flows through the paired signal_conversation call, not the reopen_conversation call itself. Reopen just changes conversation status; the signal carries the new event's replyContext. This means a conversation originally from Slack can be reopened via Linear and the agent replies on Linear ("classify by intent, reply by origin")
- **Injection implementation**: In each tool's `execute()` function as `const replyContext = input.replyContext ?? deps.eventReplyContext;` — not a middleware/wrapper. Only two tools need it; a shared abstraction is premature

### Linear Comment Routing

- **Same pattern as Slack thread replies**: query_conversations by correlation key, check status, signal or reopen. Not a separate flow — structurally identical
- **Correlation key**: issueId for Linear (vs threadTs for Slack)
- **No match found**: Ignore. Issues are assigned to agents through agent_session.created, not through comments. The prompt should be explicit: "If a Linear comment has no matching conversation, ignore it"
- **Agent echo filtering**: Essential to prevent feedback loops (agent comments → webhook → router → signal → agent comments again). This is NOT a Phase 62 concern — it belongs in the Linear integration layer or adapter. The integration knows its own OAuth user ID; filter by actor identity at the webhook/adapter boundary. Phase 62 should flag this as a dependency/prerequisite
- **Intent classification**: Same classification logic applies to Linear comments as Slack thread replies (approve/reject/guidance/question/abort). The classification concern is orthogonal to routing

### Router Prompt Updates

- **replyContext guidance**: Minimal — two sentences maximum. "replyContext is automatically forwarded from the incoming event to signal and start calls. You don't need to pass it. Only provide an explicit replyContext if the event lacks one and you can construct the correct channel address from conversation context." No type structure, no channel variants, no procedural if/then
- **Unified follow-up section**: Replace `<slack_thread_reply_routing>` with a channel-agnostic `<follow_up_routing>` section. One procedure for all follow-up messages (Slack thread replies, Linear issue comments, future GitHub PR comments). Correlation key lookup table by source
- **Separate routing from classification**: `<follow_up_routing>` owns "where does this go?" (query → check status → signal/reopen/ignore). `<intent_classification>` owns "what does this mean?" (approval, feedback, question). These are orthogonal concerns, cleanly separated. Kill the existing Linear-specific "derive conversationId" shortcut in the tools section
- **Generalize intent classification**: The existing `<intent_classification>` section should not be Linear-specific. Same classification applies across channels. Ensure examples and descriptions are channel-neutral

### Tool Schema Changes

- **signal_conversation**: Add `replyContext` as a separate top-level optional field (not nested in payload). Uses `ReplyContextSchema.optional()` for Zod validation of the discriminated union at the tool boundary
- **start_conversation**: Add `replyContext` as a separate top-level optional field. Critical for agents that complete without pausing — without replyContext on start, they have no way to reply to the originating channel
- **Consistency**: Top-level field matches Phase 61's IncomingEventSchema and SignalSchema placement. Payload carries signal-specific data (approved, feedback); replyContext is routing metadata. Different concerns, different fields
- **eventReplyContext in deps**: Add to `EventRouterDeps` (or the tool-construction-time context). Set when the router creates tools for a specific incoming event, alongside existing correlationId pattern

### Claude's Discretion

- Exact wording of the `<follow_up_routing>` prompt section
- Whether to add a fast-path success criterion beyond what's in the roadmap
- How to surface the agent echo filtering dependency to the planner (note in plan vs separate prerequisite)
- Exact field name in deps (`eventReplyContext` vs `incomingEventReplyContext` etc.)

</decisions>

<specifics>
## Specific Ideas

- "Classify by intent, reply by origin" — the replyContext on a reopen signal should reflect the NEW event's origin, not the original conversation's channel. A conversation started from Slack can be reopened via Linear and the agent replies on Linear
- The routing procedure should be described once, not per-channel. Adding GitHub PR comment routing later should be one bullet point in a lookup table, not a new XML section in the prompt
- The `<follow_up_routing>` correlation key table format:
  ```
  Correlation keys by source:
  - Slack thread replies: threadTs
  - Linear issue comments: issueId
  - GitHub PR comments: owner/repo/prNumber (future)
  ```
- Agent echo filtering is a cross-cutting concern across all channels (Slack already filters via Bolt; GitHub has sender.type "Bot"; Linear is the new gap from Phase 60's create_comment tool)

</specifics>

<deferred>
## Deferred Ideas

- **Agent echo filtering for Linear comments** — needed before production use of Linear comment routing. Belongs in the Linear integration layer or adapter, not the router. Phase 62 should flag as a dependency
- **GitHub PR comment routing** — follow-up messages on GitHub PRs follow the same pattern. Will be one additional entry in the correlation key table when implemented

</deferred>

---

*Phase: 62-router-updates*
*Context gathered: 2026-02-08*
