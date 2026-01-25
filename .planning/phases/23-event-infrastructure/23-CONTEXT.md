# Phase 23: Event Infrastructure - Context

**Gathered:** 2026-01-25
**Status:** Ready for planning

<domain>
## Phase Boundary

External webhooks route through nginx gateway to integrations, integrations normalize webhooks to a common event schema, and dispatch normalized events to agents. This phase builds the plumbing from webhook receipt to agent `/events` endpoint — not the agent processing logic itself.

Reference: `.planning/2.1-rob-context.md` contains detailed architecture diagrams and flow descriptions.

</domain>

<decisions>
## Implementation Decisions

### Nginx Gateway
- Path-based routing to integrations:
  - `/linear/*` → `linear-integration:3001`
  - `/github/*` → `github-integration:3002`
  - `/slack/*` → `slack-integration:3003`
  - `/agent/*` → `dev-agent:3004`
- Cloudflare tunnel terminates external traffic at nginx:80
- Health check endpoints for each upstream service

### Event Schema
- Normalized event structure (already defined in brief):
  ```typescript
  interface NormalizedEvent {
    id: string;                    // Unique event ID
    type: string;                  // e.g., "linear.issue.created"
    source: "linear" | "github" | "slack";
    timestamp: string;             // ISO 8601
    correlationId: string;         // For log correlation
    payload: unknown;              // Source-specific payload
  }
  ```
- Event types use dotted notation: `{source}.{resource}.{action}`
- Examples: `linear.issue.created`, `github.pull_request.review_submitted`, `slack.message.created`

### Dispatcher Location
- Dispatcher logic lives in each integration (not a separate service)
- Each integration normalizes then dispatches its own events
- No shared dispatcher service — keeps deployment simple

### Routing Configuration
- Routes defined in code (TypeScript const per integration)
- Type-only matching (no payload field filters in v2.1)
- Agents handle any additional filtering in their `/events` handlers
- Config includes dispatch mode (`sync` or `async`) per route

### Error Handling
- Fire-and-forget delivery model
- Single dispatch attempt, no retry on failure
- If agent is down or returns error, event is lost (acceptable for v2.1)
- Errors logged via pino, no external alerting
- Timeout based on route mode:
  - `async` routes: 5s timeout (agent accepts quickly, processes later)
  - `sync` routes: 30s timeout (agent may process before responding)

### Webhook Processing (per integration)
- Verify webhook signature before processing
- Check idempotency (deduplicate by webhook delivery ID)
- Parse payload to integration-specific type
- Normalize to common event schema
- Dispatch to configured route(s)

</decisions>

<specifics>
## Specific Ideas

- Webhook flow documented in brief: External Service → Cloudflare Tunnel → nginx:80 → Integration → verify → dedupe → parse → normalize → dispatch → Agent /events
- Example routing config structure from brief shows async/sync modes and label filters (filters deferred, keep structure for future)
- Each integration already has webhook verification in place (Phase 16-18) — this phase adds normalization and dispatch

</specifics>

<deferred>
## Deferred Ideas

- Payload field filtering in routes (e.g., `labels: ["agent-ready"]`) — keep simple for v2.1, agents filter in handlers
- Dead letter queue for failed dispatches — accept lost events for now
- Slack alerting on dispatch failures — log-only for v2.1
- Agent polling for missed events — not needed with fire-and-forget model

</deferred>

---

*Phase: 23-event-infrastructure*
*Context gathered: 2026-01-25*
