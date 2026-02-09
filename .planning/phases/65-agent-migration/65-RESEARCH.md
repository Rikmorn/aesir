# Phase 65: Agent Migration - Research

**Researched:** 2026-02-09
**Domain:** Agent prompt/definition migration to domain-language communication primitives + integration echo filtering
**Confidence:** HIGH

## Summary

Phase 65 migrates dev-agent and product-agent from channel-specific Slack tools (`slack:send_message`, `slack:send_approval_request`) to domain-language communication primitives (`communication:reply`, `communication:ask`, `communication:notify`) that were built in Phase 63. The communication tools and denormalizer already exist and are registered in the ToolRegistry. ReplyContext flows through signals (Phase 61). The work is primarily prompt rewrites, definition.yaml tool swaps, enrichment cleanup, defaultNotifyTarget injection, and echo loop prevention in integration webhook handlers.

The codebase is well-prepared for this migration. Communication tools (reply, ask, notify) are already registered in `tool-factories.ts` via `communicationAdapter`. The denormalizer correctly routes to Slack, Linear, and GitHub MCP tools based on `replyContext.channel`. The `<reply_context>` tag is already appended to signal messages by the conversation executor. The main gaps are: (1) agents still reference `slack:send_message` in their definitions and prompts, (2) enrichment.ts still injects `<slack_context>` for product-agent, (3) no defaultNotifyTarget exists for `communication:notify`, and (4) Linear comment webhooks lack echo filtering.

**Primary recommendation:** Execute echo filtering first (prerequisite), then migrate definitions/prompts in parallel for the two agents, then clean up enrichment. Each is a focused, testable unit.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Semi-opaque replyContext: explain it as "the address where the human is talking to you," not its internal structure
- Constitutional constraint: "Never change your message based on what's in replyContext. Your response should read the same whether the human is on Slack, Linear, or GitHub."
- Agent should not reference the delivery channel in messages: "I've replied with my update" not "I've posted my update on the PR"
- Communication guidance woven into a "Working with humans" workflow paragraph, not a tool catalog section
- One sentence the agent must internalize: reply/ask need replyContext (from a signal), notify needs an explicit target (no signal)
- First example shows explicit replyContext pass-through: extract JSON from `<reply_context>` tag in signal message, pass to reply() as replyContext parameter
- Subsequent examples use `<from signal>` shorthand -- agent already knows the mechanical pattern
- Reasoning in examples teaches intent (acknowledge approval, clarify scope, escalate blocker), not channel mechanics
- Product-agent: rewrite ALL examples to use reply()/ask() -- no stale slack:send_message references
- Dev-agent prompt changes: 3 specific Slack references to replace (tools Slack category, constraints line 12, tools Human interaction)
- Product-agent prompt changes: remove `<slack_context>` reference, update to describe `<reply_context>` and `<workspace_context>` as separate concerns, add constraint about reply()/ask() being the only user-facing communication
- Definition.yaml tool swaps: dev-agent removes `slack:send_message` + `slack:send_approval_request`, adds `communication:reply` + `communication:ask` + `communication:notify`; product-agent removes `slack:send_message`, adds `communication:reply` + `communication:ask` + `communication:notify`
- defaultNotifyTarget NOT in definition.yaml -- env config + framework injection via `DEV_AGENT_NOTIFY_CHANNEL`, `PRODUCT_AGENT_NOTIFY_CHANNEL` env vars (fallback to `SLACK_CHANNEL_ID`)
- Framework constructs ReplyContext from env vars + SLACK_TEAM_ID at startup, injects into agent's system prompt `<context>` block
- Agent passes defaultNotifyTarget explicitly to notify() -- no tool-level auto-fill or fallback
- Enrichment.ts cleanup: remove `<slack_context>` block (lines 62-73)
- Echo loop prevention: integration-layer filtering only, no adapter-level safety net
- Slack: already handled by Bolt bot_id filtering -- verify, don't implement
- GitHub: match `comment.performed_via_github_app.id` against configured App ID; drop if match
- Linear: compare comment author `user.id` against stored OAuth user ID from `linear.credentials`; drop if match
- Echo filtering is a separate plan executed BEFORE definition/prompt migration

### Claude's Discretion
- Exact wording of "Working with humans" paragraph (as long as it covers reply/ask/notify distinction and replyContext pass-through)
- How to structure the defaultNotifyTarget injection code (new function vs extending existing enrichment logic)
- Whether to extract common prompt patterns between dev-agent and product-agent communication sections
- Exact formatting of few-shot examples (indentation, tool call representation)

