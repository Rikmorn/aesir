# Feature Landscape: v2.6 Unified Agent Communication (Domain-Language I/O)

**Domain:** Outbound communication abstraction, multi-channel message routing, channel-specific rendering, and reply context propagation for an agentic development platform.
**Researched:** 2026-02-08
**Overall Confidence:** MEDIUM-HIGH (multi-channel routing patterns well-established in bot frameworks; domain-language tool abstractions for agentic platforms are emerging but less standardized; channel-specific formatting is well-understood)
**Context:** v2.6 milestone -- adding symmetric outbound normalization to an existing platform that already has inbound normalizers, 34 tool factories, and a signal pipeline. Agents currently hardcode Slack for all outbound communication.

---

## Competitor/Framework Analysis

Before categorizing features, here is what production bot frameworks and agent platforms actually provide for multi-channel outbound communication.

### Outbound Message Routing Abstractions

| Framework | Outbound Model | Channel Abstraction | Reply Routing | Format Translation | Status |
|-----------|---------------|---------------------|---------------|-------------------|--------|
| **Microsoft Bot Framework** | `TurnContext.sendActivity()` -- single method sends to whatever channel the inbound activity arrived on. Activity schema carries conversation reference (channel address, service URL, conversation ID). | Activity schema is the universal message format. Bot never knows which channel it's on -- `TurnContext` handles routing. Middleware pipeline transforms outbound activities. | Automatic: outbound activity delivery info populated from inbound activity. Bot calls `sendActivity()` and the framework routes to the originating channel. No explicit reply context passing needed. | Channel adapters translate Activity objects to channel-specific payloads. Hero Cards become Slack attachments, Teams adaptive cards, etc. Channels that don't support rich content get text fallback. | Production (7+ years). Industry standard. |
| **Botpress** | Channel-specific connectors with auto-formatting. Messages authored in Markdown are translated to platform-native formats (e.g., Telegram HTML, Slack mrkdwn, WhatsApp text). | Channels represent communication mediums within a platform (group chats, DMs, threads). Integration defines which channels are available. | Conversation context tracks the originating channel. Replies route back to the same channel. | Automatic Markdown-to-platform translation per channel. Visual flow builder abstracts channel differences. | Production. 15K+ stars. |
| **Rasa** | `OutputChannel` interface with `send_text_message()`, `send_image_url()`, `send_attachment()` methods. Each channel connector implements the interface. | `OutputChannel` abstraction. Actions use `dispatcher.utter_message()` which delegates to the active channel's `OutputChannel` implementation. | Conversation tracker stores channel info. Replies go to the channel stored in the tracker. | Each channel connector handles formatting: SlackBot connector uses Block Kit, Telegram connector uses HTML, etc. Custom connectors implement `OutputChannel` for proprietary formats. | Production. 19K+ stars. |
| **Knock (Agent Toolkit)** | Workflow-based: `requireHumanInput()` triggers a notification workflow that routes to configured channels (Slack, email, SMS, push). Liquid templating per channel template. | Workflow abstraction separates content from delivery. Define content once, render per-channel via templates. Recipient preferences determine channel selection. | Approval URLs include `messageId` for correlating responses back. Webhook-based response routing. | Per-channel templates with Liquid syntax. Same content, different rendering per channel. | Production (2025). |
| **Dialogflow CX** | Response messages per-channel with automatic text fallback. Rich responses (cards, buttons, lists) defined in agent console; channels render natively or fall back to text. | Agent-level response definition. Channels consume via integration-specific fulfillment. Webhook fulfillment can return channel-specific payloads via `platform` field. | Session-based: responses route to the session's originating channel. | Platform-specific responses via `platform` field in webhook response. Default text response serves as fallback for unsupported channels. | Production (Google Cloud). |

