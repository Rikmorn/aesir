# Phase 44: Single Service Consolidation - Research

**Researched:** 2026-02-03
**Domain:** Service consolidation, Express HTTP, worker loop integration, graceful shutdown, Docker Compose
**Confidence:** HIGH

## Summary

Phase 44 replaces 6 Docker services (dev-agent, dev-agent-worker, product-agent, router, temporal, temporal-ui) with a single `agent-service` that wires together all framework components from Phases 37-43. The research confirms this is a straightforward integration task -- all the hard components (ConversationExecutor, WorkerLoop, EventRouter, TimeoutScheduler, EventLog, SessionProjection, AgentRegistry, ToolRegistry) already exist with clean factory interfaces and well-defined dependency injection. The new `main.ts` is essentially a bootstrap function that creates instances in the right order and wires them together.

Express 4.22.1 is already a dependency in the agents package. The DB client module (`shared/db/client.ts`) exports a singleton `db` and `closeDatabase()`, plus a `Pool` from `pg` that needs to be exposed for pg-boss sharing. The worker loop already handles its own polling, concurrency limiting, heartbeat, and graceful drain via `close()`. The ConversationExecutor wraps the worker loop with `startWorker()`/`stopWorker()` methods.

**Primary recommendation:** Build a single `main.ts` entry point that follows the bootstrap sequence from CONTEXT.md, using Express for HTTP and the existing framework factories for everything else. Keep the pg Pool explicit (not the singleton module) so it can be shared with pg-boss.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| express | 4.22.1 | HTTP framework | Already in package.json, decision locked |
| pg | 8.17.2 | PostgreSQL connection pool | Already in package.json, needed by Drizzle + pg-boss |
| drizzle-orm | 0.45.1 | Database ORM | Already in package.json, used by all framework modules |
| pg-boss | 12.8.0 | Timeout scheduling | Already in package.json, used by TimeoutScheduler |
| pino | (via @aesir/platform) | Logging | Project standard |
| zod | 3.25.67 | Schema validation | Project standard |
| dotenv-flow | 4.1.0 | Environment loading | Project standard |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @types/express | 4.17.21 | TypeScript types | Already in devDependencies |
| tini | (Dockerfile) | PID 1 signal handling | Docker container entrypoint |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Express | Raw createServer | Current code uses createServer; Express simplifies routing/middleware/error-handling for 4 routes (locked decision) |
| Module-level db singleton | Explicit Pool creation | Explicit pool is needed to share with pg-boss; singleton module pattern won't work |

**Installation:** No new dependencies needed. All packages already present.

## Architecture Patterns

### New Entry Point Location
```
packages/agents/src/
  service/
    main.ts           # New unified service entry point
```

The new `main.ts` replaces three existing entry points:
- `dev-agent/main.ts` (port 3004, raw createServer, Temporal client)
- `product-agent/main.ts` (port 3005, raw createServer, Temporal client + worker)
- `router/main.ts` (port 3006, raw createServer, Temporal client)

### Pattern 1: Explicit Dependency Wiring (Bootstrap)

**What:** Create all framework components in dependency order, inject into each other via factory options objects. No global singletons.

**When to use:** Service bootstrap. The bootstrap sequence from CONTEXT.md is:

```
env validation
  -> Pool (pg)
  -> Drizzle db (from pool)
  -> AgentRegistry (from definitionsDir, logger)
  -> ToolRegistry + registerAllTools()
  -> EventLog (from db, logger)
  -> SessionProjection (from db, logger, eventLog, artifactConfig)
  -> TimeoutScheduler (from pool, logger)
  -> ConversationExecutor (from db, eventLog, sessionProjection, agentRegistry, toolRegistry, logger, timeoutScheduler, pollIntervalMs, concurrencyLimit)
  -> EventRouter (from agentRegistry, logger) + loadStartRules()
  -> Express app (routes using executor, eventRouter, routeEvent)
  -> server.listen()
  -> executor.startWorker()
  -> register shutdown handlers
```

**Key insight:** The DB Pool must be created explicitly (not via the singleton `shared/db/client.ts` module) because:
1. The TimeoutScheduler's `createPgBossAdapter` needs the raw `Pool` instance
2. The Pool needs to be closed explicitly during shutdown
3. The singleton pattern hides the lifecycle

