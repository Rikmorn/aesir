/**
 * Spawn Agent Tool Tests
 *
 * Unit tests for createSpawnAgentTool(). Mocks runAgentLoop at the module
 * level to avoid Anthropic API calls. Tests guard clauses, event recording,
 * result passing, and ToolContext construction.
 */

import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type {
  AgentDefinition,
  AgentRegistry,
  EventLog,
  SpawnAgentDeps,
  ToolContext,
  ToolRegistry,
} from "../../../framework/types.js";
import type { AgentLoopResult } from "../../agent-loop/types.js";
import { createSpawnAgentTool } from "./spawn-agent.js";

// ---------------------------------------------------------------------------
// Module mock: runAgentLoop
// ---------------------------------------------------------------------------

vi.mock("../../agent-loop/run-agent-loop.js", () => ({
  runAgentLoop: vi.fn(),
}));

// Import after mock registration so vitest replaces it
import { runAgentLoop } from "../../agent-loop/run-agent-loop.js";

const mockRunAgentLoop = runAgentLoop as Mock;

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

function createMockDefinition(
  overrides: Partial<AgentDefinition> = {},
): AgentDefinition {
  return {
    id: "coder",
    name: "Coder Agent",
    description: "Implements code changes",
    version: "1",
    model: "claude-haiku-4-5-20251001",
    tools: [
      "codebase:read_file",
      "codebase:write_file",
      "codebase:run_command",
    ],
    maxIterations: 40,
    tokenBudget: 100000,
    systemPrompt: "You are a coder agent.",
    history: {
      pruneThreshold: 40000,
      protectedMessages: 10,
      summaryThreshold: 60000,
      summaryModel: "claude-haiku-4-5-20251001",
    },
    ...overrides,
  };
}

function createMockParentDefinition(
  overrides: Partial<AgentDefinition> = {},
): AgentDefinition {
  return {
    id: "dev-agent",
    name: "Development Agent",
    description: "Orchestrates development",
    version: "1",
    model: "claude-sonnet-4-20250514",
    tools: ["coordination:spawn_agent"],
    subAgents: { researcher: "researcher", coder: "coder", tester: "tester" },
    maxIterations: 100,
    tokenBudget: 500000,
    systemPrompt: "You are the dev agent.",
    history: {
      pruneThreshold: 80000,
      protectedMessages: 20,
      summaryThreshold: 120000,
      summaryModel: "claude-haiku-4-5-20251001",
    },
    ...overrides,
  };
}

function createMockLoopResult(
  overrides: Partial<AgentLoopResult> = {},
): AgentLoopResult {
  return {
    status: "completed",
    output: "Task completed successfully.",
    toolCallCount: 5,
    tokenCount: { input: 1000, output: 500 },
    trace: [],
    messages: [],
    ...overrides,
  };
}

function createMockSpawnDeps(
  overrides: Partial<SpawnAgentDeps> = {},
): SpawnAgentDeps {
  return {
    agentRegistry: {
      get: vi.fn().mockResolvedValue(createMockDefinition()),
      list: vi.fn().mockResolvedValue([]),
    } as unknown as AgentRegistry,
    toolRegistry: {
      resolve: vi.fn().mockReturnValue([]),
      register: vi.fn(),
      has: vi.fn(),
      listRegistered: vi.fn(),
    } as unknown as ToolRegistry,
    tokenBudget: {
      total: 500000,
      remaining: 400000,
      warningFired: false,
      isExhausted: vi.fn().mockReturnValue(false),
      isWarning: vi.fn().mockReturnValue(false),
      isReserveOnly: vi.fn().mockReturnValue(false),
      deduct: vi.fn(),
    },
    eventLog: {
      append: vi.fn(),
      query: vi.fn(),
      subscribe: vi.fn(),
      initSequence: vi.fn(),
      flush: vi.fn(),
      close: vi.fn(),
    } as unknown as EventLog,
    parentDefinition: createMockParentDefinition(),
    parentInstanceId: "inst_parent12345",
    currentDepth: 0,
    maxSpawnDepth: 3,
    ...overrides,
  };
}

