# @aesir/platform

Infrastructure layer for the Aesir platform. Provides database connections, logging, Temporal integration, and sandbox management.

## Purpose

This package contains all infrastructure implementations that upper layers depend on. It has the "heavy" dependencies - database drivers, logging libraries, Temporal SDK, Docker APIs.

## What belongs here

- **Database** - Drizzle ORM setup, PostgreSQL connections, schema definitions, migrations
- **Logging** - Pino logger implementation, HTTP request logging, correlation ID tracking
- **Temporal** - Workflow client, worker setup, activity execution, signal handling
- **Sandbox** - Docker container management for code execution (dev containers)
- **Services** - Webhook idempotency, execution tracking, cleanup routines
- **Errors** - Platform-specific error classes (DatabaseError, TemporalError, etc.)

## What does NOT belong here

- **Pure types/interfaces** - Use `@aesir/types`
- **Agent logic** - Use `@aesir/agents`
- **Integration-specific code** - Use `@aesir/integration-*`

## Key Exports

```typescript
import {
  // Logging
  createPinoLogger,
  createChildLogger,
  generateCorrelationId,
  type PinoLogger,

  // Database
  db,
  createDatabaseConnection,

  // Temporal
  startApprovalWorkflow,
  sendApprovalSignal,
  createTemporalClient,

  // Sandbox
  createDevContainerManager,
  createDevContainerGit,
  createDevContainerCleanup,

  // Services
  createWebhookIdempotencyService,

  // Errors
  DatabaseError,
  TemporalError,
  WebhookError,
} from "@aesir/platform";
```

## Dependencies

This package has infrastructure dependencies:

- `pg` / `drizzle-orm` - PostgreSQL database
- `pino` / `pino-http` - Structured logging
- `@temporalio/client` / `@temporalio/worker` - Workflow orchestration
- `dockerode` - Container management

## Package Architecture

```
Agents / Dashboard        (top-level applications)
   ↓
Integrations              (HTTP services for external APIs)
   ↓
Platform                  (infrastructure) ← you are here
   ↓
Types                     (pure contracts and utilities)
```

## Environment Variables

Platform requires these environment variables:

```bash
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/aesir

# Temporal
TEMPORAL_ADDRESS=localhost:7233
TEMPORAL_NAMESPACE=default

# Logging
LOG_LEVEL=info  # debug, info, warn, error

# Encryption (for credential storage)
CREDENTIAL_ENCRYPTION_KEY=<32-byte-hex>
```
