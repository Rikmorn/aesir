# Phase 22: Local Dev Environment - Research

**Researched:** 2026-01-23
**Domain:** Docker Compose development setup, health checks, graceful shutdown
**Confidence:** HIGH

## Summary

This research covers implementing a one-command local development environment with Docker Compose that supports hot reload, health checks, and graceful shutdown. The standard approach for modern Node.js/TypeScript development is Docker Compose's `develop.watch` feature (introduced in v2.22.0+) combined with profile-based toggling, comprehensive health check endpoints using Express middleware, and signal-based graceful shutdown handlers.

Key findings show that Docker Compose watch natively supports TypeScript development by syncing source files while triggering rebuilds on dependency changes (package.json). Health checks should validate both application readiness and dependency connectivity (database, external services). Graceful shutdown requires careful handling of the PID 1 problem in containers and Temporal worker-specific shutdown semantics.

The existing codebase already implements basic health checks and graceful shutdown in integration services (Linear, GitHub, Slack), but lacks the Compose watch configuration, enhanced health checks with dependency validation, and proper init process handling for signal propagation.

**Primary recommendation:** Use Docker Compose v2.22.0+ with develop.watch configuration, profile-based watch mode toggling (`docker compose --profile watch up`), Express health endpoints with database connectivity checks, and init process (tini) to handle PID 1 signal propagation. Temporal workers require special shutdown handling to complete in-flight tasks.

## Standard Stack

The established tools for Docker-based local development:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Docker Compose | 2.22.0+ | Service orchestration | Native watch mode, depends_on conditions, profiles |
| Express.js | 4.x | HTTP framework | Simple health check endpoints, existing in codebase |
| tini | 0.19.0+ | Init process | Solves PID 1 signal handling for Node.js containers |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| tsx | 4.x | TypeScript execution | Watch mode for TypeScript files in development |
| pino | 9.x | Structured logging | Already in codebase, use for shutdown logs |
| postgres.js | 3.x | Database client | Health check database connectivity |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Docker Compose watch | Nodemon + volumes | Watch is native, no volume performance issues on Mac/Windows |
| tini | dumb-init | Both solve PID 1, tini is lighter and Docker's default |
| Express health endpoint | Dedicated health library | Express is already used, no extra dependency |

**Installation:**
```bash
# Docker Compose (already installed)
# tini ships with Docker by default, accessible via --init flag

# For Dockerfiles needing explicit tini:
# In Dockerfile:
RUN apk add --no-cache tini
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
```

## Architecture Patterns

### Recommended Project Structure
```
docker-compose.yml           # Main compose file with all services
packages/
├── integrations/
│   ├── linear/
│   │   ├── Dockerfile       # Integration-specific image
│   │   └── src/main.ts      # Startup + shutdown handlers
│   ├── github/
│   └── slack/
├── agents/
│   └── src/scripts/
│       ├── start-dev-agent.ts    # Temporal worker + HTTP server
│       └── start-product-agent.ts
└── platform/
    └── src/db/              # Database migrations
```

### Pattern 1: Docker Compose Watch Configuration
**What:** Configure file watching with action-specific behaviors (sync vs rebuild)
**When to use:** All services running TypeScript with hot reload needs
**Example:**
```yaml
# Source: https://docs.docker.com/compose/how-tos/file-watch/
services:
  linear-integration:
    build: ./packages/integrations/linear
    develop:
      watch:
        # Sync TypeScript source files for hot reload
        - action: sync
          path: ./packages/integrations/linear/src
          target: /app/packages/integrations/linear/src
          ignore:
            - node_modules/
        # Rebuild on dependency changes
        - action: rebuild
          path: ./packages/integrations/linear/package.json
```

### Pattern 2: Profile-Based Watch Toggle
**What:** Use Docker Compose profiles to make watch mode opt-in
**When to use:** When hot reload can be disruptive during debugging
**Example:**
```yaml
# Source: https://docs.docker.com/compose/how-tos/profiles/
services:
  dev-agent:
    build: .
    # No profiles = always starts
    # Watch config exists but only active with profile
    develop:
      watch:
        - action: sync
          path: ./packages/agents/src
          target: /app/packages/agents/src

# Usage:
# docker compose up                    # No watch
# docker compose --profile watch up    # With watch
```

