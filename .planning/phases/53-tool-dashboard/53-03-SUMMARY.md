---
phase: 53-tool-dashboard
plan: 03
subsystem: ui
tags: [recharts, charts, nuqs, next.js, shadcn, client-components, pagination]

# Dependency graph
requires:
  - phase: 53-tool-dashboard/01
    provides: shadcn chart component, recharts, tool service layer with metrics/timeSeries/failures queries
  - phase: 53-tool-dashboard/02
    provides: page layout with tabs, placeholder performance and failures components
provides:
  - Interactive tool performance charts (area, line, bar) with time range selector
  - Filterable paginated failure list with expandable error payloads
  - Complete 5-tab tools dashboard with all tabs fully functional
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "nuqs shallow:false for server data re-fetch on client filter change"
    - "ChartContainer wrapping Recharts for shadcn theming integration"
    - "Collapsible + JsonPayload for expandable error display"
    - "Server-side namespace resolution via tool registry for failure filtering"

key-files:
  created: []
  modified:
    - packages/dashboard/src/components/tools/tool-performance.tsx
    - packages/dashboard/src/components/tools/recent-failures.tsx
    - packages/dashboard/src/app/tools/page.tsx
    - packages/dashboard/src/services/tools.ts

key-decisions:
  - "getRecentToolFailures uses toolNames array param (not namespace string) for server-side filtering -- keeps service decoupled from registry structure"
  - "Failure rate derived client-side from timeSeries (failures/calls*100) rather than separate query"
  - "Top 15 tools by call count for latency bar chart to keep chart readable"
  - "ALL_VALUE sentinel (__all__) for Select component since Radix Select requires non-empty values"

patterns-established:
  - "Namespace-to-toolNames resolution in page.tsx: use tool registry to map namespace filter to tool name array before querying"
  - "ChartConfig satisfies pattern with var(--chart-N) CSS variables for theme-aware colors"

# Metrics
duration: 6min
completed: 2026-02-04
---

# Phase 53 Plan 03: Tool Performance Charts and Failure List Summary

**Interactive Recharts performance charts (call volume, failure rate, latency) with nuqs-driven time range selector, and filterable paginated failure table with expandable error payloads**

## Performance

- **Duration:** 6 min
- **Started:** 2026-02-04T20:20:25Z
- **Completed:** 2026-02-04T20:26:18Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Three performance charts: stacked area (call volume), line (failure rate %), grouped bar (p50/p95 latency by tool)
- Time range switching (1h/24h/7d) via nuqs URL state triggers server re-render for fresh data
- Filterable failure list with namespace and agent Select filters, both driving server-side queries
- Paginated failure table (25/page) with expandable error payloads (JSON via JsonPayload, plain text via pre)
- Conversation links from failure rows for quick navigation to conversation detail
- All 5 tabs on /tools fully functional: Registry, Permissions, Performance, Failures, Health

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement tool performance charts with time range selector** - `6ab0355` (feat)
2. **Task 2: Implement recent failures list and wire page.tsx data loading** - `244e664` (feat)

## Files Created/Modified
- `packages/dashboard/src/components/tools/tool-performance.tsx` - "use client" component with 3 Recharts charts (area, line, bar), time range selector, empty states
- `packages/dashboard/src/components/tools/recent-failures.tsx` - "use client" component with namespace/agent filters, paginated failure table, expandable errors
- `packages/dashboard/src/app/tools/page.tsx` - Server component updated to load timeSeries, metrics, and failures data; passes props to all 5 tab components
- `packages/dashboard/src/services/tools.ts` - getRecentToolFailures updated with toolNames filter support for namespace-based filtering

## Decisions Made
- **toolNames array over namespace string for failure filtering**: The service function `getRecentToolFailures` accepts `toolNames?: string[]` rather than `namespace?: string`. This keeps the service layer decoupled from the tool registry structure. The page.tsx resolves namespace to tool names using the already-fetched tool registry data.
- **Client-side failure rate derivation**: Failure rate percentage is computed in the ToolPerformance component from the timeSeries data (`failures / calls * 100`) rather than adding a separate server query, reducing DB load.
- **Top 15 tools for latency chart**: The bar chart shows only the top 15 tools by call count to prevent unreadable charts with many tools. The full metrics list is available in the Registry tab.
- **`__all__` sentinel value for Select**: Radix Select requires non-empty string values, so we use `"__all__"` as a sentinel and map it to `null` when setting nuqs state.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added toolNames filter to getRecentToolFailures**
- **Found during:** Task 2 (recent failures implementation)
- **Issue:** The service function accepted `namespace?: string` parameter but had no implementation for it. The event payload stores just `tool_name` without namespace, making direct namespace filtering impossible.
- **Fix:** Changed parameter from `namespace` to `toolNames: string[]` and added `inArray` SQL condition on `payload->>'tool_name'`. Page.tsx resolves namespace to tool names using the tool registry.
- **Files modified:** `packages/dashboard/src/services/tools.ts`
- **Verification:** Typecheck and build pass. Filter logic correctly constructs SQL WHERE clause.
- **Committed in:** 244e664 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** Essential for namespace filtering to work. The plan specified the namespace param but the existing service function had no implementation. Changed approach from namespace string to toolNames array for correctness.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 53 (Tool Dashboard) is complete. All 5 tabs are fully functional.
- Dashboard provides comprehensive tool observability: registry, permissions, performance charts, failure analysis, and integration health.
- Ready for Phase 54 and beyond.

---
*Phase: 53-tool-dashboard*
*Completed: 2026-02-04*
