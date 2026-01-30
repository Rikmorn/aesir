---
phase: 30-agent-tool-library
plan: 02
subsystem: agents
tags: [mcp-tools, integration-wrapper, zod, linear, github, slack, tool-factory]

# Dependency graph
requires:
  - phase: 28-agentic-loop-runtime
    provides: ToolDefinition and ToolResult interfaces
  - phase: 19-mcp-layer
    provides: callMcpTool HTTP client and McpError class
provides:
  - 19 MCP integration tool factories (5 Linear + 9 GitHub + 5 Slack)
  - Generic createMcpToolWrapper helper for boilerplate elimination
  - McpToolDeps interface for agent/correlation ID injection
  - Barrel export for integration tool module
affects: [30-03, 31-dev-agent-orchestrator, 32-product-agent-orchestrator]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Generic MCP wrapper: createMcpToolWrapper(config, deps) -> ToolDefinition"
    - "Integration-namespaced tool names (linear_, github_, slack_ prefixes)"
    - "Local Zod schemas (no cross-package coupling to @aesir/integration-*)"
    - "McpError -> isError:true conversion for LLM error reasoning"

key-files:
  created:
    - packages/agents/src/shared/tools/integration/mcp-wrapper.ts
    - packages/agents/src/shared/tools/integration/linear-tools.ts
    - packages/agents/src/shared/tools/integration/github-tools.ts
    - packages/agents/src/shared/tools/integration/slack-tools.ts
    - packages/agents/src/shared/tools/integration/index.ts
    - packages/agents/src/shared/tools/integration/integration-tools.test.ts
  modified: []

key-decisions:
  - "Local Zod schemas for all 19 tools -- no imports from @aesir/integration-* packages"
  - "Namespaced display names (linear_, github_, slack_ prefixes) to avoid LLM confusion between integrations"
  - "Block Kit parameters omitted from Slack tools -- text-based messaging sufficient for agent communication"

patterns-established:
  - "MCP tool wrapper pattern: config object + deps -> ToolDefinition via createMcpToolWrapper"
  - "Each tool is ~10 lines of config (schema + wrapper call) instead of a full execute() function"
  - "Integration factory pattern: createLinearTools(deps) returns ToolDefinition[]"

# Metrics
duration: 5min
completed: 2026-01-30
---

# Phase 30 Plan 02: MCP Integration Tools Summary

**19 MCP integration tool factories (5 Linear, 9 GitHub, 5 Slack) using a generic createMcpToolWrapper helper with local Zod schemas and McpError-to-isError conversion**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-01-30T10:54:01Z
- **Completed:** 2026-01-30T10:58:38Z
- **Tasks:** 2
- **Files created:** 6

## Accomplishments
- Generic createMcpToolWrapper helper eliminates boilerplate across all 19 tools -- each tool is config-only
- 5 Linear tools: get_issue, create_issue, update_issue_status, list_teams, list_labels
- 9 GitHub tools: get_repository, create_branch, create_commit, create_pull_request, get_pull_request, list_pull_requests, merge_pull_request, get_file_contents, list_files
- 5 Slack tools: send_message, send_approval_request, get_message, reply_to_thread, list_channels
- All Zod input schemas defined locally in the agents package (zero coupling to integration packages)
- McpError caught and returned as isError:true so the LLM can reason about integration failures
- 20 test cases covering wrapper helper (8 tests), Linear (4), GitHub (4), Slack (4)

## Task Commits

Each task was committed atomically:

1. **Task 1: MCP wrapper helper and 19 integration tool factories** - `7694088` (feat)
2. **Task 2: Integration tool tests** - `0e52625` (test)

## Files Created/Modified
- `packages/agents/src/shared/tools/integration/mcp-wrapper.ts` - McpToolDeps interface, McpToolConfig interface, createMcpToolWrapper generic helper
- `packages/agents/src/shared/tools/integration/linear-tools.ts` - 5 Linear tool factories with local Zod schemas
- `packages/agents/src/shared/tools/integration/github-tools.ts` - 9 GitHub tool factories with local Zod schemas
- `packages/agents/src/shared/tools/integration/slack-tools.ts` - 5 Slack tool factories with local Zod schemas
- `packages/agents/src/shared/tools/integration/index.ts` - Barrel export for all integration tools
- `packages/agents/src/shared/tools/integration/integration-tools.test.ts` - 20 test cases

## Decisions Made
- Local Zod schemas for all 19 tools -- defining schemas in the agents package avoids importing from @aesir/integration-* which would create cross-package coupling between agents and integration services
- Namespaced display names with integration prefixes (linear_, github_, slack_) -- prevents the LLM from confusing tools across integrations (e.g., both Linear and GitHub have "issue" concepts)
- Block Kit parameters omitted from Slack tools -- Block Kit JSON is complex for LLMs to construct correctly; text-based messaging is sufficient for agent communication and Block Kit can be added later if needed

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Biome pre-commit hook rejected initial commits due to import ordering (value imports before type imports in combined statements) and formatting (long lines). Fixed with `npx biome check --write` and re-committed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All 19 MCP integration tools ready for toolkit assembly (Plan 30-03)
- McpToolDeps provides the dependency interface for toolkit construction
- Pattern proven: createMcpToolWrapper + local schemas + namespaced names

---
*Phase: 30-agent-tool-library*
*Completed: 2026-01-30*
