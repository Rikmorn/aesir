# Phase 18: Slack Extraction - Research

**Researched:** 2026-01-23
**Domain:** Slack Bolt framework extraction, OAuth, event handling, conversational AI
**Confidence:** HIGH

## Summary

Phase 18 extracts the Slack integration into an independent package following the established Linear (Phase 16) and GitHub (Phase 17) patterns. Unlike Linear and GitHub which use raw Express, Slack requires keeping the Bolt framework for its connection lifecycle, OAuth installationStore, and event handling middleware. The extraction follows the same architectural principles (independent package, own schema, HTTP service, credential encryption) but adapts to Bolt's framework-specific patterns.

The existing codebase already has foundational Slack code in `packages/integrations/src/slack/` including WebClient factories, notification formatting with Block Kit, and basic Bolt app lifecycle. The extraction will move this to `packages/integrations/slack/` and enhance it with database-backed OAuth storage, event delivery tracking for idempotency, and production-ready HTTP mode support.

**Primary recommendation:** Keep Bolt framework, implement custom installationStore backed by PostgreSQL, support both Socket Mode (dev) and HTTP mode (production), use event_id for deduplication, emit typed events for agent consumption, and follow the established extraction pattern with slack.* schema namespace.

## Standard Stack

The established libraries/tools for Slack integration:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @slack/bolt | ^4.6.0 | Slack app framework | Official Slack framework, handles OAuth, events, acknowledgments, middleware |
| @slack/web-api | (via Bolt) | Slack Web API client | Bundled with Bolt, used for posting messages, API calls |
| drizzle-orm | ^0.45.1 | PostgreSQL ORM | Established in v2.0 for schema management and queries |
| express | ^4.21.0 | HTTP server | Consistent with Linear/GitHub for webhook endpoints |
| neverthrow | ^8.2.0 | Result types | v2.0 standard for error handling at service boundaries |
| zod | 3.25.67 | Schema validation | v2.0 standard for config and API input validation |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| crypto (Node.js) | built-in | Token encryption | Same encryption pattern as Linear/GitHub |
| @aesir/common | workspace:* | Pino logger, ID generation, error classes | Platform utilities |
| @aesir/platform | workspace:* | Database client | Shared PostgreSQL connection (if needed) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Bolt | Raw Express + Events API | Bolt provides OAuth, retries, acknowledgments - don't rebuild |
| PostgreSQL installationStore | File storage | File storage not production-safe, fails in containers |
| HTTP mode | Socket Mode only | Socket Mode limited to 10 connections, not Marketplace-allowed |

**Installation:**
```bash
pnpm add @slack/bolt@^4.6.0 --filter @aesir/integration-slack
```

## Architecture Patterns

### Recommended Project Structure
```
packages/integrations/slack/
├── src/
│   ├── api/                 # HTTP routes
│   │   ├── webhooks.ts      # POST /webhooks/slack (events)
│   │   ├── oauth.ts         # OAuth flow routes (/authorize, /callback)
│   │   ├── routes.ts        # Aggregation router
│   │   └── index.ts
│   ├── client/              # Slack client factory
│   │   ├── factory.ts       # createSlackClient from DB
│   │   ├── bolt-factory.ts  # createBoltApp with custom installationStore
│   │   └── index.ts
│   ├── db/                  # Database layer
│   │   ├── schema.ts        # slack.* namespace definitions
│   │   ├── schema.drizzle.ts # Drizzle schema export
│   │   ├── encryption.ts    # encryptToken, decryptToken
│   │   ├── credential-store.ts # Installation storage (Bolt installationStore)
│   │   ├── event-delivery-store.ts # Deduplication via event_id
│   │   ├── client.ts        # db connection
│   │   └── index.ts
│   ├── oauth/               # OAuth flow helpers
│   │   ├── flow.ts          # High-level OAuth utilities
│   │   ├── installation-store.ts # Bolt installationStore adapter
│   │   └── index.ts
│   ├── events/              # Event handling
│   │   ├── parser.ts        # Parse Slack events into typed payloads
│   │   ├── emitter.ts       # Emit events to consumer (agent layer)
│   │   ├── types.ts         # Event payload types
│   │   └── index.ts
│   ├── messages/            # Message posting
│   │   ├── sender.ts        # postMessage with threading
│   │   ├── blocks.ts        # Block Kit builders (approval buttons, etc)
│   │   └── index.ts
│   ├── types/               # Type definitions
│   │   ├── config.ts        # Environment config schema
│   │   ├── errors.ts        # SlackError classes
│   │   └── index.ts
│   ├── index.ts             # Barrel exports
│   └── main.ts              # HTTP server entry point
├── Dockerfile               # Independent deployment
├── package.json             # @aesir/integration-slack
└── tsconfig.json            # TypeScript config
```

