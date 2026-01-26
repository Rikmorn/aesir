/**
 * Confirm Node Tests
 *
 * Tests for the confirmation node that generates issue drafts for user review.
 */

import type { ChatAnthropic } from "@langchain/anthropic";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ProductAgentPhase,
  type ProductAgentState,
} from "../state.js";
import {
  confirmNode,
  type IssueDraftOutput,
  IssueDraftOutputSchema,
} from "./confirm.js";

// Mock the logger
vi.mock("@aesir/common", () => ({
  createPinoLogger: () => ({
    child: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  }),
}));

/**
 * Create a mock LLM that returns a structured output
 */
function createMockLLM(response: IssueDraftOutput) {
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
    messages: [new HumanMessage("I need a user authentication feature")],
    requirements: {
      what: "Build user authentication with JWT",
      why: "Users need to securely log in to the application",
      who: "End users",
      acceptanceCriteria: ["User can log in", "User can log out"],
      constraints: ["Must use existing database"],
    },
    phase: "gathering" as ProductAgentPhase,
    slackContext: {
      channelId: "C12345678",
      threadTs: "1234567890.123456",
      userId: "U12345678",
    },
    createdTasks: [],
    classification: null,
    classificationConfidence: null,
    issueDraft: null,
    awaitingConfirmation: false,
    ...overrides,
  };
}

describe("IssueDraftOutputSchema", () => {
  it("validates complete draft output", () => {
    const validOutput: IssueDraftOutput = {
      title: "Add user authentication with JWT",
      description:
        "Implement secure user authentication using JWT tokens to allow users to log in and access protected resources.",
      acceptanceCriteria: [
        "User can log in with email and password",
        "User receives a JWT token on successful login",
        "User can log out and invalidate their token",
      ],
      priority: "high",
      labels: ["feature", "backend", "auth"],
    };

    const result = IssueDraftOutputSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
  });

  it("validates output with empty labels", () => {
    const output: IssueDraftOutput = {
      title: "Fix login button",
      description: "The login button is not clickable on mobile devices.",
      acceptanceCriteria: ["Button is clickable on mobile"],
      priority: "medium",
      labels: [],
    };

    const result = IssueDraftOutputSchema.safeParse(output);
    expect(result.success).toBe(true);
  });

  it("rejects invalid priority", () => {
    const invalidOutput = {
      title: "Test",
      description: "Test",
      acceptanceCriteria: [],
      priority: "invalid",
      labels: [],
    };

    const result = IssueDraftOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });

  it("rejects missing title", () => {
    const invalidOutput = {
      description: "Test",
      acceptanceCriteria: [],
      priority: "medium",
      labels: [],
    };

    const result = IssueDraftOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });
});

