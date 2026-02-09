# Requirements: Aesir v2.6 Unified Agent Communication

**Defined:** 2026-02-08
**Core Value:** End-to-end automated development workflow where agents handle routine development tasks while humans focus on high-value decisions and reviews.

## v2.6 Requirements

Requirements for symmetric outbound normalization. Each maps to roadmap phases.

### Types & Foundation

- [ ] **TYPE-01**: ReplyContext Zod discriminated union defined with slack/linear/github channel variants
- [x] **TYPE-02**: ~~NotifyTarget Zod schema~~ — Dropped per discuss-phase decision: ReplyContext unifies both reply and notify addressing (Slack threadTs optional = post to channel)
- [ ] **TYPE-03**: MessageContent type defined with text and options fields (semantic hint dropped per discuss-phase decision)
- [ ] **TYPE-04**: Conversation row extended with reply_context JSONB column (nullable, no default). Executor wiring to populate it deferred to Phase 61
- [x] **TYPE-05**: ~~Communication tools accept explicit replyContext parameter~~ — Moved to Phase 64 (COMM-01..COMM-05 cover this)
- [x] **TYPE-06**: ~~Agent definitions support defaultNotifyTarget~~ — Moved to Phase 65 (MIGR-01..MIGR-06 cover this)

### MCP Prerequisites

- [ ] **MCP-01**: linear:create_comment registered in MCP server tool list and agent-side linear-tools.ts
- [ ] **MCP-02**: github:create_pr_comment MCP tool implemented using Octokit issues.createComment
- [ ] **MCP-03**: MCP permissions seeded for both new tools (dev-agent and product-agent access)

### Inbound Pipeline

- [ ] **INBD-01**: IncomingEventSchema extended with optional replyContext field
- [ ] **INBD-02**: SignalSchema extended with optional replyContext field
- [ ] **INBD-03**: Slack adapter attaches replyContext (teamId, channelId, threadTs) to IncomingEvent
- [ ] **INBD-04**: Linear adapter attaches replyContext (issueId) to IncomingEvent
- [ ] **INBD-05**: GitHub adapter attaches replyContext (owner, repo, prNumber) to IncomingEvent
- [ ] **INBD-06**: Signal delivery in ConversationExecutor stores replyContext on conversation row
- [ ] **INBD-07**: Signal delivery includes replyContext in user message via structured tag

### Outbound Denormalizer

- [ ] **OUTB-01**: Denormalizer dispatches to Slack MCP tools based on replyContext.channel
- [ ] **OUTB-02**: Denormalizer dispatches to Linear MCP tools based on replyContext.channel
- [ ] **OUTB-03**: Denormalizer dispatches to GitHub MCP tools based on replyContext.channel
- [ ] **OUTB-04**: Slack denormalizer uses send_approval_request for ask() with options (interactive buttons)
- [ ] **OUTB-05**: Slack denormalizer uses reply_to_thread for reply() and ask() without options
- [ ] **OUTB-06**: Linear denormalizer renders ask() options as text instructions in comment body
- [ ] **OUTB-07**: GitHub denormalizer renders ask() options as text instructions in PR comment body
- [ ] **OUTB-08**: Denormalizer returns clear error with guidance when replyContext is invalid or malformed
- [ ] **OUTB-09**: communication:reply and communication:ask require replyContext in their Zod schemas (validation error if missing). No fallback chain — agents without replyContext use communication:notify with an explicit target instead.

### Communication Tools

- [ ] **COMM-01**: communication:reply tool responds on originating channel via replyContext pass-through
- [ ] **COMM-02**: communication:ask tool requests input with structured options, channel-adaptive rendering
- [ ] **COMM-03**: communication:notify tool sends broadcast to explicit target channel
- [ ] **COMM-04**: communicationAdapter function extracts CommunicationToolDeps from ToolContext
- [ ] **COMM-05**: All three tools registered in tool-factories.ts under communication namespace

### Router Updates

- [ ] **ROUT-01**: signal_conversation tool accepts optional replyContext field in input schema
- [ ] **ROUT-02**: Router propagates replyContext from IncomingEvent through signal_conversation calls
- [ ] **ROUT-03**: Router system prompt includes guidance for Linear comment routing (query status, reopen if completed)
- [ ] **ROUT-04**: Router system prompt includes guidance for replyContext forwarding in all signal paths

### Agent Migration

- [ ] **MIGR-01**: dev-agent definition.yaml replaces slack:send_message and slack:send_approval_request with communication:reply, communication:ask, communication:notify
- [ ] **MIGR-02**: product-agent definition.yaml replaces slack:send_message with communication:reply, communication:ask, communication:notify
- [ ] **MIGR-03**: dev-agent prompt.md rewritten for domain-language communication following PROMPT_GUIDE.md
- [ ] **MIGR-04**: product-agent prompt.md rewritten for domain-language communication following PROMPT_GUIDE.md
- [ ] **MIGR-05**: Prompt changes use constitutional constraints and few-shot examples (no procedural tool sequences)
- [ ] **MIGR-06**: Prompt changes explain replyContext pass-through as opaque context, not channel-specific instructions
- [ ] **MIGR-07**: Agent echo filtering prevents agent-authored Linear comments from re-entering the inbound pipeline as new events (prerequisite for agents using communication:reply on Linear)

