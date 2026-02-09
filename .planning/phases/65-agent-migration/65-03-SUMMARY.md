---
phase: 65-agent-migration
plan: 03
subsystem: agents
tags: [communication, prompt-engineering, agent-definitions, replyContext]

# Dependency graph
requires:
  - phase: 65-02
    provides: "Default notify target enrichment and communication tool factories"
provides:
  - "Dev-agent definition.yaml with communication:reply/ask/notify replacing Slack tools"
  - "Dev-agent prompt.md with domain-language communication guidance and replyContext examples"
affects: [65-04, agent-definitions, dev-agent]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Domain-language communication tools in agent definitions (communication:reply/ask/notify)"
    - "replyContext pass-through pattern documented in agent prompt"
    - "Channel-agnostic messaging constitutional constraint"

key-files:
  created: []
  modified:
    - packages/agents/definitions/dev-agent/definition.yaml
    - packages/agents/definitions/dev-agent/prompt.md

key-decisions:
  - "Slack mentioned only as delivery channel example in constitutional constraint, not as tool reference"
  - "Example 7 teaches replyContext extraction from XML tag — matches framework injection pattern"
  - "Working with Humans section is goal-oriented per PROMPT_GUIDE.md — no procedural tool sequences"

patterns-established:
  - "Agent prompt communication section: describe tools by intent (reply/ask/notify) not channel"
  - "Few-shot examples for replyContext pass-through pattern"

# Metrics
duration: 2min
completed: 2026-02-09
---

# Phase 65 Plan 03: Dev-Agent Communication Migration Summary

**Dev-agent migrated from slack:send_message/send_approval_request to communication:reply/ask/notify with replyContext pass-through guidance and few-shot example**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-09T11:53:47Z
- **Completed:** 2026-02-09T11:55:49Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Replaced 2 Slack tools with 3 communication primitives in dev-agent definition.yaml
- Rewrote 3 Slack-specific prompt references to domain-language equivalents
- Added "Working with Humans" section explaining reply/ask/notify distinction and replyContext pass-through
- Added Example 7 demonstrating signal-based replyContext extraction and usage
- Constitutional constraint ensures channel-agnostic messaging (same response regardless of Slack/Linear/GitHub)

## Task Commits

Each task was committed atomically:

1. **Task 1: Update dev-agent definition.yaml tool list** - `28d2839` (feat)
2. **Task 2: Rewrite dev-agent prompt.md for domain-language communication** - `8384ca1` (feat)

## Files Created/Modified
- `packages/agents/definitions/dev-agent/definition.yaml` - Replaced slack:send_message and slack:send_approval_request with communication:reply, communication:ask, communication:notify
- `packages/agents/definitions/dev-agent/prompt.md` - Rewrote Slack references, added Working with Humans section, added Example 7 for replyContext pass-through

## Decisions Made
- Slack appears only as a delivery channel name in constitutional constraint text ("whether the human is on Slack, Linear, or GitHub") — this is appropriate context, not tool-specific instruction
- Example 7 teaches extraction from `<reply_context>` XML tag, matching the framework's appendReplyContextTag injection pattern from Phase 61
- Zero strong directives (MUST/ALWAYS/NEVER/CRITICAL/IMPORTANT) added — all new guidance uses softer language per PROMPT_GUIDE.md

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Dev-agent fully migrated to communication primitives
- Ready for Plan 65-04 (product-agent migration, running in parallel)
- After both 65-03 and 65-04, agents use domain-language communication exclusively

## Self-Check: PASSED

All files exist, all commits verified.

---
*Phase: 65-agent-migration*
*Completed: 2026-02-09*