### Deferred Ideas (OUT OF SCOPE)
- Per-channel option rendering (Slack interactive buttons for ask) -- explicitly removed in Phase 63, revisit only if text instructions prove inadequate
- commentId inline review comment replies on GitHub -- noted in ReplyContext type, deferred in v2.6
- Workspace-level defaultNotifyTarget config -- per-agent env vars sufficient for now, move to workspace config when multi-tenancy matters
- Adapter-level echo filtering safety net -- add only if integration-layer filtering proves insufficient in practice
</user_constraints>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Zod | (existing) | Schema validation for ReplyContext, env vars | Already used project-wide for all external boundaries |
| Vitest | (existing) | Unit testing for echo filters, enrichment changes | Project test framework |
| YAML | (existing) | Agent definition files | AgentRegistry loads definitions from YAML |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @linear/sdk | (existing in linear integration) | Retrieving Linear user viewer.id | Linear echo filter needs the authenticated user's ID |
| Bolt (@slack/bolt) | (existing in slack integration) | Slack bot_id filtering | Already handles echo prevention -- verify only |

No new libraries needed. This phase is entirely about reorganizing existing code patterns.

## Architecture Patterns

### File Ownership Map

```
packages/agents/definitions/
  dev-agent/
    definition.yaml           # Plan: tool swap (remove slack:*, add communication:*)
    prompt.md                 # Plan: rewrite 3 Slack references + add communication section
  product-agent/
    definition.yaml           # Plan: tool swap (remove slack:*, add communication:*)
    prompt.md                 # Plan: rewrite <tools> section + examples + constraint

packages/agents/src/
  router/
    enrichment.ts             # Plan: remove <slack_context> block (lines 62-73)
  shared/
    env/
      config.ts               # Plan: add SLACK_TEAM_ID, *_NOTIFY_CHANNEL env vars
  framework/
    (no changes to framework)
  service/
    main.ts                   # Plan: wire defaultNotifyTarget injection

packages/integrations/
  linear/src/
    api/webhooks.ts           # Plan: add echo filter before comment dispatch
    types/config.ts           # May need LINEAR_BOT_USER_ID env var (or query at startup)
  github/src/
    api/webhooks.ts           # Plan: verify no PR comment webhooks processed currently
    types/config.ts           # Plan: add GITHUB_APP_ID env var
  slack/src/
    main.ts                   # Plan: verify bot_id filter (line 318) already works
```

### Pattern 1: Echo Filtering at Integration Layer
**What:** Each integration filters self-authored events before dispatching to the agent service.
**When to use:** Whenever an agent writes to an integration (comment, message) that could trigger an inbound webhook.
**Architecture:**

```
Webhook arrives -> Integration validates signature -> Echo check -> Dispatch or drop
```

**Linear echo filter location:** `packages/integrations/linear/src/api/webhooks.ts`, inside the Comment event handler (line 106-170), BEFORE `normalizeCommentCreatedEvent` and `dispatcher.dispatch`.

**Key insight:** The Linear comment webhook payload includes `data.userId` (the comment author). The integration already has OAuth credentials for the workspace. The filter compares `payload.data.userId` against the authenticated Linear user's ID (obtainable from the Linear API's `viewer` query via the stored OAuth token, or cached at startup).

**GitHub echo filter:** Not currently needed because the GitHub integration does NOT handle `issue_comment` or `pull_request_review_comment` webhook events. The webhook handler (`packages/integrations/github/src/api/webhooks.ts`) only processes `pull_request_review` and `pull_request` (closed) events. If GitHub comment webhooks are added later, the filter would check `comment.performed_via_github_app.id`. For now, adding `GITHUB_APP_ID` to the config is forward-looking preparation only.

**Slack echo filter:** Already handled. Line 318 of `packages/integrations/slack/src/main.ts`:
```typescript
if (msgEvent.bot_id || msgEvent.subtype === "bot_message") {
  log.debug({ channel: msgEvent.channel }, "Ignoring bot message");
  return;
}
```
This catches all bot-authored messages including Aesir's own Slack messages. The `app_mention` handler does not have this filter but doesn't need it -- Slack doesn't send app_mention events for the bot's own messages.

### Pattern 2: defaultNotifyTarget Injection
**What:** Framework injects a `<default_notify_target>` block into the agent's system prompt `<context>` section.
**When to use:** When an agent needs to send proactive notifications (not replies to a signal).

