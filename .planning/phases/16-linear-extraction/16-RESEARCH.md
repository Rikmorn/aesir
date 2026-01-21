# Phase 16: Linear Extraction - Research

**Researched:** 2026-01-21
**Domain:** Package extraction, pnpm monorepo, PostgreSQL schema namespacing, HTTP frameworks
**Confidence:** HIGH

## Summary

This phase extracts the Linear integration from `packages/integrations/src/linear/` into an independent package `@aesir/integration-linear` at `packages/integrations/linear/`. The extraction follows established monorepo patterns in the codebase and requires:

1. Creating a new pnpm workspace package with its own `package.json`, TypeScript config, and Dockerfile
2. Migrating the database schema from `integrations.credentials` to `linear.credentials`
3. Setting up an independent HTTP entry point with Express (or recommended alternative)
4. Moving all Linear-specific code while maintaining the established error handling and logging patterns

**Primary recommendation:** Use the existing Express/pino patterns already in the codebase. Create a `linear` PostgreSQL schema for full data ownership. Follow the Phase 15 barrel export pattern with explicit section markers.

## Standard Stack

The established libraries/tools for this domain:

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@linear/sdk` | ^70.0.0 | Linear API client | Official SDK, already in use |
| `express` | ^4.21.x | HTTP server | Already used in codebase (pino-http), familiar patterns |
| `drizzle-orm` | ^0.45.1 | Database ORM | Already used for schema, migrations, queries |
| `neverthrow` | ^8.2.0 | Result types | Established in Phase 15 for service boundaries |
| `pino` | ^10.2.1 | Logging | Via `@aesir/common` `createPinoLogger` |
| `zod` | 3.25.67 | Validation | Already used for env validation, webhook parsing |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@hono/node-server` | latest | Alternative HTTP | If Express proves limiting (see Alternatives) |
| `drizzle-kit` | ^0.31.8 | Migration generation | Schema changes |
| `pg` | ^8.17.2 | PostgreSQL driver | Database connections |
| `dotenv-flow` | ^4.1.0 | Env loading | Via `@aesir/common` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Express | Hono | Better performance, Web Standards API, but new pattern to introduce |
| Express | Koa | Same team as Express, async/await native, but less ecosystem |

**HTTP Framework Recommendation:** Stick with Express for this phase. Reasons:
1. `pino-http` middleware already exists in `@aesir/common`
2. Familiar patterns reduce cognitive load during extraction
3. Express performance is adequate for webhook handling
4. Introducing Hono adds scope to an already complex extraction

Consider Hono for future integrations (GitHub, Slack) once Linear extraction proves the pattern.

**Installation:**
```bash
# In packages/integrations/linear/
pnpm add @linear/sdk@^70.0.0 express@^4.21.0 drizzle-orm@^0.45.1 neverthrow@^8.2.0 pg@^8.17.2 zod@3.25.67
pnpm add -D @types/express @types/pg drizzle-kit typescript vitest
```

## Architecture Patterns

### Recommended Project Structure

```
packages/integrations/linear/
├── src/
│   ├── api/                    # HTTP routes
│   │   ├── routes.ts           # Express router setup
│   │   ├── webhooks.ts         # Webhook handler
│   │   └── oauth.ts            # OAuth callback handler
│   ├── db/                     # Database layer
│   │   ├── client.ts           # Drizzle client
│   │   ├── schema.ts           # linear.* tables
│   │   ├── schema.drizzle.ts   # Drizzle-kit compatible schema
│   │   ├── encryption.ts       # Token encryption (moved from integrations)
│   │   ├── migrations/         # SQL migrations
│   │   └── credential-store.ts # Linear credential operations
│   ├── oauth/                  # OAuth flow
│   │   ├── flow.ts             # OAuth state machine
│   │   └── tokens.ts           # Token management
│   ├── webhooks/               # Webhook processing
│   │   ├── signature.ts        # HMAC verification
│   │   ├── parser.ts           # Payload parsing
│   │   └── handlers.ts         # Event handlers
│   ├── client/                 # Linear SDK wrapper
│   │   ├── factory.ts          # createLinearClient
│   │   ├── issues.ts           # Issue operations
│   │   └── activities.ts       # Agent activity emitters
│   ├── types/                  # Type definitions
│   │   ├── config.ts           # LinearConfig, env schema
│   │   ├── webhooks.ts         # Webhook payload types
│   │   └── errors.ts           # LinearError
│   ├── index.ts                # Barrel export
│   └── main.ts                 # HTTP server entry point
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── drizzle.config.ts
├── Dockerfile
└── README.md
```

