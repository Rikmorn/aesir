/**
 * Fix Code Node Tests
 *
 * Tests for fixCodeNode with mock LLM.
 */

import type { ChatAnthropic } from "@langchain/anthropic";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TestResult } from "../../sandbox/types.js";
import type { DevWorkflowStateType } from "../../state/dev-workflow-state.js";
import {
  type FixCodeOutput,
  FixCodeOutputSchema,
  fixCodeNode,
} from "./fix-code.js";

// Mock the logger
vi.mock("../../logging/index.js", () => ({
  logger: {
    child: () => ({
      startTimer: () => ({
        success: vi.fn(),
        failure: vi.fn(),
      }),
      info: vi.fn(),
    }),
  },
}));

/**
 * Create a mock LLM for testing
 */
function createMockLLM(response: FixCodeOutput) {
  return {
    withStructuredOutput: vi.fn().mockReturnValue({
      invoke: vi.fn().mockResolvedValue(response),
    }),
  } as unknown as ChatAnthropic;
}

function createErrorMockLLM(error: Error) {
  return {
    withStructuredOutput: vi.fn().mockReturnValue({
      invoke: vi.fn().mockRejectedValue(error),
    }),
  } as unknown as ChatAnthropic;
}

const failingTestResult: TestResult = {
  exitCode: 1,
  stdout: "FAIL src/utils/helper.test.ts\n  helper\n    × returns hello (5ms)",
  stderr:
    "AssertionError: expected 'helo' to equal 'hello'\n    at Object.<anonymous> (helper.test.ts:5:18)",
  passed: false,
  summary: "Tests failed with exit code 1",
};

describe("FixCodeOutputSchema", () => {
  it("validates valid output with files and reasoning", () => {
    const validOutput: FixCodeOutput = {
      files: [
        {
          path: "src/utils/helper.ts",
          content: 'export function helper() { return "hello"; }',
          operation: "update",
        },
      ],
      reasoning: "Fixed typo: 'helo' -> 'hello'",
    };

    const result = FixCodeOutputSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
  });

  it("validates output with multiple files", () => {
    const validOutput: FixCodeOutput = {
      files: [
        { path: "src/index.ts", content: "fixed content", operation: "update" },
        {
          path: "src/new-file.ts",
          content: "new content",
          operation: "create",
        },
      ],
      reasoning: "Fixed bug and added missing file",
    };

    const result = FixCodeOutputSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.files).toHaveLength(2);
    }
  });

  it("rejects output missing files", () => {
    const invalidOutput = {
      reasoning: "Some reasoning",
    };

    const result = FixCodeOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });

  it("rejects output missing reasoning", () => {
    const invalidOutput = {
      files: [],
    };

    const result = FixCodeOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });
});

