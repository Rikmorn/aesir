/**
 * Code Generation Node Tests
 *
 * Tests for generateCodeNode with mock LLM for structured output.
 */

import type { ChatAnthropic } from "@langchain/anthropic";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DevWorkflowStateType } from "../state/index.js";
import {
  type CodeGenerationOutput,
  CodeGenerationOutputSchema,
  generateCodeNode,
} from "./generate-code.js";

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

// Create a minimal mock for ChatAnthropic with structured output
function createMockLLM(response: CodeGenerationOutput) {
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

describe("CodeGenerationOutputSchema", () => {
  it("validates valid output with files and reasoning", () => {
    const validOutput: CodeGenerationOutput = {
      files: [
        {
          path: "src/utils/helper.ts",
          content: 'export function helper() { return "hello"; }',
          operation: "create",
        },
      ],
      reasoning: "Created a simple helper function",
    };

    const result = CodeGenerationOutputSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
  });

  it("validates output with multiple files", () => {
    const validOutput: CodeGenerationOutput = {
      files: [
        {
          path: "src/index.ts",
          content: "export * from './utils';",
          operation: "create",
        },
        {
          path: "src/utils/index.ts",
          content: "export * from './helper';",
          operation: "create",
        },
      ],
      reasoning: "Created index files for module exports",
    };

    const result = CodeGenerationOutputSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.files).toHaveLength(2);
    }
  });

  it("validates output with empty files array", () => {
    const validOutput: CodeGenerationOutput = {
      files: [],
      reasoning: "No files needed for this task",
    };

    const result = CodeGenerationOutputSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
  });

  it("rejects output missing files", () => {
    const invalidOutput = {
      reasoning: "Some reasoning",
    };

    const result = CodeGenerationOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });

  it("rejects output missing reasoning", () => {
    const invalidOutput = {
      files: [],
    };

    const result = CodeGenerationOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });
});

describe("generateCodeNode", () => {
  const baseState: DevWorkflowStateType = {
    taskId: "TEST-123",
    sessionId: "session-test",
    taskDescription: "Create a utility function that adds two numbers",
    repositoryUrl: "owner/repo",
    branchName: null,
    files: [],
    testResult: null,
    testAttempts: 0,
    status: "coding",
    error: null,
    prNumber: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns FileChange[] on valid task", async () => {
    const mockResponse: CodeGenerationOutput = {
      files: [
        {
          path: "src/math/add.ts",
          content: `/**
 * Adds two numbers together
 * @param a - First number
 * @param b - Second number
 * @returns The sum of a and b
 */
export function add(a: number, b: number): number {
  return a + b;
}`,
          operation: "create",
        },
        {
          path: "src/math/add.test.ts",
          content: `import { describe, it, expect } from "vitest";
import { add } from "./add.js";

describe("add", () => {
  it("adds two positive numbers", () => {
    expect(add(2, 3)).toBe(5);
  });
});`,
          operation: "create",
        },
      ],
      reasoning: "Created add function with comprehensive test coverage",
    };

    const mockLLM = createMockLLM(mockResponse);
    const result = await generateCodeNode(baseState, { llm: mockLLM });

    expect(result.files).toBeDefined();
    expect(result.files).toHaveLength(2);
    if (result.files && result.files.length === 2) {
      expect(result.files[0]?.path).toBe("src/math/add.ts");
      expect(result.files[0]?.operation).toBe("create");
      expect(result.files[1]?.path).toBe("src/math/add.test.ts");
    }
    expect(mockLLM.withStructuredOutput).toHaveBeenCalledWith(
      CodeGenerationOutputSchema,
    );
  });

  it("updates status to testing on success", async () => {
    const mockResponse: CodeGenerationOutput = {
      files: [{ path: "src/test.ts", content: "content", operation: "create" }],
      reasoning: "Simple test file",
    };

    const mockLLM = createMockLLM(mockResponse);
    const result = await generateCodeNode(baseState, { llm: mockLLM });

    expect(result.status).toBe("testing");
  });

  it("handles LLM errors gracefully", async () => {
    const mockLLM = createErrorMockLLM(new Error("API rate limit exceeded"));
    const result = await generateCodeNode(baseState, { llm: mockLLM });

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

    const result = await generateCodeNode(baseState, { llm: mockLLM });

    expect(result.status).toBe("failed");
    expect(result.error).toBe("Unknown error during code generation");
  });

  it("passes task description to prompt", async () => {
    const mockInvoke = vi.fn().mockResolvedValue({
      files: [],
      reasoning: "No files needed",
    });

    const mockLLM = {
      withStructuredOutput: vi.fn().mockReturnValue({
        invoke: mockInvoke,
      }),
    } as unknown as ChatAnthropic;

    await generateCodeNode(baseState, { llm: mockLLM });

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    const promptArg = mockInvoke.mock.calls[0]?.[0] as string;
    expect(promptArg).toContain(baseState.taskDescription);
    expect(promptArg).toContain("TypeScript");
  });

  it("works with different task descriptions", async () => {
    const customState: DevWorkflowStateType = {
      ...baseState,
      taskDescription: "Create a REST API endpoint for user registration",
    };

    const mockResponse: CodeGenerationOutput = {
      files: [
        {
          path: "src/api/register.ts",
          content: "// registration",
          operation: "create",
        },
      ],
      reasoning: "Created registration endpoint",
    };

    const mockLLM = createMockLLM(mockResponse);
    const result = await generateCodeNode(customState, { llm: mockLLM });

    expect(result.files).toBeDefined();
    expect(result.files).toHaveLength(1);
    expect(result.files?.[0]?.path).toBe("src/api/register.ts");
  });

  it("returns empty files array when LLM returns none", async () => {
    const mockResponse: CodeGenerationOutput = {
      files: [],
      reasoning: "This task requires no code changes",
    };

    const mockLLM = createMockLLM(mockResponse);
    const result = await generateCodeNode(baseState, { llm: mockLLM });

    expect(result.files).toEqual([]);
    expect(result.status).toBe("testing");
  });
});
