# Phase 75: Echo Elimination - Research

**Researched:** 2026-02-16
**Domain:** Webhook deduplication and agent echo suppression
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Echo detection approach:** Actor field inspection only -- stateless check on the webhook payload's actor/sender fields. No tool-call correlation. Unconditional: if the bot authored it, suppress it.
- **Per-integration actor identification:**
  - **Linear:** Structural check -- `actor.type === 'application'`. No config needed. Aesir is the only OAuth app in the workspace.
  - **GitHub:** Identity match -- `sender.login === env.GITHUB_APP_LOGIN`. Needed because `sender.type === 'Bot'` is too broad.
  - **Slack:** Identity match -- `app_id === env.SLACK_APP_ID`. Needed because `bot_id` presence catches every bot in the channel.
  - Two env vars on agent-service: `GITHUB_APP_LOGIN`, `SLACK_APP_ID`. Zero config for Linear.
- **Pipeline architecture:** Adapters enrich, separate filter stage decides. Pipeline: `Webhook -> Adapter (normalize + extract actor) -> Filter (dedup + echo) -> Router`
- **Filter execution mode:** Synchronous inline in POST /events handler.
- **Dedup event ID strategy:** Use each provider's canonical delivery/event identifier, namespaced: `github:{id}`, `slack:{id}`, `linear:{id}`. Each adapter owns extraction.
- **Parse order:** Dedup first, parse second. Extract event ID from raw headers/envelope, check dedup table, then parse payload.
- **Dedup storage and TTL:** `agents.processed_webhook_events (event_id TEXT PRIMARY KEY, received_at TIMESTAMPTZ DEFAULT now())`. INSERT ON CONFLICT DO NOTHING + rowCount === 0. 24-hour TTL via pg-boss hourly cleanup.
- **Suppression observability:** Log-only via pino at `debug` level. Format: `logger.debug({ eventId, eventType, reason: 'duplicate' | 'agent_echo' }, 'event suppressed')`.
- **HTTP response:** Always 200 OK for both accepted and suppressed webhooks.
- **Edge case policy: fail-open.** Missing actor data: pass through + warn log. Other bots: pass through. No semantic dedup.

### Claude's Discretion
- Exact migration SQL and table indexes
- Filter function signature and error handling
- pg-boss job scheduling configuration
- How adapters surface actor info on the normalized event (field name, shape)

### Deferred Ideas (OUT OF SCOPE)
- Event emission for suppression telemetry -- Phase 77 (Dashboard Observability) decides what to persist
- Semantic/logical dedup (same entity state, different deliveries) -- Phase 78 (Work Correlation) disposition model
- Suppression metrics/dashboard visibility -- Phase 77 scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| ECHO-01 | Duplicate webhook deliveries rejected at adapter level via event ID dedup table (24h TTL cleanup via pg-boss) | Dedup table design, migration SQL, pg-boss cleanup job, INSERT ON CONFLICT pattern, namespaced event IDs from each integration |
| ECHO-02 | Agent-caused webhooks suppressed via per-integration actor detection -- Linear (actor.type), GitHub (sender.login), Slack (app_id) | Actor info extraction in adapters, filter function with actor field check, env var config for GITHUB_APP_LOGIN/SLACK_APP_ID |
| ECHO-03 | Suppressed events logged for debugging transparency (not forwarded to router) | Pino debug-level logging in filter function, structured log format with eventId/eventType/reason |
</phase_requirements>

## Summary

Phase 75 adds two layers of webhook filtering at the agent-service level: (1) delivery deduplication via a Postgres table that catches retried webhooks, and (2) agent echo suppression that detects and drops webhooks caused by Aesir's own actions. Both layers sit as a filter stage between the adapter pipeline and the EventRouter in the POST /events handler.

The implementation is well-scoped and involves changes across four areas: the NormalizedEvent payloads (integrations must thread actor/delivery info), the adapter functions (extract event ID and actor info), a new filter module, and a database migration. The critical finding is that integration normalizers currently do NOT include actor or sender information in the NormalizedEvent payload -- this data must be added at the integration dispatcher level and consumed by the adapters.