### Pattern 1: Bolt installationStore Adapter

**What:** Bolt's OAuth requires implementing the installationStore interface with three methods: storeInstallation, fetchInstallation, deleteInstallation. The adapter bridges Bolt's interface to PostgreSQL-backed credential storage.

**When to use:** Required for production OAuth support with multiple workspaces.

**Example:**
```typescript
// Source: https://docs.slack.dev/tools/bolt-js/concepts/authenticating-oauth/
import type { Installation, InstallationQuery } from '@slack/bolt';

export function createSlackInstallationStore(options: {
  credentialStore: SlackCredentialStore;
  logger: PinoLogger;
}): InstallationStore {
  const { credentialStore, logger } = options;

  return {
    storeInstallation: async (installation: Installation) => {
      const teamId = installation.team.id;
      logger.info({ teamId }, 'Storing Slack installation');

      await credentialStore.store({
        workspaceId: teamId,
        accessToken: installation.bot.token,
        scope: installation.bot.scopes?.join(','),
        // Store enterprise_id, user_id if needed
      });
    },

    fetchInstallation: async (query: InstallationQuery) => {
      const teamId = query.teamId;
      logger.debug({ teamId }, 'Fetching Slack installation');

      const credential = await credentialStore.getByWorkspace(teamId);
      if (!credential) return undefined;

      // Reconstruct Installation object from credential
      return {
        team: { id: teamId },
        bot: { token: credential.accessToken, scopes: credential.scope?.split(',') },
      };
    },

    deleteInstallation: async (query: InstallationQuery) => {
      const teamId = query.teamId;
      await credentialStore.delete({ workspaceId: teamId });
    },
  };
}
```

### Pattern 2: Event Deduplication with event_id

**What:** Slack includes a unique `event_id` field in every event payload. Store processed event_ids in PostgreSQL to detect and skip duplicate deliveries (retries, network issues).

**When to use:** All event handling - Slack retries failed events, must deduplicate.

**Example:**
```typescript
// Source: https://api.slack.com/events-api (Events include event_id)
import type { EventDeliveryStore } from '../db/event-delivery-store.js';

export async function handleSlackEvent(options: {
  event: SlackEvent;
  deliveryStore: EventDeliveryStore;
  logger: PinoLogger;
}) {
  const { event, deliveryStore, logger } = options;
  const eventId = event.event_id;

  // Check if already processed
  const result = await deliveryStore.isDeliveryProcessed(eventId);
  if (result.isErr()) throw result.error;

  if (result.value) {
    logger.info({ eventId }, 'Duplicate event, skipping');
    return;
  }

  // Process event
  logger.info({ eventId, type: event.type }, 'Processing new event');
  await processEvent(event);

  // Record as processed
  await deliveryStore.recordDelivery({
    deliveryId: eventId,
    eventType: event.type,
  });
}
```

### Pattern 3: Dual Connection Mode Support

**What:** Support both Socket Mode (WebSocket, development) and HTTP mode (production, scalable). Configuration determines which mode to use.

**When to use:** Socket Mode for local dev, HTTP mode for production deployment.

