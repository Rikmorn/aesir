/**
 * Core Router Integration Tests
 *
 * Tests for routeEvent: fast-path first, slow-path fallback,
 * ROUT-06 alert sending on failure, and error handling.
 */

import type { PinoLogger } from "@aesir/platform";
import type { NormalizedEvent } from "@aesir/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FastPathAction, RouteResult, RouterDeps } from "./types.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("./fast-path.js", () => ({
  matchFastPath: vi.fn(),
  executeFastPath: vi.fn(),
}));

vi.mock("./slow-path.js", () => ({
  routeViaAgentLoop: vi.fn(),
}));

vi.mock("../shared/mcp/index.js", () => ({
  callMcpTool: vi.fn().mockResolvedValue(undefined),
}));

// Import after mock setup
const { matchFastPath, executeFastPath } = await import("./fast-path.js");
const { routeViaAgentLoop } = await import("./slow-path.js");
const { callMcpTool } = await import("../shared/mcp/index.js");
const { routeEvent } = await import("./router.js");

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

function createMockDeps(): RouterDeps {
  return {
    workflowClient: {
      workflow: {
        getHandle: vi.fn(),
        start: vi.fn(),
        list: vi.fn(),
      },
    } as unknown as RouterDeps["workflowClient"],
    logger: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      child: vi.fn().mockReturnValue({
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
        child: vi.fn().mockReturnThis(),
      }),
    } as unknown as PinoLogger,
    alertsChannel: "C-alerts",
  };
}

// ---------------------------------------------------------------------------
// routeEvent
// ---------------------------------------------------------------------------

describe("routeEvent", () => {
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
    const result = await routeEvent(event, deps);

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
    await routeEvent(event, deps);

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
    const result = await routeEvent(event, deps);

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

    await routeEvent(event, deps);

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
    const result = await routeEvent(event, deps);

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
    const result = await routeEvent(event, deps);

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
    const result = await routeEvent(event, deps);

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
    const result = await routeEvent(event, deps);

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
    const result = await routeEvent(event, deps);

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
    await routeEvent(event, deps);

    expect(mockCallMcpTool).not.toHaveBeenCalled();
  });
});