**Primary recommendation:** Thread actor metadata through NormalizedEvent.payload from integrations, add a filter stage in routeEvent() between adapter pipeline and EventRouter, use INSERT ON CONFLICT DO NOTHING for atomic dedup with a new agents.processed_webhook_events table, and schedule pg-boss hourly cleanup.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| drizzle-orm | existing | Migration for dedup table | Already used for all agents schema tables |
| pg-boss | existing | Scheduled TTL cleanup job | Already integrated via TimeoutScheduler for conversation timeouts |
| pino | existing | Debug-level suppression logging | Standard logger throughout the codebase |
| zod | existing | Env var validation for new config | Used for all env schemas |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pg (Pool) | existing | Raw INSERT ON CONFLICT query | Direct pool access for dedup check (faster than Drizzle for simple INSERT) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Postgres table for dedup | In-memory Map/Set | No persistence across restarts, no concurrency safety across instances |
| pg-boss cleanup job | setInterval (like knowledge cleanup) | setInterval is simpler but pg-boss is already available and handles node restarts; either works at this scale |
| Raw SQL INSERT ON CONFLICT | Drizzle ORM insert().onConflictDoNothing() | Drizzle wrapping adds overhead for a single-column insert; raw SQL is clearer for this pattern |

**Installation:** No new dependencies. All libraries already in the project.

## Architecture Patterns

### Current Event Pipeline (Before Phase 75)
```
Integration Webhook -> Integration Service (normalize) -> POST /events on agent-service
                                                            |
                                                      NormalizedEventSchema.safeParse
                                                            |
                                                      routeEvent(parsed.data, deps)
                                                            |
                                                      Adapter pipeline (ALL_ADAPTERS)
                                                            |
                                                      [Task routing branch]
                                                            |
                                                      EventRouter.handle()
                                                            |
                                                      executor.start() / signal()
```

### Target Event Pipeline (After Phase 75)
```
Integration Webhook -> Integration Service (normalize + include actor) -> POST /events
                                                                            |
                                                                      NormalizedEventSchema.safeParse
                                                                            |
                                                                      routeEvent(parsed.data, deps)
                                                                            |
                                                                      Adapter pipeline (extracts eventId + actorInfo)
                                                                            |
                                                                      webhookFilter(adapted, db, logger)   <-- NEW
                                                                        |-- Layer 1: dedup (DB check)
                                                                        |-- Layer 2: echo (actor field check)
                                                                            |
                                                                      [Task routing branch]
                                                                            |
                                                                      EventRouter.handle()
```

### Pattern 1: Dedup Table with INSERT ON CONFLICT DO NOTHING
**What:** Atomic duplicate detection using Postgres upsert semantics
**When to use:** Idempotent webhook processing where multiple workers may receive the same event
**Example:**
```typescript
// Source: Postgres documentation + existing codebase pattern
const result = await pool.query(
  'INSERT INTO agents.processed_webhook_events (event_id) VALUES ($1) ON CONFLICT DO NOTHING',
  [eventId]
);
const isDuplicate = result.rowCount === 0;
```
This is the same pattern used by GitHub integration's webhook-delivery-store and Slack integration's event-delivery-store. No row lock contention, no SELECT-then-INSERT race conditions.

### Pattern 2: Actor Info on IncomingEvent
**What:** Enrich IncomingEvent with optional actor metadata for echo detection
**When to use:** When the filter needs actor information extracted during adapter normalization
**Recommended shape:**
```typescript
// Add to IncomingEvent type
actorInfo?: {
  isBot: boolean;      // Quick check: is this actor a bot/app?
  identifier?: string; // Bot identity (login, app_id) when isBot is true
}
```
Each adapter extracts actor info from the NormalizedEvent payload (where integrations have placed it). The filter checks `actorInfo?.isBot === true` -- simple boolean, no per-integration logic in the filter.

### Pattern 3: Filter Stage as a Standalone Function
**What:** Pure function that takes an adapted event and returns 'accept' | 'suppress' with reason
**When to use:** Cross-cutting concerns that apply after normalization but before routing
**Recommended signature:**
```typescript
interface FilterResult {
  action: 'accept' | 'suppress';
  reason?: 'duplicate' | 'agent_echo';
}

async function filterWebhookEvent(
  event: IncomingEvent,
  db: Pool,
  logger: PinoLogger,
): Promise<FilterResult>
```

### Pattern 4: Event ID Extraction per Adapter
**What:** Each adapter extracts the provider's canonical delivery ID and namespaces it
**When to use:** When dedup IDs come from different sources per integration
**Key insight:** The `deduplicationId` field already exists on IncomingEvent and adapters already populate it from `event.correlationId`. The correlationId comes from the integration dispatcher and IS the delivery header value (Linear-Delivery, X-GitHub-Delivery, Slack event_id). So the dedup ID extraction is ALREADY DONE -- adapters just need to namespace it.

