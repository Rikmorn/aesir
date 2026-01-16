# Phase 7: User Setup Required

**Generated:** 2026-01-16
**Phase:** 07-slack-integration
**Status:** Incomplete

## Environment Variables

| Status | Variable | Source | Add to |
|--------|----------|--------|--------|
| [ ] | `SLACK_BOT_TOKEN` | Slack App Settings -> OAuth & Permissions -> Bot User OAuth Token (starts with xoxb-) | `.env.local` |
| [ ] | `SLACK_DEFAULT_CHANNEL` | Slack channel ID (right-click channel -> View channel details -> scroll to bottom for ID like C1234567890) | `.env.local` |

## Dashboard Configuration

### 1. Create Slack App
- **Location:** [api.slack.com/apps](https://api.slack.com/apps) -> Create New App -> From scratch
- **Details:** Name: 'Aesir Dev Agent', Workspace: your workspace
- **Skip if:** Already have Slack app created

### 2. Add Bot Scopes
- **Location:** OAuth & Permissions -> Scopes -> Bot Token Scopes
- **Details:** Add the following scopes:
  - `chat:write` - Post messages to channels the bot is a member of
  - `chat:write.public` - Post messages to channels the bot isn't a member of

### 3. Install to Workspace
- **Location:** OAuth & Permissions -> Install to Workspace
- **Details:** Authorize the app, copy the Bot User OAuth Token (starts with `xoxb-`)

## Verification

After completing setup, verify the integration works:

```bash
# Test that the token and channel are configured
npm run build

# Run the Slack integration tests (uses mocks, doesn't need real token)
npm test -- src/integrations/slack
```

To test with a real Slack workspace:

```typescript
import { getSlackClient, sendStatusUpdate } from './src/integrations/slack';

const client = getSlackClient(process.env.SLACK_BOT_TOKEN);
await sendStatusUpdate(client, {
  type: 'status_update',
  taskId: 'TEST-001',
  status: 'completed',
  details: 'Setup verification successful',
}, process.env.SLACK_DEFAULT_CHANNEL);
```

---
**Once all items complete:** Mark status as "Complete" at the top of this file
