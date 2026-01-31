/**
 * Slow-Path Router Tests
 *
 * Tests for the LLM agentic loop-based routing path.
 * Verifies correct model, iteration limit, system prompt, tools,
 * and result mapping from AgentLoopResult to RouteResult.
 */

import type { PinoLogger } from "@aesir/platform";
import type { NormalizedEvent } from "@aesir/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentLoopResult } from "../shared/agent-loop/types.js";
import type { RouterDeps } from "./types.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../shared/agent-loop/index.js", () => ({
  runAgentLoop: vi.fn(),
}));

// Import after mock setup
const { runAgentLoop } = await import("../shared/agent-loop/index.js");
const { formatEventForLLM, routeViaAgentLoop } = await import("./slow-path.js");

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

function createTestEvent(
  overrides: Partial<NormalizedEvent> = {},
): NormalizedEvent {
  return {
    id: "evt_slow123",
    type: "slack.message.created",
    source: "slack",
    timestamp: "2026-01-30T14:00:00Z",
    correlationId: "corr-slow",
    payload: { text: "looks good, ship it" },
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

function createMockResult(
  overrides: Partial<AgentLoopResult> = {},
): AgentLoopResult {
  return {
    status: "completed",
    output: "Routed via signal_workflow",
    toolCallCount: 1,
    tokenCount: { input: 100, output: 50 },
    trace: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// routeViaAgentLoop
// ---------------------------------------------------------------------------

describe("routeViaAgentLoop", () => {
  let deps: RouterDeps;
  const mockRunAgentLoop = runAgentLoop as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    deps = createMockDeps();
    vi.clearAllMocks();
  });

  it("calls runAgentLoop with model claude-haiku-4-5-20251016", async () => {
    mockRunAgentLoop.mockResolvedValue(createMockResult());
    const event = createTestEvent();

    await routeViaAgentLoop(event, deps);

    expect(mockRunAgentLoop).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-haiku-4-5-20251016",
      }),
    );
  });

  it("calls runAgentLoop with maxIterations 10", async () => {
    mockRunAgentLoop.mockResolvedValue(createMockResult());
    const event = createTestEvent();

    await routeViaAgentLoop(event, deps);

    expect(mockRunAgentLoop).toHaveBeenCalledWith(
      expect.objectContaining({
        maxIterations: 10,
      }),
    );
  });

  it("calls runAgentLoop with ROUTER_SYSTEM_PROMPT", async () => {
    mockRunAgentLoop.mockResolvedValue(createMockResult());
    const event = createTestEvent();

    await routeViaAgentLoop(event, deps);

    const callArgs = mockRunAgentLoop.mock.calls[0]![0];
    expect(callArgs.systemPrompt).toContain("Aesir Smart Router");
    expect(callArgs.systemPrompt).toContain("routing classifier");
  });

  it("provides 4 router tools", async () => {
    mockRunAgentLoop.mockResolvedValue(createMockResult());
    const event = createTestEvent();

    await routeViaAgentLoop(event, deps);

    const callArgs = mockRunAgentLoop.mock.calls[0]![0];
    expect(callArgs.tools).toHaveLength(4);
    const toolNames = callArgs.tools.map((t: { name: string }) => t.name);
    expect(toolNames).toContain("query_running_workflows");
    expect(toolNames).toContain("start_workflow");
    expect(toolNames).toContain("signal_workflow");
    expect(toolNames).toContain("send_message");
  });

  it("returns routed when loop completes with tool calls", async () => {
    mockRunAgentLoop.mockResolvedValue(
      createMockResult({
        status: "completed",
        toolCallCount: 2,
        output: "Signaled planApproval",
      }),
    );
    const event = createTestEvent();

    const result = await routeViaAgentLoop(event, deps);

    expect(result.status).toBe("routed");
    expect(result.action).toBe("Signaled planApproval");
  });

  it("returns ignored when loop completes without tool calls", async () => {
    mockRunAgentLoop.mockResolvedValue(
      createMockResult({
        status: "completed",
        toolCallCount: 0,
        output: "No action needed for this event",
      }),
    );
    const event = createTestEvent();

    const result = await routeViaAgentLoop(event, deps);

    expect(result.status).toBe("ignored");
    expect(result.action).toBe("No action needed for this event");
  });

  it("returns failed when loop hits max_iterations", async () => {
    mockRunAgentLoop.mockResolvedValue(
      createMockResult({
        status: "max_iterations",
        toolCallCount: 10,
        output: "",
      }),
    );
    const event = createTestEvent();

    const result = await routeViaAgentLoop(event, deps);

    expect(result.status).toBe("failed");
    expect(result.error).toContain("iteration limit");
  });

  it("returns failed when loop errors", async () => {
    mockRunAgentLoop.mockResolvedValue(
      createMockResult({
        status: "error",
        output: "API rate limit exceeded",
      }),
    );
    const event = createTestEvent();

    const result = await routeViaAgentLoop(event, deps);

    expect(result.status).toBe("failed");
    expect(result.error).toBe("API rate limit exceeded");
  });

  it("returns failed when runAgentLoop throws", async () => {
    mockRunAgentLoop.mockRejectedValue(new Error("Connection refused"));
    const event = createTestEvent();

    await expect(routeViaAgentLoop(event, deps)).rejects.toThrow(
      "Connection refused",
    );
  });

  it("passes formatted event as initialMessage", async () => {
    mockRunAgentLoop.mockResolvedValue(createMockResult());
    const event = createTestEvent({
      id: "evt_formatted",
      type: "linear.comment.created",
      source: "linear",
    });

    await routeViaAgentLoop(event, deps);

    const callArgs = mockRunAgentLoop.mock.calls[0]![0];
    expect(callArgs.initialMessage).toContain("evt_formatted");
    expect(callArgs.initialMessage).toContain("linear.comment.created");
    expect(callArgs.initialMessage).toContain("linear");
  });
});

// ---------------------------------------------------------------------------
// formatEventForLLM
// ---------------------------------------------------------------------------

describe("formatEventForLLM", () => {
  it("includes event ID", () => {
    const event = createTestEvent({ id: "evt_format1" });
    const formatted = formatEventForLLM(event);
    expect(formatted).toContain("evt_format1");
  });

  it("includes event type", () => {
    const event = createTestEvent({ type: "slack.message.created" });
    const formatted = formatEventForLLM(event);
    expect(formatted).toContain("slack.message.created");
  });

  it("includes event source", () => {
    const event = createTestEvent({ source: "linear" });
    const formatted = formatEventForLLM(event);
    expect(formatted).toContain("linear");
  });

  it("includes timestamp", () => {
    const event = createTestEvent({
      timestamp: "2026-01-30T14:30:00Z",
    });
    const formatted = formatEventForLLM(event);
    expect(formatted).toContain("2026-01-30T14:30:00Z");
  });

  it("includes JSON payload", () => {
    const event = createTestEvent({
      payload: { text: "test message", channel: "C123" },
    });
    const formatted = formatEventForLLM(event);
    expect(formatted).toContain("test message");
    expect(formatted).toContain("C123");
  });

  it("starts with routing instruction", () => {
    const event = createTestEvent();
    const formatted = formatEventForLLM(event);
    expect(formatted).toMatch(/^Route this event:/);
  });
});
