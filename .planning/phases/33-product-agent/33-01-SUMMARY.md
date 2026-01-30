---
phase: 33-product-agent
plan: 01
subsystem: agents
tags: [linear, mcp, tools, search, product-agent, toolkit]

# Dependency graph
requires:
  - phase: 19-mcp-layer
    provides: MCP server infrastructure and tool patterns
  - phase: 30-dev-agent-tools
    provides: createMcpToolWrapper, integration tool factories, toolkit pattern
provides:
  - Linear search_issues MCP tool (server-side + agent-side)
  - createProductAgentToolkit factory (5 tools for product agent)
  - ProductAgentToolkitDeps interface
affects: [33-02 (product agent workflow), 33-03 (product agent nodes), 33-04 (product agent integration)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Product agent toolkit: minimal integration-only tool set (no codebase/coordination tools)"
    - "Linear searchIssues SDK method for duplicate detection"

key-files:
  created: []
  modified:
    - packages/integrations/linear/src/mcp/schemas.ts
    - packages/integrations/linear/src/mcp/tools/issues.ts
    - packages/integrations/linear/src/mcp/tools/index.ts
    - packages/integrations/linear/src/mcp/server.ts
    - packages/integrations/linear/scripts/seed-permissions.ts
    - packages/agents/src/shared/tools/integration/linear-tools.ts
    - packages/agents/src/shared/tools/toolkits.ts
    - packages/agents/src/shared/tools/integration/integration-tools.test.ts

key-decisions:
  - "Used client.searchIssues(query) (new SDK method) over deprecated issueSearch -- future-proof"
  - "Post-search team filtering in JS (searchIssues SDK has no teamId param) -- acceptable for default limit of 10"
  - "ProductAgentToolkitDeps is minimal (agentId + correlationId only) -- no container/budget/trace overhead"

patterns-established:
  - "Product agent toolkit: agentId + correlationId deps, filtered Linear + Slack tools"

# Metrics
duration: 5min
completed: 2026-01-30
---

# Phase 33 Plan 01: Linear search_issues MCP Tool and Product Agent Toolkit Summary

**End-to-end search_issues tool (Linear MCP handler + agent wrapper) and 5-tool createProductAgentToolkit factory for product agent**

## Performance

- **Duration:** 5 min
- **Started:** 2026-01-30T15:12:49Z
- **Completed:** 2026-01-30T15:18:07Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Linear MCP server now has 6 tools (was 5) with search_issues for duplicate detection
- Agent-side linear_search_issues wrapper follows existing createMcpToolWrapper pattern
- createProductAgentToolkit returns exactly 5 tools (4 Linear + 1 Slack)
- All 98 existing tools tests pass with no regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Add search_issues MCP tool to Linear integration** - `5619b7f` (feat)
2. **Task 2: Add linear_search_issues wrapper and createProductAgentToolkit** - `7e1bca6` (feat)

## Files Created/Modified
- `packages/integrations/linear/src/mcp/schemas.ts` - Added SearchIssuesInput/OutputSchema and SearchIssueResultSchema
- `packages/integrations/linear/src/mcp/tools/issues.ts` - Added handleSearchIssues with permission check, validation, team filtering, and result formatting
- `packages/integrations/linear/src/mcp/tools/index.ts` - Added handleSearchIssues barrel export
- `packages/integrations/linear/src/mcp/server.ts` - Registered search_issues in list_tools and call_tool handlers (6 tools)
- `packages/integrations/linear/scripts/seed-permissions.ts` - Added search_issues permission for dev-agent and product-agent
- `packages/agents/src/shared/tools/integration/linear-tools.ts` - Added linear_search_issues tool definition (6 tools total)
- `packages/agents/src/shared/tools/toolkits.ts` - Added ProductAgentToolkitDeps and createProductAgentToolkit factory
- `packages/agents/src/shared/tools/integration/integration-tools.test.ts` - Updated Linear tool count assertions (5 -> 6)

## Decisions Made
- Used `client.searchIssues(query)` (current SDK method) instead of deprecated `issueSearch` -- the SDK docs mark `issueSearch` as deprecated with guidance to use `searchIssues`
- Team filtering done in JavaScript after search (the `searchIssues` SDK method takes `term` as required param but doesn't expose `teamId` filtering natively) -- acceptable for small result sets
- `ProductAgentToolkitDeps` is intentionally minimal (just `agentId` and `correlationId`) since the product agent doesn't need codebase tools, container management, token budgets, or trace recording

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated integration-tools.test.ts for new tool count**
- **Found during:** Task 2 (agent wrapper and toolkit)
- **Issue:** Existing tests assert `createLinearTools` returns exactly 5 tools; adding `linear_search_issues` makes it 6
- **Fix:** Updated test expectations from 5 to 6 tools and added `linear_search_issues` to expected names array
- **Files modified:** `packages/agents/src/shared/tools/integration/integration-tools.test.ts`
- **Verification:** All 98 tools tests pass
- **Committed in:** `7e1bca6` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Test update is the direct consequence of the planned tool addition. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- search_issues tool ready for duplicate detection in product agent workflow (PROD-05)
- createProductAgentToolkit ready for product agent workflow construction (33-02)
- Linear MCP permission seeding includes both agents for search_issues

---
*Phase: 33-product-agent*
*Completed: 2026-01-30*
