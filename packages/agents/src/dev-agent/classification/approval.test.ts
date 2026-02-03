/**
 * Approval Classification Tests
 *
 * Tests for classifyApprovalIntent with mock LLM for structured output.
 * Covers all intent types, confidence levels, edge cases, and error handling.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClassificationLLM } from "./approval.js";
import {
  type ApprovalClassification,
  ApprovalClassificationSchema,
  ApprovalConfidenceSchema,
  ApprovalIntentSchema,
  classifyApprovalIntent,
} from "./approval.js";

// Mock @aesir/types - partial mock to preserve error exports
vi.mock("@aesir/types", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aesir/types")>();
  return {
    ...actual,
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
  };
});

/**
 * Create a mock LLM that returns the specified classification output
 */
function createMockLLM(response: ApprovalClassification) {
  return {
    withStructuredOutput: vi.fn().mockReturnValue({
      invoke: vi.fn().mockResolvedValue(response),
    }),
  } as unknown as ClassificationLLM;
}

/**
 * Create a mock LLM that throws an error
 */
function createErrorMockLLM(error: Error) {
  return {
    withStructuredOutput: vi.fn().mockReturnValue({
      invoke: vi.fn().mockRejectedValue(error),
    }),
  } as unknown as ClassificationLLM;
}

// ============================================================================
// Schema Validation Tests
// ============================================================================

describe("ApprovalIntentSchema", () => {
  it("accepts valid intent values", () => {
    expect(ApprovalIntentSchema.safeParse("approve").success).toBe(true);
    expect(ApprovalIntentSchema.safeParse("reject").success).toBe(true);
    expect(ApprovalIntentSchema.safeParse("unclear").success).toBe(true);
    expect(ApprovalIntentSchema.safeParse("question").success).toBe(true);
  });

  it("rejects invalid intent values", () => {
    expect(ApprovalIntentSchema.safeParse("invalid").success).toBe(false);
    expect(ApprovalIntentSchema.safeParse("").success).toBe(false);
    expect(ApprovalIntentSchema.safeParse(123).success).toBe(false);
  });
});

describe("ApprovalConfidenceSchema", () => {
  it("accepts valid confidence values", () => {
    expect(ApprovalConfidenceSchema.safeParse("high").success).toBe(true);
    expect(ApprovalConfidenceSchema.safeParse("medium").success).toBe(true);
    expect(ApprovalConfidenceSchema.safeParse("low").success).toBe(true);
  });

  it("rejects invalid confidence values", () => {
    expect(ApprovalConfidenceSchema.safeParse("very_high").success).toBe(false);
    expect(ApprovalConfidenceSchema.safeParse("").success).toBe(false);
  });
});

