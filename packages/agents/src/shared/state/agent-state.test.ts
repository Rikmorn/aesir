/**
 * Agent State Schema Tests
 *
 * Tests for the agent state schema, reducers, and utility functions.
 */

import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";
import {
  AgentState,
  type AgentStateType,
  type AgentStatus,
  AgentStatusSchema,
  createInitialState,
  hasExceededLoopLimit,
  MAX_LOOP_COUNT,
  shouldContinue,
} from "./agent-state.js";

describe("AgentState", () => {
  describe("AgentStatusSchema", () => {
    it("should validate valid status values", () => {
      expect(AgentStatusSchema.parse("running")).toBe("running");
      expect(AgentStatusSchema.parse("completed")).toBe("completed");
      expect(AgentStatusSchema.parse("error")).toBe("error");
      expect(AgentStatusSchema.parse("timeout")).toBe("timeout");
    });

    it("should reject invalid status values", () => {
      expect(() => AgentStatusSchema.parse("invalid")).toThrow();
      expect(() => AgentStatusSchema.parse("")).toThrow();
      expect(() => AgentStatusSchema.parse(123)).toThrow();
    });
  });

  describe("MAX_LOOP_COUNT", () => {
    it("should be defined as 10", () => {
      expect(MAX_LOOP_COUNT).toBe(10);
    });
  });

  describe("AgentState.spec", () => {
    it("should have the correct state channels", () => {
      const spec = AgentState.spec;

      expect(spec).toHaveProperty("messages");
      expect(spec).toHaveProperty("loopCount");
      expect(spec).toHaveProperty("status");
      expect(spec).toHaveProperty("taskDescription");
      expect(spec).toHaveProperty("generatedCode");
    });

    it("should mark channels as LangGraph channels", () => {
      const spec = AgentState.spec;

      // LangGraph marks channels with lg_is_channel
      expect(spec.messages.lg_is_channel).toBe(true);
      expect(spec.loopCount.lg_is_channel).toBe(true);
      expect(spec.status.lg_is_channel).toBe(true);
      expect(spec.taskDescription.lg_is_channel).toBe(true);
      expect(spec.generatedCode.lg_is_channel).toBe(true);
    });
  });

  describe("channel behavior", () => {
    it("should have messages channel with concat operator", () => {
      const spec = AgentState.spec;
      // Access the internal operator function
      const messagesChannel = spec.messages as unknown as {
        operator: (a: unknown[], b: unknown[]) => unknown[];
        initialValueFactory: () => unknown[];
      };

      // Test the operator (reducer) behavior
      const result = messagesChannel.operator(
        [new HumanMessage("Hello")],
        [new AIMessage("Hi there")],
      );
      expect(result).toHaveLength(2);
      expect(result[0]).toBeInstanceOf(HumanMessage);
      expect(result[1]).toBeInstanceOf(AIMessage);

      // Test the default factory
      expect(messagesChannel.initialValueFactory()).toEqual([]);
    });

    it("should have loopCount channel with replace operator", () => {
      const spec = AgentState.spec;
      const loopCountChannel = spec.loopCount as unknown as {
        operator: (a: number, b: number) => number;
        initialValueFactory: () => number;
      };

      // Test replace behavior - should return incoming value
      expect(loopCountChannel.operator(0, 5)).toBe(5);
      expect(loopCountChannel.operator(5, 10)).toBe(10);

      // Test the default factory
      expect(loopCountChannel.initialValueFactory()).toBe(0);
    });

    it("should have status channel with replace operator", () => {
      const spec = AgentState.spec;
      const statusChannel = spec.status as unknown as {
        operator: (a: AgentStatus, b: AgentStatus) => AgentStatus;
        initialValueFactory: () => AgentStatus;
      };

      // Test replace behavior
      expect(statusChannel.operator("running", "completed")).toBe("completed");
      expect(statusChannel.operator("completed", "error")).toBe("error");

      // Test the default factory
      expect(statusChannel.initialValueFactory()).toBe("running");
    });

    it("should have taskDescription channel with replace operator", () => {
      const spec = AgentState.spec;
      const taskDescriptionChannel = spec.taskDescription as unknown as {
        operator: (a: string, b: string) => string;
        initialValueFactory: () => string;
      };

      // Test replace behavior
      expect(taskDescriptionChannel.operator("old", "new")).toBe("new");

      // Test the default factory
      expect(taskDescriptionChannel.initialValueFactory()).toBe("");
    });

    it("should have generatedCode channel with replace operator", () => {
      const spec = AgentState.spec;
      const generatedCodeChannel = spec.generatedCode as unknown as {
        operator: (a: string | null, b: string | null) => string | null;
        initialValueFactory: () => string | null;
      };

      // Test replace behavior
      expect(generatedCodeChannel.operator(null, "code")).toBe("code");
      expect(generatedCodeChannel.operator("old", "new")).toBe("new");
      expect(generatedCodeChannel.operator("code", null)).toBeNull();

      // Test the default factory
      expect(generatedCodeChannel.initialValueFactory()).toBeNull();
    });
  });
});

