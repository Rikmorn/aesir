/**
 * Core Router Tests
 *
 * Tests for routeEventLegacy (Temporal-based) and routeEvent (v2.3 pipeline).
 */

import type { PinoLogger } from "@aesir/platform";
import type { NormalizedEvent } from "@aesir/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IncomingEvent } from "../adapters/types.js";
import type { ConversationExecutor, EventRouter } from "../framework/types.js";
import type {
  FastPathAction,
  RouteEventDeps,
  RouteResult,
  RouterDeps,
} from "./types.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("./fast-path.js", () => ({
  matchFastPath: vi.fn(),
  executeFastPath: vi.fn(),
}));

vi.mock("./slow-path.js", () => ({
  routeViaAgentLoop: vi.fn(),
  routeViaAgentLoopV2: vi.fn().mockResolvedValue({ status: "routed" }),
}));

vi.mock("../shared/mcp/index.js", () => ({
  callMcpTool: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../adapters/index.js", () => ({
  ALL_ADAPTERS: [],
}));

vi.mock("../adapters/pass-through.js", () => ({
  adaptPassThrough: vi.fn(),
}));

// Import after mock setup
const { matchFastPath, executeFastPath } = await import("./fast-path.js");
const { routeViaAgentLoop, routeViaAgentLoopV2 } = await import(
  "./slow-path.js"
);
const { callMcpTool } = await import("../shared/mcp/index.js");
const { routeEventLegacy, routeEvent } = await import("./router.js");
const { ALL_ADAPTERS } = await import("../adapters/index.js");
const { adaptPassThrough } = await import("../adapters/pass-through.js");

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

function createTestEvent(
  overrides: Partial<NormalizedEvent> = {},
): NormalizedEvent {
  return {
    id: "evt_router123",
    type: "slack.message.created",
    source: "slack",
    timestamp: "2026-01-30T15:00:00Z",
    correlationId: "corr-router",
    payload: { text: "test message" },
    ...overrides,
  };
}

function createMockLogger(): PinoLogger {
  const childLogger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnValue(childLogger),
  } as unknown as PinoLogger;
}

function createMockDeps(): RouterDeps {
  return {
    workflowClient: {
      workflow: {
        getHandle: vi.fn(),
        start: vi.fn(),
        list: vi.fn(),
      },
    } as unknown as RouterDeps["workflowClient"],
    logger: createMockLogger(),
    alertsChannel: "C-alerts",
  };
}

function createMockRouteEventDeps(
  overrides: Partial<RouteEventDeps> = {},
): RouteEventDeps {
  return {
    executor: {
      start: vi.fn(),
      signal: vi.fn(),
      get: vi.fn(),
      cancel: vi.fn(),
      list: vi.fn(),
      startWorker: vi.fn(),
      stopWorker: vi.fn(),
    } as unknown as ConversationExecutor,
    eventRouter: {
      handle: vi.fn(),
      loadStartRules: vi.fn(),
    } as unknown as EventRouter,
    logger: createMockLogger(),
    alertsChannel: "C-alerts",
    ...overrides,
  };
}

