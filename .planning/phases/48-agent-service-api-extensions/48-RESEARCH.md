# Phase 48: Agent Service API Extensions - Research

**Researched:** 2026-02-04
**Domain:** Express.js REST API + Server-Sent Events on existing agent service
**Confidence:** HIGH

## Summary

This phase extends the existing Express.js agent service (port 3004) with six read-only HTTP endpoints under the `/api/` prefix, exposing runtime state that currently lives only in memory (tool registry, agent definitions, worker status, integration health) plus a real-time SSE event stream. The implementation builds entirely on existing infrastructure: Express 4.21, Zod 3.25, the existing ToolRegistry/AgentRegistry/EventLog interfaces, and the integration health endpoints already available at `/health` on ports 3001-3003.

The core challenge is not technology selection (Express is already the framework, SSE is already decided) but careful interface design: (1) extracting metadata from ToolDefinition objects whose Zod inputSchemas need JSON Schema conversion, (2) exposing WorkerLoop internal state that is currently private, (3) implementing SSE with proper connection management, heartbeats, sequence-based resume via `Last-Event-ID`, and connection limits, and (4) doing health checks against integration endpoints with caching.

No new dependencies are needed. The codebase already has `zod-to-json-schema` (^3.24.5) for schema conversion, Express for HTTP, and Zod for validation. SSE can be implemented with native Express `res.write()` -- no library needed given the simple requirements.

**Primary recommendation:** Implement all six endpoints as an Express Router mounted at `/api/`, using pure Express for SSE (no library), `zod-to-json-schema` for tool schema serialization, and a simple in-memory cache with TTL for health check results.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Express | ^4.21.0 | HTTP framework | Already used by agent service, no reason to change |
| Zod | 3.25.67 | Request validation | Already used throughout codebase |
| zod-to-json-schema | ^3.24.5 | Convert tool inputSchemas to JSON Schema | Already used in `run-agent-loop.ts` for Anthropic tool conversion |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none needed) | -- | -- | -- |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Native Express SSE | `better-sse` library | better-sse adds channels, auto-keepalive, event buffers, but adds a dependency for 1 endpoint; native Express is sufficient for our scope (single SSE endpoint, ~50 max connections) |
| Native Express SSE | `express-sse` | Simpler but unmaintained (5+ years old); native approach is more reliable |

**Installation:**
```bash
# No new packages needed -- all dependencies already present
```

## Architecture Patterns

### Recommended Project Structure

New files should be added under the existing `service/` directory in agents:

```
packages/agents/src/
  service/
    main.ts                    # Existing -- mount api router here
    api/                       # NEW: All /api/ route handlers
      router.ts                # Express Router combining all sub-routers
      tools-registry.ts        # GET /api/tools/registry
      tools-health.ts          # GET /api/tools/health (with cache)
      agents-registry.ts       # GET /api/agents/registry, /api/agents/registry/:id
      worker-status.ts         # GET /api/worker/status
      sse-events.ts            # GET /api/sse/events (SSE stream)
      middleware.ts            # Shared error envelope, validation helpers
      types.ts                 # API response type definitions
```

### Pattern 1: Express Router Module per Endpoint Group

**What:** Each endpoint file exports a factory function that takes dependencies and returns an Express Router.
**When to use:** For all six endpoints -- keeps each handler testable with mocked dependencies.

```typescript
// Source: Existing pattern in agent service (main.ts creates components, wires routes)
import { Router } from "express";
import type { ToolRegistry } from "../../framework/types.js";

interface ToolsRegistryRouterOptions {
  toolRegistry: ToolRegistry;
}

export function createToolsRegistryRouter(options: ToolsRegistryRouterOptions): Router {
  const { toolRegistry } = options;
  const router = Router();

  router.get("/", (_req, res) => {
    const refs = toolRegistry.listRegistered();
    // ... transform to response shape
    res.json(tools);
  });

  return router;
}
```

### Pattern 2: SSE Connection with Native Express

**What:** Set SSE headers, use `res.write()` for events, track connections with a Set, clean up on `req.on('close')`.
**When to use:** For the `/api/sse/events` endpoint.

