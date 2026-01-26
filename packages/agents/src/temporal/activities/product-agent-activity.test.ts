/**
 * Product Agent Activity Tests
 *
 * Tests for runProductAgentActivity which wraps LangGraph invocation
 * with PostgreSQL checkpointer for conversation persistence.
 */

import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runProductAgentActivity } from "./product-agent-activity.js";

// Mock the product-agent graph
vi.mock("../../product-agent/index.js", () => ({
  createProductAgentGraph: vi.fn(() => ({
    invoke: vi.fn(),
  })),
  getProductAgentCheckpointer: vi.fn(() => ({
    get: vi.fn(),
    put: vi.fn(),
  })),
}));

// Mock the logger
vi.mock("@aesir/common", async (importOriginal) => {
  const original = await importOriginal<typeof import("@aesir/common")>();
  return {
    ...original,
    createPinoLogger: () => ({
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      child: vi.fn(() => ({
        info: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
      })),
    }),
  };
});

describe("runProductAgentActivity", () => {
  let mockInvoke: ReturnType<typeof vi.fn>;
  let mockGetCheckpointer: ReturnType<typeof vi.fn>;
  let mockCreateGraph: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Get mocks from the module
    const productAgentModule = await import("../../product-agent/index.js");
    mockGetCheckpointer = vi.mocked(
      productAgentModule.getProductAgentCheckpointer,
    );
    mockCreateGraph = vi.mocked(productAgentModule.createProductAgentGraph);

    // Set up default mock behavior
    mockInvoke = vi.fn();
    mockCreateGraph.mockReturnValue({ invoke: mockInvoke });
  });

  it("invokes graph with HumanMessage from input", async () => {
    mockInvoke.mockResolvedValue({
      messages: [new AIMessage("Response")],
      phase: "gathering",
      createdTasks: [],
    });

    await runProductAgentActivity({
      threadTs: "1234567890.123456",
      message: "I want to build a feature",
      teamId: "team-123",
    });

    expect(mockInvoke).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([expect.any(HumanMessage)]),
      }),
      expect.anything(),
    );

    // Verify the message content
    const [invokeInput] = mockInvoke.mock.calls[0] as [
      { messages: HumanMessage[] },
    ];
    const firstMessage = invokeInput.messages[0];
    expect(firstMessage).toBeDefined();
    expect(firstMessage?.content).toBe("I want to build a feature");
  });

  it("passes thread_ts as configurable.thread_id", async () => {
    mockInvoke.mockResolvedValue({
      messages: [new AIMessage("Response")],
      phase: "gathering",
      createdTasks: [],
    });

    await runProductAgentActivity({
      threadTs: "1234567890.123456",
      message: "test message",
      teamId: "team-123",
    });

    expect(mockInvoke).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        configurable: {
          thread_id: "1234567890.123456",
        },
      }),
    );
  });

  it("passes checkpointer to createProductAgentGraph", async () => {
    const mockCheckpointer = { get: vi.fn(), put: vi.fn() };
    mockGetCheckpointer.mockReturnValue(mockCheckpointer);

    mockInvoke.mockResolvedValue({
      messages: [new AIMessage("Response")],
      phase: "gathering",
      createdTasks: [],
    });

    await runProductAgentActivity({
      threadTs: "1234567890.123456",
      message: "test message",
      teamId: "team-123",
    });

    expect(mockCreateGraph).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: "team-123",
        checkpointer: mockCheckpointer,
      }),
    );
  });

  it("extracts response from last AI message", async () => {
    mockInvoke.mockResolvedValue({
      messages: [
        new HumanMessage("User input"),
        new AIMessage("First response"),
        new AIMessage("Final response"),
      ],
      phase: "clarifying",
      createdTasks: [],
    });

    const result = await runProductAgentActivity({
      threadTs: "1234567890.123456",
      message: "test message",
      teamId: "team-123",
    });

    expect(result.response).toBe("Final response");
  });

  it("returns phase from graph result", async () => {
    mockInvoke.mockResolvedValue({
      messages: [new AIMessage("Response")],
      phase: "complete",
      createdTasks: [],
    });

    const result = await runProductAgentActivity({
      threadTs: "1234567890.123456",
      message: "test message",
      teamId: "team-123",
    });

    expect(result.phase).toBe("complete");
  });

  it("returns issueId if createdTasks has items", async () => {
    mockInvoke.mockResolvedValue({
      messages: [new AIMessage("Issue created!")],
      phase: "complete",
      createdTasks: [
        { id: "issue-uuid-123", identifier: "ABC-123", title: "Test Issue" },
      ],
    });

    const result = await runProductAgentActivity({
      threadTs: "1234567890.123456",
      message: "test message",
      teamId: "team-123",
    });

    expect(result.issueId).toBe("issue-uuid-123");
    expect(result.issueIdentifier).toBe("ABC-123");
  });

  it("handles empty createdTasks", async () => {
    mockInvoke.mockResolvedValue({
      messages: [new AIMessage("Still gathering")],
      phase: "gathering",
      createdTasks: [],
    });

    const result = await runProductAgentActivity({
      threadTs: "1234567890.123456",
      message: "test message",
      teamId: "team-123",
    });

    expect(result.issueId).toBeUndefined();
    expect(result.issueIdentifier).toBeUndefined();
  });

  it("handles string message content", async () => {
    mockInvoke.mockResolvedValue({
      messages: [new AIMessage("Simple string response")],
      phase: "gathering",
      createdTasks: [],
    });

    const result = await runProductAgentActivity({
      threadTs: "1234567890.123456",
      message: "test message",
      teamId: "team-123",
    });

    expect(result.response).toBe("Simple string response");
  });

  it("handles array message content (multimodal)", async () => {
    // AIMessage with array content (multimodal format)
    const multimodalMessage = new AIMessage({
      content: [
        { type: "text", text: "Part 1" },
        { type: "text", text: "Part 2" },
      ],
    });

    mockInvoke.mockResolvedValue({
      messages: [multimodalMessage],
      phase: "gathering",
      createdTasks: [],
    });

    const result = await runProductAgentActivity({
      threadTs: "1234567890.123456",
      message: "test message",
      teamId: "team-123",
    });

    // Should join text parts
    expect(result.response).toBe("Part 1\nPart 2");
  });

  it("handles empty messages array", async () => {
    mockInvoke.mockResolvedValue({
      messages: [],
      phase: "gathering",
      createdTasks: [],
    });

    const result = await runProductAgentActivity({
      threadTs: "1234567890.123456",
      message: "test message",
      teamId: "team-123",
    });

    expect(result.response).toBe("");
  });
});