### Pattern 3: Health Checks with Dependency Validation
**What:** Health endpoint checks both application readiness and critical dependencies
**When to use:** All services with database or external service dependencies
**Example:**
```typescript
// Source: Express.js official docs + community patterns
// https://expressjs.com/en/advanced/healthcheck-graceful-shutdown.html
app.get("/health", async (req, res) => {
  const checks = {
    status: "ok",
    service: "linear-integration",
    timestamp: Date.now(),
    uptime: process.uptime(),
  };

  // Check database connectivity
  try {
    await db.execute(sql`SELECT 1`);
    checks.database = "healthy";
  } catch (err) {
    checks.database = "unhealthy";
    checks.status = "degraded";
    logger.error({ err }, "Database health check failed");
    return res.status(503).json(checks);
  }

  res.status(200).json(checks);
});
```

### Pattern 4: Graceful Shutdown with Temporal Workers
**What:** Multi-step shutdown ensuring workers complete in-flight tasks
**When to use:** Services running Temporal workers (dev-agent, product-agent)
**Example:**
```typescript
// Source: https://docs.temporal.io/encyclopedia/workers/worker-shutdown
// Temporal worker graceful shutdown pattern
const shutdown = async (signal: string): Promise<void> => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info({ signal }, "Shutdown initiated");

  // 1. Stop accepting new requests (HTTP server)
  server.close(() => {
    logger.info("HTTP server closed");
  });

  // 2. Shutdown Temporal worker (completes in-flight tasks)
  // Worker.shutdown() waits for current workflow tasks
  // Activities get full grace period to complete
  worker.shutdown();

  // 3. Cleanup resources
  await sandbox.cleanup();
  await webhookIdempotency.close();
  await executionTracker.close();
  await sql.end();

  logger.info("Graceful shutdown complete");
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
```

### Pattern 5: Service Startup Dependencies
**What:** Use depends_on with service_healthy condition for correct ordering
**When to use:** Services requiring database or Temporal to be ready
**Example:**
```yaml
# Source: https://docs.docker.com/compose/how-tos/startup-order/
services:
  postgresql:
    image: postgres:15-alpine
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "temporal"]
      interval: 5s
      timeout: 5s
      retries: 5

  linear-integration:
    build: ./packages/integrations/linear
    depends_on:
      postgresql:
        condition: service_healthy  # Wait for DB ready, not just started
        restart: true               # Restart if DB restarts
```

### Anti-Patterns to Avoid
- **Running Node.js as PID 1 without init**: Containers ignore SIGTERM, require SIGKILL after 10s timeout. Use Docker's `--init` flag or explicit tini entrypoint.
- **Using npm/yarn start in CMD**: npm doesn't forward signals to Node.js process. Use `CMD ["node", "dist/main.js"]` directly.
- **Health checks without database validation**: Just returning `{ status: "ok" }` doesn't verify dependencies. Check database connectivity.
- **Syncing node_modules in watch mode**: Causes platform compatibility issues and performance degradation. Use `rebuild` action for package.json changes.
- **depends_on: service_started for databases**: Container starts before PostgreSQL accepts connections. Use `service_healthy` with healthcheck.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Hot reload in Docker | Custom file watcher + volume sync | Docker Compose watch | Native, no volume performance issues, handles rebuilds |
| Init process for signals | Custom signal forwarder | Docker --init flag (tini) | Solves PID 1, reaps zombies, battle-tested |
| Health check library | Custom health framework | Express route + async checks | Simple, no extra deps, works with existing routes |
| Startup ordering | Sleep/retry loops | depends_on with service_healthy | Declarative, native to Compose, respects health |
| Graceful shutdown timeout | Custom timer logic | Temporal SDK graceful_shutdown_period | Handles worker-specific semantics, prevents task loss |

**Key insight:** Docker Compose v2.22.0+ provides native solutions for most development workflow problems. Custom solutions (volume-based hot reload, wait-for scripts, manual health polling) were necessary before watch mode and depends_on conditions existed, but are now anti-patterns.

## Common Pitfalls

### Pitfall 1: PID 1 Signal Handling
**What goes wrong:** Node.js process running as PID 1 in container doesn't receive SIGTERM signals. Docker waits 10 seconds then sends SIGKILL, preventing graceful shutdown.
**Why it happens:** Linux treats PID 1 specially—it ignores signals with default handlers. Node.js isn't designed to run as PID 1.
**How to avoid:** Use Docker's built-in `--init` flag or add tini as entrypoint in Dockerfile. This makes tini PID 1 and Node.js PID 2, enabling signal propagation.
**Warning signs:** Containers take full 10 seconds to stop, logs show no shutdown messages, "Forced shutdown after timeout" errors.