```typescript
// Source: MDN SSE spec + Express best practices
res.writeHead(200, {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  "Connection": "keep-alive",
  "X-Accel-Buffering": "no", // Disable nginx buffering
});
res.flushHeaders();

// Write SSE event
function sendEvent(id: string, type: string, data: unknown): void {
  res.write(`id: ${id}\n`);
  res.write(`event: ${type}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// Keep-alive comment (prevents proxy timeout)
const keepAlive = setInterval(() => {
  res.write(": ping\n\n");
}, 20000); // 20 seconds

// Cleanup on disconnect
req.on("close", () => {
  clearInterval(keepAlive);
  // Remove from connection tracking
});
```

### Pattern 3: Cached Health Check with TTL

**What:** Use a simple closure-based cache with timestamp + TTL for integration health results.
**When to use:** For `/api/tools/health` (30-second cache per spec).

```typescript
interface CachedHealth {
  data: IntegrationHealthResponse;
  fetchedAt: number;
}

let cache: CachedHealth | null = null;
const CACHE_TTL_MS = 30_000;

async function getHealthCached(): Promise<IntegrationHealthResponse> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.data;
  }
  const data = await fetchIntegrationHealth();
  cache = { data, fetchedAt: now };
  return data;
}
```

### Pattern 4: Consistent Error Envelope

**What:** All `/api/` endpoints return errors in the format `{ error: { code: string, message: string, details?: unknown[] } }`.
**When to use:** For all error responses (400, 404, 500).

```typescript
interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown[];
  };
}

