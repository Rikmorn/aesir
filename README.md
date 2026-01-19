# Aesir

Agentic development platform that automates software development workflows. Agents handle routine development tasks while humans focus on high-value decisions and reviews.

## Features

- **Product Agent**: Gathers requirements through Slack conversations, creates Linear tasks
- **Dev Agent**: Picks up tasks, writes code, runs tests, creates PRs
- **Human-in-the-Loop**: Approval gates before PR merge via GitHub reviews
- **Observability**: Full logging and tracing of agent actions

## Prerequisites

- Node.js 20+
- Docker Desktop running (all services run containerized)
- Slack workspace with admin access to create apps
- Linear workspace
- Anthropic API key

## Quick Start

Get from clone to running in 5 steps:

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env.local
```

Edit `.env.local` with your credentials. At minimum you need:

| Variable | Where to Get It |
|----------|-----------------|
| `SLACK_BOT_TOKEN` | Slack App > OAuth & Permissions |
| `SLACK_APP_TOKEN` | Slack App > Basic Information > App-Level Tokens |
| `LINEAR_ACCESS_TOKEN` | Linear > Settings > API > Personal API keys |
| `LINEAR_TEAM_ID` | Linear > Settings > Teams > Team settings (URL) |
| `ANTHROPIC_API_KEY` | console.anthropic.com > API Keys |

See [Environment Setup](#environment-setup) for full configuration.

### 3. Start Infrastructure (for Dev Agent)

```bash
npm run infra:up
```

Wait 30-60 seconds for Temporal to initialize. See [Infrastructure Setup](#infrastructure-setup) for details.

### 4. (Optional) Authorize Linear OAuth

For production use, authorize via OAuth instead of personal API key:

```bash
npm run linear-oauth
```

See [Linear OAuth Setup](#linear-oauth-setup) for details.

### 5. Start an Agent

```bash
# Product Agent (Slack bot for requirements gathering)
npm run product-agent

# Dev Agent (processes Linear tasks, creates PRs)
npm run dev-agent
```

You're running! @mention the bot in Slack or delegate a task in Linear.

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

## Linear OAuth Setup

Linear supports two authentication methods:

| Method | Best For | Token Type |
|--------|----------|------------|
| Personal API Key | Quick start, personal use | `lin_api_...` |
| OAuth App | Production, shared workspace | `lin_oauth_...` |

### Quick Start: Personal API Key

For getting started quickly, use a personal API key:

1. Go to Linear > Settings > API > Personal API keys
2. Create a new key
3. Set `LINEAR_ACCESS_TOKEN=lin_api_your-key` in `.env.local`

### Production: OAuth App Authorization

For production use, OAuth is recommended. Actions appear as the app identity rather than a personal user.

#### 1. Create a Linear OAuth Application

1. Go to [linear.app/settings/api/applications](https://linear.app/settings/api/applications)
2. Click **Create new OAuth application**
3. Fill in:
   - **Name**: Aesir (or your preferred name)
   - **Redirect URI**: Your OAuth tunnel URL (e.g., `https://oauth.your-domain.com/oauth/callback`)
4. Copy the **Client ID** and **Client Secret**

**Important:** Do NOT use `localhost` for the Redirect URI. The OAuth flow runs in a Docker container and receives callbacks via Cloudflare tunnel.

#### 2. Create OAuth Tunnel in Cloudflare

You need a dedicated tunnel for the OAuth callback (separate from the webhooks tunnel):

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) and select Zero Trust
2. Navigate to: **Networks** > **Tunnels**
3. Click **Create a tunnel** (or use existing and add a public hostname)
4. Add a public hostname:

| Field | Value |
|-------|-------|
| Subdomain | `oauth` (or your choice) |
| Domain | `your-cloudflare-domain.com` |
| Path | (leave empty) |
| Service Type | HTTP |
| URL | `oauth:3000` |

This routes `https://oauth.your-domain.com/*` to the OAuth container.

#### 3. Configure Environment Variables

Add to `.env.local`:

```bash
LINEAR_CLIENT_ID=your-client-id
LINEAR_CLIENT_SECRET=your-client-secret
OAUTH_CALLBACK_URL=https://oauth.your-domain.com/oauth/callback
```

The `OAUTH_CALLBACK_URL` must exactly match the Redirect URI configured in your Linear OAuth application.

#### 4. Run Authorization Flow

```bash
# Build if needed
npm run docker:build

# Start the OAuth flow (runs in container)
docker compose --profile oauth run --rm oauth
```

This will:
1. Start a container listening for the OAuth callback
2. Display a URL to open in your browser
3. After authorization, exchange the code for tokens
4. Save tokens to `.tokens/linear.json`

#### 5. Verify Authorization

The OAuth flow displays your authorized workspace and user. The `.tokens/linear.json` file is created in the `.tokens/` directory.

