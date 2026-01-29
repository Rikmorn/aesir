# Aesir

Agentic development platform that automates software workflows - from feature request to shipped code. Agents collaborate using existing business tools (Linear, GitHub, Slack) and operate like coworkers within those tools.

## Features

- **Product Agent**: Gathers requirements through Slack conversations, creates Linear tasks
- **Dev Agent**: Picks up tasks, writes code in Docker sandboxes, runs tests, creates PRs
- **Human-in-the-Loop**: Temporal-orchestrated approval gates before execution and PR merge
- **MCP Integration Layer**: Agents communicate with services via Model Context Protocol (HTTP)
- **Observability**: Structured logging, correlation IDs, execution tracking

## Prerequisites

- Node.js 20+
- pnpm 9.15+
- Docker Desktop running (all services run containerized)
- Slack workspace with admin access to create apps
- Linear workspace
- GitHub repository
- Anthropic API key

## Quick Start

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your credentials. At minimum you need:

| Variable | Where to Get It |
|----------|-----------------|
| `ANTHROPIC_API_KEY` | console.anthropic.com > API Keys |
| `LINEAR_ACCESS_TOKEN` | Linear > Settings > API > Personal API keys |
| `LINEAR_TEAM_ID` | Linear > Settings > Teams > Team settings (URL) |
| `GITHUB_TOKEN` | GitHub > Settings > Developer settings > Personal access tokens |
| `GITHUB_REPO` | Your repository in `owner/repo` format |
| `SLACK_BOT_TOKEN` | Slack App > OAuth & Permissions |
| `SLACK_APP_TOKEN` | Slack App > Basic Information > App-Level Tokens |
| `CREDENTIAL_ENCRYPTION_KEY` | Generate with `openssl rand -hex 32` |

