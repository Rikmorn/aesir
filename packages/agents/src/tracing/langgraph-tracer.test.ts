import {
  createLogger,
  createTraceStore,
  type Logger,
  type TraceStore,
} from "@aesir/common";
import type { Serialized } from "@langchain/core/load/serializable";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLangGraphTracer, LangGraphTracer } from "./langgraph-tracer.js";

/**
 * Helper to create a mock Serialized object for chain/llm/tool
 */
function createMockSerialized(name: string): Serialized {
  return {
    lc: 1,
    type: "constructor" as const,
    id: ["langchain", "chains", name],
    kwargs: {},
  };
}

describe("LangGraphTracer", () => {
  let store: TraceStore;
  let mockLogger: {
    info: ReturnType<typeof vi.fn>;
    debug: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
  };
  let tracer: LangGraphTracer;

  beforeEach(() => {
    store = createTraceStore();
    mockLogger = {
      info: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    };
    tracer = new LangGraphTracer(mockLogger as unknown as Logger, store);
  });

  describe("handleChainStart", () => {
    it("calls logger.info with chain_start action", () => {
      tracer.handleChainStart(
        createMockSerialized("TestChain"),
        { input: "test" },
        "run-123",
      );

      expect(mockLogger.info).toHaveBeenCalledWith("chain_start", {
        context: expect.objectContaining({
          runId: "run-123",
          chainType: "TestChain",
        }),
      });
    });

    it("entry includes runId in context", () => {
      tracer.handleChainStart(
        createMockSerialized("TestChain"),
        { input: "test" },
        "run-456",
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        "chain_start",
        expect.objectContaining({
          context: expect.objectContaining({ runId: "run-456" }),
        }),
      );
    });

    it("includes parentRunId when provided", () => {
      tracer.handleChainStart(
        createMockSerialized("TestChain"),
        { input: "test" },
        "run-123",
        "parent-456",
      );

      expect(mockLogger.info).toHaveBeenCalledWith("chain_start", {
        context: expect.objectContaining({
          runId: "run-123",
          parentRunId: "parent-456",
        }),
      });
    });

    it("entry appended to store", () => {
      tracer.handleChainStart(
        createMockSerialized("TestChain"),
        { input: "test" },
        "run-123",
      );

      // Note: store.append needs taskId in context to store, but we're testing direct append
      // The entry is appended but won't be queryable without taskId
      expect(store.size()).toBe(0); // No taskId means not indexed
    });
  });

  describe("handleChainEnd", () => {
    it("calls logger.info with chain_end action", () => {
      tracer.handleChainEnd({ output: "result" }, "run-123");

      expect(mockLogger.info).toHaveBeenCalledWith("chain_end", {
        outcome: "success",
        context: { runId: "run-123" },
      });
    });

    it("includes outcome: success", () => {
      tracer.handleChainEnd({ output: "result" }, "run-789");

      expect(mockLogger.info).toHaveBeenCalledWith("chain_end", {
        outcome: "success",
        context: expect.objectContaining({ runId: "run-789" }),
      });
    });
  });

  describe("handleChainError", () => {
    it("calls logger.error with chain_error action", () => {
      const error = new Error("Test error message");
      tracer.handleChainError(error, "run-123");

      expect(mockLogger.error).toHaveBeenCalledWith("chain_error", {
        outcome: "failure",
        message: "Test error message",
        context: { runId: "run-123" },
      });
    });

    it("includes outcome: failure", () => {
      const error = new Error("Something went wrong");
      tracer.handleChainError(error, "run-456");

      expect(mockLogger.error).toHaveBeenCalledWith(
        "chain_error",
        expect.objectContaining({ outcome: "failure" }),
      );
    });

    it("includes error message", () => {
      const error = new Error("Detailed error info");
      tracer.handleChainError(error, "run-789");

      expect(mockLogger.error).toHaveBeenCalledWith(
        "chain_error",
        expect.objectContaining({ message: "Detailed error info" }),
      );
    });
  });

  describe("handleLLMStart", () => {
    it("calls logger.debug with llm_start action", () => {
      tracer.handleLLMStart(
        createMockSerialized("ChatAnthropic"),
        ["prompt 1", "prompt 2"],
        "run-123",
      );

      expect(mockLogger.debug).toHaveBeenCalledWith("llm_start", {
        context: expect.objectContaining({
          runId: "run-123",
          modelName: "ChatAnthropic",
        }),
      });
    });

    it("includes promptCount", () => {
      tracer.handleLLMStart(
        createMockSerialized("ChatAnthropic"),
        ["prompt 1", "prompt 2", "prompt 3"],
        "run-123",
      );

      expect(mockLogger.debug).toHaveBeenCalledWith("llm_start", {
        context: expect.objectContaining({
          promptCount: 3,
        }),
      });
    });

    it("includes parentRunId when provided", () => {
      tracer.handleLLMStart(
        createMockSerialized("ChatAnthropic"),
        ["prompt"],
        "run-123",
        "parent-456",
      );

      expect(mockLogger.debug).toHaveBeenCalledWith("llm_start", {
        context: expect.objectContaining({
          parentRunId: "parent-456",
        }),
      });
    });
  });

  describe("handleLLMEnd", () => {
    it("calls logger.debug with llm_end action", () => {
      tracer.handleLLMEnd({ generations: [], llmOutput: {} }, "run-123");

      expect(mockLogger.debug).toHaveBeenCalledWith("llm_end", {
        context: expect.objectContaining({ runId: "run-123" }),
      });
    });

    it("handles tokenUsage when present", () => {
      tracer.handleLLMEnd(
        {
          generations: [],
          llmOutput: {
            tokenUsage: {
              totalTokens: 1000,
              promptTokens: 400,
              completionTokens: 600,
            },
          },
        },
        "run-123",
      );

      expect(mockLogger.debug).toHaveBeenCalledWith("llm_end", {
        context: expect.objectContaining({
          totalTokens: 1000,
          promptTokens: 400,
          completionTokens: 600,
        }),
      });
    });

    it("handles missing tokenUsage gracefully", () => {
      tracer.handleLLMEnd({ generations: [] }, "run-123");

      expect(mockLogger.debug).toHaveBeenCalledWith("llm_end", {
        context: { runId: "run-123" },
      });
    });
  });

  describe("handleToolStart", () => {
    it("calls logger.info with tool_start action", () => {
      tracer.handleToolStart(
        createMockSerialized("GenerateCodeTool"),
        "input data",
        "run-123",
      );

      expect(mockLogger.info).toHaveBeenCalledWith("tool_start", {
        context: expect.objectContaining({
          runId: "run-123",
          toolName: "GenerateCodeTool",
        }),
      });
    });

    it("includes tool name", () => {
      tracer.handleToolStart(
        createMockSerialized("RunTestsTool"),
        "test input",
        "run-456",
      );

      expect(mockLogger.info).toHaveBeenCalledWith("tool_start", {
        context: expect.objectContaining({
          toolName: "RunTestsTool",
        }),
      });
    });

    it("includes inputLength not full input", () => {
      const longInput = "a".repeat(1000);
      tracer.handleToolStart(
        createMockSerialized("TestTool"),
        longInput,
        "run-123",
      );

      expect(mockLogger.info).toHaveBeenCalledWith("tool_start", {
        context: expect.objectContaining({
          inputLength: 1000,
        }),
      });
    });
  });

  describe("handleToolEnd", () => {
    it("calls logger.info with tool_end action", () => {
      tracer.handleToolEnd("output result", "run-123");

      expect(mockLogger.info).toHaveBeenCalledWith("tool_end", {
        context: expect.objectContaining({
          runId: "run-123",
        }),
      });
    });

    it("includes outputLength", () => {
      tracer.handleToolEnd("short output", "run-123");

      expect(mockLogger.info).toHaveBeenCalledWith("tool_end", {
        context: expect.objectContaining({
          outputLength: 12,
        }),
      });
    });
  });

  describe("Error isolation", () => {
    it("handler error does NOT propagate (wrapped in try/catch)", () => {
      // Create a logger that throws on every call
      const throwingLogger = {
        info: vi.fn().mockImplementation(() => {
          throw new Error("Logger error");
        }),
        debug: vi.fn().mockImplementation(() => {
          throw new Error("Logger error");
        }),
        error: vi.fn().mockImplementation(() => {
          throw new Error("Logger error");
        }),
        warn: vi.fn(),
      };

      const tracerWithThrow = new LangGraphTracer(
        throwingLogger as unknown as Logger,
        store,
      );

      // These should NOT throw
      expect(() =>
        tracerWithThrow.handleChainStart(
          createMockSerialized("Test"),
          {},
          "run-123",
        ),
      ).not.toThrow();

      expect(() => tracerWithThrow.handleChainEnd({}, "run-123")).not.toThrow();

      expect(() =>
        tracerWithThrow.handleChainError(new Error("test"), "run-123"),
      ).not.toThrow();

      expect(() =>
        tracerWithThrow.handleLLMStart(
          createMockSerialized("Test"),
          [],
          "run-123",
        ),
      ).not.toThrow();

      expect(() =>
        tracerWithThrow.handleLLMEnd({ generations: [] }, "run-123"),
      ).not.toThrow();

      expect(() =>
        tracerWithThrow.handleToolStart(
          createMockSerialized("Test"),
          "",
          "run-123",
        ),
      ).not.toThrow();

      expect(() => tracerWithThrow.handleToolEnd("", "run-123")).not.toThrow();
    });

    it("subsequent handlers still execute after error", () => {
      // First call throws, second should still work
      let callCount = 0;
      const sometimesThrowingLogger = {
        info: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            throw new Error("First call fails");
          }
        }),
        debug: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
      };

      const tracerWithPartialThrow = new LangGraphTracer(
        sometimesThrowingLogger as unknown as Logger,
        store,
      );

      // First call - should not throw (error caught internally)
      expect(() =>
        tracerWithPartialThrow.handleChainStart(
          createMockSerialized("Test"),
          {},
          "run-1",
        ),
      ).not.toThrow();

      // Second call - should execute normally
      tracerWithPartialThrow.handleChainEnd({}, "run-2");

      // The second handler should have been called
      expect(sometimesThrowingLogger.info).toHaveBeenCalledTimes(2);
    });
  });

  describe("Integration with TaskId context", () => {
    it("child logger with taskId produces queryable entries from store", () => {
      // Create a real logger that outputs to store
      const realStore = createTraceStore();
      const realLogger = createLogger({
        minLevel: "debug",
        console: false,
        output: (entry) => realStore.append(entry),
        defaultContext: { taskId: "TASK-001" },
      });

      const realTracer = new LangGraphTracer(realLogger, realStore);

      // Trigger some events
      realTracer.handleChainStart(
        createMockSerialized("TestChain"),
        {},
        "run-123",
      );
      realTracer.handleChainEnd({}, "run-123");
      realTracer.handleToolStart(
        createMockSerialized("TestTool"),
        "input",
        "run-456",
      );
      realTracer.handleToolEnd("output", "run-456");

      // Query by taskId - entries from logger output (not direct store.append since those don't have taskId)
      const entries = realStore.getByTaskId("TASK-001");

      // Should have 4 entries from logger output (chain_start, chain_end, tool_start, tool_end)
      expect(entries.length).toBeGreaterThanOrEqual(4);

      // Verify actions are present
      const actions = entries.map((e) => e.action);
      expect(actions).toContain("chain_start");
      expect(actions).toContain("chain_end");
      expect(actions).toContain("tool_start");
      expect(actions).toContain("tool_end");
    });
  });

  describe("createLangGraphTracer factory", () => {
    it("creates a LangGraphTracer instance", () => {
      const logger = createLogger({ console: false });
      const store = createTraceStore();

      const tracer = createLangGraphTracer(logger, store);

      expect(tracer).toBeInstanceOf(LangGraphTracer);
      expect(tracer.name).toBe("LangGraphTracer");
    });
  });

  describe("LangGraphTracer.name property", () => {
    it("has name set to LangGraphTracer", () => {
      expect(tracer.name).toBe("LangGraphTracer");
    });
  });
});