### Pitfall 2: npm/yarn Blocking Signal Forwarding
**What goes wrong:** Using `CMD ["npm", "start"]` prevents SIGTERM from reaching Node.js. npm receives signal but doesn't wait for Node.js to finish.
**Why it happens:** npm forwards signals but exits immediately, orphaning the Node.js process.
**How to avoid:** Use `CMD ["node", "dist/main.js"]` directly in Dockerfile. Avoid script wrappers for production entrypoints.
**Warning signs:** Process exits before shutdown handlers run, connections left open, database transactions incomplete.

### Pitfall 3: Temporal Worker Shutdown Timing
**What goes wrong:** Forcing worker shutdown before in-flight tasks complete causes workflow task failures and activity retries.
**Why it happens:** Temporal workers may have long-running activities. Shutdown before completion triggers timeouts.
**How to avoid:** Use Temporal SDK's `worker.shutdown()` method which waits for current tasks. Set grace period >= longest expected activity duration.
**Warning signs:** Activity retry storms after deployment, "Activity timed out" errors, duplicate work execution.

### Pitfall 4: Health Check Without Dependency Validation
**What goes wrong:** Service reports healthy but can't serve requests because database is unreachable. Load balancer routes traffic to degraded instance.
**Why it happens:** Health check only validates process liveness, not actual readiness to serve requests.
**How to avoid:** Include database connectivity check in health endpoint. Return 503 on dependency failures.
**Warning signs:** 500 errors after deployment, "connection refused" in logs while health checks pass.

### Pitfall 5: Watch Mode Syncing node_modules
**What goes wrong:** Syncing node_modules from host to container causes platform compatibility issues (native bindings) and massive performance degradation.
**Why it happens:** node_modules contains platform-specific binaries. Syncing macOS binaries to Linux container fails.
**How to avoid:** Always exclude node_modules from sync rules. Use `rebuild` action for package.json changes.
**Warning signs:** "MODULE_NOT_FOUND" errors, extremely slow sync (thousands of files), container crashes on startup.

### Pitfall 6: service_started Instead of service_healthy
**What goes wrong:** Dependent service starts before database accepts connections. Connection errors on startup, restart loops.
**Why it happens:** PostgreSQL container is "running" but still initializing internal services. Takes 5-10 seconds to be ready.
**How to avoid:** Use `depends_on: { condition: service_healthy }` with appropriate healthcheck configuration.
**Warning signs:** "Connection refused" errors during startup, services retry connecting in loops.

## Code Examples

Verified patterns from official sources:

### Complete Docker Compose Configuration
```yaml
# Source: https://docs.docker.com/compose/how-tos/file-watch/
# Source: https://docs.docker.com/compose/how-tos/profiles/
services:
  postgresql:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: temporal
      POSTGRES_PASSWORD: temporal
      POSTGRES_DB: temporal
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "temporal"]
      interval: 5s
      timeout: 5s
      retries: 5
      start_period: 10s

  temporal:
    image: temporalio/auto-setup:1.24.2
    depends_on:
      postgresql:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "tctl", "--address", "127.0.0.1:7233", "cluster", "health"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 60s

  linear-integration:
    build: ./packages/integrations/linear
    ports:
      - "3001:3001"
    depends_on:
      postgresql:
        condition: service_healthy
        restart: true
    environment:
      DATABASE_URL: postgresql://temporal:temporal@postgresql:5432/temporal
    healthcheck:
      test: ["CMD-SHELL", "node -e \"require('http').get('http://localhost:3001/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))\""]
      interval: 10s
      timeout: 3s
      retries: 3
      start_period: 30s
    develop:
      watch:
        - action: sync
          path: ./packages/integrations/linear/src
          target: /app/packages/integrations/linear/src
          ignore:
            - node_modules/
        - action: rebuild
          path: ./packages/integrations/linear/package.json

  dev-agent:
    build: .
    depends_on:
      postgresql:
        condition: service_healthy
      temporal:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://temporal:temporal@postgresql:5432/temporal
      TEMPORAL_ADDRESS: temporal:7233
    develop:
      watch:
        - action: sync
          path: ./packages/agents/src
          target: /app/packages/agents/src
          ignore:
            - node_modules/
        - action: rebuild
          path: ./package.json
```

