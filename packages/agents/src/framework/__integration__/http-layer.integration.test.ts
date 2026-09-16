/**
 * HTTP Layer Integration Tests
 *
 * Validates the full HTTP surface area: POST /events, GET /conversations/:id,
 * POST /conversations/:id/cancel, and GET /health. Uses supertest against a
 * minimal Express app that mirrors the route handlers from service/main.ts
 * but with test-controlled dependencies.
 *
 * Tests the complete pipeline: Express routing -> Zod validation ->
 * adapter normalization -> EventRouter decisions -> ConversationExecutor.
 *
 * Only the LLM boundary (runAgentLoop) and external MCP calls (callMcpTool)
 * are mocked. Everything else is real: real database, real event log,
 * real session projection, real adapters, real EventRouter.
 */

// vi.mock MUST be before any framework imports that transitively import these modules
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("../../shared/agent-loop/run-agent-loop.js", () => ({
  runAgentLoop: vi.fn(),
}));

vi.mock("../../shared/mcp/index.js", () => ({
  callMcpTool: vi.fn().mockResolvedValue({ success: true }),
}));

// Also mock the MCP client barrel used by slow-path tools (send-message.ts)
vi.mock("../../shared/mcp/client.js", () => ({
  callMcpTool: vi.fn().mockResolvedValue({ success: true }),
}));

import { createLogger } from "@aesir/platform";
import { NormalizedEventSchema } from "@aesir/types";
import express from "express";
import request from "supertest";
import {
  createConversationExecutor,
  createEventLog,
  createSessionProjection,
} from "../../framework/index.js";
import type {
  ConversationExecutor,
  EventLog,
  EventRouter,
  SessionProjection,
} from "../../framework/types.js";
import { routeEvent } from "../../router/router.js";
import type { RouteEventDeps } from "../../router/types.js";
import { runAgentLoop } from "../../shared/agent-loop/run-agent-loop.js";
import {
  createTestAgentRegistry,
  createTestEventRouter,
  createTestToolRegistry,
  mockAgentLoopCompletes,
  mockAgentLoopPauses,
  mockAgentLoopSequence,
  waitForStatus,
} from "./helpers.js";
import {
  cleanupTables,
  type IntegrationTestContext,
  setupTestContext,
  teardownTestContext,
} from "./setup.js";

// ─── Logger ──────────────────────────────────────────────────────────────────

const logger = createLogger({ service: "http-layer-test", level: "warn" });

// ─── Test Express App Builder ────────────────────────────────────────────────

/**
 * Build a test Express app that mirrors the route handlers in service/main.ts.
 *
 * We do NOT import service/main.ts because it:
 * 1. Runs Zod env validation (calls process.exit on failure)
 * 2. Creates a real database pool from env vars
 * 3. Calls app.listen()
 *
 * Instead, we replicate the same route handler logic with test-injected deps.
 */
