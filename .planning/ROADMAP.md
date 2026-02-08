# Milestone v2.6: Unified Agent Communication

**Status:** In progress
**Phases:** 60-66
**Total Plans:** TBD

## Overview

v2.6 replaces channel-specific outbound tools with domain-language communication primitives, enabling agents to reason about intent while infrastructure handles channel translation. Seven delivery boundaries: define all types and expose missing MCP tools (Phase 60), thread replyContext through the inbound pipeline from adapters to agent messages (Phase 61), update the router to propagate replyContext and handle Linear comment routing (Phase 62), build the outbound denormalizer that dispatches to integration MCP endpoints based on channel (Phase 63), register three communication tool factories (Phase 64), migrate agent definitions and prompts to domain-language communication (Phase 65), then validate end-to-end round-trips across all channels (Phase 66). Phases 61-62 (inbound) and 63-64 (outbound) are parallelizable once Phase 60 completes; Phase 65 depends on both tracks; Phase 66 depends on everything.

## Phases

### Phase 60: Types & MCP Foundation

**Goal**: All type definitions and missing integration MCP tools exist, unblocking both the inbound pipeline and outbound denormalizer
**Depends on**: Nothing (first phase)
**Requirements**: TYPE-01, TYPE-03, TYPE-04, MCP-01, MCP-02, MCP-03
**Success Criteria** (what must be TRUE):
  1. A ReplyContext Zod discriminated union validates slack, linear, and github channel variants at runtime, and TypeScript infers the correct variant fields after narrowing on the channel discriminator
  2. The conversations table has a reply_context JSONB column (nullable, no default). Executor wiring to populate it happens in Phase 61 when signal delivery gets replyContext support
  3. Calling `POST /mcp/tools/create_comment` on the Linear integration (port 3001) with an issueId and body successfully creates a comment on the Linear issue
  4. Calling `POST /mcp/tools/create_pr_comment` on the GitHub integration (port 3002) with owner, repo, prNumber, and body successfully creates a comment on the GitHub PR
  5. MCP permissions seeded: create_comment for dev-agent and product-agent, create_pr_comment for dev-agent only
**Plans:** 3 plans
Plans:
- [x] 60-01-PLAN.md -- Communication types (ReplyContext, MessageContent) + reply_context DB migration
- [x] 60-02-PLAN.md -- Integration-side MCP tools (Linear create_comment SDK server fix + GitHub create_pr_comment full stack)
- [x] 60-03-PLAN.md -- Agent-side wiring (tool wrappers, ToolRegistry registration, permission seeding)

### Phase 61: Inbound Pipeline

**Goal**: Every inbound event carries replyContext from its originating channel, and signal delivery includes replyContext in both the conversation row and the agent's message context
**Depends on**: Phase 60 (ReplyContext type must exist)
**Requirements**: INBD-01, INBD-02, INBD-03, INBD-04, INBD-05, INBD-06, INBD-07
**Success Criteria** (what must be TRUE):
  1. A Slack thread reply event produces an IncomingEvent with replyContext containing teamId, channelId, and threadTs extracted from the webhook payload
  2. A Linear issue comment event produces an IncomingEvent with replyContext containing the issueId
  3. A GitHub PR review event produces an IncomingEvent with replyContext containing owner, repo, and prNumber
  4. When a signal with replyContext is delivered to a conversation, the conversation row's reply_context column is updated with the new replyContext value
  5. The agent's resumed message includes a structured `<reply_context>` tag containing the replyContext JSON, enabling the agent to pass it through to communication tools
**Plans:** 3 plans
Plans:
- [x] 61-01-PLAN.md -- Schema extensions (IncomingEvent, Signal, StartConversationParams) + appendReplyContextTag helper
- [x] 61-02-PLAN.md -- Adapter replyContext extraction (Slack, Linear, GitHub)
- [x] 61-03-PLAN.md -- Executor, worker loop, EventRouter, and task routing replyContext wiring

### Phase 62: Router Updates

**Goal**: The router propagates replyContext from incoming events through signal delivery, and handles Linear comments as a routing path equivalent to Slack thread replies
**Depends on**: Phase 61 (IncomingEventSchema and SignalSchema must have replyContext fields)
**Requirements**: ROUT-01, ROUT-02, ROUT-03, ROUT-04
**Success Criteria** (what must be TRUE):
  1. The router's signal_conversation tool accepts an optional replyContext field, and when called with replyContext, the delivered signal includes it
  2. When the router receives an event with replyContext, it forwards that replyContext in every signal_conversation call it makes for that event
  3. The router correctly handles Linear issue comments by querying conversation status and reopening completed conversations when follow-up comments arrive
  4. Fast-path routes (start and signal) propagate replyContext from the incoming event to the executor without requiring LLM involvement
**Plans:** 3 plans
Plans:
- [x] 62-01-PLAN.md -- Tool schema changes + deps wiring (replyContext on signal_conversation/start_conversation, eventReplyContext threading)
- [x] 62-02-PLAN.md -- Router prompt rewrite (channel-agnostic follow_up_routing, generalized intent classification)
- [x] 62-03-PLAN.md -- Tests (tool replyContext auto-injection/override, slow-path deps threading)

### Phase 63: Outbound Denormalizer