**Example:**
```typescript
// Source: https://docs.slack.dev/apis/events-api/comparing-http-socket-mode/
export interface SlackConfig {
  server: {
    port: number;
    mode: 'http' | 'socket';
  };
  slack: {
    botToken: string;
    appToken?: string; // Only for Socket Mode
    signingSecret: string; // Only for HTTP mode
  };
}

export function createBoltApp(config: SlackConfig): App {
  if (config.server.mode === 'socket') {
    return new App({
      token: config.slack.botToken,
      appToken: config.slack.appToken!,
      socketMode: true,
    });
  } else {
    return new App({
      token: config.slack.botToken,
      signingSecret: config.slack.signingSecret,
      socketMode: false,
    });
  }
}
```

### Pattern 4: Thread-Aware Message Posting

**What:** Use `thread_ts` parameter to reply in threads. If event has `thread_ts`, reply there. Otherwise, event.ts becomes the thread parent.

**When to use:** All conversational replies - maintains context for users.

**Example:**
```typescript
// Source: https://docs.slack.dev/reference/methods/chat.postMessage/
import { WebClient } from '@slack/web-api';

export async function postThreadReply(options: {
  client: WebClient;
  channel: string;
  text: string;
  blocks?: Block[];
  // If event is in a thread, use its thread_ts. Otherwise use event.ts
  threadTs?: string;
}) {
  const { client, channel, text, blocks, threadTs } = options;

  const result = await client.chat.postMessage({
    channel,
    text,
    blocks,
    thread_ts: threadTs, // Reply in thread if provided
  });

  return {
    ts: result.ts,
    channel: result.channel,
  };
}
```

### Pattern 5: 3-Second Acknowledgment Rule

**What:** Slack requires acknowledgment within 3 seconds or marks event as failed (triggers retries). Acknowledge immediately, process async.

**When to use:** All interactive events (actions, shortcuts, views) and long-running event processing.

**Example:**
```typescript
// Source: https://docs.slack.dev/tools/bolt-python/concepts/acknowledge/
app.action('approve_button', async ({ ack, body, client }) => {
  // Acknowledge immediately (< 3 seconds)
  await ack();

  // Process async (can take longer)
  await processApproval({
    userId: body.user.id,
    channel: body.channel.id,
    client,
  });
});
```

### Anti-Patterns to Avoid

- **Don't use FileInstallationStore in production:** File storage breaks in containers, doesn't scale across instances.
- **Don't process events without deduplication:** Slack retries failed events, you'll process duplicates.
- **Don't use Socket Mode for production at scale:** Limited to 10 connections, not allowed in Marketplace.
- **Don't forget to acknowledge within 3 seconds:** Slack marks as timeout, retries event, creates duplicate processing.
- **Don't store thread context in package:** Package delivers events stateless, agent layer manages conversation context.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| OAuth flow | Custom OAuth endpoints | Bolt's built-in OAuth | Handles state verification, token exchange, installationStore lifecycle |
| Event acknowledgment | Manual ack timing | Bolt's ack() function | Framework ensures 3-second compliance, handles retries |
| WebSocket management | Custom WebSocket code | Socket Mode in Bolt | Manages connection lifecycle, reconnection, URL refresh |
| Slack signature verification | Custom HMAC verification | Bolt's built-in verification | Timing-safe comparison, handles header parsing |
| Retry logic | Custom retry system | Slack's native retries + deduplication | Slack retries failed events, just deduplicate with event_id |
| Block Kit JSON | Hand-written JSON | Block Kit Builder + types | Complex JSON structure, types prevent errors |

**Key insight:** Bolt abstracts away most Slack protocol complexity. Unlike Linear/GitHub where raw Express is sufficient, Slack's OAuth flow, event acknowledgment timing, WebSocket lifecycle, and retry behavior make Bolt essential. The extraction focuses on adapting Bolt to the independent package pattern (PostgreSQL installationStore, credential encryption, event emission to agents) rather than rebuilding Bolt's functionality.

## Common Pitfalls

### Pitfall 1: Socket Mode Connection Limits

**What goes wrong:** App deployed with Socket Mode hits 10 concurrent connection limit, stops receiving events under load.

**Why it happens:** Socket Mode is designed for development, limits connections to prevent abuse. Production deployments often need more scale.

**How to avoid:** Use HTTP mode for production. Socket Mode only for local development behind firewalls.

