---
phase: 19-mcp-layer
verified: 2026-01-23T17:45:00Z
status: passed
score: 4/4 must-haves verified
---

# Phase 19: MCP Layer Verification Report

**Phase Goal:** MCP servers in each integration enabling standardized agent tool calls
**Verified:** 2026-01-23T17:45:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Each integration (Linear, GitHub, Slack) exposes an MCP server with tools for its operations | ✓ VERIFIED | All three integrations have `/mcp/tools` endpoints with registered tools. Linear: 5 tools, GitHub: 9 tools, Slack: 5 tools |
| 2 | Agents can discover and call integration tools via MCP protocol | ✓ VERIFIED | GET `/mcp/tools` returns tool list with JSON Schema. POST `/mcp/tools/:name` accepts tool arguments and returns results |
| 3 | MCP tool calls are logged with correlation IDs for traceability | ✓ VERIFIED | All tool handlers extract X-Correlation-ID header, bind to logger, and include in response meta |
| 4 | MCP server configuration specifies available tools per agent (tool whitelisting) | ✓ VERIFIED | All tools check permissions via `check{Integration}ToolPermission` before execution. Database-backed allow-list approach |

**Score:** 4/4 truths verified

### Required Artifacts

#### Plan 01: MCP SDK and Shared Types

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `@modelcontextprotocol/sdk` dependency | Installed in all 3 integrations | ✓ VERIFIED | v1.25.3 in linear, github, slack packages |
| `packages/common/src/mcp/types.ts` | Type definitions for MCPToolContext, MCPToolResult | ✓ VERIFIED | 57 lines, exports MCPToolContext, MCPToolResult, MCPToolMeta, PermissionChecker |
| `packages/common/src/mcp/schemas.ts` | Zod schemas for MCP tools | ✓ VERIFIED | 45 lines, exports MCPToolMetaSchema, MCPTextContentSchema, createToolResultSchema |
| `packages/common/src/mcp/index.ts` | Helper functions createToolResult, createErrorResult | ✓ VERIFIED | 67 lines, exports helper functions with proper implementation |
| `packages/common/src/index.ts` | Re-exports MCP module | ✓ VERIFIED | Line 16: `export * from "./mcp/index.js";` |

#### Plan 02: Permission Schemas and Checkers

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/integrations/linear/src/db/schema.ts` | mcpToolPermissions table in linear schema | ✓ VERIFIED | Line 89: `export const mcpToolPermissions = linearSchema.table(...)` |
| `packages/integrations/github/src/db/schema.ts` | mcpToolPermissions table in github schema | ✓ VERIFIED | Line 90: `export const mcpToolPermissions = githubSchema.table(...)` |
| `packages/integrations/slack/src/db/schema.ts` | mcpToolPermissions table in slack schema | ✓ VERIFIED | Line 128: `export const mcpToolPermissions = slackSchema.table(...)` |
| `packages/integrations/linear/src/db/permissions.ts` | checkLinearToolPermission function | ✓ VERIFIED | 79 lines, implements allow-list logic with database query |
| `packages/integrations/github/src/db/permissions.ts` | checkGitHubToolPermission function | ✓ VERIFIED | 79 lines, implements allow-list logic with database query |
| `packages/integrations/slack/src/db/permissions.ts` | checkSlackToolPermission function | ✓ VERIFIED | 79 lines, implements allow-list logic with database query |

#### Plan 03: Linear MCP Server

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/integrations/linear/src/mcp/server.ts` | MCP server factory | ⚠️ ORPHANED | 215 lines, exports createLinearMCPServer but NOT USED. Duplicate routing in api/mcp.ts |
| `packages/integrations/linear/src/mcp/tools/issues.ts` | Issue-related tools | ✓ VERIFIED | Exports handleGetIssue, handleCreateIssue, handleUpdateIssueStatus. All call checkLinearToolPermission |
| `packages/integrations/linear/src/mcp/tools/teams.ts` | Team-related tools | ✓ VERIFIED | Exports handleListTeams, handleListLabels. Both call checkLinearToolPermission |
| `packages/integrations/linear/src/mcp/schemas.ts` | Tool input schemas | ✓ VERIFIED | Exports GetIssueInputSchema, CreateIssueInputSchema, UpdateIssueStatusInputSchema, ListTeamsInputSchema, ListLabelsInputSchema |

