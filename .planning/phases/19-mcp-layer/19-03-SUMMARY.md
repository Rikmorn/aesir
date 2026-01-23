---
phase: 19-mcp-layer
plan: 03
subsystem: integrations
tags: [mcp, linear, server, tools, sdk]

# Dependency graph
requires:
  - phase: 19-01
    provides: MCP SDK and shared types
  - phase: 19-02
    provides: Permission schema and checker functions
  - phase: 16-linear-extraction
    provides: Linear operations and client patterns

provides:
  - Linear MCP server factory (createLinearMCPServer)
  - 5 Linear MCP tools (issue and team operations)
  - Permission-checked tool handlers
  - SDK-compatible tool result transformation

affects: [19-05, agent-linear-integration]

# Tech tracking
tech-stack:
  added: []
  patterns: ["MCP SDK request handler pattern", "Tool result transformation for SDK compatibility", "Switch-based tool routing"]

key-files:
  created:
    - packages/integrations/linear/src/mcp/tools/issues.ts
    - packages/integrations/linear/src/mcp/tools/teams.ts
    - packages/integrations/linear/src/mcp/tools/index.ts
    - packages/integrations/linear/src/mcp/server.ts
    - packages/integrations/linear/src/mcp/index.ts
  modified:
    - packages/integrations/linear/src/index.ts

decisions:
  - "MCP SDK uses Zod schemas for setRequestHandler (ListToolsRequestSchema, CallToolRequestSchema)"
  - "Tool handlers return MCPToolResult, server transforms to SDK CallToolResult format"
  - "Context passed to handlers includes only logger, correlationId, agentId, startTime"
  - "Switch statement for tool routing vs individual setRequestHandler calls"
  - "Underscore prefix for unused logger from deps (pattern uses context.logger instead)"

metrics:
  duration: 3
  completed: 2026-01-23
---

# Phase 19 Plan 03: Linear MCP Server Implementation

**Linear MCP server with 5 tools for issue and team operations**

## Performance

- **Duration:** 2 min 53 sec
- **Started:** 2026-01-23T17:10:04Z
- **Completed:** 2026-01-23T17:12:57Z
- **Tasks:** 3/3
- **Files created:** 5
- **Files modified:** 1

## Accomplishments

- Linear MCP server factory exports 5 tools for agent use
- Permission-checked tool handlers with input validation
- Tool result transformation for MCP SDK compatibility
- Full integration with existing Linear operations

## Task Commits

1. **Task 1: Create Linear MCP tool schemas** - Pre-existing (schemas.ts already created)
2. **Task 2: Create Linear MCP tool implementations** - `8e325bf` (feat)
3. **Task 3: Create Linear MCP server factory and wire to exports** - `7c274fc` (feat)

## Files Created/Modified

**Created:**
- `packages/integrations/linear/src/mcp/tools/issues.ts` - Issue tool handlers (get_issue, create_issue, update_issue_status)
- `packages/integrations/linear/src/mcp/tools/teams.ts` - Team tool handlers (list_teams, list_labels)
- `packages/integrations/linear/src/mcp/tools/index.ts` - Tool barrel export
- `packages/integrations/linear/src/mcp/server.ts` - MCP server factory with tool registration and routing
- `packages/integrations/linear/src/mcp/index.ts` - MCP module barrel export

**Modified:**
- `packages/integrations/linear/src/index.ts` - Added MCP module export

## Decisions Made

1. **MCP SDK Request Handler API**: Following GitHub MCP pattern, used `CallToolRequestSchema` and `ListToolsRequestSchema` from SDK types for request handler registration.

2. **Tool Result Transformation**: MCP SDK expects `{ content, isError }` format. Created transformation layer in server to convert our `MCPToolResult` (which includes `meta` and `structuredContent`) to SDK-compatible format.

3. **Tool Routing Pattern**: Used single `call_tool` handler with switch statement for routing to 5 different tool handlers. This centralizes request parsing and result transformation.

4. **Context Construction**: Simplified context to just `{ logger, correlationId, agentId, startTime }`. Logger comes from server options, other fields placeholder for future enhancement.

5. **Unused Logger Variable**: Logger from deps is destructured but not used (handlers use context.logger instead). Applied underscore prefix (`logger: _logger`) to satisfy Biome's noUnusedVariables lint rule.

6. **Linear Client Creation**: Each tool handler creates Linear client from database credentials via `createLinearClientFromDatabase(workspaceId)`. This ensures fresh tokens and automatic refresh.

## Deviations from Plan

**[Pre-existing Work]** Task 1 (schemas.ts) was already completed. The schemas file existed at `packages/integrations/linear/src/mcp/schemas.ts` with all required schemas defined. This saved implementation time but was not documented in git history.

## Issues Encountered

**Lint Errors During Commit**: Initial commit attempt failed due to unused `logger` variable warnings. Resolved by applying underscore prefix pattern (`logger: _logger`) consistent with best practices for intentionally unused parameters.

**Type Import**: Initially imported `Logger` from `pino` directly, which caused type errors. Corrected to use `PinoLogger` from `@aesir/common` for consistency with project patterns.

## User Setup Required

None - MCP server is library code, no runtime setup needed.

## Next Phase Readiness

- Linear MCP server ready for agent integration
- All 5 tools functional and permission-checked
- Pattern consistent with GitHub MCP server (19-04)
- Tool result format compatible with MCP SDK

**No blockers.**

---

*Phase: 19-mcp-layer*
*Completed: 2026-01-23*
