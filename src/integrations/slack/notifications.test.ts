/**
 * Slack Notification Tests
 *
 * Tests for notification formatting and posting functions.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WebClient } from "@slack/web-api";
import type { ApprovalNotification, StatusNotification } from "./types.js";
import {
  formatApprovalMessage,
  formatStatusMessage,
  postNotification,
  sendApprovalRequest,
  sendStatusUpdate,
  openDmChannel,
} from "./notifications.js";

// Create mock WebClient
function createMockClient(overrides?: Partial<WebClient>): WebClient {
  return {
    chat: {
      postMessage: vi.fn().mockResolvedValue({ ok: true, ts: "1234567890.123456" }),
    },
    conversations: {
      open: vi.fn().mockResolvedValue({ ok: true, channel: { id: "D1234567890" } }),
    },
    ...overrides,
  } as unknown as WebClient;
}

describe("formatApprovalMessage", () => {
  it("returns valid Block Kit blocks for approval notification", () => {
    const notification: ApprovalNotification = {
      type: "approval_needed",
      taskId: "ABC-123",
      prUrl: "https://github.com/org/repo/pull/42",
      title: "feat: Add user authentication",
      summary: "Implements JWT-based auth with refresh tokens",
    };

    const blocks = formatApprovalMessage(notification);

    expect(blocks).toHaveLength(4);
    expect(blocks[0]).toMatchObject({
      type: "section",
      text: {
        type: "mrkdwn",
        text: expect.stringContaining("PR Ready for Review"),
      },
    });
    expect(blocks[0]).toMatchObject({
      text: {
        text: expect.stringContaining("feat: Add user authentication"),
      },
    });
  });

  it("includes PR link in the blocks", () => {
    const notification: ApprovalNotification = {
      type: "approval_needed",
      taskId: "XYZ-456",
      prUrl: "https://github.com/test/repo/pull/99",
      title: "Test PR",
      summary: "Test summary",
    };

    const blocks = formatApprovalMessage(notification);

    const linkBlock = blocks.find(
      (b) =>
        b.type === "section" &&
        "text" in b &&
        b.text?.type === "mrkdwn" &&
        b.text.text.includes("github.com")
    );
    expect(linkBlock).toBeDefined();
  });

  it("includes task ID in context block", () => {
    const notification: ApprovalNotification = {
      type: "approval_needed",
      taskId: "DEF-789",
      prUrl: "https://github.com/org/repo/pull/1",
      title: "PR Title",
      summary: "Summary",
    };

    const blocks = formatApprovalMessage(notification);

    const contextBlock = blocks.find((b) => b.type === "context");
    expect(contextBlock).toBeDefined();
    expect(contextBlock).toMatchObject({
      elements: [
        {
          type: "mrkdwn",
          text: expect.stringContaining("DEF-789"),
        },
      ],
    });
  });
});

describe("formatStatusMessage", () => {
  it("returns blocks with arrow emoji for started status", () => {
    const notification: StatusNotification = {
      type: "status_update",
      taskId: "ABC-123",
      status: "started",
      details: null,
    };

    const blocks = formatStatusMessage(notification);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      type: "section",
      text: {
        type: "mrkdwn",
        text: expect.stringContaining(":arrow_forward:"),
      },
    });
  });

  it("returns blocks with checkmark emoji for completed status", () => {
    const notification: StatusNotification = {
      type: "status_update",
      taskId: "ABC-123",
      status: "completed",
      details: null,
    };

    const blocks = formatStatusMessage(notification);

    expect(blocks[0]).toMatchObject({
      text: {
        text: expect.stringContaining(":white_check_mark:"),
      },
    });
  });

  it("returns blocks with x emoji for failed status", () => {
    const notification: StatusNotification = {
      type: "status_update",
      taskId: "ABC-123",
      status: "failed",
      details: null,
    };

    const blocks = formatStatusMessage(notification);

    expect(blocks[0]).toMatchObject({
      text: {
        text: expect.stringContaining(":x:"),
      },
    });
  });

  it("includes details in context block when provided", () => {
    const notification: StatusNotification = {
      type: "status_update",
      taskId: "ABC-123",
      status: "completed",
      details: "All tests passed",
    };

    const blocks = formatStatusMessage(notification);

    expect(blocks).toHaveLength(2);
    const contextBlock = blocks.find((b) => b.type === "context");
    expect(contextBlock).toMatchObject({
      elements: [
        {
          type: "mrkdwn",
          text: "All tests passed",
        },
      ],
    });
  });

  it("omits context block when details is null", () => {
    const notification: StatusNotification = {
      type: "status_update",
      taskId: "ABC-123",
      status: "started",
      details: null,
    };

    const blocks = formatStatusMessage(notification);

    expect(blocks).toHaveLength(1);
    expect(blocks.find((b) => b.type === "context")).toBeUndefined();
  });
});

describe("postNotification", () => {
  let mockClient: WebClient;

  beforeEach(() => {
    mockClient = createMockClient();
  });

  it("calls chat.postMessage with correct parameters", async () => {
    const notification: ApprovalNotification = {
      type: "approval_needed",
      taskId: "ABC-123",
      prUrl: "https://github.com/org/repo/pull/42",
      title: "Test PR",
      summary: "Test summary",
    };

    await postNotification(mockClient, notification, "C1234567890");

    expect(mockClient.chat.postMessage).toHaveBeenCalledWith({
      channel: "C1234567890",
      text: expect.stringContaining("PR Ready for Review"),
      blocks: expect.any(Array),
    });
  });

  it("returns success result with timestamp", async () => {
    const notification: ApprovalNotification = {
      type: "approval_needed",
      taskId: "ABC-123",
      prUrl: "https://github.com/org/repo/pull/42",
      title: "Test PR",
      summary: "Test summary",
    };

    const result = await postNotification(mockClient, notification, "C1234567890");

    expect(result).toEqual({
      success: true,
      timestamp: "1234567890.123456",
    });
  });

  it("handles errors gracefully and returns failure result", async () => {
    const errorClient = createMockClient({
      chat: {
        postMessage: vi.fn().mockRejectedValue(new Error("channel_not_found")),
      },
    } as unknown as Partial<WebClient>);

    const notification: StatusNotification = {
      type: "status_update",
      taskId: "ABC-123",
      status: "started",
      details: null,
    };

    const result = await postNotification(errorClient, notification, "CINVALID");

    expect(result).toEqual({
      success: false,
      error: "channel_not_found",
    });
  });

  it("formats status notifications correctly", async () => {
    const notification: StatusNotification = {
      type: "status_update",
      taskId: "XYZ-999",
      status: "completed",
      details: "All tests passed",
    };

    await postNotification(mockClient, notification, "C1234567890");

    expect(mockClient.chat.postMessage).toHaveBeenCalledWith({
      channel: "C1234567890",
      text: expect.stringContaining("completed"),
      blocks: expect.any(Array),
    });
  });
});

describe("sendApprovalRequest", () => {
  it("delegates to postNotification", async () => {
    const mockClient = createMockClient();
    const notification: ApprovalNotification = {
      type: "approval_needed",
      taskId: "ABC-123",
      prUrl: "https://github.com/org/repo/pull/42",
      title: "Test PR",
      summary: "Test summary",
    };

    const result = await sendApprovalRequest(mockClient, notification, "C1234567890");

    expect(mockClient.chat.postMessage).toHaveBeenCalled();
    expect(result.success).toBe(true);
  });
});

describe("sendStatusUpdate", () => {
  it("delegates to postNotification", async () => {
    const mockClient = createMockClient();
    const notification: StatusNotification = {
      type: "status_update",
      taskId: "ABC-123",
      status: "failed",
      details: "Test failures detected",
    };

    const result = await sendStatusUpdate(mockClient, notification, "C1234567890");

    expect(mockClient.chat.postMessage).toHaveBeenCalled();
    expect(result.success).toBe(true);
  });
});

describe("openDmChannel", () => {
  it("calls conversations.open with user ID", async () => {
    const mockClient = createMockClient();

    await openDmChannel(mockClient, "U1234567890");

    expect(mockClient.conversations.open).toHaveBeenCalledWith({
      users: "U1234567890",
    });
  });

  it("returns the DM channel ID", async () => {
    const mockClient = createMockClient();

    const channelId = await openDmChannel(mockClient, "U1234567890");

    expect(channelId).toBe("D1234567890");
  });

  it("throws error if channel not returned", async () => {
    const errorClient = createMockClient({
      conversations: {
        open: vi.fn().mockResolvedValue({ ok: true, channel: {} }),
      },
    } as unknown as Partial<WebClient>);

    await expect(openDmChannel(errorClient, "U1234567890")).rejects.toThrow(
      "Failed to open DM channel"
    );
  });
});