describe("hasExceededLoopLimit", () => {
  it("should return false when loopCount is below limit", () => {
    const state = {
      messages: [],
      loopCount: 0,
      status: "running" as AgentStatus,
      taskDescription: "test",
      generatedCode: null,
    };

    expect(hasExceededLoopLimit(state)).toBe(false);
  });

  it("should return false when loopCount is just below limit", () => {
    const state: AgentStateType = {
      messages: [],
      loopCount: MAX_LOOP_COUNT - 1,
      status: "running",
      taskDescription: "test",
      generatedCode: null,
    };

    expect(hasExceededLoopLimit(state)).toBe(false);
  });

  it("should return true when loopCount equals limit", () => {
    const state: AgentStateType = {
      messages: [],
      loopCount: MAX_LOOP_COUNT,
      status: "running",
      taskDescription: "test",
      generatedCode: null,
    };

    expect(hasExceededLoopLimit(state)).toBe(true);
  });

  it("should return true when loopCount exceeds limit", () => {
    const state: AgentStateType = {
      messages: [],
      loopCount: MAX_LOOP_COUNT + 5,
      status: "running",
      taskDescription: "test",
      generatedCode: null,
    };

    expect(hasExceededLoopLimit(state)).toBe(true);
  });
});

describe("shouldContinue", () => {
  it("should return true when running and under loop limit", () => {
    const state: AgentStateType = {
      messages: [],
      loopCount: 5,
      status: "running",
      taskDescription: "test",
      generatedCode: null,
    };

    expect(shouldContinue(state)).toBe(true);
  });

  it("should return false when status is completed", () => {
    const state: AgentStateType = {
      messages: [],
      loopCount: 5,
      status: "completed",
      taskDescription: "test",
      generatedCode: null,
    };

    expect(shouldContinue(state)).toBe(false);
  });

  it("should return false when status is error", () => {
    const state: AgentStateType = {
      messages: [],
      loopCount: 5,
      status: "error",
      taskDescription: "test",
      generatedCode: null,
    };

    expect(shouldContinue(state)).toBe(false);
  });

  it("should return false when status is timeout", () => {
    const state: AgentStateType = {
      messages: [],
      loopCount: 5,
      status: "timeout",
      taskDescription: "test",
      generatedCode: null,
    };

    expect(shouldContinue(state)).toBe(false);
  });

  it("should return false when loop limit exceeded", () => {
    const state: AgentStateType = {
      messages: [],
      loopCount: MAX_LOOP_COUNT,
      status: "running",
      taskDescription: "test",
      generatedCode: null,
    };

    expect(shouldContinue(state)).toBe(false);
  });

  it("should return false when both conditions fail", () => {
    const state: AgentStateType = {
      messages: [],
      loopCount: MAX_LOOP_COUNT + 1,
      status: "error",
      taskDescription: "test",
      generatedCode: null,
    };

    expect(shouldContinue(state)).toBe(false);
  });
});

describe("createInitialState", () => {
  it("should create initial state with task description", () => {
    const taskDescription = "Create a function to calculate factorial";
    const state = createInitialState(taskDescription);

    expect(state.messages).toEqual([]);
    expect(state.loopCount).toBe(0);
    expect(state.status).toBe("running");
    expect(state.taskDescription).toBe(taskDescription);
    expect(state.generatedCode).toBeNull();
  });

  it("should handle empty task description", () => {
    const state = createInitialState("");

    expect(state.taskDescription).toBe("");
    expect(state.status).toBe("running");
  });

  it("should handle long task description", () => {
    const longDescription = "x".repeat(10000);
    const state = createInitialState(longDescription);

    expect(state.taskDescription).toBe(longDescription);
  });
});
