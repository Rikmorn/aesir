# Phase 18: Slack Extraction - Context

**Gathered:** 2026-01-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Extract Slack integration as an independent package with its own lifecycle. OAuth, event handling, and message posting work through the extracted package. Follows Linear (Phase 16) and GitHub (Phase 17) extraction patterns.

</domain>

<decisions>
## Implementation Decisions

### Event Handling Scope
- **Primary interaction mode:** Conversational (back-and-forth messaging)
- **Event types to support:** @mentions, thread replies, DMs to bot
- **Ignore:** Bot messages (prevent loops), message edits
- **Multi-workspace:** Ready for multiple workspaces (workspace_id pattern like Linear/GitHub)
- **Approval mechanism:** Claude's discretion (likely interactive buttons based on codebase)
- **File attachments:** Acknowledge but don't process content (future capability)
- **No slash commands:** Mentions and threads only for now
- **No channel restrictions:** Process events from any channel bot is added to
- **Stateless event delivery:** Package delivers events, agent layer manages conversation context
- **User/channel resolution:** Best-effort name resolution with fallback to ID
- **3-second ack:** Acknowledge immediately, process async

### Bolt Framework
- **Keep Bolt:** Use Bolt framework (not raw Express like Linear/GitHub)
- **Connection modes:** Support both Socket Mode (dev) and HTTP mode (production) via config
- **OAuth:** Use Bolt's installationStore with PostgreSQL backend (slack.credentials)
- **Logging:** pino middleware integration for consistency
- **Retries:** Enable with idempotency checking (store event IDs to dedupe)
- **API exposure:** High-level wrapper methods + escape hatch to Bolt app if needed
- **Middleware:** Fixed middleware (logging, correlation, idempotency) — not customizable
- **Event abstraction:** Package emits typed events, consumer decides how to handle (no direct function calls)
- **Deployment modes:** Standalone server (main.ts) + library exports (like Linear/GitHub for now)

### Message Posting
- **Format:** Both plain text and Block Kit depending on context
- **Threading:** Context-dependent (reply to thread if in thread, new message if new conversation)
- **Message tracking:** Return message ID (ts/channel) — caller stores if they need updates later
- **Templates, ephemeral, DMs, scheduled, updates:** Claude's discretion based on agent needs

### Database Schema
- **Schema namespace:** `slack.*` (isolated from other integrations)
- **Primary data:** Credentials (OAuth tokens) + workspace metadata
- **Token structure, enterprise support:** Claude's discretion following Bolt's installation model

### Claude's Discretion
- Approval interaction pattern (buttons vs reactions vs text)
- Rate limiting strategy (retry with backoff)
- User/channel info caching strategy
- Single vs multi-bot support per process
- Message template designs
- Ephemeral message support
- DM posting support
- Scheduled message support
- Message update support
- Database schema details following Bolt's installation data model

</decisions>

<specifics>
## Specific Ideas

- "I definitely don't want Pattern C (shared process) — agents and integrations should have clear boundaries"
- MCP (Phase 19) is the architectural inflection point where integrations become true services
- Slack should emit typed events, consumer decides how to handle — ready for future patterns

</specifics>

<deferred>
## Deferred Ideas

### Phase 19: MCP Layer — CRITICAL ARCHITECTURAL DECISION
**Integration Service Isolation:**
Integration packages (Linear, GitHub, Slack) currently provide standalone server + library exports. Phase 19 (MCP Layer) transforms them into true service isolation — agents communicate via MCP protocol, not direct library imports. This is the architectural inflection point for proper service boundaries.

This addresses the user's core objective: integrations should be fully isolated services that communicate via network boundaries, not code imports. The `createLinearClient()` / `import from '@aesir/integration-slack'` pattern should be replaced by MCP tool calls.

**Must be captured prominently in Phase 19 planning.**

### Future Phases
- **File attachment processing:** Acknowledge files now, process content when basics are done. Needs research on how to pipe file content to LLM.
- **Slash commands:** Not needed now, can add later if power-user shortcuts become valuable
- **Channel allowlists:** No restrictions now, could be agent configuration feature later
- **Thread history fetching:** Currently stateless. Could add thread history fetching to package if agent layer finds it cumbersome to manage.
- **Event routing patterns:** How events get routed to agents (push/pull/queue) — Phase 19+ concern

</deferred>

---

*Phase: 18-slack-extraction*
*Context gathered: 2026-01-21*
