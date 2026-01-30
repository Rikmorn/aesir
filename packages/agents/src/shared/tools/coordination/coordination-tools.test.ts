/**
 * Coordination Tools Tests
 *
 * Unit tests for spawn_agent and request_human_input tool factories.
 * Tests input validation, sub-agent delegation, sentinel return values,
 * trace recording, and error handling.
 */

import type { PinoLogger } from "@aesir/platform";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentLoopResult } from "../../agent-loop/types.js";
import type { TraceRecorderCallbacks } from "../../db/trace-recorder.js";
import {
  createRequestHumanInputTool,
  HUMAN_INPUT_MARKER,
} from "./request-human-input.js";
import type { SpawnAgentDeps } from "./spawn-agent.js";
import { createSpawnAgentTool } from "./spawn-agent.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockRunAgentLoop = vi.fn();

vi.mock("../../agent-loop/run-agent-loop.js", () => ({
  runAgentLoop: (...args: unknown[]) => mockRunAgentLoop(...args),
}));

const mockCreateId = {
  agentInstance: vi.fn().mockReturnValue("ainst_test123"),
};

vi.mock("@aesir/types", () => ({
  createId: {
    agentInstance: () => mockCreateId.agentInstance(),
  },
}));

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

function createMockTraceRecorder(): TraceRecorderCallbacks {
  return {
    onToolCall: vi.fn(),
    onResponse: vi.fn(),
    onAgentSpawn: vi.fn(),
    onAgentComplete: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
    stepCount: vi.fn().mockReturnValue(0),
  };
}

function createMockLogger(): PinoLogger {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as PinoLogger;
}

function createMockTokenBudget() {
  return {
    total: 500_000,
    remaining: 500_000,
    isExhausted: vi.fn().mockReturnValue(false),
    deduct: vi.fn(),
  };
}

function createSpawnAgentDeps(
  overrides: Partial<SpawnAgentDeps> = {},
): SpawnAgentDeps {
  return {
    agentTypes: {
      researcher: {
        systemPrompt: "You are a researcher.",
        tools: [],
        maxIterations: 30,
      },
      coder: {
        systemPrompt: "You are a coder.",
        tools: [],
        maxIterations: 40,
      },
      tester: {
        systemPrompt: "You are a tester.",
        tools: [],
        maxIterations: 20,
      },
    },
    tokenBudget: createMockTokenBudget(),
    traceRecorder: createMockTraceRecorder(),
    logger: createMockLogger(),
    ...overrides,
  };
}

function createSuccessResult(output = "Task completed"): AgentLoopResult {
  return {
    status: "completed",
    output,
    toolCallCount: 5,
    tokenCount: { input: 1000, output: 500 },
    trace: [],
  };
}

function createErrorResult(output = "Something went wrong"): AgentLoopResult {
  return {
    status: "error",
    output,
    toolCallCount: 2,
    tokenCount: { input: 300, output: 100 },
    trace: [],
  };
}

// ---------------------------------------------------------------------------
// spawn_agent
// ---------------------------------------------------------------------------

