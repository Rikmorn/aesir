# Phase 23: Event Infrastructure - Research

**Researched:** 2026-01-25
**Domain:** Nginx gateway, event normalization, dispatcher pattern
**Confidence:** HIGH

## Summary

Phase 23 builds the event infrastructure plumbing to route external webhooks through an nginx gateway to integration services, normalize them to a common event schema, and dispatch to agent `/events` endpoints. The codebase already has significant infrastructure in place: nginx gateway with path-based routing (Phase 22), webhook verification and parsing in each integration (Phases 16-18), and an agent HTTP server accepting webhooks.

The main work involves: (1) verifying and hardening the existing nginx configuration, (2) defining and implementing the NormalizedEvent schema in `@aesir/common`, (3) adding event normalization to each integration's webhook handler, (4) implementing a dispatcher module in each integration, and (5) adding a `/events` endpoint to the dev-agent.

**Primary recommendation:** Implement dispatcher as a thin HTTP client module within each integration (not a separate service), keeping deployment simple while maintaining clear boundaries.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| nginx | 1.25-alpine | Reverse proxy gateway | Already in docker-compose, proven stable |
| cloudflared | 2025.2.0 | Tunnel external traffic to nginx | Already in docker-compose with tunnel profile |
| express | ^4.18.2 | HTTP server in integrations | Already used in all integration services |
| zod | ^3.22.0 | Schema validation | Already used for webhook payload validation |
| fetch-retry-ts | existing | HTTP client with retry | Already used in MCP client |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| nanoid | ^5.0.0 | Generate event IDs | Already in @aesir/common, use `createId` pattern |
| pino | ^8.x | Logging with correlation IDs | Already in @aesir/common |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Per-integration dispatcher | Separate dispatcher service | More complex deployment, but better for multi-tenant |
| Fire-and-forget HTTP | Message queue (Redis/RabbitMQ) | Guaranteed delivery, but deferred to v3.0 |
| Type-only routing | Payload field filters | More flexible, but adds complexity (deferred) |

**Installation:**
No new dependencies required. All libraries already present in the monorepo.

## Architecture Patterns

### Existing Structure (Already in Place)

The codebase has the foundation built:

```
External Service (Linear/GitHub/Slack)
         |
         v
Cloudflare Tunnel (tunnel profile in docker-compose)
         |
         v
nginx:80 (/linear/*, /github/*, /slack/*, /agent/*)
         |
         v
Integration Service (3001/3002/3003)
   - Signature verification (DONE)
   - Idempotency check (DONE)
   - Payload parsing (DONE)
   - [NEW] Normalize to NormalizedEvent
   - [NEW] Dispatch to agent
         |
         v
Agent /events endpoint (3004)
```

### Pattern 1: Normalized Event Schema

**What:** Common event structure across all integrations
**When to use:** All webhook-to-agent communication
**Example:**
```typescript
// Source: CONTEXT.md decisions
interface NormalizedEvent {
  id: string;                    // Unique event ID (evt_<nanoid>)
  type: string;                  // e.g., "linear.issue.created"
  source: "linear" | "github" | "slack";
  timestamp: string;             // ISO 8601
  correlationId: string;         // For log correlation
  payload: unknown;              // Source-specific payload
}

// Event types use dotted notation: {source}.{resource}.{action}
// Examples:
// - linear.issue.created
// - linear.issue.updated
// - linear.agent_session.created
// - github.pull_request.review_submitted
// - github.pull_request.merged
// - slack.message.created
// - slack.app_mention.created
// - slack.block_actions.clicked
```

### Pattern 2: Integration-Embedded Dispatcher

