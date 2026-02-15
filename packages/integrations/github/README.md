# @aesir/integration-github

GitHub integration package for the Aesir platform. Provides OAuth authentication, webhook handling, and GitHub API operations (branches, commits, pull requests).

## Features

- OAuth 2.0 authentication with GitHub
- Webhook signature verification (HMAC-SHA256)
- Repository operations (branches, commits, pull requests)
- Database-backed credential storage with encryption
- Pull request review webhook handling

## Configuration

### Required Environment Variables

| Variable | Description |
|----------|-------------|
| GITHUB_CLIENT_ID | GitHub OAuth App client ID |
| GITHUB_CLIENT_SECRET | GitHub OAuth App client secret |
| GITHUB_WEBHOOK_SECRET | Webhook signing secret from GitHub |

### Optional Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| PORT | 3002 | HTTP server port |
| NODE_ENV | development | Environment |
| LOG_LEVEL | info | Logging level |
| DB_HOST | localhost | PostgreSQL host |
| DB_PORT | 5432 | PostgreSQL port |
| DB_USER | aesir | PostgreSQL user |
| DB_PASSWORD | aesir | PostgreSQL password |
| DB_NAME | aesir | PostgreSQL database |
| OAUTH_CALLBACK_URL | - | OAuth callback URL |
| CREDENTIAL_ENCRYPTION_KEY | - | 64-char hex key for token encryption |

## Usage

### As a Service

```bash
# Build and run
pnpm --filter @aesir/integration-github build
node packages/integrations/github/dist/main.js

# Or with Docker
docker build -t aesir-github -f packages/integrations/github/Dockerfile .
docker run -p 3002:3002 --env-file .env aesir-github
```

### As a Library

```typescript
import {
  createGitHubClient,
  createGitHubClientFromDatabase,
  createBranch,
  createCommit,
  createPullRequest,
} from '@aesir/integration-github';

// Create client with token
const octokit = createGitHubClient({ token: process.env.GITHUB_TOKEN });

// Or create client from stored credentials
const octokitFromDb = await createGitHubClientFromDatabase({
  owner: 'default',
  db,
  logger,
});

// Create a branch
const branch = await createBranch(octokit, {
  owner: 'org',
  repo: 'repo',
  branchName: 'feature/new-feature',
  baseBranch: 'main',
});

// Create a commit
const commit = await createCommit(octokit, {
  owner: 'org',
  repo: 'repo',
  branch: 'feature/new-feature',
  message: 'Add new feature',
  files: [
    { path: 'src/feature.ts', content: 'export const x = 1;' }
  ],
});

// Create a pull request
const pr = await createPullRequest(octokit, {
  owner: 'org',
  repo: 'repo',
  title: 'Add new feature',
  body: 'This PR adds a new feature',
  head: 'feature/new-feature',
  base: 'main',
});
```

## API Endpoints

When running as a service:

| Endpoint | Method | Description |
|----------|--------|-------------|
| /health | GET | Health check |
| /webhooks/github | POST | GitHub webhook receiver |
| /oauth/github/authorize | GET | Start OAuth flow |
| /oauth/github/callback | GET | OAuth callback handler |

## Database Schema

The service uses its own PostgreSQL schema (`github.*`) for data isolation:

- `github.credentials` - Encrypted OAuth tokens
- `github.webhook_deliveries` - Webhook idempotency tracking
- `github.mcp_tool_permissions` - Agent MCP tool access control
- `github.task_correlations` - Maps external resources (repos, PRs, branches) to task IDs

Run migrations and seed permissions:

```bash
pnpm --filter @aesir/integration-github db:migrate
pnpm --filter @aesir/integration-github seed:permissions
```

## Development

```bash
# Install dependencies
pnpm install

# Run type checking
pnpm --filter @aesir/integration-github typecheck

# Run tests
pnpm --filter @aesir/integration-github test

# Build
pnpm --filter @aesir/integration-github build

# Lint
pnpm --filter @aesir/integration-github lint

# Generate database migrations
pnpm --filter @aesir/integration-github db:generate
```

## License

Internal - Aesir Platform
