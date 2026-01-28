/**
 * Create Tasks Node Tests
 *
 * Tests for the create tasks node that generates Linear issues from requirements.
 */

import type { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage } from "@langchain/core/messages";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductAgentPhase, ProductAgentState } from "../state.js";
import {
  createTasksNode,
  type GeneratedTask,
  type TaskList,
  TaskListSchema,
} from "./create-tasks.js";

// Mock the logger
vi.mock("@aesir/types", () => ({
  createPinoLogger: () => ({
    child: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  }),
  generateCorrelationId: () => "test-correlation-id",
}));

// Mock the MCP client
vi.mock("../../mcp/index.js", () => ({
  callMcpTool: vi.fn(),
}));

// Import the mocked module for assertions
import { callMcpTool } from "../../mcp/index.js";

const mockCallMcpTool = vi.mocked(callMcpTool);

/**
 * Create a mock LLM that returns a structured output
 */
function createMockLLM(response: TaskList) {
  return {
    withStructuredOutput: vi.fn().mockReturnValue({
      invoke: vi.fn().mockResolvedValue(response),
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
    phase: "creating" as ProductAgentPhase,
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

/**
 * Create a mock task list response
 */
function createMockTaskList(tasks?: GeneratedTask[]): TaskList {
  return {
    tasks: tasks ?? [
      {
        title: "Implement JWT authentication",
        description: "Set up JWT token generation and validation",
        priority: "high",
        labels: ["feature", "backend"],
      },
    ],
    projectContext: "User authentication system for the application",
  };
}

describe("TaskListSchema", () => {
  it("validates complete task list", () => {
    const validTaskList = createMockTaskList();
    const result = TaskListSchema.safeParse(validTaskList);
    expect(result.success).toBe(true);
  });

  it("validates task list with multiple tasks", () => {
    const taskList = createMockTaskList([
      {
        title: "Task 1",
        description: "Description 1",
        priority: "high",
        labels: ["feature"],
      },
      {
        title: "Task 2",
        description: "Description 2",
        priority: "medium",
        labels: ["bug"],
      },
    ]);
    const result = TaskListSchema.safeParse(taskList);
    expect(result.success).toBe(true);
  });
});

describe("createTasksNode", () => {
  const teamId = "test-team-id";

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset MCP mock to default behavior
    mockCallMcpTool.mockImplementation(async ({ tool }) => {
      if (tool === "list_labels") {
        return [
          { id: "label-1", name: "feature" },
          { id: "label-2", name: "backend" },
          { id: "label-3", name: "agent-ready" },
        ];
      }
      if (tool === "create_issue") {
        return {
          id: "issue-123",
          identifier: "ABC-123",
          title: "Test issue",
        };
      }
      return null;
    });
  });

  it("always adds agent-ready label to task labels", async () => {
    const taskList = createMockTaskList([
      {
        title: "Test task",
        description: "Test description",
        priority: "medium",
        labels: ["feature"], // Only feature label
      },
    ]);
    const mockLLM = createMockLLM(taskList);
    const state = createBaseState();

    const node = createTasksNode({ teamId, llm: mockLLM });
    await node(state);

    // Check that list_labels was called with the agent-ready label included
    const listLabelsCall = mockCallMcpTool.mock.calls.find(
      (call) => call[0].tool === "list_labels",
    );
    expect(listLabelsCall).toBeDefined();

    // Check that create_issue was called with labelIds that include agent-ready
    const createIssueCall = mockCallMcpTool.mock.calls.find(
      (call) => call[0].tool === "create_issue",
    );
    expect(createIssueCall).toBeDefined();

    const createIssueParams = createIssueCall?.[0].params;
    // Should have both feature (label-1) and agent-ready (label-3)
    expect(createIssueParams?.labelIds).toContain("label-1"); // feature
    expect(createIssueParams?.labelIds).toContain("label-3"); // agent-ready
  });

  it("includes Slack link in description when slackContext present", async () => {
    const taskList = createMockTaskList();
    const mockLLM = createMockLLM(taskList);
    const state = createBaseState({
      slackContext: {
        channelId: "C12345678",
        threadTs: "1234567890.123456",
        userId: "U12345678",
      },
    });

    const node = createTasksNode({ teamId, llm: mockLLM });
    await node(state);

    // Find create_issue call and check description contains Slack link
    const createIssueCall = mockCallMcpTool.mock.calls.find(
      (call) => call[0].tool === "create_issue",
    );
    expect(createIssueCall).toBeDefined();

    const description = createIssueCall?.[0].params?.description as string;
    expect(description).toContain("Slack conversation");
    expect(description).toContain("C12345678"); // Channel ID in URL
  });

  it("omits Slack link when slackContext is null", async () => {
    const taskList = createMockTaskList();
    const mockLLM = createMockLLM(taskList);
    const state = createBaseState({
      slackContext: null,
    });

    const node = createTasksNode({ teamId, llm: mockLLM });
    await node(state);

    // Find create_issue call and check description does not contain Slack link
    const createIssueCall = mockCallMcpTool.mock.calls.find(
      (call) => call[0].tool === "create_issue",
    );
    expect(createIssueCall).toBeDefined();

    const description = createIssueCall?.[0].params?.description as string;
    expect(description).not.toContain("Slack conversation");
  });

  it("omits Slack link when threadTs is null", async () => {
    const taskList = createMockTaskList();
    const mockLLM = createMockLLM(taskList);
    const state = createBaseState({
      slackContext: {
        channelId: "C12345678",
        threadTs: null,
        userId: "U12345678",
      },
    });

    const node = createTasksNode({ teamId, llm: mockLLM });
    await node(state);

    // Find create_issue call and check description does not contain Slack link
    const createIssueCall = mockCallMcpTool.mock.calls.find(
      (call) => call[0].tool === "create_issue",
    );
    expect(createIssueCall).toBeDefined();

    const description = createIssueCall?.[0].params?.description as string;
    expect(description).not.toContain("Slack conversation");
  });

  it("creates task with all existing labels resolved", async () => {
    // Task has feature and backend (both exist in mock)
    // Plus agent-ready is auto-added (also exists in mock)
    const taskList = createMockTaskList([
      {
        title: "Test task with all labels",
        description: "Test description",
        priority: "medium",
        labels: ["feature", "backend"], // Both exist in mock
      },
    ]);
    const mockLLM = createMockLLM(taskList);
    const state = createBaseState();

    const node = createTasksNode({ teamId, llm: mockLLM });
    const result = await node(state);

    // Should complete successfully
    expect(result.phase).toBe("complete");
    expect(result.createdTasks).toHaveLength(1);

    // Verify create_issue was called with all label IDs
    const createIssueCall = mockCallMcpTool.mock.calls.find(
      (c) => c[0].tool === "create_issue",
    );
    expect(createIssueCall).toBeDefined();

    const labelIds = createIssueCall?.[0].params?.labelIds as string[];
    // Should have feature (label-1), backend (label-2), and agent-ready (label-3)
    expect(labelIds).toContain("label-1"); // feature
    expect(labelIds).toContain("label-2"); // backend
    expect(labelIds).toContain("label-3"); // agent-ready
    expect(labelIds).toHaveLength(3);
  });

  it("creates tasks and returns complete phase", async () => {
    const taskList = createMockTaskList();
    const mockLLM = createMockLLM(taskList);
    const state = createBaseState();

    const node = createTasksNode({ teamId, llm: mockLLM });
    const result = await node(state);

    expect(result.phase).toBe("complete");
    expect(result.createdTasks).toHaveLength(1);
    expect(result.createdTasks?.[0]).toEqual({
      id: "issue-123",
      identifier: "ABC-123",
      title: "Test issue",
    });
  });
});
