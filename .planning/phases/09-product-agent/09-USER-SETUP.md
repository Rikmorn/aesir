# Phase 9: User Setup Required

**Generated:** 2026-01-18
**Phase:** 09-product-agent
**Status:** Incomplete

Complete these items for Socket Mode to function. Claude automated everything possible; these items require human access to the Slack API dashboard.

## Environment Variables

| Status | Variable | Source | Add to |
|--------|----------|--------|--------|
| [ ] | `SLACK_APP_TOKEN` | Slack API → Your App → Basic Information → App-Level Tokens → Generate Token with `connections:write` scope | `.env.local` |

**Note:** You should already have `SLACK_BOT_TOKEN` from Phase 7. The `SLACK_APP_TOKEN` (starts with `xapp-`) is different from the bot token (starts with `xoxb-`).

## Dashboard Configuration

- [ ] **Enable Socket Mode**
  - Location: Slack API → Your App → Socket Mode
  - Action: Toggle "Enable Socket Mode" to ON
  - Notes: Required for Bolt app to receive events via WebSocket

- [ ] **Add app_mention event subscription**
  - Location: Slack API → Your App → Event Subscriptions → Subscribe to bot events
  - Action: Click "Add Bot User Event" and add `app_mention`
  - Notes: Allows bot to receive messages when @mentioned

- [ ] **Add message.im event subscription**
  - Location: Slack API → Your App → Event Subscriptions → Subscribe to bot events
  - Action: Click "Add Bot User Event" and add `message.im`
  - Notes: Allows bot to receive direct messages

## Verification

After completing setup:

```bash
# Check env vars are set
grep -E "SLACK_BOT_TOKEN|SLACK_APP_TOKEN" .env.local

# Should show both tokens:
# SLACK_BOT_TOKEN=xoxb-...
# SLACK_APP_TOKEN=xapp-...
```

To test Socket Mode connection, you can create a simple test script:

```typescript
import { createBoltApp, startBoltApp, stopBoltApp } from './src/integrations/slack';

const app = createBoltApp({
  botToken: process.env.SLACK_BOT_TOKEN!,
  appToken: process.env.SLACK_APP_TOKEN!,
  socketMode: true,
});

// Add a simple test handler
app.event('app_mention', async ({ event, say }) => {
  await say(`Hello <@${event.user}>! Socket Mode is working!`);
});

await startBoltApp(app);
console.log('Bot is running! Mention it in Slack to test.');
```

Expected: Bot connects without errors, responds to @mentions.

---

**Once all items complete:** Mark status as "Complete" at top of file.