describe("createSpawnAgentTool", () => {
  beforeEach(() => {
    mockRunAgentLoop.mockReset();
    mockCreateId.agentInstance.mockReturnValue("ainst_test123");
  });

  it("returns a ToolDefinition with correct name", () => {
    const tool = createSpawnAgentTool(createSpawnAgentDeps());
    expect(tool.name).toBe("spawn_agent");
    expect(tool.description).toBeTruthy();
    expect(tool.inputSchema).toBeDefined();
    expect(tool.execute).toBeTypeOf("function");
  });

  it("calls runAgentLoop with correct options on valid input", async () => {
    const deps = createSpawnAgentDeps();
    mockRunAgentLoop.mockResolvedValue(createSuccessResult());

    const tool = createSpawnAgentTool(deps);
    await tool.execute({
      agentType: "researcher",
      task: "Explore the codebase",
    });

    expect(mockRunAgentLoop).toHaveBeenCalledOnce();
    const options = mockRunAgentLoop.mock.calls[0]?.[0];
    expect(options.systemPrompt).toBe("You are a researcher.");
    expect(options.tools).toEqual([]);
    expect(options.initialMessage).toBe("Explore the codebase");
    expect(options.maxIterations).toBe(30);
    expect(options.tokenBudget).toBe(deps.tokenBudget);
    expect(options.logger).toBeDefined();
  });

  it("returns sub-agent output on successful completion", async () => {
    mockRunAgentLoop.mockResolvedValue(
      createSuccessResult("Found 3 relevant files"),
    );

    const tool = createSpawnAgentTool(createSpawnAgentDeps());
    const result = await tool.execute({
      agentType: "researcher",
      task: "Find auth files",
    });

    expect(result.content).toBe("Found 3 relevant files");
    expect(result.isError).toBeUndefined();
  });

  it("returns isError:true when sub-agent status is 'error'", async () => {
    mockRunAgentLoop.mockResolvedValue(createErrorResult("API key missing"));

    const tool = createSpawnAgentTool(createSpawnAgentDeps());
    const result = await tool.execute({
      agentType: "coder",
      task: "Implement feature",
    });

    expect(result.isError).toBe(true);
    expect(result.content).toBe("Sub-agent error: API key missing");
  });

  it("returns isError:true for unknown agent type (rejected by enum validation)", async () => {
    const tool = createSpawnAgentTool(createSpawnAgentDeps());
    const result = await tool.execute({
      agentType: "hacker",
      task: "Do work",
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Invalid input");
  });

  it("returns isError:true for invalid input (missing required fields)", async () => {
    const tool = createSpawnAgentTool(createSpawnAgentDeps());
    const result = await tool.execute({});

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Invalid input");
    expect(mockRunAgentLoop).not.toHaveBeenCalled();
  });

  it("catches thrown errors and returns isError:true", async () => {
    mockRunAgentLoop.mockRejectedValue(new Error("Network failure"));

    const tool = createSpawnAgentTool(createSpawnAgentDeps());
    const result = await tool.execute({
      agentType: "tester",
      task: "Run tests",
    });

    expect(result.isError).toBe(true);
    expect(result.content).toBe("Sub-agent tester failed: Network failure");
  });

  it("shares tokenBudget by reference (same object passed to runAgentLoop)", async () => {
    const deps = createSpawnAgentDeps();
    mockRunAgentLoop.mockResolvedValue(createSuccessResult());

    const tool = createSpawnAgentTool(deps);
    await tool.execute({
      agentType: "researcher",
      task: "Research task",
    });

    const options = mockRunAgentLoop.mock.calls[0]?.[0];
    // Strict identity check -- must be the same object, not a copy
    expect(options.tokenBudget).toBe(deps.tokenBudget);
  });

  it("calls traceRecorder.onAgentSpawn before loop and onAgentComplete after", async () => {
    const deps = createSpawnAgentDeps();
    const traceRecorder = deps.traceRecorder;
    mockRunAgentLoop.mockResolvedValue(createSuccessResult());

    const tool = createSpawnAgentTool(deps);
    await tool.execute({
      agentType: "coder",
      task: "Write code",
      context: "Auth module",
    });

    // onAgentSpawn called with childInstanceId, agentType, and brief
    expect(traceRecorder.onAgentSpawn).toHaveBeenCalledWith(
      "ainst_test123",
      "coder",
      { task: "Write code", context: "Auth module" },
    );

    // onAgentComplete called with result details
    expect(traceRecorder.onAgentComplete).toHaveBeenCalledWith({
      agentType: "coder",
      childInstanceId: "ainst_test123",
      status: "completed",
      toolCallCount: 5,
      tokenCount: { input: 1000, output: 500 },
    });

    // Spawn called before complete
    const spawnOrder =
      (traceRecorder.onAgentSpawn as ReturnType<typeof vi.fn>).mock
        .invocationCallOrder[0] ?? 0;
    const completeOrder =
      (traceRecorder.onAgentComplete as ReturnType<typeof vi.fn>).mock
        .invocationCallOrder[0] ?? 0;
    expect(spawnOrder).toBeLessThan(completeOrder);
  });

  it("passes abortSignal when provided", async () => {
    const controller = new AbortController();
    const deps = createSpawnAgentDeps({ abortSignal: controller.signal });
    mockRunAgentLoop.mockResolvedValue(createSuccessResult());

    const tool = createSpawnAgentTool(deps);
    await tool.execute({
      agentType: "researcher",
      task: "Search files",
    });

    const options = mockRunAgentLoop.mock.calls[0]?.[0];
    expect(options.abortSignal).toBe(controller.signal);
  });

  it("does not set optional fields when not provided (exactOptionalPropertyTypes)", async () => {
    const deps = createSpawnAgentDeps();
    // Ensure abortSignal is NOT set on deps
    delete (deps as unknown as Record<string, unknown>).abortSignal;
    mockRunAgentLoop.mockResolvedValue(createSuccessResult());

    const tool = createSpawnAgentTool(deps);
    await tool.execute({
      agentType: "researcher",
      task: "Explore code",
    });

    const options = mockRunAgentLoop.mock.calls[0]?.[0];
    // abortSignal should not be present on the options object
    expect(Object.keys(options)).not.toContain("abortSignal");
    // context should not be set when not provided
    expect(Object.keys(options)).not.toContain("context");
  });
});

// ---------------------------------------------------------------------------
// request_human_input
// ---------------------------------------------------------------------------

describe("createRequestHumanInputTool", () => {
  it("returns a ToolDefinition with correct name", () => {
    const tool = createRequestHumanInputTool();
    expect(tool.name).toBe("request_human_input");
    expect(tool.description).toBeTruthy();
    expect(tool.inputSchema).toBeDefined();
    expect(tool.execute).toBeTypeOf("function");
  });

  it("returns sentinel JSON with HUMAN_INPUT_MARKER type on valid input", async () => {
    const tool = createRequestHumanInputTool();
    const result = await tool.execute({
      channel: "C1234567890",
      message: "Please approve the PR",
      requestType: "approval",
    });

    const parsed = JSON.parse(result.content);
    expect(parsed.type).toBe(HUMAN_INPUT_MARKER);
    expect(parsed.channel).toBe("C1234567890");
    expect(parsed.message).toBe("Please approve the PR");
    expect(parsed.requestType).toBe("approval");
  });

  it("returns isError:true for invalid input", async () => {
    const tool = createRequestHumanInputTool();
    const result = await tool.execute({});

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Invalid input");
  });

  it("output can be parsed as JSON and contains all expected fields", async () => {
    const tool = createRequestHumanInputTool();
    const result = await tool.execute({
      channel: "C9876543210",
      message: "Need clarification on requirements",
      requestType: "clarification",
    });

    // Should be parseable JSON
    const parsed = JSON.parse(result.content);
    expect(parsed).toHaveProperty("type");
    expect(parsed).toHaveProperty("channel");
    expect(parsed).toHaveProperty("message");
    expect(parsed).toHaveProperty("requestType");
    expect(parsed.requestType).toBe("clarification");
  });

  it("does NOT set isError flag (successful result, not an error)", async () => {
    const tool = createRequestHumanInputTool();
    const result = await tool.execute({
      channel: "C1234567890",
      message: "Escalating issue",
      requestType: "escalation",
    });

    expect(result.isError).toBeUndefined();
  });

  it("HUMAN_INPUT_MARKER constant equals 'human_input_requested'", () => {
    expect(HUMAN_INPUT_MARKER).toBe("human_input_requested");
  });
});