**Example:**
```typescript
// Source: Existing codebase patterns
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../shared/db/schema.js";

const pool = new Pool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

const db = drizzle(pool, { schema });
```

### Pattern 2: Express with Inline Routes

**What:** Express app with 4 routes defined inline in the bootstrap function, using express.json() middleware.

**When to use:** This service has exactly 4 endpoints. No need for a router file or controllers.

**Example:**
```typescript
// Source: Express official patterns + CONTEXT.md decision
import express from "express";

const app = express();
app.use(express.json({ limit: "1mb" }));

// Liveness check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "agent-service" });
});

// Unified events endpoint (replaces router:3006/events)
app.post("/events", async (req, res) => {
  try {
    const parsed = NormalizedEventSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
    }
    const result = await routeEvent(parsed.data, routeEventDeps);
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Unhandled error in /events");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Management endpoints
app.get("/conversations/:id", async (req, res) => { ... });
app.post("/conversations/:id/cancel", async (req, res) => { ... });
```

### Pattern 3: Graceful Shutdown with Resource Ordering

**What:** Shutdown in reverse bootstrap order: stop HTTP -> drain worker -> flush event log -> stop pg-boss -> close DB pool.

**When to use:** SIGTERM/SIGINT handling.

**Critical detail:** The worker loop's `drain()` method already waits for running conversations to finish. The `close()` method calls `drain()` then flushes the event log. The executor's `stopWorker()` calls `workerLoop.close()` and `timeoutScheduler.close()`. So calling `executor.stopWorker()` handles most of the shutdown sequence.

**Example:**
```typescript
// Source: Existing codebase patterns + Express best practices
let isShuttingDown = false;

const shutdown = async (signal: string): Promise<void> => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info({ signal }, "Graceful shutdown initiated");

  // 1. Stop accepting HTTP connections
  server.close();

  // 2. Stop worker + drain running conversations + flush event log + stop pg-boss
  await executor.stopWorker();

  // 3. Final event log flush (belt + suspenders)
  await eventLog.close();

  // 4. Close session projection subscriptions
  sessionProjection.close();

  // 5. Close database pool
  await pool.end();

  logger.info("Graceful shutdown complete");
  process.exit(0);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// Force exit after grace period
const forceTimeout = setTimeout(() => {
  if (isShuttingDown) {
    logger.error("Forced shutdown after timeout");
    process.exit(1);
  }
}, FORCE_SHUTDOWN_TIMEOUT_MS);
forceTimeout.unref();
```

### Pattern 4: Env Validation Update

**What:** Extend the existing Zod env schema to add new vars and remove Temporal vars.

**Current env schema** (`shared/env/config.ts`) validates TEMPORAL_ADDRESS and TEMPORAL_NAMESPACE as required. These need to be removed and new vars added.

**New vars to add:**
- `MAX_CONCURRENT_CONVERSATIONS` (number, default 5)
- `WORKER_POLL_INTERVAL_MS` (number, default 5000)
- `FORCE_SHUTDOWN_TIMEOUT_MS` (number, default 30000)
- `AGENT_SERVICE_PORT` (number, default 3004)

**Vars to remove:**
- `TEMPORAL_ADDRESS`
- `TEMPORAL_NAMESPACE`

### Anti-Patterns to Avoid
- **Don't import from `shared/db/client.ts`:** The module-level singleton creates the pool on import, before bootstrap can control it. Create Pool explicitly.
- **Don't add request logging middleware:** The existing pattern logs in the handler. Express request logging middleware (like morgan) adds unnecessary complexity for 4 routes. A simple `logger.info()` in each handler is sufficient.
- **Don't separate routes into files:** Only 4 routes. CONTEXT.md explicitly says "not worth modularizing."
- **Don't use Express Router():** For 4 routes in one file, `app.get/post` is cleaner than creating a Router.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Worker polling loop | Custom setInterval + Promise pool | `createWorkerLoop()` from framework | Already handles SKIP LOCKED, heartbeat, stale recovery, abort signals, drain semantics |
| Event routing | if/else chain on event types | `routeEvent()` from `router/router.ts` | Already handles adapter pipeline -> EventRouter -> executor dispatch |
| Timeout scheduling | setTimeout + DB writes | `createTimeoutScheduler()` from framework | Already handles pg-boss lifecycle, duration parsing, job management |
| Tool registration | Manual factory map | `registerAllTools()` from `tool-factories.ts` | Registers all 28 tools with proper adapters |
| Conversation management | Custom CRUD | `createConversationExecutor()` | Already handles idempotent start, signal dedup, cancel, re-trigger |
| History compaction | Manual message trimming | `createHistoryManager()` used internally by worker loop | Already handles pruning, summarization, protected messages |