**Current enrichment flow:**
1. `enrichInitialMessage()` in `router/enrichment.ts` adds `<workspace_context>` and (currently) `<slack_context>` to the FIRST user message
2. `appendReplyContextTag()` in `communication/message-utils.ts` adds `<reply_context>` tag to signal messages
3. System prompt's `<context>` section says "Dynamic context is injected here by the framework at conversation start"

**Decision on injection approach:** The defaultNotifyTarget should be injected into the initial message via `enrichInitialMessage()` (extending the existing enrichment function), NOT into the system prompt directly. Reason: the system prompt `<context>` block is a static template placeholder, while `enrichInitialMessage()` is where per-conversation context blocks are already built. Adding a `<default_notify_target>` block alongside `<workspace_context>` follows the established pattern.

**Alternative considered:** Injecting into the system prompt itself would survive HistoryManager compaction. However, the system prompt IS already protected from compaction (system messages are never pruned). And `enrichInitialMessage()` content goes into the first user message, which is within `protectedMessages` (dev-agent: 20, product-agent: 10). So either approach survives compaction. Enrichment is the cleaner pattern because it keeps all dynamic injection in one place.

**Implementation shape:**
```typescript
// In enrichment.ts, after workspace context block:
const defaultNotifyTarget = resolveDefaultNotifyTarget(agentId, deps);
if (defaultNotifyTarget) {
  const notifyBlock = [
    "<default_notify_target>",
    JSON.stringify(defaultNotifyTarget),
    "</default_notify_target>",
  ].join("\n");
  initialMessage = `${notifyBlock}\n\n${initialMessage}`;
}
```

This requires:
1. Adding `SLACK_TEAM_ID` to the agent env config (currently not present -- needed to construct a Slack ReplyContext)
2. Adding `DEV_AGENT_NOTIFY_CHANNEL` and `PRODUCT_AGENT_NOTIFY_CHANNEL` env vars (with `SLACK_CHANNEL_ID` fallback)
3. Passing `agentDefinitionId` to `enrichInitialMessage()` (currently not passed -- the function only sees `event` and `deps`)

### Pattern 3: Prompt Migration for PROMPT_GUIDE.md Compliance
**What:** Rewrite agent prompts to use domain-language communication (reply/ask/notify) with constitutional constraints and few-shot examples.
**When to use:** All prompt changes in this phase.

**Current dev-agent prompt Slack references (3 locations):**
1. **`<tools>` Slack category (line 137-138):** `Slack: Sending status updates, notifications, and interactive approval requests with approve/reject buttons.`
2. **`<constraints>` line 12:** `Send a plan via Slack and use request_human_input to pause for their decision.`
3. **`<tools>` Human interaction (line 129):** `Send a Slack notification first so the human knows to check`

**Current product-agent prompt Slack references (key locations):**
1. **`<tools>` section (line 117-133):** Entire `<tools>` section references `<slack_context>` and describes tools as Slack-specific
2. **`<constraints>` line 15:** `Communicate with the user only through slack_send_message`
3. **Examples (lines 54-113):** All examples implicitly use slack_send_message pattern ("Message the user")

### Anti-Patterns to Avoid
- **Prescribing tool call sequences in prompts:** "First call reply(), then call wait_for()" violates PROMPT_GUIDE.md Rule 3. Describe the goal, not the procedure.
- **Encoding channel awareness in prompts:** "If the user is on Slack, format your response as..." -- the whole point of domain-language primitives is that the agent is channel-agnostic.
- **Adding replyContext parsing instructions to prompt:** The agent should treat replyContext as opaque JSON. Don't teach it the internal schema of SlackReplyContext vs LinearReplyContext.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Message routing to channels | Custom routing logic in prompts/agents | `communication:reply/ask/notify` -> denormalizer | Already built in Phase 63, tested, handles all 3 channels |
| Slack echo prevention | New Slack filtering code | Existing Bolt `bot_id` check (line 318 of main.ts) | Already works, just verify |
| ReplyContext construction | Agent building JSON objects | Framework `appendReplyContextTag()` for signals, enrichment for defaultNotifyTarget | Agents pass through opaque context, never construct it |

**Key insight:** The communication tools + denormalizer are the new "MCP wrapper" for human communication. Just as agents don't construct HTTP requests to integration APIs (they call MCP tools), they shouldn't construct channel-specific messages (they call communication tools with domain intent).

