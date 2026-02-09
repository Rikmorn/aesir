# Phase 63: Outbound Denormalizer - Context

**Gathered:** 2026-02-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Build a denormalizer function that translates domain-language communication into the correct integration MCP tool calls based on replyContext channel type. The denormalizer is a pure dispatch layer: it receives `{ replyContext, text }` and calls the right MCP tool with the right params. It does not own retry logic, error recovery, option rendering, or action semantics.

Phase 63 covers the denormalizer function and the three communication tools (reply, ask, notify) that call it. Tool registration in tool-factories.ts is also in scope. Agent definition/prompt changes are Phase 65. defaultNotifyTarget injection is Phase 65.

</domain>

<decisions>
## Implementation Decisions

### Denormalizer interface
- Pure function signature: `denormalize({ replyContext, text }, deps)` — no action field
- No `DenormalizeAction` type with action discriminator — reply, ask, and notify all produce the same denormalizer call
- Return type matches callMcpTool's return type directly — no wrapper type (DenormalizeResult is YAGNI)
- Denormalizer dispatches on `replyContext.channel` via exhaustive TypeScript switch
- Single info-level log per dispatch: `{ channel, tool, agentId }` — the denormalizer is the only place that knows both

### Slack dispatch
- threadTs present → `reply_to_thread`, absent → `send_message`
- No `send_approval_request` — the communication layer is purely conversational
- `send_approval_request` stays in the Slack integration registry for router/legacy paths but is never called by the denormalizer

### Linear dispatch
- All delivery → `create_comment` with `{ issueId, body }`

### GitHub dispatch
- All delivery → `create_pr_comment` with `{ owner, repo, prNumber, body }`
- `commentId` → `inReplyTo` param if present (for future inline review comment replies, deferred in v2.6)

### Fallback behavior
- reply() requires replyContext in the Zod schema — not optional, strict validation error if missing
- No conversation-level fallback, no defaultNotifyTarget fallback, no implicit recovery
- If agent calls reply() without replyContext, it gets a Zod validation error — that's a prompt issue, not a denormalizer issue
- MCP errors propagate as-is to the tool result — same as every other MCP tool in the codebase
- No denormalizer-level error wrapping, no guidance messages, no structured error types
- Unknown channel is unreachable: Zod discriminated union rejects it, TypeScript exhaustive switch catches it at compile time

### Error handling
- No retry logic in denormalizer — relies entirely on callMcpTool's existing exponential backoff (5xx/429)
- Adding retries would create retry amplification (MCP retries x denormalizer retries)
- MCP response passed through raw to the tool result — agent sees whatever the integration returned
- Errors propagate naturally; the agent reasons about failures the same way it does for any MCP tool error

### Ask rendering
- ask() renders options into text BEFORE calling the denormalizer — denormalizer never sees an options array
- Format: `- **Label**: reply "value"` per option, appended to the question text
- Options rendering is uniform across all channels (including Slack) — no interactive buttons
- MessageContent on the denormalizer interface simplifies to just `{ text: string }` (options field removed from denormalizer types)
- ask() without options degrades to plain text delivery, identical to reply() at the denormalizer level
- style field (primary/danger) removed from options — meaningless in text rendering

### Notify target resolution
- notify() requires explicit target ReplyContext in schema — no implicit resolution
- defaultNotifyTarget is a Phase 65 concern (injected into agent context from definition YAML, agent passes it explicitly)
- Denormalizer respects whatever is in the replyContext — if Slack target has threadTs, replies in thread; if not, posts to channel
- The denormalizer has no way to distinguish notify from reply (no action field), and doesn't need to

### Tool layer design
- Three tools: communication:reply, communication:ask, communication:notify
- All three call the same denormalize() function after preparing their text
- communicationAdapter follows the mcpAdapter pattern: ToolContext → CommunicationToolDeps extraction
- CommunicationToolDeps: `{ agentId, correlationId, taskId?, logger }`

### Claude's Discretion
- Exact text formatting for option lists (line breaks, markdown weight) — as long as it's clear to humans
- Whether to define a shared renderOptions() helper or inline in the ask tool
- Internal type names and file organization within the communication module

</decisions>

<specifics>
## Specific Ideas

- "The denormalizer is a thin dispatch layer — it shouldn't own resilience"
- "ask/reply/notify distinction lives in the tool layer (agent intent), not the delivery layer"
- "The ReplyContext IS the address — the denormalizer doesn't need to second-guess it"
- Spec was updated to remove Slack interactive buttons from the communication layer — send_approval_request is legacy/router only
- The denormalizer is intentionally "boring" — pure function, no state, no recovery logic, just replyContext + text → MCP call

</specifics>

<deferred>
## Deferred Ideas

- defaultNotifyTarget injection mechanism — Phase 65 (agent migration)
- Per-channel option rendering (e.g., Slack buttons) — explicitly removed, revisit only if text instructions prove inadequate
- Agent echo prevention (Linear comment filtering) — noted in spec, not Phase 63 scope
- commentId inline review comment replies — noted in ReplyContext type, deferred in v2.6

</deferred>

---

*Phase: 63-outbound-denormalizer*
*Context gathered: 2026-02-08*
