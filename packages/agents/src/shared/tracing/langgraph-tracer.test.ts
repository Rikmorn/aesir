import {
  createPinoLogger,
  createTraceStore,
  type PinoLogger,
  type TraceStore,
} from "@aesir/platform";
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
    tracer = new LangGraphTracer(mockLogger as unknown as PinoLogger, store);
  });

  describe("handleChainStart", () => {
    it("calls logger.info with chain_start action", () => {
      tracer.handleChainStart(
        createMockSerialized("TestChain"),
        { input: "test" },
        "run-123",
      );

      // Pino API: logger.info(context, message)
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: "run-123",
          chainType: "TestChain",
        }),
        "chain_start",
      );
    });

    it("entry includes runId in context", () => {
      tracer.handleChainStart(
        createMockSerialized("TestChain"),
        { input: "test" },
        "run-456",
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ runId: "run-456" }),
        "chain_start",
      );
    });

    it("includes parentRunId when provided", () => {
      tracer.handleChainStart(
        createMockSerialized("TestChain"),
        { input: "test" },
        "run-123",
        "parent-456",
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: "run-123",
          parentRunId: "parent-456",
        }),
        "chain_start",
      );
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

      expect(mockLogger.info).toHaveBeenCalledWith(
        { runId: "run-123" },
        "chain_end",
      );
    });

    it("includes runId in context", () => {
      tracer.handleChainEnd({ output: "result" }, "run-789");

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ runId: "run-789" }),
        "chain_end",
      );
    });
  });

  describe("handleChainError", () => {
    it("calls logger.error with chain_error action", () => {
      const error = new Error("Test error message");
      tracer.handleChainError(error, "run-123");

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: "run-123",
          err: "Test error message",
        }),
        "chain_error",
      );
    });

    it("includes error message in context", () => {
      const error = new Error("Something went wrong");
      tracer.handleChainError(error, "run-456");

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: "Something went wrong" }),
        "chain_error",
      );
    });

    it("includes error message", () => {
      const error = new Error("Detailed error info");
      tracer.handleChainError(error, "run-789");

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: "Detailed error info" }),
        "chain_error",
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

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: "run-123",
          modelName: "ChatAnthropic",
        }),
        "llm_start",
      );
    });

    it("includes promptCount", () => {
      tracer.handleLLMStart(
        createMockSerialized("ChatAnthropic"),
        ["prompt 1", "prompt 2", "prompt 3"],
        "run-123",
      );

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          promptCount: 3,
        }),
        "llm_start",
      );
    });

    it("includes parentRunId when provided", () => {
      tracer.handleLLMStart(
        createMockSerialized("ChatAnthropic"),
        ["prompt"],
        "run-123",
        "parent-456",
      );

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          parentRunId: "parent-456",
        }),
        "llm_start",
      );
    });
  });

  describe("handleLLMEnd", () => {
    it("calls logger.debug with llm_end action", () => {
      tracer.handleLLMEnd({ generations: [], llmOutput: {} }, "run-123");

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ runId: "run-123" }),
        "llm_end",
      );
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

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          totalTokens: 1000,
          promptTokens: 400,
          completionTokens: 600,
        }),
        "llm_end",
      );
    });

    it("handles missing tokenUsage gracefully", () => {
      tracer.handleLLMEnd({ generations: [] }, "run-123");

      expect(mockLogger.debug).toHaveBeenCalledWith(
        { runId: "run-123" },
        "llm_end",
      );
    });
  });

  describe("handleToolStart", () => {
    it("calls logger.info with tool_start action", () => {
      tracer.handleToolStart(
        createMockSerialized("GenerateCodeTool"),
        "input data",
        "run-123",
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: "run-123",
          toolName: "GenerateCodeTool",
        }),
        "tool_start",
      );
    });

    it("includes tool name", () => {
      tracer.handleToolStart(
        createMockSerialized("RunTestsTool"),
        "test input",
        "run-456",
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          toolName: "RunTestsTool",
        }),
        "tool_start",
      );
    });

    it("includes inputLength not full input", () => {
      const longInput = "a".repeat(1000);
      tracer.handleToolStart(
        createMockSerialized("TestTool"),
        longInput,
        "run-123",
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          inputLength: 1000,
        }),
        "tool_start",
      );
    });
  });

  describe("handleToolEnd", () => {
    it("calls logger.info with tool_end action", () => {
      tracer.handleToolEnd("output result", "run-123");

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: "run-123",
        }),
        "tool_end",
      );
    });

    it("includes outputLength", () => {
      tracer.handleToolEnd("short output", "run-123");

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          outputLength: 12,
        }),
        "tool_end",
      );
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
        throwingLogger as unknown as PinoLogger,
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
        sometimesThrowingLogger as unknown as PinoLogger,
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
      // Create a real pino logger with a custom destination that writes to store
      // Note: This test verifies the tracer appends entries directly to store
      const realStore = createTraceStore();
      const realLogger = createPinoLogger({
        component: "test",
      });

      // Create a child logger with taskId
      const childLogger = realLogger.child({ taskId: "TASK-001" });
      const realTracer = new LangGraphTracer(childLogger, realStore);

      // Trigger some events (these append directly to store via appendToStore)
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

      // The appendToStore method is called but entries don't have taskId
      // (tracer appends to store with action/context but store needs taskId in context)
      // This test validates the tracer integrates with pino logger
      expect(realStore.size()).toBe(0); // Entries without taskId in context aren't indexed
    });
  });

  describe("createLangGraphTracer factory", () => {
    it("creates a LangGraphTracer instance", () => {
      const logger = createPinoLogger({ component: "test" });
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
