/**
 * Communication Tools Tests
 *
 * Unit tests for the three communication tool factories (reply, ask, notify).
 * Verifies Zod validation, denormalize delegation, option rendering, and
 * error handling following the McpError/generic Error pattern.
 */

import type { PinoLogger } from "@aesir/platform";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommunicationToolDeps } from "../../communication/types.js";
import { McpError } from "../../mcp/errors.js";
import type { McpErrorResponse } from "../../mcp/types.js";
import { createAskTool } from "./ask.js";
import { createNotifyTool } from "./notify.js";
import { createReplyTool } from "./reply.js";

// ---------------------------------------------------------------------------
// Mock callMcpTool (same pattern as denormalizer tests)
// ---------------------------------------------------------------------------

const mockCallMcpTool = vi.fn();

vi.mock("../../mcp/client.js", () => ({
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

const slackReplyContext = {
  channel: "slack" as const,
  teamId: "T123",
  channelId: "C123",
  threadTs: "1234.5678",
};

const linearReplyContext = {
  channel: "linear" as const,
  issueId: "ISS-123",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("communication tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCallMcpTool.mockResolvedValue({ success: true });
  });

  // ── reply tool ──────────────────────────────────────────────────────────

  describe("communication:reply", () => {
    it("calls denormalize with correct params and returns JSON result", async () => {
      const deps = createDeps();
      const tool = createReplyTool(deps);

      const result = await tool.execute({
        replyContext: slackReplyContext,
        message: "Hello world",
      });

      expect(mockCallMcpTool).toHaveBeenCalledWith(
        expect.objectContaining({
          integration: "slack",
          tool: "reply_to_thread",
          params: expect.objectContaining({
            text: "Hello world",
          }),
        }),
      );
      expect(result.isError).toBeUndefined();
      expect(JSON.parse(result.content)).toEqual({ success: true });
    });

    it("returns isError when replyContext is missing", async () => {
      const deps = createDeps();
      const tool = createReplyTool(deps);

      const result = await tool.execute({
        message: "Hello world",
      });

      expect(result.isError).toBe(true);
      expect(result.content).toContain("Invalid input");
      expect(mockCallMcpTool).not.toHaveBeenCalled();
    });

    it("returns isError with prefix on McpError", async () => {
      const mcpError = new McpError(
        createMcpErrorResponse("rate_limit: Too many requests"),
      );
      mockCallMcpTool.mockRejectedValue(mcpError);

      const deps = createDeps();
      const tool = createReplyTool(deps);

      const result = await tool.execute({
        replyContext: slackReplyContext,
        message: "Hello",
      });

      expect(result.isError).toBe(true);
      expect(result.content).toContain("communication_reply error:");
      expect(result.content).toContain("rate_limit: Too many requests");
    });

    it("returns isError with message on generic Error", async () => {
      mockCallMcpTool.mockRejectedValue(new Error("Network failure"));

      const deps = createDeps();
      const tool = createReplyTool(deps);

      const result = await tool.execute({
        replyContext: slackReplyContext,
        message: "Hello",
      });

      expect(result.isError).toBe(true);
      expect(result.content).toContain("communication_reply error:");
      expect(result.content).toContain("Network failure");
    });
  });

  // ── ask tool ────────────────────────────────────────────────────────────

  describe("communication:ask", () => {
    it("renders options as text instructions appended to question", async () => {
      const deps = createDeps();
      const tool = createAskTool(deps);

      await tool.execute({
        replyContext: slackReplyContext,
        question: "Which approach?",
        options: [
          { label: "Option A", value: "a" },
          { label: "Option B", value: "b" },
        ],
      });

      expect(mockCallMcpTool).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            text: 'Which approach?\n\n- **Option A**: reply "a"\n- **Option B**: reply "b"',
          }),
        }),
      );
    });

    it("passes question text directly when no options", async () => {
      const deps = createDeps();
      const tool = createAskTool(deps);

      await tool.execute({
        replyContext: slackReplyContext,
        question: "What do you think?",
      });

      expect(mockCallMcpTool).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            text: "What do you think?",
          }),
        }),
      );
    });

    it("returns isError when replyContext is missing", async () => {
      const deps = createDeps();
      const tool = createAskTool(deps);

      const result = await tool.execute({
        question: "What do you think?",
      });

      expect(result.isError).toBe(true);
      expect(result.content).toContain("Invalid input");
      expect(mockCallMcpTool).not.toHaveBeenCalled();
    });
  });

  // ── notify tool ─────────────────────────────────────────────────────────

  describe("communication:notify", () => {
    it("calls denormalize with target as replyContext", async () => {
      const deps = createDeps();
      const tool = createNotifyTool(deps);

      const result = await tool.execute({
        target: linearReplyContext,
        message: "Build completed",
      });

      expect(mockCallMcpTool).toHaveBeenCalledWith(
        expect.objectContaining({
          integration: "linear",
          tool: "create_comment",
          params: expect.objectContaining({
            issueId: "ISS-123",
            body: "Build completed",
          }),
        }),
      );
      expect(result.isError).toBeUndefined();
    });

    it("returns isError when target is missing", async () => {
      const deps = createDeps();
      const tool = createNotifyTool(deps);

      const result = await tool.execute({
        message: "Build completed",
      });

      expect(result.isError).toBe(true);
      expect(result.content).toContain("Invalid input");
      expect(mockCallMcpTool).not.toHaveBeenCalled();
    });
  });
});