function createIncomingEvent(
  overrides: Partial<IncomingEvent> = {},
): IncomingEvent {
  return {
    type: "slack.app_mention.created",
    data: { text: "test" },
    source: "slack:webhook",
    correlationKey: "T123-C456-1234567890",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// routeEventLegacy
// ---------------------------------------------------------------------------

describe("routeEventLegacy", () => {
  let deps: RouterDeps;
  const mockMatchFastPath = matchFastPath as ReturnType<typeof vi.fn>;
  const mockExecuteFastPath = executeFastPath as ReturnType<typeof vi.fn>;
  const mockRouteViaAgentLoop = routeViaAgentLoop as ReturnType<typeof vi.fn>;
  const mockCallMcpTool = callMcpTool as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    deps = createMockDeps();
    vi.clearAllMocks();
  });

  // === Fast-Path Usage ===

  it("uses fast-path when matchFastPath returns a result", async () => {
    const fastAction: FastPathAction = {
      type: "signal",
      workflowId: "dev-agent-TASK-1",
      signal: "planApproval",
      payload: { approved: true },
    };
    const routeResult: RouteResult = {
      status: "routed",
      action: "signal:planApproval",
      workflowId: "dev-agent-TASK-1",
    };

    mockMatchFastPath.mockReturnValue(fastAction);
    mockExecuteFastPath.mockResolvedValue(routeResult);

    const event = createTestEvent();
    const result = await routeEventLegacy(event, deps);

    expect(result.status).toBe("routed");
    expect(result.action).toBe("signal:planApproval");
    expect(mockMatchFastPath).toHaveBeenCalledWith(event);
    expect(mockExecuteFastPath).toHaveBeenCalledWith(fastAction, deps);
  });

  it("does not call slow-path when fast-path matches", async () => {
    const fastAction: FastPathAction = {
      type: "ignore",
      reason: "Handled elsewhere",
    };
    mockMatchFastPath.mockReturnValue(fastAction);
    mockExecuteFastPath.mockResolvedValue({
      status: "ignored",
      action: "ignore:Handled elsewhere",
    });

    const event = createTestEvent();
    await routeEventLegacy(event, deps);

    expect(mockRouteViaAgentLoop).not.toHaveBeenCalled();
  });

  // === Slow-Path Fallback ===

  it("uses slow-path when matchFastPath returns null", async () => {
    mockMatchFastPath.mockReturnValue(null);
    mockRouteViaAgentLoop.mockResolvedValue({
      status: "routed",
      action: "LLM routed via tool calls",
    });

    const event = createTestEvent();
    const result = await routeEventLegacy(event, deps);

    expect(result.status).toBe("routed");
    expect(mockRouteViaAgentLoop).toHaveBeenCalledWith(event, deps);
  });

  it("passes correct event to both paths", async () => {
    const event = createTestEvent({
      id: "evt_specific",
      type: "linear.comment.created",
      source: "linear",
    });

    mockMatchFastPath.mockReturnValue(null);
    mockRouteViaAgentLoop.mockResolvedValue({
      status: "routed",
      action: "signal:planApproval",
    });

    await routeEventLegacy(event, deps);

    expect(mockMatchFastPath).toHaveBeenCalledWith(event);
    expect(mockRouteViaAgentLoop).toHaveBeenCalledWith(event, deps);
  });

  // === ROUT-06: Alert on Failure ===

  it("sends alert when slow-path returns failed status (ROUT-06)", async () => {
    mockMatchFastPath.mockReturnValue(null);
    mockRouteViaAgentLoop.mockResolvedValue({
      status: "failed",
      error: "Router hit iteration limit",
    });

    const event = createTestEvent({ id: "evt_fail1" });
    const result = await routeEventLegacy(event, deps);

    expect(result.status).toBe("failed");
    expect(mockCallMcpTool).toHaveBeenCalledWith(
      expect.objectContaining({
        integration: "slack",
        tool: "send_message",
        params: expect.objectContaining({
          channel: "C-alerts",
          text: expect.stringContaining("evt_fail1"),
        }),
      }),
    );
  });

  it("sends alert when fast-path execution throws (ROUT-06)", async () => {
    const fastAction: FastPathAction = {
      type: "signal",
      workflowId: "dev-agent-ERR",
      signal: "planApproval",
      payload: { approved: true },
    };

    mockMatchFastPath.mockReturnValue(fastAction);
    mockExecuteFastPath.mockRejectedValue(new Error("Temporal unavailable"));

    const event = createTestEvent({ id: "evt_fail2" });
    const result = await routeEventLegacy(event, deps);

    expect(result.status).toBe("failed");
    expect(result.error).toBe("Temporal unavailable");
    expect(mockCallMcpTool).toHaveBeenCalledWith(
      expect.objectContaining({
        integration: "slack",
        tool: "send_message",
        params: expect.objectContaining({
          channel: "C-alerts",
          text: expect.stringContaining("Temporal unavailable"),
        }),
      }),
    );
  });

  it("handles alert sending failure gracefully (best-effort)", async () => {
    mockMatchFastPath.mockReturnValue(null);
    mockRouteViaAgentLoop.mockResolvedValue({
      status: "failed",
      error: "LLM error",
    });
    mockCallMcpTool.mockRejectedValue(new Error("Slack API down"));

    const event = createTestEvent();
    const result = await routeEventLegacy(event, deps);

    // Should still return failed, not throw
    expect(result.status).toBe("failed");
    expect(result.error).toContain("LLM error");
  });

  // === Slow-Path Throws ===

  it("returns failed status when slow-path throws", async () => {
    mockMatchFastPath.mockReturnValue(null);
    mockRouteViaAgentLoop.mockRejectedValue(
      new Error("Network connection lost"),
    );

    const event = createTestEvent();
    const result = await routeEventLegacy(event, deps);

    expect(result.status).toBe("failed");
    expect(result.error).toBe("Network connection lost");
  });

  // === No Alerts Channel ===

  it("skips alert when no alertsChannel configured", async () => {
    deps.alertsChannel = undefined;
    mockMatchFastPath.mockReturnValue(null);
    mockRouteViaAgentLoop.mockResolvedValue({
      status: "failed",
      error: "Some failure",
    });

    const event = createTestEvent();
    const result = await routeEventLegacy(event, deps);

    expect(result.status).toBe("failed");
    // callMcpTool should not be called for alerting when no channel
    expect(mockCallMcpTool).not.toHaveBeenCalled();
  });

  // === Does not alert on success ===

  it("does not send alert on successful slow-path routing", async () => {
    mockMatchFastPath.mockReturnValue(null);
    mockRouteViaAgentLoop.mockResolvedValue({
      status: "routed",
      action: "signal:planApproval",
    });

    const event = createTestEvent();
    await routeEventLegacy(event, deps);

    expect(mockCallMcpTool).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// routeEvent (v2.3)
// ---------------------------------------------------------------------------

describe("routeEvent (v2.3)", () => {
  let deps: RouteEventDeps;
  const mockCallMcpTool = callMcpTool as ReturnType<typeof vi.fn>;
  const mockRouteViaAgentLoopV2 = routeViaAgentLoopV2 as ReturnType<
    typeof vi.fn
  >;
  const mockAdaptPassThrough = adaptPassThrough as ReturnType<typeof vi.fn>;
  const mutableAdapters = ALL_ADAPTERS as ReturnType<typeof vi.fn>[];

  beforeEach(() => {
    deps = createMockRouteEventDeps();
    vi.clearAllMocks();

    // Default: pass-through adapter returns a generic IncomingEvent
    mockAdaptPassThrough.mockReturnValue(createIncomingEvent());

    // Reset adapters array (mocked as empty)
    mutableAdapters.length = 0;
  });

  // === Start Action ===

  it("routes start action via executor.start()", async () => {
    const incomingEvent = createIncomingEvent({
      type: "linear.agent_session.created",
      correlationKey: "ABC-123",
      message: "Resolve Linear issue ABC-123: 'Add /healthz endpoint'",
    });
    mockAdaptPassThrough.mockReturnValue(incomingEvent);

    const mockHandle = deps.eventRouter.handle as ReturnType<typeof vi.fn>;
    mockHandle.mockReturnValue({
      action: "start",
      agentDefinitionId: "dev-agent",
      conversationId: "dev-agent-ABC-123",
      correlationKey: "ABC-123",
      message: "Resolve Linear issue ABC-123: 'Add /healthz endpoint'",
      event: incomingEvent,
    });

    const mockStart = deps.executor.start as ReturnType<typeof vi.fn>;
    mockStart.mockResolvedValue("dev-agent-ABC-123");

    const event = createTestEvent({
      type: "linear.agent_session.created",
      source: "linear",
    });
    const result = await routeEvent(event, deps);

    expect(result).toEqual({
      received: true,
      action: "started",
      conversationId: "dev-agent-ABC-123",
    });

    expect(mockStart).toHaveBeenCalledWith({
      agentDefinitionId: "dev-agent",
      correlationKey: "ABC-123",
      initialMessage: "Resolve Linear issue ABC-123: 'Add /healthz endpoint'",
    });

    // No MCP enrichment calls
    expect(mockCallMcpTool).not.toHaveBeenCalled();
  });

  // === Signal Action ===

  it("routes signal action via executor.signal()", async () => {
    const incomingEvent = createIncomingEvent({
      type: "approval",
      correlationKey: "ABC-123",
      message: "User approved the plan",
    });
    mockAdaptPassThrough.mockReturnValue(incomingEvent);

    const mockHandle = deps.eventRouter.handle as ReturnType<typeof vi.fn>;
    mockHandle.mockReturnValue({
      action: "signal",
      conversationId: "dev-agent-ABC-123",
      signal: {
        type: "approval",
        data: { approved: true },
        message: "User approved the plan",
        source: "slack:webhook",
      },
      event: incomingEvent,
    });

    const mockSignal = deps.executor.signal as ReturnType<typeof vi.fn>;
    mockSignal.mockResolvedValue({ action: "resumed" });

    const event = createTestEvent({
      type: "slack.action.created",
      source: "slack",
    });
    const result = await routeEvent(event, deps);

    expect(result).toEqual({
      received: true,
      action: "resumed",
      conversationId: "dev-agent-ABC-123",
    });

    expect(mockSignal).toHaveBeenCalledWith("dev-agent-ABC-123", {
      type: "approval",
      data: { approved: true },
      message: "User approved the plan",
      source: "slack:webhook",
    });
  });

  // === Slow Path ===

  it("returns classifying for slow_path (fire-and-forget)", async () => {
    const incomingEvent = createIncomingEvent({
      type: "unknown.event",
    });
    mockAdaptPassThrough.mockReturnValue(incomingEvent);

    const mockHandle = deps.eventRouter.handle as ReturnType<typeof vi.fn>;
    mockHandle.mockReturnValue({
      action: "slow_path",
      event: incomingEvent,
    });

    mockRouteViaAgentLoopV2.mockResolvedValue({ status: "routed" });

    const event = createTestEvent({ type: "unknown.event" });
    const result = await routeEvent(event, deps);

    // Returns immediately without waiting for slow-path
    expect(result).toEqual({
      received: true,
      action: "classifying",
    });

    // routeViaAgentLoopV2 was called (fire-and-forget)
    expect(mockRouteViaAgentLoopV2).toHaveBeenCalledWith(event, deps);
  });

  // === Ignore Action ===

  it("returns ignored for ignore action", async () => {
    const incomingEvent = createIncomingEvent({
      type: "linear.issue.created",
    });
    mockAdaptPassThrough.mockReturnValue(incomingEvent);

    const mockHandle = deps.eventRouter.handle as ReturnType<typeof vi.fn>;
    mockHandle.mockReturnValue({
      action: "ignore",
      reason: "Event type explicitly ignored: linear.issue.created",
    });

    const event = createTestEvent({
      type: "linear.issue.created",
      source: "linear",
    });
    const result = await routeEvent(event, deps);

    expect(result).toEqual({
      received: true,
      action: "ignored",
    });
  });

  // === Pass-Through Adapter Fallback ===

  it("falls through to pass-through adapter when no adapter matches", async () => {
    // ALL_ADAPTERS is empty (mocked), so all return null
    const passThroughEvent = createIncomingEvent({
      type: "unknown.source.event",
      source: "unknown:webhook",
    });
    mockAdaptPassThrough.mockReturnValue(passThroughEvent);

    const mockHandle = deps.eventRouter.handle as ReturnType<typeof vi.fn>;
    mockHandle.mockReturnValue({
      action: "slow_path",
      event: passThroughEvent,
    });

    mockRouteViaAgentLoopV2.mockResolvedValue({ status: "routed" });

    const event = createTestEvent({
      type: "slack.unknown.event",
    });
    const result = await routeEvent(event, deps);

    expect(result).toEqual({
      received: true,
      action: "classifying",
    });

    // Verify pass-through was called with the event
    expect(mockAdaptPassThrough).toHaveBeenCalledWith(event);
    // Verify EventRouter.handle() received the pass-through result
    expect(mockHandle).toHaveBeenCalledWith(passThroughEvent);
  });

  // === Error Handling ===

  it("returns error and sends alert on executor failure", async () => {
    const incomingEvent = createIncomingEvent();
    mockAdaptPassThrough.mockReturnValue(incomingEvent);

    const mockHandle = deps.eventRouter.handle as ReturnType<typeof vi.fn>;
    mockHandle.mockReturnValue({
      action: "start",
      agentDefinitionId: "dev-agent",
      conversationId: "dev-agent-ABC-123",
      correlationKey: "ABC-123",
      message: "test message",
      event: incomingEvent,
    });

    const mockStart = deps.executor.start as ReturnType<typeof vi.fn>;
    mockStart.mockRejectedValue(new Error("DB connection lost"));

    const event = createTestEvent();
    const result = await routeEvent(event, deps);

    expect(result).toEqual({
      received: true,
      action: "error",
    });

    // Alert should be sent
    expect(mockCallMcpTool).toHaveBeenCalledWith(
      expect.objectContaining({
        integration: "slack",
        tool: "send_message",
        params: expect.objectContaining({
          channel: "C-alerts",
        }),
      }),
    );
  });

  // === Idempotent Signal ===

  it("does not alert on idempotent signal results", async () => {
    const incomingEvent = createIncomingEvent({
      type: "approval",
      correlationKey: "ABC-123",
    });
    mockAdaptPassThrough.mockReturnValue(incomingEvent);

    const mockHandle = deps.eventRouter.handle as ReturnType<typeof vi.fn>;
    mockHandle.mockReturnValue({
      action: "signal",
      conversationId: "dev-agent-ABC-123",
      signal: {
        type: "approval",
        data: { approved: true },
        deduplicationId: "dup-123",
      },
      event: incomingEvent,
    });

    const mockSignal = deps.executor.signal as ReturnType<typeof vi.fn>;
    mockSignal.mockResolvedValue({ action: "deduplicated" });

    const event = createTestEvent();
    const result = await routeEvent(event, deps);

    expect(result).toEqual({
      received: true,
      action: "deduplicated",
      conversationId: "dev-agent-ABC-123",
    });

    // No Slack alert for idempotent signal
    expect(mockCallMcpTool).not.toHaveBeenCalled();

    // Check logger.info was called (via child logger)
    const childLogger = (deps.logger.child as ReturnType<typeof vi.fn>).mock
      .results[0]?.value;
    expect(childLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        signalAction: "deduplicated",
      }),
      "Signal delivered",
    );
  });

  // === Idempotent Start ===

  it("does not alert on idempotent start results", async () => {
    const incomingEvent = createIncomingEvent({
      type: "linear.agent_session.created",
      correlationKey: "ABC-123",
    });
    mockAdaptPassThrough.mockReturnValue(incomingEvent);

    const mockHandle = deps.eventRouter.handle as ReturnType<typeof vi.fn>;
    mockHandle.mockReturnValue({
      action: "start",
      agentDefinitionId: "dev-agent",
      conversationId: "dev-agent-ABC-123",
      correlationKey: "ABC-123",
      message: "Resolve Linear issue ABC-123",
      event: incomingEvent,
    });

    // executor.start() returns a DIFFERENT ID -- indicates idempotent match
    // (conversation already existed with a different ID format)
    const mockStart = deps.executor.start as ReturnType<typeof vi.fn>;
    mockStart.mockResolvedValue("existing-conv-id");

    const event = createTestEvent({
      type: "linear.agent_session.created",
      source: "linear",
    });
    const result = await routeEvent(event, deps);

    expect(result).toEqual({
      received: true,
      action: "started",
      conversationId: "existing-conv-id",
    });

    // No Slack alert for idempotent start
    expect(mockCallMcpTool).not.toHaveBeenCalled();

    // Check idempotent start was logged at info level
    const childLogger = (deps.logger.child as ReturnType<typeof vi.fn>).mock
      .results[0]?.value;
    expect(childLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "existing-conv-id" }),
      "Conversation already exists (idempotent start)",
    );
  });

  // === Generic Alert Without Stack Traces ===

  it("sends generic alert without stack traces", async () => {
    const incomingEvent = createIncomingEvent();
    mockAdaptPassThrough.mockReturnValue(incomingEvent);

    const mockHandle = deps.eventRouter.handle as ReturnType<typeof vi.fn>;
    mockHandle.mockReturnValue({
      action: "start",
      agentDefinitionId: "dev-agent",
      conversationId: "dev-agent-ABC-123",
      correlationKey: "ABC-123",
      message: "test message",
      event: incomingEvent,
    });

    const mockStart = deps.executor.start as ReturnType<typeof vi.fn>;
    mockStart.mockRejectedValue(new Error("DB connection lost"));

    const event = createTestEvent({ id: "evt_err1" });
    await routeEvent(event, deps);

    // Alert message should be generic -- no stack traces, no error details
    expect(mockCallMcpTool).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          text: expect.stringContaining("Something went wrong"),
        }),
      }),
    );

    // Should NOT contain the actual error message
    const alertCall = mockCallMcpTool.mock.calls[0]?.[0];
    expect(alertCall?.params?.text).not.toContain("DB connection lost");
  });

  // === No MCP Enrichment Before Start ===

  it("does not call MCP enrichment before executor.start()", async () => {
    const incomingEvent = createIncomingEvent({
      type: "linear.agent_session.created",
      correlationKey: "AES-42",
      message: "Resolve Linear issue AES-42: 'Add /healthz endpoint'",
    });
    mockAdaptPassThrough.mockReturnValue(incomingEvent);

    const mockHandle = deps.eventRouter.handle as ReturnType<typeof vi.fn>;
    mockHandle.mockReturnValue({
      action: "start",
      agentDefinitionId: "dev-agent",
      conversationId: "dev-agent-AES-42",
      correlationKey: "AES-42",
      message: "Resolve Linear issue AES-42: 'Add /healthz endpoint'",
      event: incomingEvent,
    });

    const mockStart = deps.executor.start as ReturnType<typeof vi.fn>;
    mockStart.mockResolvedValue("dev-agent-AES-42");

    const event = createTestEvent({
      type: "linear.agent_session.created",
      source: "linear",
      payload: { issueId: "AES-42", title: "Add /healthz endpoint" },
    });
    const result = await routeEvent(event, deps);

    expect(result.action).toBe("started");

    // executor.start() received a simple string, not enriched issue details
    expect(mockStart).toHaveBeenCalledWith({
      agentDefinitionId: "dev-agent",
      correlationKey: "AES-42",
      initialMessage: "Resolve Linear issue AES-42: 'Add /healthz endpoint'",
    });

    // CRITICAL: callMcpTool was NOT called at all during the start path
    // This verifies no linear:get_issue or other MCP enrichment happened
    expect(mockCallMcpTool).not.toHaveBeenCalled();
  });

  // === Adapter Pipeline ===

  it("uses first matching adapter from ALL_ADAPTERS", async () => {
    // Add a mock adapter that matches
    const mockAdapter = vi.fn().mockReturnValue(
      createIncomingEvent({
        type: "slack.app_mention.created",
        correlationKey: "T123-C456-1234567890",
        message: "User mentioned bot in channel",
      }),
    );
    mutableAdapters.push(mockAdapter);

    const mockHandle = deps.eventRouter.handle as ReturnType<typeof vi.fn>;
    mockHandle.mockReturnValue({
      action: "start",
      agentDefinitionId: "product-agent",
      conversationId: "product-agent-T123-C456-1234567890",
      correlationKey: "T123-C456-1234567890",
      message: "User mentioned bot in channel",
      event: createIncomingEvent(),
    });

    const mockStart = deps.executor.start as ReturnType<typeof vi.fn>;
    mockStart.mockResolvedValue("product-agent-T123-C456-1234567890");

    const event = createTestEvent({
      type: "slack.app_mention.created",
      source: "slack",
    });
    await routeEvent(event, deps);

    // Adapter was called
    expect(mockAdapter).toHaveBeenCalledWith(event);
    // Pass-through was NOT called (adapter matched)
    expect(mockAdaptPassThrough).not.toHaveBeenCalled();
  });
});