#### Plan 04: GitHub MCP Server

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/integrations/github/src/mcp/server.ts` | MCP server factory | ⚠️ ORPHANED | 361 lines, exports createGitHubMCPServer but NOT USED. Duplicate routing in api/mcp.ts |
| `packages/integrations/github/src/mcp/tools/pullrequests.ts` | PR-related tools | ✓ VERIFIED | Exports handleCreatePR, handleGetPR, handleListPRs, handleMergePR. All call checkGitHubToolPermission |
| `packages/integrations/github/src/mcp/tools/repository.ts` | Repository tools | ✓ VERIFIED | Exports handleGetRepository. Calls checkGitHubToolPermission |
| `packages/integrations/github/src/mcp/tools/files.ts` | File operation tools | ✓ VERIFIED | Exports handleGetFileContents, handleListFiles. Both call checkGitHubToolPermission |
| `packages/integrations/github/src/mcp/schemas.ts` | Tool input schemas | ✓ VERIFIED | Exports CreatePRInputSchema, GetPRInputSchema, ListPRsInputSchema, MergePRInputSchema, GetRepositoryInputSchema, GetFileContentsInputSchema, ListFilesInputSchema |

#### Plan 05: Slack MCP Server

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/integrations/slack/src/mcp/server.ts` | MCP server factory | ⚠️ ORPHANED | 501 lines, exports createSlackMCPServer but NOT USED. Duplicate routing in api/mcp.ts |
| `packages/integrations/slack/src/mcp/tools/messages.ts` | Message-related tools | ✓ VERIFIED | Exports handleSendMessage, handleSendApprovalRequest, handleGetMessage, handleReplyToThread. All call checkSlackToolPermission |
| `packages/integrations/slack/src/mcp/tools/channels.ts` | Channel tools | ✓ VERIFIED | Exports handleListChannels. Calls checkSlackToolPermission |
| `packages/integrations/slack/src/mcp/schemas.ts` | Tool input schemas | ✓ VERIFIED | Exports SendMessageInputSchema, SendApprovalRequestInputSchema, GetMessageInputSchema, ReplyToThreadInputSchema, ListChannelsInputSchema |

#### Plan 06: HTTP Routes

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/integrations/linear/src/api/mcp.ts` | Linear MCP HTTP routes | ✓ VERIFIED | Exports createMCPRouter with GET `/mcp/tools` and POST `/mcp/tools/:name` |
| `packages/integrations/github/src/api/mcp.ts` | GitHub MCP HTTP routes | ✓ VERIFIED | Exports createMCPRouter with GET `/mcp/tools` and POST `/mcp/tools/:name` |
| `packages/integrations/slack/src/api/mcp.ts` | Slack MCP HTTP routes | ✓ VERIFIED | Exports createMCPRouter with GET `/mcp/tools` and POST `/mcp/tools/:name` |
| `packages/integrations/linear/src/main.ts` | Linear main.ts wires MCP router | ✓ VERIFIED | Line 39: `const mcpRouter = createMCPRouter(...); app.use("/", mcpRouter);` |
| `packages/integrations/github/src/main.ts` | GitHub main.ts wires MCP router | ✓ VERIFIED | Line 56: `const mcpRouter = createMCPRouter(...); app.use("/", mcpRouter);` |
| `packages/integrations/slack/src/main.ts` | Slack main.ts wires MCP router | ✓ VERIFIED | Line 145: `const mcpRouter = createMCPRouter(...); app.use("/", mcpRouter);` |

#### Plan 07: Tests

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/integrations/linear/src/db/permissions.test.ts` | Linear permission tests | ✓ VERIFIED | 145 lines, tests allow/deny cases with mocked database |
| `packages/integrations/github/src/db/permissions.test.ts` | GitHub permission tests | ✓ VERIFIED | 145 lines, tests allow/deny cases with mocked database |
| `packages/integrations/slack/src/db/permissions.test.ts` | Slack permission tests | ✓ VERIFIED | 145 lines, tests allow/deny cases with mocked database |
| `packages/integrations/linear/src/mcp/schemas.test.ts` | Linear schema validation tests | ✓ VERIFIED | Tests Zod schema validation for all tool inputs |
| `packages/integrations/github/src/mcp/schemas.test.ts` | GitHub schema validation tests | ✓ VERIFIED | Tests Zod schema validation for all tool inputs |
| `packages/integrations/slack/src/mcp/schemas.test.ts` | Slack schema validation tests | ✓ VERIFIED | Tests Zod schema validation for all tool inputs |