### Pattern 1: Self-Contained Env Validation

**What:** Linear package defines and validates its own `LINEAR_*` env vars
**When to use:** Package entry point (main.ts)
**Example:**
```typescript
// src/types/config.ts
import { z } from "zod";
import dotenvFlow from "dotenv-flow";

dotenvFlow.config({ silent: true });

const linearEnvSchema = z.object({
  // Server
  PORT: z.coerce.number().default(3001),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  // Linear OAuth
  LINEAR_CLIENT_ID: z.string().min(1, "LINEAR_CLIENT_ID is required"),
  LINEAR_CLIENT_SECRET: z.string().min(1, "LINEAR_CLIENT_SECRET is required"),
  LINEAR_WEBHOOK_SECRET: z.string().min(1, "LINEAR_WEBHOOK_SECRET is required"),

  // Database
  DB_HOST: z.string().default("localhost"),
  DB_PORT: z.coerce.number().default(5432),
  DB_USER: z.string().default("temporal"),
  DB_PASSWORD: z.string().default("temporal"),
  DB_NAME: z.string().default("temporal"),
  CREDENTIAL_ENCRYPTION_KEY: z.string().length(64).optional(),
});

export const env = linearEnvSchema.parse(process.env);

export const config = {
  server: { port: env.PORT, nodeEnv: env.NODE_ENV },
  linear: {
    clientId: env.LINEAR_CLIENT_ID,
    clientSecret: env.LINEAR_CLIENT_SECRET,
    webhookSecret: env.LINEAR_WEBHOOK_SECRET,
  },
  database: {
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    name: env.DB_NAME,
    encryptionKey: env.CREDENTIAL_ENCRYPTION_KEY,
  },
  logging: { level: env.LOG_LEVEL },
} as const;
```

### Pattern 2: PostgreSQL Schema Namespace

**What:** Linear owns `linear.*` schema for full data isolation
**When to use:** Database table definitions
**Example:**
```typescript
// src/db/schema.ts
import { pgSchema, text, timestamp, unique } from "drizzle-orm/pg-core";
import { createId } from "@aesir/common";

export const linearSchema = pgSchema("linear");

export const credentials = linearSchema.table(
  "credentials",
  {
    id: text("id").primaryKey().$defaultFn(() => createId.credential()),
    workspace_id: text("workspace_id").notNull(),
    encrypted_access_token: text("encrypted_access_token").notNull(),
    encrypted_refresh_token: text("encrypted_refresh_token"),
    token_type: text("token_type").default("Bearer"),
    scope: text("scope"),
    expires_at: timestamp("expires_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deleted_at: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    unique("linear_credentials_workspace_unique").on(table.workspace_id),
  ],
);

export const webhookDeliveries = linearSchema.table(
  "webhook_deliveries",
  {
    id: text("id").primaryKey().$defaultFn(() => createId.webhookDelivery()),
    delivery_id: text("delivery_id").notNull().unique(),
    event_type: text("event_type").notNull(),
    payload_hash: text("payload_hash"),
    processed_at: timestamp("processed_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
);
```

### Pattern 3: Service Factory with ResultAsync