**Goal**: A denormalizer function translates domain-language communication actions into the correct integration MCP tool calls based on replyContext channel type
**Depends on**: Phase 60 (types + MCP tools must exist)
**Requirements**: OUTB-01, OUTB-02, OUTB-03, OUTB-04, OUTB-05, OUTB-06, OUTB-07, OUTB-08, OUTB-09
**Success Criteria** (what must be TRUE):
  1. Calling the denormalizer with a Slack replyContext and a reply action invokes slack:reply_to_thread via MCP, and an ask action with options invokes slack:send_approval_request with interactive buttons
  2. Calling the denormalizer with a Linear replyContext invokes linear:create_comment via MCP for all action types (reply, ask, notify)
  3. Calling the denormalizer with a GitHub replyContext invokes github:create_pr_comment via MCP for all action types
  4. When ask() includes options, Slack renders interactive buttons while Linear and GitHub render options as text instructions in the comment body
  5. When replyContext is missing or malformed, the denormalizer returns a clear error with guidance, and falls back to conversation-level replyContext or defaultNotifyTarget when available
**Plans:** TBD

### Phase 64: Communication Tools

**Goal**: Three communication tool factories (reply, ask, notify) are registered and available to agents, providing domain-language abstractions over the outbound denormalizer
**Depends on**: Phase 63 (denormalizer must exist)
**Requirements**: COMM-01, COMM-02, COMM-03, COMM-04, COMM-05
**Success Criteria** (what must be TRUE):
  1. An agent can call communication:reply with a message and replyContext, and the response is delivered to the originating channel without the agent knowing which channel it is
  2. An agent can call communication:ask with a question and structured options, and the rendering adapts to the channel (buttons on Slack, text instructions on Linear/GitHub)
  3. An agent can call communication:notify with a message and explicit target, and the message is broadcast to the specified channel
  4. All three tools are registered under the communication namespace in tool-factories.ts and resolve correctly through the ToolRegistry
**Plans:** TBD

### Phase 65: Agent Migration

**Goal**: Agents communicate using domain-language primitives instead of channel-specific tools, reasoning about intent while infrastructure handles channel translation
**Depends on**: Phase 64 (communication tools must exist), Phase 61 (replyContext must flow through signals)
**Requirements**: MIGR-01, MIGR-02, MIGR-03, MIGR-04, MIGR-05, MIGR-06
**Success Criteria** (what must be TRUE):
  1. Dev-agent and product-agent definition.yaml files list communication:reply, communication:ask, and communication:notify instead of slack:send_message and slack:send_approval_request
  2. Agent prompts describe communication in domain terms (reply to the user, ask for input, notify a channel) without referencing Slack, Linear, or GitHub channel specifics
  3. Prompt changes follow PROMPT_GUIDE.md: constitutional constraints for communication boundaries, few-shot examples showing reply/ask/notify usage with reasoning, no procedural tool sequences
  4. Prompts explain replyContext as opaque context to pass through (not something the agent should inspect or modify), with guidance that the infrastructure determines the delivery channel
**Plans:** TBD

### Phase 66: Testing & Validation

**Goal**: End-to-end round-trip communication works correctly across all channels, with observable test coverage for the full pipeline from inbound event to outbound delivery
**Depends on**: All previous phases (60-65)
**Requirements**: TEST-01, TEST-02, TEST-03, TEST-04
**Success Criteria** (what must be TRUE):
  1. Denormalizer unit tests verify the correct MCP tool is called for each combination of channel (slack, linear, github) and action type (reply, ask, notify), with at least 9 test cases covering the matrix
  2. A propagation test verifies that replyContext flows from adapter through signal delivery to conversation row, with the agent receiving the context in its resumed message
  3. Communication tool tests verify Zod input validation rejects malformed input, and valid input delegates correctly to the denormalizer
  4. An ask-with-options test verifies capability asymmetry: Slack receives interactive buttons (send_approval_request), while Linear and GitHub receive text-rendered options in comment bodies
**Plans:** TBD

## Progress

**Execution Order:**
Phase 60 first. Then two parallel tracks: inbound (61 -> 62) and outbound (63 -> 64). Phase 65 after both tracks complete. Phase 66 last.

**Dependency Graph:**
```
Phase 60 (Types + MCP) ──┬──> Phase 61 (Inbound) ──> Phase 62 (Router) ──┐
                          │                                                 ├──> Phase 65 (Migration) ──> Phase 66 (Testing)
                          └──> Phase 63 (Denormalizer) ──> Phase 64 (Tools) ┘
```

| Phase | Milestone | Reqs | Plans Complete | Status | Completed |
|-------|-----------|:----:|----------------|--------|-----------|
| 60. Types & MCP Foundation | v2.6 | 9 | 3/3 | Complete | 2026-02-08 |
| 61. Inbound Pipeline | v2.6 | 7 | 3/3 | Complete | 2026-02-08 |
| 62. Router Updates | v2.6 | 4 | 3/3 | Complete | 2026-02-08 |
| 63. Outbound Denormalizer | v2.6 | 9 | 0/TBD | Not started | - |
| 64. Communication Tools | v2.6 | 5 | 0/TBD | Not started | - |
| 65. Agent Migration | v2.6 | 6 | 0/TBD | Not started | - |
| 66. Testing & Validation | v2.6 | 4 | 0/TBD | Not started | - |

---

_Created: 2026-02-08_
