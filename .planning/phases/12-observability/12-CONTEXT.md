# Phase 12: Observability - Context

**Gathered:** 2026-01-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Production-ready logging infrastructure with correlation across service boundaries. All log output uses pino with structured JSON. Every HTTP request generates a unique correlation ID visible in all resulting log entries. Sensitive fields are automatically redacted.

</domain>

<decisions>
## Implementation Decisions

### Log format & structure
- Standard top-level fields: timestamp, level, message, service, component, correlationId
- Nested objects for integration context (e.g., `{ github: { prNumber }, linear: { issueId } }`) — better organization as more integrations added
- Both ISO 8601 string AND Unix epoch milliseconds for timestamps — serves both human and machine consumers
- Stack traces in dev only — production shows error message + code, no full stack
- JSON everywhere — no pretty-printing, use external tools if needed
- Full request/response bodies at debug level — redaction still applies
- Performance timing always included — durationMs field on completion logs
- Component naming: layer:module format (e.g., "integrations:github", "agents:dev-agent")
- No log entry size limit — rely on log aggregator limits
- Child loggers always inherit parent context (correlationId, component)
- Source location (file:line) for error level only
- Service name configurable via SERVICE_NAME env var

### Correlation ID propagation
- Prefixed format by operation type: req_, agent_, tool_, api_, job_
- Map external IDs to internal: incoming X-Correlation-ID becomes parentCorrelationId, new correlationId generated
- Temporal workflows: pass correlationId in workflow args AND as search attribute (for Temporal UI queries)
- Never expose correlation IDs in outbound responses — internal only
- Explicit context passing through function calls (no AsyncLocalStorage)
- Hierarchical IDs: spawned operations get child IDs with parent links
- Unbounded hierarchy depth — all trace back to rootId

### Log levels & verbosity
- Default level: info (configurable via LOG_LEVEL env var)
- Per-component overrides: LOG_LEVEL_<COMPONENT>=debug for targeted debugging
- Always log regardless of level: errors, lifecycle events (startup/shutdown), security events (auth failures)
- LLM interactions: info logs metadata (model, tokens, latency), debug includes full prompts
- Trace level available below debug for wire-level debugging
- Log every occurrence — no sampling or aggregation, revisit if volume becomes an issue
- Integration API calls: success at debug, failures at info/warn

### Redaction rules
- Redacted values show as `[REDACTED]` — simple marker
- Detection via field name patterns: *password*, *token*, *secret*, *key*, *auth*
- User content (PR descriptions, issue bodies) only at debug level
- Best-effort redaction — log anyway if redaction fails
- LOG_REDACT=false available for local development
- PII redaction (IPs, emails) configurable via REDACT_PII env var (false by default)

### Claude's Discretion
- Array logging strategy (full vs count+sample based on context)
- Value scanning for secret-like patterns (sk-xxx, ghp_xxx, xoxb-xxx)
- Specific field name patterns for redaction detection

</decisions>

<specifics>
## Specific Ideas

- Nested objects over flat prefixes for integration context — scales better as system grows
- Explicit context passing preferred for transparency over "magic" AsyncLocalStorage
- Hierarchical correlation IDs enable powerful filtering (show all logs for agent_xxx, or trace entire request chain via rootId)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 12-observability*
*Context gathered: 2026-01-20*