**What:** Factory functions return service objects with ResultAsync methods
**When to use:** All service boundaries (database, external APIs)
**Example:**
```typescript
// Source: packages/integrations/src/db/credential-store.ts (existing pattern)
export function createLinearCredentialStore(
  options: CredentialStoreOptions,
): LinearCredentialStore {
  const { db, logger } = options;

  if (!db) throw new Error("db is required for LinearCredentialStore");
  if (!logger) throw new Error("logger is required for LinearCredentialStore");

  return {
    store(input: StoreCredentialInput): ResultAsync<string, LinearError> {
      return fromPromise(storeImpl(db, logger, input), (error) => {
        logger.error({ err: error }, "Failed to store Linear credential");
        return new LinearError("INT_LINEAR_API", "Failed to store credential", {
          cause: error instanceof Error ? error : new Error(String(error)),
        });
      });
    },
    // ... other methods
  };
}
```

### Pattern 4: Express Server Entry Point

**What:** Main entry point that starts Express server
**When to use:** Container startup
**Example:**
```typescript
// src/main.ts
import express from "express";
import { createPinoLogger, createHttpLogger } from "@aesir/common";
import { config } from "./types/config.js";
import { createRoutes } from "./api/routes.js";
import { createLinearCredentialStore } from "./db/credential-store.js";
import { db } from "./db/client.js";

const logger = createPinoLogger({ component: "linear" });

async function main() {
  const app = express();

  // Middleware
  app.use(express.raw({ type: "application/json" })); // Raw body for webhook signature
  app.use(createHttpLogger({ logger }));

  // Services
  const credentialStore = createLinearCredentialStore({ db, logger });

  // Routes
  app.use("/", createRoutes({ credentialStore, logger }));

  // Start server
  const server = app.listen(config.server.port, () => {
    logger.info({ port: config.server.port }, "Linear integration service started");
  });

  // Graceful shutdown
  process.on("SIGTERM", () => {
    logger.info("SIGTERM received, shutting down");
    server.close(() => process.exit(0));
  });
}

main().catch((err) => {
  logger.error({ err }, "Failed to start Linear service");
  process.exit(1);
});
```

### Anti-Patterns to Avoid

- **Importing from @aesir/platform in Linear code:** Linear should only depend on `@aesir/common`
- **Shared credential table:** Each integration owns its schema; don't use `integrations.credentials`
- **Re-exporting @linear/sdk types:** Keep Linear package types self-contained
- **Global singletons for services:** Use factory functions with dependency injection
- **Throwing errors in service methods:** Use ResultAsync for service boundary calls

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Webhook signature | Custom HMAC implementation | Existing `verifyWebhookSignature` | Timing-safe comparison, tested |
| Token encryption | Custom crypto | Existing `encryptToken`/`decryptToken` | AES-256-CBC with IV, tested |
| Correlation IDs | Custom UUID | `@aesir/common` `generateCorrelationId` | Consistent format across services |
| HTTP logging | Custom middleware | `@aesir/common` `createHttpLogger` | pino-http with correlation |
| ID generation | `nanoid` directly | `@aesir/common` `createId` | Prefixed IDs (cred_, wh_, etc.) |
| Error serialization | Manual JSON | `AppError.toJSON()` | Consistent error format |

**Key insight:** The codebase has mature utilities in `@aesir/common`. Moving code from one package to another should reuse these, not recreate them.

## Common Pitfalls

### Pitfall 1: Raw Body for Webhook Verification

**What goes wrong:** Parsing JSON before signature verification breaks the signature
**Why it happens:** Express `express.json()` middleware parses body before route handler
**How to avoid:** Use `express.raw({ type: "application/json" })` for webhook routes
**Warning signs:** Signature verification always fails even with correct secret

```typescript
// WRONG - body is parsed, signature will fail
app.use(express.json());
app.post("/webhook", (req, res) => {
  const valid = verifyWebhookSignature(sig, JSON.stringify(req.body), secret);
});

// CORRECT - raw body preserved for verification
app.use(express.raw({ type: "application/json" }));
app.post("/webhook", (req, res) => {
  const valid = verifyWebhookSignature(sig, req.body.toString(), secret);
  const payload = JSON.parse(req.body.toString()); // Parse after verification
});
```

### Pitfall 2: pnpm Workspace Pattern Mismatch