describe("confirmNode", () => {
  const mockDraftResponse: IssueDraftOutput = {
    title: "Add user authentication with JWT",
    description:
      "Implement secure user authentication using JWT tokens for the application. Users need to be able to log in securely to access protected resources.",
    acceptanceCriteria: [
      "User can log in with email and password",
      "User receives a JWT token on successful login",
      "User can log out and invalidate their token",
    ],
    priority: "high",
    labels: ["feature", "backend"],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("generates valid issue draft from requirements", async () => {
    const mockLLM = createMockLLM(mockDraftResponse);
    const state = createBaseState();

    const node = confirmNode({ llm: mockLLM });
    const result = await node(state);

    expect(result.issueDraft).toBeDefined();
    expect(result.issueDraft?.title).toBe(mockDraftResponse.title);
    expect(result.issueDraft?.description).toBe(mockDraftResponse.description);
    expect(result.issueDraft?.acceptanceCriteria).toEqual(
      mockDraftResponse.acceptanceCriteria,
    );
    expect(result.issueDraft?.priority).toBe(mockDraftResponse.priority);
    expect(result.issueDraft?.labels).toEqual(mockDraftResponse.labels);
  });

  it("includes slackThreadUrl in draft when context available", async () => {
    const mockLLM = createMockLLM(mockDraftResponse);
    const state = createBaseState({
      slackContext: {
        channelId: "C12345678",
        threadTs: "1234567890.123456",
        userId: "U12345678",
      },
    });

    const node = confirmNode({ llm: mockLLM });
    const result = await node(state);

    expect(result.issueDraft?.slackThreadUrl).toBeDefined();
    expect(result.issueDraft?.slackThreadUrl).toContain("C12345678");
  });

  it("sets slackThreadUrl to null when no thread context", async () => {
    const mockLLM = createMockLLM(mockDraftResponse);
    const state = createBaseState({
      slackContext: {
        channelId: "C12345678",
        threadTs: null,
        userId: "U12345678",
      },
    });

    const node = confirmNode({ llm: mockLLM });
    const result = await node(state);

    expect(result.issueDraft?.slackThreadUrl).toBeNull();
  });

  it("sets awaitingConfirmation to true", async () => {
    const mockLLM = createMockLLM(mockDraftResponse);
    const state = createBaseState();

    const node = confirmNode({ llm: mockLLM });
    const result = await node(state);

    expect(result.awaitingConfirmation).toBe(true);
  });

  it("sets phase to confirming", async () => {
    const mockLLM = createMockLLM(mockDraftResponse);
    const state = createBaseState();

    const node = confirmNode({ llm: mockLLM });
    const result = await node(state);

    expect(result.phase).toBe("confirming");
  });

  it("returns AIMessage with formatted preview", async () => {
    const mockLLM = createMockLLM(mockDraftResponse);
    const state = createBaseState();

    const node = confirmNode({ llm: mockLLM });
    const result = await node(state);

    expect(result.messages).toHaveLength(1);
    expect(result.messages?.[0]).toBeInstanceOf(AIMessage);

    const message = result.messages?.[0] as AIMessage;
    const content = message.content as string;

    // Check for key elements in the preview
    expect(content).toContain("I'll create this issue:");
    expect(content).toContain(mockDraftResponse.title);
    expect(content).toContain(mockDraftResponse.description);
    expect(content).toContain("confirm");
  });

  it("includes acceptance criteria as checkboxes in preview", async () => {
    const mockLLM = createMockLLM(mockDraftResponse);
    const state = createBaseState();

    const node = confirmNode({ llm: mockLLM });
    const result = await node(state);

    const message = result.messages?.[0] as AIMessage;
    const content = message.content as string;

    // Check for checkbox format
    expect(content).toContain("- [ ]");
    for (const criterion of mockDraftResponse.acceptanceCriteria) {
      expect(content).toContain(criterion);
    }
  });

  it("includes priority in preview", async () => {
    const mockLLM = createMockLLM(mockDraftResponse);
    const state = createBaseState();

    const node = confirmNode({ llm: mockLLM });
    const result = await node(state);

    const message = result.messages?.[0] as AIMessage;
    const content = message.content as string;

    expect(content).toContain("*Priority:*");
    expect(content).toContain(mockDraftResponse.priority);
  });

  it("includes labels comma-separated in preview", async () => {
    const mockLLM = createMockLLM(mockDraftResponse);
    const state = createBaseState();

    const node = confirmNode({ llm: mockLLM });
    const result = await node(state);

    const message = result.messages?.[0] as AIMessage;
    const content = message.content as string;

    expect(content).toContain("*Labels:*");
    expect(content).toContain("feature, backend");
  });

  it("handles LLM error gracefully by returning gathering phase", async () => {
    const mockLLM = createErrorMockLLM(new Error("LLM API error"));
    const state = createBaseState();

    const node = confirmNode({ llm: mockLLM });
    const result = await node(state);

    expect(result.phase).toBe("gathering");
    expect(result.issueDraft).toBeUndefined();
    expect(result.awaitingConfirmation).toBeUndefined();
  });

  it("handles non-Error exceptions gracefully", async () => {
    const mockLLM = {
      withStructuredOutput: vi.fn().mockReturnValue({
        invoke: vi.fn().mockRejectedValue("string error"),
      }),
    } as unknown as ChatAnthropic;
    const state = createBaseState();

    const node = confirmNode({ llm: mockLLM });
    const result = await node(state);

    expect(result.phase).toBe("gathering");
  });

  it("passes requirements to LLM context", async () => {
    const mockInvoke = vi.fn().mockResolvedValue(mockDraftResponse);
    const mockLLM = {
      withStructuredOutput: vi.fn().mockReturnValue({
        invoke: mockInvoke,
      }),
    } as unknown as ChatAnthropic;

    const state = createBaseState({
      requirements: {
        what: "Build a search feature",
        why: "Users need to find content quickly",
        who: "All users",
        acceptanceCriteria: ["Search returns results", "Results are paginated"],
        constraints: ["Must be fast"],
      },
    });

    const node = confirmNode({ llm: mockLLM });
    await node(state);

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    const invokeArgs = mockInvoke.mock.calls[0]?.[0];

    // The last message should be the requirements context
    const lastMessage = invokeArgs[invokeArgs.length - 1];
    expect(lastMessage.content).toContain("Build a search feature");
    expect(lastMessage.content).toContain("Users need to find content quickly");
    expect(lastMessage.content).toContain("Search returns results");
  });

  it("uses withStructuredOutput with correct schema", async () => {
    const mockWithStructured = vi.fn().mockReturnValue({
      invoke: vi.fn().mockResolvedValue(mockDraftResponse),
    });
    const mockLLM = {
      withStructuredOutput: mockWithStructured,
    } as unknown as ChatAnthropic;

    const state = createBaseState();

    const node = confirmNode({ llm: mockLLM });
    await node(state);

    expect(mockWithStructured).toHaveBeenCalledWith(IssueDraftOutputSchema);
  });

  it("works with minimal requirements", async () => {
    const mockLLM = createMockLLM(mockDraftResponse);
    const state = createBaseState({
      requirements: {
        what: "Add button",
        why: "Need it",
        who: null,
        acceptanceCriteria: [],
        constraints: [],
      },
    });

    const node = confirmNode({ llm: mockLLM });
    const result = await node(state);

    expect(result.issueDraft).toBeDefined();
    expect(result.phase).toBe("confirming");
    expect(result.awaitingConfirmation).toBe(true);
  });

  it("omits labels line when no labels", async () => {
    const noLabelsResponse: IssueDraftOutput = {
      ...mockDraftResponse,
      labels: [],
    };
    const mockLLM = createMockLLM(noLabelsResponse);
    const state = createBaseState();

    const node = confirmNode({ llm: mockLLM });
    const result = await node(state);

    const message = result.messages?.[0] as AIMessage;
    const content = message.content as string;

    // Should not contain labels line when empty
    expect(content).not.toContain("*Labels:*");
  });
});

describe("confirmNode preview message format", () => {
  const mockDraftResponse: IssueDraftOutput = {
    title: "Test Issue",
    description: "Test description",
    acceptanceCriteria: ["Criterion 1", "Criterion 2"],
    priority: "medium",
    labels: ["feature"],
  };

  it("is Slack-markdown compatible", async () => {
    const mockLLM = createMockLLM(mockDraftResponse);
    const state = createBaseState();

    const node = confirmNode({ llm: mockLLM });
    const result = await node(state);

    const message = result.messages?.[0] as AIMessage;
    const content = message.content as string;

    // Slack bold format uses *text*
    expect(content).toMatch(/\*Title:\*/);
    expect(content).toMatch(/\*Description:\*/);
    expect(content).toMatch(/\*Acceptance Criteria:\*/);
    expect(content).toMatch(/\*Priority:\*/);
  });

  it("includes confirmation instruction", async () => {
    const mockLLM = createMockLLM(mockDraftResponse);
    const state = createBaseState();

    const node = confirmNode({ llm: mockLLM });
    const result = await node(state);

    const message = result.messages?.[0] as AIMessage;
    const content = message.content as string;

    expect(content).toContain('Reply "confirm" to create');
    expect(content).toContain("feedback to revise");
  });
});
