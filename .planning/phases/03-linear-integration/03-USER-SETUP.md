# Phase 03: User Setup Required

**Generated:** 2026-01-16
**Phase:** 03-linear-integration
**Status:** Incomplete

## Environment Variables

| Status | Variable | Source | Add to |
|--------|----------|--------|--------|
| [ ] | `LINEAR_CLIENT_ID` | Linear Settings > Applications > Your App > Client ID | `.env.local` |
| [ ] | `LINEAR_CLIENT_SECRET` | Linear Settings > Applications > Your App > Client Secret | `.env.local` |
| [ ] | `LINEAR_WEBHOOK_SECRET` | Linear Settings > API > Webhooks > Your Webhook > Signing secret | `.env.local` |

## Account Setup

- [ ] **Create OAuth Application**
  - Location: Linear Settings > Applications > New Application
  - Details: Set redirect URI, enable required scopes (`read`, `write`, `app:assignable`, `app:mentionable`)
  - Note: Use `actor=app` in OAuth authorization URL for agent identity

## Dashboard Configuration

- [ ] **Create webhook endpoint**
  - Location: Linear Settings > API > Webhooks > New Webhook
  - Details:
    - URL: `https://[your-domain]/api/webhooks/linear`
    - Resource types: Agent session events (and Issues if testing)
  - Note: Copy signing secret to `LINEAR_WEBHOOK_SECRET`

## Verification

After configuration, verify setup works:

```bash
# Check environment variables are set
echo $LINEAR_CLIENT_ID
echo $LINEAR_CLIENT_SECRET
echo $LINEAR_WEBHOOK_SECRET

# Test OAuth token exchange (requires manual auth flow first)
# The integration tests mock the SDK, so real API testing requires OAuth tokens
```

---
**Once all items complete:** Mark status as "Complete"