**What goes wrong:** New package not recognized by pnpm
**Why it happens:** `pnpm-workspace.yaml` uses `packages/*` but Linear is at `packages/integrations/linear/`
**How to avoid:** Add `packages/integrations/*` pattern to workspace config
**Warning signs:** `pnpm install` doesn't link internal dependencies

```yaml
# pnpm-workspace.yaml
packages:
  - 'packages/*'
  - 'packages/integrations/*'  # Add this line
```

### Pitfall 3: drizzle-kit CJS Resolution

**What goes wrong:** `drizzle-kit generate` fails with import errors
**Why it happens:** drizzle-kit uses CJS bundler, can't resolve ESM-only imports
**How to avoid:** Create separate `schema.drizzle.ts` without external dependencies
**Warning signs:** "Cannot find module '@aesir/common'" during migration generation

```typescript
// src/db/schema.drizzle.ts - NO external imports
import { pgSchema, text, timestamp, unique } from "drizzle-orm/pg-core";
import { nanoid } from "nanoid"; // OK - pure ESM/CJS compatible

// Use inline ID generation instead of @aesir/common createId
```

### Pitfall 4: Missing TypeScript References

**What goes wrong:** Type errors when importing from `@aesir/common`
**Why it happens:** `tsconfig.json` missing reference to common package
**How to avoid:** Add references array to tsconfig
**Warning signs:** "Cannot find module '@aesir/common'" in IDE

```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "references": [
    { "path": "../../common" }
  ]
}
```

### Pitfall 5: Data Migration Schema Mismatch

**What goes wrong:** Migration fails or duplicates data
**Why it happens:** Old table has `workspace_id + provider` unique, new has `workspace_id` only
**How to avoid:** Filter by provider='linear' in migration, handle unique constraint change
**Warning signs:** "duplicate key value violates unique constraint"

## Code Examples

Verified patterns from the codebase:

### Webhook Handler with Express

```typescript
// Source: packages/integrations/src/linear/webhooks.ts (adapted for Express)
import { Router } from "express";
import { verifyWebhookSignature, parseWebhookPayload, isAgentSessionEvent } from "../webhooks/index.js";
import { config } from "../types/config.js";

export function createWebhookRouter(deps: { logger: PinoLogger }): Router {
  const router = Router();

  router.post("/webhook", async (req, res) => {
    const signature = req.headers["linear-signature"];
    const deliveryId = req.headers["linear-delivery"];
    const rawBody = req.body.toString();

    if (typeof signature !== "string") {
      deps.logger.warn("Missing webhook signature");
      return res.status(401).json({ error: "Missing signature" });
    }

    if (!verifyWebhookSignature(signature, rawBody, config.linear.webhookSecret)) {
      deps.logger.warn("Invalid webhook signature");
      return res.status(401).json({ error: "Invalid signature" });
    }

    const payload = parseWebhookPayload(rawBody);

    if (isAgentSessionEvent(payload)) {
      deps.logger.info({ sessionId: payload.agentSession.id }, "Agent session event");
      // Handle agent session...
    }

    res.status(200).json({ received: true });
  });

  return router;
}
```

### Drizzle Migration Config

```typescript
// drizzle.config.ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./src/db/migrations",
  schema: "./src/db/schema.drizzle.ts",
  dialect: "postgresql",
  dbCredentials: {
    host: process.env.DB_HOST ?? "localhost",
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USER ?? "temporal",
    password: process.env.DB_PASSWORD ?? "temporal",
    database: process.env.DB_NAME ?? "temporal",
    ssl: false,
  },
  migrations: {
    table: "__drizzle_linear_migrations",
    schema: "linear",
  },
  schemaFilter: ["linear"],
});
```

### Dockerfile for Integration Service

