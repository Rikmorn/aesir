/**
 * Integration Test Helpers
 *
 * Utilities for controlling agent behavior in integration tests without
 * requiring real LLM calls. Provides mock agent loop factories, status
 * polling, and in-memory test registries.
 *
 * These helpers are designed to be used alongside the setup.ts testcontainer
 * infrastructure. They do NOT use vi.mock() -- that responsibility belongs
 * to the test files themselves. Instead, they configure mock function
 * implementations that test files wire up via vi.mock().
 */

// Env vars must be set before framework imports (setup.ts handles this
// when both files are imported together; set defensively here too).
process.env.ANTHROPIC_API_KEY =
  process.env.ANTHROPIC_API_KEY || "test-key-not-real";
process.env.LINEAR_TEAM_ID = process.env.LINEAR_TEAM_ID || "test-team";
process.env.GITHUB_REPO = process.env.GITHUB_REPO || "test-org/test-repo";
process.env.SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID || "C000TEST";
process.env.NODE_ENV = "test";

import type { PinoLogger } from "@aesir/platform";

// Use a structural type alias instead of vitest's Mock to avoid
// Mock<Procedure | Constructable> vs Mock assignability issues in vitest 4.x.
// Both vi.fn() return values and ReturnType<typeof vi.fn> satisfy this shape.
interface MockFn {
  mockResolvedValue: (val: unknown) => void;
  // biome-ignore lint/suspicious/noExplicitAny: Mock implementation accepts any function signature
  mockImplementation: (fn: (...args: any[]) => any) => void;
  mockReset: () => void;
}

import type {
  AgentLoopResult,
  ToolDefinition,
} from "../../shared/agent-loop/types.js";
import { createEventRouter } from "../event-router.js";
import { createToolRegistry } from "../tool-registry.js";
import type {
  AgentDefinition,
  AgentRegistry,
  ConversationExecutor,
  ConversationInfo,
  EventRouter,
  ToolRegistry,
  WaitForState,
} from "../types.js";
import { createWaitForTool } from "../wait-for-tool.js";

// ─── Mock Agent Loop Helpers ────────────────────────────────────────────────

/**
 * Default AgentLoopResult for a completed run.
 */
function makeCompletedResult(
  output = "Task completed successfully.",
): AgentLoopResult {
  return {
    status: "completed",
    output,
    toolCallCount: 0,
    tokenCount: { input: 100, output: 50 },
    trace: [],
    messages: [],
  };
}

/**
 * Default AgentLoopResult for an error run.
 */
function makeErrorResult(
  errorMessage = "Agent encountered an error.",
): AgentLoopResult {
  return {
    status: "error",
    output: errorMessage,
    toolCallCount: 0,
    tokenCount: { input: 100, output: 50 },
    trace: [],
    messages: [],
  };
}

/**
 * Configure a mock runAgentLoop to return a completed result.
 *
 * @param mockFn - The vi.fn() mock for runAgentLoop
 * @param output - Optional output text (default: "Task completed successfully.")
 */
export function mockAgentLoopCompletes(mockFn: MockFn, output?: string): void {
  mockFn.mockResolvedValue(makeCompletedResult(output));
}

/**
 * Configure a mock runAgentLoop to trigger a wait_for pause.
 *
 * The mock implementation finds the wait_for tool in the options.tools array
 * and calls it, which sets the WaitForState flag the executor checks.
 *
 * @param mockFn - The vi.fn() mock for runAgentLoop
 * @param waitType - Signal type to wait for (default: "approval")
 * @param reason - Reason for pausing (default: "Waiting for approval")
 * @param timeout - Timeout duration (default: "72h")
 */
export function mockAgentLoopPauses(
  mockFn: MockFn,
  waitType = "approval",
  reason = "Waiting for approval",
  timeout = "72h",
): void {
  mockFn.mockImplementation(async (options: { tools?: ToolDefinition[] }) => {
    // Find the wait_for tool in the tools array
    const waitForTool = options.tools?.find(
      (t: ToolDefinition) => t.name === "wait_for",
    );
    if (waitForTool) {
      await waitForTool.execute({
        type: waitType,
        reason,
        timeout,
      });
    }
    return makeCompletedResult(
      `Paused. Waiting for: ${waitType}. Reason: ${reason}.`,
    );
  });
}

/**
 * Configure a mock runAgentLoop to return an error result.
 *
 * @param mockFn - The vi.fn() mock for runAgentLoop
 * @param errorMessage - Error message (default: "Agent encountered an error.")
 */
export function mockAgentLoopErrors(
  mockFn: MockFn,
  errorMessage?: string,
): void {
  mockFn.mockResolvedValue(makeErrorResult(errorMessage));
}

/**
 * Configure a mock runAgentLoop to return different results on successive calls.
 *
 * @param mockFn - The vi.fn() mock for runAgentLoop
 * @param sequence - Array of configurators (functions that take mockFn and set one behavior)
 *
 * @example
 * ```typescript
 * mockAgentLoopSequence(mockRunAgentLoop, [
 *   (m) => mockAgentLoopPauses(m, "approval"),
 *   (m) => mockAgentLoopCompletes(m, "Done after approval"),
 * ]);
 * ```
 */