### Testing & Validation

- [x] **TEST-01**: Denormalizer unit tests verify correct MCP tool called per channel and action type
- [x] **TEST-02**: ReplyContext propagation test verifies signal carries replyContext from adapter through executor
- [x] **TEST-03**: Communication tool tests verify input validation and denormalizer delegation
- [x] **TEST-04**: ask() option rendering test verifies text-formatted options consistently across all channels (no interactive buttons)

## Future Requirements

Deferred to post-v2.6. Tracked but not in current roadmap.

### Format Translation

- **FMT-01**: Markdown-to-Slack-mrkdwn translation in Slack denormalizer path
- **FMT-02**: Semantic message formatting per channel (emoji on Slack, clean text on Linear)

### Convenience Features

- **CONV-01**: Multi-channel replyAll convenience tool
- **CONV-02**: Conversation-level default notify target from metadata
- **CONV-03**: Workspace-level default notification channel configuration

## Out of Scope

| Feature | Reason |
|---------|--------|
| Agent-visible channel awareness (A1) | Agents should NOT know which channel they're on -- defeats the abstraction |
| Block Kit construction by LLM (A2) | Complex, fragile, token-expensive -- denormalizer constructs from semantic intent |
| Channel preference selection by agents (A3) | Recreates hardcoded Slack problem at higher abstraction level |
| Real-time channel-switching (A4) | Omnichannel problem; each signal carries its own replyContext naturally |
| Universal rich content format (A5) | Consumer chat territory; text + options sufficient for developer workflow |
| Removing integration-specific tools (A6) | Data access tools (get_issue, create_branch) are not communication |
| Bidirectional format conversion (A7) | One-directional translation (outbound only) is sufficient |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| TYPE-01 | Phase 60 | Pending |
| TYPE-02 | Phase 60 | Dropped (ReplyContext unifies both) |
| TYPE-03 | Phase 60 | Pending |
| TYPE-04 | Phase 60 | Pending |
| TYPE-05 | Phase 64 | Moved (covered by COMM-01..05) |
| TYPE-06 | Phase 65 | Moved (covered by MIGR-01..06) |
| MCP-01 | Phase 60 | Pending |
| MCP-02 | Phase 60 | Pending |
| MCP-03 | Phase 60 | Pending |
| INBD-01 | Phase 61 | Pending |
| INBD-02 | Phase 61 | Pending |
| INBD-03 | Phase 61 | Pending |
| INBD-04 | Phase 61 | Pending |
| INBD-05 | Phase 61 | Pending |
| INBD-06 | Phase 61 | Pending |
| INBD-07 | Phase 61 | Pending |
| ROUT-01 | Phase 62 | Pending |
| ROUT-02 | Phase 62 | Pending |
| ROUT-03 | Phase 62 | Pending |
| ROUT-04 | Phase 62 | Pending |
| OUTB-01 | Phase 63 | Pending |
| OUTB-02 | Phase 63 | Pending |
| OUTB-03 | Phase 63 | Pending |
| OUTB-04 | Phase 63 | Pending |
| OUTB-05 | Phase 63 | Pending |
| OUTB-06 | Phase 63 | Pending |
| OUTB-07 | Phase 63 | Pending |
| OUTB-08 | Phase 63 | Pending |
| OUTB-09 | Phase 63 | Pending |
| COMM-01 | Phase 64 | Pending |
| COMM-02 | Phase 64 | Pending |
| COMM-03 | Phase 64 | Pending |
| COMM-04 | Phase 64 | Pending |
| COMM-05 | Phase 64 | Pending |
| MIGR-01 | Phase 65 | Pending |
| MIGR-02 | Phase 65 | Pending |
| MIGR-03 | Phase 65 | Pending |
| MIGR-04 | Phase 65 | Pending |
| MIGR-05 | Phase 65 | Pending |
| MIGR-06 | Phase 65 | Pending |
| MIGR-07 | Phase 65 | Pending |
| TEST-01 | Phase 66 | Complete |
| TEST-02 | Phase 66 | Complete |
| TEST-03 | Phase 66 | Complete |
| TEST-04 | Phase 66 | Complete |

**Coverage:**
- v2.6 requirements: 45 total (1 dropped, 2 moved to later phases)
- Mapped to phases: 45
- Unmapped: 0

---
*Requirements defined: 2026-02-08*
*Last updated: 2026-02-08 -- synced with Phase 60 discuss-phase decisions (TYPE-02 dropped, TYPE-05/06 moved)*
