---
phase: 09-product-agent
plan: 09-FIX
type: fix
wave: 1
depends_on: []
autonomous: true
---

<objective>
Fix 3 UAT issues from phase 9.

Source: 09-UAT.md
Diagnosed: no (based on symptoms only - root causes inferred from code review)
Priority: 1 blocker, 2 major, 0 minor, 0 cosmetic
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md

**Issues being fixed:**
@.planning/phases/09-product-agent/09-UAT.md

**Original implementation files:**
@src/integrations/slack/assistant/thread-handlers.ts
@src/integrations/linear/client.ts
@src/scripts/start-product-agent.ts
</context>

<tasks>
<task type="auto">
  <name>Task 1: Fix UAT-003 - Linear API auth error (Bearer prefix issue)</name>
  <files>src/integrations/linear/client.ts</files>
  <action>
**Issue:** "task_creation_failed - It looks like you're trying to use an API key as a Bearer token. Remove the Bearer prefix from the Authorization header."

**Expected:** Linear API accepts the token and creates issues successfully.

**Root Cause (inferred):** The Linear SDK's `LinearClient` constructor expects a raw access token. If the user's `LINEAR_ACCESS_TOKEN` env var contains "Bearer " prefix (copy-pasted from a cURL command or similar), the SDK adds another "Bearer " prefix, resulting in "Bearer Bearer lin_api_..." being sent.

**Fix:** In `getLinearClient()` function, strip any "Bearer " prefix from the accessToken before passing to LinearClient. This makes the function defensive against common user mistakes.

```typescript
export function getLinearClient(accessToken: string): LinearClient {
  // Strip "Bearer " prefix if present (common copy-paste mistake)
  const cleanToken = accessToken.replace(/^Bearer\s+/i, "");
  return new LinearClient({ accessToken: cleanToken });
}
```

Also add the same defensive check in `createLinearClient()` when setting the accessToken after refresh.
  </action>
  <verify>
- Build succeeds: `npm run build`
- Unit test the token stripping logic if possible
- Manual test: Set LINEAR_ACCESS_TOKEN with "Bearer " prefix and verify it still works
  </verify>
  <done>UAT-003 resolved - Linear API accepts tokens with or without "Bearer " prefix</done>
</task>

<task type="auto">
  <name>Task 2: Fix UAT-001 & UAT-002 - Bot doesn't respond to thread replies</name>
  <files>src/integrations/slack/assistant/thread-handlers.ts</files>
  <action>
**Issue (UAT-001):** "Bot doesn't respond to thread replies in DMs" - bot responds to initial DM but not to follow-up messages in the thread.

**Issue (UAT-002):** "Bot doesn't respond to @mentions in threads" - bot responds to initial @mention but not to thread replies with @mention.

**Expected:** Bot continues conversation when user replies in the same thread (both DMs and channel @mentions).

**Root Cause (inferred from code review):**

For UAT-001 (DM threads):
- The message handler at line 407-424 listens for "message" events with `channel_type === "im"`
- Thread replies in DMs are also "message" events with `channel_type === "im"`, but they have `thread_ts` set
- Issue: Line 416-418 filters out messages with a `subtype`. Thread replies might have a subtype like "message_replied" that's being filtered.

For UAT-002 (@mention in threads):
- The app_mention handler should fire for @mentions in threads
- But Slack has a quirk: if the bot is @mentioned in a thread that's already in a conversation, the event might come as a regular `message` event with `thread_ts` instead of `app_mention`
- Need to also listen for message events in non-IM channels that @mention the bot

**Fix:**

1. For DM thread replies: The current logic should work. Check if the subtype filtering is too aggressive. According to Slack docs, thread reply messages have `subtype: undefined` but `thread_ts` set. The current filter `if (event.subtype) return;` should NOT filter thread replies.

   Actually, re-reading the issue: "bot doesn't respond in the subthread when using @name" - the user might be @mentioning the bot in DM threads. But in DMs you don't need to @mention. Let's verify the handler fires at all.

2. For @mention in threads: Add handling for message events in channels that @mention the bot. The `app_mention` event should fire even in threads, but let's add a fallback.