**Key insight:** Phase 44 should create zero new framework logic. It is pure wiring: creating instances and connecting them. If you find yourself writing business logic in main.ts, something is wrong.

## Common Pitfalls

### Pitfall 1: DB Pool Singleton vs Explicit Pool
**What goes wrong:** Importing `db` from `shared/db/client.ts` creates a module-level Pool that can't be shared with pg-boss's `createPgBossAdapter()`.
**Why it happens:** The singleton module was designed for per-service use, not for the unified service that needs Pool sharing.
**How to avoid:** Create Pool explicitly in bootstrap, pass to both `drizzle()` and `createPgBossAdapter()`. Do NOT import from `shared/db/client.ts`.
**Warning signs:** TypeError at pg-boss initialization, or two separate connection pools eating double the connections.

### Pitfall 2: Missing Definitions Directory in Docker
**What goes wrong:** AgentRegistry can't find agent definitions in Docker container because `definitions/` wasn't copied.
**Why it happens:** Current Dockerfile copies `packages/agents/` source and builds, but `pnpm deploy --prod` should include `definitions/` since there's no `files` field in package.json. However, the `definitions/` directory lives at `packages/agents/definitions/`, not in `src/`. Need to verify `pnpm deploy` includes it.
**How to avoid:** Test the Docker build and verify definitions are present. If not, add explicit COPY in Dockerfile.
**Warning signs:** "Agent definition not found" errors on first event routing.

### Pitfall 3: Force Shutdown Timeout vs Docker stop_grace_period
**What goes wrong:** Docker sends SIGKILL before the Node.js force timeout fires, or the force timeout fires before conversations can drain.
**Why it happens:** Mismatch between `FORCE_SHUTDOWN_TIMEOUT_MS` in code and `stop_grace_period` in docker-compose.yml.
**How to avoid:** Set `stop_grace_period` in docker-compose.yml to be slightly longer than `FORCE_SHUTDOWN_TIMEOUT_MS`. Recommendation: code timeout = 30s, Docker grace = 35s.
**Warning signs:** Container killed with SIGKILL before cleanup completes.

### Pitfall 4: Integration Services Still Pointing to router:3006
**What goes wrong:** Integration services (Linear, GitHub, Slack) still dispatch events to `http://router:3006/events` instead of `http://agent-service:3004/events`.
**Why it happens:** ROUTER_URL env var in integration service Docker Compose configs still points to old router.
**How to avoid:** Update ALL three integration services' ROUTER_URL env var in docker-compose.yml.
**Warning signs:** Integration services fail to dispatch events (connection refused on router:3006).

### Pitfall 5: EventRouter.loadStartRules() Must Be Called Before Handling Events
**What goes wrong:** All events fall through to slow_path because start rules are empty.
**Why it happens:** `loadStartRules()` is async and must be awaited before the EventRouter can match triggers.
**How to avoid:** Call `await eventRouter.loadStartRules()` during bootstrap, BEFORE starting the HTTP server.
**Warning signs:** Events that should be fast-path start rules are going to slow_path.

### Pitfall 6: Nginx Config Still References Removed Services
**What goes wrong:** Nginx fails to start because upstreams `router`, `dev-agent`, `product-agent` don't exist.
**Why it happens:** nginx.conf still defines upstreams for removed services.
**How to avoid:** Update nginx.conf to replace the 3 upstream blocks with a single `agent-service` upstream. Update location blocks to route to the new service.
**Warning signs:** nginx container fails health check, won't start.

### Pitfall 7: Worker Loop Starts Before All Components Are Ready
**What goes wrong:** Worker loop claims a conversation but EventLog or SessionProjection aren't initialized yet.
**Why it happens:** `executor.startWorker()` is called before all async initialization completes.
**How to avoid:** Start the worker loop AFTER the HTTP server is listening, EventRouter rules are loaded, and all components are initialized. The bootstrap sequence from CONTEXT.md has the correct order.
**Warning signs:** Null pointer errors on first claimed conversation.

