# Phase 7: Slack Integration - Research

**Researched:** 2026-01-16
**Domain:** Slack notifications (one-way)
**Confidence:** HIGH

<research_summary>
## Summary

Researched the Slack API ecosystem for one-way notification delivery. This is a **commodity integration** — the Slack Web API for posting messages is mature, well-documented, and stable.

For v1 scope (notifications only, no interactivity), the implementation is straightforward:
- Use `@slack/web-api` official SDK
- Single `chat.postMessage` method covers all requirements
- Bot token authentication (no OAuth flow needed for notifications)

The existing codebase integration pattern (Linear, GitHub) provides a proven template. No specialized patterns or research-intensive areas identified.

**Primary recommendation:** Simple `@slack/web-api` client following existing integration patterns. One module for notifications, minimal abstraction. Don't over-engineer for future interactivity.
</research_summary>

<standard_stack>
## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @slack/web-api | ^7.13.0 | Slack Web API client | Official SDK, TypeScript-first, built-in retry/queuing |

### Not Needed (v1)
| Library | Purpose | Why Skip |
|---------|---------|----------|
| @slack/bolt | Interactive apps | v1 is one-way notifications only |
| @slack/socket-mode | WebSocket events | No event listening needed |
| @slack/oauth | OAuth flows | Bot token is sufficient |
| @slack/webhook | Incoming webhooks | Web API is more flexible |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| @slack/web-api | Incoming Webhooks | Webhooks simpler but less flexible (can't DM, limited formatting) |
| @slack/web-api | @slack/bolt | Bolt adds complexity for interactive features we don't need |
| Bot token | User OAuth | User OAuth requires OAuth flow; bot token is simpler for system notifications |

**Installation:**
```bash
npm install @slack/web-api
```

**No types package needed** — @slack/web-api is TypeScript-first with included types.
</standard_stack>

<architecture_patterns>
## Architecture Patterns

### Recommended Project Structure
```
src/integrations/slack/
├── types.ts        # SlackConfig, NotificationPayload types
├── client.ts       # WebClient factory with logging
├── notifications.ts # postNotification, formatApprovalMessage
├── notifications.test.ts
└── index.ts        # Public exports
```

This mirrors the Linear and GitHub integration patterns already in the codebase.

### Pattern 1: Simple Client Factory
**What:** Create WebClient with token, log operations
**When to use:** All Slack operations
**Example:**
```typescript
// Source: Existing codebase pattern (GitHub client)
import { WebClient } from "@slack/web-api";
import { createLogger } from "../../logging/logger.js";
import type { SlackConfig } from "./types.js";

const logger = createLogger({ defaultContext: { module: "slack-client" } });

export function createSlackClient(config: SlackConfig): WebClient {
  logger.debug("slack_client_create", {
    message: "Creating Slack client",
  });

  return new WebClient(config.botToken);
}
```

### Pattern 2: Typed Notification Payloads
**What:** Define notification types, not raw Block Kit JSON
**When to use:** Any notification sending
**Example:**
```typescript
// Domain types for clarity
interface ApprovalNotification {
  type: "approval_needed";
  taskId: string;
  prUrl: string;
  summary: string;
}

interface StatusNotification {
  type: "status_update";
  taskId: string;
  status: "started" | "completed" | "failed";
  details: string | null;
}

type Notification = ApprovalNotification | StatusNotification;
```

### Pattern 3: Destination Configuration
**What:** Channel/DM target as config, not hardcoded
**When to use:** All notifications
**Example:**
```typescript
interface SlackConfig {
  botToken: string;
  defaultChannel: string;  // Channel ID for general notifications
}

// Allow per-notification override
async function postNotification(
  client: WebClient,
  notification: Notification,
  channel?: string  // Override default
): Promise<void>
```

### Anti-Patterns to Avoid
- **Raw Block Kit everywhere:** Define domain types, convert to blocks at edge
- **Hardcoded channels:** Make destination configurable
- **Over-abstraction:** Don't build a "messaging platform abstraction" for one provider
- **Error swallowing:** Propagate Slack API errors to caller
</architecture_patterns>

<dont_hand_roll>
## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP to Slack API | Custom fetch calls | WebClient | SDK handles auth, rate limits, retries |
| Message formatting | String concatenation | Block Kit mrkdwn | Consistent formatting, mobile support |
| Retry logic | Custom retry wrapper | WebClient (built-in) | SDK has production-tested retry/queue |

**Key insight:** The Slack SDK is battle-tested. It handles rate limiting, retries, and edge cases. A custom HTTP client would be worse in every way.
</dont_hand_roll>

<common_pitfalls>
## Common Pitfalls

### Pitfall 1: Channel IDs vs Names
**What goes wrong:** Using `#channel-name` instead of channel ID `C1234567890`
**Why it happens:** Slack UI shows names, API requires IDs
**How to avoid:** Always configure channel IDs, not names. Document how to find IDs.
**Warning signs:** "channel_not_found" errors with correct-looking names

### Pitfall 2: Missing Bot Scopes
**What goes wrong:** `chat.postMessage` fails with "missing_scope"
**Why it happens:** Bot token missing required OAuth scope
**How to avoid:** Ensure bot has `chat:write` scope at minimum. Add `chat:write.public` for channels bot isn't member of.
**Warning signs:** 403 errors mentioning scopes

### Pitfall 3: DM Conversations
**What goes wrong:** Can't send DM to user
**Why it happens:** DMs use conversation IDs, not user IDs
**How to avoid:** Use `conversations.open` to get DM channel ID first, then post to that
**Warning signs:** Trying to post to user ID like `U1234567890` fails

### Pitfall 4: Message Length Limits
**What goes wrong:** Long messages truncated or rejected
**Why it happens:** Slack has text block limits
**How to avoid:** Keep approval messages concise. Truncate details if needed.
**Warning signs:** Messages cut off at ~3000 chars in text blocks
</common_pitfalls>

<code_examples>
## Code Examples

Verified patterns from official documentation:

### Basic Message Post
```typescript
// Source: @slack/web-api documentation
import { WebClient } from "@slack/web-api";

const client = new WebClient(process.env.SLACK_BOT_TOKEN);

await client.chat.postMessage({
  channel: "C1234567890",  // Channel ID
  text: "PR ready for review: https://github.com/org/repo/pull/123",
  mrkdwn: true,
});
```

### Message with Blocks (Rich Formatting)
```typescript
// Source: @slack/web-api documentation + Block Kit Builder
await client.chat.postMessage({
  channel: "C1234567890",
  text: "PR ready for review",  // Fallback for notifications
  blocks: [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*PR Ready for Review*\n<https://github.com/org/repo/pull/123|feat: Add user auth>",
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "Task: ABC-123 | Requested by: dev-agent",
        },
      ],
    },
  ],
});
```

### Send DM to User
```typescript
// Source: @slack/web-api documentation
// Step 1: Open DM conversation
const dm = await client.conversations.open({
  users: "U1234567890",  // User ID
});

// Step 2: Post to the DM channel
await client.chat.postMessage({
  channel: dm.channel!.id!,
  text: "Your PR is ready for review",
});
```
</code_examples>

<sota_updates>
## State of the Art (2024-2025)

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| @slack/events-api | @slack/bolt | 2021 (EOL) | For interactive apps; N/A for notifications |
| @slack/interactive-messages | @slack/bolt | 2021 (EOL) | Same |
| Webhook-only | Web API preferred | Ongoing | Web API more flexible, webhook still works |

**New tools/patterns to consider:**
- Block Kit Builder (https://app.slack.com/block-kit-builder) for designing messages
- AI-related blocks (citation, loading states) — not relevant for v1

**Deprecated/outdated:**
- Events API standalone package (use Bolt if needed)
- Attachment format (use Block Kit)
</sota_updates>

<open_questions>
## Open Questions

None. This is a well-understood integration with clear requirements.

**Resolved during research:**
1. **Bot token vs User token?** → Bot token. Notifications are system-generated, not user actions.
2. **Webhook vs Web API?** → Web API. More flexible (supports DMs, channel posting, formatted blocks).
3. **Block Kit vs plain text?** → Block Kit for rich formatting, with plain text fallback.
</open_questions>

<sources>
## Sources

### Primary (HIGH confidence)
- [@slack/web-api npm](https://www.npmjs.com/package/@slack/web-api) - Official package
- [Node Slack SDK GitHub](https://github.com/slackapi/node-slack-sdk) - TypeScript support, Node requirements
- [Slack Web API docs](https://api.slack.com/web) - Official documentation

### Secondary (MEDIUM confidence)
- [Slack bot best practices 2025](https://www.upsilonit.com/blog/create-a-slack-bot-with-typescript-in-3-steps) - Verified patterns
- Existing codebase integrations (Linear, GitHub) - Proven patterns for this project

### Tertiary (LOW confidence - needs validation)
- None
</sources>

<metadata>
## Metadata

**Research scope:**
- Core technology: @slack/web-api
- Ecosystem: Minimal (single package needed)
- Patterns: Client factory, notification posting
- Pitfalls: Channel IDs, scopes, DM handling

**Confidence breakdown:**
- Standard stack: HIGH - Official SDK, well-documented
- Architecture: HIGH - Follows existing codebase patterns
- Pitfalls: HIGH - Common issues well-documented
- Code examples: HIGH - From official documentation

**Research date:** 2026-01-16
**Valid until:** 2027-01-16 (1 year - Slack API is stable)
</metadata>

---

*Phase: 07-slack-integration*
*Research completed: 2026-01-16*
*Ready for planning: yes*
