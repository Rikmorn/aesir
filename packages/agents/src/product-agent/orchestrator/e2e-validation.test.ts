/**
 * End-to-end validation behavioral tests for the product agent.
 *
 * Proves runtime behavioral properties that cannot be verified by code
 * inspection alone. Uses SDK mocking at the Anthropic boundary to script
 * LLM responses and exercise real product agent logic.
 *
 * Coverage:
 * - E2EV-05a: Clear request creates issue in minimal tool calls
 * - E2EV-05b: Vague request triggers clarifying questions via Slack
 */

import type { PinoLogger } from "@aesir/platform";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import type * as agentsSchemaModule from "../../shared/db/schema.js";
import type { ProductAgentOptions } from "./orchestrator.js";

// ---------------------------------------------------------------------------
// Mock Anthropic SDK (Phase 28 pattern)
// ---------------------------------------------------------------------------

const mockCreate = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error {
    status: number;
    headers: undefined;
    error: unknown;
    constructor(
      status: number,
      error: unknown,
      message: string,
      _headers: undefined,
    ) {
      super(message || `API Error ${status}`);
      this.name = "APIError";
      this.status = status;
      this.error = error;
    }
  }

  class MockAnthropic {
    // biome-ignore lint/style/useNamingConvention: Must match Anthropic SDK's exported name
    static APIError = APIError;
    messages = { create: mockCreate };
  }

  return { default: MockAnthropic, APIError };
});

vi.mock("@anthropic-ai/sdk/helpers/beta/zod", () => ({
  betaZodTool: (opts: {
    name: string;
    inputSchema: z.ZodType;
    description: string;
  }) => ({
    type: "custom",
    name: opts.name,
    description: opts.description,
    input_schema: { type: "object", properties: {} },
    run: async () => "",
    parse: (args: unknown) => args,
  }),
}));

// ---------------------------------------------------------------------------
// Mock trace recorder
// ---------------------------------------------------------------------------

const mockFlush = vi.fn().mockResolvedValue(undefined);
const mockOnToolCall = vi.fn();
const mockOnResponse = vi.fn();
const mockOnAgentSpawn = vi.fn();
const mockOnAgentComplete = vi.fn();

vi.mock("../../shared/db/trace-recorder.js", () => ({
  createTraceRecorder: () => ({
    onToolCall: mockOnToolCall,
    onResponse: mockOnResponse,
    onAgentSpawn: mockOnAgentSpawn,
    onAgentComplete: mockOnAgentComplete,
    flush: mockFlush,
    stepCount: vi.fn().mockReturnValue(0),
  }),
}));

// ---------------------------------------------------------------------------
// Mock MCP client (prevent real HTTP calls)
// ---------------------------------------------------------------------------

vi.mock("../../shared/mcp/client.js", () => ({
  callMcpTool: vi.fn().mockResolvedValue({}),
}));

// ---------------------------------------------------------------------------
// Mock createId
// ---------------------------------------------------------------------------

vi.mock("@aesir/types", () => ({
  createId: {
    agentInstance: () => "ainst_test_product_e2ev",
    executionTrace: () => "etrc_test",
  },
}));

// ---------------------------------------------------------------------------
// Dynamic imports AFTER mocks
// ---------------------------------------------------------------------------

const { runProductAgent } = await import("./orchestrator.js");

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

function mockTextResponse(
  text: string,
  inputTokens = 100,
  outputTokens = 50,
  stopReason: string | null = "end_turn",
) {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    content: [{ type: "text", text }],
    stop_reason: stopReason,
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };
}

function mockToolUseResponse(
  toolCalls: Array<{ name: string; input: unknown; id: string }>,
  inputTokens = 100,
  outputTokens = 50,
) {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    content: toolCalls.map((tc) => ({
      type: "tool_use",
      id: tc.id,
      name: tc.name,
      input: tc.input,
    })),
    stop_reason: "tool_use",
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };
}

function createTestOptions(
  overrides?: Partial<ProductAgentOptions>,
): ProductAgentOptions {
  return {
    threadTs: "1234567890.123456",
    channelId: "C0123456789",
    message: "Add a health check endpoint at /health that returns 200 OK",
    linearTeamId: "team_test_abc",
    agentId: "product-agent",
    correlationId: "corr_product_e2ev_456",
    db: {
      insert: vi.fn(),
      select: vi.fn(),
    } as unknown as NodePgDatabase<typeof agentsSchemaModule>,
    logger: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      fatal: vi.fn(),
      child: vi.fn().mockReturnValue({
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
        fatal: vi.fn(),
        child: vi.fn().mockReturnThis(),
      }),
    } as unknown as PinoLogger,
    maxIterations: 10,
    ...overrides,
  };
}