### Anti-Patterns to Avoid
- **Filtering inside each adapter:** Violates single-responsibility. Adapters normalize; the filter filters. Three adapters with identical filter logic is three places to maintain.
- **SELECT then INSERT for dedup:** Race condition between check and insert. INSERT ON CONFLICT is atomic.
- **Suppressing at the integration level:** Would require changes in three separate services. The agent-service is the single chokepoint where all events converge.
- **Using deduplicationId for echo detection:** These are separate concerns. A non-duplicate event can still be an echo. Layer 1 and Layer 2 are independent checks.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Dedup concurrency | Mutex or application-level locking | INSERT ON CONFLICT DO NOTHING | Postgres handles atomic insert natively; application locks don't work across processes |
| TTL cleanup scheduling | Custom timer with drift compensation | pg-boss scheduled job | Already integrated, handles node crashes, guaranteed delivery |
| Actor type detection | String matching in filter | Boolean flag set by adapter | Adapter knows its integration; filter shouldn't contain per-integration logic |

**Key insight:** The integrations already have delivery dedup at their level (GitHub: `webhook-delivery-store`, Slack: `event-delivery-store`). Phase 75's dedup is at the agent-service level as a defense-in-depth layer. Don't try to remove the integration-level dedup -- they serve different failure modes.

## Common Pitfalls

### Pitfall 1: Linear actor.type Value May Not Be 'application'
**What goes wrong:** The CONTEXT.md specifies `actor.type === 'application'` for Linear, but Linear's official webhook documentation shows the actor type for OAuth apps is `'OauthClient'`, not `'application'`.
**Why it happens:** Different API surfaces use different terminology. The webhook payload actor.type may differ from the OAuth actor mode parameter.
**How to avoid:** During implementation, send a test webhook from Linear and inspect the actual actor.type value. The adapter should check for BOTH values (`'application'` and `'OauthClient'`) initially, then narrow once confirmed.
**Warning signs:** Echo suppression works in testing but not production (or vice versa) because the actor type string doesn't match.
**Confidence:** MEDIUM -- needs validation with actual webhook payload.

### Pitfall 2: NormalizedEvent Payload Doesn't Include Actor Data
**What goes wrong:** The agent-service adapters try to extract actor info but it's not in the payload.
**Why it happens:** Integration normalizers (linear/dispatcher/normalize.ts, github/dispatcher/normalize.ts, slack/dispatcher/normalize.ts) currently do NOT include actor/sender fields in the NormalizedEvent payload. They extract business data (issueId, prNumber, etc.) but strip the actor metadata.
**How to avoid:** The integration normalizers must be updated to include actor information:
- **Linear:** Add `actor` object from webhook payload (already parsed in CommentPayloadSchema which has `actor.name`/`actor.email`, but missing `actor.type`)
- **GitHub:** Add `sender.login` and `sender.type` from the raw webhook payload (available in WebhookPayloadBase.sender)
- **Slack:** Add `bot_id` and `api_app_id` from the raw event envelope (api_app_id is in BaseEventSchema)
**Warning signs:** Actor info is `undefined` in adapter output despite being available in the raw webhook.

### Pitfall 3: Dedup Before Parse Can Mask Errors
**What goes wrong:** A malformed webhook gets dedupped on first delivery (event ID extracted from headers), so when the provider retries the same malformed payload, it's silently dropped.
**Why it happens:** The decision to "dedup first, parse second" means dedup records are inserted even for events that fail downstream parsing.
**How to avoid:** This is intentional per CONTEXT.md: "If event ID extractable but payload malformed: still dedup it (malformed retries will still be malformed)." Just ensure the malformed parse error is logged at `warn` level so it's visible.
**Warning signs:** Events disappearing without any log trail -- ensure both the dedup record AND the downstream parse failure are logged.

### Pitfall 4: Dedup ID Collision Across Providers
**What goes wrong:** Two providers coincidentally generate the same delivery ID (e.g., both use UUIDs), causing false dedup.
**Why it happens:** Delivery IDs are unique within a provider but not globally.
**How to avoid:** Namespace all dedup IDs: `github:{id}`, `slack:{id}`, `linear:{id}`. This is already specified in CONTEXT.md.
**Warning signs:** Events from one provider being silently dropped when another provider recently sent an event with the same raw ID (astronomically unlikely with UUIDs but worth the namespace anyway).

