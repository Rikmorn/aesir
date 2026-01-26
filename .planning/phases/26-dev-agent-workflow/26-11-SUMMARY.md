---
phase: 26-dev-agent-workflow
plan: 11
completed: 2026-01-26
duration: ~4 min
subsystem: agents/http
tags: [http, events, worker, temporal, express]

dependency-graph:
  requires: ["26-10"] # Temporal workflow wrapper
  provides: ["devAgentHttpServer", "devAgentWorker", "linearEventHandler"]
  affects: ["26-12", "26-13"] # E2E tests

tech-stack:
  added: ["express"]
  patterns: ["http-events", "worker-initialization", "graceful-shutdown"]

key-files:
  created:
    - packages/agents/src/dev-agent/api/events.ts
    - packages/agents/src/dev-agent/api/routes.ts
    - packages/agents/src/dev-agent/api/index.ts
    - packages/agents/src/dev-agent/main.ts
    - packages/agents/src/dev-agent/worker.ts
  modified: []

decisions:
  - id: "port-3004"
    choice: "Port 3004 for dev-agent HTTP service"
    reason: "Consistent with product-agent (3005) and integration pattern"

metrics:
  tasks: 3/3
  commits: 2
---

# Phase 26 Plan 11: Dev Agent HTTP Service Summary

HTTP server on port 3004 for Linear events and Temporal worker for dev-agent workflows.

## What Was Built

### 1. Events Handler (api/events.ts)

Linear event handler with agent-ready label filtering:

```typescript
export function createDevAgentEventsHandler(deps: DevAgentEventsHandlerDeps) {
  return async (req: EventsRequest, res: EventsResponse): Promise<void> => {
    // Parse and validate NormalizedEvent
    const event = NormalizedEventSchema.safeParse(body);

    // Filter for Linear issue events
    if (event.source !== "linear" || !event.type.startsWith("linear.issue")) {
      return;
    }

    // Check for agent-ready label
    const hasAgentReadyLabel = labelNames.includes("agent-ready");
    if (!hasAgentReadyLabel) return;

    // Start dev-agent workflow
    await workflowClient.workflow.start("devAgentWorkflow", {
      taskQueue: "dev-agent",
      workflowId: `dev-agent-${issueId}`,
      args: [input],
    });
  };
}
```

**Key behaviors:**
- Only handles Linear events (source === 'linear')
- Filters for "agent-ready" label before starting workflow
- Handles both issue.created and issue.updated (late label addition)
- Gracefully handles duplicate events (workflow already exists)

### 2. HTTP Routes (api/routes.ts)

Express router with two endpoints:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/health` | GET | Health check (returns 200 OK) |
| `/events` | POST | Receive normalized events from dispatcher |

Uses Express JSON middleware for body parsing.

### 3. HTTP Server (main.ts)

Node.js HTTP server (following product-agent pattern):

```typescript
async function bootstrap(): Promise<void> {
  // 1. Connect to Temporal client
  const clientConnection = await Connection.connect({ address });
  const workflowClient = new Client({ connection, namespace });

  // 2. Start Temporal worker (non-blocking)
  const worker = await createDevAgentWorker({ address, namespace });
  worker.run().catch(exitOnError);

  // 3. Create events handler
  const eventsHandler = createDevAgentEventsHandler({
    workflowClient,
    slackChannel,
  });

  // 4. Start HTTP server on port 3004
  const server = createServer(async (req, res) => {
    // Routes: /health, /events
  });

  // 5. Graceful shutdown
  process.on("SIGTERM", async () => {
    server.close();
    worker.shutdown();
    await connection.close();
  });
}
```

**Environment variables:**
- `DATABASE_URL` - Required for checkpointer
- `DEV_AGENT_SLACK_CHANNEL` - Slack channel for notifications
- `TEMPORAL_ADDRESS` - Default: localhost:7233
- `TEMPORAL_NAMESPACE` - Default: default
- `DEV_AGENT_PORT` - Default: 3004

### 4. Temporal Worker (worker.ts)

Worker initialization with dependency injection:

```typescript
export async function createDevAgentWorker(
  options: DevAgentWorkerOptions = {},
): Promise<Worker> {
  // 1. Create dependencies
  const manager = createDevContainerManager({ db, logger });
  const git = createDevContainerGit({ manager, logger });

  // 2. Initialize checkpointer
  const checkpointer = await PostgresSaver.fromConnString(databaseUrl);
  await checkpointer.setup();

  // 3. Initialize activities with dependencies
  initDevAgentActivities({
    manager, git, repoUrl, githubToken,
    owner, repo, baseBranch, slackChannel,
    llm, checkpointer
  });

  // 4. Create Temporal worker
  const connection = await NativeConnection.connect({ address });
  return await Worker.create({
    connection,
    namespace,
    taskQueue: "dev-agent",
    workflowsPath: "../temporal/workflows/dev-agent-workflow.js",
    activities: {
      runDevAgentGraphActivity,
      continueAfterApprovalActivity,
      handlePRFeedbackActivity,
      stopContainerActivity,
      sendReminderActivity,
    },
  });
}
```

**Environment variables:**
- `GITHUB_REPO_URL` - Required for cloning
- `GITHUB_TOKEN` - Required for authentication
- `GITHUB_OWNER` - GitHub owner/org
- `GITHUB_REPO` - Repository name
- `GITHUB_BASE_BRANCH` - Default: main
- `DEV_AGENT_SLACK_CHANNEL` - Slack notifications
- `ANTHROPIC_MODEL` - Default: claude-sonnet-4-20250514

## Key Patterns

### Event Filtering Pattern

```typescript
// 1. Source filter
if (event.source !== "linear") return;

// 2. Resource filter
if (!event.type.startsWith("linear.issue")) return;

// 3. Label filter
const hasAgentReadyLabel = labelNames.includes("agent-ready");
if (!hasAgentReadyLabel) return;

// 4. Start workflow
await workflowClient.workflow.start(...);
```

### Worker Initialization Pattern

```typescript
// 1. Dependencies BEFORE worker
const manager = createDevContainerManager({ db, logger });
const checkpointer = await PostgresSaver.fromConnString(url);

// 2. Initialize activities BEFORE worker
initDevAgentActivities({ manager, checkpointer, ... });

// 3. Create worker with NativeConnection
const connection = await NativeConnection.connect({ address });
const worker = await Worker.create({ connection, activities });
```

Worker creates its own connection (separate from client connection).

### Graceful Shutdown Pattern

```typescript
const shutdown = async (signal: string): Promise<void> => {
  // 1. Stop accepting HTTP connections
  server.close();

  // 2. Shutdown worker (completes in-flight tasks)
  worker.shutdown();

  // 3. Close Temporal client connection
  await clientConnection.close();

  // 4. Exit
  process.exit(0);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
```

## Deviations from Plan

None - plan executed exactly as written.

## Next Phase Readiness

Plan 26-12 (E2E Test) can now:
- POST normalized Linear event to http://localhost:3004/events
- Verify workflow started with correct workflowId
- Query workflow status via Temporal client
- Confirm agent-ready label filtering works

Plan 26-13 (Dispatcher Integration) can:
- Configure dispatcher to route Linear issue events to dev-agent
- Set up webhook endpoints in Linear integration
- Test full flow: Linear webhook → dispatcher → dev-agent

## Commits

| Hash | Message |
|------|---------|
| 2719e9e | feat(26-11): create dev-agent events handler |
| 79a2796 | feat(26-11): create dev-agent HTTP server and Temporal worker |
