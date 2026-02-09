---
phase: 63-outbound-denormalizer
plan: 02
subsystem: agents
tags: [communication, tools, denormalizer, mcp, reply, ask, notify]

# Dependency graph
requires:
  - phase: 63-01
    provides: denormalize() dispatch function and CommunicationToolDeps type
  - phase: 61-reply-context-types
    provides: ReplyContext discriminated union types and Zod schemas
provides:
  - "communication:reply tool factory -- validates replyContext + message, calls denormalize"
  - "communication:ask tool factory -- renders options as text, calls denormalize"
  - "communication:notify tool factory -- accepts explicit target, calls denormalize"
  - "communicationAdapter bridge from ToolContext to CommunicationToolDeps"
  - "Tool registry updated from 36 to 39 tools with communication namespace"
affects: [65-agent-migration]

# Tech tracking
tech-stack:
  added: []
  patterns: ["communicationAdapter pattern bridging ToolContext to CommunicationToolDeps", "option rendering as text instructions for ask tool"]

key-files:
  created:
    - packages/agents/src/shared/tools/communication/reply.ts
    - packages/agents/src/shared/tools/communication/ask.ts
    - packages/agents/src/shared/tools/communication/notify.ts
    - packages/agents/src/shared/tools/communication/index.ts
    - packages/agents/src/shared/tools/communication/communication-tools.test.ts
  modified:
    - packages/agents/src/framework/tool-factories.ts
    - packages/agents/src/framework/tool-factories.test.ts

key-decisions:
  - "communicationAdapter uses conditional spread for taskId (exactOptionalPropertyTypes compliance)"
  - "Ask tool renders options as markdown text rather than passing structured data to denormalizer"

patterns-established:
  - "communicationAdapter pattern: ToolContext -> CommunicationToolDeps extraction for communication tools"
  - "Option rendering: structured options -> markdown text with reply value instructions"

# Metrics
duration: 3min
completed: 2026-02-09
---

# Phase 63 Plan 02: Communication Tools Summary

**Three agent-facing communication tool factories (reply, ask, notify) with communicationAdapter bridge, registered as 39 total tools in the unified registry**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-09T00:57:00Z
- **Completed:** 2026-02-09T01:00:18Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Implemented communication:reply, communication:ask, and communication:notify tool factories with Zod validation, McpError handling, and underscore-format tool names
- Created communicationAdapter to bridge ToolContext to CommunicationToolDeps with conditional spread for optional taskId
- Registered all three tools in tool-factories.ts (36 -> 39 tools) with full test coverage (9 unit tests + updated registration tests)

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement three communication tool factories and barrel exports** - `2815737` (feat)
2. **Task 2: Register communication tools and update all tests** - `df5fe3f` (feat)

## Files Created/Modified
- `packages/agents/src/shared/tools/communication/reply.ts` - communication:reply tool factory: replyContext + message -> denormalize
- `packages/agents/src/shared/tools/communication/ask.ts` - communication:ask tool factory: renders options as text before denormalize
- `packages/agents/src/shared/tools/communication/notify.ts` - communication:notify tool factory: explicit target ReplyContext -> denormalize
- `packages/agents/src/shared/tools/communication/index.ts` - Barrel exports for all three factories
- `packages/agents/src/shared/tools/communication/communication-tools.test.ts` - 9 unit tests covering all tools
- `packages/agents/src/framework/tool-factories.ts` - communicationAdapter + registration (36 -> 39 tools)
- `packages/agents/src/framework/tool-factories.test.ts` - Updated count, namespace, presence, and resolution assertions

## Decisions Made
- communicationAdapter uses conditional spread `...(ctx.taskId && { taskId: ctx.taskId })` for exactOptionalPropertyTypes compliance (consistent with mcpAdapter pattern from Plan 01)
- Ask tool renders options as markdown text instructions (`- **Label**: reply "value"`) rather than passing structured option data to the denormalizer -- keeps the denormalizer's interface simple (text-only)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Biome formatter required multiline chain for renderOptions map/join (auto-fixed before commit)
- Biome organize-imports required alphabetical barrel export ordering (auto-fixed before commit)

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All three communication tools ready for agent definition YAML tool references (e.g., `communication:reply`)
- Phase 63 (outbound denormalizer) complete: denormalize dispatch + 3 communication tools
- Ready for agent migration in Phase 65

## Self-Check: PASSED

All files verified present, all commit hashes found in git log.

---
*Phase: 63-outbound-denormalizer*
*Completed: 2026-02-09*
