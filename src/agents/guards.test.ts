/**
 * Tests for Agent Guard Functions
 *
 * Tests the loop guard and related utility functions for agent safety.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { END } from "@langchain/langgraph";
import { AIMessage, HumanMessage } from "@langchain/core/messages";

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

import {
  createLoopGuard,
  incrementLoopCount,
  hasExceededLimit,
  type LoopGuardState,
} from "./guards.js";

describe("guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createLoopGuard", () => {
    it("should return END when loop count exceeds limit", () => {
      const guard = createLoopGuard(5);
      const state: LoopGuardState = {
        loopCount: 5,
        messages: [],
      };

      const result = guard(state);

      expect(result).toBe(END);
    });

    it("should return END when loop count is over limit", () => {
      const guard = createLoopGuard(5);
      const state: LoopGuardState = {
        loopCount: 10,
        messages: [],
      };

      const result = guard(state);

      expect(result).toBe(END);
    });

    it("should return 'tools' when under limit and last message has tool calls", () => {
      const guard = createLoopGuard(10);
      const aiMessage = new AIMessage({
        content: "Let me use a tool",
        tool_calls: [
          { id: "call_1", name: "generate_code", args: { task: "hello" } },
        ],
      });
      const state: LoopGuardState = {
        loopCount: 3,
        messages: [new HumanMessage("Hello"), aiMessage],
      };

      const result = guard(state);

      expect(result).toBe("tools");
    });

    it("should return END when under limit but no tool calls", () => {
      const guard = createLoopGuard(10);
      const aiMessage = new AIMessage({
        content: "I have finished the task",
        tool_calls: [],
      });
      const state: LoopGuardState = {
        loopCount: 3,
        messages: [new HumanMessage("Hello"), aiMessage],
      };

      const result = guard(state);

      expect(result).toBe(END);
    });

    it("should return END when last message is not AIMessage", () => {
      const guard = createLoopGuard(10);
      const state: LoopGuardState = {
        loopCount: 3,
        messages: [new HumanMessage("Hello")],
      };

      const result = guard(state);

      expect(result).toBe(END);
    });

    it("should return END when messages array is empty", () => {
      const guard = createLoopGuard(10);
      const state: LoopGuardState = {
        loopCount: 0,
        messages: [],
      };

      const result = guard(state);

      expect(result).toBe(END);
    });

    it("should work with different max iteration values", () => {
      const guard1 = createLoopGuard(1);
      const guard100 = createLoopGuard(100);

      const stateAt1: LoopGuardState = { loopCount: 1, messages: [] };
      const stateAt99: LoopGuardState = { loopCount: 99, messages: [] };

      expect(guard1(stateAt1)).toBe(END);
      expect(guard100(stateAt99)).toBe(END); // No tool calls, so END
    });
  });

  describe("incrementLoopCount", () => {
    it("should increment loop count by 1", () => {
      const state = { loopCount: 0 };
      const result = incrementLoopCount(state);

      expect(result.loopCount).toBe(1);
    });

    it("should return new object with incremented count", () => {
      const state = { loopCount: 5 };
      const result = incrementLoopCount(state);

      expect(result.loopCount).toBe(6);
      // Original should be unchanged (pure function)
      expect(state.loopCount).toBe(5);
    });

    it("should work with any positive number", () => {
      expect(incrementLoopCount({ loopCount: 99 }).loopCount).toBe(100);
      expect(incrementLoopCount({ loopCount: 0 }).loopCount).toBe(1);
    });
  });

  describe("hasExceededLimit", () => {
    it("should return true when count equals limit", () => {
      expect(hasExceededLimit({ loopCount: 10 }, 10)).toBe(true);
    });

    it("should return true when count exceeds limit", () => {
      expect(hasExceededLimit({ loopCount: 15 }, 10)).toBe(true);
    });

    it("should return false when count is below limit", () => {
      expect(hasExceededLimit({ loopCount: 5 }, 10)).toBe(false);
    });

    it("should return false when count is 0 and limit is positive", () => {
      expect(hasExceededLimit({ loopCount: 0 }, 10)).toBe(false);
    });

    it("should return true when limit is 0", () => {
      expect(hasExceededLimit({ loopCount: 0 }, 0)).toBe(true);
    });
  });
});
