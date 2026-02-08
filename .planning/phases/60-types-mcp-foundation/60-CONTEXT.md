# Phase 60: Types & MCP Foundation - Context

**Gathered:** 2026-02-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Define all shared communication types (ReplyContext, MessageContent) and expose the two missing MCP tools (Linear `create_comment`, GitHub `create_pr_comment`), unblocking both the inbound pipeline (Phase 61-62) and outbound denormalizer (Phase 63-64) tracks. No communication tool logic, no adapter changes, no agent migration.

</domain>

<decisions>
## Implementation Decisions

### ReplyContext shape
- Zod-first: define `ReplyContextSchema` as a Zod discriminated union on `channel`, infer TypeScript type with `z.infer<>`
- Three channel variants: `slack` (teamId, channelId, threadTs optional), `linear` (issueId), `github` (owner, repo, prNumber, commentId optional)
- **Slack `threadTs` is optional** — absence means "post to channel" (for notify), presence means "reply in thread" (for reply). This unifies ReplyContext and NotifyTarget into one type
- **Drop `NotifyTarget` as a separate type** — use ReplyContext everywhere. The semantic difference is in which tool the agent calls (reply vs notify), not the address type
- **Keep GitHub `commentId` in the type but don't populate or use it** — the normalizer won't set it, the denormalizer won't branch on it. It's there for future inline review reply support without schema migration

### MessageContent type
- Define in Phase 60 alongside ReplyContext — it's the "what" to ReplyContext's "where"
- Fields: `text` (string, markdown body) and `options` (optional array of {label, value, style?})
- **Drop `semantic` field** — none of the v2.6 denormalizer code branches on it. Add it back when format translation (FMT-01/FMT-02) lands as an additive optional field
- Drop `metadata` field — unused in v2.6, add when needed

### MCP tool: Linear create_comment
- Tool already exists in the Linear integration code but is not registered in the MCP server's tool list
- **Verify the existing implementation** before wiring up — check it follows current MCP patterns (input schema, error handling, permission check), update if needed, then register
- Seed permissions: dev-agent AND product-agent (both work on Linear issues)

### MCP tool: GitHub create_pr_comment
- New MCP tool using `issues.createComment` from Octokit (NOT `pulls.createReview`)
- **issues.createComment is correct** because the agent is replying in the PR conversation, not submitting a formal review. PR-level comments don't carry review semantics (approved/changes_requested)
- **Pass-through error handling** — let GitHub API return 404 if PR doesn't exist. No pre-validation. The integration layer is a thin MCP wrapper, not a validation layer
- Seed permissions: dev-agent only (product-agent doesn't interact with GitHub PRs)

### reply_context storage
- Add `reply_context JSONB` column to the conversations table (nullable, no default)
- **Last-wins overwrite** — each signal delivery replaces the column value. The conversation row is a "where to reply now" pointer, not a history. Event log has the full history if needed
- **Store from both start() and signal()** — the initial IncomingEvent that triggers a conversation also has a replyContext. Store it at conversation creation so the agent can reply from turn one without waiting for a signal round-trip
- Existing rows get null — the code already handles "no replyContext" via the notify() fallback path

### Type placement
- All communication types in `packages/agents/src/shared/communication/types.ts` (NOT under `tools/`, NOT in `framework/types.ts`)
- ReplyContext, MessageContent, and CommunicationToolDeps in the same file — small, cohesive module
- This avoids circular imports: adapters create ReplyContext, framework passes it through, tools consume it, router forwards it. A neutral `shared/communication/` location works for all consumers
- NOT in `@aesir/types` — every consumer is within `@aesir/agents`. If cross-package sharing is needed later, it's a one-line re-export

### Claude's Discretion
- Exact Zod schema field constraints (min lengths, value validation)
- Migration file naming and ordering
- CommunicationToolDeps interface shape (follows McpToolDeps pattern)
- Whether to add a barrel export from shared/communication/

</decisions>

<specifics>
## Specific Ideas

- "The conversation column is a projection for fast access; the event log is the history" — events as ground truth principle from design vision
- GitHub `issues.createComment` was chosen because agent replies shouldn't register as formal review events in PR status badges
- Permission seeding follows agent role boundaries, not blanket access

</specifics>

<deferred>
## Deferred Ideas

- Inline review comment replies (GitHub `pulls.createReplyForReviewComment`) — future feature when individual `pull_request_review_comment` events are handled as separate signals
- `semantic` field on MessageContent — add when format translation (FMT-01/FMT-02) lands
- `reply_to_review_comment` MCP tool — the spec mentions it as optional, defer until inline review support is needed

</deferred>

---

*Phase: 60-types-mcp-foundation*
*Context gathered: 2026-02-08*