### Dockerfile with tini Init Process
```dockerfile
# Source: https://github.com/krallin/tini
FROM node:20-slim AS runtime

WORKDIR /app

# Install tini for proper signal handling
RUN apt-get update && apt-get install -y tini && rm -rf /var/lib/apt/lists/*

# Copy built artifacts
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules

# Non-root user
RUN groupadd -g 1001 aesir && useradd -u 1001 -g aesir aesir
USER aesir

# tini as PID 1, node as PID 2
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
```

### Express Health Endpoint with Database Check
```typescript
// Source: https://expressjs.com/en/advanced/healthcheck-graceful-shutdown.html
// Source: Community patterns from LogRocket, Medium articles
import type { Request, Response } from "express";
import { sql } from "drizzle-orm";

interface HealthCheck {
  status: "ok" | "degraded" | "unhealthy";
  service: string;
  timestamp: number;
  uptime: number;
  database?: "healthy" | "unhealthy";
  error?: string;
}

app.get("/health", async (_req: Request, res: Response<HealthCheck>) => {
  const health: HealthCheck = {
    status: "ok",
    service: "linear-integration",
    timestamp: Date.now(),
    uptime: process.uptime(),
  };

  // Validate database connectivity
  try {
    await db.execute(sql`SELECT 1`);
    health.database = "healthy";
  } catch (err) {
    health.status = "degraded";
    health.database = "unhealthy";
    health.error = err instanceof Error ? err.message : "Database connection failed";
    logger.error({ err }, "Health check: database unhealthy");
    return res.status(503).json(health);
  }

  res.status(200).json(health);
});
```

### Graceful Shutdown Handler
```typescript
// Source: https://expressjs.com/en/advanced/healthcheck-graceful-shutdown.html
// Source: https://docs.temporal.io/encyclopedia/workers/worker-shutdown
import type { Server } from "http";

let isShuttingDown = false;

const shutdown = async (signal: string) => {
  if (isShuttingDown) {
    logger.warn({ signal }, "Shutdown already in progress");
    return;
  }
  isShuttingDown = true;

  logger.info({ signal }, "Graceful shutdown initiated");

  // 1. Stop accepting new connections
  server.close(() => {
    logger.info("HTTP server stopped accepting connections");
  });

  // 2. Shutdown Temporal worker (if present)
  // Workers complete in-flight tasks during grace period
  if (worker) {
    logger.info("Shutting down Temporal worker");
    worker.shutdown(); // Waits for current workflow tasks
  }

  // 3. Close database connections
  try {
    await sql.end({ timeout: 5 });
    logger.info("Database connections closed");
  } catch (err) {
    logger.error({ err }, "Error closing database connections");
  }

  // 4. Cleanup resources
  if (sandbox) {
    await sandbox.cleanup();
  }

  logger.info("Graceful shutdown complete");
  process.exit(0);
};

// Register signal handlers
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Force shutdown after timeout
setTimeout(() => {
  if (isShuttingDown) {
    logger.error("Forced shutdown after grace period");
    process.exit(1);
  }
}, 30_000); // 30 second grace period
```