function sendError(res: Response, status: number, code: string, message: string, details?: unknown[]): void {
  const body: ApiError = { error: { code, message } };
  if (details) body.error.details = details;
  res.status(status).json(body);
}
```

### Anti-Patterns to Avoid

- **Exposing system prompt on list endpoint:** The spec explicitly says `/api/agents/registry` returns definitions WITHOUT system prompt content. Only `/api/agents/registry/:id` includes the full prompt.
- **Blocking the event loop in health checks:** Health check HTTP calls to integrations must use `Promise.allSettled()` (not `Promise.all()`) so one slow/failed integration does not block the others.
- **Unbounded SSE connections:** Must enforce the 50-connection limit and return 429 when exceeded. Without this, a browser with many open tabs or a misbehaving client could exhaust server resources.
- **Not flushing headers for SSE:** Must call `res.flushHeaders()` after setting SSE headers. Without this, Express may buffer the response and the client will not see any events.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Zod schema to JSON Schema | Custom schema walker | `zodToJsonSchema()` from `zod-to-json-schema` | Already used in `run-agent-loop.ts`; handles nested schemas, refs, edge cases |
| Zod validation errors to API errors | Custom error formatter | `ZodError.flatten()` or `ZodError.issues` | Zod already formats field-level errors; just wrap in the error envelope |
| SSE event format | Custom string builder | Simple template with `id:`, `event:`, `data:`, `\n\n` | SSE spec is simple enough that a 5-line helper is all that's needed -- but follow the spec exactly |
| Process uptime | Custom timer tracking | `process.uptime()` | Node.js built-in, returns seconds since process start |
| HTTP health check with timeout | Custom timeout logic | `AbortSignal.timeout(ms)` with `fetch()` | Node 18+ built-in; cleaner than manual `setTimeout`+`clearTimeout` |

**Key insight:** This phase has very few "don't hand-roll" items because the scope is inherently simple -- read-only Express endpoints. The complexity is in correct wiring to existing internal state, not in reinventing solved problems.

## Common Pitfalls

### Pitfall 1: ToolRegistry Does Not Expose Metadata

**What goes wrong:** The current `ToolRegistry.listRegistered()` only returns tool reference strings (e.g., `"linear:get_issue"`), not descriptions or schemas. The `resolve()` method requires a `ToolContext` (with agentId, correlationId, logger, etc.) to produce `ToolDefinition` objects.
**Why it happens:** Tools are designed for agent execution, not inspection. The factory pattern defers metadata creation to resolve time.
**How to avoid:** Add a new method to ToolRegistry (e.g., `listMetadata()`) that resolves tools with a minimal "inspection" context, or iterate through the factories and resolve each with a dummy context. The dummy context approach is simpler since tool metadata (name, description, inputSchema) doesn't depend on the context -- only `execute()` does.
**Warning signs:** If you try to get tool descriptions from just `listRegistered()`, you'll only get string refs like `"codebase:read_file"` with no description or schema.

### Pitfall 2: WorkerLoop State Is Private

**What goes wrong:** The `WorkerLoop` interface exposes `isRunning()` and `getRunningCount()`, but NOT `pollIntervalMs`, `concurrencyLimit`, `lastPollAt`, or `uptimeMs`. These are internal to the `createWorkerLoop()` closure.
**Why it happens:** WorkerLoop was designed for execution control, not observability.
**How to avoid:** Either (a) extend the WorkerLoop interface with a `getStatus()` method that returns the needed fields, or (b) track these values externally in main.ts where all config is available. Option (a) is cleaner because `lastPollAt` can only be tracked inside the poll loop. The ConversationExecutor wraps WorkerLoop, so the status method needs to be accessible through the executor or alongside it.
**Warning signs:** If the plan only references `executor.isRunning()` and `executor.getRunningCount()`, it's missing pollIntervalMs, concurrencyLimit, lastPollAt, and uptimeMs.

### Pitfall 3: SSE Connection Cleanup on Shutdown

**What goes wrong:** When the agent service shuts down, open SSE connections must be closed cleanly. If the shutdown sequence doesn't close SSE connections, clients hang and the process can't exit.
**Why it happens:** SSE keeps `res` objects open indefinitely. Express `server.close()` stops accepting new connections but doesn't terminate existing ones.
**How to avoid:** Track all SSE response objects in a Set. During graceful shutdown, iterate the set and call `res.end()` on each. Add this cleanup to the existing shutdown sequence in main.ts, BEFORE closing the HTTP server or after `server.close()`.
**Warning signs:** The agent service hangs during shutdown with active SSE connections.

### Pitfall 4: SSE EventLog Bridge Subscription Lifetime

**What goes wrong:** The SSE endpoint subscribes to `EventLog.subscribe()` for each connected client. If the unsubscribe function isn't called on client disconnect, the subscriber accumulates and leaks memory.
**Why it happens:** `EventLog.subscribe()` returns an `Unsubscribe` function that must be called when the SSE client disconnects.
**How to avoid:** Store the unsubscribe function and call it in the `req.on('close')` handler. Verify each SSE connection has a 1:1 subscribe/unsubscribe lifecycle.
**Warning signs:** Growing number of EventLog subscribers over time (visible in subscriber Map size).

### Pitfall 5: Health Check Fetch Hanging

**What goes wrong:** `fetch()` to integration health endpoints has no timeout by default. If an integration is down or slow, the health check endpoint blocks indefinitely.
**Why it happens:** Default `fetch()` in Node.js has no timeout.
**How to avoid:** Use `AbortSignal.timeout(3000)` (3-second timeout for internal Docker network calls) passed to `fetch()`. Wrap each integration check in its own try/catch so one failure doesn't affect others.
**Warning signs:** `/api/tools/health` takes >3 seconds to respond or never responds.

### Pitfall 6: SSE Resume Buffer Unbounded Growth

**What goes wrong:** To support `Last-Event-ID` based reconnection, events need to be buffered server-side. Without a cap, the buffer grows unboundedly.
**Why it happens:** Events are emitted continuously during agent execution. A client that disconnects for a long time would need a very large buffer to replay.
**How to avoid:** Use a bounded circular buffer (e.g., last 1000 events). If a client reconnects with a `Last-Event-ID` older than the buffer's oldest entry, send a special "gap" event telling the client to do a full refresh instead of replaying. This is a pragmatic tradeoff -- exact replay for short disconnections, graceful degradation for long ones.
**Warning signs:** Memory growth proportional to event volume.

## Code Examples

Verified patterns from official sources and the existing codebase:

### SSE Response Setup (Express)

```typescript
// Source: MDN SSE spec + Express patterns
import type { Request, Response } from "express";

