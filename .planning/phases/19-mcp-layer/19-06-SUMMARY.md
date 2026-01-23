---
phase: 19-mcp-layer
plan: 06
subsystem: api
tags: [mcp, http, express, rate-limiting, integration]

# Dependency graph
requires:
  - phase: 19-03
    provides: Linear MCP server with 5 tools
  - phase: 19-04
    provides: GitHub MCP server with 9 tools
  - phase: 19-05
    provides: Slack MCP server with 5 tools
provides:
  - HTTP endpoints exposing MCP tools via REST API
  - Rate-limited MCP endpoints (100 req/min per agent)
  - Correlation ID and Agent ID header extraction
  - Standardized error responses with retry information
affects: [agent-integration, tool-invocation, http-clients]

# Tech tracking
tech-stack:
  added: [express-rate-limit]
  patterns:
    - MCP tool HTTP routing pattern
    - Agent-based rate limiting via X-Agent-ID
    - Correlation ID propagation through HTTP headers
    - Type assertions for NodePgDatabase → PostgresJsDatabase compatibility

key-files:
  created:
    - packages/integrations/linear/src/api/mcp.ts
    - packages/integrations/github/src/api/mcp.ts
    - packages/integrations/slack/src/api/mcp.ts
  modified:
    - packages/integrations/linear/src/api/routes.ts
    - packages/integrations/linear/src/main.ts
    - packages/integrations/github/src/api/routes.ts
    - packages/integrations/github/src/main.ts
    - packages/integrations/slack/src/api/routes.ts
    - packages/integrations/slack/src/main.ts

key-decisions:
  - "MCP tools invoked directly via HTTP handlers instead of MCP SDK Server.request() method"
  - "Rate limiting keyed by X-Agent-ID header (100 req/min per agent)"
  - "429 status code with retry_after_seconds=60 for rate limit exceeded"
  - "Type assertion NodePgDatabase → PostgresJsDatabase (runtime-compatible interfaces)"
  - "JSON middleware separate from webhook routes (webhooks need raw body for HMAC)"

patterns-established:
  - "MCP HTTP router factory pattern: createMCPRouter(options)"
  - "Tool routing via switch statement with direct handler invocation"
  - "Standardized response structure: { content, data, isError, meta: { correlation_id, duration_ms } }"
  - "Rate limiter middleware applied to /mcp/* routes before tool routing"

# Metrics
duration: 12min
completed: 2026-01-23
---

# Phase 19 Plan 06: MCP Tool HTTP Exposure Summary

**REST API endpoints for all MCP tools across Linear (5 tools), GitHub (9 tools), and Slack (5 tools) with per-agent rate limiting**

## Performance

- **Duration:** 12 minutes
- **Started:** 2026-01-23T17:15:43Z
- **Completed:** 2026-01-23T17:27:44Z
- **Tasks:** 3
- **Files created:** 3
- **Files modified:** 6

## Accomplishments

- Exposed all MCP tools via HTTP REST endpoints (GET /mcp/tools for discovery, POST /mcp/tools/:name for invocation)
- Applied rate limiting to prevent abuse (100 requests per minute per agent)
- Implemented correlation ID and agent ID header extraction for tracing and permission checks
- Unified error responses with retry information for rate limit violations
- Maintained separation between webhook routes (raw body for HMAC) and MCP routes (parsed JSON body)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create MCP routes for Linear** - `3f2d63f` (feat)
2. **Task 2: Create MCP routes for GitHub and Slack** - `e5b992f` (feat)
3. **Task 3: Add rate limiting to MCP endpoints** - `958b7da` (feat)

## Files Created/Modified

### Created:
- `packages/integrations/linear/src/api/mcp.ts` - Linear MCP HTTP routes with tool definitions and handlers
- `packages/integrations/github/src/api/mcp.ts` - GitHub MCP HTTP routes with 9 tool endpoints
- `packages/integrations/slack/src/api/mcp.ts` - Slack MCP HTTP routes with 5 tool endpoints

### Modified:
- `packages/integrations/*/src/api/routes.ts` - Re-export MCP router factories
- `packages/integrations/*/src/main.ts` - Mount MCP routes with JSON middleware
- `packages/integrations/*/package.json` - Add express-rate-limit dependency
- `pnpm-lock.yaml` - Lock new dependency

## Decisions Made

1. **Direct handler invocation over MCP SDK routing:** MCP SDK Server.request() requires additional setup and serialization. Direct handler invocation provides simpler control flow and clearer error handling.

2. **Agent-based rate limiting (X-Agent-ID):** Rate limits keyed by agent ID allow fair resource allocation across multiple agents. Agents without ID share "unknown" bucket for basic protection.

3. **Separate JSON middleware mounting:** MCP routes mounted with express.json() middleware after raw body routes. This preserves raw body for webhook HMAC verification while providing parsed JSON for MCP tool arguments.

4. **Type assertion for DB compatibility:** NodePgDatabase and PostgresJsDatabase are runtime-compatible interfaces. Type assertion enables code reuse across Linear (NodePg) and tool handlers (PostgresJs types).

5. **Retry-After header standardization:** 429 responses include retry_after_seconds in meta and standard Retry-After header for HTTP client compatibility.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - implementation followed established patterns from Phase 19 MCP server work.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

### Ready:
- All three integration services expose MCP tools via HTTP
- Rate limiting protects against abuse
- Agents can discover tools (GET /mcp/tools) and invoke them (POST /mcp/tools/:name)
- Correlation IDs propagated through request lifecycle for tracing

### Notes:
- Phase 19 (MCP Layer) is now complete with HTTP exposure
- Ready for Phase 20: Integration Testing (test end-to-end MCP tool invocation flows)
- Rate limit configuration (100 req/min) may need adjustment based on production load

---
*Phase: 19-mcp-layer*
*Completed: 2026-01-23*