export function mockAgentLoopSequence(
  mockFn: MockFn,
  sequence: Array<(mock: MockFn) => void>,
): void {
  let callIndex = 0;

  mockFn.mockImplementation(async (options: { tools?: ToolDefinition[] }) => {
    const idx = callIndex;
    callIndex++;

    const configurator = sequence[idx] ?? sequence[sequence.length - 1];
    if (!configurator) {
      return makeCompletedResult("No more sequence entries.");
    }

    // Capture what the configurator does by inspecting calls
    let resolvedValue: AgentLoopResult | null = null;
    let implFn:
      | ((opts: { tools?: ToolDefinition[] }) => Promise<AgentLoopResult>)
      | null = null;

    const captureMock = {
      mockResolvedValue: (val: AgentLoopResult) => {
        resolvedValue = val;
      },
      mockImplementation: (
        fn: (opts: { tools?: ToolDefinition[] }) => Promise<AgentLoopResult>,
      ) => {
        implFn = fn;
      },
    } as unknown as MockFn;

    configurator(captureMock);

    if (implFn) {
      return (
        implFn as (opts: {
          tools?: ToolDefinition[];
        }) => Promise<AgentLoopResult>
      )(options);
    }
    if (resolvedValue) {
      return resolvedValue;
    }
    return makeCompletedResult("Sequence fallback.");
  });
}

// ─── Status Polling ─────────────────────────────────────────────────────────

/**
 * Poll a ConversationExecutor until a conversation reaches the expected status.
 *
 * @param executor - ConversationExecutor instance
 * @param conversationId - Conversation to poll
 * @param expectedStatus - Status to wait for
 * @param timeoutMs - Maximum wait time (default: 5000ms)
 * @param pollMs - Poll interval (default: 50ms)
 * @throws Error if timeout expires before status is reached
 */
export async function waitForStatus(
  executor: ConversationExecutor,
  conversationId: string,
  expectedStatus: string,
  timeoutMs = 5000,
  pollMs = 50,
): Promise<ConversationInfo> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const info = await executor.get(conversationId);
    if (info && info.status === expectedStatus) {
      return info;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  // Final check before throwing
  const finalInfo = await executor.get(conversationId);
  throw new Error(
    `Timed out waiting for conversation "${conversationId}" to reach status "${expectedStatus}". ` +
      `Current status: ${finalInfo?.status ?? "not found"} (waited ${timeoutMs}ms)`,
  );
}

// ─── Test Agent Registry ────────────────────────────────────────────────────

/**
 * Create an in-memory AgentRegistry with two test agent definitions.
 *
 * Agents:
 * - "dev-agent": triggers on "linear.agent_session.created"
 * - "product-agent": triggers on "slack.app_mention.created"
 *
 * Both have minimal configuration suitable for lifecycle flow tests.
 */
export function createTestAgentRegistry(): AgentRegistry {
  const definitions: AgentDefinition[] = [
    {
      id: "dev-agent",
      name: "Dev Agent (Test)",
      description: "Test dev agent for integration tests",
      version: "1",
      model: "claude-sonnet-4-20250514",
      tools: ["coordination:wait_for"],
      maxIterations: 10,
      tokenBudget: 50000,
      history: {
        pruneThreshold: 80000,
        protectedMessages: 4,
        summaryThreshold: 60000,
        summaryModel: "claude-sonnet-4-20250514",
      },
      triggers: [{ event: "linear.agent_session.created" }],
      systemPrompt: "You are a test agent.",
    },
    {
      id: "product-agent",
      name: "Product Agent (Test)",
      description: "Test product agent for integration tests",
      version: "1",
      model: "claude-sonnet-4-20250514",
      tools: ["coordination:wait_for"],
      maxIterations: 5,
      tokenBudget: 10000,
      history: {
        pruneThreshold: 30000,
        protectedMessages: 4,
        summaryThreshold: 20000,
        summaryModel: "claude-sonnet-4-20250514",
      },
      triggers: [{ event: "slack.app_mention.created" }],
      systemPrompt: "You are a test agent.",
    },
  ];

  const definitionMap = new Map(definitions.map((d) => [d.id, d]));

  return {
    async get(id: string): Promise<AgentDefinition | null> {
      return definitionMap.get(id) ?? null;
    },
    async list(): Promise<AgentDefinition[]> {
      return definitions;
    },
  };
}

// ─── Test Tool Registry ─────────────────────────────────────────────────────

/**
 * Create a ToolRegistry with the coordination:wait_for tool registered.
 *
 * Only registers tools needed for lifecycle flow tests. MCP-dependent
 * tools are intentionally omitted since they require running services.
 *
 * @param logger - Logger instance
 */
export function createTestToolRegistry(logger: PinoLogger): ToolRegistry {
  const registry = createToolRegistry({ logger });

  // Register coordination:wait_for -- the only tool needed for lifecycle tests
  registry.register("coordination:wait_for", (_ctx) => {
    // Create a default (untriggered) WaitForState.
    // The ConversationExecutor replaces this with a per-run state
    // before each agent loop invocation.
    const state: WaitForState = {
      triggered: false,
      waitType: null,
      reason: null,
      timeout: null,
      metadata: null,
    };
    return createWaitForTool(state);
  });

  return registry;
}

// ─── Test Event Router ──────────────────────────────────────────────────────

/**
 * Create an EventRouter with start rules loaded from a test AgentRegistry.
 *
 * @param agentRegistry - AgentRegistry to load start rules from
 * @param logger - Logger instance
 */
export async function createTestEventRouter(
  agentRegistry: AgentRegistry,
  logger: PinoLogger,
): Promise<EventRouter> {
  const router = createEventRouter({ agentRegistry, logger });
  await router.loadStartRules();
  return router;
}