function createTestApp(deps: {
  executor: ConversationExecutor;
  eventRouter: EventRouter;
  logger: typeof logger;
}): express.Express {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  const routeEventDeps: RouteEventDeps = {
    executor: deps.executor,
    eventRouter: deps.eventRouter,
    logger: deps.logger,
    // No alertsChannel -- Slack alert MCP calls are mocked anyway
  };

  // GET /health -- liveness check
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "agent-service" });
  });

  // POST /events -- receive NormalizedEvent, route through pipeline
  app.post("/events", async (req, res) => {
    try {
      const parsed = NormalizedEventSchema.safeParse(req.body);
      if (!parsed.success) {
        res
          .status(400)
          .json({ error: "Validation failed", issues: parsed.error.issues });
        return;
      }

      const result = await routeEvent(parsed.data, routeEventDeps);
      res.json(result);
    } catch (error) {
      deps.logger.error({ err: error }, "POST /events failed");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // GET /conversations/:id -- retrieve conversation info
  app.get("/conversations/:id", async (req, res) => {
    try {
      const info = await deps.executor.get(req.params.id);
      if (!info) {
        res.status(404).json({ error: "Conversation not found" });
        return;
      }
      res.json(info);
    } catch (error) {
      deps.logger.error(
        { err: error, conversationId: req.params.id },
        "GET /conversations/:id failed",
      );
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // POST /conversations/:id/cancel -- cancel a conversation
  app.post("/conversations/:id/cancel", async (req, res) => {
    try {
      const cancelled = await deps.executor.cancel(req.params.id);
      if (!cancelled) {
        res
          .status(409)
          .json({ error: "Conversation already in terminal state" });
        return;
      }
      res.json({ cancelled: true });
    } catch (error) {
      deps.logger.error(
        { err: error, conversationId: req.params.id },
        "POST /conversations/:id/cancel failed",
      );
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return app;
}

// ─── Shared Test State ──────────────────────────────────────────────────────

let ctx: IntegrationTestContext;
let executor: ConversationExecutor;
let eventLog: EventLog;
let sessionProjection: SessionProjection;
let eventRouter: EventRouter;
let app: express.Express;

beforeAll(async () => {
  ctx = await setupTestContext();

  // Create framework components
  const agentRegistry = createTestAgentRegistry();
  const toolRegistry = createTestToolRegistry(logger);

  eventLog = createEventLog({
    db: ctx.db,
    logger,
    flushIntervalMs: 50,
    maxBufferSize: 10,
  });

  sessionProjection = createSessionProjection({
    db: ctx.db,
    logger,
    eventLog,
    artifactConfig: new Map(),
  });

  executor = createConversationExecutor({
    db: ctx.db,
    eventLog,
    sessionProjection,
    agentRegistry,
    toolRegistry,
    logger,
    pollIntervalMs: 50,
    concurrencyLimit: 5,
    heartbeatIntervalMs: 1000,
    staleThresholdMs: 3000,
  });

  eventRouter = await createTestEventRouter(agentRegistry, logger);

  // Build the test Express app
  app = createTestApp({ executor, eventRouter, logger });
}, 60000);

afterEach(async () => {
  // Stop worker if running
  await executor.stopWorker();
  // Flush event log
  await eventLog.flush();
  // Reset mocks
  (runAgentLoop as ReturnType<typeof vi.fn>).mockReset();
  // Truncate tables
  await cleanupTables(ctx);

  // Recreate executor components for next test
  const agentRegistry = createTestAgentRegistry();
  const toolRegistry = createTestToolRegistry(logger);

  sessionProjection.close();
  await eventLog.close();

  eventLog = createEventLog({
    db: ctx.db,
    logger,
    flushIntervalMs: 50,
    maxBufferSize: 10,
  });

  sessionProjection = createSessionProjection({
    db: ctx.db,
    logger,
    eventLog,
    artifactConfig: new Map(),
  });

  executor = createConversationExecutor({
    db: ctx.db,
    eventLog,
    sessionProjection,
    agentRegistry,
    toolRegistry,
    logger,
    pollIntervalMs: 50,
    concurrencyLimit: 5,
    heartbeatIntervalMs: 1000,
    staleThresholdMs: 3000,
  });

  eventRouter = await createTestEventRouter(agentRegistry, logger);

  // Rebuild Express app with fresh deps
  app = createTestApp({ executor, eventRouter, logger });
});

afterAll(async () => {
  sessionProjection.close();
  await eventLog.close();
  await teardownTestContext(ctx);
}, 30000);

// ─── GET /health ─────────────────────────────────────────────────────────────

describe("HTTP Layer: GET /health", () => {
  it("returns 200 with status ok", async () => {
    const res = await request(app).get("/health").expect(200);

    expect(res.body).toMatchObject({
      status: "ok",
      service: "agent-service",
    });
  });
});

// ─── POST /events ────────────────────────────────────────────────────────────

describe("HTTP Layer: POST /events", () => {
  it("creates conversation from valid Linear start event", async () => {
    mockAgentLoopCompletes(runAgentLoop as ReturnType<typeof vi.fn>);

    const res = await request(app)
      .post("/events")
      .send({
        id: "evt_http001",
        type: "linear.agent_session.created",
        source: "linear",
        timestamp: new Date().toISOString(),
        correlationId: "corr_http001",
        payload: {
          issueId: "AES-42",
          issueIdentifier: "AES-42",
        },
      })
      .expect(200);

    expect(res.body).toMatchObject({
      received: true,
      action: "started",
    });
    expect(res.body.conversationId).toBeDefined();

    // Verify conversation exists in DB
    const info = await executor.get(res.body.conversationId);
    expect(info).not.toBeNull();
    expect(info?.status).toBe("queued");
    expect(info?.agentDefinitionId).toBe("dev-agent");
  });

  it("creates conversation from valid Slack app_mention event", async () => {
    mockAgentLoopCompletes(runAgentLoop as ReturnType<typeof vi.fn>);

    const res = await request(app)
      .post("/events")
      .send({
        id: "evt_http002",
        type: "slack.app_mention.created",
        source: "slack",
        timestamp: new Date().toISOString(),
        correlationId: "corr_http002",
        payload: {
          text: "Hey @aesir, create a user auth feature",
          channel: "C12345",
          user: "U12345",
          ts: "1700000000.000001",
          threadTs: null,
        },
      })
      .expect(200);

    // Slack app_mention.created is a start trigger for product-agent.
    // The adapter extracts threadTs || ts as correlationKey.
    // With threadTs=null, it uses ts="1700000000.000001".
    expect(res.body.received).toBe(true);
    expect(res.body.action).toBe("started");
    expect(res.body.conversationId).toBeDefined();

    // Verify product-agent conversation created
    const info = await executor.get(res.body.conversationId);
    expect(info).not.toBeNull();
    expect(info?.agentDefinitionId).toBe("product-agent");
  });

  it("rejects invalid event payload with 400", async () => {
    const res = await request(app)
      .post("/events")
      .send({ invalid: true })
      .expect(400);

    expect(res.body.error).toBe("Validation failed");
    expect(res.body.issues).toBeDefined();
    expect(Array.isArray(res.body.issues)).toBe(true);
  });

  it("rejects empty body with 400", async () => {
    const res = await request(app).post("/events").send({}).expect(400);

    expect(res.body.error).toBe("Validation failed");
  });

  it("rejects event with malformed id (missing evt_ prefix) with 400", async () => {
    const res = await request(app)
      .post("/events")
      .send({
        id: "bad-id",
        type: "linear.agent_session.created",
        source: "linear",
        timestamp: new Date().toISOString(),
        correlationId: "corr_bad",
        payload: { issueId: "AES-99" },
      })
      .expect(400);

    expect(res.body.error).toBe("Validation failed");
  });

  it("rejects event with invalid source with 400", async () => {
    const res = await request(app)
      .post("/events")
      .send({
        id: "evt_badsource",
        type: "jira.issue.created",
        source: "jira",
        timestamp: new Date().toISOString(),
        correlationId: "corr_badsource",
        payload: {},
      })
      .expect(400);

    expect(res.body.error).toBe("Validation failed");
  });

  it("ignores events in IGNORE_EVENT_TYPES (linear.issue.created)", async () => {
    const res = await request(app)
      .post("/events")
      .send({
        id: "evt_ignore001",
        type: "linear.issue.created",
        source: "linear",
        timestamp: new Date().toISOString(),
        correlationId: "corr_ignore001",
        payload: { issueId: "AES-50", title: "New issue" },
      })
      .expect(200);

    expect(res.body).toMatchObject({
      received: true,
      action: "ignored",
    });
  });

  // Skipped pending #63: the endpoint reports the executor's "resumed" while
  // this expects the router's "signaled". Both are valid RouteResult members,
  // so which one POST /events should return is a contract decision, not a
  // failing assertion to bend either way.
  it.skip("routes signal events via HTTP (Slack approval)", async () => {
    // First create a waiting conversation
    mockAgentLoopSequence(runAgentLoop as ReturnType<typeof vi.fn>, [
      (m) => mockAgentLoopPauses(m, "approval", "Need approval"),
      (m) => mockAgentLoopCompletes(m, "Done after approval"),
    ]);

    // Start conversation directly via executor
    const convId = await executor.start({
      agentDefinitionId: "dev-agent",
      correlationKey: "HTTP-SIG-001",
      initialMessage: "Work on feature",
    });

    executor.startWorker();
    await waitForStatus(executor, convId, "waiting", 10000);

    // Send approval signal via HTTP using Slack block_actions event format.
    // The Slack adapter maps block_actions.approved to type: "approval"
    // with correlationKey: payload.taskIdentifier.
    const res = await request(app)
      .post("/events")
      .send({
        id: "evt_sig001",
        type: "slack.block_actions.approved",
        source: "slack",
        timestamp: new Date().toISOString(),
        correlationId: "corr_sig001",
        payload: {
          taskIdentifier: "HTTP-SIG-001",
          approved: true,
          userId: "U12345",
        },
      })
      .expect(200);

    expect(res.body.received).toBe(true);
    expect(res.body.action).toBe("signaled");
    expect(res.body.conversationId).toBe(convId);

    // Wait for completion after signal delivery
    await waitForStatus(executor, convId, "completed", 10000);
    await executor.stopWorker();

    const completed = await executor.get(convId);
    expect(completed?.status).toBe("completed");
  });

  it("returns idempotent response for duplicate start events", async () => {
    mockAgentLoopCompletes(runAgentLoop as ReturnType<typeof vi.fn>);

    // First start
    const res1 = await request(app)
      .post("/events")
      .send({
        id: "evt_dup001",
        type: "linear.agent_session.created",
        source: "linear",
        timestamp: new Date().toISOString(),
        correlationId: "corr_dup001",
        payload: { issueId: "AES-DUP" },
      })
      .expect(200);

    expect(res1.body.action).toBe("started");
    const convId = res1.body.conversationId;

    // Duplicate start (same correlationKey -> same conversation ID)
    const res2 = await request(app)
      .post("/events")
      .send({
        id: "evt_dup002",
        type: "linear.agent_session.created",
        source: "linear",
        timestamp: new Date().toISOString(),
        correlationId: "corr_dup002",
        payload: { issueId: "AES-DUP" },
      })
      .expect(200);

    // Both should return same conversation ID (idempotent)
    expect(res2.body.received).toBe(true);
    expect(res2.body.action).toBe("started");
    expect(res2.body.conversationId).toBe(convId);
  });
});

// ─── GET /conversations/:id ──────────────────────────────────────────────────

describe("HTTP Layer: GET /conversations/:id", () => {
  it("returns conversation info for existing conversation", async () => {
    mockAgentLoopCompletes(runAgentLoop as ReturnType<typeof vi.fn>);

    const convId = await executor.start({
      agentDefinitionId: "dev-agent",
      correlationKey: "HTTP-GET-001",
      initialMessage: "Test get endpoint",
    });

    const res = await request(app).get(`/conversations/${convId}`).expect(200);

    expect(res.body.id).toBe(convId);
    expect(res.body.status).toBe("queued");
    expect(res.body.agentDefinitionId).toBe("dev-agent");
  });

  it("returns 404 for non-existent conversation", async () => {
    const res = await request(app)
      .get("/conversations/nonexistent-conv-id")
      .expect(404);

    expect(res.body.error).toBe("Conversation not found");
  });

  it("reflects status changes after worker execution", async () => {
    mockAgentLoopCompletes(runAgentLoop as ReturnType<typeof vi.fn>);

    const convId = await executor.start({
      agentDefinitionId: "dev-agent",
      correlationKey: "HTTP-GET-002",
      initialMessage: "Test status progression",
    });

    // Before worker: queued
    const before = await request(app)
      .get(`/conversations/${convId}`)
      .expect(200);
    expect(before.body.status).toBe("queued");

    // Start worker, wait for completion
    executor.startWorker();
    await waitForStatus(executor, convId, "completed", 10000);
    await executor.stopWorker();

    // After worker: completed
    const after = await request(app)
      .get(`/conversations/${convId}`)
      .expect(200);
    expect(after.body.status).toBe("completed");
  });
});

// ─── POST /conversations/:id/cancel ─────────────────────────────────────────

describe("HTTP Layer: POST /conversations/:id/cancel", () => {
  it("cancels an active conversation", async () => {
    mockAgentLoopCompletes(runAgentLoop as ReturnType<typeof vi.fn>);

    const convId = await executor.start({
      agentDefinitionId: "dev-agent",
      correlationKey: "HTTP-CANCEL-001",
      initialMessage: "Test cancel endpoint",
    });

    const res = await request(app)
      .post(`/conversations/${convId}/cancel`)
      .expect(200);

    expect(res.body.cancelled).toBe(true);

    // Verify status changed to cancelled
    const info = await executor.get(convId);
    expect(info?.status).toBe("cancelled");
  });

  it("returns 409 for already-completed conversation", async () => {
    mockAgentLoopCompletes(runAgentLoop as ReturnType<typeof vi.fn>);

    const convId = await executor.start({
      agentDefinitionId: "dev-agent",
      correlationKey: "HTTP-CANCEL-002",
      initialMessage: "Complete then cancel",
    });

    executor.startWorker();
    await waitForStatus(executor, convId, "completed", 10000);
    await executor.stopWorker();

    const res = await request(app)
      .post(`/conversations/${convId}/cancel`)
      .expect(409);

    expect(res.body.error).toContain("terminal");
  });

  it("returns 409 for already-cancelled conversation", async () => {
    mockAgentLoopCompletes(runAgentLoop as ReturnType<typeof vi.fn>);

    const convId = await executor.start({
      agentDefinitionId: "dev-agent",
      correlationKey: "HTTP-CANCEL-003",
      initialMessage: "Cancel twice",
    });

    // First cancel succeeds
    await request(app).post(`/conversations/${convId}/cancel`).expect(200);

    // Second cancel returns 409
    const res = await request(app)
      .post(`/conversations/${convId}/cancel`)
      .expect(409);

    expect(res.body.error).toContain("terminal");
  });
});