describe("fixCodeNode", () => {
  const baseState: DevWorkflowStateType = {
    taskId: "TEST-123",
    sessionId: "session-test",
    taskDescription: "Create a utility function that returns 'hello'",
    repositoryUrl: "owner/repo",
    branchName: "feat/test-123",
    files: [
      {
        path: "src/utils/helper.ts",
        content: 'export function helper() { return "helo"; }', // Typo
        operation: "create",
      },
      {
        path: "src/utils/helper.test.ts",
        content: `import { describe, it, expect } from "vitest";
import { helper } from "./helper.js";

describe("helper", () => {
  it("returns hello", () => {
    expect(helper()).toBe("hello");
  });
});`,
        operation: "create",
      },
    ],
    testResult: failingTestResult,
    testAttempts: 1,
    status: "fixing",
    error: null,
    prNumber: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("prompt content", () => {
    it("includes test stdout in prompt", async () => {
      const mockInvoke = vi.fn().mockResolvedValue({
        files: [
          {
            path: "src/utils/helper.ts",
            content: "fixed",
            operation: "update",
          },
        ],
        reasoning: "Fixed",
      });

      const mockLLM = {
        withStructuredOutput: vi.fn().mockReturnValue({
          invoke: mockInvoke,
        }),
      } as unknown as ChatAnthropic;

      await fixCodeNode(baseState, { llm: mockLLM });

      const promptArg = mockInvoke.mock.calls[0]?.[0] as string;
      expect(promptArg).toContain(failingTestResult.stdout);
    });

    it("includes test stderr in prompt", async () => {
      const mockInvoke = vi.fn().mockResolvedValue({
        files: [
          {
            path: "src/utils/helper.ts",
            content: "fixed",
            operation: "update",
          },
        ],
        reasoning: "Fixed",
      });

      const mockLLM = {
        withStructuredOutput: vi.fn().mockReturnValue({
          invoke: mockInvoke,
        }),
      } as unknown as ChatAnthropic;

      await fixCodeNode(baseState, { llm: mockLLM });

      const promptArg = mockInvoke.mock.calls[0]?.[0] as string;
      expect(promptArg).toContain(failingTestResult.stderr);
      expect(promptArg).toContain("AssertionError");
    });

    it("includes current file contents in prompt", async () => {
      const mockInvoke = vi.fn().mockResolvedValue({
        files: [
          {
            path: "src/utils/helper.ts",
            content: "fixed",
            operation: "update",
          },
        ],
        reasoning: "Fixed",
      });

      const mockLLM = {
        withStructuredOutput: vi.fn().mockReturnValue({
          invoke: mockInvoke,
        }),
      } as unknown as ChatAnthropic;

      await fixCodeNode(baseState, { llm: mockLLM });

      const promptArg = mockInvoke.mock.calls[0]?.[0] as string;
      // Should include the buggy code
      expect(promptArg).toContain('return "helo"');
      // Should include file paths
      expect(promptArg).toContain("src/utils/helper.ts");
      expect(promptArg).toContain("src/utils/helper.test.ts");
    });

    it("includes task description in prompt", async () => {
      const mockInvoke = vi.fn().mockResolvedValue({
        files: [],
        reasoning: "No changes needed",
      });

      const mockLLM = {
        withStructuredOutput: vi.fn().mockReturnValue({
          invoke: mockInvoke,
        }),
      } as unknown as ChatAnthropic;

      await fixCodeNode(baseState, { llm: mockLLM });

      const promptArg = mockInvoke.mock.calls[0]?.[0] as string;
      expect(promptArg).toContain(baseState.taskDescription);
    });
  });

  describe("output handling", () => {
    it("returns updated FileChange[]", async () => {
      const mockResponse: FixCodeOutput = {
        files: [
          {
            path: "src/utils/helper.ts",
            content: 'export function helper() { return "hello"; }',
            operation: "update",
          },
        ],
        reasoning: "Fixed typo in return value",
      };

      const mockLLM = createMockLLM(mockResponse);
      const result = await fixCodeNode(baseState, { llm: mockLLM });

      expect(result.files).toBeDefined();
      expect(result.files).toHaveLength(1);
      expect(result.files?.[0]?.content).toContain('"hello"');
      expect(mockLLM.withStructuredOutput).toHaveBeenCalledWith(
        FixCodeOutputSchema,
      );
    });

    it("sets status to 'testing' after fix", async () => {
      const mockResponse: FixCodeOutput = {
        files: [{ path: "src/test.ts", content: "fixed", operation: "update" }],
        reasoning: "Fixed the issue",
      };

      const mockLLM = createMockLLM(mockResponse);
      const result = await fixCodeNode(baseState, { llm: mockLLM });

      expect(result.status).toBe("testing");
    });
  });

  describe("error handling", () => {
    it("handles LLM errors gracefully", async () => {
      const mockLLM = createErrorMockLLM(new Error("API rate limit exceeded"));
      const result = await fixCodeNode(baseState, { llm: mockLLM });

      expect(result.status).toBe("failed");
      expect(result.error).toBe("API rate limit exceeded");
      expect(result.files).toBeUndefined();
    });

    it("handles unknown errors gracefully", async () => {
      const mockLLM = {
        withStructuredOutput: vi.fn().mockReturnValue({
          invoke: vi.fn().mockRejectedValue("string error"),
        }),
      } as unknown as ChatAnthropic;

      const result = await fixCodeNode(baseState, { llm: mockLLM });

      expect(result.status).toBe("failed");
      expect(result.error).toBe("Unknown error during code fix");
    });
  });

  describe("edge cases", () => {
    it("handles null testResult", async () => {
      const mockInvoke = vi.fn().mockResolvedValue({
        files: [],
        reasoning: "No test output to fix",
      });

      const mockLLM = {
        withStructuredOutput: vi.fn().mockReturnValue({
          invoke: mockInvoke,
        }),
      } as unknown as ChatAnthropic;

      const stateWithNoResult: DevWorkflowStateType = {
        ...baseState,
        testResult: null,
      };

      await fixCodeNode(stateWithNoResult, { llm: mockLLM });

      const promptArg = mockInvoke.mock.calls[0]?.[0] as string;
      expect(promptArg).toContain("No test output available");
    });

    it("handles empty files array", async () => {
      const mockInvoke = vi.fn().mockResolvedValue({
        files: [{ path: "new.ts", content: "content", operation: "create" }],
        reasoning: "Created missing file",
      });

      const mockLLM = {
        withStructuredOutput: vi.fn().mockReturnValue({
          invoke: mockInvoke,
        }),
      } as unknown as ChatAnthropic;

      const stateWithNoFiles: DevWorkflowStateType = {
        ...baseState,
        files: [],
      };

      const result = await fixCodeNode(stateWithNoFiles, { llm: mockLLM });

      expect(result.files).toHaveLength(1);
    });
  });
});