**Warning signs:** Events delayed or dropped during high traffic. Logs show connection errors or "max connections reached."

### Pitfall 2: Missing Deduplication Causes Duplicate Operations

**What goes wrong:** Same event processed multiple times, creating duplicate Linear tickets, duplicate Slack messages, or double-billing scenarios.

**Why it happens:** Slack retries events when acknowledgment fails or times out. Without deduplication, retries are processed as new events.

**How to avoid:** Store event_id in PostgreSQL before processing. Check if event_id exists before handling event.

**Warning signs:** Users report duplicate notifications, duplicate tickets created, database constraints violated on "unique" operations.

### Pitfall 3: Blocking Operations Cause 3-Second Timeout

**What goes wrong:** Event handler performs long database query or API call, exceeds 3 seconds, Slack marks as timeout and retries.

**Why it happens:** Handler logic runs before calling ack(). Every retry creates same timeout, infinite loop.

**How to avoid:** Call ack() immediately, then process async. Pattern: `await ack(); processAsync(event);`

**Warning signs:** Slack shows "operation_timeout" errors, same event appears in logs multiple times, exponential retry backoff.

### Pitfall 4: Bolt installationStore Returns Wrong Shape

**What goes wrong:** fetchInstallation returns partial or incorrectly shaped Installation object, Bolt throws runtime errors when using client.

**Why it happens:** Bolt expects specific Installation interface with nested team/bot/user objects. Custom database schema doesn't map cleanly.

**How to avoid:** Store all Installation fields from storeInstallation, reconstruct exact shape in fetchInstallation. Test with multi-workspace installs.

**Warning signs:** Errors like "Cannot read property 'token' of undefined", OAuth succeeds but event handling fails, different workspaces behave differently.

### Pitfall 5: Thread Context Loss in Conversations

**What goes wrong:** Bot replies to mention in new message instead of thread, conversation fragments across channel.

**Why it happens:** Event has thread_ts field when in thread, but code only uses event.ts. Threads broken when thread_ts ignored.

**How to avoid:** Check for event.thread_ts || event.ts when replying. Use thread_ts if present, falls back to event.ts for new threads.

**Warning signs:** Users complain bot replies "out of context", threads appear as separate messages in channel, conversation hard to follow.

## Code Examples

Verified patterns from official sources and established codebase:

### Bolt App with Custom installationStore

```typescript
// Source: https://docs.slack.dev/tools/bolt-js/concepts/authenticating-oauth/
import { App } from '@slack/bolt';
import { createSlackInstallationStore } from './oauth/installation-store.js';
import { createSlackCredentialStore } from './db/credential-store.js';

export function createBoltApp(options: {
  db: PostgresJsDatabase;
  logger: PinoLogger;
  config: SlackConfig;
}): App {
  const { db, logger, config } = options;

  // Create credential store
  const credentialStore = createSlackCredentialStore({ db, logger });

  // Create Bolt installationStore adapter
  const installationStore = createSlackInstallationStore({
    credentialStore,
    logger,
  });

  // Create Bolt app with OAuth
  const app = new App({
    signingSecret: config.slack.signingSecret,
    clientId: config.slack.clientId,
    clientSecret: config.slack.clientSecret,
    stateSecret: config.slack.stateSecret,
    scopes: ['app_mentions:read', 'chat:write', 'channels:history'],
    installationStore, // Custom PostgreSQL-backed store
    installerOptions: {
      directInstall: true, // Enable direct install flow
    },
  });

  return app;
}
```

### Event Handling with Deduplication

