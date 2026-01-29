/**
 * Notify Node Tests
 *
 * Tests for the notify node that sends Slack notifications with issue links.
 */

import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductAgentPhase, ProductAgentState } from "../state.js";
import { notifyNode } from "./notify.js";

// Mock @aesir/platform for logger and correlation ID
vi.mock("@aesir/platform", async () => {
  const actual = (await vi.importActual("@aesir/platform")) as object;
  return {
    ...actual,
    createPinoLogger: () => ({
      child: () => ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      }),
    }),
    generateCorrelationId: () => "test-correlation-id",
  };
});

// Mock the MCP client
vi.mock("../../shared/mcp/index.js", () => ({
  callMcpTool: vi.fn(),
}));

// Import the mocked module for assertions
import { callMcpTool } from "../../shared/mcp/index.js";

const mockCallMcpTool = vi.mocked(callMcpTool);

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
    phase: "complete" as ProductAgentPhase,
    slackContext: {
      channelId: "C12345678",
      threadTs: "1234567890.123456",
      userId: "U12345678",
    },
    createdTasks: [
      {
        id: "issue-123",
        identifier: "ABC-123",
        title: "Implement JWT authentication",
      },
    ],
    classification: null,
    classificationConfidence: null,
    issueDraft: null,
    awaitingConfirmation: false,
    ...overrides,
  };
}

