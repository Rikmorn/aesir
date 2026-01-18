# Aesir

Agentic development platform that automates software development workflows. Agents handle routine development tasks while humans focus on high-value decisions and reviews.

## Features

- **Product Agent**: Gathers requirements through Slack conversations, creates Linear tasks
- **Dev Agent**: Picks up tasks, writes code, runs tests, creates PRs
- **Human-in-the-Loop**: Approval gates before PR merge via GitHub reviews
- **Observability**: Full logging and tracing of agent actions

## Prerequisites

- Node.js 20+
- Docker (for Dev Agent sandbox execution)
- Slack workspace with admin access to create apps
- Linear workspace
- Anthropic API key

## Quick Start

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env.local

# Edit .env.local with your credentials (see Environment Setup below)

# Build the project
npm run build

# Start the Product Agent
npm run product-agent
```

## Environment Setup

Create `.env.local` with the following variables:

```bash
# ===================
# Slack Configuration
# ===================

# Bot User OAuth Token (starts with xoxb-)
# Found at: Slack API → Your App → OAuth & Permissions → Bot User OAuth Token
SLACK_BOT_TOKEN=xoxb-your-bot-token

# App-Level Token (starts with xapp-)
# Found at: Slack API → Your App → Basic Information → App-Level Tokens
# Must have connections:write scope
SLACK_APP_TOKEN=xapp-your-app-token

# ===================
# Linear Configuration
# ===================

# Linear API Key or OAuth Access Token
# API Key: Linear → Settings → API → Personal API keys → Create key
# Or use OAuth access token from authorization flow
LINEAR_ACCESS_TOKEN=lin_api_your-token

# Team ID where tasks will be created
# Found at: Linear → Settings → Teams → Click team → URL contains team ID
# Or via API: query { teams { nodes { id name } } }
LINEAR_TEAM_ID=your-team-id

# (Optional) For OAuth token refresh
LINEAR_CLIENT_ID=your-client-id
LINEAR_CLIENT_SECRET=your-client-secret

# ===================
# Anthropic Configuration
# ===================

# Anthropic API Key
# Found at: console.anthropic.com → API Keys
ANTHROPIC_API_KEY=sk-ant-your-api-key

# ===================
# GitHub Configuration (for Dev Agent)
# ===================

# GitHub Personal Access Token
# Create at: GitHub → Settings → Developer settings → Personal access tokens
# Required scopes: repo, workflow
GITHUB_TOKEN=ghp_your-token

# Repository in owner/repo format
GITHUB_REPO=your-org/your-repo

# ===================
# Temporal Configuration (for approval workflows)
# ===================

# Temporal server address (default: localhost:7233)
TEMPORAL_ADDRESS=localhost:7233

# Temporal namespace (default: default)
TEMPORAL_NAMESPACE=default
```

## Slack App Setup

### 1. Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App** → **From scratch**
3. Name it (e.g., "Aesir Product Agent") and select your workspace

### 2. Enable Socket Mode

1. Go to **Socket Mode** in the sidebar
2. Toggle **Enable Socket Mode** to ON
3. Create an app-level token with `connections:write` scope
4. Copy the token (starts with `xapp-`) to `SLACK_APP_TOKEN`

### 3. Configure Bot Token Scopes

Go to **OAuth & Permissions** → **Scopes** → **Bot Token Scopes** and add:

| Scope | Purpose |
|-------|---------|
| `app_mentions:read` | Receive @mentions |
| `chat:write` | Send messages |
| `im:history` | Read DM history for context |
| `im:read` | Access DM channels |
| `im:write` | Send DMs |
| `users:read` | Get user info |

### 4. Subscribe to Events

Go to **Event Subscriptions** → **Subscribe to bot events** and add:

| Event | Purpose |
|-------|---------|
| `app_mention` | Respond when @mentioned in channels |
| `message.im` | Respond to direct messages |

### 5. Install to Workspace

1. Go to **OAuth & Permissions**
2. Click **Install to Workspace**
3. Copy the **Bot User OAuth Token** (starts with `xoxb-`) to `SLACK_BOT_TOKEN`

### 6. Invite Bot to Channels

In Slack, invite the bot to channels where you want to use it:
```
/invite @YourBotName
```

## Running the Product Agent

```bash
# Development (with hot reload)
npm run product-agent

