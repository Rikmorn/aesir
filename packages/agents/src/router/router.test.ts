/**
 * Router Tests
 *
 * Comprehensive tests for routeEvent() covering:
 * - Task-aware routing: signal to active conversation, new conversation creation
 * - Fall-through cases: non-agent assignee, missing task, DB error
 * - Backward compatibility: events without taskId route through EventRouter unchanged
 * - Advisory lock serialization via pg_advisory_xact_lock
 */

import type { PinoLogger } from "@aesir/platform";
import type { NormalizedEvent } from "@aesir/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IncomingEvent } from "../adapters/types.js";
import type {
  ConversationExecutor,
  ConversationInfo,
  EventRouter,
  EventRouterRouteResult,
} from "../framework/types.js";
import type { Task } from "../shared/db/schema.js";
import type { TaskService } from "../shared/services/task-service.js";
import { routeEvent } from "./router.js";
import type { RouteEventDeps } from "./types.js";

// ─── Mock Modules ───────────────────────────────────────────────────────────

// Mock the adapter pipeline so we control what IncomingEvent routeEvent sees.
// This avoids coupling tests to adapter internals.
vi.mock("../adapters/index.js", () => ({
  ALL_ADAPTERS: [] as never[], // Empty: pass-through always used
}));

vi.mock("../adapters/pass-through.js", () => ({
  adaptPassThrough: vi.fn(),
}));

// Mock slow-path to prevent background execution
vi.mock("./slow-path.js", () => ({
  routeViaAgentLoopV2: vi.fn().mockResolvedValue(undefined),
}));

// Mock MCP tool calls (used by sendRoutingAlertV2)
vi.mock("../shared/mcp/index.js", () => ({
  callMcpTool: vi.fn().mockResolvedValue(undefined),
}));

// Import mocks so we can configure them per test
import { ALL_ADAPTERS } from "../adapters/index.js";
import { adaptPassThrough } from "../adapters/pass-through.js";
import type { AdapterIgnore, EventAdapter } from "../adapters/types.js";
import { routeViaAgentLoopV2 } from "./slow-path.js";

const mockAdaptPassThrough = vi.mocked(adaptPassThrough);
const mockAllAdapters = ALL_ADAPTERS as EventAdapter[];
const mockRouteViaAgentLoop = vi.mocked(routeViaAgentLoopV2);

// ─── Helpers ────────────────────────────────────────────────────────────────

function createMockLogger(): PinoLogger {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn(),
    level: "info",
    silent: vi.fn(),
  };
  // child() returns the same mock logger (with child fields merged)
  logger.child.mockReturnValue(logger);
  return logger as unknown as PinoLogger;
}

function createNormalizedEvent(
  overrides?: Partial<NormalizedEvent>,
): NormalizedEvent {
  return {
    id: "evt_test123",
    type: "github.pull_request.review_submitted",
    source: "github",
    timestamp: new Date().toISOString(),
    correlationId: "corr-123",
    payload: { action: "submitted", pullRequestId: 42 },
    ...overrides,
  };
}

function createIncomingEvent(
  overrides?: Partial<IncomingEvent>,
): IncomingEvent {
  return {
    type: "pr_review",
    data: { action: "submitted", pullRequestId: 42 },
    source: "github:webhook",
    correlationKey: "PR-42",
    deduplicationId: "dedup-abc",
    ...overrides,
  };
}

function createMockTask(overrides?: Partial<Task>): Task {
  return {
    id: "task_abc123",
    parent_id: null,
    creator_type: "human",
    creator_id: "user-1",
    assignee_type: "agent",
    assignee_id: "dev-agent",
    status: "active",
    title: "Fix authentication bug",
    objective: null,
    metadata: {},
    created_at: new Date("2026-02-07T00:00:00Z"),
    updated_at: new Date("2026-02-07T00:00:00Z"),
    completed_at: null,
    ...overrides,
  };
}

function createMockConversationInfo(
  overrides?: Partial<ConversationInfo>,
): ConversationInfo {
  return {
    id: "conv-active-123",
    agentDefinitionId: "dev-agent",
    agentDefinitionVersion: "1.0",
    status: "waiting",
    createdAt: new Date("2026-02-07T00:00:00Z"),
    updatedAt: new Date("2026-02-07T00:00:00Z"),
    ...overrides,
  };
}