describe("notifyNode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default MCP mock behavior - successful reply
    mockCallMcpTool.mockResolvedValue(undefined);
  });

  describe("single issue notification", () => {
    it("includes identifier and URL in notification message", async () => {
      const state = createBaseState();

      const node = notifyNode();
      const result = await node(state);

      // Check message content
      expect(result.messages).toHaveLength(1);
      const message = result.messages?.[0] as AIMessage;
      expect(message).toBeInstanceOf(AIMessage);

      const content = message.content as string;
      expect(content).toContain("ABC-123");
      expect(content).toContain("Implement JWT authentication");
      expect(content).toContain("https://linear.app/issue/ABC-123");
    });

    it("sends correct message to Slack via MCP", async () => {
      const state = createBaseState();

      const node = notifyNode();
      await node(state);

      expect(mockCallMcpTool).toHaveBeenCalledWith({
        integration: "slack",
        tool: "reply_to_thread",
        params: {
          channel: "C12345678",
          thread_ts: "1234567890.123456",
          text: expect.stringContaining("ABC-123"),
        },
        agentId: "product-agent",
        correlationId: "test-correlation-id",
      });
    });

    it("uses Slack markdown formatting with asterisks for bold", async () => {
      const state = createBaseState();

      const node = notifyNode();
      const result = await node(state);

      const message = result.messages?.[0] as AIMessage;
      const content = message.content as string;
      // Slack uses *text* for bold, not **text**
      expect(content).toContain("*ABC-123*");
    });
  });

  describe("multiple issues notification", () => {
    it("lists all issues in notification", async () => {
      const state = createBaseState({
        createdTasks: [
          {
            id: "issue-1",
            identifier: "ABC-101",
            title: "Set up database schema",
          },
          {
            id: "issue-2",
            identifier: "ABC-102",
            title: "Implement API endpoints",
          },
          {
            id: "issue-3",
            identifier: "ABC-103",
            title: "Add frontend components",
          },
        ],
      });

      const node = notifyNode();
      const result = await node(state);

      const message = result.messages?.[0] as AIMessage;
      const content = message.content as string;

      // Should mention all 3 issues
      expect(content).toContain("3 issues");
      expect(content).toContain("ABC-101");
      expect(content).toContain("ABC-102");
      expect(content).toContain("ABC-103");
      expect(content).toContain("Set up database schema");
      expect(content).toContain("Implement API endpoints");
      expect(content).toContain("Add frontend components");
    });

    it("includes URLs for all issues", async () => {
      const state = createBaseState({
        createdTasks: [
          {
            id: "issue-1",
            identifier: "ABC-101",
            title: "Task 1",
          },
          {
            id: "issue-2",
            identifier: "ABC-102",
            title: "Task 2",
          },
        ],
      });

      const node = notifyNode();
      const result = await node(state);

      const message = result.messages?.[0] as AIMessage;
      const content = message.content as string;

      expect(content).toContain("https://linear.app/issue/ABC-101");
      expect(content).toContain("https://linear.app/issue/ABC-102");
    });

    it("uses markdown list format", async () => {
      const state = createBaseState({
        createdTasks: [
          {
            id: "issue-1",
            identifier: "ABC-101",
            title: "Task 1",
          },
          {
            id: "issue-2",
            identifier: "ABC-102",
            title: "Task 2",
          },
        ],
      });

      const node = notifyNode();
      const result = await node(state);

      const message = result.messages?.[0] as AIMessage;
      const content = message.content as string;

      // Should use list format with dashes
      expect(content).toContain("- *ABC-101*");
      expect(content).toContain("- *ABC-102*");
    });
  });

  describe("no issues notification", () => {
    it("explains failure when no issues created", async () => {
      const state = createBaseState({
        createdTasks: [],
      });

      const node = notifyNode();
      const result = await node(state);

      const message = result.messages?.[0] as AIMessage;
      const content = message.content as string;

      expect(content).toContain("wasn't able to create an issue");
      expect(content).toContain("try again");
    });

    it("still sends Slack notification for failure case", async () => {
      const state = createBaseState({
        createdTasks: [],
      });

      const node = notifyNode();
      await node(state);

      // Should still call MCP to notify user
      expect(mockCallMcpTool).toHaveBeenCalledWith(
        expect.objectContaining({
          integration: "slack",
          tool: "reply_to_thread",
        }),
      );
    });
  });

  describe("Slack context handling", () => {
    it("sends notification when Slack context is present", async () => {
      const state = createBaseState();

      const node = notifyNode();
      await node(state);

      expect(mockCallMcpTool).toHaveBeenCalledTimes(1);
      expect(mockCallMcpTool).toHaveBeenCalledWith(
        expect.objectContaining({
          integration: "slack",
          tool: "reply_to_thread",
          params: expect.objectContaining({
            channel: "C12345678",
            thread_ts: "1234567890.123456",
          }),
        }),
      );
    });

    it("does not call MCP when slackContext is null", async () => {
      const state = createBaseState({
        slackContext: null,
      });

      const node = notifyNode();
      const result = await node(state);

      // Should not call MCP
      expect(mockCallMcpTool).not.toHaveBeenCalled();

      // Should still add AI message for conversation record
      expect(result.messages).toHaveLength(1);
      const message = result.messages?.[0] as AIMessage;
      expect(message).toBeInstanceOf(AIMessage);
    });

    it("does not call MCP when channelId is missing", async () => {
      const state = createBaseState({
        slackContext: {
          channelId: "",
          threadTs: "1234567890.123456",
          userId: "U12345678",
        },
      });

      const node = notifyNode();
      await node(state);

      expect(mockCallMcpTool).not.toHaveBeenCalled();
    });

    it("does not call MCP when threadTs is null", async () => {
      const state = createBaseState({
        slackContext: {
          channelId: "C12345678",
          threadTs: null,
          userId: "U12345678",
        },
      });

      const node = notifyNode();
      await node(state);

      expect(mockCallMcpTool).not.toHaveBeenCalled();
    });
  });

  describe("MCP error handling", () => {
    it("does not fail the node when MCP errors", async () => {
      mockCallMcpTool.mockRejectedValue(new Error("Slack API error"));

      const state = createBaseState();

      const node = notifyNode();
      // Should not throw
      const result = await node(state);

      // Should still return valid state update
      expect(result.messages).toHaveLength(1);
    });

    it("still returns AI message when MCP fails", async () => {
      mockCallMcpTool.mockRejectedValue(new Error("Network error"));

      const state = createBaseState();

      const node = notifyNode();
      const result = await node(state);

      const message = result.messages?.[0] as AIMessage;
      expect(message).toBeInstanceOf(AIMessage);
      expect(message.content).toContain("ABC-123");
    });

    it("handles timeout errors gracefully", async () => {
      mockCallMcpTool.mockRejectedValue(new Error("Request timed out"));

      const state = createBaseState();

      const node = notifyNode();
      const result = await node(state);

      // Node should complete successfully despite error
      expect(result.messages).toHaveLength(1);
    });
  });

  describe("Linear URL format", () => {
    it("uses correct Linear app URL format", async () => {
      const state = createBaseState({
        createdTasks: [
          {
            id: "issue-123",
            identifier: "PROJ-456",
            title: "Test issue",
          },
        ],
      });

      const node = notifyNode();
      const result = await node(state);

      const message = result.messages?.[0] as AIMessage;
      const content = message.content as string;

      expect(content).toContain("https://linear.app/issue/PROJ-456");
    });
  });
});
