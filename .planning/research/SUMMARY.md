# Project Research Summary

**Project:** Aesir v2.6 -- Unified Agent Communication
**Domain:** Multi-channel communication abstraction layer for agentic development platform
**Researched:** 2026-02-08
**Confidence:** HIGH

## Executive Summary

v2.6 adds symmetric outbound normalization to Aesir's existing inbound adapter pipeline, enabling agents to "reply where the conversation is happening" without hardcoding channel-specific tools. Today, agents call `slack:send_message` explicitly, creating O(agents x integrations) complexity and preventing them from responding on Linear or GitHub. The solution: a `ReplyContext` type threaded through the signal pipeline, three new domain-language tools (`communication:reply/ask/notify`), and an outbound denormalizer that dispatches to integration MCP endpoints based on channel.

The implementation requires zero new npm dependencies. Everything is built on existing primitives: Zod discriminated unions for type safety, the established ToolFactory + ToolRegistry pattern for new tools, the existing `callMcpTool` MCP client for HTTP dispatch, and Octokit (already installed) for the new GitHub PR comment endpoint. Two integration MCP tools need exposure (Linear `create_comment` handler exists but isn't registered; GitHub `create_pr_comment` needs to be built). The core architectural risk is replyContext loss during history compaction -- the infrastructure-level storage approach (storing replyContext on the conversation row, not just in message text) eliminates this fragility and is strongly recommended over the LLM-passthrough pattern proposed in the spec.

This milestone extends existing patterns rather than introducing new ones. The denormalizer is the outbound counterpart to adapters (both live in the agents package, both use MCP HTTP, neither imports integration SDKs). The `ReplyContext` type uses the same Zod schema pattern as existing event schemas. The communication tools follow the exact ToolFactory pattern used by 34 existing tools. The spec's XML tag embedding for replyContext is pragmatic but fragile -- infrastructure-level storage is more robust for production use.

## Key Findings

### Recommended Stack

**Zero new dependencies required.** The unified communication layer is implementable entirely within the existing stack. Zod (3.25.67, pinned) handles discriminated union validation for `ReplyContext`. The existing ToolRegistry + ToolFactory pattern supports the three new `communication:*` tools. The existing `callMcpTool` MCP client dispatches to integration endpoints. Octokit (already at @octokit/rest@^22.0.1 in the GitHub integration) provides `issues.createComment` for PR-level comments.

**Core technologies:**
- **Zod discriminated unions** — runtime validation of `ReplyContext` channel variants (slack/linear/github) with automatic type inference
- **ToolFactory pattern** — three new communication tools follow the exact pattern used by existing integration tools (mcpAdapter, codebaseAdapter)
- **MCP HTTP protocol** — denormalizer calls existing integration endpoints via `callMcpTool`, maintaining the HTTP boundary between agents and integrations
- **Octokit REST API** — `octokit.rest.issues.createComment` for GitHub PR comments (PR comments are issue comments in GitHub's API)

**Critical infrastructure decision:** Store `replyContext` on the conversation row (new JSONB column), NOT just in signal message text. The spec proposes XML tag embedding (`<reply_context>JSON</reply_context>`) which is fragile -- LLMs mutate JSON during passthrough, and history compaction destroys the context. Infrastructure-level storage (conversation schema extension + ToolContext population) eliminates these failure modes.

### Expected Features

**Must have (table stakes):**
- **T1: reply() tool** — respond on originating channel (core value proposition; every multi-channel bot framework provides this)
- **T2: ask() tool** — request input with structured options (human-in-the-loop approvals are the primary interaction pattern)
- **T3: replyContext propagation** — thread context through adapters -> signals -> agent messages (the plumbing that makes reply/ask work)
- **T4: Outbound denormalizer** — symmetric counterpart to inbound normalizers, dispatches to correct MCP endpoint
- **T6: Linear create_comment MCP exposure** — handler exists, needs registration (30 LOC wiring)
- **T7: GitHub create_pr_comment MCP tool** — new handler using Octokit, follows established patterns
- **T8/T9: Agent migration** — swap channel tools for communication tools in definitions + prompts

**Should have (competitive):**
- **D2: Router replyContext forwarding** — router's `signal_conversation` tool propagates replyContext from event to signal
- **D6: Linear comment routing** — router handles Linear comments like Slack thread replies (query status -> reopen if completed)
- **D7: Markdown-to-Slack-mrkdwn translation** — agents write Markdown, Slack denormalizer translates formatting

**Defer (v2+):**
- **D1: Semantic formatting** — status_update type gets emoji on Slack, clean text on Linear (start with text pass-through)
- **D3: Fallback when no replyContext** — auto-fallback to notify on default channel (agents can call notify explicitly for MVP)
- **D4: Multi-channel replyAll** — reply on multiple channels simultaneously (let agents call reply twice explicitly)
- **D5: Default notify target** — conversation-level notification channel in metadata (agents hardcode channel ID for MVP)

### Architecture Approach

The v2.6 unified communication layer fits cleanly into Aesir's existing 3-layer architecture (Agents -> Integrations -> Platform) without violating any dependency rules. Three new components extend existing patterns: (1) `ReplyContext` type (Zod discriminated union on `channel` field) threaded through the inbound pipeline from adapters through signals to agent messages, (2) three `communication:reply/ask/notify` tool factories following the established ToolFactory -> ToolRegistry -> agent definition YAML pattern, and (3) an outbound denormalizer (pure function with switch dispatch on replyContext.channel) that maps domain actions to integration MCP tool calls.

**Major components:**
1. **ReplyContext type system** (`shared/tools/communication/types.ts`) — Zod discriminated union validated at pipeline boundaries (adapter output, signal delivery, tool input)
2. **Outbound denormalizer** (`shared/tools/communication/denormalizer.ts`) — pure function dispatch: switch on channel -> call appropriate MCP tool (slack:reply_to_thread, linear:create_comment, github:create_pr_comment)
3. **Communication tools** (`shared/tools/communication/reply.ts`, `ask.ts`, `notify.ts`) — domain-language abstractions that validate input, call denormalizer, return result
4. **Adapter extensions** (slack.ts, linear.ts, github.ts) — attach replyContext to IncomingEvent from existing webhook payload fields
5. **Signal pipeline modifications** (conversation-executor.ts, worker-loop.ts) — propagate replyContext through Signal schema and include in agent messages
6. **Integration MCP additions** — expose Linear create_comment (exists, needs registration), add GitHub create_pr_comment (new handler)

**Architectural symmetry:** Inbound adapters normalize integration payloads to domain events. Outbound denormalizer denormalizes domain actions to integration tool calls. Both live in the agents package, both use MCP HTTP, neither imports integration SDKs.

### Critical Pitfalls

1. **replyContext lost during history compaction** — signal message with `<reply_context>` XML tag gets summarized by history manager, destroying the structured JSON. Agent loses ability to reply. **Mitigation:** Store replyContext on conversation row (JSONB column), not just message text. Populate from infrastructure into ToolContext.

2. **Signal message format creates fragile LLM passthrough** — agent must extract JSON from XML tags and pass unchanged, but LLMs naturally "fix" formatting (change quotes, truncate values like Slack threadTs, capitalize channel names). **Mitigation:** Use infrastructure-level storage for reply/ask (most common), explicit target only for notify (uncommon). Agent decides WHAT, infrastructure decides WHERE.

3. **Router doesn't propagate replyContext through any of three routing paths** — fast-path EventRouter, slow-path signal_conversation tool, and task-aware routing all construct signals by copying specific fields. None include replyContext. **Mitigation:** Add replyContext to SignalSchema, add to signal_conversation input schema, update router prompt, use shared buildSignalFromEvent helper.

4. **Simultaneous prompt and tool changes break agent behavior** — removing slack:send_message from definition.yaml while prompt still references it causes "tool not found" errors. **Mitigation:** Phase rollout: (1) register communication tools, (2) add to definitions alongside Slack tools, (3) update prompts to prefer communication tools, (4) remove Slack tools only after validation.

5. **MCP tools don't exist yet** — linear:create_comment handler exists but isn't registered in MCP server. github:create_pr_comment doesn't exist at all. Denormalizer calls non-existent endpoints. **Mitigation:** Build and validate MCP tools BEFORE building denormalizer. Full checklist: implementation, MCP registration, permission seeding, agent-side wrapper.

## Implications for Roadmap

Based on research, suggested phase structure follows natural dependency boundaries: types and prerequisites first, then inbound pipeline extension and outbound tools (parallelizable), then agent migration, then polish.

### Phase 1: Foundation (Types + MCP Prerequisites)
**Rationale:** Define all types and expose missing integration MCP tools before building the plumbing. No agent behavior changes yet. Types have no dependencies. MCP tools must exist before denormalizer can call them.

**Delivers:**
- ReplyContext + NotifyTarget + MessageContent types with Zod schemas
- Linear create_comment exposed as MCP tool (handler exists, add registration)
- GitHub create_pr_comment MCP tool (new handler using Octokit issues.createComment)
- Both tools registered in tool-factories.ts and agent-side wrappers created

**Addresses:** T6 (Linear MCP), T7 (GitHub MCP), foundation for T3 (replyContext)
**Avoids:** CRITICAL-5 (MCP tools don't exist)
**Research needed:** No — types are straightforward, MCP tools follow established patterns

### Phase 2: Inbound Pipeline Extension
**Rationale:** Thread replyContext through the entire inbound pipeline from adapters through signals to agent messages. This is the plumbing that enables reply/ask. Can be built in parallel with Phase 3 (outbound) since they don't depend on each other.

**Delivers:**
- IncomingEventSchema + SignalSchema extended with optional replyContext field
- All three adapters (slack, linear, github) attach replyContext from webhook payloads
- Signal delivery in conversation-executor and worker-loop includes replyContext in user message or conversation row
- Router signal_conversation tool accepts and propagates replyContext
- Router system prompt updated for replyContext forwarding + Linear comment routing

**Addresses:** T3 (replyContext propagation), D2 (router forwarding), D6 (Linear routing)
**Avoids:** CRITICAL-1 (loss during compaction), CRITICAL-2 (fragile passthrough), CRITICAL-3 (router propagation gaps)
**Uses:** Types from Phase 1
**Research needed:** No — extends existing pipeline stages

### Phase 3: Outbound Denormalizer + Communication Tools
**Rationale:** Build denormalizer and communication tools now that types exist and MCP endpoints are available. Can be built in parallel with Phase 2 since the denormalizer consumes replyContext but doesn't depend on how it's delivered.

**Delivers:**
- Outbound denormalizer with switch dispatch on replyContext.channel
- Slack handler: reply_to_thread for reply, send_approval_request for ask+options, send_message for notify
- Linear handler: create_comment for all actions
- GitHub handler: create_pr_comment for all actions
- Three communication tool factories (reply, ask, notify) with Zod input schemas
- communicationAdapter function and registration in tool-factories.ts

**Addresses:** T4 (denormalizer), T1 (reply), T2 (ask), T5 (notify)
**Avoids:** CRITICAL-4 (tool changes without infrastructure), MODERATE-1 (taskIdentifier correlation)
**Uses:** Types from Phase 1, MCP tools from Phase 1
**Research needed:** No — pure function dispatch over established MCP calls

### Phase 4: Agent Migration
**Rationale:** Switch agents from channel-specific to domain-language communication after all infrastructure is in place. YAML changes are safe to make last -- if anything in earlier phases is wrong, agents still work with old tools.

**Delivers:**
- dev-agent: remove slack:send_message + send_approval_request, add communication:reply/ask/notify
- product-agent: remove slack:send_message, add communication:reply/ask/notify
- Both prompt.md files rewritten for domain-language communication (not find-and-replace)
- replyContext pass-through guidance, notify target explanation
- Version bumps for agent definitions (1 -> 2)

**Addresses:** T8 (agent definitions), T9 (prompt updates)
**Avoids:** MAJOR-3 (product-agent Slack assumptions), MAJOR-2 (notify target missing)
**Uses:** All previous phases
**Research needed:** No — prompt rewrite follows existing PROMPT_GUIDE.md

### Phase 5: Testing + Validation
**Rationale:** Full round-trip testing across all channels after migration complete.

**Delivers:**
- Unit tests: denormalizer dispatch per channel, replyContext propagation, tool input validation
- Integration tests: Slack event -> reply on Slack, Linear comment -> reply on Linear, GitHub PR review -> reply on GitHub
- Cross-channel validation: ask+options renders correctly (buttons on Slack, text on Linear/GitHub)
- Missing replyContext handling: agent uses notify gracefully

**Addresses:** All features
**Avoids:** All pitfalls
**Research needed:** No — standard testing patterns

### Phase Ordering Rationale

- **Phase 1 before all others:** Types must exist before they can be used. MCP endpoints must exist before denormalizer can call them. No new dependencies means Phase 1 is low-risk and unblocks both Phase 2 and Phase 3.

- **Phase 2 and Phase 3 parallelizable:** Inbound pipeline (Phase 2) threads replyContext to the agent. Outbound denormalizer (Phase 3) consumes it. They converge in Phase 4 when agents use both. Building in parallel reduces calendar time.

- **Phase 4 after infrastructure complete:** Agent definition and prompt changes are mechanical once the tools exist. Additive rollout (keep old tools, add new tools, update prompts, remove old tools) prevents in-flight conversation failures.

- **Phase 5 after migration:** Full system testing validates the complete round-trip across all channels.

**Total estimated effort:** 25-40 hours for Phases 1-4, plus testing. This is a medium-sized milestone built entirely on existing patterns with zero new dependencies.

### Research Flags

**Phases with standard patterns (skip research-phase during planning):**
- **Phase 1:** MCP tool pattern well-established (9 GitHub tools, 6 Linear tools already exist). Zod discriminated unions are standard.
- **Phase 2:** Adapter and signal pipeline extensions follow existing schema patterns.
- **Phase 3:** Denormalizer is pure function dispatch. ToolFactory pattern used by 34 existing tools.
- **Phase 4:** Agent definition YAML changes are declarative. Prompt updates follow PROMPT_GUIDE.md.
- **Phase 5:** Standard integration testing patterns.

**No phases need deeper research.** This is entirely an internal architecture extension with no external API exploration, no new technology evaluation, and no niche domain investigation.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Zero new dependencies. All technologies already in use (Zod, ToolFactory pattern, MCP HTTP, Octokit). |
| Features | HIGH | Multi-channel bot framework patterns well-established (Bot Framework, Rasa, Botpress). Table stakes clear from competitor analysis. |
| Architecture | HIGH | Extends existing 3-layer structure without violating dependency rules. Adapters and denormalizer are symmetric counterparts. |
| Pitfalls | HIGH | Based on deep codebase inspection of signal pipeline end-to-end. All three routing paths traced. History manager compaction analyzed. |

**Overall confidence:** HIGH

### Gaps to Address

**Infrastructure vs. LLM passthrough decision:** The spec proposes XML tag embedding for replyContext (LLM passthrough). Research identifies this as fragile (CRITICAL-1, CRITICAL-2). **Recommendation:** Use infrastructure-level storage (conversation row + ToolContext) for reply/ask. This is the most consequential architectural decision in the milestone and should be finalized in Phase 1 planning before implementation begins.

**GitHub adapter correlationKey gap:** PR review events have no correlationKey (github.ts lines 73-93 comment: "always goes to slow_path"). With replyContext addition, the adapter needs owner/repo from the webhook payload. Verify these fields are available in NormalizedEvent from the GitHub integration. If not, GitHub integration webhook normalizer needs to include them.

**Capability asymmetry handling:** Slack has interactive buttons (Block Kit), Linear and GitHub are text-only. The denormalizer adapts (ask+options -> buttons on Slack, text instructions on Linear/GitHub). But the signal flow differs: Slack button click fast-paths to `approval` signal, Linear comment goes to slow-path router which must classify "approve" as `approval` signal type. Test that `wait_for(type: "approval")` correctly resumes from both fast-path (Slack) and slow-path (Linear/GitHub) approval responses.

## Sources

### Primary (HIGH confidence)
- **Aesir codebase** (verified 2026-02-08) — all four research files based on direct inspection of existing code, not external sources
- **STACK.md** — Zod discriminated unions, ToolFactory pattern, MCP HTTP protocol, Octokit issues.createComment
- **FEATURES.md** — Microsoft Bot Framework (Activity schema, TurnContext), Rasa (OutputChannel), Botpress (Markdown translation), Knock (multi-channel approval), Slack Block Kit reference
- **ARCHITECTURE.md** — Signal pipeline (adapters -> router -> executor), tool registry (34 tools), conversation-executor signal delivery, history manager compaction
- **PITFALLS.md** — EventRouter routing paths (3 locations), history manager classification, signal delivery format, GitHub adapter gaps

### Secondary (MEDIUM confidence)
- **FEATURES.md** — Cloudflare Agents SDK + Knock integration pattern, mack library (Markdown to Block Kit), md-to-slack converter
- **Anthropic: Building Effective Agents** — tool-calling patterns, human-in-the-loop approval gates

### Tertiary (LOW confidence)
- None — all findings based on direct codebase analysis or official documentation

---
*Research completed: 2026-02-08*
*Ready for roadmap: yes*