**Note:** You need the Cloudflare tunnel running to receive the callback. Either:
- Run `docker compose --profile tunnel up -d` first
- Or have the tunnel configured to route even when containers aren't running

**Note:** `.tokens/` is gitignored. Each developer runs their own OAuth flow.

**Note:** Linear OAuth tokens are long-lived (~10 years) and don't include refresh tokens. This is Linear's design - tokens don't need renewal during normal use.

## Infrastructure Setup

The Dev Agent requires Temporal for approval workflows. Start the infrastructure services before running agents.

### Starting Infrastructure

```bash
# Start all infrastructure services (PostgreSQL, Temporal, Temporal UI)
npm run infra:up

# Check services are running
docker ps

# View logs (follow mode)
npm run infra:logs
```

### Service Endpoints

| Service | URL | Purpose |
|---------|-----|---------|
| Temporal gRPC | localhost:7233 | Agent-to-Temporal communication |
| Temporal UI | http://localhost:8080 | Web interface for monitoring workflows |

### Health Verification

Temporal can take 30-60 seconds to initialize. Verify it's healthy:

```bash
# Check Temporal is responding (should show cluster info)
docker exec aesir-temporal tctl cluster health
```

Or open http://localhost:8080 — if the Temporal UI loads, services are ready.

### Stopping Infrastructure

```bash
# Stop all services (preserves data)
npm run infra:down

# Stop and remove all data (clean slate)
docker-compose down -v
```

Data persists in Docker volumes between restarts. Use `-v` flag to reset.

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

## Running the Dev Agent

The Dev Agent processes Linear tasks and creates pull requests. It requires Temporal to be running.

### Prerequisites

1. **Infrastructure running**: `npm run infra:up`
2. **Environment configured**:
   - `LINEAR_ACCESS_TOKEN`: Linear API key or OAuth token
   - `GITHUB_TOKEN`: GitHub PAT with `repo` and `workflow` scopes
   - `GITHUB_REPO`: Repository in `owner/repo` format
   - `ANTHROPIC_API_KEY`: Anthropic API key
3. **Docker socket accessible**: The dev-agent container needs Docker socket access for sandbox execution:
   - Docker Desktop (macOS/Windows): Enabled by default
   - Docker Engine (Linux): User must be in `docker` group
4. **Sandbox image available**: The container pulls `node:20-alpine` for sandbox execution. On slow networks, first pull may take time.

### Starting the Dev Agent

```bash
npm run dev-agent
```

You should see:
```
Starting Dev Agent...

Dev Agent is running!

Configuration:
   Temporal: localhost:7233
   Namespace: default
   Task Queue: dev-agent
   GitHub Repo: your-org/your-repo

The Dev Agent processes tasks from Linear:
   1. Delegate an issue to the Dev Agent in Linear
   2. The agent will read the issue, generate code, and create a PR
   3. Track progress in Linear's agent activity panel

View Temporal UI at http://localhost:8080

Press Ctrl+C to stop.
```

### Dev Agent Workflow

1. **Task Assignment**: Delegate a Linear issue to the Dev Agent
2. **Code Generation**: Agent reads requirements and generates code
3. **Testing**: Code runs in Docker sandbox, tests execute
4. **PR Creation**: Agent creates a branch and pull request
5. **Approval**: Human reviews PR via GitHub review
6. **Merge**: After approval signal, agent merges the PR

### Troubleshooting

**"Failed to connect to Temporal server"**
- Ensure infrastructure is running: `npm run infra:up`
- Wait for Temporal to initialize (30-60 seconds)
- Check Temporal UI at http://localhost:8080

**"Invalid GITHUB_REPO format"**
- Format must be `owner/repo`, e.g., `myorg/myproject`

**"Missing required environment variables"**
- Check all required variables are set in `.env.local`

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
│   ├── start-product-agent.ts  # Product Agent entry point
│   ├── start-dev-agent.ts      # Dev Agent entry point
│   └── linear-oauth.ts         # Linear OAuth authorization
└── temporal/               # Temporal workflows for approvals
```

## Available Scripts

### Local Development

| Script | Description |
|--------|-------------|
| `npm run build` | Compile TypeScript |
| `npm run dev` | Run with hot reload |
| `npm run test` | Run tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run lint` | Type-check without emitting |
| `npm run product-agent` | Start Product Agent locally |
| `npm run dev-agent` | Start Dev Agent locally |
| `npm run linear-oauth` | Authorize Linear OAuth app |

### Infrastructure Only

| Script | Description |
|--------|-------------|
| `npm run infra:up` | Start PostgreSQL, Temporal, and Temporal UI |
| `npm run infra:down` | Stop infrastructure services |
| `npm run infra:logs` | View infrastructure logs |

### Full Docker (Recommended)

| Script | Description |
|--------|-------------|
| `npm run docker:build` | Build agent Docker images |
| `npm run docker:up` | Start all services (infra + agents) |
| `npm run docker:down` | Stop all services |
| `npm run docker:logs` | View all logs |
| `npm run docker:dev-agent` | Start and follow Dev Agent logs |
| `npm run docker:product-agent` | Start and follow Product Agent logs |