### Pitfall 5: pg-boss Cleanup Job Not Starting
**What goes wrong:** The dedup table grows indefinitely because the cleanup job was never scheduled.
**Why it happens:** pg-boss requires explicit queue creation and job scheduling. Missing either step means the job never runs.
**How to avoid:** Schedule the cleanup job during the bootstrap sequence in main.ts, after pg-boss starts. Use `boss.schedule()` for recurring jobs or send a recurring job via a startup hook.
**Warning signs:** `processed_webhook_events` table row count growing monotonically without periodic drops.

### Pitfall 6: Filter Placement Relative to Task Routing
**What goes wrong:** Duplicate/echo events bypass the filter because they enter through task routing (step 1.5) before the filter runs.
**Why it happens:** If the filter is placed after the adapter pipeline but the task routing branch exits early.
**How to avoid:** The filter MUST run between the adapter pipeline (step 1) and the task routing branch (step 1.5). In the current `routeEvent()` code, insert the filter check right after the adapter pipeline produces the IncomingEvent, before the `if (incomingEvent.taskId)` guard.

### Pitfall 7: Slack Block Actions Don't Have event_id
**What goes wrong:** Slack interactive payloads (block_actions) don't have an Events API `event_id` field. The Slack parser generates a synthetic ID from action context.
**Why it happens:** Block actions come through the interactions endpoint, not the Events API. They have no native event_id.
**How to avoid:** The Slack interaction handler already generates a NormalizedEvent with `correlationId: eventId` where `eventId = createId.event()` (a fresh nanoid). This means the "dedup ID" for block_actions is always unique -- dedup won't catch retries. This is acceptable because Slack interactive payloads don't retry the same way Events API does. The echo filter (Layer 2) still catches bot-originated block actions if needed.
**Warning signs:** None -- this is a known limitation that doesn't need fixing for Phase 75.

## Code Examples

### Migration SQL for Dedup Table
```sql
-- 0011_add_webhook_dedup.sql
CREATE TABLE agents.processed_webhook_events (
  event_id TEXT PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for TTL cleanup query (deletes by received_at)
CREATE INDEX idx_webhook_dedup_received_at
  ON agents.processed_webhook_events (received_at);
```

### Filter Function (Recommended Implementation)
```typescript
// Source: Codebase patterns from existing dedup stores
import type { Pool } from 'pg';
import type { PinoLogger } from '@aesir/platform';
import type { IncomingEvent } from '../adapters/types.js';

interface WebhookFilterResult {
  action: 'accept' | 'suppress';
  reason?: 'duplicate' | 'agent_echo';
}

interface WebhookFilterOptions {
  pool: Pool;
  logger: PinoLogger;
}

function createWebhookFilter(options: WebhookFilterOptions) {
  const { pool, logger } = options;

  return async function filterWebhookEvent(
    event: IncomingEvent,
  ): Promise<WebhookFilterResult> {
    // Layer 1: Delivery dedup (stateful)
    if (event.deduplicationId) {
      const eventId = `${event.source.split(':')[0]}:${event.deduplicationId}`;
      const result = await pool.query(
        'INSERT INTO agents.processed_webhook_events (event_id) VALUES ($1) ON CONFLICT DO NOTHING',
        [eventId],
      );

      if (result.rowCount === 0) {
        logger.debug({ eventId, eventType: event.type, reason: 'duplicate' }, 'event suppressed');
        return { action: 'suppress', reason: 'duplicate' };
      }
    }

    // Layer 2: Echo suppression (stateless)
    if (event.actorInfo?.isBot) {
      logger.debug(
        { eventId: event.deduplicationId, eventType: event.type, reason: 'agent_echo' },
        'event suppressed',
      );
      return { action: 'suppress', reason: 'agent_echo' };
    }

    return { action: 'accept' };
  };
}
```

### Adapter Actor Extraction (Linear Example)
```typescript
// In adaptLinearEvent, extract actor info from payload
const actorType = payload.actorType as string | undefined;
const actorInfo = actorType
  ? { isBot: actorType === 'OauthClient' || actorType === 'application' }
  : undefined;

return {
  type: "linear.agent_session.created",
  data: { issueId, sessionId },
  source: "linear:webhook",
  correlationKey: issueId,
  deduplicationId: event.correlationId,
  ...(actorInfo && { actorInfo }),
  // ... rest of fields
};
```