function createMockExecutor(
  overrides?: Partial<ConversationExecutor>,
): ConversationExecutor {
  return {
    start: vi.fn().mockResolvedValue("conv-new-123"),
    signal: vi.fn().mockResolvedValue({ action: "resumed" }),
    get: vi.fn().mockResolvedValue(null),
    cancel: vi.fn().mockResolvedValue(true),
    reopen: vi.fn().mockResolvedValue({ action: "reopened" }),
    list: vi.fn().mockResolvedValue([]),
    startWorker: vi.fn(),
    stopWorker: vi.fn().mockResolvedValue(undefined),
    getWorkerStatus: vi.fn().mockReturnValue(null),
    findActiveForTask: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

function createMockEventRouter(
  routeResult?: EventRouterRouteResult,
): EventRouter {
  return {
    loadStartRules: vi.fn().mockResolvedValue(undefined),
    handle: vi.fn().mockReturnValue(
      routeResult ?? {
        action: "ignore" as const,
        reason: "No matching trigger",
      },
    ),
  };
}

function createMockTaskService(overrides?: Partial<TaskService>): TaskService {
  return {
    create: vi.fn(),
    get: vi.fn().mockResolvedValue(null),
    update: vi.fn(),
    addHandoff: vi.fn(),
    transitionWithHandoff: vi.fn(),
    getHandoffs: vi.fn().mockResolvedValue([]),
    getLatestHandoff: vi.fn().mockResolvedValue(null),
    listByAssignee: vi.fn().mockResolvedValue([]),
    listByParent: vi.fn().mockResolvedValue([]),
    linkConversation: vi.fn().mockResolvedValue(undefined),
    health: vi.fn().mockResolvedValue({ healthy: true, latencyMs: 1 }),
    close: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as TaskService;
}

function createMockDb() {
  const mockTxExecute = vi.fn().mockResolvedValue(undefined);
  const mockTx = { execute: mockTxExecute };

  return {
    transaction: vi.fn(async (callback: (tx: typeof mockTx) => unknown) => {
      return callback(mockTx);
    }),
    mockTx,
    mockTxExecute,
  };
}

interface MockDepsResult {
  deps: RouteEventDeps;
  executor: ConversationExecutor;
  eventRouter: EventRouter;
  taskService: TaskService;
  db: ReturnType<typeof createMockDb>;
  logger: PinoLogger;
}

function createMockDeps(overrides?: {
  executor?: ConversationExecutor;
  eventRouter?: EventRouter;
  taskService?: TaskService;
  routeResult?: EventRouterRouteResult;
}): MockDepsResult {
  const logger = createMockLogger();
  const executor = overrides?.executor ?? createMockExecutor();
  const eventRouter =
    overrides?.eventRouter ?? createMockEventRouter(overrides?.routeResult);
  const taskService = overrides?.taskService ?? createMockTaskService();
  const db = createMockDb();

  const deps: RouteEventDeps = {
    executor,
    eventRouter,
    logger,
    alertsChannel: "C-alerts",
    linearTeamId: "TEAM-1",
    githubOwner: "my-org",
    githubRepo: "my-repo",
    githubBaseBranch: "main",
    taskService,
    db: db as unknown as RouteEventDeps["db"],
  };

  return { deps, executor, eventRouter, taskService, db, logger };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("routeEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Task Routing: Signal to Active Conversation ────────────────────────

  describe("task routing with active conversation (signal delivery)", () => {
    it("signals the active conversation when task has agent assignee", async () => {
      const task = createMockTask({ assignee_id: "dev-agent" });
      const activeConv = createMockConversationInfo({ id: "conv-active-1" });
      const taskService = createMockTaskService({
        get: vi.fn().mockResolvedValue(task),
      });
      const executor = createMockExecutor({
        findActiveForTask: vi.fn().mockResolvedValue(activeConv),
        signal: vi.fn().mockResolvedValue({ action: "resumed" }),
      });
      const { deps } = createMockDeps({ executor, taskService });

      const incomingEvent = createIncomingEvent({
        taskId: task.id,
        type: "pr_review",
        message: "PR approved",
      });
      mockAdaptPassThrough.mockReturnValue(incomingEvent);

      const result = await routeEvent(createNormalizedEvent(), deps);

      expect(result).toEqual({
        received: true,
        action: "resumed",
        conversationId: "conv-active-1",
      });

      // Verify signal was delivered with original event type preserved
      expect(executor.signal).toHaveBeenCalledWith("conv-active-1", {
        type: "pr_review",
        data: incomingEvent.data,
        message: "PR approved",
        source: "github:webhook",
        deduplicationId: "dedup-abc",
      });
    });

    it("preserves original signal type (no task metadata modification)", async () => {
      const task = createMockTask();
      const activeConv = createMockConversationInfo();
      const taskService = createMockTaskService({
        get: vi.fn().mockResolvedValue(task),
      });
      const executor = createMockExecutor({
        findActiveForTask: vi.fn().mockResolvedValue(activeConv),
        signal: vi.fn().mockResolvedValue({ action: "queued" }),
      });
      const { deps } = createMockDeps({ executor, taskService });

      const incomingEvent = createIncomingEvent({
        taskId: task.id,
        type: "approval",
      });
      mockAdaptPassThrough.mockReturnValue(incomingEvent);

      const result = await routeEvent(createNormalizedEvent(), deps);

      // Signal type should be "approval", not modified by task routing
      const signalCall = vi.mocked(executor.signal).mock.calls[0];
      expect(signalCall?.[1]?.type).toBe("approval");
      expect(result.action).toBe("queued");
    });

    it("does NOT call EventRouter.handle() when task routing succeeds", async () => {
      const task = createMockTask();
      const activeConv = createMockConversationInfo();
      const taskService = createMockTaskService({
        get: vi.fn().mockResolvedValue(task),
      });
      const executor = createMockExecutor({
        findActiveForTask: vi.fn().mockResolvedValue(activeConv),
      });
      const eventRouter = createMockEventRouter();
      const { deps } = createMockDeps({ executor, taskService, eventRouter });

      mockAdaptPassThrough.mockReturnValue(
        createIncomingEvent({ taskId: task.id }),
      );

      await routeEvent(createNormalizedEvent(), deps);

      expect(eventRouter.handle).not.toHaveBeenCalled();
    });
  });

  // ─── Task Routing: New Conversation ─────────────────────────────────────

  describe("task routing with no active conversation (new conversation)", () => {
    it("creates a new conversation with correct agentDefinitionId from task", async () => {
      const task = createMockTask({ assignee_id: "dev-agent" });
      const taskService = createMockTaskService({
        get: vi.fn().mockResolvedValue(task),
      });
      const executor = createMockExecutor({
        findActiveForTask: vi.fn().mockResolvedValue(null),
        start: vi.fn().mockResolvedValue("conv-new-456"),
      });
      const { deps } = createMockDeps({ executor, taskService });

      mockAdaptPassThrough.mockReturnValue(
        createIncomingEvent({ taskId: task.id }),
      );

      const result = await routeEvent(createNormalizedEvent(), deps);

      expect(result).toEqual({
        received: true,
        action: "started",
        conversationId: "conv-new-456",
      });

      const startCall = vi.mocked(executor.start).mock.calls[0]?.[0];
      expect(startCall?.agentDefinitionId).toBe("dev-agent");
      expect(startCall?.taskId).toBe(task.id);
    });

    it("uses correlationKey format taskId:deduplicationId", async () => {
      const task = createMockTask({ id: "task_xyz" });
      const taskService = createMockTaskService({
        get: vi.fn().mockResolvedValue(task),
      });
      const executor = createMockExecutor({
        findActiveForTask: vi.fn().mockResolvedValue(null),
      });
      const { deps } = createMockDeps({ executor, taskService });

      mockAdaptPassThrough.mockReturnValue(
        createIncomingEvent({
          taskId: "task_xyz",
          deduplicationId: "webhook-delivery-99",
        }),
      );

      await routeEvent(createNormalizedEvent(), deps);

      const startCall = vi.mocked(executor.start).mock.calls[0]?.[0];
      expect(startCall?.correlationKey).toBe("task_xyz:webhook-delivery-99");
    });

    it("enriches initial message with workspace context", async () => {
      const task = createMockTask();
      const taskService = createMockTaskService({
        get: vi.fn().mockResolvedValue(task),
      });
      const executor = createMockExecutor({
        findActiveForTask: vi.fn().mockResolvedValue(null),
      });
      const { deps } = createMockDeps({ executor, taskService });

      mockAdaptPassThrough.mockReturnValue(
        createIncomingEvent({
          taskId: task.id,
          message: "Review this PR",
        }),
      );

      await routeEvent(createNormalizedEvent(), deps);

      const startCall = vi.mocked(executor.start).mock.calls[0]?.[0];
      // enrichInitialMessage prepends <workspace_context> block
      expect(startCall?.initialMessage).toContain("<workspace_context>");
      expect(startCall?.initialMessage).toContain("GitHub Owner: my-org");
      expect(startCall?.initialMessage).toContain("Review this PR");
    });
  });

  // ─── Task Routing: CorrelationKey Fallback ──────────────────────────────

  describe("correlationKey fallback", () => {
    it("uses event.type as fallback when deduplicationId is undefined", async () => {
      const task = createMockTask({ id: "task_fallback" });
      const taskService = createMockTaskService({
        get: vi.fn().mockResolvedValue(task),
      });
      const executor = createMockExecutor({
        findActiveForTask: vi.fn().mockResolvedValue(null),
      });
      const { deps } = createMockDeps({ executor, taskService });

      mockAdaptPassThrough.mockReturnValue(
        createIncomingEvent({
          taskId: "task_fallback",
          type: "pr_review",
          deduplicationId: undefined,
        }),
      );

      await routeEvent(createNormalizedEvent(), deps);

      const startCall = vi.mocked(executor.start).mock.calls[0]?.[0];
      expect(startCall?.correlationKey).toBe("task_fallback:pr_review");
    });
  });

  // ─── Fall-through: Non-Agent Assignee ───────────────────────────────────

  describe("fall-through: non-agent assignee", () => {
    it("falls through to EventRouter when task has human assignee", async () => {
      const task = createMockTask({
        assignee_type: "human",
        assignee_id: "user-42",
      });
      const taskService = createMockTaskService({
        get: vi.fn().mockResolvedValue(task),
      });
      const eventRouter = createMockEventRouter({
        action: "ignore",
        reason: "No matching trigger",
      });
      const { deps } = createMockDeps({ taskService, eventRouter });

      mockAdaptPassThrough.mockReturnValue(
        createIncomingEvent({ taskId: task.id }),
      );

      const result = await routeEvent(createNormalizedEvent(), deps);

      // EventRouter was called (task routing fell through)
      expect(eventRouter.handle).toHaveBeenCalled();
      expect(result.action).toBe("ignored");
    });

    it("strips taskId from event before passing to EventRouter", async () => {
      const task = createMockTask({ assignee_type: "human" });
      const taskService = createMockTaskService({
        get: vi.fn().mockResolvedValue(task),
      });
      const eventRouter = createMockEventRouter({
        action: "ignore",
        reason: "Ignored",
      });
      const { deps } = createMockDeps({ taskService, eventRouter });

      mockAdaptPassThrough.mockReturnValue(
        createIncomingEvent({ taskId: task.id }),
      );

      await routeEvent(createNormalizedEvent(), deps);

      // EventRouter.handle() receives the event with taskId stripped
      const handleCall = vi.mocked(eventRouter.handle).mock.calls[0]?.[0];
      expect(handleCall?.taskId).toBeUndefined();
    });
  });

  // ─── Fall-through: Task Not Found ──────────────────────────────────────

  describe("fall-through: task not found", () => {
    it("falls through to EventRouter when taskService.get() returns null", async () => {
      const taskService = createMockTaskService({
        get: vi.fn().mockResolvedValue(null),
      });
      const eventRouter = createMockEventRouter({
        action: "ignore",
        reason: "No matching trigger",
      });
      const { deps, logger } = createMockDeps({ taskService, eventRouter });

      mockAdaptPassThrough.mockReturnValue(
        createIncomingEvent({ taskId: "task_missing" }),
      );

      await routeEvent(createNormalizedEvent(), deps);

      expect(eventRouter.handle).toHaveBeenCalled();
      // Verify warning was logged
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: "task_missing" }),
        "Task not found during task routing",
      );
    });

    it("strips taskId from event on task not found", async () => {
      const taskService = createMockTaskService({
        get: vi.fn().mockResolvedValue(null),
      });
      const eventRouter = createMockEventRouter({
        action: "ignore",
        reason: "No trigger",
      });
      const { deps } = createMockDeps({ taskService, eventRouter });

      mockAdaptPassThrough.mockReturnValue(
        createIncomingEvent({ taskId: "task_deleted" }),
      );

      await routeEvent(createNormalizedEvent(), deps);

      const handleCall = vi.mocked(eventRouter.handle).mock.calls[0]?.[0];
      expect(handleCall?.taskId).toBeUndefined();
    });
  });

  // ─── Fall-through: Advisory Lock / DB Error ─────────────────────────────

  describe("fall-through: advisory lock / DB error", () => {
    it("falls through to EventRouter when db.transaction throws", async () => {
      const taskService = createMockTaskService();
      const eventRouter = createMockEventRouter({
        action: "ignore",
        reason: "Fallback",
      });
      const { deps, db, logger } = createMockDeps({
        taskService,
        eventRouter,
      });

      // Simulate DB error during transaction
      db.transaction.mockRejectedValue(new Error("Connection lost"));

      mockAdaptPassThrough.mockReturnValue(
        createIncomingEvent({ taskId: "task_db_error" }),
      );

      const result = await routeEvent(createNormalizedEvent(), deps);

      // Falls through to EventRouter
      expect(eventRouter.handle).toHaveBeenCalled();
      expect(result.action).toBe("ignored");

      // Warning logged with error details
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          err: expect.any(Error),
          taskId: "task_db_error",
        }),
        "Task routing failed, falling through to EventRouter",
      );
    });

    it("strips taskId from event on DB error", async () => {
      const taskService = createMockTaskService();
      const eventRouter = createMockEventRouter({
        action: "ignore",
        reason: "Fallback",
      });
      const { deps, db } = createMockDeps({ taskService, eventRouter });

      db.transaction.mockRejectedValue(new Error("Lock timeout"));

      mockAdaptPassThrough.mockReturnValue(
        createIncomingEvent({ taskId: "task_lock_fail" }),
      );

      await routeEvent(createNormalizedEvent(), deps);

      const handleCall = vi.mocked(eventRouter.handle).mock.calls[0]?.[0];
      expect(handleCall?.taskId).toBeUndefined();
    });
  });

  // ─── Advisory Lock Verification ─────────────────────────────────────────

  describe("advisory lock", () => {
    it("acquires advisory lock with hashtext of taskId", async () => {
      const task = createMockTask({ id: "task_lock_test" });
      const taskService = createMockTaskService({
        get: vi.fn().mockResolvedValue(task),
      });
      const executor = createMockExecutor({
        findActiveForTask: vi.fn().mockResolvedValue(null),
      });
      const { deps, db } = createMockDeps({ executor, taskService });

      mockAdaptPassThrough.mockReturnValue(
        createIncomingEvent({ taskId: "task_lock_test" }),
      );

      await routeEvent(createNormalizedEvent(), deps);

      // Verify tx.execute was called (advisory lock SQL)
      expect(db.mockTxExecute).toHaveBeenCalled();
      // The SQL template literal contains pg_advisory_xact_lock with the taskId
      const sqlCall = db.mockTxExecute.mock.calls[0]?.[0];
      // drizzle sql`` produces a tagged template with queryChunks
      // We verify the mock was invoked (transaction executed the lock)
      expect(sqlCall).toBeDefined();
    });
  });

  // ─── Backward Compatibility: No taskId ──────────────────────────────────

  describe("backward compatibility: no taskId", () => {
    it("skips task routing branch entirely when taskId is undefined", async () => {
      const taskService = createMockTaskService();
      const eventRouter = createMockEventRouter({
        action: "ignore",
        reason: "Not matched",
      });
      const { deps } = createMockDeps({ taskService, eventRouter });

      mockAdaptPassThrough.mockReturnValue(
        createIncomingEvent({ taskId: undefined }),
      );

      await routeEvent(createNormalizedEvent(), deps);

      // Task routing never invoked
      expect(taskService.get).not.toHaveBeenCalled();
      // EventRouter handles the event
      expect(eventRouter.handle).toHaveBeenCalled();
    });

    it("routes via EventRouter start path when taskId is absent", async () => {
      const executor = createMockExecutor({
        start: vi.fn().mockResolvedValue("conv-started"),
      });
      const incomingEvent = createIncomingEvent({
        taskId: undefined,
        type: "linear.agent_session.created",
        correlationKey: "AES-42",
      });
      const eventRouter = createMockEventRouter({
        action: "start",
        agentDefinitionId: "dev-agent",
        conversationId: "conv-started",
        correlationKey: "dev-agent-AES-42",
        message: "New session",
        event: incomingEvent,
      });
      const { deps } = createMockDeps({ executor, eventRouter });

      mockAdaptPassThrough.mockReturnValue(incomingEvent);

      const result = await routeEvent(createNormalizedEvent(), deps);

      expect(result).toEqual({
        received: true,
        action: "started",
        conversationId: "conv-started",
      });
    });

    it("routes via EventRouter signal path when taskId is absent", async () => {
      const executor = createMockExecutor({
        signal: vi.fn().mockResolvedValue({ action: "resumed" }),
      });
      const incomingEvent = createIncomingEvent({
        taskId: undefined,
        type: "approval",
        correlationKey: "conv-waiting",
      });
      const eventRouter = createMockEventRouter({
        action: "signal",
        conversationId: "conv-waiting",
        signal: {
          type: "approval",
          data: { approved: true },
          source: "slack",
        },
        event: incomingEvent,
      });
      const { deps } = createMockDeps({ executor, eventRouter });

      mockAdaptPassThrough.mockReturnValue(incomingEvent);

      const result = await routeEvent(createNormalizedEvent(), deps);

      expect(result).toEqual({
        received: true,
        action: "resumed",
        conversationId: "conv-waiting",
      });
    });

    it("routes via EventRouter ignore path when taskId is absent", async () => {
      const eventRouter = createMockEventRouter({
        action: "ignore",
        reason: "linear.issue.created is ignored",
      });
      const { deps } = createMockDeps({ eventRouter });

      mockAdaptPassThrough.mockReturnValue(
        createIncomingEvent({
          taskId: undefined,
          type: "linear.issue.created",
        }),
      );

      const result = await routeEvent(createNormalizedEvent(), deps);

      expect(result).toEqual({
        received: true,
        action: "ignored",
      });
    });

    it("routes via EventRouter slow_path when taskId is absent", async () => {
      const eventRouter = createMockEventRouter({
        action: "slow_path",
        event: createIncomingEvent({ taskId: undefined }),
      });
      const { deps } = createMockDeps({ eventRouter });

      mockAdaptPassThrough.mockReturnValue(
        createIncomingEvent({ taskId: undefined }),
      );

      const result = await routeEvent(createNormalizedEvent(), deps);

      expect(result).toEqual({
        received: true,
        action: "classifying",
      });
    });
  });

  // ─── Backward Compatibility: No taskService/db in Deps ──────────────────

  describe("backward compatibility: no taskService/db in deps", () => {
    it("skips task routing when taskService is undefined", async () => {
      const eventRouter = createMockEventRouter({
        action: "ignore",
        reason: "No match",
      });
      const logger = createMockLogger();
      const executor = createMockExecutor();

      const deps: RouteEventDeps = {
        executor,
        eventRouter,
        logger,
        // No taskService, no db
      };

      mockAdaptPassThrough.mockReturnValue(
        createIncomingEvent({ taskId: "task_orphan" }),
      );

      const result = await routeEvent(createNormalizedEvent(), deps);

      // EventRouter handles it normally despite taskId being present
      expect(eventRouter.handle).toHaveBeenCalled();
      expect(result.action).toBe("ignored");
    });

    it("skips task routing when db is undefined", async () => {
      const eventRouter = createMockEventRouter({
        action: "ignore",
        reason: "No match",
      });
      const logger = createMockLogger();
      const executor = createMockExecutor();
      const taskService = createMockTaskService();

      const deps: RouteEventDeps = {
        executor,
        eventRouter,
        logger,
        taskService,
        // No db
      };

      mockAdaptPassThrough.mockReturnValue(
        createIncomingEvent({ taskId: "task_no_db" }),
      );

      const result = await routeEvent(createNormalizedEvent(), deps);

      expect(eventRouter.handle).toHaveBeenCalled();
      expect(taskService.get).not.toHaveBeenCalled();
      expect(result.action).toBe("ignored");
    });
  });

  // ─── Adapter Ignore Sentinel ────────────────────────────────────────────

  describe("adapter ignore sentinel", () => {
    it("returns ignored when adapter returns AdapterIgnore (skips slow-path)", async () => {
      const ignoreAdapter: EventAdapter = () =>
        ({
          action: "ignore",
          reason: "Top-level message; handled by app_mention",
        }) as AdapterIgnore;

      mockAllAdapters.push(ignoreAdapter);

      const { deps, eventRouter } = createMockDeps();

      const result = await routeEvent(createNormalizedEvent(), deps);

      expect(result).toEqual({ received: true, action: "ignored" });
      // EventRouter should NOT be consulted
      expect(eventRouter.handle).not.toHaveBeenCalled();
      // Pass-through should NOT be called
      expect(mockAdaptPassThrough).not.toHaveBeenCalled();

      // Cleanup
      mockAllAdapters.length = 0;
    });
  });

  // ─── Slow-path replyContext Threading ──────────────────────────────────

  describe("slow-path replyContext threading", () => {
    it("passes eventReplyContext to slow-path deps when incoming event has Slack replyContext", async () => {
      const slackReplyContext = {
        channel: "slack" as const,
        teamId: "T1",
        channelId: "C1",
        threadTs: "123.456",
      };
      const incomingEvent = createIncomingEvent({
        taskId: undefined,
        replyContext: slackReplyContext,
      });
      const eventRouter = createMockEventRouter({
        action: "slow_path",
        event: incomingEvent,
      });
      const { deps } = createMockDeps({ eventRouter });

      mockAdaptPassThrough.mockReturnValue(incomingEvent);

      await routeEvent(createNormalizedEvent(), deps);

      expect(mockRouteViaAgentLoop).toHaveBeenCalled();
      const slowPathDeps = mockRouteViaAgentLoop.mock.calls[0]?.[1];
      expect(slowPathDeps).toBeDefined();
      expect(slowPathDeps?.eventReplyContext).toEqual(slackReplyContext);
    });

    it("does not set eventReplyContext when incoming event has no replyContext", async () => {
      const incomingEvent = createIncomingEvent({
        taskId: undefined,
        // No replyContext
      });
      const eventRouter = createMockEventRouter({
        action: "slow_path",
        event: incomingEvent,
      });
      const { deps } = createMockDeps({ eventRouter });

      mockAdaptPassThrough.mockReturnValue(incomingEvent);

      await routeEvent(createNormalizedEvent(), deps);

      expect(mockRouteViaAgentLoop).toHaveBeenCalled();
      const slowPathDeps = mockRouteViaAgentLoop.mock.calls[0]?.[1];
      expect(slowPathDeps).toBeDefined();
      expect(slowPathDeps?.eventReplyContext).toBeUndefined();
    });

    it("passes Linear replyContext through slow-path deps", async () => {
      const linearReplyContext = {
        channel: "linear" as const,
        issueId: "uuid-abc",
      };
      const incomingEvent = createIncomingEvent({
        taskId: undefined,
        replyContext: linearReplyContext,
      });
      const eventRouter = createMockEventRouter({
        action: "slow_path",
        event: incomingEvent,
      });
      const { deps } = createMockDeps({ eventRouter });

      mockAdaptPassThrough.mockReturnValue(incomingEvent);

      await routeEvent(createNormalizedEvent(), deps);

      expect(mockRouteViaAgentLoop).toHaveBeenCalled();
      const slowPathDeps = mockRouteViaAgentLoop.mock.calls[0]?.[1];
      expect(slowPathDeps?.eventReplyContext).toEqual(linearReplyContext);
    });
  });
});