### Docker Compose Watch Actions Reference
```yaml
# Source: https://docs.docker.com/reference/compose-file/develop/
services:
  app:
    build: .
    develop:
      watch:
        # sync: Fast file updates without rebuild (TypeScript source)
        - action: sync
          path: ./src
          target: /app/src
          ignore:
            - node_modules/
            - "**/*.test.ts"
            - "*.md"

        # rebuild: Full image rebuild (dependency changes)
        - action: rebuild
          path: ./package.json

        # sync+restart: Sync files then restart container (config changes)
        - action: sync+restart
          path: ./config
          target: /app/config
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| nodemon + volumes | Docker Compose watch | Docker Compose 2.22.0 (2023) | Native solution, no volume performance issues on Mac/Windows |
| wait-for-it scripts | depends_on: service_healthy | Docker Compose 2.17.0 (2022) | Declarative, built into Compose spec |
| Custom signal handling | --init flag (tini) | Docker 1.13+ (2017) | Standard solution, no custom code needed |
| Separate docker-compose.dev.yml | Profiles | Docker Compose 1.28.0 (2021) | Single file with conditional services |
| Manual health scripts | Healthcheck instruction | Docker 1.12+ (2016) | Orchestrator integration, automatic monitoring |

**Deprecated/outdated:**
- **wait-for-it.sh / dockerize**: Shell scripts for waiting on services. Use `depends_on: { condition: service_healthy }` instead.
- **docker-compose override files for dev**: Use profiles to conditionally enable services like watch mode.
- **Volume-based hot reload with nodemon**: Performance issues on macOS/Windows. Use Docker Compose watch which syncs files without volume overhead.
- **version field in docker-compose.yml**: Obsolete as of Compose v1.27.0. Docker automatically detects schema version.

## Open Questions

Things that couldn't be fully resolved:

1. **TypeScript compilation in watch mode**
   - What we know: Docker Compose watch can sync source files and trigger rebuilds on package.json changes
   - What's unclear: Whether in-container TypeScript compilation (tsx watch) works efficiently with sync mode, or if rebuild is always needed
   - Recommendation: Test sync mode with tsx watch for fast iteration vs rebuild mode with tsc compilation. Likely sync + in-container tsx watch will be faster.

2. **Temporal worker graceful shutdown grace period**
   - What we know: Temporal SDK supports graceful shutdown, workers complete in-flight tasks
   - What's unclear: Optimal grace period for Aesir's activities (code generation, PR creation)
   - Recommendation: Start with 30 seconds (Docker default is 10s), monitor activity durations in production, adjust based on p95 latency. Longest activities should complete within grace period.

3. **Health check for Temporal worker readiness**
   - What we know: Temporal server has health endpoint, workers connect to server
   - What's unclear: How to verify worker is registered with task queue and ready to poll
   - Recommendation: HTTP health endpoint on agent can call Temporal client to describe task queue and verify worker registration. LOW confidence - may need investigation.

## Sources

### Primary (HIGH confidence)
- [Docker Compose watch documentation](https://docs.docker.com/compose/how-tos/file-watch/) - Watch configuration, action types, best practices
- [Docker Compose develop specification](https://docs.docker.com/reference/compose-file/develop/) - Formal spec for watch syntax
- [Docker Compose profiles](https://docs.docker.com/compose/how-tos/profiles/) - Profile-based conditional services
- [Docker Compose startup order](https://docs.docker.com/compose/how-tos/startup-order/) - depends_on conditions, service_healthy
- [Express.js health checks and graceful shutdown](https://expressjs.com/en/advanced/healthcheck-graceful-shutdown.html) - Official Express patterns
- [Temporal worker shutdown behavior](https://docs.temporal.io/encyclopedia/workers/worker-shutdown) - Graceful shutdown semantics

### Secondary (MEDIUM confidence)
- [Docker Compose Watch GA announcement](https://www.docker.com/blog/announcing-docker-compose-watch-ga-release/) - Feature overview, use cases
- [OneUpTime: Hot reloading in Docker (2026)](https://oneuptime.com/blog/post/2026-01-06-docker-hot-reloading/view) - Recent practices for 2026
- [Node.js best practices: Graceful shutdown](https://github.com/goldbergyoni/nodebestpractices/blob/master/sections/docker/graceful-shutdown.md) - Community best practices
- [LogRocket: Health check implementation](https://blog.logrocket.com/how-to-implement-a-health-check-in-node-js/) - Express health check patterns
- [RisingStack: Graceful shutdown with Kubernetes](https://blog.risingstack.com/graceful-shutdown-node-js-kubernetes/) - Node.js shutdown patterns

### Tertiary (LOW confidence)
- [Medium: Temporal worker optimization](https://medium.com/@mailman966/how-to-optimize-a-temporal-worker-using-the-typescript-sdk-7a84bdc990ab) - Worker shutdown patterns
- [Medium: PID 1 and tini](https://dev-aditya.medium.com/pid-1-and-tini-in-docker-why-your-container-ignores-ctrl-c-800b565cb76e) - Signal handling explanation
- [Medium: Docker tini for NestJS (2026)](https://medium.com/@salimian/stopping-docker-containers-safely-how-dumb-init-saved-my-nestjsworker-88529b5a9f13) - Recent confirmation tini patterns remain current

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Docker Compose watch is official, well-documented feature in current Docker releases
- Architecture: HIGH - Patterns verified from official Docker documentation and Express.js docs
- Pitfalls: HIGH - Common issues documented in Node.js best practices repos and official Docker troubleshooting

**Research date:** 2026-01-23
**Valid until:** 2026-02-23 (30 days - Docker Compose is stable, patterns unlikely to change)
