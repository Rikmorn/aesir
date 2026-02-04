---
phase: 53-tool-dashboard
plan: 01
subsystem: ui
tags: [recharts, shadcn, drizzle, mcp-permissions, tool-metrics, service-layer]

# Dependency graph
requires:
  - phase: 49-dashboard-foundation
    provides: "Next.js app, shadcn/ui components, Drizzle DB client, service layer pattern"
  - phase: 52-agent-definitions-view
    provides: "agent-service HTTP client, AgentSummary type"
  - phase: 48-agent-service-api
    provides: "Tool registry and health API endpoints"
provides:
  - "Recharts v2 chart dependency and shadcn chart component"
  - "MCP permission table definitions for linear, github, slack schemas"
  - "Tool registry and health HTTP client functions"
  - "Complete tools service layer with 8 query functions"
  - "formatDurationMs and formatPercentage utilities"
affects: [53-tool-dashboard plans 02 and 03]

# Tech tracking
tech-stack:
  added: [recharts@^2.15.4]
  patterns: [MCP permission cross-reference, SQL percentile aggregation, time-bucketed metrics]

key-files:
  created:
    - packages/dashboard/src/components/ui/chart.tsx
    - packages/dashboard/src/services/tools.ts
  modified:
    - packages/dashboard/package.json
    - packages/dashboard/src/lib/schema.ts
    - packages/dashboard/src/lib/agent-service.ts
    - packages/dashboard/src/lib/format.ts
    - packages/dashboard/src/components/ui/card.tsx

key-decisions:
  - "Recharts v2 (not v3) for shadcn chart component compatibility"
  - "biome-ignore directives for shadcn-generated code patterns (dangerouslySetInnerHTML, mapped type key)"
  - "card.tsx updated to latest shadcn version as side effect of shadcn chart install"
  - "getToolCallMetrics as private helper to avoid duplicate SQL in getToolRegistry vs getToolMetrics"

patterns-established:
  - "MCP permission table cross-schema querying pattern (linear, github, slack)"
  - "Permission matrix mismatch detection (yaml-only, mcp-only) as pure function"
  - "SQL PERCENTILE_CONT via Drizzle sql template tag for latency percentiles"
  - "Time-bucketed aggregation with configurable bucket size for charts"

# Metrics
duration: 6min
completed: 2026-02-04
---

# Phase 53 Plan 01: Tool Dashboard Data Layer Summary

**Recharts v2 chart component, MCP permission schemas, tool registry/health HTTP clients, and complete tools service layer with 8 query functions covering registry, permissions, metrics, time series, and failures**

## Performance

- **Duration:** 6 min
- **Started:** 2026-02-04T20:02:26Z
- **Completed:** 2026-02-04T20:08:54Z
- **Tasks:** 3
- **Files modified:** 7

## Accomplishments
- Installed recharts v2 and added shadcn chart component with full export surface (ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent)
- Extended dashboard schema with MCP permission table definitions for all three integration schemas (linear, github, slack)
- Created complete tools service layer with 8 exported functions covering every data access need for the tools dashboard
- Added formatDurationMs and formatPercentage utilities to the shared format library

## Task Commits

Each task was committed atomically:

1. **Task 1: Install recharts and add shadcn chart component** - `e25ff16` (chore)
2. **Task 2: Extend schema and HTTP client with tool data sources** - `7af85ab` (feat)
3. **Task 3: Create tools service layer with all query functions** - `e2c5e59` (feat)

## Files Created/Modified
- `packages/dashboard/src/components/ui/chart.tsx` - shadcn chart component wrapping Recharts (ChartContainer, ChartTooltip, etc.)
- `packages/dashboard/src/services/tools.ts` - Complete tools service layer with 8 query functions
- `packages/dashboard/src/lib/schema.ts` - Added linearMcpPermissions, githubMcpPermissions, slackMcpPermissions table definitions
- `packages/dashboard/src/lib/agent-service.ts` - Added fetchToolRegistry(), fetchToolsHealth(), ToolRegistryEntry, IntegrationHealth
- `packages/dashboard/src/lib/format.ts` - Added formatDurationMs() and formatPercentage() helpers
- `packages/dashboard/package.json` - Added recharts dependency
- `packages/dashboard/src/components/ui/card.tsx` - Updated to latest shadcn version (side effect of chart install)

## Decisions Made
- Used recharts v2 (not v3) because shadcn chart component requires v2 -- the v3 migration PR is still unmerged
- Added biome-ignore directives for 3 shadcn-generated code patterns (dangerouslySetInnerHTML for CSS variable injection, mapped type key naming, __html property naming) rather than modifying shadcn code
- Accepted card.tsx update from shadcn CLI as part of chart installation -- the update adds CardAction and CardFooter exports without breaking existing imports
- Created getToolCallMetrics as a private internal helper to avoid duplicating the call/failure aggregation SQL between getToolRegistry (which needs basic metrics) and getToolMetrics (which adds percentiles)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed shadcn-generated code to pass Biome linting**
- **Found during:** Task 1 (chart component installation)
- **Issue:** shadcn CLI generates code without semicolons and with patterns (dangerouslySetInnerHTML, mapped type keys) that Biome flags
- **Fix:** Ran biome format for semicolons, added 3 biome-ignore directives for unfixable patterns
- **Files modified:** packages/dashboard/src/components/ui/chart.tsx
- **Verification:** pnpm run lint passes clean
- **Committed in:** e25ff16 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Auto-fix necessary for pre-commit hook to pass. No scope creep.

## Issues Encountered
None -- all three tasks executed cleanly once formatting issues were resolved.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Complete data access layer is ready for Plan 02 (page layout + server components) and Plan 03 (client interactive components)
- Every query the UI needs can be satisfied by calling a function from services/tools.ts
- No UI components exist yet for the tools dashboard -- this is purely the data foundation
- Recharts and chart component are installed and ready for performance charts in Plan 03

---
*Phase: 53-tool-dashboard*
*Completed: 2026-02-04*
