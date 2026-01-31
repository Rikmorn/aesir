/**
 * End-to-end validation behavioral tests for the dev agent orchestrator.
 *
 * Proves runtime behavioral properties that cannot be verified by code
 * inspection alone. Uses SDK mocking at the Anthropic boundary to script
 * LLM responses and exercise real orchestrator logic.
 *
 * Coverage:
 * - E2EV-02: README edit completes efficiently (< 10 tool calls, no research, no tests)
 * - E2EV-04: Test failure recovery diagnoses error and tries different approach
 */

import type { DevContainerManager, PinoLogger } from "@aesir/platform";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import type * as agentsSchemaModule from "../../shared/db/schema.js";
import type { OrchestratorOptions } from "./orchestrator.js";

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
    agentInstance: () => "ainst_test_e2ev",
    executionTrace: () => "etrc_test",
  },
}));

// ---------------------------------------------------------------------------
// Dynamic imports AFTER mocks
// ---------------------------------------------------------------------------

const { runDevAgentOrchestrator } = await import("./orchestrator.js");

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
  overrides?: Partial<OrchestratorOptions>,
): OrchestratorOptions {
  return {
    issueId: "AES-42",
    containerManager: {
      execute: vi.fn(),
      spawn: vi.fn(),
      findByTaskId: vi.fn(),
      isRunning: vi.fn(),
      health: vi.fn(),
      close: vi.fn(),
    } as unknown as DevContainerManager,
    taskId: "task_e2ev_123",
    agentId: "dev-agent",
    correlationId: "corr_e2ev_456",
    workflowId: "wf_e2ev_789",
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
    maxIterations: 20,
    ...overrides,
  };
}

/**
 * Extract tool call names from the trace recorder's onToolCall history.
 *
 * Uses the mockOnToolCall callback which is invoked by runAgentLoop for every
 * tool call the LLM makes. Returns tool names in execution order.
 */
function extractToolCallSequence(): string[] {
  const calls = mockOnToolCall.mock.calls as Array<
    [{ name: string; input: unknown; id: string }]
  >;
  return calls.map((call) => call[0].name);
}

/**
 * Extract spawn_agent inputs from the trace recorder's onToolCall history.
 *
 * Filters to only spawn_agent calls and returns their input objects.
 */