**What:** Each integration has its own dispatcher module (not a shared service)
**When to use:** All event dispatch from integrations to agents
**Example:**
```typescript
// Source: Architecture decision - dispatcher lives in each integration
// packages/integrations/linear/src/dispatcher/

// Route configuration as TypeScript const
const DISPATCH_ROUTES: DispatchRoute[] = [
  {
    eventType: "linear.agent_session.created",
    target: "http://dev-agent:3004/events",
    mode: "async", // 5s timeout
  },
  {
    eventType: "linear.agent_session.prompted",
    target: "http://dev-agent:3004/events",
    mode: "sync", // 30s timeout
  },
];

// Dispatcher is a simple HTTP POST with timeout
async function dispatchEvent(event: NormalizedEvent): Promise<void> {
  const routes = DISPATCH_ROUTES.filter(r =>
    event.type === r.eventType || event.type.startsWith(r.eventType.replace('.*', ''))
  );

  for (const route of routes) {
    const timeout = route.mode === 'async' ? 5000 : 30000;

    // Fire-and-forget - don't await, just log errors
    dispatchToTarget(route.target, event, timeout).catch(err => {
      logger.error({ err, eventId: event.id, target: route.target }, 'Dispatch failed');
    });
  }
}
```

### Pattern 3: Agent Events Endpoint

**What:** HTTP endpoint on agents that receives normalized events
**When to use:** All agent event ingestion
**Example:**
```typescript
// Source: Current dev-agent start script pattern
// packages/agents/src/scripts/start-dev-agent.ts

// Add /events endpoint alongside existing /webhooks/* endpoints
if (req.method === 'POST' && req.url === '/events') {
  const event = JSON.parse(rawBody) as NormalizedEvent;

  // Validate with Zod
  const parsed = NormalizedEventSchema.safeParse(event);
  if (!parsed.success) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid event', details: parsed.error }));
    return;
  }

  // Route to appropriate handler based on event type
  switch (event.source) {
    case 'linear':
      await handleLinearEvent(parsed.data);
      break;
    case 'github':
      await handleGitHubEvent(parsed.data);
      break;
    case 'slack':
      await handleSlackEvent(parsed.data);
      break;
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ received: true }));
}
```

### Anti-Patterns to Avoid

- **Shared dispatcher service:** Don't create a separate service just for dispatch - increases deployment complexity without benefit for single-tenant MVP
- **Database queue for events:** Don't persist events before dispatch - fire-and-forget is acceptable for v2.1 (dead letter queue deferred)
- **Payload filtering in routes:** Don't add label/field filters to routes - keep simple, let agents filter in handlers
- **Awaiting dispatch responses:** Don't block webhook response on dispatch completion - return 200 immediately, dispatch async

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Event IDs | Custom UUID | `createId` from @aesir/common | Consistent prefixed IDs across codebase |
| HTTP retry | Custom retry loop | `fetch-retry-ts` from MCP client | Already proven, exponential backoff |
| Zod schemas | Ad-hoc validation | Zod discriminated unions | Type inference, error messages |
| Correlation IDs | Generate per-request | Extract from webhook or generate once | Trace through entire flow |
| Signature verification | Custom HMAC | Existing integration `verifySignature` | Timing-safe, already tested |
| Idempotency | Custom dedup | Existing delivery stores | Per-integration, already working |

**Key insight:** The integrations already have webhook verification, parsing, and idempotency. This phase adds normalization and dispatch on top, not a replacement.

## Common Pitfalls

### Pitfall 1: Blocking Webhook Response on Dispatch

**What goes wrong:** Webhook times out because dispatch to agent takes too long
**Why it happens:** Awaiting dispatch HTTP response before returning 200 to webhook sender
**How to avoid:** Return 200 immediately after verification/parsing, dispatch fire-and-forget
**Warning signs:** Linear/GitHub/Slack reporting webhook timeouts; integration logs show long request times

### Pitfall 2: Losing Correlation ID Across Services

**What goes wrong:** Cannot trace event from webhook receipt to agent processing
**Why it happens:** Not propagating correlation ID through normalize -> dispatch -> agent
**How to avoid:** Set correlationId from webhook delivery ID (linear-delivery, x-github-delivery) or generate once at normalization, pass to dispatch headers and agent
**Warning signs:** Logs don't connect; debugging requires manual timestamp matching

### Pitfall 3: nginx Path Stripping Breaks Routing

