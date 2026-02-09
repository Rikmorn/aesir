# Phase 65: Agent Migration - Context

**Gathered:** 2026-02-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Migrate dev-agent and product-agent from channel-specific communication tools (slack:send_message, slack:send_approval_request) to domain-language communication primitives (communication:reply, communication:ask, communication:notify). This includes definition.yaml tool list changes, prompt.md rewrites, defaultNotifyTarget injection, enrichment.ts cleanup, and echo loop prevention in integration webhook handlers. Sub-agents (coder, researcher, tester) are not in scope -- they don't communicate with humans.

Phase 65 covers the agent-facing changes and the integration-layer echo filtering that makes them safe. The communication tools and denormalizer already exist (Phase 63). ReplyContext pipeline already flows (Phase 61).

</domain>

<decisions>
## Implementation Decisions

### Communication prompt guidance
- Semi-opaque replyContext: explain it as "the address where the human is talking to you," not its internal structure
- Constitutional constraint: "Never change your message based on what's in replyContext. Your response should read the same whether the human is on Slack, Linear, or GitHub."
- Agent should not reference the delivery channel in messages: "I've replied with my update" not "I've posted my update on the PR"
- Communication guidance woven into a "Working with humans" workflow paragraph, not a tool catalog section
- One sentence the agent must internalize: reply/ask need replyContext (from a signal), notify needs an explicit target (no signal)

### Few-shot examples
- First example shows explicit replyContext pass-through: extract JSON from `<reply_context>` tag in signal message, pass to reply() as replyContext parameter
- Subsequent examples use `<from signal>` shorthand -- agent already knows the mechanical pattern
- Reasoning in examples teaches intent (acknowledge approval, clarify scope, escalate blocker), not channel mechanics
- Product-agent: rewrite ALL examples to use reply()/ask() -- no stale slack:send_message references. The tool calls are central to product-agent's workflow patterns.

### Dev-agent prompt changes (3 Slack references)
1. `<tools>` Slack category: Replace with "Communication" -- replying, asking, notifying. Delivery follows replyContext.
2. `<constraints>` line 12 ("Send a plan via Slack"): Replace with "Present your plan using ask() and pause for their decision"
3. `<tools>` Human interaction ("Send a Slack notification first"): Replace with "Send a message first using reply() or ask()"
- Minor prompt cleanup allowed where Slack references create procedural patterns that violate PROMPT_GUIDE.md

### Product-agent prompt changes
- Remove `<slack_context>` reference from `<tools>` section -- replaced by `<reply_context>` (Phase 61 already injects it)
- Update prompt to describe `<reply_context>` (communication addressing) and `<workspace_context>` (Linear Team ID, GitHub config) as separate concerns
- Constraint: "Communicate with the user only through reply() and ask() -- text output is internal reasoning only, never user-facing"
- No change to wait_for pattern -- product-agent continues to reply/ask then wait_for as separate steps
- Product-agent does NOT get coordination:request_human_input -- current pattern is cleaner with communication abstraction

### Definition.yaml tool swaps
- Dev-agent: Remove `slack:send_message`, `slack:send_approval_request`. Add `communication:reply`, `communication:ask`, `communication:notify`.
- Product-agent: Remove `slack:send_message`. Add `communication:reply`, `communication:ask`, `communication:notify`.
- Both agents retain all integration-specific read/action tools (linear:get_issue, github:create_branch, etc.)

### defaultNotifyTarget
- NOT stored in definition.yaml -- channel IDs are deployment config, not agent identity
- Env config + framework injection: `DEV_AGENT_NOTIFY_CHANNEL`, `PRODUCT_AGENT_NOTIFY_CHANNEL` env vars (fallback to `SLACK_CHANNEL_ID`)
- Framework constructs ReplyContext from env vars + SLACK_TEAM_ID at startup, injects into agent's system prompt `<context>` block
- Both agents get defaultNotifyTarget injection (dev-agent needs it for escalation; product-agent for future-proofing)
- System prompt `<context>` survives HistoryManager compaction (system prompt isn't pruned), available from turn one and every turn
- Agent passes defaultNotifyTarget explicitly to notify() -- no tool-level auto-fill or fallback

### Enrichment.ts cleanup
- Remove `<slack_context>` block from product-agent enrichment (lines 62-73) -- redundant with Phase 61's `<reply_context>` injection
- Linear Team ID was always in `<workspace_context>`, not `<slack_context>` -- prompt just described them together. This fixes that.

### Echo loop prevention
- Integration-layer filtering only -- no adapter-level safety net
- Each integration filters by its own identity: "did I write this?"
- **Slack**: Already handled by Bolt framework's bot_id filtering -- verify, don't implement
- **GitHub**: Match `comment.performed_via_github_app.id` against Aesir GitHub App's configured App ID. Drop if match. NOT `sender.type === "Bot"` (too broad -- would filter Dependabot, Codecov, etc.)
- **Linear**: Compare comment author `user.id` against stored OAuth user ID from `linear.credentials`. Drop if match. This is the main gap -- Linear integration doesn't currently check authorship on comment webhooks.
- Echo filtering is a separate plan within Phase 65, executed BEFORE definition/prompt migration plans. Migration depends on echo filtering being in place.

### Claude's Discretion
- Exact wording of "Working with humans" paragraph (as long as it covers reply/ask/notify distinction and replyContext pass-through)
- How to structure the defaultNotifyTarget injection code (new function vs extending existing enrichment logic)
- Whether to extract common prompt patterns between dev-agent and product-agent communication sections
- Exact formatting of few-shot examples (indentation, tool call representation)

</decisions>

<specifics>
## Specific Ideas

- "Semi-opaque with constitutional constraint" for replyContext -- not hiding information, establishing what the agent should/shouldn't do with it
- One concrete example teaches the mechanical replyContext pattern; subsequent examples use `<from signal>` shorthand to keep focus on reasoning
- "Reply where they're talking to you" as the one-sentence mental model for agents
- Product-agent enrichment cleanup is a chance to fix the Linear Team ID being described alongside Slack context
- The spec says "defaultNotifyTarget in agent definition YAML" but env config + framework injection is the right mechanism -- channel IDs are deployment config that changes between environments

</specifics>

<deferred>
## Deferred Ideas

- Per-channel option rendering (Slack interactive buttons for ask) -- explicitly removed in Phase 63, revisit only if text instructions prove inadequate
- commentId inline review comment replies on GitHub -- noted in ReplyContext type, deferred in v2.6
- Workspace-level defaultNotifyTarget config -- per-agent env vars sufficient for now, move to workspace config when multi-tenancy matters
- Adapter-level echo filtering safety net -- add only if integration-layer filtering proves insufficient in practice

</deferred>

---

*Phase: 65-agent-migration*
*Context gathered: 2026-02-09*