```typescript
// Source: Established pattern from GitHub webhook-delivery-store.ts
import type { EventDeliveryStore } from './db/event-delivery-store.js';

export async function handleAppMention(options: {
  event: AppMentionEvent;
  deliveryStore: EventDeliveryStore;
  logger: PinoLogger;
  onMention: (payload: MentionPayload) => Promise<void>;
}) {
  const { event, deliveryStore, logger, onMention } = options;
  const eventId = event.event_id;

  // Check if already processed (deduplication)
  const processed = await deliveryStore.isDeliveryProcessed(eventId);
  if (processed.isErr()) {
    logger.error({ err: processed.error }, 'Failed to check delivery status');
    throw processed.error;
  }

  if (processed.value) {
    logger.info({ eventId }, 'Event already processed, skipping');
    return;
  }

  // Record delivery immediately to prevent race conditions
  const recorded = await deliveryStore.recordDelivery({
    deliveryId: eventId,
    eventType: 'app_mention',
  });

  if (recorded.isErr()) {
    logger.error({ err: recorded.error }, 'Failed to record delivery');
    throw recorded.error;
  }

  // Process event
  await onMention({
    userId: event.user,
    channel: event.channel,
    text: event.text,
    ts: event.ts,
    threadTs: event.thread_ts, // May be undefined
  });
}
```

### Block Kit Approval Buttons

```typescript
// Source: https://docs.slack.dev/messaging/creating-interactive-messages/
import type { Block, KnownBlock } from '@slack/web-api';

export function buildApprovalBlocks(options: {
  title: string;
  description: string;
  prUrl: string;
  actionId: string; // Unique identifier for this approval
}): (Block | KnownBlock)[] {
  const { title, description, prUrl, actionId } = options;

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${title}*\n${description}`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `<${prUrl}|View Pull Request>`,
      },
    },
    {
      type: 'actions',
      block_id: `approval_${actionId}`,
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Approve' },
          style: 'primary',
          action_id: 'approve_button',
          value: actionId,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Reject' },
          style: 'danger',
          action_id: 'reject_button',
          value: actionId,
        },
      ],
    },
  ];
}
```

### Pino Logging Middleware for Bolt

```typescript
// Source: https://vercel.com/academy/slack-agents/bolt-nitro-middleware-and-logging
import type { PinoLogger } from '@aesir/common';
import type { App } from '@slack/bolt';

export function addLoggingMiddleware(app: App, logger: PinoLogger): void {
  // Add correlation ID to all events
  app.use(async ({ payload, context, next }) => {
    const eventId = 'event_id' in payload ? payload.event_id : undefined;
    const userId = 'user' in payload ? payload.user : undefined;

    // Add to context for downstream handlers
    context.logger = logger.child({ eventId, userId });

    context.logger.info(
      { type: payload.type },
      'Received Slack event',
    );

    await next();
  });
}
```

### Thread-Aware Reply

```typescript
// Source: https://docs.slack.dev/reference/methods/chat.postMessage/
import type { WebClient } from '@slack/web-api';