See [Environment Setup](#environment-setup) for full configuration.

### 3. Start Infrastructure

```bash
docker compose up -d postgresql temporal temporal-ui
```

Wait for Temporal to initialize, then run database migrations:

```bash
pnpm db:migrate
```

### 4. Seed MCP Permissions

```bash
pnpm --filter @aesir/integration-linear seed:permissions
pnpm --filter @aesir/integration-github seed:permissions
pnpm --filter @aesir/integration-slack seed:permissions
```

### 5. Start All Services

```bash
# Start all services (integrations + agents)
docker compose up -d

# Or with hot reload on source changes
docker compose watch
```

### Service URLs

| Service | URL | Purpose |
|---------|-----|---------|
| Nginx Proxy | http://localhost | Unified entry point |
| PostgreSQL | localhost:5432 | Database |
| Temporal gRPC | localhost:7233 | Workflow orchestration |
| Temporal UI | http://localhost:8080 | Workflow monitoring |
| Linear Integration | http://localhost:3001 | Linear webhooks, OAuth, MCP |
| GitHub Integration | http://localhost:3002 | GitHub webhooks, OAuth, MCP |
| Slack Integration | http://localhost:3003 | Slack events, OAuth, MCP |
| Dev Agent | http://localhost:3004 | Dev agent HTTP API |

## Architecture

```
                    ┌─────────────┐
                    │   Slack     │
                    │   User      │
                    └──────┬──────┘
                           │
┌──────────────────────────┼──────────────────────────┐
│                     Nginx Proxy (:80)                │
│      /linear/*    /github/*    /slack/*    /agent/*  │
└────────┬────────────┬───────────┬───────────┬───────┘
         │            │           │           │
    ┌────▼────┐  ┌────▼────┐ ┌───▼────┐ ┌────▼────────┐
    │ Linear  │  │ GitHub  │ │ Slack  │ │ Dev Agent   │
    │ :3001   │  │ :3002   │ │ :3003  │ │ :3004       │
    │         │  │         │ │        │ │             │
    │ MCP     │  │ MCP     │ │ MCP    │ │ LangGraph   │
    │ OAuth   │  │ OAuth   │ │ OAuth  │ │ Temporal    │
    │ Webhooks│  │ Webhooks│ │ Events │ │ Sandbox     │
    └────┬────┘  └────┬────┘ └───┬────┘ └──────┬──────┘
         │            │          │              │
         └────────────┼──────────┘     ┌────────┼────────┐
                      │                │        │        │
               ┌──────▼──────┐   ┌─────▼──┐ ┌──▼─────┐ │
               │ PostgreSQL  │   │Docker  │ │Temporal│ │
               │ :5432       │   │Sandbox │ │:7233   │ │
               └─────────────┘   └────────┘ └────────┘ │
                                                        │
                                              ┌─────────▼─────────┐
                                              │ Product Agent     │
                                              │ (Slack → Linear)  │
                                              └───────────────────┘
```

### 3-Layer Architecture

```
Agents (dev-agent, product-agent)
   ↓ communicates via MCP (HTTP)
Integrations (Linear, GitHub, Slack)
   ↓ imports from
Platform (config, logging, state, temporal)
```

- **Agents** communicate with integrations exclusively via HTTP/MCP - no direct SDK imports
- **Integrations** are independent packages with their own database schemas, HTTP servers, and OAuth flows
- **Platform** provides shared infrastructure (logging, config, database, sandbox)

## Project Structure

```
packages/
├── agents/                  # @aesir/agents
│   └── src/
│       ├── dev-agent/       # Dev Agent (code generation, PRs)
│       │   ├── workflow/    # HITL LangGraph workflow
│       │   │   └── nodes/   # Phase nodes (research, plan, execute, verify, etc.)
│       │   ├── api/         # HTTP handlers
│       │   ├── classification/ # Approval intent classifier
│       │   └── utils/       # Package manager detection
│       ├── product-agent/   # Product Agent (requirements → tasks)
│       │   ├── workflow/    # Conversation LangGraph workflow
│       │   │   └── nodes/   # Phase nodes (analyze, clarify, create)
│       │   ├── api/         # HTTP handlers
│       │   └── slack/       # Slack event handlers
│       └── shared/          # Shared agent infrastructure
│           ├── mcp/         # MCP client for integration calls
│           ├── temporal/    # Workflows, activities, signals
│           └── tracing/     # LangGraph execution tracing
├── integrations/
│   ├── linear/              # @aesir/integration-linear (:3001)
│   │   └── src/
│   │       ├── api/         # HTTP routes (webhooks, OAuth)
│   │       ├── client/      # Linear SDK wrapper
│   │       ├── db/          # linear.* schema
│   │       ├── mcp/         # MCP server and tools
│   │       └── oauth/       # Token management
│   ├── github/              # @aesir/integration-github (:3002)
│   │   └── src/
│   │       ├── api/         # HTTP routes (webhooks, OAuth)
│   │       ├── client/      # Octokit client factory
│   │       ├── db/          # github.* schema
│   │       ├── mcp/         # MCP server and tools
│   │       └── operations/  # Branch, commit, PR operations
│   └── slack/               # @aesir/integration-slack (:3003)
│       └── src/
│           ├── api/         # HTTP routes (events, OAuth)
│           ├── client/      # Bolt app factory
│           ├── db/          # slack.* schema
│           ├── mcp/         # MCP server and tools
│           └── messages/    # Block Kit builders
├── platform/                # @aesir/platform
│   └── src/
│       ├── config/          # Environment configuration
│       ├── db/              # Database connection, migrations
│       ├── logging/         # Pino-based structured logging
│       └── sandbox/         # Docker sandbox for code execution
├── observability/           # @aesir/observability
│   └── src/
│       ├── db/              # observability.* schema
│       └── services/        # ExecutionTracker, IdempotencyChecker
└── common/                  # @aesir/common
    └── src/
        ├── errors/          # Error classes
        └── types/           # Shared domain types
```

## Available Scripts

### Development

| Script | Description |
|--------|-------------|
| `pnpm build` | Compile TypeScript across all packages |
| `pnpm typecheck` | Type check without emit |
| `pnpm test` | Run all tests |
| `pnpm test:fast` | Run unit tests only (skip integration/e2e) |
| `pnpm test:integration` | Run integration tests (requires Docker) |
| `pnpm test:coverage` | Run with coverage report |
| `pnpm lint` | Run Biome linting |
| `pnpm lint:fix` | Auto-fix lint issues |
| `pnpm format` | Format with Biome |

### Docker Compose

| Script | Description |
|--------|-------------|
| `pnpm docker:build` | Build Docker images |
| `pnpm docker:up` | Start all services |
| `pnpm docker:down` | Stop all services |
| `pnpm docker:logs` | Follow all logs |
| `pnpm docker:dev-agent` | Start and follow Dev Agent logs |
| `pnpm docker:product-agent` | Start and follow Product Agent logs |
| `pnpm infra:up` | Start PostgreSQL + Temporal only |

### Database

| Script | Description |
|--------|-------------|
| `pnpm db:migrate` | Run all database migrations (sequential) |
| `pnpm db:generate` | Generate migration files from schema changes |

## Environment Setup

Create `.env` from the example:

```bash
cp .env.example .env
```

See `.env.example` for all available variables with documentation. Key sections:

- **Anthropic**: API key for LLM reasoning
- **Slack**: Bot token, app token, signing secret, OAuth credentials
- **Linear**: Access token, team ID, webhook secret, OAuth credentials
- **GitHub**: Token, repository, webhook secret, OAuth credentials
- **Database**: PostgreSQL connection string, credential encryption key
- **Temporal**: Server address and namespace
- **Observability**: LangSmith tracing (optional)
- **Cloudflare**: Tunnel token for webhook exposure (optional)

## Slack App Setup

### 1. Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App** > **From scratch**
3. Name it (e.g., "Aesir Product Agent") and select your workspace

### 2. Enable Socket Mode

1. Go to **Socket Mode** in the sidebar
2. Toggle **Enable Socket Mode** to ON
3. Create an app-level token with `connections:write` scope
4. Copy the token (starts with `xapp-`) to `SLACK_APP_TOKEN`

### 3. Configure Bot Token Scopes

Go to **OAuth & Permissions** > **Scopes** > **Bot Token Scopes** and add:

| Scope | Purpose |
|-------|---------|
| `app_mentions:read` | Receive @mentions |
| `chat:write` | Send messages |
| `im:history` | Read DM history for context |
| `im:read` | Access DM channels |
| `im:write` | Send DMs |
| `users:read` | Get user info |

### 4. Subscribe to Events

Go to **Event Subscriptions** > **Subscribe to bot events** and add:

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

1. Go to Linear > Settings > API > Personal API keys
2. Create a new key
3. Set `LINEAR_ACCESS_TOKEN=lin_api_your-key` in `.env`

### Production: OAuth App

For production use, OAuth is recommended. Actions appear as the app identity rather than a personal user.

1. Create a Linear OAuth Application at [linear.app/settings/api/applications](https://linear.app/settings/api/applications)
2. Set the redirect URI to your OAuth callback URL
3. Add `LINEAR_CLIENT_ID` and `LINEAR_CLIENT_SECRET` to `.env`
4. Start services and navigate to http://localhost/linear/oauth/authorize

OAuth tokens are encrypted and stored in PostgreSQL (`linear.credentials` table).

## Webhook Tunnel Setup (Cloudflare)

External services (Linear, GitHub) cannot reach localhost to deliver webhooks. Cloudflare Tunnel exposes your local endpoints to the internet securely.

The tunnel is optional - only needed when you want webhooks from external services.

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

In the tunnel configuration, point to `nginx:80` for unified routing:

| Field | Value |
|-------|-------|
| Subdomain | `aesir-dev` (or your choice) |
| Domain | `your-cloudflare-domain.com` |
| Path | (leave empty) |
| Service Type | HTTP |
| URL | `nginx:80` |

This routes through the nginx proxy, which forwards to the correct integration service based on path.

### 4. Start Services with Tunnel

```bash
docker compose --profile tunnel up -d
```

### 5. Update Webhook URLs

| Service | Setting Location | URL |
|---------|------------------|-----|
| Linear | Settings > Webhooks | `https://aesir-dev.your-domain.com/linear/webhook` |
| GitHub | Repo Settings > Webhooks | `https://aesir-dev.your-domain.com/github/webhooks/github` |

### Verification

```bash
# Check tunnel is healthy
docker compose logs cloudflared

# Test endpoint is reachable
curl -X POST https://aesir-dev.your-domain.com/linear/webhook
```

## Dev Agent Workflow

1. **Task Assignment**: Delegate a Linear issue to the Dev Agent
2. **Research**: Agent analyzes the codebase in a Docker sandbox
3. **Planning**: Agent creates an execution plan
4. **Approval**: Human reviews plan via Temporal signal (Slack notification)
5. **Execution**: Agent writes code, runs tests in sandbox
6. **Verification**: Full test suite validation
7. **PR Creation**: Agent creates branch and pull request
8. **Review**: Human reviews PR via GitHub
9. **Feedback**: Agent addresses review comments if needed

## Product Agent Workflow

1. **Conversation**: User describes a feature via Slack (@mention or DM)
2. **Clarification**: Agent asks follow-up questions to refine requirements
3. **Task Creation**: Agent creates structured Linear tasks with acceptance criteria

## Troubleshooting

### "Missing required environment variables"

Ensure all required variables are set in `.env`. The startup logs will list any missing variables.

### "relation does not exist" database errors

Run database migrations:

```bash
pnpm db:migrate
```

### "Failed to connect to Temporal server"

- Ensure infrastructure is running: `docker compose up -d postgresql temporal temporal-ui`
- Wait for Temporal to initialize
- Check Temporal UI at http://localhost:8080

### "Failed to connect to Slack"

1. Verify Socket Mode is enabled in your Slack app settings
2. Check that `SLACK_APP_TOKEN` has `connections:write` scope
3. Ensure the app is installed to your workspace

### "Bot doesn't respond to @mentions"

1. Verify `app_mention` event is subscribed in Slack app settings
2. Check the bot is invited to the channel (`/invite @BotName`)
3. Check container logs: `docker compose logs -f slack-integration`

### "Linear tasks not being created"

1. Verify `LINEAR_ACCESS_TOKEN` is valid
2. Verify `LINEAR_TEAM_ID` exists in your workspace
3. Check MCP permissions are seeded: `pnpm --filter @aesir/integration-linear seed:permissions`

## Development

### Running Tests

```bash
# Run all tests
pnpm test

# Run unit tests only (fast, no Docker needed)
pnpm test:fast

# Run specific test file
pnpm vitest run path/to/file.test.ts

# Watch mode
pnpm test:watch
```

### Database Schemas

Each integration has its own PostgreSQL schema:

| Schema | Package | Description |
|--------|---------|-------------|
| `platform` | @aesir/platform | Workspaces, configurations |
| `linear` | @aesir/integration-linear | Linear credentials, webhooks |
| `github` | @aesir/integration-github | GitHub credentials, webhooks |
| `slack` | @aesir/integration-slack | Slack credentials, events |
| `observability` | @aesir/observability | Execution tracking |

### Hot Reload

For the fastest development loop, use Docker Compose watch mode:

```bash
docker compose watch
```

This rebuilds containers on source file changes. For even faster iteration, run individual services locally with `tsx watch`.

## License

Proprietary - Internal use only