### Integration Normalizer Enhancement (GitHub Example)
```typescript
// In normalizePRReviewEvent, include sender info from raw payload
export function normalizePRReviewEvent(
  payload: PRReviewPayload,
  deliveryId: string,
  sender?: { login: string; type?: string },  // NEW parameter
): NormalizedEvent {
  return {
    id: createId.event(),
    type: `github.pull_request.review_${payload.review.state}`,
    source: "github",
    timestamp: new Date(payload.review.submitted_at).toISOString(),
    correlationId: deliveryId,
    payload: {
      // ... existing fields
      ...(sender && { sender }),  // Thread sender info
    },
  };
}
```

### pg-boss Cleanup Job Scheduling
```typescript
// Source: Existing TimeoutScheduler pattern in codebase
const DEDUP_CLEANUP_QUEUE = 'webhook-dedup-cleanup';

// During bootstrap (in main.ts or a dedicated cleanup service):
await boss.createQueue(DEDUP_CLEANUP_QUEUE);
await boss.schedule(DEDUP_CLEANUP_QUEUE, '0 * * * *', {}, {
  // Cron: every hour at minute 0
  // Alternatively, use boss.send() with startAfter for simpler one-shot + reschedule
});

await boss.work(DEDUP_CLEANUP_QUEUE, async () => {
  const result = await pool.query(
    "DELETE FROM agents.processed_webhook_events WHERE received_at < now() - interval '24 hours'"
  );
  if (result.rowCount && result.rowCount > 0) {
    logger.info({ deletedCount: result.rowCount }, 'Webhook dedup cleanup completed');
  }
});
```