## Running with Docker (Recommended)

The recommended way to run Aesir is fully containerized. This ensures consistent environments and automatic wiring of database connections.

### 1. Configure Environment

```bash
cp .env.example .env
# Edit .env with your API keys
```

### 2. Build and Start

```bash
# Build images
npm run docker:build

# Start all services
npm run docker:up
```

**Note:** The dev-agent container mounts the Docker socket to create sandbox containers. This is configured in `docker-compose.yml`. On Linux, ensure your user is in the `docker` group.

### 3. View Logs

```bash
# All logs
npm run docker:logs

# Specific agent
docker compose logs -f dev-agent
docker compose logs -f product-agent
```

### Service URLs

| Service | URL | Purpose |
|---------|-----|---------|
| Temporal UI | http://localhost:8080 | Workflow monitoring |
| Dev Agent webhook | http://localhost:3001 | Linear webhook endpoint (local) |
| Cloudflared | https://your-subdomain.your-domain.com | Webhook tunnel (when configured) |

### Running Individual Agents

Start just the infrastructure and run agents locally for debugging:

```bash
# Start infrastructure only
npm run infra:up

# Run agent locally (with DATABASE_URL pointing to Docker)
DATABASE_URL=postgresql://temporal:temporal@localhost:5432/temporal npm run dev-agent
```

## Webhook Tunnel Setup (Cloudflare)

External services (Linear, GitHub) cannot reach `localhost:3001` to deliver webhooks. Cloudflare Tunnel exposes your local webhook endpoints to the internet securely.

**Note:** The tunnel is optional. Port 3001 remains exposed for local testing and curl commands. Only set up the tunnel when you need webhooks from external services.

### Prerequisites

- Cloudflare account (free tier is sufficient)
- Domain added to Cloudflare (for custom subdomain)

**Note:** You may need two tunnels:
- **Webhooks tunnel**: Routes to `dev-agent:3001` for Linear/GitHub webhooks
- **OAuth tunnel**: Routes to `oauth:3000` for OAuth callbacks (only needed during authorization)

These can be separate tunnels or separate public hostnames on the same tunnel.

### 1. Create Tunnel in Zero Trust Dashboard

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) and select Zero Trust
2. Navigate to: **Networks** > **Tunnels**
3. Click **Create a tunnel**
4. Select **Cloudflared** as connector type
5. Name it (e.g., "aesir-dev")
6. Copy the tunnel token

### 2. Configure Environment

Add the token to your `.env` file:

```bash
CLOUDFLARE_TUNNEL_TOKEN=eyJhIjoiNzg5...your-token-here
```

### 3. Configure Public Hostname

In the tunnel configuration, add a public hostname:

| Field | Value |
|-------|-------|
| Subdomain | `aesir-dev` (or your choice) |
| Domain | `your-cloudflare-domain.com` |
| Path | (leave empty for all paths) |
| Service Type | HTTP |
| URL | `dev-agent:3001` |

This routes `https://aesir-dev.your-domain.com/*` to your local dev-agent container.

### 4. Start Services with Tunnel

```bash
# Start all services including tunnel
docker compose --profile tunnel up -d

# Or just the tunnel (if other services already running)
docker compose --profile tunnel up -d cloudflared cloudflared-health
```

### 5. Update Webhook URLs

Update your webhook configurations to use the tunnel URL:

| Service | Setting Location | New URL |
|---------|------------------|---------|
| Linear | Settings > Webhooks | `https://aesir-dev.your-domain.com/webhooks/linear` |
| GitHub | Repo Settings > Webhooks | `https://aesir-dev.your-domain.com/webhooks/github` |

### Verification

```bash
# Check tunnel is healthy
docker compose logs cloudflared

# Test endpoint is reachable (should return 401 - no signature)
curl -X POST https://aesir-dev.your-domain.com/webhooks/linear

# Check tunnel readiness
docker compose exec cloudflared curl -fsS http://localhost:2000/ready
```

### Troubleshooting Tunnel Issues

**"Tunnel not connecting"**
- Verify `CLOUDFLARE_TUNNEL_TOKEN` is set in `.env`
- Check token hasn't expired (regenerate in Zero Trust dashboard if needed)
- View logs: `docker compose logs cloudflared`

**"Webhooks not received"**
- Verify public hostname routes to `dev-agent:3001` (not `localhost:3001`)
- Ensure webhook URL in Linear/GitHub matches your tunnel URL exactly
- Check dev-agent logs: `docker compose logs dev-agent`

**"Connection refused in tunnel"**
- Ensure dev-agent container is running: `docker compose ps`
- Both services must be on the same network (`aesir-network`)

For detailed Cloudflare Tunnel documentation, see [developers.cloudflare.com](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/).

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