**What goes wrong:** Integration receives wrong path (e.g., `/webhook` instead of `/linear/webhook`)
**Why it happens:** nginx `proxy_pass http://backend/` strips location prefix by default
**How to avoid:** Current config uses `proxy_pass http://linear/;` which strips `/linear/` - verify integration routes expect paths without prefix
**Warning signs:** 404 errors; integration logs show unexpected paths

### Pitfall 4: Missing Raw Body for Signature Verification

**What goes wrong:** Signature verification fails even with correct secret
**Why it happens:** Body parsed as JSON before signature check (body differs from raw)
**How to avoid:** Apply `express.raw()` middleware before JSON parsing for webhook routes
**Warning signs:** All webhooks fail signature check; works locally but fails in docker

### Pitfall 5: Slack 3-Second Timeout

**What goes wrong:** Slack retries events, causing duplicates
**Why it happens:** Not responding within 3 seconds
**How to avoid:** Return 200 immediately after idempotency check, process async
**Warning signs:** Slack events processed multiple times; `X-Slack-Retry-Num` headers in logs

### Pitfall 6: Docker Network Name vs localhost

**What goes wrong:** Dispatcher can't reach agents
**Why it happens:** Using `localhost:3004` instead of Docker network name `dev-agent:3004`
**How to avoid:** Use Docker service names in dispatch URLs (already set up in docker-compose)
**Warning signs:** Connection refused; ECONNREFUSED to localhost inside container

## Code Examples

Verified patterns from existing codebase:

### NormalizedEvent Schema (to add to @aesir/common)
```typescript
// Source: CONTEXT.md + existing pattern from @aesir/common/mcp
import { z } from "zod";

export const NormalizedEventSchema = z.object({
  id: z.string().startsWith("evt_"),
  type: z.string().regex(/^(linear|github|slack)\.[a-z_]+\.[a-z_]+$/),
  source: z.enum(["linear", "github", "slack"]),
  timestamp: z.string().datetime(),
  correlationId: z.string(),
  payload: z.unknown(),
});

export type NormalizedEvent = z.infer<typeof NormalizedEventSchema>;

// Add to createId in @aesir/common/utils/ids.ts
export const createId = {
  // ... existing
  event: () => `evt_${nanoid()}`,
};
```

### Linear Event Normalization
```typescript
// Source: Existing webhook handler pattern in linear/src/api/webhooks.ts
import { createId } from "@aesir/common";
import type { NormalizedEvent } from "@aesir/common";
import type { AgentSessionPayload } from "../webhooks/types.js";

function normalizeAgentSessionEvent(
  payload: AgentSessionPayload,
  deliveryId: string
): NormalizedEvent {
  return {
    id: createId.event(),
    type: `linear.agent_session.${payload.action}`, // created | prompted
    source: "linear",
    timestamp: new Date(payload.webhookTimestamp).toISOString(),
    correlationId: deliveryId,
    payload: payload.agentSession,
  };
}
```

### Dispatcher Module
```typescript
// Source: Pattern from MCP client (packages/agents/src/mcp/client.ts)
import { fetchBuilder } from "fetch-retry-ts";
import type { NormalizedEvent } from "@aesir/common";
import type { PinoLogger } from "@aesir/common";

const fetchWithRetry = fetchBuilder(fetch);

interface DispatchRoute {
  eventType: string;
  target: string;
  mode: "async" | "sync";
}

interface DispatcherOptions {
  logger: PinoLogger;
  routes: DispatchRoute[];
}

export function createDispatcher(options: DispatcherOptions) {
  const { logger, routes } = options;

  return {
    async dispatch(event: NormalizedEvent): Promise<void> {
      const matchingRoutes = routes.filter(r =>
        event.type === r.eventType
      );

      for (const route of matchingRoutes) {
        const timeout = route.mode === "async" ? 5000 : 30000;

        // Fire-and-forget: don't await
        fetchWithRetry(route.target, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Correlation-ID": event.correlationId,
            "X-Event-ID": event.id,
          },
          body: JSON.stringify(event),
          signal: AbortSignal.timeout(timeout),
          retries: 0, // No retries for fire-and-forget
        }).catch((err) => {
          logger.error(
            { err, eventId: event.id, target: route.target },
            "Event dispatch failed"
          );
        });
      }
    },
  };
}
```