## Code Examples

### Bootstrap Sequence (Core Pattern)

```typescript
// Source: Synthesized from existing factory patterns in framework/
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import express from "express";
import { createPinoLogger } from "@aesir/platform";
import { NormalizedEventSchema } from "@aesir/types";
import * as schema from "../shared/db/schema.js";
import {
  createAgentRegistry,
  createToolRegistry,
  registerAllTools,
  createEventLog,
  createSessionProjection,
  createTimeoutScheduler,
  createPgBossAdapter,
  createConversationExecutor,
  createEventRouter,
} from "../framework/index.js";
import { routeEvent } from "../router/router.js";

async function bootstrap(): Promise<void> {
  // 1. Env validation (import triggers Zod validation)
  const { env } = await import("../shared/env/config.js");

  const logger = createPinoLogger({ component: "agent-service" });

  // 2. Database
  const pool = new Pool({
    host: env.DB_HOST, port: env.DB_PORT,
    user: env.DB_USER, password: env.DB_PASSWORD,
    database: env.DB_NAME, max: 20,
  });
  const db = drizzle(pool, { schema });

  // 3. Registries
  const agentRegistry = createAgentRegistry({
    definitionsDir: join(__dirname, "../../definitions"), // Adjust for dist
    logger,
  });
  const toolRegistry = createToolRegistry({ logger });
  registerAllTools({ registry: toolRegistry, agentRegistry, logger });

  // 4. Event infrastructure
  const eventLog = createEventLog({ db, logger });
  const sessionProjection = createSessionProjection({
    db, logger, eventLog,
    artifactConfig: new Map(/* ... from tool registry */),
  });

  // 5. Timeout scheduler
  const timeoutScheduler = createTimeoutScheduler({ pool, logger });

  // 6. Executor (includes worker loop)
  const executor = createConversationExecutor({
    db, eventLog, sessionProjection, agentRegistry, toolRegistry, logger,
    timeoutScheduler,
    pollIntervalMs: env.WORKER_POLL_INTERVAL_MS,
    concurrencyLimit: env.MAX_CONCURRENT_CONVERSATIONS,
  });

  // 7. Event router
  const eventRouter = createEventRouter({ agentRegistry, logger });
  await eventRouter.loadStartRules();

  // 8. Express app
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "agent-service" });
  });

  app.post("/events", async (req, res) => {
    // routeEvent handles adapter pipeline -> EventRouter -> executor
    const parsed = NormalizedEventSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed" });
      return;
    }
    const result = await routeEvent(parsed.data, {
      executor, eventRouter, logger,
      alertsChannel: env.ROUTER_ALERTS_CHANNEL,
      linearTeamId: env.LINEAR_TEAM_ID,
    });
    res.json(result);
  });

  // 9. Start
  const server = app.listen(env.AGENT_SERVICE_PORT, () => {
    logger.info({ port: env.AGENT_SERVICE_PORT }, "Agent service listening");
  });

  executor.startWorker();

  // 10. Shutdown handlers (see Pattern 3 above)
}
```

### Docker Compose Service Definition