```dockerfile
# packages/integrations/linear/Dockerfile
FROM node:20-slim AS builder

WORKDIR /app

# Copy workspace files
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/common/package.json ./packages/common/
COPY packages/integrations/linear/package.json ./packages/integrations/linear/

# Install pnpm and dependencies
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
RUN pnpm install --frozen-lockfile

# Copy source
COPY tsconfig.base.json ./
COPY packages/common/ ./packages/common/
COPY packages/integrations/linear/ ./packages/integrations/linear/

# Build
RUN pnpm --filter @aesir/common build
RUN pnpm --filter @aesir/integration-linear build

# Production image
FROM node:20-slim AS runtime

WORKDIR /app

COPY --from=builder /app/packages/integrations/linear/dist ./dist
COPY --from=builder /app/packages/integrations/linear/package.json ./
COPY --from=builder /app/node_modules ./node_modules

RUN groupadd -g 1001 aesir && useradd -u 1001 -g aesir aesir
USER aesir

EXPOSE 3001

CMD ["node", "dist/main.js"]
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Shared `integrations.credentials` table | Per-integration schema (`linear.credentials`) | Phase 16 | Full data ownership per integration |
| `@aesir/platform` dependency in integrations | Only `@aesir/common` dependency | Phase 16 | Cleaner architecture boundaries |
| Monolithic integrations package | Independent integration packages | Phase 16 | Independent deployment, versioning |
| Throw errors in service methods | ResultAsync for explicit error handling | Phase 15 | Type-safe error propagation |

**Deprecated/outdated:**
- `getCredentialByProvider(workspaceId, "linear")`: Will be replaced by `linearCredentialStore.get(workspaceId)`
- `packages/integrations/src/linear/`: Preserved as `_legacy/linear` for reference during migration

## Open Questions

Things that couldn't be fully resolved:

1. **OAuth callback URL handling**
   - What we know: OAuth flow needs callback URL, currently configured via `OAUTH_CALLBACK_URL`
   - What's unclear: Should Linear package serve its own OAuth callback or delegate to main app?
   - Recommendation: Linear package serves its own OAuth routes at `/oauth/callback`, container exposes this

2. **Data migration timing**
   - What we know: Need to migrate from `integrations.credentials` to `linear.credentials`
   - What's unclear: Can we do this without downtime? What if OAuth flow runs during migration?
   - Recommendation: Migration script should be idempotent, check both tables, migrate incrementally

3. **Temporal activities location**
   - What we know: Context says "stay in agents package"
   - What's unclear: How do agents call Linear API if functions are in agents but implementation is in Linear?
   - Recommendation: Linear package exports functions, agents wrap them in Temporal activities

## Sources

### Primary (HIGH confidence)

- Codebase analysis: `packages/integrations/src/linear/` (existing implementation)
- Codebase analysis: `packages/integrations/src/db/` (credential store, encryption patterns)
- Codebase analysis: `packages/common/src/` (logging, errors, config patterns)
- [pnpm Workspaces](https://pnpm.io/workspaces) - Nested package configuration
- [Drizzle ORM Schema](https://orm.drizzle.team/docs/sql-schema-declaration) - pgSchema namespace pattern
- [Linear Webhooks](https://linear.app/developers/webhooks) - Signature verification spec

### Secondary (MEDIUM confidence)

- [Express vs alternatives comparison](https://medium.com/@khanshahid9283/express-vs-koa-vs-fastify-vs-nestjs-vs-hono-choosing-the-right-node-js-framework-17a56a533d29) - Framework decision rationale
- [Hono Node.js docs](https://hono.dev/docs/getting-started/nodejs) - Alternative HTTP framework
- [Drizzle multi-schema](https://github.com/drizzle-team/drizzle-orm/discussions/2127) - Multiple schemas same database

### Tertiary (LOW confidence)

- WebSearch results on HTTP framework performance - Benchmarks vary by workload

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Using existing codebase dependencies
- Architecture: HIGH - Following established patterns from Phase 15
- Pitfalls: HIGH - Identified from codebase analysis and official docs
- HTTP framework: MEDIUM - Express is safe choice, Hono is theoretical alternative

**Research date:** 2026-01-21
**Valid until:** 2026-02-21 (30 days - stable domain)