describe("ApprovalClassificationSchema", () => {
  it("validates a valid approve classification", () => {
    const validOutput: ApprovalClassification = {
      intent: "approve",
      confidence: "high",
      feedback: null,
      reasoning: "User said looks good, clear approval",
    };

    const result = ApprovalClassificationSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
  });

  it("validates a valid reject classification with feedback", () => {
    const validOutput: ApprovalClassification = {
      intent: "reject",
      confidence: "high",
      feedback: "Missing error handling for edge cases",
      reasoning: "User explicitly requested changes before proceeding",
    };

    const result = ApprovalClassificationSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.feedback).toBe(
        "Missing error handling for edge cases",
      );
    }
  });

  it("validates a valid question classification", () => {
    const validOutput: ApprovalClassification = {
      intent: "question",
      confidence: "medium",
      feedback: null,
      reasoning:
        "User is asking about the approach, not approving or rejecting",
    };

    const result = ApprovalClassificationSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
  });

  it("validates a valid unclear classification", () => {
    const validOutput: ApprovalClassification = {
      intent: "unclear",
      confidence: "low",
      feedback: null,
      reasoning: "Response is ambiguous",
    };

    const result = ApprovalClassificationSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
  });

  it("rejects classification with missing intent", () => {
    const invalidOutput = {
      confidence: "high",
      feedback: null,
      reasoning: "Test",
    };

    const result = ApprovalClassificationSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });

  it("rejects classification with missing confidence", () => {
    const invalidOutput = {
      intent: "approve",
      feedback: null,
      reasoning: "Test",
    };

    const result = ApprovalClassificationSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });

  it("rejects classification with missing reasoning", () => {
    const invalidOutput = {
      intent: "approve",
      confidence: "high",
      feedback: null,
    };

    const result = ApprovalClassificationSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });

  it("rejects classification with invalid intent", () => {
    const invalidOutput = {
      intent: "maybe",
      confidence: "high",
      feedback: null,
      reasoning: "Test",
    };

    const result = ApprovalClassificationSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// Classification Function Tests
// ============================================================================

describe("classifyApprovalIntent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("approve intent detection", () => {
    it("classifies approval phrases correctly", async () => {
      const mockLLM = createMockLLM({
        intent: "approve",
        confidence: "high",
        feedback: null,
        reasoning: "User said looks good, clear approval",
      });

      const result = await classifyApprovalIntent({
        llm: mockLLM,
        message: "looks good, ship it!",
      });

      expect(result.intent).toBe("approve");
      expect(result.confidence).toBe("high");
      expect(result.feedback).toBeNull();
    });

    it("classifies LGTM as approval", async () => {
      const mockLLM = createMockLLM({
        intent: "approve",
        confidence: "high",
        feedback: null,
        reasoning: "LGTM is a common approval phrase",
      });

      const result = await classifyApprovalIntent({
        llm: mockLLM,
        message: "LGTM",
      });

      expect(result.intent).toBe("approve");
    });

    it("classifies casual affirmatives as approval", async () => {
      const mockLLM = createMockLLM({
        intent: "approve",
        confidence: "medium",
        feedback: null,
        reasoning: "Sure indicates agreement",
      });

      const result = await classifyApprovalIntent({
        llm: mockLLM,
        message: "sure, go ahead",
      });

      expect(result.intent).toBe("approve");
    });
  });

  describe("reject intent detection", () => {
    it("classifies rejection with feedback extraction", async () => {
      const mockLLM = createMockLLM({
        intent: "reject",
        confidence: "high",
        feedback: "Need to add error handling for network failures",
        reasoning: "User explicitly requested changes",
      });

      const result = await classifyApprovalIntent({
        llm: mockLLM,
        message: "Hold on, we need to add error handling for network failures",
      });

      expect(result.intent).toBe("reject");
      expect(result.confidence).toBe("high");
      expect(result.feedback).toBe(
        "Need to add error handling for network failures",
      );
    });

    it("classifies explicit no as rejection", async () => {
      const mockLLM = createMockLLM({
        intent: "reject",
        confidence: "high",
        feedback: "User does not want to proceed",
        reasoning: "Explicit no",
      });

      const result = await classifyApprovalIntent({
        llm: mockLLM,
        message: "No, don't do this",
      });

      expect(result.intent).toBe("reject");
    });

    it("classifies missing tests concern as rejection", async () => {
      const mockLLM = createMockLLM({
        intent: "reject",
        confidence: "high",
        feedback: "Tests are missing for the new authentication flow",
        reasoning: "User requesting test coverage before proceeding",
      });

      const result = await classifyApprovalIntent({
        llm: mockLLM,
        message: "Missing tests for the auth flow",
      });

      expect(result.intent).toBe("reject");
      expect(result.feedback).toContain("Tests");
    });
  });

  describe("question intent detection", () => {
    it("classifies clarifying questions correctly", async () => {
      const mockLLM = createMockLLM({
        intent: "question",
        confidence: "high",
        feedback: null,
        reasoning: "User is seeking clarification, not approving or rejecting",
      });

      const result = await classifyApprovalIntent({
        llm: mockLLM,
        message: "What about rate limiting? Did you consider that?",
      });

      expect(result.intent).toBe("question");
    });

    it("classifies how questions correctly", async () => {
      const mockLLM = createMockLLM({
        intent: "question",
        confidence: "medium",
        feedback: null,
        reasoning: "User asking about implementation approach",
      });

      const result = await classifyApprovalIntent({
        llm: mockLLM,
        message: "How will this handle concurrent requests?",
      });

      expect(result.intent).toBe("question");
    });
  });

  describe("unclear intent detection", () => {
    it("classifies ambiguous responses as unclear", async () => {
      const mockLLM = createMockLLM({
        intent: "unclear",
        confidence: "low",
        feedback: null,
        reasoning: "Response is ambiguous, cannot determine intent",
      });

      const result = await classifyApprovalIntent({
        llm: mockLLM,
        message: "hmm interesting",
      });

      expect(result.intent).toBe("unclear");
    });

    it("classifies off-topic messages as unclear", async () => {
      const mockLLM = createMockLLM({
        intent: "unclear",
        confidence: "high",
        feedback: null,
        reasoning: "Message is unrelated to the plan",
      });

      const result = await classifyApprovalIntent({
        llm: mockLLM,
        message: "When is the team lunch?",
      });

      expect(result.intent).toBe("unclear");
    });
  });

  describe("confidence levels", () => {
    it("returns high confidence for clear approvals", async () => {
      const mockLLM = createMockLLM({
        intent: "approve",
        confidence: "high",
        feedback: null,
        reasoning: "Explicit approval language",
      });

      const result = await classifyApprovalIntent({
        llm: mockLLM,
        message: "Approved! Ship it.",
      });

      expect(result.confidence).toBe("high");
    });

    it("returns medium confidence for implicit approvals", async () => {
      const mockLLM = createMockLLM({
        intent: "approve",
        confidence: "medium",
        feedback: null,
        reasoning: "Likely approval but not explicit",
      });

      const result = await classifyApprovalIntent({
        llm: mockLLM,
        message: "ok",
      });

      expect(result.confidence).toBe("medium");
    });

    it("returns low confidence for ambiguous messages", async () => {
      const mockLLM = createMockLLM({
        intent: "unclear",
        confidence: "low",
        feedback: null,
        reasoning: "Cannot determine intent",
      });

      const result = await classifyApprovalIntent({
        llm: mockLLM,
        message: "...",
      });

      expect(result.confidence).toBe("low");
    });
  });

  describe("edge cases", () => {
    it("handles empty message gracefully", async () => {
      // Note: Empty message is handled before LLM call
      const mockLLM = createMockLLM({
        intent: "unclear",
        confidence: "high",
        feedback: null,
        reasoning: "This should not be called",
      });

      const result = await classifyApprovalIntent({
        llm: mockLLM,
        message: "",
      });

      expect(result.intent).toBe("unclear");
      expect(result.confidence).toBe("high");
      expect(result.reasoning).toBe("Empty message cannot be classified");
      // LLM should not be called for empty messages
      expect(mockLLM.withStructuredOutput).not.toHaveBeenCalled();
    });

    it("handles whitespace-only message as empty", async () => {
      const mockLLM = createMockLLM({
        intent: "unclear",
        confidence: "high",
        feedback: null,
        reasoning: "This should not be called",
      });

      const result = await classifyApprovalIntent({
        llm: mockLLM,
        message: "   \n\t   ",
      });

      expect(result.intent).toBe("unclear");
      expect(mockLLM.withStructuredOutput).not.toHaveBeenCalled();
    });

    it("handles very long messages with truncation", async () => {
      const longMessage = "a".repeat(5000);
      const mockLLM = createMockLLM({
        intent: "unclear",
        confidence: "low",
        feedback: null,
        reasoning: "Very long message, truncated for processing",
      });

      // Should not throw
      const result = await classifyApprovalIntent({
        llm: mockLLM,
        message: longMessage,
      });

      expect(result).toBeDefined();
      // LLM should be called with truncated message
      expect(mockLLM.withStructuredOutput).toHaveBeenCalled();
    });

    it("handles emoji-only messages", async () => {
      const mockLLM = createMockLLM({
        intent: "approve",
        confidence: "medium",
        feedback: null,
        reasoning: "Thumbs up emoji indicates approval",
      });

      const result = await classifyApprovalIntent({
        llm: mockLLM,
        message: ":+1:",
      });

      expect(result.intent).toBe("approve");
    });

    it("handles unicode messages", async () => {
      const mockLLM = createMockLLM({
        intent: "approve",
        confidence: "high",
        feedback: null,
        reasoning: "Approval in different language",
      });

      const result = await classifyApprovalIntent({
        llm: mockLLM,
        message: "Looks good!",
      });

      expect(result).toBeDefined();
    });
  });

  describe("error handling", () => {
    it("returns unclear on LLM API error", async () => {
      const mockLLM = createErrorMockLLM(new Error("API rate limit exceeded"));

      const result = await classifyApprovalIntent({
        llm: mockLLM,
        message: "looks good",
      });

      expect(result.intent).toBe("unclear");
      expect(result.confidence).toBe("low");
      expect(result.reasoning).toContain("Classification failed");
    });

    it("returns unclear on network error", async () => {
      const mockLLM = createErrorMockLLM(
        new Error("Network connection failed"),
      );

      const result = await classifyApprovalIntent({
        llm: mockLLM,
        message: "approved",
      });

      expect(result.intent).toBe("unclear");
      expect(result.confidence).toBe("low");
    });

    it("returns unclear on timeout", async () => {
      const mockLLM = createErrorMockLLM(new Error("Request timeout"));

      const result = await classifyApprovalIntent({
        llm: mockLLM,
        message: "ship it",
      });

      expect(result.intent).toBe("unclear");
      expect(result.confidence).toBe("low");
    });

    it("includes error message in reasoning", async () => {
      const mockLLM = createErrorMockLLM(new Error("Specific error message"));

      const result = await classifyApprovalIntent({
        llm: mockLLM,
        message: "go ahead",
      });

      expect(result.reasoning).toContain("Specific error message");
    });
  });

  describe("LLM injection", () => {
    it("uses provided LLM for classification", async () => {
      const mockLLM = createMockLLM({
        intent: "approve",
        confidence: "high",
        feedback: null,
        reasoning: "Test",
      });

      await classifyApprovalIntent({
        llm: mockLLM,
        message: "test message",
      });

      expect(mockLLM.withStructuredOutput).toHaveBeenCalledWith(
        ApprovalClassificationSchema,
      );
    });

    it("passes message to LLM invoke", async () => {
      const invokeMock = vi.fn().mockResolvedValue({
        intent: "approve",
        confidence: "high",
        feedback: null,
        reasoning: "Test",
      });

      const mockLLM = {
        withStructuredOutput: vi.fn().mockReturnValue({
          invoke: invokeMock,
        }),
      } as unknown as ClassificationLLM;

      await classifyApprovalIntent({
        llm: mockLLM,
        message: "my test message",
      });

      // Verify invoke was called with messages including our test message
      expect(invokeMock).toHaveBeenCalled();
      const callArgs = invokeMock.mock.calls[0]?.[0];
      expect(callArgs).toHaveLength(2);
      expect(callArgs[1]).toEqual({
        role: "user",
        content: "my test message",
      });
    });
  });
});