## Common Pitfalls

### Pitfall 1: Echo Loop from Linear Comments
**What goes wrong:** Agent uses `communication:reply` with a Linear replyContext. Denormalizer calls `linear:create_comment`. Linear sends a Comment webhook. Webhook handler dispatches it as an `issue_comment` IncomingEvent. Router signals the agent's conversation. Agent sees a new "user" message and replies again. Infinite loop.
**Why it happens:** Linear comment webhooks include ALL comments on an issue, including those created by the OAuth user (the agent's identity).
**How to avoid:** Echo filter in `packages/integrations/linear/src/api/webhooks.ts` that compares `payload.data.userId` against the stored OAuth user ID BEFORE dispatching the normalized event.
**Warning signs:** Rapid repeated comments on a Linear issue, all from the same user ID.

### Pitfall 2: Missing SLACK_TEAM_ID for defaultNotifyTarget
**What goes wrong:** defaultNotifyTarget needs a complete Slack ReplyContext (`{ channel: "slack", teamId, channelId }`), but `SLACK_TEAM_ID` isn't in the agent service env config. The ReplyContext would be malformed.
**Why it happens:** The current agent env config has `SLACK_CHANNEL_ID` but NOT `SLACK_TEAM_ID`. The Slack team ID has only been available through event payloads (webhook `teamId` field), not as a configured env var.
**How to avoid:** Add `SLACK_TEAM_ID` to the agent env schema (`packages/agents/src/shared/env/config.ts`). Make it required when `SLACK_CHANNEL_ID` is present (or default to a known workspace ID).
**Warning signs:** `communication:notify` calls fail with Zod validation errors because the `teamId` field is missing.

### Pitfall 3: Product-Agent Examples Still Showing Slack Tool Calls
**What goes wrong:** Prompt examples say "Message the user" but the product-agent no longer has `slack:send_message`. Examples become confusing -- agent doesn't know which tool to use.
**Why it happens:** Examples were written when `slack:send_message` was the only communication tool. The "Action:" lines use natural language that implicitly maps to Slack.
**How to avoid:** Per CONTEXT.md: "rewrite ALL examples to use reply()/ask()". Each example's Action should explicitly mention which communication tool to use and show reasoning about replyContext.
**Warning signs:** Product-agent outputting text instead of calling communication tools.

### Pitfall 4: Dev-Agent Missing replyContext in First Turn
**What goes wrong:** Dev-agent conversation starts from `linear.agent_session.created`. The start trigger creates a new conversation. The agent wants to notify a human about its plan, but has no replyContext yet (no signal has arrived).
**Why it happens:** replyContext comes from signals. On the first turn, the agent only has the initial message (from the trigger event). If it needs to communicate proactively (not as a response), it needs defaultNotifyTarget.
**How to avoid:** defaultNotifyTarget injection ensures the agent always has a target for `communication:notify`. The prompt should make clear: use `reply()`/`ask()` for responses (need replyContext from signal), use `notify()` for proactive messages (need defaultNotifyTarget).
**Warning signs:** Agent trying to use `reply()` without a replyContext, getting Zod validation errors.

### Pitfall 5: Enrichment Removal Breaking Product-Agent's Channel/Thread Discovery
**What goes wrong:** Product-agent currently reads `<slack_context>` to get channel ID and thread timestamp. After removing `<slack_context>`, the agent can't find these values.
**Why it happens:** The product-agent prompt says "Extract these values from the `<slack_context>` block." After removal, this instruction points nowhere.
**How to avoid:** Phase 61 already injects `<reply_context>` tag via `appendReplyContextTag()`. The migration removes `<slack_context>` from enrichment AND updates the prompt to reference `<reply_context>` instead. The product-agent's `<tools>` section must be rewritten to explain the new addressing model.
**Warning signs:** Product-agent parsing for `<slack_context>` and not finding it.

## Code Examples

### Example 1: Linear Echo Filter
Location: `packages/integrations/linear/src/api/webhooks.ts`, Comment handling section.

```typescript
// After parsing the comment payload (line ~117), before dispatching:

// Echo filter: skip comments authored by the Aesir OAuth user
const aesirUserId = await getLinearBotUserId(db, logger);
if (aesirUserId && commentPayload.data.userId === aesirUserId) {
  childLogger.debug(
    { commentId: commentPayload.data.id, userId: aesirUserId },
    "Ignoring self-authored comment (echo prevention)",
  );
  res.status(200).json({ received: true });
  return;
}
```

The `getLinearBotUserId` function would query the Linear API's `viewer` query using the stored OAuth token to get the authenticated user's ID, caching it at startup or on first use.

### Example 2: defaultNotifyTarget Enrichment
Location: `packages/agents/src/router/enrichment.ts`

```typescript
// New EnrichmentDeps fields:
export interface EnrichmentDeps {
  githubOwner?: string | undefined;
  githubRepo?: string | undefined;
  githubBaseBranch?: string | undefined;
  linearTeamId?: string | undefined;
  // New for Phase 65:
  slackTeamId?: string | undefined;
  devAgentNotifyChannel?: string | undefined;
  productAgentNotifyChannel?: string | undefined;
  defaultNotifyChannel?: string | undefined; // fallback: SLACK_CHANNEL_ID
}

// In enrichInitialMessage(), after workspace block, before <slack_context> removal:
function resolveDefaultNotifyTarget(
  agentId: string,
  deps: EnrichmentDeps,
): ReplyContext | undefined {
  const channelId =
    (agentId === "dev-agent" ? deps.devAgentNotifyChannel : undefined) ??
    (agentId === "product-agent" ? deps.productAgentNotifyChannel : undefined) ??
    deps.defaultNotifyChannel;

  if (!channelId || !deps.slackTeamId) return undefined;

  return {
    channel: "slack" as const,
    teamId: deps.slackTeamId,
    channelId,
  };
}
```

Note: `enrichInitialMessage` currently doesn't receive `agentDefinitionId`. The function signature needs to be extended, and callers in `router.ts` (two call sites) updated to pass it from the route decision.

### Example 3: Dev-Agent Definition.yaml Tool Swap
```yaml
# Before:
tools:
  # ... other tools ...
  - slack:send_message
  - slack:send_approval_request

# After:
tools:
  # ... other tools ...
  - communication:reply
  - communication:ask
  - communication:notify
```

### Example 4: Product-Agent Prompt <tools> Rewrite
```markdown
<tools>
Your initial message includes context blocks that provide addressing information:

- **<reply_context>**: The address where the human is talking to you -- pass this to
  reply() and ask() so your message reaches them. Present in signal messages (resumptions).
- **<workspace_context>**: GitHub owner/repo and Linear Team ID for creating issues and PRs.
- **<default_notify_target>**: A default channel address for proactive notifications when
  no reply_context is available (first turn, broadcasts).

Available tools by purpose:

- **Search for issues**: Find duplicates and related work before creating new issues.
- **Create issues**: Create well-structured Linear issues with title, description, priority, labels, and acceptance criteria.
- **List labels**: Retrieve the team's label set for accurate labeling.
- **Communicate with humans**: reply() sends a response where the human is, ask() poses a question, notify() broadcasts to a specific target.
- **Pause conversation**: Call wait_for when you need the user to respond before you can continue.
- **Task tracking**: Create tasks to track engagements, record handoffs, query prior context.
</tools>
```

### Example 5: Few-Shot Example with replyContext Pass-Through (First Example)
```markdown
Example 1 -- Clear bug report:

User signal (resumption): "The checkout page crashes when I click pay"
<reply_context>{"channel":"slack","teamId":"T123","channelId":"C456","threadTs":"1234.5678"}</reply_context>

Reasoning: This is a clear bug report -- I know what happens (crash), where (checkout page),
and the trigger (clicking pay). The signal includes reply_context so I can respond directly
to the human. I should search, draft, and present the draft for confirmation.

Action: Search for duplicate issues about the checkout crash. Find no exact matches. Draft a
bug report with a clear title, description, and acceptance criteria. Use ask() with the
reply_context from the signal to present the full draft and ask for confirmation. Then
call wait_for to pause for their reply.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `slack:send_message` direct calls | `communication:reply/ask/notify` via denormalizer | Phase 63 (built), Phase 65 (adopted) | Agents become channel-agnostic |
| `<slack_context>` for channel addressing | `<reply_context>` from signal + `<default_notify_target>` for proactive | Phase 61 (reply_context), Phase 65 (notify target) | Addressing becomes infrastructure concern |
| Channel-specific prompt instructions | Domain-language communication guidance | Phase 65 | Prompts follow PROMPT_GUIDE.md |

## Open Questions

1. **How to obtain and cache Linear OAuth user ID for echo filtering**
   - What we know: Linear credentials are stored in `linear.credentials` table with encrypted access tokens. The Linear SDK has a `viewer` query that returns the authenticated user's ID.
   - What's unclear: Should the user ID be queried at startup and cached? Stored alongside the credential in the database? Or queried per-webhook (expensive)?
   - Recommendation: Query on first use and cache in-memory (simple, avoids schema migration). If the service restarts, it re-queries. The `viewer` query is a single GraphQL call -- not expensive. Could add a `linear_bot_user_id` column later if the query becomes a concern.

2. **SLACK_TEAM_ID availability**
   - What we know: The Slack team ID flows through event payloads (`teamId` field in adapters) but is NOT currently in the agent env config. The Slack credential store has it per-workspace (`botId`, `botUserId` fields).
   - What's unclear: Should we add `SLACK_TEAM_ID` as a required env var, or resolve it from the Slack credential store at startup?
   - Recommendation: Add `SLACK_TEAM_ID` as an env var in the agent service config. It's deployment configuration (same as `SLACK_CHANNEL_ID`), not dynamic data. Simpler than querying the Slack credential store across package boundaries.

3. **enrichInitialMessage signature change**
   - What we know: The function currently takes `(event, deps, message?)`. For defaultNotifyTarget, it also needs the `agentDefinitionId` to resolve per-agent channels.
   - What's unclear: Should `agentDefinitionId` be added to the function signature, or to `EnrichmentDeps`?
   - Recommendation: Add it to the function signature as a 4th parameter (optional, for backward compat). It's a per-call value, not a dependency. Both callers in `router.ts` have access to the agent definition ID from the route decision.

4. **GitHub echo filter scope**
   - What we know: GitHub webhook handler does NOT currently process `issue_comment` or `pull_request_review_comment` events. Echo filtering for GitHub is theoretical -- the agent can create PR comments via `communication:reply` (routed through denormalizer to `github:create_pr_comment`), but there's no inbound webhook path for those comments to echo back.
   - What's unclear: Should we add `GITHUB_APP_ID` config as forward-looking preparation, or defer entirely?
   - Recommendation: Defer. The CONTEXT.md says "Match `comment.performed_via_github_app.id` against Aesir GitHub App's configured App ID" but since no GitHub comment webhook handler exists, this is dead code. Add it when GitHub comment webhooks are implemented. Note this in the plan as "verified not needed yet."

## Sources

### Primary (HIGH confidence)
- Codebase analysis: All code references verified by reading actual source files
- `packages/agents/definitions/dev-agent/prompt.md` -- 3 Slack references identified at lines 12, 129, 137
- `packages/agents/definitions/product-agent/prompt.md` -- `<slack_context>`, constraint, and examples identified
- `packages/agents/src/shared/tools/communication/` -- Phase 63 tools verified as complete and registered
- `packages/agents/src/shared/communication/denormalizer.ts` -- routing logic verified for all 3 channels
- `packages/agents/src/router/enrichment.ts` -- `<slack_context>` block at lines 62-73 confirmed
- `packages/integrations/slack/src/main.ts` line 318 -- bot_id filter confirmed
- `packages/integrations/linear/src/api/webhooks.ts` -- Comment handler at lines 106-170, NO echo filter
- `packages/integrations/linear/src/webhooks/parser.ts` -- CommentPayload includes `data.userId`
- `packages/integrations/github/src/api/webhooks.ts` -- Only handles `pull_request_review` and `pull_request` (closed)
- `packages/agents/src/shared/env/config.ts` -- Has `SLACK_CHANNEL_ID`, `DEV_AGENT_SLACK_CHANNEL`, no `SLACK_TEAM_ID`

### Secondary (MEDIUM confidence)
- Linear webhook payload structure: userId field in comment data based on Zod schema in parser.ts and the existing `normalizeCommentCreatedEvent` function that maps `payload.data.userId`
- Bolt framework bot_id filtering behavior based on Slack's Events API documentation and observed code pattern

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new libraries, all existing code verified
- Architecture: HIGH -- communication tools exist, enrichment pattern established, echo filter locations identified
- Pitfalls: HIGH -- echo loop risk is the primary concern, well-understood from codebase analysis
- Prompt guidance: HIGH -- PROMPT_GUIDE.md is explicit, existing prompts analyzed line by line

**Research date:** 2026-02-09
**Valid until:** 2026-03-09 (stable -- no external dependencies changing)