export async function replyToEvent(options: {
  client: WebClient;
  event: { channel: string; ts: string; thread_ts?: string };
  text: string;
  blocks?: Block[];
}): Promise<{ ts: string; channel: string }> {
  const { client, event, text, blocks } = options;

  // Use thread_ts if event is in a thread, otherwise use event.ts to start new thread
  const threadTs = event.thread_ts || event.ts;

  const result = await client.chat.postMessage({
    channel: event.channel,
    text,
    blocks,
    thread_ts: threadTs, // Maintains thread context
  });

  return {
    ts: result.ts!,
    channel: result.channel!,
  };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Socket Mode only | HTTP mode primary, Socket for dev | Bolt 3.x (2021) | Better production scalability, Marketplace eligibility |
| File-based token storage | Database installationStore | Bolt 2.x (2020) | Multi-workspace support, containerization |
| Manual ack timing | Automatic ack in middleware | Bolt 2.x (2020) | Reduced timeout errors, better reliability |
| String-based event types | Typed event interfaces | @slack/web-api 6.x (2022) | Type safety, autocomplete, fewer runtime errors |
| Individual API calls | Bulk operations | Web API 7.x (2024) | Performance improvement for batch operations |
| Polling for events | WebSocket + Events API | 2019 | Real-time event delivery, reduced latency |

**Deprecated/outdated:**
- **Legacy tokens (xoxp, xoxs):** Use OAuth 2.0 bot tokens (xoxb-) exclusively. Legacy tokens lack granular permissions.
- **RTM API:** Use Events API or Socket Mode instead. RTM deprecated in favor of Events API.
- **Username parameters:** Use user IDs (U123...) not @username. Display names are mutable and deprecated in many endpoints.

## Open Questions

### Question 1: Single vs Multi-Bot Support per Process

**What we know:** Linear and GitHub use workspace_id/owner as identifier (one credential per workspace). Slack installationStore supports multiple team installations in single process.

**What's unclear:** Should Slack package support multiple bot tokens (different workspaces) in one process, or deploy separate instances per workspace?

**Recommendation:** Support multi-workspace in code (matches Bolt's design), deploy single-workspace in production (simpler credential management). Configuration flag controls behavior. Default to single-workspace for v2.0, multi-workspace ready for future.

### Question 2: Enterprise Grid Support

**What we know:** Slack Enterprise Grid has enterprise_id and team_id hierarchy. Bolt's installationStore has separate enterprise and team queries.

**What's unclear:** Does Aesir need Enterprise Grid support now, or can it be deferred?

**Recommendation:** Database schema includes enterprise_id field (nullable), code handles team_id only for v2.0. Enterprise support is forward-compatible addition when needed (Phase 19+).

### Question 3: User vs Bot Token Storage

**What we know:** Slack OAuth can issue both bot tokens (xoxb-) and user tokens (xoxp-). Existing code uses bot tokens only.

**What's unclear:** Does agent layer need user tokens for any operations (posting as user, DM on behalf of user)?

**Recommendation:** Store bot tokens only for v2.0. Database schema supports token_type field, can add user tokens later if needed. Most agent operations use bot identity.

## Sources

### Primary (HIGH confidence)

- [Bolt for JavaScript Official Docs](https://docs.slack.dev/tools/bolt-js/) - Framework concepts
- [OAuth with Bolt](https://docs.slack.dev/tools/bolt-js/concepts/authenticating-oauth/) - installationStore interface
- [HTTP vs Socket Mode Comparison](https://docs.slack.dev/apis/events-api/comparing-http-socket-mode/) - Production recommendations
- [Bolt Logging Guide](https://docs.slack.dev/tools/bolt-js/concepts/logging/) - Custom logger interface
- [Using Socket Mode](https://docs.slack.dev/apis/events-api/using-socket-mode) - WebSocket lifecycle, connection limits
- [chat.postMessage API](https://docs.slack.dev/reference/methods/chat.postMessage/) - Threading parameters
- [Events API Overview](https://docs.slack.dev/apis/events-api/) - Event structure, event_id field
- [app_mention Event](https://api.slack.com/events/app_mention) - Event type documentation
- [Acknowledging Requests](https://docs.slack.dev/tools/bolt-python/concepts/acknowledge/) - 3-second timeout rule
- [@slack/bolt on npm](https://www.npmjs.com/package/@slack/bolt) - Version 4.6.0 (latest)

### Secondary (MEDIUM confidence)

- [Vercel Academy: Bolt Middleware](https://vercel.com/academy/slack-agents/bolt-nitro-middleware-and-logging) - Pino integration pattern
- [Creating Interactive Messages](https://docs.slack.dev/messaging/creating-interactive-messages/) - Block Kit approval buttons
- [Scalable Serverless Slack Bot Design](https://medium.com/@geetansh2k1/scalable-serverless-slack-bot-design-avoid-slacks-3-second-timeout-with-aws-lambda-sqs-7c91367c161d) - Deduplication strategies
- GitHub slackapi/bolt-js issues - Community patterns for installationStore, threading, deduplication

### Tertiary (LOW confidence)

- WebSearch results for retry logic - General patterns, not Bolt-specific

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Official Bolt documentation, npm registry, established versions
- Architecture: HIGH - Official Bolt patterns, Linear/GitHub extraction provides template
- Pitfalls: HIGH - Official docs + community issues provide clear warnings
- Event deduplication: MEDIUM - event_id verified in docs, implementation pattern inferred from GitHub package
- installationStore shape: MEDIUM - Interface documented, exact reconstruction pattern requires testing
- Enterprise Grid support: LOW - Requirements unclear, deferred to future phase

**Research date:** 2026-01-23
**Valid until:** 2026-02-22 (30 days - Bolt is stable framework, infrequent breaking changes)
