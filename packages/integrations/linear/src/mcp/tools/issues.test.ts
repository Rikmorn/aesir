/**
 * Linear MCP Tools - Issues Handler Tests
 *
 * Tests for handleCreateComment MCP tool handler.
 */

import type { MCPToolContext, MCPToolResult } from "@aesir/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateCommentOutput } from "../schemas.js";
import { handleCreateComment, type IssueToolDeps } from "./issues.js";

// Mock the permissions module
vi.mock("../../db/permissions.js", () => ({
  checkLinearToolPermission: vi.fn(),
}));

// Mock the oauth flow module
vi.mock("../../oauth/flow.js", () => ({
  createLinearClientFromDatabase: vi.fn(),
}));

// Import mocked modules
import { checkLinearToolPermission } from "../../db/permissions.js";
import { createLinearClientFromDatabase } from "../../oauth/flow.js";

const mockCheckPermission = vi.mocked(checkLinearToolPermission);
const mockCreateClient = vi.mocked(createLinearClientFromDatabase);

/**
 * Helper to extract text from MCP result content array
 */
function getResultText(result: MCPToolResult): string {
  return result.content[0]?.text ?? "";
}

/**
 * Create a mock tool context
 */
function createMockContext(
  overrides: Partial<MCPToolContext> = {},
): MCPToolContext {
  return {
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    } as unknown as MCPToolContext["logger"],
    correlationId: "test-correlation-id",
    agentId: "test-agent",
    startTime: Date.now(),
    ...overrides,
  };
}

/**
 * Create mock deps for issue tools
 */
function createMockDeps(): IssueToolDeps {
  return {
    db: {} as IssueToolDeps["db"],
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    } as unknown as IssueToolDeps["logger"],
    workspaceId: "ws_test",
  };
}

/**
 * Create a mock Linear client
 */
function createMockLinearClient() {
  return {
    createComment: vi.fn(),
  };
}

describe("handleCreateComment", () => {
  let context: MCPToolContext;
  let deps: IssueToolDeps;
  let mockLinearClient: ReturnType<typeof createMockLinearClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    context = createMockContext();
    deps = createMockDeps();
    mockLinearClient = createMockLinearClient();

    // Default: permission granted
    mockCheckPermission.mockResolvedValue(true);
    // Default: client creation succeeds
    mockCreateClient.mockResolvedValue(mockLinearClient as unknown as never);
  });

  describe("permission check", () => {
    it("returns error when agent does not have permission", async () => {
      mockCheckPermission.mockResolvedValue(false);

      const result = await handleCreateComment(
        context,
        { issueId: "ABC-123", body: "Test comment" },
        deps,
      );

      expect(result.isError).toBe(true);
      expect(getResultText(result)).toBe(
        "Permission denied: create_comment not allowed for this agent",
      );
      expect(mockCreateClient).not.toHaveBeenCalled();
    });

    it("checks permission with correct parameters", async () => {
      mockLinearClient.createComment.mockResolvedValue({
        success: true,
        comment: Promise.resolve({
          id: "comment-123",
          body: "Test comment",
          createdAt: new Date(),
        }),
      });

      await handleCreateComment(
        context,
        { issueId: "ABC-123", body: "Test comment" },
        deps,
      );

      expect(mockCheckPermission).toHaveBeenCalledWith(
        { db: deps.db, logger: context.logger },
        { agentId: "test-agent", toolName: "create_comment" },
      );
    });
  });

  describe("input validation", () => {
    it("returns error for missing issueId", async () => {
      const result = await handleCreateComment(
        context,
        { body: "Test comment" },
        deps,
      );

      expect(result.isError).toBe(true);
      expect(getResultText(result)).toContain("Invalid input");
      expect(mockCreateClient).not.toHaveBeenCalled();
    });

    it("returns error for missing body", async () => {
      const result = await handleCreateComment(
        context,
        { issueId: "ABC-123" },
        deps,
      );

      expect(result.isError).toBe(true);
      expect(getResultText(result)).toContain("Invalid input");
    });

    it("returns error for empty issueId", async () => {
      const result = await handleCreateComment(
        context,
        { issueId: "", body: "Test comment" },
        deps,
      );

      expect(result.isError).toBe(true);
      expect(getResultText(result)).toContain("Invalid input");
    });

    it("returns error for empty body", async () => {
      const result = await handleCreateComment(
        context,
        { issueId: "ABC-123", body: "" },
        deps,
      );

      expect(result.isError).toBe(true);
      expect(getResultText(result)).toContain("Invalid input");
    });
  });

  describe("successful comment creation", () => {
    it("creates comment and returns success", async () => {
      const mockComment = {
        id: "comment-123",
        body: "Test comment",
        createdAt: new Date("2026-01-26T00:00:00Z"),
      };
      mockLinearClient.createComment.mockResolvedValue({
        success: true,
        comment: Promise.resolve(mockComment),
      });

      const result = await handleCreateComment(
        context,
        { issueId: "ABC-123", body: "Test comment" },
        deps,
      );

      expect(result.isError).toBeFalsy();
      expect(getResultText(result)).toContain(
        "Created comment on issue ABC-123",
      );

      const data = result.structuredContent as CreateCommentOutput;
      expect(data.id).toBe("comment-123");
      expect(data.body).toBe("Test comment");
      expect(data.createdAt).toBe("2026-01-26T00:00:00.000Z");
    });

    it("passes correct parameters to Linear client", async () => {
      mockLinearClient.createComment.mockResolvedValue({
        success: true,
        comment: Promise.resolve({
          id: "comment-123",
          body: "Markdown **comment**",
          createdAt: new Date(),
        }),
      });

      await handleCreateComment(
        context,
        { issueId: "ABC-123", body: "Markdown **comment**" },
        deps,
      );

      expect(mockLinearClient.createComment).toHaveBeenCalledWith({
        issueId: "ABC-123",
        body: "Markdown **comment**",
      });
    });
  });

  describe("error handling", () => {
    it("returns error when Linear API fails to create comment", async () => {
      mockLinearClient.createComment.mockResolvedValue({
        success: false,
        comment: null,
      });

      const result = await handleCreateComment(
        context,
        { issueId: "ABC-123", body: "Test comment" },
        deps,
      );

      expect(result.isError).toBe(true);
      expect(getResultText(result)).toBe("Failed to create comment");
    });

    it("returns error when comment retrieval fails", async () => {
      mockLinearClient.createComment.mockResolvedValue({
        success: true,
        comment: Promise.resolve(null),
      });

      const result = await handleCreateComment(
        context,
        { issueId: "ABC-123", body: "Test comment" },
        deps,
      );

      expect(result.isError).toBe(true);
      expect(getResultText(result)).toBe(
        "Comment created but could not retrieve",
      );
    });

    it("returns error when Linear client throws", async () => {
      mockLinearClient.createComment.mockRejectedValue(
        new Error("API timeout"),
      );

      const result = await handleCreateComment(
        context,
        { issueId: "ABC-123", body: "Test comment" },
        deps,
      );

      expect(result.isError).toBe(true);
      expect(getResultText(result)).toContain("Failed to create comment");
      expect(getResultText(result)).toContain("API timeout");
    });

    it("handles non-Error exceptions", async () => {
      mockLinearClient.createComment.mockRejectedValue("string error");

      const result = await handleCreateComment(
        context,
        { issueId: "ABC-123", body: "Test comment" },
        deps,
      );

      expect(result.isError).toBe(true);
      expect(getResultText(result)).toContain("Unknown error");
    });
  });
});