function initSseResponse(res: Response): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();

  // Send retry interval (ms) for client reconnection
  res.write("retry: 3000\n\n");
}
```

### SSE Event Writing

```typescript
// Source: SSE spec (https://html.spec.whatwg.org/multipage/server-sent-events.html)
function writeSseEvent(res: Response, id: string, eventType: string, data: unknown): void {
  res.write(`id: ${id}\n`);
  res.write(`event: ${eventType}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}
```

### Last-Event-ID Resume

```typescript
// Source: SSE spec - client sends Last-Event-ID header on reconnection
function handleSseConnection(req: Request, res: Response, eventBuffer: EventBuffer): void {
  const lastEventId = req.headers["last-event-id"];

  if (lastEventId) {
    const lastSeq = parseInt(lastEventId, 10);
    if (!isNaN(lastSeq)) {
      const missed = eventBuffer.getAfter(lastSeq);
      for (const event of missed) {
        writeSseEvent(res, String(event.sequence), event.type, event.payload);
      }
    }
  }
}
```

### Tool Metadata Extraction via Resolve with Inspection Context

```typescript
// Source: Existing codebase pattern (tool-factories.ts + run-agent-loop.ts)
import { zodToJsonSchema } from "zod-to-json-schema";
import type { ToolRegistry, ToolContext } from "../../framework/types.js";

// Minimal context just for metadata extraction (execute won't be called)
const inspectionContext: ToolContext = {
  agentId: "__inspection__",
  correlationId: "__inspection__",
  logger: logger.child({ component: "api-tools-registry" }),
};

function getToolMetadata(registry: ToolRegistry) {
  const refs = registry.listRegistered();
  return refs.map(ref => {
    const [namespace, name] = ref.split(":");
    // NOTE: resolve() requires a full context but we only read metadata
    // A better approach is to add a resolveForInspection() or listMetadata() method
    return { name, namespace, ref };
  });
}
```

### Integration Health Check with Timeout

```typescript
// Source: Node.js fetch API + AbortSignal.timeout
async function checkIntegrationHealth(
  name: string,
  url: string,
  timeoutMs: number = 3000,
): Promise<{ status: "healthy" | "unhealthy"; latencyMs: number | null; lastChecked: string }> {
  const start = Date.now();
  try {
    const response = await fetch(`${url}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latencyMs = Date.now() - start;
    return {
      status: response.ok ? "healthy" : "unhealthy",
      latencyMs,
      lastChecked: new Date().toISOString(),
    };
  } catch {
    return {
      status: "unhealthy",
      latencyMs: null,
      lastChecked: new Date().toISOString(),
    };
  }
}
```

### Consistent Error Envelope

```typescript
// Source: Context decision from 48-CONTEXT.md
import { z, ZodError } from "zod";
import type { Response } from "express";

function sendApiError(
  res: Response,
  status: number,
  code: string,
  message: string,
  details?: unknown[],
): void {
  res.status(status).json({
    error: {
      code,
      message,
      ...(details && { details }),
    },
  });
}

