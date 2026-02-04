---
phase: 48-agent-service-api-extensions
plan: 01
subsystem: agent-service-api
tags: [express, rest-api, worker-loop, tool-registry, agent-registry, health-check]
dependency-graph:
  requires: []
  provides:
    - "GET /api/tools/registry endpoint"
    - "GET /api/tools/health endpoint with 30s cache"
    - "GET /api/agents/registry and GET /api/agents/registry/:id endpoints"
    - "GET /api/worker/status endpoint"
    - "WorkerLoopStatus type and getStatus() interface"
    - "ConversationExecutor.getWorkerStatus() delegation"
    - "API error envelope and middleware helpers"
  affects:
    - "48-02 SSE event stream (builds on same api/router.ts)"
    - "49+ Dashboard (consumes these endpoints)"
tech-stack:
  added: []
  patterns:
    - "Express Router factory pattern with dependency injection"
    - "asyncHandler wrapper for consistent error envelope"
    - "zodToJsonSchema for tool input schema serialization"
    - "Promise.allSettled for parallel health checks"
    - "In-memory cache with TTL for health check results"
key-files:
  created:
    - packages/agents/src/service/api/types.ts
    - packages/agents/src/service/api/middleware.ts
    - packages/agents/src/service/api/tools-registry.ts
    - packages/agents/src/service/api/tools-health.ts
    - packages/agents/src/service/api/agents-registry.ts
    - packages/agents/src/service/api/worker-status.ts
    - packages/agents/src/service/api/router.ts
  modified:
    - packages/agents/src/framework/worker-loop.ts
    - packages/agents/src/framework/types.ts
    - packages/agents/src/framework/conversation-executor.ts
    - packages/agents/src/framework/index.ts
    - packages/agents/src/framework/timeout-scheduler.test.ts
    - packages/agents/src/service/main.ts
decisions:
  - id: "48-01-D1"
    decision: "Use inspection ToolContext with __inspection__ agentId for tool metadata extraction"
    rationale: "Avoids adding a new method to ToolRegistry interface. Factories return valid ToolDefinition objects with dummy context; execute() is never called. If a factory throws (e.g., codebase tools needing containerManager), fallback to minimal entry."
  - id: "48-01-D2"
    decision: "Worker status exposed via ConversationExecutor.getWorkerStatus() delegation"
    rationale: "Keeps WorkerLoop private to ConversationExecutor. Main.ts passes a callback to the API router that calls executor.getWorkerStatus(). No need to expose the WorkerLoop directly."
  - id: "48-01-D3"
    decision: "Tool registry results cached on first request (module-level cache)"
    rationale: "Tool registrations are immutable at runtime. Resolving 28 tool factories and converting Zod schemas to JSON Schema is not free, so caching makes the endpoint instant on subsequent calls."
  - id: "48-01-D4"
    decision: "Health check uses fetch with AbortSignal.timeout(3000ms)"
    rationale: "Internal Docker network, 3 seconds is generous. Node 18+ built-in, cleaner than manual setTimeout."
metrics:
  duration: "~6 minutes"
  completed: "2026-02-04"
---

# Phase 48 Plan 01: Shared API Foundation and REST Endpoints Summary

**One-liner:** Four read-only REST endpoints under /api/ exposing tool registry, integration health, agent definitions, and worker status with consistent error envelopes and factory-pattern routers.

## What Was Done

### Task 1: Shared API Foundation and WorkerLoop Interface Extension

Created the shared type definitions and middleware that all API endpoints use:

- **`api/types.ts`**: Defines `ApiError` envelope, error code constants (`NOT_FOUND`, `VALIDATION_ERROR`, `TOO_MANY_CONNECTIONS`, `INTERNAL_ERROR`), and response types for all four endpoints (`ToolRegistryEntry`, `AgentRegistrySummary`, `AgentRegistryDetail`, `WorkerStatusResponse`, `IntegrationHealth`, `ToolsHealthResponse`).

- **`api/middleware.ts`**: Three helpers -- `sendApiError()` for consistent error formatting, `validateParams()` as a pure Zod validation function (returns discriminated union, no Express middleware pattern), and `asyncHandler()` that wraps async route handlers to catch unhandled errors and respond with `INTERNAL_ERROR`.

- **WorkerLoop extension**: Added `WorkerLoopStatus` type and `getStatus()` method to the WorkerLoop interface. Tracks `startedAt` (set on `start()`) and `lastPollAt` (set at top of each `poll()` cycle). Returns `{ activeClaims, maxConcurrent, pollIntervalMs, lastPollAt, uptimeMs, isRunning }`.