function extractSpawnAgentInputs(): Array<{
  agentType: string;
  task: string;
  context?: string;
}> {
  const calls = mockOnToolCall.mock.calls as Array<
    [{ name: string; input: unknown; id: string }]
  >;
  return calls
    .filter((call) => call[0].name === "spawn_agent")
    .map(
      (call) =>
        call[0].input as { agentType: string; task: string; context?: string },
    );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("end-to-end validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // E2EV-02: README edit completes efficiently
  // -------------------------------------------------------------------------

  describe("README edit efficiency (E2EV-02)", () => {
    it("README edit completes efficiently without research or test execution", async () => {
      // Script the mock SDK to simulate a simple README edit flow:
      // The orchestrator reads the issue, reads the file, spawns coder (no researcher),
      // then creates a branch, commit, and PR.
      mockCreate
        // 1. Orchestrator reads issue
        .mockResolvedValueOnce(
          mockToolUseResponse([
            {
              name: "linear_get_issue",
              input: { issueId: "AES-42" },
              id: "call_1",
            },
          ]),
        )
        // 2. Orchestrator reads current README
        .mockResolvedValueOnce(
          mockToolUseResponse([
            {
              name: "read_file",
              input: { path: "README.md" },
              id: "call_2",
            },
          ]),
        )
        // 3. Orchestrator spawns coder directly (no researcher)
        .mockResolvedValueOnce(
          mockToolUseResponse([
            {
              name: "spawn_agent",
              input: {
                agentType: "coder",
                task: 'Update README.md: change "recieve" to "receive" in the installation section',
              },
              id: "call_3",
            },
          ]),
        )
        // 4. Inner LLM (coder sub-agent) completes
        .mockResolvedValueOnce(
          mockTextResponse("Updated README.md with the typo fix."),
        )
        // 5. Orchestrator creates branch
        .mockResolvedValueOnce(
          mockToolUseResponse([
            {
              name: "github_create_branch",
              input: {
                owner: "org",
                repo: "repo",
                branch: "fix/readme-typo",
                from: "main",
              },
              id: "call_4",
            },
          ]),
        )
        // 6. Orchestrator creates commit
        .mockResolvedValueOnce(
          mockToolUseResponse([
            {
              name: "github_create_commit",
              input: {
                owner: "org",
                repo: "repo",
                branch: "fix/readme-typo",
                message: "fix: correct typo in README",
                files: [{ path: "README.md", content: "# Updated" }],
              },
              id: "call_5",
            },
          ]),
        )
        // 7. Orchestrator creates PR
        .mockResolvedValueOnce(
          mockToolUseResponse([
            {
              name: "github_create_pull_request",
              input: {
                owner: "org",
                repo: "repo",
                title: "fix: correct typo in README",
                head: "fix/readme-typo",
                base: "main",
              },
              id: "call_6",
            },
          ]),
        )
        // 8. Orchestrator completes with final text
        .mockResolvedValueOnce(
          mockTextResponse("PR created. README edit complete."),
        );

      const result = await runDevAgentOrchestrator(createTestOptions());

      // Verify completion
      expect(result.status).toBe("completed");

      // E2EV-02: Total tool calls < 10
      const toolSequence = extractToolCallSequence();
      expect(toolSequence.length).toBeLessThan(10);

      // E2EV-02: No researcher spawned
      const spawnInputs = extractSpawnAgentInputs();
      const researcherSpawns = spawnInputs.filter(
        (s) => s.agentType === "researcher",
      );
      expect(researcherSpawns).toHaveLength(0);

      // E2EV-02: No tester spawned
      const testerSpawns = spawnInputs.filter((s) => s.agentType === "tester");
      expect(testerSpawns).toHaveLength(0);

      // E2EV-02: No run_command tool called at orchestrator level
      // (orchestrator delegates execution to sub-agents)
      const orchestratorToolCalls = toolSequence.filter(
        (name) => name === "run_command",
      );
      expect(orchestratorToolCalls).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // E2EV-04: Test failure recovery with different approach
  // -------------------------------------------------------------------------

  describe("test failure recovery (E2EV-04)", () => {
    it("agent diagnoses test failure and retries with a different approach", async () => {
      // Script the mock SDK to simulate:
      // 1. Read issue -> research -> first coder attempt -> test fails
      // 2. Second coder attempt with different approach -> tests pass
      mockCreate
        // 1. Orchestrator reads issue
        .mockResolvedValueOnce(
          mockToolUseResponse([
            {
              name: "linear_get_issue",
              input: { issueId: "AES-42" },
              id: "call_1",
            },
          ]),
        )
        // 2. Orchestrator spawns researcher
        .mockResolvedValueOnce(
          mockToolUseResponse([
            {
              name: "spawn_agent",
              input: {
                agentType: "researcher",
                task: "Explore the authentication module to understand the current token validation approach",
              },
              id: "call_2",
            },
          ]),
        )
        // 3. Inner LLM (researcher) completes with findings
        .mockResolvedValueOnce(
          mockTextResponse(
            "Found: Token validation uses jsonwebtoken library with RS256 algorithm in auth/validate.ts",
          ),
        )
        // 4. Orchestrator spawns first coder attempt (Approach A)
        .mockResolvedValueOnce(
          mockToolUseResponse([
            {
              name: "spawn_agent",
              input: {
                agentType: "coder",
                task: "Approach A: Add token refresh logic using jsonwebtoken verify with ignoreExpiration option",
                context:
                  "Research: uses jsonwebtoken with RS256 in auth/validate.ts",
              },
              id: "call_3",
            },
          ]),
        )
        // 5. Inner LLM (coder) completes implementation
        .mockResolvedValueOnce(
          mockTextResponse("Implemented token refresh with ignoreExpiration."),
        )
        // 6. Orchestrator spawns tester to verify
        .mockResolvedValueOnce(
          mockToolUseResponse([
            {
              name: "spawn_agent",
              input: {
                agentType: "tester",
                task: "Run tests for auth module: pnpm test packages/auth/",
              },
              id: "call_4",
            },
          ]),
        )
        // 7. Inner LLM (tester) reports failure
        .mockResolvedValueOnce(
          mockTextResponse(
            "FAILED: TypeError - Cannot read property 'exp' of undefined. The ignoreExpiration option returns decoded token without verifying structure. Missing import for TokenPayload type.",
          ),
        )
        // 8. Orchestrator spawns second coder with DIFFERENT approach (Approach B)
        .mockResolvedValueOnce(
          mockToolUseResponse([
            {
              name: "spawn_agent",
              input: {
                agentType: "coder",
                task: "Approach B: Fix token refresh by importing TokenPayload type and adding null check on decoded.exp before refresh logic",
                context:
                  "Previous attempt failed: TypeError on decoded.exp - missing type import and null check",
              },
              id: "call_5",
            },
          ]),
        )
        // 9. Inner LLM (coder) completes fix
        .mockResolvedValueOnce(
          mockTextResponse(
            "Fixed: added TokenPayload import and null check for decoded.exp.",
          ),
        )
        // 10. Orchestrator spawns tester again
        .mockResolvedValueOnce(
          mockToolUseResponse([
            {
              name: "spawn_agent",
              input: {
                agentType: "tester",
                task: "Run tests for auth module after fix: pnpm test packages/auth/",
              },
              id: "call_6",
            },
          ]),
        )
        // 11. Inner LLM (tester) reports success
        .mockResolvedValueOnce(
          mockTextResponse("All 8 tests passed for auth module."),
        )
        // 12. Orchestrator completes after successful recovery
        .mockResolvedValueOnce(
          mockTextResponse(
            "Implementation complete after fixing test failure. Added TokenPayload type import and null check.",
          ),
        );

      const result = await runDevAgentOrchestrator(createTestOptions());

      // Verify completion
      expect(result.status).toBe("completed");

      // Extract spawn_agent inputs
      const spawnInputs = extractSpawnAgentInputs();

      // Find coder spawns specifically
      const coderSpawns = spawnInputs.filter((s) => s.agentType === "coder");

      // E2EV-04: Two coder spawns with DIFFERENT task briefs
      expect(coderSpawns.length).toBeGreaterThanOrEqual(2);
      expect(coderSpawns[0]?.task).not.toBe(coderSpawns[1]?.task);

      // E2EV-04: The second coder brief references the error diagnosis
      // (should mention the fix, not just retry the same thing)
      const secondCoderTask = coderSpawns[1]?.task ?? "";
      const referencesError =
        secondCoderTask.includes("import") ||
        secondCoderTask.includes("fix") ||
        secondCoderTask.includes("null check") ||
        secondCoderTask.includes("TypeError");
      expect(referencesError).toBe(true);

      // E2EV-04: A tester was spawned AFTER the second coder
      // (verifying the fix, not just blind retry of same code)

      // Get the ordered list of all spawn_agent calls from the trace callback
      const rawCalls = mockOnToolCall.mock.calls as Array<
        [{ name: string; input: unknown; id: string }]
      >;
      const allSpawnCallInputs = rawCalls
        .filter((call) => call[0].name === "spawn_agent")
        .map((call) => ({
          agentType: (call[0].input as { agentType: string }).agentType,
        }));

      // Find the index of the second coder spawn and verify a tester follows
      let secondCoderIdx = -1;
      let coderCount = 0;
      for (let i = 0; i < allSpawnCallInputs.length; i++) {
        if (allSpawnCallInputs[i]?.agentType === "coder") {
          coderCount++;
          if (coderCount === 2) {
            secondCoderIdx = i;
            break;
          }
        }
      }
      expect(secondCoderIdx).toBeGreaterThan(-1);

      // Verify a tester spawn exists after the second coder spawn
      const testerAfterSecondCoder = allSpawnCallInputs.some(
        (s, idx) => idx > secondCoderIdx && s.agentType === "tester",
      );
      expect(testerAfterSecondCoder).toBe(true);
    });
  });
});
