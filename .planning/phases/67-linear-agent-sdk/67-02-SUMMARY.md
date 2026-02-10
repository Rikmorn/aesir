---
phase: 67-linear-agent-sdk
plan: 02
subsystem: mcp
tags: [linear, agent-sdk, oauth, mcp-tools, activities, zod, token-refresh]

# Dependency graph
requires:
  - phase: 67-01
    provides: "withTokenRefresh middleware for 401 retry and createLinearCredentialStore"
provides:
  - "OAuth actor=app flow with app:assignable and app:mentionable scopes"
  - "create_agent_activity MCP tool with 5 typed activity payloads"
  - "update_session_state MCP tool via activity emission for state transitions"
  - "Zod schemas for CreateAgentActivityInput and UpdateSessionStateInput"
  - "MCP permissions seeded for dev-agent on both new tools"
affects: [67-03-denormalizer-routing, 67-04-echo-filter-removal]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Activity-driven state transitions: update_session_state emits activities rather than calling a status mutation"
    - "Content type dispatch via switch statement for 5 activity types with field validation"
    - "ActivityToolDeps uses PinoLogger (not MCPLogger) because withTokenRefresh requires richer interface"

key-files:
  created:
    - packages/integrations/linear/src/mcp/tools/activities.ts
  modified:
    - packages/integrations/linear/src/api/oauth.ts
    - packages/integrations/linear/src/mcp/schemas.ts
    - packages/integrations/linear/src/mcp/tools/index.ts
    - packages/integrations/linear/src/mcp/server.ts
    - packages/integrations/linear/scripts/seed-permissions.ts

key-decisions:
  - "update_session_state emits activities instead of calling updateAgentSession because Linear SDK has no status field in AgentSessionUpdateInput -- state is driven by activity types"
  - "ActivityToolDeps.logger typed as PinoLogger (not MCPLogger) since withTokenRefresh and createLinearCredentialStore require PinoLogger interface"
  - "STATUS_TO_ACTIVITY mapping with default body messages for each state transition (e.g., error -> error activity with 'Session encountered an error.')"

patterns-established:
  - "Activity content dispatch pattern: switch on type, validate required fields per type, build JSONObject payload"
  - "State-via-activity pattern: callers specify desired status, tool maps to activity type and emits it"

# Metrics
duration: 6min
completed: 2026-02-10
---

# Phase 67 Plan 02: Actor=App Migration and Activity MCP Tools Summary

**OAuth actor=app with agent scopes, create_agent_activity MCP tool for 5 typed activities, and update_session_state tool using activity-driven state transitions with withTokenRefresh**

## Performance

- **Duration:** 6 min
- **Started:** 2026-02-10T15:33:35Z
- **Completed:** 2026-02-10T15:40:32Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Updated OAuth authorize URL to use `actor=app` with `app:assignable,app:mentionable` scopes for agent identity in Linear
- Created `create_agent_activity` MCP tool handling all 5 activity types (thought, action, response, error, elicitation) with content-type-specific field validation and ephemeral constraint enforcement
- Created `update_session_state` MCP tool that maps desired statuses to activity emissions (since Linear has no direct status mutation)
- Added Zod schemas for both tool inputs/outputs with comprehensive validation
- Registered both tools in MCP server (now 9 tools) and seeded permissions for dev-agent

## Task Commits

Each task was committed atomically:

1. **Task 1: Update OAuth flow for actor=app and add activity MCP tool schemas** - `d86f99a` (feat)
2. **Task 2: Create activity MCP tool handlers, register in server, and seed permissions** - `d0d2ff5` (feat)

## Files Created/Modified
- `packages/integrations/linear/src/mcp/tools/activities.ts` - New: handleCreateAgentActivity (content dispatch, ephemeral validation) and handleUpdateSessionState (status-to-activity mapping) with withTokenRefresh
- `packages/integrations/linear/src/api/oauth.ts` - Changed actor from "application" to "app", added app:assignable,app:mentionable scopes
- `packages/integrations/linear/src/mcp/schemas.ts` - Added CreateAgentActivityInputSchema (5 types + ephemeral), UpdateSessionStateInputSchema (5 statuses), and corresponding output schemas
- `packages/integrations/linear/src/mcp/tools/index.ts` - Barrel exports for new activity tool handlers and ActivityToolDeps type
- `packages/integrations/linear/src/mcp/server.ts` - Registered 2 new tools (9 total), added activityToolDeps, added switch cases
- `packages/integrations/linear/scripts/seed-permissions.ts` - Added create_agent_activity and update_session_state permissions for dev-agent

## Decisions Made
- **Activity-driven state transitions:** The plan specified `client.agentSessionUpdate(id, { status })` but the Linear SDK `AgentSessionUpdateInput` has no `status` field. Linear drives session state from the last emitted activity type. The `update_session_state` tool maps desired statuses to the correct activity type (error->error activity, complete->response activity, etc.). This aligns with Linear's design as documented in research ("tracks session lifecycle automatically based on the last emitted activity").
- **PinoLogger for ActivityToolDeps:** Unlike IssueToolDeps/TeamToolDeps which use MCPLogger, ActivityToolDeps needs PinoLogger because `withTokenRefresh` and `createLinearCredentialStore` require the richer Pino interface. The MCP server already passes PinoLogger, so this is type-safe at the call site.
- **Default body messages for state transitions:** When `update_session_state` emits activities for state transitions, it uses sensible default messages (e.g., "Session encountered an error."). The executor can override by calling `create_agent_activity` directly with custom messages.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] update_session_state uses activity emission instead of agentSessionUpdate**
- **Found during:** Task 2 (activity MCP tool handlers)
- **Issue:** Plan specified `client.agentSessionUpdate(input.sessionId, { status: input.status })` but Linear SDK `AgentSessionUpdateInput` type has no `status` field -- it only supports externalUrls, externalLink, plan, and dismissedAt
- **Fix:** Implemented STATUS_TO_ACTIVITY mapping that emits the appropriate activity type to trigger the desired state transition (thought->active, response->complete, error->error, elicitation->awaitingInput)
- **Files modified:** packages/integrations/linear/src/mcp/tools/activities.ts
- **Verification:** TypeScript compilation passes, all 5 status mappings covered
- **Committed in:** d0d2ff5 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Necessary adaptation to actual SDK API surface. The tool's external interface (sessionId + status) is unchanged -- only the internal implementation differs. No scope creep.

## Issues Encountered
- Biome pre-commit hook caught formatting issues (tabs vs spaces in activities.ts, enum array formatting in server.ts, import ordering in index.ts). Resolved by running `pnpm run format` and `pnpm run lint:fix`.

## User Setup Required
None - no external service configuration required. OAuth re-authorization with new scopes will be needed at deployment time (manual step documented in CONTEXT.md).

## Next Phase Readiness
- Activity tools ready for the denormalizer to route to in Plan 67-03
- OAuth flow updated for actor=app identity -- re-auth needed after deployment
- Both tools use withTokenRefresh from Plan 67-01 for automatic 401 retry
- MCP server now exposes 9 tools (7 existing + create_agent_activity + update_session_state)

## Self-Check: PASSED

- All created files exist (activities.ts, 67-02-SUMMARY.md)
- All modified files exist (oauth.ts, schemas.ts, tools/index.ts, server.ts, seed-permissions.ts)
- All commit hashes verified (d86f99a, d0d2ff5)

---
*Phase: 67-linear-agent-sdk*
*Completed: 2026-02-10*
