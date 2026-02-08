---
phase: 60-types-mcp-foundation
plan: 03
subsystem: agents
tags: [mcp, tool-registry, zod, linear, github, permissions]

# Dependency graph
requires:
  - phase: 60-02
    provides: "Linear create_comment and GitHub create_pr_comment MCP endpoints"
provides:
  - "Agent-side linear:create_comment tool wrapper registered in ToolRegistry"
  - "Agent-side github:create_pr_comment tool wrapper registered in ToolRegistry"
  - "GitHub seed-permissions includes create_pr_comment for dev-agent"
affects: [agent-definitions, dev-agent, product-agent]

# Tech tracking
tech-stack:
  added: []
  patterns: ["MCP tool wrapper with local Zod schema and displayName convention"]

key-files:
  created: []
  modified:
    - packages/agents/src/shared/tools/integration/linear-tools.ts
    - packages/agents/src/shared/tools/integration/github-tools.ts
    - packages/agents/src/framework/tool-factories.ts
    - packages/integrations/github/scripts/seed-permissions.ts

key-decisions:
  - "Product-agent excluded from create_pr_comment (read-only GitHub access pattern)"

patterns-established:
  - "MCP tool wrappers use local Zod schemas (no integration package imports)"
  - "displayName convention: {integration}_{toolName} for LLM-visible tool names"

# Metrics
duration: 3min
completed: 2026-02-08
---

# Phase 60 Plan 03: Agent Tool Registration Summary

**Agent-side MCP wrappers for linear:create_comment and github:create_pr_comment registered in ToolRegistry (36 total tools)**

## Performance

- **Duration:** 2m 36s
- **Started:** 2026-02-08T17:40:12Z
- **Completed:** 2026-02-08T17:42:48Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Added linear_create_comment tool wrapper (7th Linear tool) with local Zod schema
- Added github_create_pr_comment tool wrapper (10th GitHub tool) with local Zod schema
- Registered both tools in ToolRegistry via tool-factories.ts (36 total registrations)
- Added create_pr_comment permission for dev-agent in GitHub seed-permissions

## Task Commits

Each task was committed atomically:

1. **Task 1: Add agent-side tool wrappers for both new MCP tools** - `6e47715` (feat)
2. **Task 2: Register tools in ToolRegistry and update permission seeding** - `639e693` (feat)

## Files Created/Modified
- `packages/agents/src/shared/tools/integration/linear-tools.ts` - Added createCommentSchema and 7th tool entry
- `packages/agents/src/shared/tools/integration/github-tools.ts` - Added createPRCommentSchema and 10th tool entry
- `packages/agents/src/framework/tool-factories.ts` - Registered linear:create_comment and github:create_pr_comment (36 total)
- `packages/integrations/github/scripts/seed-permissions.ts` - Added create_pr_comment for dev-agent

## Decisions Made
- Product-agent excluded from create_pr_comment permission (follows existing read-only GitHub access pattern for product-agent)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 60 complete: all 3 plans delivered
- MCP tool pipeline is fully wired from agent definition YAML through ToolRegistry to integration HTTP endpoints
- Agents can now reference linear:create_comment and github:create_pr_comment in their definition.yaml tool lists
- GitHub permissions need re-seeding in environments where create_pr_comment is needed

## Self-Check: PASSED

All files verified present. All commit hashes verified in git log.

---
*Phase: 60-types-mcp-foundation*
*Completed: 2026-02-08*