### Env Config Extension
```typescript
// In packages/agents/src/shared/env/config.ts
// Add to agentEnvSchema:
GITHUB_APP_LOGIN: z.string().optional(),
SLACK_APP_ID: z.string().optional(),

// Add to config object:
echo: {
  githubAppLogin: env.GITHUB_APP_LOGIN,
  slackAppId: env.SLACK_APP_ID,
},
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No dedup at agent-service level | Integration-level dedup only (GitHub/Slack stores) | v2.0 | Works for single integration but no cross-layer defense |
| No echo detection | Ignore events via IGNORE_EVENT_TYPES set | v2.3 | Catches known event types but not agent-caused events of recognized types |
| Slack bot_message filtering | Integration-level `bot_id` check in main.ts | v2.1 | Prevents Slack bot loops but only at integration level |

**Deprecated/outdated:**
- The `IGNORE_EVENT_TYPES` set (`linear.issue.created`, `linear.issue.updated`) in `adapters/types.ts` performs a similar but different function. Those ignore ALL events of those types regardless of actor. Phase 75's echo filter is actor-aware and applies to all event types. The IGNORE_EVENT_TYPES set should remain -- it serves a different purpose (dropping events that have no routing target).

## Critical Implementation Details

### Where Actor Data Lives Today (and Where It Needs to Be Added)

**Linear Integration:**
- `CommentPayloadSchema` already parses `actor: { id, name, email }` -- but NOT `actor.type`
- The `normalizeCommentCreatedEvent` includes `actorName` and `actorEmail` but NOT `actorType`
- `AgentSessionPayload` has no actor field at all
- **Action:** Add `actor.type` to CommentPayloadSchema, add `actor` parsing to AgentSession payload, thread through normalization

**GitHub Integration:**
- `WebhookPayloadBase` defines `sender?: { login: string; id: number }` -- available but NOT included in NormalizedEvent
- The webhook handler has access to `sender` on the parsed payload but the normalize functions don't receive it
- **Action:** Pass `sender` from parsed payload into normalize functions, include in NormalizedEvent.payload

**Slack Integration:**
- `BaseEventSchema` has `api_app_id: z.string().optional()` -- available but NOT included in NormalizedEvent
- The `SlackMessageEventSchema` doesn't parse `bot_id` (it's filtered at main.ts level before normalization)
- Block actions go through a different path (interactions.ts) and have no bot detection
- **Action:** Include `api_app_id` in normalized payload for Events API events. For block_actions dispatched via interactions.ts, the events are always user-initiated (button clicks) -- no echo filter needed.

### Dedup ID Already Available

The `deduplicationId` field on IncomingEvent is already populated by adapters from `event.correlationId`, which integrations set from the delivery header:
- **Linear:** `correlationId: deliveryId` (from `linear-delivery` header)
- **GitHub:** `correlationId: deliveryId` (from `x-github-delivery` header)
- **Slack:** `correlationId: payload.eventId || createId.event()` (from `event_id` or generated)

The filter just needs to namespace these: `${source}:${deduplicationId}`.

### Drizzle Migration Numbering

Next migration number is `0011`. Current latest is `0010_completion_signaling.sql`. The migration journal (`_journal.json`) needs a new entry with idx: 10.

### pg-boss Already Initialized

The `TimeoutScheduler` in `framework/timeout-scheduler.ts` already initializes pg-boss with the shared pool via the `createPgBossAdapter()` pattern. The dedup cleanup job should either:
1. Use the same pg-boss instance (share it from TimeoutScheduler), or
2. Create a separate lightweight scheduler

Option 1 is cleaner: expose the pg-boss instance from TimeoutScheduler or pass it during bootstrap.

### routeEvent() Insertion Point

The filter call should be inserted in `router/router.ts` at line ~188 (after the adapter pipeline produces `incomingEvent`, before the task routing branch at line ~199). This preserves the early-exit pattern: if the filter suppresses, routeEvent returns immediately with `{ received: true, action: 'deduplicated' }` or similar.

Note: The `RouteEventResult.action` type already includes `'deduplicated'` as a valid value, so no type changes needed for that action.

## Open Questions

1. **Linear actor.type exact value**
   - What we know: CONTEXT.md says `'application'`, Linear official docs reference `'OauthClient'` as the type for OAuth apps
   - What's unclear: Which exact string appears in the webhook payload when Aesir's OAuth app creates a resource
   - Recommendation: Implement with both checks (`type === 'OauthClient' || type === 'application'`) and add a debug log that prints the actual value on first encounter. Narrow once confirmed.

2. **pg-boss instance sharing**
   - What we know: TimeoutScheduler creates and manages a pg-boss instance. The dedup cleanup needs pg-boss for scheduled jobs.
   - What's unclear: Whether to share the TimeoutScheduler's pg-boss instance or create a separate one
   - Recommendation: Share the instance. Either refactor TimeoutScheduler to expose its boss instance, or create a shared "pg-boss provider" that both TimeoutScheduler and the cleanup job use. Sharing avoids duplicate pg-boss schema management.

3. **Whether to add actorInfo to IncomingEvent or keep it on NormalizedEvent**
   - What we know: CONTEXT.md says adapters extract actor info during normalization. Actor info is integration-specific (different field names per provider).
   - Recommendation: Add `actorInfo?: { isBot: boolean }` to IncomingEvent. Each adapter translates integration-specific actor fields into this boolean. The filter only checks `actorInfo.isBot` -- no integration knowledge needed.

## Sources

### Primary (HIGH confidence)
- Codebase inspection: `packages/agents/src/adapters/` -- all four adapters, types, and tests
- Codebase inspection: `packages/agents/src/router/router.ts` -- routeEvent pipeline
- Codebase inspection: `packages/agents/src/service/main.ts` -- bootstrap and POST /events handler
- Codebase inspection: `packages/agents/src/shared/db/schema.ts` -- agents schema pattern
- Codebase inspection: `packages/agents/src/framework/timeout-scheduler.ts` -- pg-boss integration pattern
- Codebase inspection: `packages/integrations/*/src/dispatcher/normalize.ts` -- what data flows through NormalizedEvent
- Codebase inspection: `packages/integrations/*/src/webhooks/` -- raw payload schemas with actor/sender fields
- Codebase inspection: `packages/integrations/*/src/api/webhooks.ts` -- delivery ID extraction from headers

### Secondary (MEDIUM confidence)
- [Linear Webhooks Developer Docs](https://linear.app/developers/webhooks) -- actor.type values (`user`, `OauthClient`, `Integration`)
- [GitHub Webhook Headers](https://docs.github.com/webhooks) -- X-GitHub-Delivery header (GUID format)

### Tertiary (LOW confidence)
- Linear actor.type exact value for OAuth apps -- NEEDS VALIDATION with actual webhook payload

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already in use, no new dependencies
- Architecture: HIGH -- clear insertion point in existing pipeline, well-understood adapter pattern
- Pitfalls: HIGH -- identified 7 specific pitfalls from codebase analysis, including the actor.type mismatch
- Integration data flow: HIGH -- traced exact data flow from webhook receipt through normalization to adapter consumption

**Research date:** 2026-02-16
**Valid until:** 2026-03-16 (stable -- internal architecture, no external dependency changes)