function createMockToolContext(
  overrides: Partial<ToolContext> = {},
): ToolContext {
  return {
    agentId: "dev-agent",
    correlationId: "conv_test123",
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn().mockReturnValue({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        child: vi.fn(),
      }),
    } as unknown as ToolContext["logger"],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createSpawnAgentTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunAgentLoop.mockResolvedValue(createMockLoopResult());
  });

  it("returns error when spawnDeps is undefined", async () => {
    const ctx = createMockToolContext(); // no spawnDeps
    const tool = createSpawnAgentTool(ctx);

    const result = await tool.execute({
      agentType: "coder",
      task: "implement auth",
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("not available in this context");
  });

  it("returns error when spawn depth exceeded", async () => {
    const deps = createMockSpawnDeps({
      currentDepth: 3,
      maxSpawnDepth: 3,
    });
    const ctx = createMockToolContext({ spawnDeps: deps });
    const tool = createSpawnAgentTool(ctx);

    const result = await tool.execute({
      agentType: "coder",
      task: "implement auth",
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Maximum spawn depth (3) exceeded");
  });

  it("returns error for unknown agent type not in subAgents mapping", async () => {
    const deps = createMockSpawnDeps({
      parentDefinition: createMockParentDefinition({
        subAgents: { researcher: "researcher" }, // no coder
      }),
    });
    const ctx = createMockToolContext({ spawnDeps: deps });
    const tool = createSpawnAgentTool(ctx);

    const result = await tool.execute({
      agentType: "coder",
      task: "implement auth",
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Unknown agent type: coder");
    expect(result.content).toContain("Available: researcher");
  });

  it("returns error when sub-agent definition not found in registry", async () => {
    const deps = createMockSpawnDeps();
    (deps.agentRegistry.get as Mock).mockResolvedValue(null);
    const ctx = createMockToolContext({ spawnDeps: deps });
    const tool = createSpawnAgentTool(ctx);

    const result = await tool.execute({
      agentType: "coder",
      task: "implement auth",
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Agent definition not found: coder");
  });

  it("calls runAgentLoop with correct options", async () => {
    const mockDef = createMockDefinition({
      id: "researcher",
      model: "claude-haiku-4-5-20251001",
      maxIterations: 30,
      systemPrompt: "You are a researcher.",
    });
    const deps = createMockSpawnDeps();
    (deps.agentRegistry.get as Mock).mockResolvedValue(mockDef);
    const mockAbortSignal = new AbortController().signal;
    deps.abortSignal = mockAbortSignal;

    const ctx = createMockToolContext({ spawnDeps: deps });
    const tool = createSpawnAgentTool(ctx);

    await tool.execute({
      agentType: "researcher",
      task: "find auth patterns",
    });

    expect(mockRunAgentLoop).toHaveBeenCalledOnce();
    // biome-ignore lint/style/noNonNullAssertion: test assertion -- verified call above
    const callArgs = mockRunAgentLoop.mock.calls[0]![0];
    expect(callArgs.systemPrompt).toBe("You are a researcher.");
    expect(callArgs.model).toBe("claude-haiku-4-5-20251001");
    expect(callArgs.maxIterations).toBe(30);
    expect(callArgs.tokenBudget).toBe(deps.tokenBudget);
    expect(callArgs.abortSignal).toBe(mockAbortSignal);
    expect(callArgs.initialMessage).toBe("find auth patterns");
  });

  it("returns sub-agent output on success", async () => {
    mockRunAgentLoop.mockResolvedValue(
      createMockLoopResult({
        status: "completed",
        output: "Found 3 auth patterns in the codebase.",
      }),
    );
    const deps = createMockSpawnDeps();
    const ctx = createMockToolContext({ spawnDeps: deps });
    const tool = createSpawnAgentTool(ctx);

    const result = await tool.execute({
      agentType: "coder",
      task: "implement auth",
    });

    expect(result.isError).toBe(false);
    expect(result.content).toBe("Found 3 auth patterns in the codebase.");
  });

  it("returns isError true on sub-agent failure", async () => {
    mockRunAgentLoop.mockResolvedValue(
      createMockLoopResult({
        status: "error",
        output: "Anthropic API error: rate limited",
      }),
    );
    const deps = createMockSpawnDeps();
    const ctx = createMockToolContext({ spawnDeps: deps });
    const tool = createSpawnAgentTool(ctx);

    const result = await tool.execute({
      agentType: "coder",
      task: "implement auth",
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Sub-agent coder failed (error)");
    expect(result.content).toContain("Anthropic API error: rate limited");
  });

  it("returns isError true on sub-agent abort", async () => {
    mockRunAgentLoop.mockResolvedValue(
      createMockLoopResult({
        status: "aborted",
        output: "Agent was aborted.",
      }),
    );
    const deps = createMockSpawnDeps();
    const ctx = createMockToolContext({ spawnDeps: deps });
    const tool = createSpawnAgentTool(ctx);

    const result = await tool.execute({
      agentType: "coder",
      task: "implement auth",
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Sub-agent coder failed (aborted)");
  });

  it("returns isError false on max_iterations (partial work is useful)", async () => {
    mockRunAgentLoop.mockResolvedValue(
      createMockLoopResult({
        status: "max_iterations",
        output: "Implemented 3 of 5 files.",
      }),
    );
    const deps = createMockSpawnDeps();
    const ctx = createMockToolContext({ spawnDeps: deps });
    const tool = createSpawnAgentTool(ctx);

    const result = await tool.execute({
      agentType: "coder",
      task: "implement auth",
    });

    expect(result.isError).toBe(false);
    expect(result.content).toContain(
      "Sub-agent coder stopped (max_iterations)",
    );
    expect(result.content).toContain("Implemented 3 of 5 files.");
  });

  it("returns isError false on max_tokens (partial work is useful)", async () => {
    mockRunAgentLoop.mockResolvedValue(
      createMockLoopResult({
        status: "max_tokens",
        output: "Partial progress made.",
      }),
    );
    const deps = createMockSpawnDeps();
    const ctx = createMockToolContext({ spawnDeps: deps });
    const tool = createSpawnAgentTool(ctx);

    const result = await tool.execute({
      agentType: "coder",
      task: "implement auth",
    });

    expect(result.isError).toBe(false);
    expect(result.content).toContain("Sub-agent coder stopped (max_tokens)");
  });

  it("records agent.started and agent.completed events", async () => {
    const loopResult = createMockLoopResult({
      status: "completed",
      output: "Done.",
      tokenCount: { input: 2000, output: 800 },
      toolCallCount: 7,
    });
    mockRunAgentLoop.mockResolvedValue(loopResult);

    const deps = createMockSpawnDeps();
    const ctx = createMockToolContext({ spawnDeps: deps });
    const tool = createSpawnAgentTool(ctx);

    await tool.execute({
      agentType: "coder",
      task: "implement auth module for the application",
    });

    const appendMock = deps.eventLog.append as Mock;
    expect(appendMock).toHaveBeenCalledTimes(2);

    // First call: agent.started
    // biome-ignore lint/style/noNonNullAssertion: test -- verified call count above
    const startEvent = appendMock.mock.calls[0]![0];
    expect(startEvent.type).toBe("agent.started");
    expect(startEvent.conversationId).toBe("conv_test123");
    expect(startEvent.agentDefinitionId).toBe("coder");
    expect(startEvent.parentInstanceId).toBe("inst_parent12345");
    expect(startEvent.payload.agentType).toBe("coder");
    expect(startEvent.payload.task).toBe(
      "implement auth module for the application",
    );
    expect(startEvent.payload.spawnDepth).toBe(1);

    // Second call: agent.completed
    // biome-ignore lint/style/noNonNullAssertion: test -- verified call count above
    const completedEvent = appendMock.mock.calls[1]![0];
    expect(completedEvent.type).toBe("agent.completed");
    expect(completedEvent.conversationId).toBe("conv_test123");
    expect(completedEvent.agentDefinitionId).toBe("coder");
    expect(completedEvent.parentInstanceId).toBe("inst_parent12345");
    expect(completedEvent.payload.status).toBe("completed");
    expect(completedEvent.payload.tokenCount).toEqual({
      input: 2000,
      output: 800,
    });
    expect(completedEvent.payload.toolCallCount).toBe(7);
    expect(completedEvent.tokenCountInput).toBe(2000);
    expect(completedEvent.tokenCountOutput).toBe(800);
    expect(typeof completedEvent.durationMs).toBe("number");
  });

  it("builds sub-agent ToolContext with shared sandbox but no spawnDeps", async () => {
    const mockContainerManager = { exec: vi.fn() };
    const deps = createMockSpawnDeps();
    const ctx = createMockToolContext({
      spawnDeps: deps,
      containerManager:
        mockContainerManager as unknown as ToolContext["containerManager"],
      sandboxId: "task_abc",
      taskId: "task_xyz",
    });
    const tool = createSpawnAgentTool(ctx);

    await tool.execute({
      agentType: "coder",
      task: "implement auth",
    });

    // biome-ignore lint/style/noNonNullAssertion: test -- verified resolve was called
    const resolveCall = (deps.toolRegistry.resolve as Mock).mock.calls[0]!;
    const subCtx = resolveCall[1] as ToolContext;

    // Sub-agent gets the sub-agent definition's ID
    expect(subCtx.agentId).toBe("coder");
    // Shared correlation ID (parent conversation)
    expect(subCtx.correlationId).toBe("conv_test123");
    // Shared sandbox
    expect(subCtx.containerManager).toBe(mockContainerManager);
    expect(subCtx.sandboxId).toBe("task_abc");
    // Task context propagated to sub-agent
    expect(subCtx.taskId).toBe("task_xyz");
    // NO spawnDeps (sub-agent doesn't have spawn_agent in its tools)
    expect(subCtx.spawnDeps).toBeUndefined();
  });

  it("prepends context to task when provided", async () => {
    const deps = createMockSpawnDeps();
    const ctx = createMockToolContext({ spawnDeps: deps });
    const tool = createSpawnAgentTool(ctx);

    await tool.execute({
      agentType: "coder",
      task: "implement auth",
      context: "Working on issue ABC-123",
    });

    // biome-ignore lint/style/noNonNullAssertion: test -- verified call above
    const callArgs = mockRunAgentLoop.mock.calls[0]![0];
    expect(callArgs.initialMessage).toBe(
      "Working on issue ABC-123\n\nimpliment auth".replace(
        "impliment",
        "implement",
      ),
    );
  });

  it("truncates long task descriptions in event payload", async () => {
    const deps = createMockSpawnDeps();
    const ctx = createMockToolContext({ spawnDeps: deps });
    const tool = createSpawnAgentTool(ctx);

    const longTask = "x".repeat(500);
    await tool.execute({
      agentType: "coder",
      task: longTask,
    });

    const appendMock = deps.eventLog.append as Mock;
    // biome-ignore lint/style/noNonNullAssertion: test -- verified append was called
    const startEvent = appendMock.mock.calls[0]![0];
    expect(startEvent.payload.task.length).toBe(200);
  });

  it("provides spawnDeps to sub-agent if it has spawn_agent tool and depth allows", async () => {
    // Create a sub-agent definition that itself has spawn_agent
    const subDef = createMockDefinition({
      id: "orchestrator-sub",
      tools: ["codebase:read_file", "coordination:spawn_agent"],
      subAgents: { researcher: "researcher" },
    });
    const deps = createMockSpawnDeps({
      currentDepth: 0,
      maxSpawnDepth: 3,
    });
    (deps.agentRegistry.get as Mock).mockResolvedValue(subDef);
    const ctx = createMockToolContext({ spawnDeps: deps });
    const tool = createSpawnAgentTool(ctx);

    await tool.execute({
      agentType: "coder",
      task: "orchestrate sub-tasks",
    });

    // biome-ignore lint/style/noNonNullAssertion: test -- verified resolve was called
    const resolveCall = (deps.toolRegistry.resolve as Mock).mock.calls[0]!;
    const subCtx = resolveCall[1] as ToolContext;

    // Sub-agent SHOULD have spawnDeps because it has spawn_agent and depth allows
    expect(subCtx.spawnDeps).toBeDefined();
    expect(subCtx.spawnDeps?.currentDepth).toBe(1);
    expect(subCtx.spawnDeps?.parentDefinition).toBe(subDef);
  });

  it("does not provide spawnDeps to sub-agent if depth would exceed max", async () => {
    const subDef = createMockDefinition({
      id: "orchestrator-sub",
      tools: ["codebase:read_file", "coordination:spawn_agent"],
    });
    const deps = createMockSpawnDeps({
      currentDepth: 1,
      maxSpawnDepth: 2, // depth + 1 = 2, not < maxSpawnDepth(2)
    });
    (deps.agentRegistry.get as Mock).mockResolvedValue(subDef);
    const ctx = createMockToolContext({ spawnDeps: deps });
    const tool = createSpawnAgentTool(ctx);

    await tool.execute({
      agentType: "coder",
      task: "orchestrate sub-tasks",
    });

    // biome-ignore lint/style/noNonNullAssertion: test -- verified resolve was called
    const resolveCall = (deps.toolRegistry.resolve as Mock).mock.calls[0]!;
    const subCtx = resolveCall[1] as ToolContext;

    // Sub-agent should NOT get spawnDeps (would exceed depth)
    expect(subCtx.spawnDeps).toBeUndefined();
  });

  it("resolves tools using the sub-agent definition's tool list", async () => {
    const subDef = createMockDefinition({
      tools: ["codebase:read_file", "codebase:search_codebase"],
    });
    const deps = createMockSpawnDeps();
    (deps.agentRegistry.get as Mock).mockResolvedValue(subDef);
    const ctx = createMockToolContext({ spawnDeps: deps });
    const tool = createSpawnAgentTool(ctx);

    await tool.execute({
      agentType: "coder",
      task: "implement auth",
    });

    // biome-ignore lint/style/noNonNullAssertion: test -- verified resolve was called
    const resolveCall = (deps.toolRegistry.resolve as Mock).mock.calls[0]!;
    expect(resolveCall[0]).toEqual([
      "codebase:read_file",
      "codebase:search_codebase",
    ]);
  });
});