function handleZodError(res: Response, error: ZodError): void {
  sendApiError(res, 400, "VALIDATION_ERROR", "Invalid request parameters", error.issues);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Custom SSE libraries | Native Express `res.write()` | Always valid | No dependency needed for simple SSE |
| `zod-to-json-schema` as standalone | Zod v4 has built-in `z.toJSONSchema()` | Zod v4 (2025) | Project uses Zod 3.25.67 with separate `zod-to-json-schema` package; no migration needed for v2.4 |
| `setTimeout` + manual abort | `AbortSignal.timeout(ms)` | Node 18+ | Cleaner timeout handling for fetch |
| SSE `EventSource` limited to 6 connections per domain (HTTP/1.1) | HTTP/2 supports ~100 streams | Ongoing | Internal Docker network uses HTTP/1.1 but the 6-connection browser limit is irrelevant for server-to-server; dashboard will be the only browser client |

**Deprecated/outdated:**
- `express-sse` npm package: last published 5+ years ago, do not use
- `AbortController` + manual timeout: replaced by `AbortSignal.timeout()` in Node 18+

## Open Questions

Things that need resolution during implementation:

1. **ToolRegistry metadata access pattern**
   - What we know: `ToolRegistry.listRegistered()` returns string refs only. `resolve()` returns full `ToolDefinition` objects but requires a `ToolContext` with agent/correlation IDs.
   - What's unclear: Whether to (a) add a new `listMetadata()` method to the ToolRegistry interface, (b) resolve with a dummy inspection context, or (c) build a separate tool metadata registry at boot time.
   - Recommendation: Option (a) is cleanest -- add `listMetadata(): ToolMetadata[]` to the ToolRegistry interface. This avoids abusing `resolve()` with fake contexts, and tool metadata (name, description, inputSchema) is context-independent. However, this requires modifying the existing ToolRegistry interface and implementation which is a framework change. Option (b) is pragmatic and avoids interface changes -- the factories will return valid ToolDefinition objects even with a dummy context; we just don't call `execute()`.

2. **WorkerLoop status exposure**
   - What we know: `WorkerLoop` interface has `isRunning()` and `getRunningCount()`. Missing: `pollIntervalMs`, `concurrencyLimit`, `lastPollAt`, `uptimeMs`.
   - What's unclear: Whether to add a `getStatus()` method to WorkerLoop or track these externally.
   - Recommendation: Add `getStatus()` to the WorkerLoop interface. `lastPollAt` can only be tracked inside the poll loop. `uptimeMs` should be calculated from the worker start time. The values `pollIntervalMs` and `concurrencyLimit` are constructor config available in the closure. The ConversationExecutor creates the WorkerLoop internally, so either the executor needs to expose this or main.ts needs direct access to the worker loop (which it currently doesn't -- it only has the executor).

3. **SSE event buffer size for Last-Event-ID replay**
   - What we know: The spec requires `Last-Event-ID` support with sequence-based resume. Events need buffering for replay.
   - What's unclear: Optimal buffer size. Too small = frequent "gaps" on reconnect. Too large = memory waste.
   - Recommendation: Start with 1000 events. At ~1KB per event, this is ~1MB of memory -- negligible. If a client's `Last-Event-ID` is older than the buffer, send a special `event: gap` so the client knows to refresh.

4. **Accessing tool description and inputSchema from registry**
   - What we know: The `ToolDefinition` interface has `name`, `description`, `inputSchema` (Zod type). The spec requires returning `inputSchema` as JSON Schema.
   - What's unclear: Whether the API should resolve tools once at boot and cache the metadata, or resolve on each request.
   - Recommendation: Resolve once at boot (or lazily on first request) and cache. Tool registrations don't change at runtime. Use `zodToJsonSchema()` for the conversion, which is already a project dependency.

## Sources

### Primary (HIGH confidence)
- **Existing codebase** -- `packages/agents/src/framework/` (tool-registry.ts, agent-registry.ts, worker-loop.ts, event-log.ts, types.ts, conversation-executor.ts, tool-factories.ts), `packages/agents/src/service/main.ts`, `packages/agents/src/shared/env/config.ts`
- **MDN SSE documentation** -- https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events
- **Integration health endpoints** -- All three integrations (Linear, GitHub, Slack) expose identical `/health` endpoints returning `{ status, service, timestamp, uptime, database }` with 200/503 status codes

### Secondary (MEDIUM confidence)
- **Express SSE best practices** -- Verified across multiple sources (DigitalOcean tutorial, Mastering JS, MDN): headers (`Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, `X-Accel-Buffering: no`), `flushHeaders()`, `req.on('close')` cleanup
- **`better-sse` library** -- https://www.npmjs.com/package/better-sse -- Evaluated but not recommended (adds dependency for simple use case)
- **SSE reconnection** -- `Last-Event-ID` header on reconnection is part of HTML Living Standard; browser EventSource default retry is 3000ms

### Tertiary (LOW confidence)
- None -- all findings verified against official sources or codebase

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- No new libraries needed, verified all exist in codebase
- Architecture: HIGH -- Express Router pattern matches existing service structure, SSE implementation follows well-documented spec
- Pitfalls: HIGH -- Identified through direct codebase inspection of ToolRegistry, WorkerLoop, EventLog interfaces; verified SSE gotchas against MDN spec

**Research date:** 2026-02-04
**Valid until:** 2026-03-04 (stable domain, no moving targets)

## Implementation-Critical Details

### Existing Interface Gaps (Must Be Addressed)

The following existing interfaces need extensions to support the API endpoints:

1. **ToolRegistry** -- needs a way to get tool metadata (description, inputSchema) without a full ToolContext. Current `listRegistered()` returns only string refs.

2. **WorkerLoop** -- needs a `getStatus()` method returning `{ activeClaims, maxConcurrent, pollIntervalMs, lastPollAt, uptimeMs }`. Currently only exposes `isRunning()` and `getRunningCount()`.

3. **ConversationExecutor** -- wraps WorkerLoop internally. Either needs to expose worker status, or main.ts needs direct reference to the WorkerLoop. Currently, the executor creates the worker loop lazily via `getOrCreateWorkerLoop()` -- it's private.

4. **AgentRegistry** -- `list()` returns full `AgentDefinition[]` including `systemPrompt`. For the list endpoint, the prompt content needs to be omitted from the response (map it out at the API layer, not the registry layer).

### Integration Health Endpoint Details

All three integrations have identical health endpoint patterns:
- **URL pattern:** `http://{service}:{port}/health`
- **Response shape:** `{ status: "ok" | "degraded", service: string, timestamp: number, uptime: number, database?: "healthy" | "unhealthy", error?: string }`
- **HTTP status:** 200 for healthy, 503 for degraded
- **Integration URLs from config:**
  - Linear: `config.mcp.linear.url` (default: `http://linear-integration:3001`)
  - GitHub: `config.mcp.github.url` (default: `http://github-integration:3002`)
  - Slack: `config.mcp.slack.url` (default: `http://slack-integration:3003`)

### EventLog Subscribe Mechanism

The `EventLog.subscribe()` method accepts:
- `filter: EventSubscriptionFilter` -- `{ types?: AgentEventType[] }` (empty = all types)
- `handler: EventSubscriptionHandler` -- `(event: AgentEvent) => Promise<void>`
- Returns `Unsubscribe` function (call to stop receiving events)

Subscriber notifications happen **in-memory before persistence** (fire-and-forget). This means SSE clients get events immediately, even before they're flushed to the database. The subscriber receives full `AgentEvent` objects with: `id`, `conversation_id`, `agent_definition_id`, `type`, `payload`, `sequence`, `timestamp`, etc.

The 9 event types available for filtering:
- `tool.called`, `tool.succeeded`, `tool.failed`
- `llm.response`
- `agent.started`, `agent.completed`, `agent.paused`, `agent.resumed`
- `signal.received`

### SSE Design Decisions (from CONTEXT.md)

| Decision | Value | Source |
|----------|-------|--------|
| Keepalive | `: ping\n\n` comment at regular interval | CONTEXT.md (Claude's discretion: recommend 20s) |
| Event type naming | Matches `agent_events.type` directly | CONTEXT.md decision |
| Max connections | 50, return 429 when exceeded | CONTEXT.md decision |
| Last-Event-ID support | Sequence-based resume | CONTEXT.md decision |
| Query param filters | `?conversationId=xxx`, `?types=tool.called,tool.failed` | CONTEXT.md decision |
| Bridges from | `EventLog.subscribe()` | CONTEXT.md decision |
| Heartbeat interval | 20 seconds (recommended) | Claude's discretion |
| Event buffer size | 1000 events (recommended) | Claude's discretion |
| Health check timeout | 3 seconds | Claude's discretion (internal Docker network) |

### Error Codes Vocabulary

| Code | HTTP Status | When |
|------|-------------|------|
| `NOT_FOUND` | 404 | Agent ID not found in registry |
| `VALIDATION_ERROR` | 400 | Zod validation fails on path/query params |
| `TOO_MANY_CONNECTIONS` | 429 | SSE connection limit (50) exceeded |
| `INTERNAL_ERROR` | 500 | Unexpected server error |
