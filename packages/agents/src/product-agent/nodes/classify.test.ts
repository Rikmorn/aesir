/**
 * Classify Node Tests
 *
 * Tests for classifyNode with mock LLM for structured output.
 * Covers all classification types, confidence levels, and error handling.
 */

import type { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage } from "@langchain/core/messages";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_REQUIREMENTS,
  type ProductAgentPhase,
  type ProductAgentState,
} from "../state.js";
import {
  type ClassificationOutput,
  ClassificationOutputSchema,
  classifyNode,
} from "./classify.js";

// Mock the logger
vi.mock("@aesir/common", () => ({
  createPinoLogger: () => ({
    child: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    }),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

/**
 * Create a mock LLM that returns the specified classification output
 */
function createMockLLM(response: ClassificationOutput) {
  return {
    withStructuredOutput: vi.fn().mockReturnValue({
      invoke: vi.fn().mockResolvedValue(response),
    }),
  } as unknown as ChatAnthropic;
}

/**
 * Create a mock LLM that throws an error
 */
function createErrorMockLLM(error: Error) {
  return {
    withStructuredOutput: vi.fn().mockReturnValue({
      invoke: vi.fn().mockRejectedValue(error),
    }),
  } as unknown as ChatAnthropic;
}

/**
 * Create a base state for testing
 */
function createBaseState(
  overrides: Partial<ProductAgentState> = {},
): ProductAgentState {
  return {
    messages: [new HumanMessage("Test message")],
    requirements: { ...DEFAULT_REQUIREMENTS },
    phase: "gathering" as ProductAgentPhase,
    slackContext: {
      channelId: "C123",
      threadTs: null,
      userId: "U123",
    },
    createdTasks: [],
    classification: null,
    classificationConfidence: null,
    issueDraft: null,
    awaitingConfirmation: false,
    ...overrides,
  };
}

describe("ClassificationOutputSchema", () => {
  it("validates a valid feature_request classification", () => {
    const validOutput: ClassificationOutput = {
      type: "feature_request",
      confidence: "high",
      reasoning: "User is requesting a new export feature",
      response: null,
    };

    const result = ClassificationOutputSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
  });

  it("validates a valid question classification with response", () => {
    const validOutput: ClassificationOutput = {
      type: "question",
      confidence: "high",
      reasoning: "User is asking for help, not requesting work",
      response:
        "I help with feature requests and bugs. For questions, ask the team.",
    };

    const result = ClassificationOutputSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
  });

  it("rejects invalid classification type", () => {
    const invalidOutput = {
      type: "invalid_type",
      confidence: "high",
      reasoning: "Test",
      response: null,
    };

    const result = ClassificationOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });
});

describe("classifyNode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("feature request classification", () => {
    it("returns feature_request classification and gathering phase", async () => {
      const mockLLM = createMockLLM({
        type: "feature_request",
        confidence: "high",
        reasoning: "User wants to add a new export feature",
        response: null,
      });

      const node = classifyNode({ llm: mockLLM });
      const state = createBaseState({
        messages: [
          new HumanMessage("We need to add PDF export to the dashboard"),
        ],
      });

      const result = await node(state);

      expect(result.classification).toBe("feature_request");
      expect(result.classificationConfidence).toBe("high");
      expect(result.phase).toBe("gathering");
    });
  });

  describe("bug report classification", () => {
    it("returns bug_report classification and gathering phase", async () => {
      const mockLLM = createMockLLM({
        type: "bug_report",
        confidence: "high",
        reasoning: "User is reporting a broken feature",
        response: null,
      });

      const node = classifyNode({ llm: mockLLM });
      const state = createBaseState({
        messages: [new HumanMessage("The login button is broken on mobile")],
      });

      const result = await node(state);

      expect(result.classification).toBe("bug_report");
      expect(result.classificationConfidence).toBe("high");
      expect(result.phase).toBe("gathering");
    });
  });

  describe("question classification", () => {
    it("returns question classification and declined phase with response", async () => {
      const mockLLM = createMockLLM({
        type: "question",
        confidence: "high",
        reasoning: "User is asking for help, not requesting work",
        response: "I help with feature requests. For questions, ask the team.",
      });

      const node = classifyNode({ llm: mockLLM });
      const state = createBaseState({
        messages: [new HumanMessage("How do I reset my password?")],
      });

      const result = await node(state);

      expect(result.classification).toBe("question");
      expect(result.classificationConfidence).toBe("high");
      expect(result.phase).toBe("declined");
    });
  });

  describe("off-topic classification", () => {
    it("returns off_topic classification and declined phase", async () => {
      const mockLLM = createMockLLM({
        type: "off_topic",
        confidence: "high",
        reasoning: "Message is not related to product or development",
        response:
          "I help with features and bugs. For other topics, the team can help!",
      });

      const node = classifyNode({ llm: mockLLM });
      const state = createBaseState({
        messages: [new HumanMessage("When is the team lunch?")],
      });

      const result = await node(state);

      expect(result.classification).toBe("off_topic");
      expect(result.classificationConfidence).toBe("high");
      expect(result.phase).toBe("declined");
    });
  });

  describe("unclear classification", () => {
    it("returns unclear classification and clarifying phase", async () => {
      const mockLLM = createMockLLM({
        type: "unclear",
        confidence: "medium",
        reasoning: "Message is too vague to classify",
        response: "Could you tell me more about what you're looking for?",
      });

      const node = classifyNode({ llm: mockLLM });
      const state = createBaseState({
        messages: [new HumanMessage("Hey")],
      });

      const result = await node(state);

      expect(result.classification).toBe("unclear");
      expect(result.classificationConfidence).toBe("medium");
      expect(result.phase).toBe("clarifying");
    });
  });

  describe("low confidence handling", () => {
    it("routes to clarifying phase when confidence is low", async () => {
      const mockLLM = createMockLLM({
        type: "feature_request",
        confidence: "low",
        reasoning: "Might be a feature request but unclear",
        response: null,
      });

      const node = classifyNode({ llm: mockLLM });
      const state = createBaseState({
        messages: [new HumanMessage("Something about the dashboard")],
      });

      const result = await node(state);

      expect(result.classification).toBe("feature_request");
      expect(result.classificationConfidence).toBe("low");
      expect(result.phase).toBe("clarifying");
    });

    it("routes to clarifying phase for low confidence bug report", async () => {
      const mockLLM = createMockLLM({
        type: "bug_report",
        confidence: "low",
        reasoning: "Could be a bug but needs clarification",
        response: null,
      });

      const node = classifyNode({ llm: mockLLM });
      const state = createBaseState();

      const result = await node(state);

      expect(result.phase).toBe("clarifying");
    });
  });

  describe("error handling", () => {
    it("falls back to gathering phase on LLM API error", async () => {
      const mockLLM = createErrorMockLLM(new Error("API rate limit exceeded"));

      const node = classifyNode({ llm: mockLLM });
      const state = createBaseState();

      const result = await node(state);

      expect(result.phase).toBe("gathering");
      expect(result.classification).toBeNull();
      expect(result.classificationConfidence).toBeNull();
    });

    it("falls back to gathering phase on network error", async () => {
      const mockLLM = createErrorMockLLM(
        new Error("Network connection failed"),
      );

      const node = classifyNode({ llm: mockLLM });
      const state = createBaseState();

      const result = await node(state);

      expect(result.phase).toBe("gathering");
      expect(result.classification).toBeNull();
      expect(result.classificationConfidence).toBeNull();
    });

    it("falls back to gathering phase on timeout", async () => {
      const mockLLM = createErrorMockLLM(new Error("Request timeout"));

      const node = classifyNode({ llm: mockLLM });
      const state = createBaseState();

      const result = await node(state);

      expect(result.phase).toBe("gathering");
      expect(result.classification).toBeNull();
      expect(result.classificationConfidence).toBeNull();
    });
  });

  describe("LLM injection", () => {
    it("uses provided LLM when passed in options", async () => {
      const mockLLM = createMockLLM({
        type: "feature_request",
        confidence: "high",
        reasoning: "Test",
        response: null,
      });

      const node = classifyNode({ llm: mockLLM });
      const state = createBaseState();

      await node(state);

      expect(mockLLM.withStructuredOutput).toHaveBeenCalled();
    });
  });
});