# Or directly with tsx
npx tsx src/scripts/start-product-agent.ts
```

You should see:
```
🤖 Starting Product Agent...

✅ Product Agent is running!

📱 You can now:
   - @mention the bot in a Slack channel
   - Send a direct message to the bot

💡 Try: "I want to build a feature for exporting data as CSV"

Press Ctrl+C to stop.
```

### Testing the Bot

1. **@mention in a channel**:
   ```
   @ProductAgent I want to add user authentication to our app
   ```

2. **Direct message**:
   Open a DM with the bot and describe a feature you want to build.

3. **Expected behavior**:
   - Bot asks clarifying questions about requirements
   - After gathering enough info, creates Linear tasks
   - Confirms task creation with Linear identifiers

## Project Structure

```
src/
├── agents/
│   ├── dev-agent/          # Dev Agent (code generation)
│   └── product-agent/      # Product Agent (requirement gathering)
│       ├── graph.ts        # LangGraph conversation flow
│       ├── nodes/          # Graph nodes (analyze, clarify, create)
│       ├── runner.ts       # Agent runner
│       └── state.ts        # State schema
├── integrations/
│   ├── github/             # GitHub API client
│   ├── linear/             # Linear API client
│   └── slack/              # Slack Bolt app + handlers
│       ├── bolt-app.ts     # Bolt app factory
│       └── assistant/      # Product Agent handlers
├── logging/                # Structured logging
├── observability/          # Tracing and metrics
├── sandbox/                # Docker sandbox for code execution
├── scripts/
│   └── start-product-agent.ts  # Entry point
└── temporal/               # Temporal workflows for approvals
```

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Compile TypeScript |
| `npm run dev` | Run with hot reload |
| `npm run test` | Run tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run lint` | Type-check without emitting |
| `npm run product-agent` | Start Product Agent |

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌────────────┐
│   Slack     │────▶│   Product    │────▶│   Linear   │
│   User      │◀────│   Agent      │     │   Tasks    │
└─────────────┘     └──────────────┘     └────────────┘
                           │
                           ▼
                    ┌──────────────┐
                    │  Dev Agent   │
                    │  (picks up   │
                    │   tasks)     │
                    └──────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        ┌─────────┐  ┌─────────┐  ┌─────────┐
        │ Docker  │  │ GitHub  │  │ Temporal│
        │ Sandbox │  │   PR    │  │ Approval│
        └─────────┘  └─────────┘  └─────────┘
```

## Troubleshooting

### "Missing required environment variables"

Ensure all required variables are set in `.env.local`. The startup script will list any missing variables.

### "Failed to connect to Slack"

1. Verify Socket Mode is enabled in your Slack app settings
2. Check that `SLACK_APP_TOKEN` has `connections:write` scope
3. Ensure the app is installed to your workspace

### "Bot doesn't respond to @mentions"

1. Verify `app_mention` event is subscribed in Slack app settings
2. Check the bot is invited to the channel (`/invite @BotName`)
3. Check console logs for errors

### "Bot doesn't respond to DMs"

1. Verify `message.im` event is subscribed in Slack app settings
2. Verify `im:history`, `im:read`, `im:write` scopes are added
3. Try reinstalling the app to workspace after adding scopes

### "Linear tasks not being created"

1. Verify `LINEAR_ACCESS_TOKEN` is valid (test with Linear API)
2. Verify `LINEAR_TEAM_ID` exists in your workspace
3. Check the token has permission to create issues

## Development

### Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test -- product-agent

# Watch mode
npm run test:watch
```

### Adding New Features

1. Create a plan with `/gsd:plan-phase`
2. Execute with `/gsd:execute-phase`
3. Verify with `/gsd:verify-work`

See `.planning/` directory for project roadmap and planning artifacts.

## License

Proprietary - Internal use only