```yaml
# Source: Derived from existing docker-compose.yml patterns
agent-service:
  build:
    context: .
    dockerfile: Dockerfile
  container_name: aesir-agent-service
  user: root  # Docker socket access for DevContainerManager
  depends_on:
    postgresql:
      condition: service_healthy
    linear-integration:
      condition: service_healthy
    github-integration:
      condition: service_healthy
    slack-integration:
      condition: service_healthy
  environment:
    # Database
    - DB_HOST=postgresql
    - DB_PORT=5432
    - DB_USER=temporal
    - DB_PASSWORD=temporal
    - DB_NAME=temporal
    - CREDENTIAL_ENCRYPTION_KEY=${CREDENTIAL_ENCRYPTION_KEY}
    # LLM
    - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
    # Workspace config
    - LINEAR_TEAM_ID=${LINEAR_TEAM_ID}
    - GITHUB_REPO=${GITHUB_REPO}
    - GITHUB_OWNER=${GITHUB_OWNER}
    - GITHUB_REPO_URL=${GITHUB_REPO_URL}
    - GITHUB_TOKEN=${GITHUB_TOKEN}
    - GITHUB_BASE_BRANCH=${GITHUB_BASE_BRANCH:-main}
    - SLACK_CHANNEL_ID=${SLACK_CHANNEL_ID}
    - DEV_AGENT_SLACK_CHANNEL=${DEV_AGENT_SLACK_CHANNEL}
    - PRODUCT_AGENT_ALLOWED_CHANNELS=${PRODUCT_AGENT_ALLOWED_CHANNELS:-}
    # MCP URLs
    - LINEAR_MCP_URL=http://linear-integration:3001
    - GITHUB_MCP_URL=http://github-integration:3002
    - SLACK_MCP_URL=http://slack-integration:3003
    # Service config
    - AGENT_SERVICE_PORT=3004
    - MAX_CONCURRENT_CONVERSATIONS=${MAX_CONCURRENT_CONVERSATIONS:-5}
    - WORKER_POLL_INTERVAL_MS=${WORKER_POLL_INTERVAL_MS:-5000}
    - FORCE_SHUTDOWN_TIMEOUT_MS=${FORCE_SHUTDOWN_TIMEOUT_MS:-30000}
    # Alerts
    - ROUTER_ALERTS_CHANNEL=${ROUTER_ALERTS_CHANNEL:-}
    # Observability
    - NODE_ENV=${NODE_ENV:-production}
    - LANGSMITH_TRACING=${LANGSMITH_TRACING:-false}
    - LANGSMITH_API_KEY=${LANGSMITH_API_KEY:-}
    - LANGSMITH_PROJECT=${LANGSMITH_PROJECT:-aesir-agents}
  ports:
    - "3004:3004"
  volumes:
    - /var/run/docker.sock:/var/run/docker.sock
    - ${HOME}/.docker/run/docker.sock:/var/run/docker.sock:ro
  command: ["node", "dist/service/main.js"]
  stop_grace_period: 35s
  healthcheck:
    test: ["CMD-SHELL", "node -e \"require('http').get('http://localhost:3004/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))\""]
    interval: 10s
    timeout: 5s
    retries: 3
    start_period: 30s
  networks:
    - aesir-network
  restart: unless-stopped
  develop:
    watch:
      - action: rebuild
        path: ./packages/agents/src
      - action: rebuild
        path: ./packages/agents/package.json
      - action: rebuild
        path: ./packages/agents/definitions
      - action: rebuild
        path: ./packages/types/src
      - action: rebuild
        path: ./packages/platform/src
```

### Updated Integration Service ROUTER_URL