#### Plan 08: Seed Scripts and Documentation

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/integrations/linear/scripts/seed-permissions.ts` | Linear permission seeding | ✓ VERIFIED | 68 lines, seeds permissions for dev-agent and product-agent |
| `packages/integrations/github/scripts/seed-permissions.ts` | GitHub permission seeding | ✓ VERIFIED | Seeds permissions for dev-agent and product-agent |
| `packages/integrations/slack/scripts/seed-permissions.ts` | Slack permission seeding | ✓ VERIFIED | Seeds permissions for dev-agent and product-agent |
| `packages/integrations/*/package.json` | npm script seed:permissions | ✓ VERIFIED | All three packages have `"seed:permissions": "tsx scripts/seed-permissions.ts"` |
| `.claude/CLAUDE.md` | Updated with MCP documentation | ✓ VERIFIED | Lines 316-376: MCP Layer section with endpoints, permissions, headers, rate limiting |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `packages/integrations/*/package.json` | `@modelcontextprotocol/sdk` | dependencies | ✓ WIRED | All three packages list v1.25.3 in dependencies |
| `packages/common/src/index.ts` | `packages/common/src/mcp/index.ts` | export | ✓ WIRED | Line 16 exports MCP module |
| `packages/integrations/*/src/mcp/tools/*.ts` | `checkXxxToolPermission` | import and call | ✓ WIRED | All tool handlers import permission checker and call before execution |
| `packages/integrations/*/src/mcp/tools/*.ts` | Integration client operations | import and call | ✓ WIRED | Linear: createLinearClientFromDatabase, GitHub: createGitHubClientFromDatabase, Slack: createSlackClientFromDatabase |
| `packages/integrations/*/src/api/mcp.ts` | Tool handlers | import and call | ✓ WIRED | All MCP HTTP routes import tool handlers and call them with context |
| `packages/integrations/*/src/main.ts` | `createMCPRouter` | import and mount | ✓ WIRED | All main.ts files import createMCPRouter and mount to Express app |
| MCP HTTP routes | X-Correlation-ID header | extraction | ✓ WIRED | All routes extract header or generate correlation ID |
| MCP HTTP routes | X-Agent-ID header | extraction | ✓ WIRED | All routes extract header and return 400 if missing |
| Tool handlers | Response metadata | inclusion | ✓ WIRED | All tool responses include meta: { correlation_id, duration_ms } |

### Requirements Coverage

| Requirement | Status | Blocking Issue |
|-------------|--------|----------------|
| ARCH-05: MCP servers in each integration for agent tool calls | ✓ SATISFIED | N/A |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `packages/integrations/*/src/mcp/server.ts` | N/A | Exported but unused (orphaned code) | ⚠️ WARNING | server.ts creates MCP SDK Server instances but they're not used. HTTP routes in api/mcp.ts duplicate the routing logic. This doesn't block goal achievement but creates maintenance burden |
| `packages/integrations/linear/src/mcp/server.ts` | 161-162 | Hardcoded "unknown" for correlationId and agentId | ℹ️ INFO | If server.ts were used, it wouldn't extract headers properly. However, since it's orphaned and api/mcp.ts is used instead (which does extract headers), this doesn't impact functionality |

### Architecture Notes

**Design Decision: HTTP Routes vs MCP SDK Server**

The phase implemented TWO approaches for exposing MCP tools:

1. **server.ts files**: Use `@modelcontextprotocol/sdk`'s Server class with `setRequestHandler` for `ListToolsRequestSchema` and `CallToolRequestSchema`. These are exported but NOT used anywhere.

2. **api/mcp.ts files**: Create Express routers with GET `/mcp/tools` and POST `/mcp/tools/:name` endpoints. These properly extract correlation ID and agent ID from HTTP headers and are the actual implementation wired into main.ts.

**Impact:**
- Phase goal is ACHIEVED - agents can call tools via MCP protocol through HTTP endpoints
- Tools properly check permissions, extract correlation IDs, and return metadata
- Orphaned server.ts files create technical debt but don't block functionality

**Recommendation:**
Either remove server.ts files or refactor api/mcp.ts to use the MCP SDK Server class with proper header extraction. Current duplication should be addressed in a future refactoring phase.

### Human Verification Required

#### 1. End-to-End MCP Tool Call

**Test:** Make an HTTP request to Linear MCP endpoint:
```bash
curl -X POST http://localhost:3001/mcp/tools/list_teams \
  -H "X-Agent-ID: dev-agent" \
  -H "X-Correlation-ID: test-123" \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Expected:** 
- Response includes correlation_id: "test-123" in meta
- Response includes duration_ms in meta
- If permissions are seeded, returns team list with status 200
- If permissions not seeded, returns permission denied error

**Why human:** Requires running services, database with migrations, and seeded permissions

#### 2. Permission Enforcement

**Test:** 
1. Call `pnpm --filter @aesir/integration-linear seed:permissions`
2. Make MCP tool call with X-Agent-ID: "dev-agent" (should succeed)
3. Make MCP tool call with X-Agent-ID: "unknown-agent" (should fail with permission denied)

**Expected:**
- dev-agent calls succeed (200 response)
- unknown-agent calls fail (403 or error response with "Permission denied")

**Why human:** Requires database setup and verification of database state

#### 3. Tool Discovery

**Test:** GET http://localhost:3001/mcp/tools

**Expected:**
- Returns JSON with tools array
- Each tool has name, description, inputSchema
- inputSchema is valid JSON Schema (type: "object", properties, required)

**Why human:** Requires running service and visual inspection of tool metadata

---

_Verified: 2026-01-23T17:45:00Z_
_Verifier: Claude (gsd-verifier)_
