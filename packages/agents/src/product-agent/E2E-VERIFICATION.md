# Product Agent E2E Verification

Manual verification procedure for the product-agent workflow.

## Prerequisites

1. **Docker Compose running**: All infrastructure services must be up
2. **Slack workspace configured**: Bot token with appropriate scopes
3. **Linear workspace configured**: API token with issue creation permissions
4. **Allowed channel configured**: PRODUCT_AGENT_ALLOWED_CHANNELS set in environment

## Verification Steps

### 1. Start Infrastructure

```bash
# Start all services
docker compose up -d

# Follow product-agent logs
docker compose logs -f product-agent
```

### 2. Verify Health Endpoints

```bash
# Product agent (port 3005)
curl http://localhost:3005/health
# Expected: {"status":"ok","service":"product-agent"}

# Linear integration (port 3001)
curl http://localhost:3001/health
# Expected: {"status":"ok","service":"linear-integration"}

# Slack integration (port 3003)
curl http://localhost:3003/health
# Expected: {"status":"ok","service":"slack-integration"}

# Temporal (port 8080 for UI)
curl http://localhost:8080/api/v1/health
# Expected: "ok"
```

### 3. Test Conversation Flow

In the allowed Slack channel:

#### Step 1: Initial Message
@mention the bot with a feature request:
```
@product-agent Add ability to export dashboard as PDF
```

#### Step 2: Verify Classification (PROD-03)
Bot should respond with a clarifying question in a thread. Example:
```
Thanks for the feature request! I have a few questions to help capture the requirements:

Who is the primary audience for this feature and what problem does it solve for them?
```

#### Step 3: Provide Details (PROD-04)
Reply in thread with more context:
```
Sales team needs to share dashboards with clients who don't have app access.
They currently screenshot each chart manually which is time-consuming.
```

#### Step 4: Verify More Questions or Confirmation
Bot may ask another clarifying question or show the confirmation prompt (PROD-06).

#### Step 5: Confirmation Prompt (PROD-06)
When requirements are gathered, bot shows issue preview:
```
Great, I've gathered the requirements. Here's the summary:

*Title:* Add PDF export for dashboards

*Description:*
Sales team needs ability to export dashboards as PDF files to share with clients...

*Acceptance Criteria:*
- Export button available on dashboard view
- PDF includes all visible charts
- Supports A4 and Letter formats

*Labels:* feature-request, agent-ready

Reply "confirm" to create this issue, or provide corrections.
```

#### Step 6: Confirm Issue Creation
Reply "confirm" in thread:
```
confirm
```

#### Step 7: Verify Issue Created (PROD-07, PROD-08, PROD-09)
Check that:
- Slack: Bot posts link to created issue
- Linear: Issue exists with correct title and description
- Linear: Issue has "agent-ready" label
- Linear: Issue description includes link back to Slack thread

### 4. Test Edge Cases

#### Non-allowed Channel
@mention in a channel not in PRODUCT_AGENT_ALLOWED_CHANNELS:
- Expected: No response (silently ignored)

#### Question Message
Send a question rather than a feature request:
```
@product-agent how do I export a dashboard?
```
- Expected: Polite decline (not actionable as feature request)

#### Cancellation
Mid-conversation, reply with:
```
nevermind
```
- Expected: Graceful exit, conversation ends

#### Invalid Confirmation
Reply with something other than "confirm":
```
maybe later
```
- Expected: Bot waits or asks for confirmation again

## Success Criteria Checklist

### Service Health (PROD-01)
- [ ] Product-agent responds on port 3005
- [ ] Health endpoint returns OK status

### Event Handling (PROD-02)
- [ ] Receives Slack app_mention events
- [ ] Receives thread reply events

### Classification (PROD-03)
- [ ] Identifies feature requests correctly
- [ ] Rejects non-actionable messages

### Clarification (PROD-04)
- [ ] Asks relevant clarifying questions
- [ ] Questions appear in thread (not new message)

### Requirement Synthesis (PROD-06)
- [ ] Confirmation shows structured summary
- [ ] Title is concise and descriptive
- [ ] Description captures key details
- [ ] Acceptance criteria are testable

### Issue Creation (PROD-07)
- [ ] Issue created in Linear
- [ ] Content matches confirmation preview
- [ ] Description includes Slack thread link

### Notification (PROD-08)
- [ ] Slack notification includes Linear issue link
- [ ] Link is clickable and works

### Label Application (PROD-09)
- [ ] agent-ready label present on issue
- [ ] Missing label doesn't block issue creation

### End-to-End (PROD-11)
- [ ] Complete flow works without errors
- [ ] Temporal workflow visible in UI (http://localhost:8080)
- [ ] Workflow completes successfully

## Troubleshooting

### Bot doesn't respond
1. Check channel is in PRODUCT_AGENT_ALLOWED_CHANNELS
2. Check product-agent logs: `docker compose logs -f product-agent`
3. Check Slack integration logs: `docker compose logs -f slack-integration`

### Workflow not starting
1. Check Temporal is running: `docker compose logs temporal`
2. Check workflow in Temporal UI: http://localhost:8080

### Issue not created
1. Check Linear credentials configured
2. Check LINEAR_TEAM_ID environment variable
3. Check Linear integration logs: `docker compose logs -f linear-integration`

### Missing agent-ready label
1. Label may not exist in Linear workspace
2. Check logs for warning about missing label
3. Issue creation should still succeed (warning only)
