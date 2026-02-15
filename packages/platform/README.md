# @aesir/platform

Infrastructure layer for the Aesir platform. Provides database connections, logging, and sandbox management.

## Purpose

This package contains all infrastructure implementations that upper layers depend on. It has the "heavy" dependencies - database drivers, logging libraries, Docker APIs.

## What belongs here

- **Database** - Drizzle ORM setup, PostgreSQL connections, schema definitions, migrations
- **Logging** - Pino logger implementation, HTTP request logging, correlation ID tracking
- **Sandbox** - Docker container management for code execution (dev containers)
- **Services** - Webhook idempotency, execution tracking, cleanup routines
- **Errors** - Platform-specific error classes (DatabaseError, SandboxError, etc.)

## What does NOT belong here

- **Pure types/interfaces** - Use `@aesir/types`
- **Agent logic** - Use `@aesir/agents`
- **Integration-specific code** - Use `@aesir/integration-*`

## Key Exports

```typescript
import {
  // Config
  loadEnvFromRoot,         // Load .env from monorepo root (for scripts)
  getMonorepoRoot,         // Resolve monorepo root path

  // Logging
  createPinoLogger,        // Create structured logger
  createChildLogger,       // Create scoped child logger
  createHttpLogger,        // Express HTTP request logging middleware
  createTraceStore,        // Workflow trace recording
  generateCorrelationId,   // Unique correlation ID for request tracing
  createRedactionConfig,   // PII redaction for logs
  type PinoLogger,

  // Sandbox
  createDevContainerManager,
  createDevContainerGit,
  createDevContainerCleanup,

  // Services
  createWebhookIdempotencyService,
  createCleanupService,

  // Testing (for unit tests in other packages)
  MockChatModel,           // Deterministic LLM mock
  createLogCapture,        // Capture and assert on log output
  LogCapture,

  // Errors
  DatabaseError,
  SandboxError,
  WebhookError,
} from "@aesir/platform";
```

## Dependencies

This package has infrastructure dependencies:

- `pg` / `drizzle-orm` - PostgreSQL database
- `pino` / `pino-http` - Structured logging
- `dockerode` - Container management

## Package Architecture

```
Agents                    (unified agent service)
   |
Integrations              (HTTP services for external APIs)
   |
Platform                  (infrastructure) <- you are here
   |
Types                     (pure contracts and utilities)
```

## Environment Variables

Platform requires these environment variables:

```bash
# Database
DB_HOST=localhost
DB_PORT=5432
DB_USER=aesir
DB_PASSWORD=aesir
DB_NAME=aesir

# Logging
LOG_LEVEL=info  # debug, info, warn, error

# Encryption (for credential storage)
CREDENTIAL_ENCRYPTION_KEY=<32-byte-hex>
```
