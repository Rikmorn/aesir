# @aesir/integration-slack

Slack integration package for the Aesir platform. Provides Bolt app factory, WebClient utilities, event handling with deduplication, and message posting with Block Kit support.

## Features

- **Bolt Framework Integration**: Socket Mode and HTTP mode support
- **PostgreSQL OAuth Storage**: Bolt installationStore backed by database
- **Event Deduplication**: Prevents duplicate processing via event_id
- **Block Kit Builders**: Approval buttons, status messages, progress updates
- **Thread-Aware Messaging**: Maintains conversation context

## Configuration

### Required Environment Variables

| Variable | Description |
|----------|-------------|
| SLACK_BOT_TOKEN | Bot User OAuth Token (xoxb-...) |
| SLACK_SIGNING_SECRET | Signing secret for request verification |
| SLACK_CLIENT_ID | OAuth App client ID |
| SLACK_CLIENT_SECRET | OAuth App client secret |

### Optional Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| PORT | 3003 | HTTP server port |
| NODE_ENV | development | Environment |
| LOG_LEVEL | info | Logging level |
| SLACK_MODE | socket | Connection mode: "socket" or "http" |
| SLACK_APP_TOKEN | - | App-Level Token (xapp-...) for Socket Mode |
| SLACK_STATE_SECRET | - | Secret for OAuth state validation |
| OAUTH_CALLBACK_URL | - | OAuth callback URL |
| DB_HOST | localhost | PostgreSQL host |
| DB_PORT | 5432 | PostgreSQL port |
| DB_USER | aesir | PostgreSQL user |
| DB_PASSWORD | aesir | PostgreSQL password |
| DB_NAME | aesir | PostgreSQL database |
| CREDENTIAL_ENCRYPTION_KEY | - | 64-char hex key for token encryption |

## Connection Modes

### Socket Mode (Development)

Uses Slack's Socket Mode for real-time events via WebSocket:

- No public URL required (firewall-friendly)
- Requires `SLACK_APP_TOKEN` (xapp-...)
- Limited to 10 concurrent connections
- Ideal for development and testing

### HTTP Mode (Production)

Uses traditional HTTP endpoints for webhooks:

- Requires public URL for webhook delivery
- Uses `SLACK_SIGNING_SECRET` for request verification
- No connection limits, horizontally scalable
- Ideal for production deployments

## Usage

### As a Service

```bash
# Configure environment
cp .env.example .env
# Edit .env with your Slack app credentials

# Run migrations
pnpm --filter @aesir/integration-slack db:migrate

# Build and run
pnpm --filter @aesir/integration-slack build
node packages/integrations/slack/dist/main.js

# Or with Docker
docker build -t aesir-slack -f packages/integrations/slack/Dockerfile .
docker run -p 3003:3003 --env-file packages/integrations/slack/.env aesir-slack
```

### As a Library

```typescript
import {
  createBoltApp,
  createSlackClientFromDatabase,
  sendApprovalRequest,
  buildApprovalBlocks,
  createSlackCredentialStore,
} from "@aesir/integration-slack";

// Create credential store
const credentialStore = createSlackCredentialStore({ db, logger });

// Create WebClient from database credentials
const client = await createSlackClientFromDatabase({
  teamId: "T1234567890",
  credentialStore,
  logger,
});

// Send approval request with interactive buttons
const result = await sendApprovalRequest(client, {
  type: "approval_needed",
  taskId: "ABC-123",
  prUrl: "https://github.com/org/repo/pull/42",
  title: "feat: Add user authentication",
  summary: "Implements JWT-based auth",
}, "C1234567890");

// Build custom Block Kit messages
const blocks = buildApprovalBlocks({
  type: "approval_needed",
  taskId: "ABC-123",
  title: "Review PR",
  summary: "Changes ready for review",
});
```

## API Endpoints

When running as a service in HTTP mode:

| Endpoint | Method | Description |
|----------|--------|-------------|
| /health | GET | Health check |
| /events | POST | Slack Events API receiver |
| /slack/interactions | POST | Block actions handler (approval/rejection buttons) |
| /mcp/tools | GET | List available MCP tools |
| /mcp/tools/:name | POST | Invoke an MCP tool |
| /oauth/authorize | GET | Start OAuth flow |
| /oauth/callback | GET | OAuth callback handler |

## Database Schema

The service uses its own PostgreSQL schema (`slack.*`) for data isolation:

- `slack.installations` - Bolt OAuth installations (tokens, team info)
- `slack.event_deliveries` - Event idempotency tracking
- `slack.mcp_tool_permissions` - Agent MCP tool access control
- `slack.task_correlations` - Maps external resources (channels, messages, threads) to task IDs

Run migrations and seed permissions:

```bash
pnpm --filter @aesir/integration-slack db:migrate
pnpm --filter @aesir/integration-slack seed:permissions
```

## Event Handling

Events are deduplicated via event_id before processing:

```typescript
import { createEventHandler } from "@aesir/integration-slack";

const handler = createEventHandler({
  deliveryStore,
  logger,
});

// Returns null for duplicates, SlackEventPayload for new events
const result = await handler.handleEvent(payload);
```

## Message Types

- **Approval Messages**: Interactive approve/reject buttons with Block Kit
- **Status Updates**: Started/completed/failed with emoji indicators
- **Simple Messages**: Plain text or Block Kit arrays
- **Thread Replies**: Maintains conversation context via thread_ts

## Development

```bash
# Install dependencies
pnpm install

# Run type checking
pnpm --filter @aesir/integration-slack typecheck

# Run tests
pnpm --filter @aesir/integration-slack test

# Build
pnpm --filter @aesir/integration-slack build

# Lint
pnpm --filter @aesir/integration-slack lint

# Generate database migrations
pnpm --filter @aesir/integration-slack db:generate
```

## License

Internal - Aesir Platform
