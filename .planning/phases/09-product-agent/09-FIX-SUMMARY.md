---
phase: 09-product-agent
plan: "FIX"
subsystem: slack, linear
tags: [bugfix, uat, slack, linear, thread-handling, auth]

# Dependency graph
requires:
  - phase: 09-product-agent (09-04)
    provides: Original implementation with UAT issues
provides:
  - Fixed Linear API Bearer token handling
  - Fixed Slack thread reply handling (DMs and @mentions)
  - Debug logging for Slack event routing
affects: [product-agent, slack-bot, linear-integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Defensive token stripping for API auth"
    - "Allowlist for ignored message subtypes"
    - "Dynamic bot user ID fetch via auth.test"

key-files:
  modified:
    - src/integrations/linear/client.ts
    - src/integrations/slack/assistant/thread-handlers.ts
    - src/scripts/start-product-agent.ts

key-decisions:
  - "Strip Bearer prefix defensively in Linear client (common copy-paste mistake)"
  - "Use allowlist of ignored subtypes instead of blocking all subtypes"
  - "Fetch bot user ID dynamically via auth.test instead of env var"

patterns-established:
  - "Defensive token handling: strip known prefixes before passing to SDKs"
  - "Debug logging for event routing: log at each decision point"

# Metrics
duration: 8 min
completed: 2026-01-18
---

# Phase 09 FIX Plan: UAT Issue Fixes Summary

**Fixes for 3 UAT issues: Linear API auth, DM thread replies, channel thread @mentions**

## Performance

- **Duration:** 8 min
- **Completed:** 2026-01-18
- **Tasks:** 3 (all auto)
- **Files modified:** 3

## Issues Fixed

### UAT-003 (Blocker): Linear API Bearer Token Error
**Symptom:** "It looks like you're trying to use an API key as a Bearer token. Remove the Bearer prefix from the Authorization header."

**Root Cause:** User's LINEAR_ACCESS_TOKEN env var contained "Bearer " prefix (common copy-paste from cURL).

**Fix:** Added `stripBearerPrefix()` function in Linear client that defensively strips "Bearer " prefix before passing to SDK. Applied to both `createLinearClient()` and `getLinearClient()`.

### UAT-001 (Major): Bot Doesn't Respond to DM Thread Replies
**Symptom:** Bot responds to initial DM but not to follow-up messages in the thread.

**Root Cause:** The message event handler was filtering out ALL messages with a subtype. Thread replies don't have a subtype, but the check `if (event.subtype) return;` was too broad and could interact with other filtering.

**Fix:** Changed from blocking all subtypes to using an explicit allowlist (`IGNORED_SUBTYPES`) of subtypes that should be filtered (message_changed, message_deleted, channel_join, etc.). Normal messages and thread replies pass through.

### UAT-002 (Major): Bot Doesn't Respond to @Mentions in Threads
**Symptom:** Bot responds to initial @mention but not to thread replies with @mention.

**Root Cause:** Slack sometimes sends thread replies with @mentions as regular message events instead of app_mention events.

**Fix:** Added fallback handling in the message event handler that:
1. Fetches bot user ID on startup via `auth.test` API
2. Checks if message is in a thread and contains `<@BOT_USER_ID>` pattern
3. Routes matching messages to the app_mention handler

## Task Commits

Each task committed atomically:

1. **Task 1: Fix Linear API Bearer prefix** - `fix(linear): strip Bearer prefix from token`
2. **Task 2: Fix thread reply handling** - `fix(slack): handle thread replies in DMs and channel @mentions`
3. **Task 3: Add debug logging** - (included in Task 2 commit)

## Files Modified

- `src/integrations/linear/client.ts` - Added stripBearerPrefix() function
- `src/integrations/slack/assistant/thread-handlers.ts` - Improved message event routing with debug logging
- `src/scripts/start-product-agent.ts` - Fetch bot user ID on startup via auth.test

## Decisions Made

1. **Defensive token stripping** - Strip Bearer prefix in Linear client rather than requiring users to format tokens correctly. Handles common copy-paste mistake gracefully.

2. **Allowlist for subtypes** - Instead of blocking all subtypes, explicitly list subtypes to ignore. This is more maintainable and safer - new subtypes pass through by default.

3. **Dynamic bot user ID fetch** - Fetch bot user ID via auth.test API on startup instead of requiring SLACK_BOT_USER_ID env var. This is more user-friendly and one less thing to configure.

## Verification Ready

Ready for re-verification with `/gsd:verify-work 9`:
- [ ] Linear API accepts tokens with or without "Bearer " prefix
- [ ] Bot responds to DM thread replies
- [ ] Bot responds to @mentions in channel threads
- [ ] Debug logging visible at LOG_LEVEL=debug

---
*Phase: 09-product-agent*
*Completed: 2026-01-18*
