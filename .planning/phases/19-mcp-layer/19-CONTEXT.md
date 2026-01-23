# Phase 19: MCP Layer - Context

**Gathered:** 2026-01-23
**Status:** Ready for planning

<domain>
## Phase Boundary

MCP servers in each integration (Linear, GitHub, Slack) enabling standardized agent tool calls. Agents discover and call integration tools via MCP protocol. Tool calls logged with correlation IDs. Tool whitelisting per agent.

</domain>

<decisions>
## Implementation Decisions

### Tool Granularity
- **Research needed**: Fine-grained vs coarse tools — lean toward fine-grained (one tool per operation) for simpler LLM tool selection
- **Research needed**: Normalized domain objects vs raw API responses — lean toward normalized, but research what works best for LLM consumption
- Consider split: LLM-facing tools (normalized) + internal tools (raw) for debugging
- **Keep integrations isolated**: No composite tools spanning integrations. Orchestration happens at agent level.

### Server Topology
- **One MCP server per integration**: Linear MCP, GitHub MCP, Slack MCP — matches extracted package architecture
- **Embedded in existing service**: Add MCP endpoints to Linear:3001, GitHub:3002, Slack:3003. Share database connections, credentials.
- **Research needed**: Direct connection for dev (Docker networking), gateway/proxy for production
- **Environment variable config**: MCP_ENABLED_TOOLS, MCP_RATE_LIMIT, etc. — 12-factor friendly

### Tool Whitelisting
- **Database-backed permissions**: Store agent-to-tool permissions in PostgreSQL. Allows changes without redeployment.
- **Binary access**: Tool is either allowed or not. Fine-grained tools already provide granularity.
- **Network isolation for auth**: Trust connections from internal Docker network. No token auth for MVP.

### Transport & Protocol
- **HTTP/SSE transport**: POST to MCP endpoints, SSE for streaming responses. Fits existing Express services.
- **SSE streaming**: Support streaming for long-running operations (large PR diffs, etc.)
- **Standard paths**: /mcp/tools (list), /mcp/tools/:name (invoke), /mcp/schema (spec)
- **X-Correlation-ID header**: Agent passes correlation ID, MCP server propagates to all downstream calls
- **Full logging**: Log tool name, inputs (redacted), outputs (truncated), duration, correlation ID
- **Metadata in responses**: { result, meta: { duration_ms, rate_limit_remaining, correlation_id } }

### Claude's Discretion
- Tool descriptions — research what improves LLM tool selection accuracy
- Input validation patterns — research error handling patterns in MCP tools
- Read/write separation — research based on agent permission patterns
- Batch support — research based on typical agent usage patterns
- Naming conventions — research MCP tool naming conventions
- Auto-registration vs static config — research MCP discovery patterns
- Hot-reload — research based on development workflow needs
- Health check integration — research health check patterns
- Connection pooling — research based on concurrency patterns
- Allow-list vs deny-list — research security patterns (lean allow-list)
- Timeouts — research per-tool vs global timeout patterns
- Rate limiting — research rate limiting patterns

</decisions>

<specifics>
## Specific Ideas

- "I want this to be as simple for the LLM to do its job as possible" — prioritize LLM ergonomics
- "APIs can be split, one for LLMs and other internal ones for 'regular' integrations" — consider dual API surface
- "Permissions in DB allows changing without redeploying" — runtime configurability valued
- "Direct connection for dev, gateway/proxy for production" — environment-appropriate topology

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 19-mcp-layer*
*Context gathered: 2026-01-23*
