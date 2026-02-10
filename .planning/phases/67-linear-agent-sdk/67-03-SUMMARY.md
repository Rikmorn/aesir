---
phase: 67-linear-agent-sdk
plan: 03
subsystem: communication
tags: [linear, agent-sdk, denormalizer, activities, reply-context, webhooks, intent-mapping]

# Dependency graph
requires:
  - phase: 67-02
    provides: "create_agent_activity and update_session_state MCP tools"
provides:
  - "agentSessionId in LinearReplyContext for agent session routing"
  - "Denormalizer activity routing when agentSessionId present, comment fallback when absent"
  - "Intent-to-activity-type mapping: reply->response, ask->elicitation, notify_reasoning->thought, notify_action->action"
  - "Ephemeral acknowledgment thought on session creation (fire-and-forget)"
  - "Prompt/promptContext fields in normalizer payload for prompted events"
affects: [67-04-echo-filter-removal]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Intent-based denormalizer routing: communication tools pass intent, denormalizer maps to activity type when session active"
    - "Fire-and-forget acknowledgment: webhook handler emits ephemeral thought without blocking 200 response"
    - "Dual-path routing: agentSessionId present -> activity tools, absent -> comment fallback"

key-files:
  created: []
  modified:
    - packages/agents/src/shared/communication/types.ts
    - packages/agents/src/shared/communication/denormalizer.ts
    - packages/agents/src/shared/tools/communication/reply.ts
    - packages/agents/src/shared/tools/communication/ask.ts
    - packages/agents/src/shared/tools/communication/notify.ts
    - packages/agents/src/adapters/linear.ts
    - packages/integrations/linear/src/dispatcher/normalize.ts
    - packages/integrations/linear/src/api/webhooks.ts
    - packages/integrations/linear/src/webhooks/parser.ts
    - packages/integrations/linear/src/webhooks/types.ts

key-decisions:
  - "Acknowledgment thought uses withTokenRefresh (not createLinearClientFromDatabase) for consistent 401 retry pattern across all Linear API calls"
  - "Action activities use action+parameter fields (not body) matching the Linear SDK content type schema"
  - "Notify tool exposes intent parameter (reasoning|action) rather than separate tools, keeping the communication surface minimal"

patterns-established:
  - "CommunicationIntent type: typed intent parameter flows from tool -> denormalizer -> activity type resolution"
  - "Dual-path denormalizer: single code path handles both agent session (activities) and non-session (comments) transparently"

# Metrics
duration: 4min
completed: 2026-02-10
---

# Phase 67 Plan 03: Denormalizer Routing and Session ID Pipeline Summary

**End-to-end agentSessionId wiring from webhook through adapter to denormalizer, with intent-based activity routing and ephemeral acknowledgment thought on session creation**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-10T15:43:01Z
- **Completed:** 2026-02-10T15:46:49Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments
- Added optional `agentSessionId` to `LinearReplyContextSchema`, enabling dual-path routing (activity vs comment)
- Updated denormalizer to route to `create_agent_activity` MCP tool when agent session is active, with intent-to-activity-type mapping matching locked decisions exactly
- Wired intent from all three communication tools: reply (response), ask (elicitation), notify (thought/action)
- Added agentSessionId to adapter replyContext for both `created` and `prompted` events
- Implemented fire-and-forget ephemeral acknowledgment thought ("Looking into this...") on session creation
- Extended parser and normalizer to include prompt/promptContext fields for prompted events

## Task Commits

Each task was committed atomically:

1. **Task 1: Add agentSessionId to LinearReplyContext, update denormalizer routing, and wire intent** - `0c5ad7f` (feat)
2. **Task 2: Update adapter, normalizer, and webhook handler for session ID flow** - `8cf5f85` (feat)

## Files Created/Modified
- `packages/agents/src/shared/communication/types.ts` - Added optional agentSessionId to LinearReplyContextSchema
- `packages/agents/src/shared/communication/denormalizer.ts` - Added CommunicationIntent type, resolveActivityType helper, dual-path routing for Linear (activity vs comment)
- `packages/agents/src/shared/tools/communication/reply.ts` - Passes intent: "reply" to denormalize
- `packages/agents/src/shared/tools/communication/ask.ts` - Passes intent: "ask" to denormalize
- `packages/agents/src/shared/tools/communication/notify.ts` - Added intent parameter (reasoning|action), maps to notify_reasoning/notify_action
- `packages/agents/src/adapters/linear.ts` - agentSessionId in replyContext for created and prompted events, sessionId in data
- `packages/integrations/linear/src/dispatcher/normalize.ts` - Includes prompt/promptContext in normalized payload when present
- `packages/integrations/linear/src/api/webhooks.ts` - Fire-and-forget ephemeral acknowledgment thought via withTokenRefresh on session creation
- `packages/integrations/linear/src/webhooks/parser.ts` - Added optional prompt and promptContext fields to AgentSessionSchema
- `packages/integrations/linear/src/webhooks/types.ts` - Added prompt and promptContext to AgentSessionPayload interface

## Decisions Made
- **withTokenRefresh for acknowledgment:** Used `withTokenRefresh` in the webhook handler (rather than `createLinearClientFromDatabase` directly) for consistency with MCP tool patterns and automatic 401 retry handling.
- **Action activity field mapping:** Action-type activities use `action` + `parameter` fields (not `body`), matching the Linear SDK's `ActionActivityContent` schema. The denormalizer maps the notification text to the `action` field with empty `parameter`.
- **Single notify tool with intent parameter:** Rather than creating separate `notify_reasoning` and `notify_action` tools, the existing notify tool gained an optional `intent` parameter (reasoning|action). This keeps the communication tool surface minimal (3 tools) while supporting all 4 activity types.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Biome pre-commit hook caught a formatting issue (multiline `childLogger.error` call collapsed to single line). Resolved by reformatting the error log call to match Biome's style preferences.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Full agentSessionId pipeline operational: webhook -> parser -> normalizer -> adapter -> denormalizer -> MCP tool
- Ready for Plan 67-04 (echo filter removal) which can leverage the session-aware routing
- Communication tools now produce typed activities when agent session is active, transparent comment fallback when not
- Acknowledgment thought provides immediate Linear UI feedback while agent processes the request

## Self-Check: PASSED

- All 10 modified files exist on disk
- All commit hashes verified (0c5ad7f, 8cf5f85)
- Must-have artifacts verified: agentSessionId in types, create_agent_activity in denormalizer, intent in reply/ask/notify, agentSessionId in adapter, acknowledgment thought in webhooks

---
*Phase: 67-linear-agent-sdk*
*Completed: 2026-02-10*