- **ConversationExecutor extension**: Added `getWorkerStatus()` method that delegates to the internal `workerLoop.getStatus()` if the worker loop exists, otherwise returns null. This keeps the WorkerLoop encapsulated inside the executor.

### Task 2: Four REST Endpoint Handlers

Each endpoint follows the factory pattern: export a function that takes dependencies and returns an Express Router.

- **`tools-registry.ts`** (`GET /api/tools/registry`): Resolves all registered tools using an inspection ToolContext (`__inspection__` agent/correlation IDs). Converts each tool's Zod `inputSchema` to JSON Schema via `zodToJsonSchema()`. Falls back to minimal entry if a factory throws. Results cached on first call since registrations are immutable.

- **`tools-health.ts`** (`GET /api/tools/health`): Checks Linear, GitHub, and Slack `/health` endpoints in parallel using `Promise.allSettled()`. Each fetch uses `AbortSignal.timeout(3000)`. Results cached with 30s TTL. Two-state model: healthy/unhealthy. Error details stay in logs.

- **`agents-registry.ts`** (`GET /api/agents/registry` and `GET /api/agents/registry/:id`): List endpoint returns all definitions without `systemPrompt` (lightweight). Detail endpoint validates `:id` with Zod regex, returns full definition including prompt. 404 via `sendApiError` for missing agents.

- **`worker-status.ts`** (`GET /api/worker/status`): Calls `getWorkerStatus()` callback. Returns zeroed-out values if worker loop not started. Converts `lastPollAt` Date to ISO string.

### Task 3: Combined Router and main.ts Integration

- **`api/router.ts`**: Combines all four sub-routers into a single Express Router. Options interface includes `eventLog` for Plan 02's SSE extension.

- **`main.ts`**: Imports `createApiRouter`, builds integration health URLs from config, creates API router with all dependencies, and mounts at `/api`. Placed after executor creation so `getWorkerStatus()` is available.

## Decisions Made

| ID | Decision | Rationale |
|----|----------|-----------|
| 48-01-D1 | Inspection context for tool metadata | Avoids ToolRegistry interface change; only metadata read, execute() never called |
| 48-01-D2 | Worker status via ConversationExecutor delegation | Keeps WorkerLoop private; main.ts passes callback |
| 48-01-D3 | Module-level tool registry cache | Registrations immutable at runtime; instant on subsequent calls |
| 48-01-D4 | AbortSignal.timeout(3000) for health checks | Internal Docker network; Node 18+ built-in |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed test mock for new ConversationExecutor interface method**

- **Found during:** Task 1
- **Issue:** `timeout-scheduler.test.ts` had a `createMockExecutor()` that was missing the new `getWorkerStatus` method, causing typecheck to fail.
- **Fix:** Added `getWorkerStatus: vi.fn().mockReturnValue(null)` to the mock.
- **Files modified:** `packages/agents/src/framework/timeout-scheduler.test.ts`
- **Commit:** `7d9541f`

**2. [Rule 1 - Bug] Fixed exactOptionalPropertyTypes in AgentRegistrySummary**

- **Found during:** Task 2
- **Issue:** TypeScript's `exactOptionalPropertyTypes: true` requires optional properties to explicitly include `| undefined` in their type. The `AgentRegistrySummary` interface had `temperature?: number` which is incompatible with the `AgentDefinition` spread.
- **Fix:** Changed optional fields to `temperature?: number | undefined`, `subAgents?: Record<string, string> | undefined`, `triggers?: Array<{ event: string }> | undefined`.
- **Files modified:** `packages/agents/src/service/api/types.ts`
- **Commit:** `52a6f5a`

## Verification Results

| Check | Result |
|-------|--------|
| `pnpm run typecheck` | Pass (0 errors) |
| `pnpm --filter @aesir/agents run build` | Pass |
| `pnpm run lint` | Pass (0 errors in new files) |
| WorkerLoop has `getStatus()` | Verified |
| ConversationExecutor has `getWorkerStatus()` | Verified |
| All endpoints use `sendApiError` for errors | Verified via grep |
| No new npm dependencies | Verified (`package.json` unchanged) |

## Next Phase Readiness

Plan 02 (SSE event stream) can proceed immediately:
- `api/router.ts` already has `eventLog` in its options interface
- The router is already mounted in main.ts
- SSE endpoint will be added as another `router.use("/sse/events", ...)` call

---
*Completed: 2026-02-04*
*Duration: ~6 minutes*
*Tasks: 3/3*