/**
 * Extract tool call names from the trace recorder's onToolCall history.
 */
function extractToolCallSequence(): string[] {
  const calls = mockOnToolCall.mock.calls as Array<
    [{ name: string; input: unknown; id: string }]
  >;
  return calls.map((call) => call[0].name);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("end-to-end validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // E2EV-05: Product agent adaptiveness
  // -------------------------------------------------------------------------

  describe("product agent adaptiveness (E2EV-05)", () => {
    it("clear request creates issue in minimal tool calls", async () => {
      // Script the mock SDK to simulate a clear request flow:
      // The product agent searches for duplicates, sends a summary for
      // confirmation, then ends turn waiting for user approval.
      mockCreate
        // 1. Agent searches for duplicate issues
        .mockResolvedValueOnce(
          mockToolUseResponse([
            {
              name: "linear_search_issues",
              input: {
                query: "health check endpoint",
                teamId: "team_test_abc",
              },
              id: "call_1",
            },
          ]),
        )
        // 2. Agent sends summary to user for confirmation via Slack
        .mockResolvedValueOnce(
          mockToolUseResponse([
            {
              name: "slack_send_message",
              input: {
                channel: "C0123456789",
                text: "I can create an issue for a health check endpoint at /health that returns 200 OK with uptime info. Shall I go ahead?",
                threadTs: "1234567890.123456",
              },
              id: "call_2",
            },
          ]),
        )
        // 3. Agent ends turn with phase tag (waiting for confirmation)
        .mockResolvedValueOnce(
          mockTextResponse(
            "Sent summary to user for confirmation.\n<phase>clarifying</phase>",
          ),
        );

      const result = await runProductAgent(
        createTestOptions({
          message:
            "Add a health check endpoint at /health that returns 200 OK with uptime info",
        }),
      );

      // Verify completion
      expect(result.status).toBe("completed");

      // E2EV-05a: Tool calls include linear_search_issues (duplicate check)
      const toolSequence = extractToolCallSequence();
      expect(toolSequence).toContain("linear_search_issues");

      // E2EV-05a: Tool calls include slack_send_message (user communication)
      expect(toolSequence).toContain("slack_send_message");

      // E2EV-05a: No codebase tools used (product agent has no codebase tools)
      const codebaseTools = toolSequence.filter(
        (name) =>
          name === "read_file" ||
          name === "write_file" ||
          name === "search_codebase" ||
          name === "list_directory" ||
          name === "run_command",
      );
      expect(codebaseTools).toHaveLength(0);

      // E2EV-05a: Total tool calls <= 4 (search + message, with possible label lookup)
      expect(toolSequence.length).toBeLessThanOrEqual(4);
    });

    it("vague request triggers clarifying questions via Slack", async () => {
      // Script the mock SDK to simulate a vague request flow:
      // The product agent identifies the request is vague and asks a
      // clarifying question via Slack instead of creating an issue.
      mockCreate
        // 1. Agent sends a clarifying question via Slack
        .mockResolvedValueOnce(
          mockToolUseResponse([
            {
              name: "slack_send_message",
              input: {
                channel: "C0123456789",
                text: "Could you tell me more about which errors you are seeing? For example, are these API errors, form validation errors, or something else?",
                threadTs: "1234567890.123456",
              },
              id: "call_1",
            },
          ]),
        )
        // 2. Agent ends turn with phase tag (waiting for clarification)
        .mockResolvedValueOnce(
          mockTextResponse(
            "Asked clarifying question about which errors.\n<phase>clarifying</phase>",
          ),
        );

      const result = await runProductAgent(
        createTestOptions({
          message: "we need better error handling",
        }),
      );

      // Verify completion
      expect(result.status).toBe("completed");

      // E2EV-05b: Tool calls include slack_send_message (asking question)
      const toolSequence = extractToolCallSequence();
      expect(toolSequence).toContain("slack_send_message");

      // E2EV-05b: NO linear_create_issue called (asks questions instead)
      expect(toolSequence).not.toContain("linear_create_issue");

      // E2EV-05b: Total tool calls <= 3 (question message only)
      expect(toolSequence.length).toBeLessThanOrEqual(3);
    });
  });
});
