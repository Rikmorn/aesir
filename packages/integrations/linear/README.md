# @aesir/integration-linear

Linear integration service for the Aesir platform. Provides OAuth authentication, webhook handling, and Linear API access for agent interactions.

## Features

- OAuth 2.0 authentication with Linear
- Webhook signature verification (HMAC-SHA256)
- Agent activity emitters (thought, action, response, error, elicitation)
- Issue management (create, read, update status)
- Database-backed credential storage with encryption

## Configuration

### Required Environment Variables

| Variable | Description |
|----------|-------------|
| LINEAR_CLIENT_ID | Linear OAuth app client ID |
| LINEAR_CLIENT_SECRET | Linear OAuth app client secret |
| LINEAR_WEBHOOK_SECRET | Webhook signing secret from Linear |
| CREDENTIAL_ENCRYPTION_KEY | 32-byte hex key for token encryption |

### Optional Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| PORT | 3001 | HTTP server port |
| NODE_ENV | development | Environment |
| LOG_LEVEL | info | Logging level |
| DB_HOST | localhost | PostgreSQL host |
| DB_PORT | 5432 | PostgreSQL port |
| DB_USER | aesir | PostgreSQL user |
| DB_PASSWORD | aesir | PostgreSQL password |
| DB_NAME | aesir | PostgreSQL database |
| OAUTH_CALLBACK_URL | - | OAuth callback URL |

## Usage

### As a Service

```bash
# Build and run
pnpm --filter @aesir/integration-linear build
node packages/integrations/linear/dist/main.js

# Or with Docker
docker build -t aesir-linear -f packages/integrations/linear/Dockerfile .
docker run -p 3001:3001 --env-file .env aesir-linear
```

### As a Library

```typescript
import {
  createLinearClientFromDatabase,
  verifyWebhookSignature,
  emitThought,
} from '@aesir/integration-linear';

// Create client from stored credentials
const client = await createLinearClientFromDatabase();

// Verify webhook
if (verifyWebhookSignature(signature, rawBody, secret)) {
  // Process webhook...
}

// Emit agent activity
await emitThought(client, sessionId, 'Processing task...');
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| /webhook | POST | Linear webhook receiver |
| /oauth/authorize | GET | Start OAuth flow |
| /oauth/callback | GET | OAuth callback handler |

## Database Schema

The service uses its own PostgreSQL schema (`linear.*`) for data isolation:

- `linear.credentials` - Encrypted OAuth tokens
- `linear.webhook_deliveries` - Webhook idempotency tracking
- `linear.mcp_tool_permissions` - Agent MCP tool access control

## Database Setup

After starting PostgreSQL, run migrations and seed permissions:

```bash
# Run migrations (creates tables)
pnpm --filter @aesir/integration-linear db:migrate

# Seed MCP tool permissions for agents
pnpm --filter @aesir/integration-linear seed:permissions
```

If migrations fail due to existing tables (error 42P07), you may need to run only the missing migrations manually. Check `src/db/migrations/` for SQL files.

## Development

```bash
# Install dependencies
pnpm install

# Run type checking
pnpm --filter @aesir/integration-linear typecheck

# Run tests
pnpm --filter @aesir/integration-linear test

# Build
pnpm --filter @aesir/integration-linear build
```

## License

Internal - Aesir Platform
