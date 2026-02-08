# Phase 61: Inbound Pipeline - Context

**Gathered:** 2026-02-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Thread replyContext from webhook adapters through to signal delivery. Every inbound event that can construct a replyContext includes one. The executor stores it on the conversation row and includes it in the agent's message (both start and signal paths). Adapters, IncomingEventSchema, SignalSchema, StartConversationParams, and ConversationExecutor are in scope. Router tool updates (start_conversation, signal_conversation adding replyContext params) are Phase 62.

</domain>

<decisions>
## Implementation Decisions

### Adapter extraction scope
- **Every adapter output that has enough data to construct a replyContext includes one** -- adapters normalize data, they don't classify intent. Deciding whether an event warrants a reply is the agent's job
- The only events without replyContext are ones that genuinely have no originating channel (internal signals like timeout expirations or scheduled events)
- Slack: extract `teamId` from the webhook's top-level `team_id` field. If missing (malformed webhook), omit replyContext entirely rather than falling back to config -- a wrong teamId could route to the wrong workspace
- Linear: pass through whatever the webhook provides as `issueId` (UUID or identifier like ABC-123). No normalization -- the Linear SDK and MCP tool accept both formats
- GitHub: extract `owner` and `repo` from the webhook's `repository.owner.login` and `repository.name` fields, not from env config. Webhook is the ground truth for "where did this event come from"

### Signal message format
- **XML tag format: `<reply_context>{JSON}</reply_context>`** -- LLMs are good at extracting structured data from XML tags and passing it as JSON in tool calls
- **Appended at the end of the message** after all human-readable content. Signal text comes first for comprehension, reply_context trails as metadata
- **Append to existing format, don't restructure** -- the current `buildSignalMessage` output works. Append `\n\n<reply_context>...</reply_context>` after the existing string. Minimal blast radius
- **Only append when replyContext is present** -- absence of the tag IS the signal that there's no reply address. No empty/null tags. LLMs handle absence naturally

### start() path replyContext
- **Phase 61 scope: schema + executor wiring** -- StartConversationParams gets optional replyContext field, executor stores it on the conversation row and includes it in the initial message
- **Phase 62 scope: router wiring** -- router's start_conversation tool adds replyContext to its input schema, router prompt tells the LLM to forward it
- **Same message format as signals** -- initial message appends `<reply_context>` tag at the end, identical pattern. Agent doesn't need to distinguish between initial message and signal resume
- Phase 61's start() changes are testable in isolation: call executor.start({ ..., replyContext }) directly and verify it persists and appears in the message

### Overwrite semantics
- **Column: only update when signal has replyContext** -- if signal has no replyContext, leave the existing value. The column is "last known reply address," not "this signal's reply address." A timeout signal shouldn't wipe out the Slack thread context from the original human message
- **Messages: each signal gets its own `<reply_context>` tag** -- agent sees all replyContexts in conversation history and can reply to any signal using its specific replyContext. The column is a convenience projection; message history is the complete record
- **No "channel changed" marker** -- if the conversation moves from Slack to Linear, each message has a different `<reply_context>` tag. The LLM can read the difference without infrastructure annotations. Adding markers would cross the "agents reason, infrastructure guarantees" boundary

### Claude's Discretion
- Exact implementation of the replyContext extraction helper (shared function vs inline per adapter)
- How to handle edge cases in adapter extraction (e.g., Slack events without a channel, GitHub events without a PR number)
- Whether to add a utility function for appending reply_context tags to messages

</decisions>

<specifics>
## Specific Ideas

- "The adapter's job is to normalize data, not classify intent" -- extraction scope principle
- "The column is a projection for fast access; the event log is the history" -- events as ground truth principle from design vision
- "Each signal becomes its own user message with its own <reply_context> tag" -- per-message tags preserve the full picture even when the column only stores the last
- Phase 61 changes must be testable without the router (Phase 62) -- executor.start() and signal delivery are directly callable in unit tests

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope

</deferred>

---

*Phase: 61-inbound-pipeline*
*Context gathered: 2026-02-08*
