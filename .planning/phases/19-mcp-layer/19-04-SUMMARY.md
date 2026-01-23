---
phase: 19-mcp-layer
plan: 04
subsystem: integrations
tags: [mcp, github, server, tools, sdk]

# Dependency graph
requires:
  - phase: 19-01
    provides: MCP SDK and shared types
  - phase: 19-02
    provides: Permission schema and checker functions
  - phase: 17-github-extraction
    provides: GitHub operations and Octokit client patterns

provides:
  - GitHub MCP server factory (createGitHubMCPServer)
  - 9 GitHub MCP tools (repository, branch, commit, PR, file operations)
  - Permission-checked tool handlers
  - SDK-compatible tool result transformation

affects: [19-05, 19-06, agent-github-integration]

# Tech tracking
tech-stack:
  added: []
  patterns: ["MCP SDK request handler pattern", "Tool result transformation for SDK compatibility", "Switch-based tool routing"]

key-files:
  created:
    - packages/integrations/github/src/mcp/schemas.ts (pre-existing from 0035ff2)
    - packages/integrations/github/src/mcp/server.ts
    - packages/integrations/github/src/mcp/index.ts
    - packages/integrations/github/src/mcp/tools/repository.ts
    - packages/integrations/github/src/mcp/tools/pullrequests.ts
    - packages/integrations/github/src/mcp/tools/files.ts
    - packages/integrations/github/src/mcp/tools/index.ts
  modified:
    - packages/integrations/github/src/index.ts

decisions:
  - "MCP SDK uses Zod schemas for setRequestHandler (ListToolsRequestSchema, CallToolRequestSchema)"
  - "Tool handlers return MCPToolResult, server transforms to SDK CallToolResult format"
  - "Context passed to handlers includes only logger, correlationId, agentId, startTime"
  - "Switch statement for tool routing vs individual setRequestHandler calls"

metrics:
  duration: 9
  completed: 2026-01-23
---

# Phase 19 Plan 04: GitHub MCP Server Implementation

**GitHub MCP server with 9 tools for repository, branch, commit, PR, and file operations**

## Performance

- **Duration:** 9 min 14 sec
- **Started:** 2026-01-23T16:56:49Z
- **Completed:** 2026-01-23T17:06:03Z
- **Tasks:** 3/3
- **Files created:** 7
- **Files modified:** 1

## Accomplishments

- GitHub MCP server factory exports 9 tools for agent use
- Permission-checked tool handlers with input validation
- Tool result transformation for MCP SDK compatibility
- Full integration with existing GitHub operations

## Task Commits

1. **Task 1: Create GitHub MCP tool schemas** - Pre-existing from commit `0035ff2` (Plan 19-05 interference)
2. **Task 2: Create GitHub MCP tool implementations** - `38429bb` (feat)
3. **Task 3: Create GitHub MCP server factory and wire to exports** - `b0a6feb` (feat)

## Files Created/Modified

**Created:**
- `packages/integrations/github/src/mcp/schemas.ts` - Zod schemas for all 9 tools (repository, branch, commit, PR, file)
- `packages/integrations/github/src/mcp/server.ts` - MCP server factory with tool registration and routing
- `packages/integrations/github/src/mcp/index.ts` - Barrel export for MCP module
- `packages/integrations/github/src/mcp/tools/repository.ts` - handleGetRepository
- `packages/integrations/github/src/mcp/tools/pullrequests.ts` - 6 PR/branch/commit handlers
- `packages/integrations/github/src/mcp/tools/files.ts` - 2 file operation handlers
- `packages/integrations/github/src/mcp/tools/index.ts` - Tool barrel export

**Modified:**
- `packages/integrations/github/src/index.ts` - Added MCP module export

## Decisions Made

1. **MCP SDK Request Handler API**: Discovered that `setRequestHandler` takes Zod schemas (not method strings) as first parameter. Used `CallToolRequestSchema` and `ListToolsRequestSchema` from SDK types.

2. **Tool Result Transformation**: MCP SDK expects `{ content, isError }` format. Created transformation layer in server to convert our `MCPToolResult` (which includes `meta` and `structuredContent`) to SDK-compatible format.

3. **Tool Routing Pattern**: Used single `call_tool` handler with switch statement for routing to 9 different tool handlers. This centralizes request parsing and result transformation.

4. **Context Construction**: Simplified context to just `{ logger, correlationId, agentId, startTime }`. Logger comes from server options, other fields placeholder for future enhancement.

5. **exactOptionalPropertyTypes Handling**: Applied conditional property assignment pattern in pullrequests.ts for baseBranch, body, file.mode, mergeMethod, commitTitle, commitMessage to satisfy TypeScript's strict optional types.

## Deviations from Plan

**[Pre-existing Work]** Task 1 (schemas) was found to be already completed in commit `0035ff2` (Plan 19-05) from parallel execution thread. The schemas file was complete and correct, so I used it as-is. This saved ~5 minutes but created some confusion during execution.

**[Parallel Thread Interference]** During Task 3, discovered all MCP files (schemas + tools) were marked as deleted in git status. Another execution thread (Plan 19-05 for Slack) had interfered. Restored files from commits 38429bb and 0035ff2 before proceeding.

## Issues Encountered

**MCP SDK API Discovery**: Initial attempt to use `setRequestHandler({ method: "list_tools" }, ...)` failed. The SDK actually expects Zod schemas as the first parameter. Found correct API by examining `node_modules/@modelcontextprotocol/sdk/dist/esm/types.d.ts`.

**Type Incompatibility**: MCPToolResult return type didn't match SDK's expected CallToolResult. Solved by creating transformation layer that strips out `meta` and `structuredContent`, keeping only `content` and `isError`.

**File Restoration**: Files created in Tasks 1-2 were deleted by parallel execution. Used `git restore --source=<commit>` to recover them.

## User Setup Required

None - MCP server is library code, no runtime setup needed.

## Next Phase Readiness

- GitHub MCP server ready for agent integration
- All 9 tools functional and permission-checked
- Pattern established for Linear (19-05) and Slack (19-06) MCP servers
- Tool result format compatible with MCP SDK

**No blockers.**

---

*Phase: 19-mcp-layer*
*Completed: 2026-01-23*
