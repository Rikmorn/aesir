/**
 * Denormalizer Tests
 *
 * Unit tests for the outbound denormalize() dispatch function.
 * Verifies correct MCP tool routing based on replyContext.channel,
 * parameter mapping, return value passthrough, error propagation, and logging.
 */

import type { PinoLogger } from "@aesir/platform";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { McpError } from "../mcp/errors.js";
import type { McpErrorResponse } from "../mcp/types.js";
import { denormalize } from "./denormalizer.js";
import type { CommunicationToolDeps, ReplyContext } from "./types.js";

// ---------------------------------------------------------------------------
// Mock callMcpTool
// ---------------------------------------------------------------------------

const mockCallMcpTool = vi.fn();

vi.mock("../mcp/client.js", () => ({
  callMcpTool: (...args: unknown[]) => mockCallMcpTool(...args),
}));

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createMockLogger(): PinoLogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn().mockReturnThis(),
    level: "info",
    silent: vi.fn(),
  } as unknown as PinoLogger;
}

function createDeps(
  overrides?: Partial<CommunicationToolDeps>,
): CommunicationToolDeps {
  return {
    agentId: "test-agent",
    correlationId: "corr-123",
    logger: createMockLogger(),
    ...overrides,
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
// Tests
// ---------------------------------------------------------------------------

describe("denormalize", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCallMcpTool.mockResolvedValue({ success: true });
  });

  // ── Slack dispatch ──────────────────────────────────────────────────────

  describe("Slack dispatch", () => {
    it("calls reply_to_thread when threadTs is present", async () => {
      const replyContext: ReplyContext = {
        channel: "slack",
        teamId: "T123",
        channelId: "C456",
        threadTs: "1234567890.123456",
      };
      const deps = createDeps();

      await denormalize({ replyContext, text: "Hello thread" }, deps);

      expect(mockCallMcpTool).toHaveBeenCalledWith({
        integration: "slack",
        tool: "reply_to_thread",
        params: {
          channel: "C456",
          threadTs: "1234567890.123456",
          text: "Hello thread",
        },
        agentId: "test-agent",
        correlationId: "corr-123",
      });
    });

    it("calls send_message when threadTs is absent", async () => {
      const replyContext: ReplyContext = {
        channel: "slack",
        teamId: "T123",
        channelId: "C456",
      };
      const deps = createDeps();

      await denormalize({ replyContext, text: "Hello channel" }, deps);

      expect(mockCallMcpTool).toHaveBeenCalledWith({
        integration: "slack",
        tool: "send_message",
        params: {
          channel: "C456",
          text: "Hello channel",
        },
        agentId: "test-agent",
        correlationId: "corr-123",
      });

      // Verify threadTs is NOT present in params
      const callArgs = mockCallMcpTool.mock.calls[0]?.[0] as
        | Record<string, unknown>
        | undefined;
      expect(callArgs).toBeDefined();
      expect(
        (callArgs as { params: Record<string, unknown> }).params,
      ).not.toHaveProperty("threadTs");
    });
  });

  // ── Linear dispatch ─────────────────────────────────────────────────────

  describe("Linear dispatch", () => {
    it("calls create_comment with issueId and body", async () => {
      const replyContext: ReplyContext = {
        channel: "linear",
        issueId: "ABC-123",
      };
      const deps = createDeps();

      await denormalize({ replyContext, text: "Issue comment" }, deps);

      expect(mockCallMcpTool).toHaveBeenCalledWith({
        integration: "linear",
        tool: "create_comment",
        params: {
          issueId: "ABC-123",
          body: "Issue comment",
        },
        agentId: "test-agent",
        correlationId: "corr-123",
      });
    });
  });

  // ── GitHub dispatch ─────────────────────────────────────────────────────

  describe("GitHub dispatch", () => {
    it("calls create_pr_comment with owner, repo, prNumber, and body", async () => {
      const replyContext: ReplyContext = {
        channel: "github",
        owner: "my-org",
        repo: "my-repo",
        prNumber: 42,
      };
      const deps = createDeps();

      await denormalize({ replyContext, text: "PR comment" }, deps);

      expect(mockCallMcpTool).toHaveBeenCalledWith({
        integration: "github",
        tool: "create_pr_comment",
        params: {
          owner: "my-org",
          repo: "my-repo",
          prNumber: 42,
          body: "PR comment",
        },
        agentId: "test-agent",
        correlationId: "corr-123",
      });
    });

    it("includes inReplyTo when commentId is present", async () => {
      const replyContext: ReplyContext = {
        channel: "github",
        owner: "my-org",
        repo: "my-repo",
        prNumber: 42,
        commentId: 99,
      };
      const deps = createDeps();

      await denormalize({ replyContext, text: "Inline reply" }, deps);

      expect(mockCallMcpTool).toHaveBeenCalledWith({
        integration: "github",
        tool: "create_pr_comment",
        params: {
          owner: "my-org",
          repo: "my-repo",
          prNumber: 42,
          body: "Inline reply",
          inReplyTo: 99,
        },
        agentId: "test-agent",
        correlationId: "corr-123",
      });
    });
  });

  // ── Return value passthrough ────────────────────────────────────────────

  it("returns callMcpTool result directly", async () => {
    const expectedResult = { success: true, data: "test-response" };
    mockCallMcpTool.mockResolvedValue(expectedResult);

    const replyContext: ReplyContext = {
      channel: "linear",
      issueId: "ABC-123",
    };
    const deps = createDeps();

    const result = await denormalize({ replyContext, text: "test" }, deps);

    expect(result).toBe(expectedResult);
  });

  // ── Error propagation ──────────────────────────────────────────────────

  it("propagates McpError without wrapping", async () => {
    const mcpError = new McpError(
      createMcpErrorResponse("rate_limit: Too many requests"),
    );
    mockCallMcpTool.mockRejectedValue(mcpError);

    const replyContext: ReplyContext = {
      channel: "slack",
      teamId: "T123",
      channelId: "C456",
    };
    const deps = createDeps();

    await expect(
      denormalize({ replyContext, text: "test" }, deps),
    ).rejects.toThrow(mcpError);

    await expect(
      denormalize({ replyContext, text: "test" }, deps),
    ).rejects.toBeInstanceOf(McpError);
  });

  // ── Logging ────────────────────────────────────────────────────────────

  it("logs info with channel, tool, and agentId", async () => {
    const replyContext: ReplyContext = {
      channel: "slack",
      teamId: "T123",
      channelId: "C456",
      threadTs: "1234567890.123456",
    };
    const deps = createDeps();

    await denormalize({ replyContext, text: "test" }, deps);

    expect(deps.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "slack",
        tool: "reply_to_thread",
        agentId: "test-agent",
      }),
      expect.any(String),
    );
  });

  // ── taskId forwarding ──────────────────────────────────────────────────

  it("forwards taskId to callMcpTool when present", async () => {
    const replyContext: ReplyContext = {
      channel: "linear",
      issueId: "ABC-123",
    };
    const deps = createDeps({ taskId: "task-456" });

    await denormalize({ replyContext, text: "test" }, deps);

    expect(mockCallMcpTool).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-456",
      }),
    );
  });
});