**Key insight:** The Microsoft Bot Framework's `TurnContext` is the closest analog to Aesir's proposed `replyContext` pattern. The critical difference: Bot Framework makes the reply context completely invisible to the bot (it's infrastructure), while Aesir's spec has agents pass through an opaque `replyContext` object. This is a pragmatic compromise -- Bot Framework can hide context because it owns the entire runtime, while Aesir agents use tools and the LLM needs to carry the context between tool calls within a turn. The "opaque pass-through" design is the right trade-off for tool-calling agents.

**Confidence: HIGH** -- Bot Framework architecture verified via official Microsoft documentation. Rasa and Botpress patterns verified via official docs and GitHub repos.

### Human-in-the-Loop Approval Across Channels

| Platform | Approval UX | Channel Adaptation | Response Correlation | Status |
|----------|------------|-------------------|---------------------|--------|
| **Slack (native)** | Block Kit interactive buttons with action IDs. Immediate visual feedback on button press. Thread-aware. | Slack-only (no channel adaptation needed). Rich interactive elements. | `action_id` + `block_id` correlate button presses to original requests. `response_url` for updating the original message. | Production. |
| **Linear** | Comments on issues. No native interactive elements -- approval is textual ("approved", "looks good"). | Text-only. Users reply with approval keywords or structured responses. | Comment webhook with `issueId` correlates to the issue. No structured approval/rejection -- requires NLU classification. | Production. |
| **GitHub** | PR review system with explicit approve/request-changes/comment states. Review comments on specific lines. | Structured approval via review state. Rich diff-aware comments. | `pull_request_review` webhook with PR number and review state. Structured: no NLU needed for approve/reject. | Production. |
| **Knock** | Per-channel: Slack buttons, email links, SMS text replies. Unified workflow definition. | Channel-specific templates. Buttons on Slack, links on email, text instructions on SMS. Approval URL consistent across channels. | `messageId` in approval URL ties response to original request. Webhook notifies agent of approval/rejection. | Production (2025). |
| **Cloudflare Agents SDK + Knock** | `requireHumanInput()` pauses agent execution, sends multi-channel notification, resumes on approval webhook. | Knock handles channel-specific rendering. Agent only specifies content and urgency. | Webhook triggers agent state update. Agent SDK handles pause/resume lifecycle. | Production (2025). |

**Key insight:** The three channels Aesir targets (Slack, Linear, GitHub) have fundamentally different approval affordances. Slack has interactive buttons. GitHub has structured review states. Linear has only text comments. The denormalizer needs three distinct strategies: (1) Slack: Block Kit buttons with action callbacks, (2) GitHub: leverage PR review states when possible, fall back to PR comments, (3) Linear: text-formatted options with instructions for keyword-based responses. The `ask()` tool must gracefully degrade across these capability levels.

**Confidence: HIGH** -- All three platform APIs directly examined via existing integration code in the Aesir codebase.

### Channel-Specific Format Translation

| Source Format | Slack Translation | Linear Translation | GitHub Translation |
|---------------|-------------------|-------------------|-------------------|
| Markdown body text | Slack mrkdwn syntax (bold: `*text*`, links: `<url|text>`, code: backticks) | GitHub-flavored Markdown (Linear supports standard Markdown in comments) | Standard GitHub Markdown (native support in PR comments) |
| Interactive buttons/options | Block Kit `actions` blocks with `button` elements, styled primary/danger | Text-formatted options: "Reply 'approve' or 'reject'" with instructions | Not natively supported in PR comments. Use text-formatted options or leverage review states. |
| Status updates | Threaded reply with optional emoji indicators | Issue comment with formatted status | PR comment with formatted status |
| Escalation alerts | Channel post with urgency formatting (Block Kit sections, maybe @mentions) | Issue comment (less appropriate for escalation -- Linear is task-level, not meta-level) | Not applicable (GitHub is solution-level, not meta-level) |
| Code blocks | Triple backtick with optional language hint | Triple backtick with language hint (Markdown) | Triple backtick with language hint (Markdown) |

**Key insight:** Markdown is the natural lingua franca. Linear and GitHub both natively support Markdown in comments, so the translation layer is trivial for those channels -- pass through as-is. Slack is the outlier: it uses mrkdwn (a Slack-specific dialect) for inline formatting and Block Kit JSON for interactive elements. Libraries like `mack` (tryfabric/mack) convert Markdown to Slack Block Kit objects, which could simplify the Slack denormalizer. The asymmetry means: Slack needs the most translation work, Linear/GitHub need the least.

**Confidence: HIGH** -- Slack mrkdwn syntax verified via Slack developer docs. Linear and GitHub Markdown support verified via existing codebase usage.

---

## Table Stakes

Features users (agents and human operators) expect. Missing = the unified communication layer feels incomplete or broken.

| # | Feature | Why Expected | Complexity | Dependencies | Notes |
|---|---------|--------------|------------|--------------|-------|
| T1 | **reply() tool -- respond on originating channel** | Core value proposition. Without this, agents still hardcode Slack. Every multi-channel bot framework provides this as the fundamental abstraction. Bot Framework's `sendActivity()`, Rasa's `dispatcher.utter_message()`, Dialogflow's session-based responses all route replies to the originating channel. | Medium | replyContext propagation (T3), denormalizer (T4), Linear create_comment MCP tool (T6), GitHub create_pr_comment MCP tool (T7) | The opaque replyContext pass-through pattern (agent receives context in signal, passes it back in reply) is the pragmatic equivalent of Bot Framework's invisible TurnContext. Agent sees it as a blob, infrastructure interprets it. |
| T2 | **ask() tool -- request input with structured options** | Human-in-the-loop approvals are the primary interaction pattern. Agents already use `slack:send_approval_request` for this. The new tool must be at least as capable on Slack and extend the pattern to Linear/GitHub. Knock and Cloudflare Agents SDK both treat structured approval requests as first-class primitives. | Medium | reply() foundation (T1), Slack Block Kit button rendering, text-formatted option fallback for Linear/GitHub | The critical design decision: Slack gets interactive buttons (existing behavior preserved), Linear and GitHub get text-formatted options ("Reply 'approve' to proceed"). This is the rich-messaging-fallback pattern used by every omnichannel platform. |
| T3 | **replyContext propagation through signal pipeline** | Without this, agents have no way to know where to reply. The inbound normalizer knows the origin channel but that information is currently lost during signal delivery. This is the "plumbing" that makes reply() and ask() work. Bot Framework solves this by embedding conversation references in the Activity schema; Aesir needs the equivalent in IncomingEvent and Signal schemas. | Medium | Schema changes to IncomingEventSchema and SignalSchema, adapter updates (3 adapters), signal delivery format changes in ConversationExecutor and WorkerLoop | Three propagation points: (1) adapters attach replyContext to IncomingEvent, (2) router propagates replyContext through signal_conversation tool, (3) executor includes replyContext in signal user message. The spec's `<reply_context>` XML tag approach for embedding in user messages is practical -- LLMs handle structured XML tags well as pass-through data. |
| T4 | **Outbound denormalizer dispatch** | The symmetric counterpart to inbound normalizers. Without a denormalizer, communication tools would need to contain channel-specific logic directly, violating the abstraction. This is the equivalent of Bot Framework's channel adapters or Rasa's OutputChannel implementations. | Medium | Channel-specific handlers for Slack (existing MCP tools), Linear (create_comment), GitHub (create_pr_comment) | Pure infrastructure. Switch on `replyContext.channel`, delegate to the appropriate MCP tool call. The denormalizer does NOT interpret message content -- it translates addressing and formatting. This keeps the abstraction thin and testable. |
| T5 | **notify() tool -- broadcast without reply context** | Agents need to send messages when there's no active signal context (escalations, status updates, reminders). The current `slack:send_message` handles this but is channel-locked. Every bot framework distinguishes between reactive replies and proactive notifications. | Low | denormalizer (T4), target resolution (workspace config or hardcoded defaults) | Lower priority than reply/ask because most agent communication today is reactive (responding to signals). But escalation flows require proactive notification. The `NotifyTarget` type in the spec is simpler than `ReplyContext` because it doesn't need to reference an existing conversation. |
| T6 | **Linear create_comment MCP tool exposure** | The Linear integration already has `create_comment` implemented and tested in `packages/integrations/linear/src/mcp/tools/issues.ts`. It's registered in the MCP server tool list. The agents-side `linear-tools.ts` just doesn't include it. This is a wiring gap, not a feature gap. | Low | None -- implementation exists, needs agent-side tool definition and tool-factories.ts registration | Verified: The tool exists in the Linear MCP server, permissions are seeded for both dev-agent and product-agent. Only missing: `linear-tools.ts` factory function and `tool-factories.ts` registration. Estimated 30 lines of code. |
| T7 | **GitHub create_pr_comment MCP tool** | The GitHub integration has `addPRComment()` in `packages/integrations/github/src/operations/pull-requests.ts` using `octokit.rest.issues.createComment()`. But it's not exposed as an MCP tool. Agents cannot comment on PRs. This blocks the GitHub channel in the denormalizer. | Low-Medium | MCP server handler in github integration, agent-side tool definition, permission seeding | The operation implementation exists. Needs: MCP schema definition, MCP handler wiring, agent-side tool definition. Following the same pattern as existing GitHub MCP tools. |
| T8 | **Agent definition migration -- swap channel tools for communication tools** | Agent definitions must use `communication:reply`, `communication:ask`, `communication:notify` instead of `slack:send_message` and `slack:send_approval_request`. Without this, the abstraction exists but isn't used. | Low | All communication tools implemented and registered | Mechanical change. dev-agent: remove 2 slack tools, add 3 communication tools. product-agent: remove 1 slack tool, add 3 communication tools. The integration-specific read tools (linear:get_issue, github:get_pull_request) remain -- those aren't communication, they're data access. |
| T9 | **Agent prompt updates for domain-language communication** | Prompts currently reference `slack:send_message` and `slack:send_approval_request` by name. Must be updated to reference `communication:reply`, `communication:ask`, `communication:notify` and explain replyContext pass-through. | Low | Agent definition migration (T8) | Prompt changes follow the existing prompt guide. Key messaging: "Reply where the conversation is happening. Pass the replyContext from the signal. You don't need to know which channel." |

---

## Differentiators

Features that go beyond basic multi-channel routing. Not expected by default, but add significant value if built.

| # | Feature | Value Proposition | Complexity | Dependencies | Notes |
|---|---------|-------------------|------------|--------------|-------|
| D1 | **Semantic message formatting per channel** | The denormalizer translates not just addressing but also formatting. A `status_update` semantic type gets emoji indicators on Slack, clean formatted text on Linear, and conventional PR update formatting on GitHub. This is richer than basic text pass-through. | Medium | Denormalizer (T4), semantic type classification in MessageContent | Botpress does this automatically (Markdown-to-platform translation). The Slack denormalizer could use a library like `mack` (tryfabric/mack) for Markdown-to-Block-Kit conversion, or keep it simple with mrkdwn text. Start with text-only, add rich formatting later. |
| D2 | **Router replyContext forwarding** | The router's `signal_conversation` tool propagates replyContext from the inbound event to the signal, so agents receive it automatically. Without this, the replyContext propagation chain breaks at the router. | Medium | signal_conversation tool schema change, router system prompt update for Linear comment routing | This is identified in the spec as necessary. The router slow-path LLM must include replyContext in its signal_conversation calls. Also requires adding Linear comment routing to the router prompt (currently missing -- only Slack thread replies have the "query status -> reopen" flow). |
| D3 | **Graceful fallback when replyContext is missing** | When an agent calls reply() but has no replyContext (e.g., conversation started via Linear agent_session.created which has no comment thread), fall back to notify() on a configured default channel. | Low-Medium | notify() tool (T5), workspace or agent-level default channel config | Without this, agents that start from Linear triggers (which have no inherent reply channel -- agent sessions start from issue assignment, not a comment) would error on reply(). The fallback pattern: try replyContext -> fall back to conversation's default notify target -> fall back to workspace default channel. |
| D4 | **Multi-channel reply (replyAll)** | Agent can reply on multiple channels simultaneously. Example: reply on the GitHub PR AND update the Linear issue comment thread. Useful when PR review feedback should be acknowledged on both the PR and the issue. | Medium | Multiple denormalizer dispatch calls, multi-target addressing type | The spec mentions this as a future possibility. Current design uses separate reply() calls, which is simpler and gives the agent control. A convenience `replyAll()` could be added later if the pattern is common. Recommend deferring -- let agents call reply() twice explicitly. |
| D5 | **Conversation-level default notify target** | Store a default notification channel in conversation metadata (e.g., the Slack channel where the task was first discussed). Agents can use `notify()` without specifying a target -- the infrastructure picks the right channel. | Low-Medium | Conversation metadata schema extension, workspace config | Currently, agents would need to hardcode Slack channel IDs for notify(). A conversation-level default (set at start time from the triggering event's channel) makes notify() zero-config for the common case. |
| D6 | **Linear comment routing in router** | The router system prompt currently handles Slack thread replies (query status -> reopen if completed) but has no equivalent for Linear comments. Adding this means Linear comments on issues trigger the same reopen flow. | Low-Medium | Router system prompt update, Linear adapter enhancement for comment events | The Linear adapter already produces `issue_comment` events. The router just needs guidance on how to route them -- same pattern as Slack thread replies. This is a gap identified in the spec. |
| D7 | **Markdown-to-Slack-mrkdwn translation** | Agent messages are authored in standard Markdown. The Slack denormalizer translates bold (`**text**` -> `*text*`), links (`[text](url)` -> `<url|text>`), etc. Without this, agents must know Slack mrkdwn syntax OR accept that formatting looks slightly off. | Low | Slack denormalizer, simple string transformation or library (mack, md-to-slack) | Libraries exist: `mack` converts Markdown to Block Kit blocks, `md-to-slack` converts to mrkdwn text. For the initial implementation, simple regex transformations (bold, italic, links, code) may be sufficient. Full Block Kit conversion is a stretch goal. |

---

## Anti-Features

Features to explicitly NOT build. These seem tempting but add complexity without proportional value, or actively harm the architecture.

| # | Anti-Feature | Why Avoid | What to Do Instead |
|---|--------------|-----------|-------------------|
| A1 | **Agent-visible channel awareness** | Agents should NOT know which channel they're talking on. The entire point of domain-language communication is that agents reason about intent (reply, ask, notify) not channels (Slack, Linear, GitHub). If agents can see the channel, they'll write channel-specific logic in prompts, defeating the abstraction. | Keep replyContext opaque. Agents pass it through without inspecting it. The denormalizer handles channel-specific behavior. |
| A2 | **Block Kit construction by the LLM** | Existing code explicitly notes: "Block Kit JSON is complex to have the LLM construct correctly." Having agents build Block Kit payloads would be fragile, expensive in tokens, and error-prone. This was already a considered and rejected approach in the existing slack-tools.ts. | The denormalizer constructs Block Kit from semantic intent (ask with options -> button blocks). Agents provide text + options, infrastructure renders. |
| A3 | **Channel preference selection by agents** | Agents should NOT decide "this should go to Slack instead of Linear." Channel selection is either determined by context (reply where the human is) or by configuration (notify on the default escalation channel). Agents deciding channels recreates the current hardcoded Slack problem at a higher abstraction level. | reply() uses replyContext (infrastructure-determined). notify() uses configured targets (admin-determined). |
| A4 | **Real-time channel-switching mid-conversation** | Supporting a human starting on Slack, switching to Linear, then back to Slack within a single agent conversation. This is an omnichannel problem (Zendesk, Intercom territory) that adds massive complexity for negligible value in a developer tools context. | Each signal carries its own replyContext. If a human switches channels, the next signal will have the new channel's replyContext. The agent replies to the latest signal's channel. No state machine needed. |
| A5 | **Universal message format with full rich content** | Building a comprehensive intermediate format (cards, carousels, images, file attachments, etc.) that translates to all channels. This is what Bot Framework's HeroCard/AdaptiveCard system does, but it serves consumer chat scenarios, not developer workflow tools. | Start with text + options (for ask). Add semantic types (status_update, escalation, completion) for formatting hints. Extend only when concrete use cases demand richer content. |
| A6 | **Removing integration-specific tools entirely** | Tempting to remove `linear:get_issue`, `github:create_pull_request`, etc. and route everything through communication tools. But these are data access and action tools, not communication tools. Reading an issue or creating a branch is not "communication." | Keep integration-specific tools for data access and actions. Only replace outbound communication tools (send_message, send_approval_request, reply_to_thread). The boundary is clear: if it talks TO a human, use communication tools. If it operates on a resource, use integration tools. |
| A7 | **Bidirectional format conversion** | Converting Slack mrkdwn back to standard Markdown on inbound (or Linear Markdown to Slack mrkdwn on cross-channel). The inbound side already normalizes to plain text in signal messages. Cross-format conversion adds complexity with minimal benefit. | Inbound: human messages arrive as text (already the case). Outbound: agent writes Markdown, denormalizer translates for the target channel. One-directional translation is sufficient. |

---

## Feature Dependencies

```
T3 (replyContext propagation) ─────────┐
                                        ├──> T1 (reply tool) ──> T8 (agent definition migration)
T4 (denormalizer dispatch) ────────────┤                            │
                                        ├──> T2 (ask tool)          ├──> T9 (prompt updates)
T6 (Linear create_comment MCP) ────────┤                            │
                                        ├──> T5 (notify tool) ──────┘
T7 (GitHub create_pr_comment MCP) ─────┘

D2 (router replyContext forwarding) ──> T3 (replyContext propagation)
D3 (fallback when no replyContext) ──> T5 (notify tool) + D5 (default notify target)
D6 (Linear comment routing) ──> D2 (router replyContext forwarding)
D7 (Markdown-to-mrkdwn) ──> T4 (denormalizer dispatch)
```

**Critical path:** T3 + T4 + T6 + T7 must be complete before T1/T2/T5 can work. T6 is the easiest (wiring existing code) and should be done first. T7 requires new MCP tool implementation but the operation layer already exists. T3 and T4 are the core infrastructure.

**Natural phase boundaries:**
1. Foundation: T3 (replyContext), T6 (Linear comment exposure), T7 (GitHub PR comment)
2. Core tools: T4 (denormalizer), T1 (reply), T2 (ask), T5 (notify)
3. Migration: T8 (agent definitions), T9 (prompt updates), D2 (router forwarding), D6 (Linear routing)
4. Polish: D1 (semantic formatting), D3 (fallback), D5 (default targets), D7 (mrkdwn translation)

---

## MVP Recommendation

**Prioritize (must ship):**

1. **T6 -- Linear create_comment MCP exposure** (Low complexity, unblocks Linear channel entirely, ~30 LOC)
2. **T7 -- GitHub create_pr_comment MCP tool** (Low-Medium, unblocks GitHub channel, operation implementation exists)
3. **T3 -- replyContext propagation** (Medium, the critical plumbing, touches adapters + signals + executor)
4. **T4 -- Outbound denormalizer** (Medium, the symmetric counterpart to inbound normalizers)
5. **T1 -- reply() tool** (Medium, the core user-facing abstraction)
6. **T2 -- ask() tool** (Medium, replaces slack:send_approval_request with channel-agnostic version)
7. **T5 -- notify() tool** (Low, straightforward once denormalizer exists)
8. **T8 + T9 -- Agent migration** (Low, mechanical swap of tools + prompt updates)
9. **D2 -- Router replyContext forwarding** (Medium, makes the full round-trip work end-to-end)

**Defer to post-MVP:**

- **D1 (Semantic formatting):** Start with plain text pass-through. Add rich formatting when there's evidence agents' Markdown output looks bad on specific channels.
- **D3 (Fallback when no replyContext):** For MVP, agents that start without a reply context (Linear agent_session.created) can use notify() explicitly. Automatic fallback is a convenience.
- **D4 (Multi-channel replyAll):** Let agents call reply() twice. The convenience wrapper can come later if the pattern is frequent.
- **D5 (Default notify target):** For MVP, agents hardcode the escalation channel ID in notify() calls (already the behavior today). Workspace config is a v2.7+ concern.
- **D7 (Markdown-to-mrkdwn translation):** Slack's new Markdown block (released 2025) accepts standard Markdown and renders natively. This may make explicit translation unnecessary. Verify before building.

**Explicitly skip:**

All anti-features (A1-A7). These represent well-understood traps from bot framework ecosystems.

---

## Complexity Assessment Summary

| Feature | Implementation Effort | Risk Level | Notes |
|---------|----------------------|------------|-------|
| T6 (Linear create_comment) | 1-2 hours | Low | Wiring existing code |
| T7 (GitHub create_pr_comment) | 2-4 hours | Low | Following established MCP tool pattern |
| T3 (replyContext propagation) | 4-8 hours | Medium | Touches 3 adapters, 2 schemas, 2 executor paths |
| T4 (Denormalizer) | 4-6 hours | Low-Medium | Clean switch dispatch, well-scoped |
| T1 (reply tool) | 2-3 hours | Low | Thin wrapper over denormalizer |
| T2 (ask tool) | 3-5 hours | Medium | Slack buttons vs text fallback logic |
| T5 (notify tool) | 1-2 hours | Low | Simpler than reply (no context required) |
| T8 (Agent definitions) | 1 hour | Low | YAML changes |
| T9 (Prompt updates) | 2-3 hours | Low | Prompt text changes |
| D2 (Router forwarding) | 3-5 hours | Medium | Router prompt + tool schema change |
| D6 (Linear comment routing) | 2-3 hours | Low-Medium | Router prompt addition |

**Total estimated effort for MVP (T1-T9 + D2):** 25-40 hours of implementation.

---

## Sources

### Official Documentation
- [Microsoft Bot Framework Basics](https://learn.microsoft.com/en-us/azure/bot-service/bot-builder-basics) -- Activity schema, TurnContext, channel abstraction architecture
- [Bot Framework Activity Schema Spec](https://github.com/Microsoft/botframework-sdk/blob/main/specs/botframework-activity/botframework-activity.md) -- Canonical message format specification
- [Slack Block Kit Reference](https://docs.slack.dev/reference/block-kit/) -- Interactive element specification
- [Slack Markdown Block](https://docs.slack.dev/reference/block-kit/blocks/markdown-block/) -- Native Markdown rendering in Slack (2025)

### Agent Framework Patterns
- [Anthropic: Building Effective Agents](https://www.anthropic.com/research/building-effective-agents) -- Tool-calling agent design patterns
- [Google ADK Design Patterns](https://docs.google.com/architecture/choose-design-pattern-agentic-ai-system) -- Multi-agent communication patterns
- [Human-in-the-Loop Approval Framework](https://agentic-patterns.com/patterns/human-in-loop-approval-framework/) -- Approval gate design patterns
- [Cloudflare Agents SDK + Knock](https://blog.cloudflare.com/building-agents-at-knock-agents-sdk/) -- Multi-channel notification delivery for agent human-in-the-loop

### Format Translation Libraries
- [mack (tryfabric/mack)](https://github.com/tryfabric/mack) -- Markdown to Slack Block Kit converter
- [md-to-slack](https://github.com/nicoespeon/md-to-slack) -- Markdown to Slack mrkdwn converter
- [slack-block-builder](https://github.com/raycharius/slack-block-builder) -- Programmatic Block Kit construction

### Existing Codebase (verified by direct inspection)
- `packages/agents/src/adapters/slack.ts` -- Inbound Slack normalization (replyContext attachment point)
- `packages/agents/src/adapters/linear.ts` -- Inbound Linear normalization (replyContext attachment point)
- `packages/agents/src/adapters/github.ts` -- Inbound GitHub normalization (replyContext attachment point)
- `packages/agents/src/shared/tools/integration/slack-tools.ts` -- Current Slack tool definitions (5 tools)
- `packages/agents/src/shared/tools/integration/linear-tools.ts` -- Current Linear tool definitions (6 tools, missing create_comment)
- `packages/agents/src/shared/tools/integration/github-tools.ts` -- Current GitHub tool definitions (9 tools, missing create_pr_comment)
- `packages/agents/src/framework/tool-factories.ts` -- 34 tool registrations (pattern for adding communication tools)
- `packages/agents/src/framework/types.ts` -- SignalSchema (replyContext extension point)
- `packages/agents/src/framework/conversation-executor.ts` -- Signal delivery (replyContext injection point)
- `packages/integrations/linear/src/mcp/tools/issues.ts` -- create_comment already implemented
- `packages/integrations/github/src/operations/pull-requests.ts` -- addPRComment() already implemented
- `packages/agents/src/router/tools/signal-conversation.ts` -- Router signal tool (replyContext forwarding point)
