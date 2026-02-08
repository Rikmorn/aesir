/**
 * Integration Tools Tests
 *
 * Unit tests for MCP integration tool wrappers.
 * Tests the generic createMcpToolWrapper helper thoroughly (covers all 19 tools),
 * then verifies each factory returns the correct tools with proper names.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { McpError } from "../../mcp/errors.js";
import type { McpErrorResponse } from "../../mcp/types.js";
import { createGitHubTools } from "./github-tools.js";
import { createLinearTools } from "./linear-tools.js";
import type { McpToolDeps } from "./mcp-wrapper.js";
import { createMcpToolWrapper } from "./mcp-wrapper.js";
import { createSlackTools } from "./slack-tools.js";

// ---------------------------------------------------------------------------
// Mock callMcpTool
// ---------------------------------------------------------------------------

const mockCallMcpTool = vi.fn();

vi.mock("../../mcp/client.js", () => ({
  callMcpTool: (...args: unknown[]) => mockCallMcpTool(...args),
}));

// ---------------------------------------------------------------------------
// Shared test helpers
// ---------------------------------------------------------------------------

function createDeps(): McpToolDeps {
  return {
    agentId: "test-agent",
    correlationId: "corr-123",
  };
}

function createMcpErrorResponse(message: string): McpErrorResponse {
  return {
    error: message,
    isError: true,
    meta: { correlation_id: "corr-123" },
  };
}

// ---------------------------------------------------------------------------
// createMcpToolWrapper helper
// ---------------------------------------------------------------------------

describe("createMcpToolWrapper", () => {
  const testSchema = z.object({
    id: z.string(),
    optional: z.string().optional(),
  });

  function createTestTool(deps: McpToolDeps) {
    return createMcpToolWrapper(
      {
        integration: "linear",
        toolName: "test_tool",
        displayName: "test_display_name",
        description: "A test tool for unit testing",
        inputSchema: testSchema,
      },
      deps,
    );
  }

  beforeEach(() => {
    mockCallMcpTool.mockReset();
  });

  it("returns a ToolDefinition with correct name, description, and schema", () => {
    const tool = createTestTool(createDeps());

    expect(tool.name).toBe("test_display_name");
    expect(tool.description).toBe("A test tool for unit testing");
    expect(tool.inputSchema).toBe(testSchema);
    expect(tool.execute).toBeTypeOf("function");
  });

  it("returns JSON.stringify result from callMcpTool on success", async () => {
    const mockResult = { title: "Fix bug", status: "done" };
    mockCallMcpTool.mockResolvedValue(mockResult);

    const tool = createTestTool(createDeps());
    const result = await tool.execute({ id: "ABC-123" });

    expect(result.content).toBe(JSON.stringify(mockResult, null, 2));
    expect(result.isError).toBeUndefined();
  });

  it("passes correct parameters to callMcpTool", async () => {
    mockCallMcpTool.mockResolvedValue({});

    const deps = createDeps();
    const tool = createTestTool(deps);
    await tool.execute({ id: "ABC-123", optional: "extra" });

    expect(mockCallMcpTool).toHaveBeenCalledWith({
      integration: "linear",
      tool: "test_tool",
      params: { id: "ABC-123", optional: "extra" },
      agentId: "test-agent",
      correlationId: "corr-123",
    });
  });

  it("returns isError:true with validation message on invalid input", async () => {
    const tool = createTestTool(createDeps());
    const result = await tool.execute({ id: 42 }); // wrong type

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Invalid input");
    expect(mockCallMcpTool).not.toHaveBeenCalled();
  });

  it("returns isError:true with validation message on missing required field", async () => {
    const tool = createTestTool(createDeps());
    const result = await tool.execute({}); // missing id

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Invalid input");
    expect(mockCallMcpTool).not.toHaveBeenCalled();
  });

  it("catches McpError and returns isError:true with tool name", async () => {
    const errorResponse = createMcpErrorResponse(
      "rate_limit: Too many requests",
    );
    mockCallMcpTool.mockRejectedValue(new McpError(errorResponse));

    const tool = createTestTool(createDeps());
    const result = await tool.execute({ id: "ABC-123" });

    expect(result.isError).toBe(true);
    expect(result.content).toBe(
      "test_display_name error: rate_limit: Too many requests",
    );
  });

  it("catches generic Error and returns isError:true with message", async () => {
    mockCallMcpTool.mockRejectedValue(new Error("Network timeout"));

    const tool = createTestTool(createDeps());
    const result = await tool.execute({ id: "ABC-123" });

    expect(result.isError).toBe(true);
    expect(result.content).toBe("test_display_name error: Network timeout");
  });

  it("catches non-Error thrown values and returns isError:true", async () => {
    mockCallMcpTool.mockRejectedValue("unexpected string error");

    const tool = createTestTool(createDeps());
    const result = await tool.execute({ id: "ABC-123" });

    expect(result.isError).toBe(true);
    expect(result.content).toBe(
      "test_display_name error: unexpected string error",
    );
  });
});

// ---------------------------------------------------------------------------
// createLinearTools
// ---------------------------------------------------------------------------

describe("createLinearTools", () => {
  beforeEach(() => {
    mockCallMcpTool.mockReset();
  });

  it("returns exactly 7 tools", () => {
    const tools = createLinearTools(createDeps());
    expect(tools).toHaveLength(7);
  });

  it("returns tools with correct names", () => {
    const tools = createLinearTools(createDeps());
    const names = tools.map((t) => t.name);

    expect(names).toEqual([
      "linear_get_issue",
      "linear_create_issue",
      "linear_update_issue_status",
      "linear_list_teams",
      "linear_list_labels",
      "linear_search_issues",
      "linear_create_comment",
    ]);
  });

  it("all tools have non-empty descriptions", () => {
    const tools = createLinearTools(createDeps());
    for (const tool of tools) {
      expect(tool.description).toBeTruthy();
      expect(tool.description.length).toBeGreaterThan(20);
    }
  });

  it("linear_get_issue executes correctly with valid input", async () => {
    const mockIssue = {
      id: "issue-1",
      title: "Fix bug",
      status: "In Progress",
    };
    mockCallMcpTool.mockResolvedValue(mockIssue);

    const tools = createLinearTools(createDeps());
    const getIssue = tools.find((t) => t.name === "linear_get_issue");
    if (!getIssue) throw new Error("linear_get_issue tool not found");

    const result = await getIssue.execute({ issueId: "ABC-123" });

    expect(result.content).toBe(JSON.stringify(mockIssue, null, 2));
    expect(result.isError).toBeUndefined();
    expect(mockCallMcpTool).toHaveBeenCalledWith(
      expect.objectContaining({
        integration: "linear",
        tool: "get_issue",
        params: { issueId: "ABC-123" },
        agentId: "test-agent",
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// createGitHubTools
// ---------------------------------------------------------------------------

describe("createGitHubTools", () => {
  beforeEach(() => {
    mockCallMcpTool.mockReset();
  });

  it("returns exactly 10 tools", () => {
    const tools = createGitHubTools(createDeps());
    expect(tools).toHaveLength(10);
  });

  it("returns tools with correct names", () => {
    const tools = createGitHubTools(createDeps());
    const names = tools.map((t) => t.name);

    expect(names).toEqual([
      "github_get_repository",
      "github_create_branch",
      "github_create_commit",
      "github_create_pull_request",
      "github_get_pull_request",
      "github_list_pull_requests",
      "github_merge_pull_request",
      "github_get_file_contents",
      "github_list_files",
      "github_create_pr_comment",
    ]);
  });

  it("all tools have non-empty descriptions", () => {
    const tools = createGitHubTools(createDeps());
    for (const tool of tools) {
      expect(tool.description).toBeTruthy();
      expect(tool.description.length).toBeGreaterThan(20);
    }
  });

  it("github_create_branch executes correctly with valid input", async () => {
    const mockBranch = { name: "feature/new-auth", sha: "abc123" };
    mockCallMcpTool.mockResolvedValue(mockBranch);

    const tools = createGitHubTools(createDeps());
    const createBranch = tools.find((t) => t.name === "github_create_branch");
    if (!createBranch) throw new Error("github_create_branch tool not found");

    const result = await createBranch.execute({
      owner: "my-org",
      repo: "my-repo",
      branchName: "feature/new-auth",
      baseBranch: "main",
    });

    expect(result.content).toBe(JSON.stringify(mockBranch, null, 2));
    expect(result.isError).toBeUndefined();
    expect(mockCallMcpTool).toHaveBeenCalledWith(
      expect.objectContaining({
        integration: "github",
        tool: "create_branch",
        params: {
          owner: "my-org",
          repo: "my-repo",
          branchName: "feature/new-auth",
          baseBranch: "main",
        },
        agentId: "test-agent",
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// createSlackTools
// ---------------------------------------------------------------------------

describe("createSlackTools", () => {
  beforeEach(() => {
    mockCallMcpTool.mockReset();
  });

  it("returns exactly 5 tools", () => {
    const tools = createSlackTools(createDeps());
    expect(tools).toHaveLength(5);
  });

  it("returns tools with correct names", () => {
    const tools = createSlackTools(createDeps());
    const names = tools.map((t) => t.name);

    expect(names).toEqual([
      "slack_send_message",
      "slack_send_approval_request",
      "slack_get_message",
      "slack_reply_to_thread",
      "slack_list_channels",
    ]);
  });

  it("all tools have non-empty descriptions", () => {
    const tools = createSlackTools(createDeps());
    for (const tool of tools) {
      expect(tool.description).toBeTruthy();
      expect(tool.description.length).toBeGreaterThan(20);
    }
  });

  it("slack_send_message executes correctly with valid input", async () => {
    const mockResponse = { ok: true, ts: "1234567890.123456" };
    mockCallMcpTool.mockResolvedValue(mockResponse);

    const tools = createSlackTools(createDeps());
    const sendMessage = tools.find((t) => t.name === "slack_send_message");
    if (!sendMessage) throw new Error("slack_send_message tool not found");

    const result = await sendMessage.execute({
      channel: "C1234567890",
      text: "Hello from agent",
    });

    expect(result.content).toBe(JSON.stringify(mockResponse, null, 2));
    expect(result.isError).toBeUndefined();
    expect(mockCallMcpTool).toHaveBeenCalledWith(
      expect.objectContaining({
        integration: "slack",
        tool: "send_message",
        params: { channel: "C1234567890", text: "Hello from agent" },
        agentId: "test-agent",
      }),
    );
  });
});
