# Phase 75: Echo Elimination - Context

**Gathered:** 2026-02-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Suppress duplicate webhook deliveries and agent-caused events at the infrastructure level before they reach the router or agents. Two layers: delivery dedup (Layer 1) and echo suppression (Layer 2). No semantic dedup -- that's Phase 78 (Work Correlation).

</domain>

<decisions>
## Implementation Decisions

### Echo detection approach
- Actor field inspection only -- stateless check on the webhook payload's actor/sender fields. No tool-call correlation.
- Catches every agent-caused event by default (including unanticipated ones). No coordination overhead, no shared store.
- The suppression rule is unconditional: if the bot authored it, suppress it. Period.

### Per-integration actor identification
- **Linear:** Structural check -- `actor.type === 'application'`. No config needed. Aesir is the only OAuth app in the workspace.
- **GitHub:** Identity match -- `sender.login === env.GITHUB_APP_LOGIN`. Needed because `sender.type === 'Bot'` is too broad (catches Dependabot, CI bots).
- **Slack:** Identity match -- `app_id === env.SLACK_APP_ID`. Needed because `bot_id` presence catches every bot in the channel.
- Two env vars on agent-service: `GITHUB_APP_LOGIN`, `SLACK_APP_ID`. Zero config for Linear.

### Pipeline architecture
- **Adapters enrich, separate filter stage decides.** Each adapter extracts actor info during normalization (it's just reading integration-specific fields they already parse). A dedicated filter function between adapters and router applies both layers.
- Pipeline: `Webhook -> Adapter (normalize + extract actor) -> Filter (dedup + echo) -> Router`
- Single filter stage = one logging path, one place for dedup table interaction, single responsibility.

### Filter execution mode
- Synchronous inline in the POST /events handler. Both checks are sub-millisecond (one indexed INSERT, one field comparison).
- No async queue -- unnecessary complexity for the volume. If webhook volume ever overwhelms the handler, the bottleneck will be LLM calls downstream, not the dedup check.

### Dedup event ID strategy
- Use each provider's canonical delivery/event identifier:
  - **GitHub:** `X-GitHub-Delivery` header (GUID, stable across retries)
  - **Slack:** `event_id` from Events API envelope
  - **Linear:** Delivery ID from webhook headers
- Namespace to prevent cross-provider collisions: `github:{id}`, `slack:{id}`, `linear:{id}`
- Each adapter owns its extraction -- the filter sees an opaque string.
- Entity IDs (issueId, PR number) are NOT dedup keys -- multiple events fire for the same entity.

### Parse order
- Dedup first, parse second. Extract event ID from raw headers/envelope, check dedup table, then parse payload.
- If event ID extractable but payload malformed: still dedup it (malformed retries will still be malformed).
- If event ID not extractable: fall through to parsing which will fail with a logged error.

### Dedup storage and TTL
- Table: `agents.processed_webhook_events (event_id TEXT PRIMARY KEY, received_at TIMESTAMPTZ DEFAULT now())`
- `INSERT ON CONFLICT DO NOTHING` + check `rowCount === 0` for duplicate detection. Handles concurrent instances atomically.
- 24-hour TTL -- covers longest provider retry window (Linear and GitHub retry over ~24 hours, Slack ~3 hours).
- Hourly cleanup via pg-boss scheduled job: `DELETE FROM agents.processed_webhook_events WHERE received_at < now() - interval '24 hours'`

### Suppression observability
- Log-only via pino at `debug` level. Suppression is expected behavior -- `info` would spam during normal operation.
- Log format: `logger.debug({ eventId, eventType, reason: 'duplicate' | 'agent_echo' }, 'event suppressed')`
- No event emission to EventLog -- deferred to Phase 77 which will decide what suppression telemetry is worth persisting.
- No separate suppression history table -- the dashboard gets visibility when Phase 77 ships.

### HTTP response
- Always 200 OK for both accepted and suppressed webhooks. The sender's contract is "I delivered." Our contract is "I received." Internal filtering is our business.
- Non-200 2xx codes risk inconsistent retry behavior across providers.

### Edge case policy: fail-open
- Missing actor data: pass through + log at `warn` level. A leaked echo is recoverable; a suppressed legitimate event is invisible data loss.
- Other bots (Dependabot, Slack integrations, third-party apps): pass through. Only suppress Aesir's own known identities.
- No semantic/logical dedup (same state, different delivery IDs): that's Phase 78's disposition model, not Phase 75's delivery dedup.

### Claude's Discretion
- Exact migration SQL and table indexes
- Filter function signature and error handling
- pg-boss job scheduling configuration
- How adapters surface actor info on the normalized event (field name, shape)

</decisions>

<specifics>
## Specific Ideas

- "Actor field inspection over action correlation, and it's not close" -- simplicity and completeness by default
- Pipeline model: adapters are normalizers, filter is cross-cutting -- don't duplicate filtering across three adapters
- INSERT ON CONFLICT DO NOTHING as the atomic dedup mechanism -- standard Postgres pattern, no locks needed
- "The caller's contract is 'I delivered the webhook.' Your contract is 'I received it.' What you do with it is your business."
- Layer 1 (dedup) is stateful (DB table), Layer 2 (echo) is stateless (field comparison) -- keep them distinct

</specifics>

<deferred>
## Deferred Ideas

- Event emission for suppression telemetry -- Phase 77 (Dashboard Observability) decides what to persist
- Semantic/logical dedup (same entity state, different deliveries) -- Phase 78 (Work Correlation) disposition model
- Suppression metrics/dashboard visibility -- Phase 77 scope

</deferred>

---

*Phase: 75-echo-elimination*
*Context gathered: 2026-02-16*
