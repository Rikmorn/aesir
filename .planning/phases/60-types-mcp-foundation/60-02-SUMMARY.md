---
phase: 60-types-mcp-foundation
plan: 02
subsystem: mcp
tags: [mcp, linear, github, octokit, zod, integration-tools]

# Dependency graph
requires:
  - phase: none
    provides: "Existing MCP infrastructure (server factories, HTTP routers, tool handlers)"
provides:
  - "Linear MCP SDK server create_comment tool (7 tools total, matching HTTP router)"
  - "GitHub create_pr_comment MCP tool with Zod schemas, handler, SDK server and HTTP router registration"
affects: [63-outbound-denormalizer, 64-communication-tools]

# Tech tracking
tech-stack:
  added: []
  patterns: ["MCP tool handler pattern: permission check -> input validation -> operation call -> structured result"]

key-files:
  created: []
  modified:
    - packages/integrations/linear/src/mcp/server.ts
    - packages/integrations/github/src/mcp/schemas.ts
    - packages/integrations/github/src/mcp/tools/pullrequests.ts
    - packages/integrations/github/src/mcp/server.ts
    - packages/integrations/github/src/api/mcp.ts

key-decisions:
  - "PR comments use issues.createComment (conversation thread) not pulls.createReview (code review)"

patterns-established:
  - "MCP tool registration: add to both SDK server (ListTools + CallTool) and HTTP router (TOOL_DEFINITIONS + switch/case)"

# Metrics
duration: 3min
completed: 2026-02-08
---

# Phase 60 Plan 02: MCP Tool Wiring Summary

**Wired create_comment in Linear MCP SDK server and implemented create_pr_comment end-to-end in GitHub integration**

## Performance

- **Duration:** 2m 41s
- **Started:** 2026-02-08T17:35:10Z
- **Completed:** 2026-02-08T17:37:51Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Linear MCP SDK server now exposes create_comment (7 tools total, matching HTTP router's 7)
- GitHub integration has full create_pr_comment MCP tool: Zod schemas, handler with permission check, SDK server and HTTP router registration (10 tools total)
- Both integrations pass typecheck with full monorepo pre-commit hook verification

## Task Commits

Each task was committed atomically:

1. **Task 1: Register create_comment in Linear MCP SDK server** - `356fe97` (feat)
2. **Task 2: Implement create_pr_comment in GitHub integration** - `baf5b0a` (feat)

## Files Created/Modified
- `packages/integrations/linear/src/mcp/server.ts` - Added handleCreateComment import, create_comment tool definition, CallTool case, updated tool count to 7
- `packages/integrations/github/src/mcp/schemas.ts` - Added CreatePRCommentInputSchema and PRCommentOutputSchema Zod schemas
- `packages/integrations/github/src/mcp/tools/pullrequests.ts` - Added handleCreatePRComment handler with permission check, input validation, addPRComment call
- `packages/integrations/github/src/mcp/server.ts` - Registered create_pr_comment in ListTools and CallTool, updated tool count to 10
- `packages/integrations/github/src/api/mcp.ts` - Registered create_pr_comment in TOOL_DEFINITIONS and POST switch/case

## Decisions Made
- PR comments use `issues.createComment` (conversation thread comments) per existing `addPRComment` operation, not `pulls.createReview` (code review comments)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Biome formatting fix in handleCreatePRComment error handler**
- **Found during:** Task 2 (commit attempt)
- **Issue:** Multi-line `context.logger.error()` call didn't match Biome's formatting expectations
- **Fix:** Collapsed to single-line format to match Biome rules
- **Files modified:** packages/integrations/github/src/mcp/tools/pullrequests.ts
- **Verification:** Pre-commit hook passed on retry
- **Committed in:** baf5b0a (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 formatting)
**Impact on plan:** Trivial formatting fix. No scope creep.

## Issues Encountered
- Task 1 commit picked up 2 unrelated staged files from a parallel plan execution (packages/agents/src/shared/communication/index.ts and types.ts). This is the known parallel execution artifact.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Both MCP tools are wired and ready for use by the outbound denormalizer (Phase 63) and communication tools (Phase 64)
- Linear: 7 tools in both SDK server and HTTP router (consistent)
- GitHub: 10 tools in both SDK server and HTTP router (consistent)

## Self-Check: PASSED

All 5 modified files verified present. Both commit hashes (356fe97, baf5b0a) found in git log.

---
*Phase: 60-types-mcp-foundation*
*Completed: 2026-02-08*
