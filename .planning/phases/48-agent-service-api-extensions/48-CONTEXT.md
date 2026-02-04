# Phase 48: Agent Service API Extensions - Context

**Gathered:** 2026-02-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Expose agent-service runtime state (tool registry, agent definitions, worker status, live events) via read-only HTTP endpoints under the `/api/` prefix. The dashboard and future consumers query these endpoints. No new database tables. No write operations. No dashboard UI (that's Phase 49+).

Endpoints: `/api/tools/registry`, `/api/tools/health`, `/api/agents/registry`, `/api/agents/registry/:id`, `/api/worker/status`, `/api/sse/events`.

</domain>

<decisions>
## Implementation Decisions

### Health Check Behavior
- Two-state model: healthy / unhealthy (no degraded state)
- Timeout threshold: Claude's discretion (Docker internal network context -- likely 3s)
- On failure: return status only (`{ status: 'unhealthy', latencyMs: null, lastChecked: ... }`), error details stay in logs
- Current status snapshot only -- no `lastSuccessAt` tracking
- Results cached for 30s (from spec)

### SSE Stream Design
- Periodic heartbeat/keepalive following SSE best practices (comment line `: ping` at regular interval to prevent proxy timeouts)
- Event type naming matches `agent_events.type` directly (e.g., `tool.called`, `agent.completed`) -- no translation layer
- Max 50 concurrent SSE connections, return 429 when exceeded
- `Last-Event-ID` support with sequence-based resume -- client sends last sequence, server replays events since that sequence
- Query param filters: `?conversationId=xxx`, `?types=tool.called,tool.failed` (from spec)
- Bridges from existing `EventLog.subscribe()` mechanism (from spec)

### Error Response Format
- Consistent error envelope across all `/api/` endpoints: `{ error: { code: 'NOT_FOUND', message: 'Agent not found' } }`
- Zod validation at boundary for path params and query params, returning 400 with `{ error: { code: 'VALIDATION_ERROR', message: '...', details: [...] } }`
- No rate limiting for v2.4 -- internal tool, trusted consumers
- No CORS needed -- nginx fronts both dashboard and agent service under a single origin

### Endpoint Structure (from spec)
- `/api/` prefix separates management endpoints from operational endpoints (`/events`, `/conversations/:id`)
- `/api/agents/registry` returns definitions WITHOUT system prompt content (list is lightweight)
- `/api/agents/registry/:id` returns full definition INCLUDING system prompt content
- `/api/tools/registry` returns `{ name, namespace, description, inputSchema }`
- `/api/worker/status` returns `{ activeClaims, maxConcurrent, pollIntervalMs, lastPollAt, uptimeMs }`

### Claude's Discretion
- Health check timeout threshold (likely 3s for internal Docker network)
- Heartbeat/keepalive interval (standard SSE practice, likely 15-30s)
- Exact error codes vocabulary beyond NOT_FOUND and VALIDATION_ERROR
- Internal implementation of sequence-based SSE resume (buffer size, max replay window)

</decisions>

<specifics>
## Specific Ideas

- "Calls go through nginx so CORS is moot" -- dashboard and agent service are behind the same nginx reverse proxy, browser sees a single origin
- "We should follow standard/best practice as much as possible" for SSE -- use established SSE patterns rather than inventing custom approaches
- "Status is fine, details can stay in logs" for health checks -- keep the API surface clean, use structured logging for diagnostics

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope

</deferred>

---

*Phase: 48-agent-service-api-extensions*
*Context gathered: 2026-02-04*