**Investigation needed first:** Add debug logging to confirm which events are being received vs filtered out.

**Simpler fix approach:**
1. In the DM handler, remove or loosen the subtype check - only filter subtypes that shouldn't be processed (message_changed, message_deleted, etc.)
2. For @mentions in threads, verify app_mention events fire. If not, add message event handling for channels.

**Code changes:**

In `registerHandlers()`, update the message event handler:

```typescript
app.event("message", async (args) => {
  const { event, client, say } = args;

  // Handle DM messages (including thread replies)
  if ("channel_type" in event && event.channel_type === "im") {
    // Ignore bot messages to prevent loops
    if ("bot_id" in event && event.bot_id) {
      return;
    }
    // Only filter specific subtypes that shouldn't be processed
    // Thread replies have subtype: undefined, so they pass through
    if ("subtype" in event) {
      const ignoredSubtypes = ["message_changed", "message_deleted", "channel_join", "channel_leave"];
      if (event.subtype && ignoredSubtypes.includes(event.subtype)) {
        return;
      }
    }
    await handleDirectMessage(options)({
      event: event as GenericMessageEvent,
      client,
      say,
    });
    return;
  }

  // Handle @mentions in channel threads (fallback for when app_mention doesn't fire)
  // This catches cases where user @mentions bot in a thread reply
  if ("text" in event && event.text && "channel" in event) {
    // Check if message mentions the bot (contains <@BOTID>)
    // We need to get bot user ID from the app context or environment
    // For now, check if it looks like a mention and has thread_ts
    if ("thread_ts" in event && event.thread_ts) {
      const botUserId = process.env["SLACK_BOT_USER_ID"];
      if (botUserId && event.text.includes(`<@${botUserId}>`)) {
        // Ignore bot's own messages
        if ("bot_id" in event && event.bot_id) {
          return;
        }
        // Process as app mention equivalent
        await handleAppMention(options)({
          event: event as unknown as AppMentionEvent,
          client,
          say,
        });
      }
    }
  }
});
```

**Note:** This requires adding SLACK_BOT_USER_ID to env vars, OR fetching it from `auth.test` API call on startup.

**Simpler approach:** First just fix the subtype filtering and test. The `app_mention` event SHOULD fire for @mentions in threads according to Slack docs.
  </action>
  <verify>
- Build succeeds: `npm run build`
- Start bot and test:
  1. Send initial DM -> bot responds
  2. Reply in same DM thread -> bot responds (was failing before)
  3. @mention bot in channel -> bot responds
  4. Reply in thread with @mention -> bot responds (was failing before)
  </verify>
  <done>UAT-001 and UAT-002 resolved - Bot responds to thread replies in both DMs and channel @mentions</done>
</task>

<task type="auto">
  <name>Task 3: Add debug logging for Slack event handling</name>
  <files>src/integrations/slack/assistant/thread-handlers.ts</files>
  <action>
**Purpose:** Help diagnose future issues by logging which events are received and how they're routed.

**Add:**
1. Log at the start of the message event handler showing: event type, channel_type, subtype, thread_ts presence
2. Log when an event is filtered out (and why)
3. Log successful routing to the appropriate handler

This makes it much easier to debug thread/message issues without needing to modify code.

**Note:** Use debug level so it doesn't clutter production logs.
  </action>
  <verify>
- Build succeeds: `npm run build`
- Run bot with LOG_LEVEL=debug and verify logs show event routing
  </verify>
  <done>Debug logging added for Slack event handling</done>
</task>
</tasks>

<verification>
Before declaring plan complete:
- [ ] All blocker issues fixed (UAT-003)
- [ ] All major issues fixed (UAT-001, UAT-002)
- [ ] Build passes without errors
- [ ] Each fix verified against original reported issue
</verification>

<success_criteria>
- All UAT issues from 09-UAT.md addressed
- Build passes
- Ready for re-verification with /gsd:verify-work 9
</success_criteria>

<output>
After completion, create `.planning/phases/09-product-agent/09-FIX-SUMMARY.md`
</output>