### Agent Events Endpoint
```typescript
// Source: Pattern from start-dev-agent.ts webhook handling
// Add to packages/agents/src/scripts/start-dev-agent.ts

import { NormalizedEventSchema } from "@aesir/common";

// In the HTTP server request handler:
if (req.method === "POST" && req.url === "/events") {
  const childLogger = logger.child({
    endpoint: "/events",
    correlationId: req.headers["x-correlation-id"],
    eventId: req.headers["x-event-id"],
  });

  try {
    const event = JSON.parse(rawBody);
    const parsed = NormalizedEventSchema.safeParse(event);

    if (!parsed.success) {
      childLogger.warn({ errors: parsed.error.errors }, "Invalid event payload");
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid event" }));
      return;
    }

    childLogger.info(
      { eventType: parsed.data.type, source: parsed.data.source },
      "Event received"
    );

    // For v2.1: just acknowledge, actual handling in later phases
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ received: true, eventId: parsed.data.id }));
  } catch (err) {
    childLogger.error({ err }, "Error processing event");
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Internal server error" }));
  }
  return;
}
```

### nginx Health Check Improvements
```nginx
# Source: Current nginx/nginx.conf with recommended additions
# Add upstream health checks (passive)
upstream linear {
    server linear-integration:3001;
    # Passive health check - nginx marks as failed after errors
}

# Add timeout settings for webhook endpoints
location /linear/ {
    proxy_pass http://linear/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # Preserve raw body for signature verification
    proxy_pass_request_body on;

    # Timeouts for webhook processing
    proxy_connect_timeout 5s;
    proxy_send_timeout 60s;
    proxy_read_timeout 60s;

    # Disable buffering for faster webhook response
    proxy_buffering off;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Central event bus | Integration-local dispatch | v2.1 decision | Simpler deployment, no cross-service coordination |
| Database queue | Fire-and-forget HTTP | v2.1 decision | Acceptable event loss for MVP, simpler |
| Complex routing rules | Type-only matching | v2.1 decision | Agents handle filtering, routes stay simple |

**Deprecated/outdated:**
- Direct SDK calls from agents: Replaced by MCP in Phase 19
- Agent-side webhook handling: Moving to integration-side normalization + dispatch

## Open Questions

Things that couldn't be fully resolved:

1. **Event schema placement**
   - What we know: NormalizedEvent type needs to be in @aesir/common for sharing
   - What's unclear: Should Zod schema live in common or be duplicated in each consumer?
   - Recommendation: Put schema in @aesir/common, export alongside type

2. **Multi-agent routing**
   - What we know: E2E test routes to dev-agent only
   - What's unclear: How will product-agent receive slack events?
   - Recommendation: Add product-agent route in slack integration dispatcher, verify in later phase

3. **Event type catalog**
   - What we know: Examples given for common events
   - What's unclear: Full list of event types each integration should emit
   - Recommendation: Start with events needed for E2E (agent_session.created, agent_session.prompted), expand later

## Sources

### Primary (HIGH confidence)
- Existing codebase: nginx/nginx.conf, docker-compose.yml, integration webhook handlers
- CONTEXT.md decisions from /gsd:discuss-phase
- CLAUDE.md architecture documentation

### Secondary (MEDIUM confidence)
- [nginx reverse proxy documentation](https://docs.nginx.com/nginx/admin-guide/web-server/reverse-proxy/) - timeout and buffer settings
- [nginx proxy module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html) - configuration options
- [Cloudflare Tunnel documentation](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/) - outbound-only connection model

### Tertiary (LOW confidence)
- WebSearch patterns for event dispatcher architecture - verified against existing MCP client pattern in codebase

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all libraries already in use, no new dependencies
- Architecture: HIGH - builds on existing patterns (webhook handlers, MCP client)
- Pitfalls: HIGH - derived from existing codebase patterns and documented gotchas

**Research date:** 2026-01-25
**Valid until:** 60 days (stable infrastructure, well-established patterns)
