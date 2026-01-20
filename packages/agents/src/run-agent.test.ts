/**
 * Tests for Agent Runner with Safety Guardrails
 *
 * Tests the runAgentWithGuardrails function behavior including:
 * - Recursion limit enforcement
 * - Timeout handling
 * - Error handling
 * - Structured result format
 */

import { GraphRecursionError } from "@langchain/langgraph";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";

// Mock the devAgent
vi.mock("./dev-agent.js", () => ({
  devAgent: {
    invoke: vi.fn(),
  },
}));

// Mock the config
vi.mock("../config/index.js", () => ({
  devAgentConfig: {
    recursionLimit: 25,
    maxIterations: 10,
    timeoutMs: 300000,
  },
}));

// Mock the logger
vi.mock("../logging/index.js", () => ({
  logger: {
    child: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
  },
}));

import { devAgent } from "./dev-agent.js";
import { runAgentWithGuardrails } from "./run-agent.js";

// Type assertion for the mocked invoke function
const mockInvoke = devAgent.invoke as Mock;

describe("runAgentWithGuardrails", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("successful execution", () => {
    it("should return success result when agent completes normally", async () => {
      const mockResult = { messages: [{ role: "assistant", content: "Done" }] };
      mockInvoke.mockResolvedValueOnce(mockResult);

      const result = await runAgentWithGuardrails(
        "Generate a hello world function",
        "test-thread-1",
      );

      expect(result.success).toBe(true);
      expect(result.result).toEqual(mockResult);
      expect(result.terminationReason).toBe("completed");
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("should pass recursionLimit to invoke", async () => {
      mockInvoke.mockResolvedValueOnce({});

      await runAgentWithGuardrails("Test task", "test-thread-2");

      expect(devAgent.invoke).toHaveBeenCalledWith(
        { messages: [{ role: "user", content: "Test task" }] },
        expect.objectContaining({
          recursionLimit: 25,
          configurable: { thread_id: "test-thread-2" },
        }),
      );
    });

    it("should pass AbortSignal to invoke", async () => {
      mockInvoke.mockResolvedValueOnce({});

      await runAgentWithGuardrails("Test task", "test-thread-3");

      expect(devAgent.invoke).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        }),
      );
    });
  });

  describe("recursion limit handling", () => {
    it("should handle GraphRecursionError gracefully", async () => {
      mockInvoke.mockRejectedValueOnce(
        new GraphRecursionError("Recursion limit exceeded"),
      );

      const result = await runAgentWithGuardrails("Test task", "test-thread-4");

      expect(result.success).toBe(false);
      expect(result.terminationReason).toBe("recursion_limit");
      expect(result.error).toBe("Agent exceeded recursion limit");
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("timeout handling", () => {
    it("should handle timeout via AbortError", async () => {
      const abortError = new Error("The operation was aborted");
      abortError.name = "AbortError";

      mockInvoke.mockRejectedValueOnce(abortError);

      const result = await runAgentWithGuardrails(
        "Test task",
        "test-thread-5",
        1000, // Short timeout for test
      );

      expect(result.success).toBe(false);
      expect(result.terminationReason).toBe("timeout");
      expect(result.error).toContain("exceeded timeout");
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("should accept custom timeout", async () => {
      mockInvoke.mockResolvedValueOnce({});

      const result = await runAgentWithGuardrails(
        "Test task",
        "test-thread-6",
        60000, // 1 minute custom timeout
      );

      expect(result.success).toBe(true);
    });
  });

  describe("error handling", () => {
    it("should handle generic errors", async () => {
      mockInvoke.mockRejectedValueOnce(new Error("Something went wrong"));

      const result = await runAgentWithGuardrails("Test task", "test-thread-7");

      expect(result.success).toBe(false);
      expect(result.terminationReason).toBe("error");
      expect(result.error).toBe("Something went wrong");
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("should handle non-Error thrown values", async () => {
      mockInvoke.mockRejectedValueOnce("string error");

      const result = await runAgentWithGuardrails("Test task", "test-thread-8");

      expect(result.success).toBe(false);
      expect(result.terminationReason).toBe("error");
      expect(result.error).toBe("string error");
    });
  });

  describe("result structure", () => {
    it("should always include terminationReason", async () => {
      // Success case
      mockInvoke.mockResolvedValueOnce({});
      const successResult = await runAgentWithGuardrails("Task", "thread-1");
      expect(successResult).toHaveProperty("terminationReason");

      // Error case
      mockInvoke.mockRejectedValueOnce(new Error("test"));
      const errorResult = await runAgentWithGuardrails("Task", "thread-2");
      expect(errorResult).toHaveProperty("terminationReason");

      // Recursion limit case
      mockInvoke.mockRejectedValueOnce(new GraphRecursionError("limit"));
      const recursionResult = await runAgentWithGuardrails("Task", "thread-3");
      expect(recursionResult).toHaveProperty("terminationReason");
    });

    it("should always include durationMs", async () => {
      mockInvoke.mockResolvedValueOnce({});
      const result = await runAgentWithGuardrails("Task", "thread-test");

      expect(typeof result.durationMs).toBe("number");
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });
});