```yaml
# Source: Existing docker-compose.yml pattern
linear-integration:
  environment:
    - ROUTER_URL=http://agent-service:3004/events  # Was: http://router:3006/events

github-integration:
  environment:
    - ROUTER_URL=http://agent-service:3004/events  # Was: http://router:3006/events

slack-integration:
  environment:
    - ROUTER_URL=http://agent-service:3004/events  # Was: http://router:3006/events
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| 3 separate HTTP services + Temporal | Single service with embedded worker loop | Phase 44 (this phase) | 6 fewer containers, no Temporal dependency |
| Raw node:http createServer | Express 4.x | Phase 44 (locked decision) | Simpler routing, JSON parsing middleware |
| Temporal workflows for orchestration | ConversationExecutor + SKIP LOCKED | Phases 37-43 | PostgreSQL-only, no external coordinator |
| Per-agent event handlers | adapter -> EventRouter -> executor pipeline | Phase 42-43 | Single unified event path |
| Module-level DB singleton | Explicit Pool in bootstrap | Phase 44 (this phase) | Pool sharing with pg-boss |

**Deprecated/outdated after Phase 44:**
- `dev-agent/main.ts` -- replaced by `service/main.ts`
- `product-agent/main.ts` -- replaced by `service/main.ts`
- `router/main.ts` -- replaced by `service/main.ts`
- `dev-agent/worker.ts` -- worker loop integrated into executor
- `routeEventLegacy()` in `router/router.ts` -- replaced by `routeEvent()` with executor deps
- All Temporal imports in agents package -- no longer needed at runtime
- `shared/db/client.ts` singleton pattern -- not used by new service (still exists for potential test use)

## Open Questions

Things that couldn't be fully resolved:

1. **Definitions directory path in Docker**
   - What we know: `pnpm deploy` copies everything when no `files` field exists in package.json. The `definitions/` directory is at `packages/agents/definitions/` (same level as `src/`).
   - What's unclear: After `pnpm deploy --prod /deploy`, the deploy directory structure may not preserve the relative path. Need to verify `definitions/` exists at `/app/definitions/` in the container.
   - Recommendation: Test Docker build. If `definitions/` is missing, add explicit `COPY --from=builder /app/packages/agents/definitions ./definitions` to Dockerfile. The `definitionsDir` path in bootstrap should use `path.resolve(__dirname, "../../definitions")` (from `dist/service/main.js`, the definitions dir would be 2 levels up).

2. **Artifact extraction config for SessionProjection**
   - What we know: SessionProjection needs an `ArtifactExtractionConfig` (Map of tool name -> extractor). The ToolRegistry registers tools but doesn't expose artifact config.
   - What's unclear: Where is this config currently defined? It may need to be extracted from the tool-factories module or hardcoded.
   - Recommendation: Check how the worker loop's `executeConversation` creates SessionProjection's artifact config. May need to define a `getArtifactConfig()` helper.

3. **Express async error handling**
   - What we know: Express 4.x does NOT catch async errors in route handlers automatically. `express@5` does, but the project uses Express 4.
   - What's unclear: Whether to use a wrapper like `asyncHandler(fn)` or just try/catch in each handler.
   - Recommendation: Use explicit try/catch in each route handler (only 4 routes). This matches the existing pattern in dev-agent/main.ts and avoids adding another dependency. Add a catch-all error middleware as belt-and-suspenders.

4. **Slow-path routing in the new service**
   - What we know: `routeEvent()` calls `routeViaAgentLoopV2()` for slow-path events, which needs an `ANTHROPIC_API_KEY` for LLM routing. The current `routeViaAgentLoopV2` uses `callMcpTool` for Slack alerts.
   - What's unclear: The slow-path code in `router/slow-path.ts` may import Temporal types that would need to be available.
   - Recommendation: Verify `routeViaAgentLoopV2` works without Temporal client. It should, since it's the v2.3 version. If it has Temporal imports, refactor minimally.

5. **Database migrations: run in bootstrap or separately?**
   - What we know: CONTEXT.md lists this as Claude's discretion. Current pattern is `pnpm db:migrate` run separately before startup.
   - Recommendation: Keep migrations separate (run before startup). Running migrations in bootstrap adds startup latency, error handling complexity, and potential race conditions with multiple service restarts. The existing `pnpm db:migrate` workflow works well.

## Sources

### Primary (HIGH confidence)
- Codebase inspection: `packages/agents/src/framework/` -- all factory interfaces and implementations read directly
- Codebase inspection: `packages/agents/src/router/router.ts` -- routeEvent() and RouteEventDeps
- Codebase inspection: `packages/agents/src/shared/db/client.ts` -- Pool singleton pattern
- Codebase inspection: `packages/agents/src/shared/env/config.ts` -- Zod env schema
- Codebase inspection: `docker-compose.yml` -- all 6 services to be replaced
- Codebase inspection: `Dockerfile` -- pnpm deploy pattern
- Codebase inspection: `docker-config/nginx.conf` -- upstream definitions
- Codebase inspection: `.env.example` -- current env var catalog

### Secondary (MEDIUM confidence)
- [Express.js official docs: Health Checks and Graceful Shutdown](https://expressjs.com/en/advanced/healthcheck-graceful-shutdown.html) -- shutdown pattern
- [pnpm deploy documentation](https://pnpm.io/cli/deploy) -- file copying behavior

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already in package.json, versions verified
- Architecture: HIGH -- all framework components read directly, interfaces confirmed
- Pitfalls: HIGH -- identified from direct code reading, not speculation
- Docker Compose: HIGH -- existing docker-compose.yml read, changes are mechanical
- Definitions path in Docker: MEDIUM -- pnpm deploy behavior verified via docs, but needs Docker build test

**Research date:** 2026-02-03
**Valid until:** 2026-03-03 (stable -- no external dependency changes expected)
