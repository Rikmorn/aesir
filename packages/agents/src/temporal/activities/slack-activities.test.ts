/**
 * Slack Activities Tests
 *
 * Tests for Slack Temporal activities.
 * Mocks sendApprovalRequest and sendStatusUpdate.
 */

import type {
  ApprovalNotification,
  StatusNotification,
} from "@aesir/integrations";
import type { WebClient } from "@slack/web-api";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  sendApprovalRequestActivity,
  sendStatusUpdateActivity,
} from "./slack-activities.js";

// Mock the integrations module
vi.mock("@aesir/integrations", () => ({
  sendApprovalRequest: vi.fn(),
  sendStatusUpdate: vi.fn(),
}));

// Import the mocked functions
import { sendApprovalRequest, sendStatusUpdate } from "@aesir/integrations";

describe("sendApprovalRequestActivity", () => {
  const mockClient = {} as WebClient;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates to sendApprovalRequest with correct parameters", async () => {
    vi.mocked(sendApprovalRequest).mockResolvedValue({
      ts: "1234567890.123456",
      channel: "C12345678",
    });

    const notification: ApprovalNotification = {
      type: "approval_needed",
      taskId: "TASK-123",
      prUrl: "https://github.com/owner/repo/pull/42",
      title: "Add new feature",
      summary: "This PR implements a new feature",
    };

    await sendApprovalRequestActivity(mockClient, notification, "C12345678");

    expect(sendApprovalRequest).toHaveBeenCalledWith(
      mockClient,
      notification,
      "C12345678",
    );
  });

  it("returns message result with ts and channel", async () => {
    vi.mocked(sendApprovalRequest).mockResolvedValue({
      ts: "1234567890.123456",
      channel: "C12345678",
    });

    const notification: ApprovalNotification = {
      type: "approval_needed",
      taskId: "TASK-123",
      prUrl: "https://github.com/owner/repo/pull/42",
      title: "Add new feature",
      summary: "This PR implements a new feature",
    };

    const result = await sendApprovalRequestActivity(
      mockClient,
      notification,
      "C12345678",
    );

    expect(result).toEqual({
      ts: "1234567890.123456",
      channel: "C12345678",
    });
  });

  it("propagates errors from sendApprovalRequest", async () => {
    vi.mocked(sendApprovalRequest).mockRejectedValue(
      new Error("channel_not_found"),
    );

    const notification: ApprovalNotification = {
      type: "approval_needed",
      taskId: "TASK-123",
      prUrl: "https://github.com/owner/repo/pull/42",
      title: "Test",
      summary: "Test summary",
    };

    await expect(
      sendApprovalRequestActivity(mockClient, notification, "invalid"),
    ).rejects.toThrow("channel_not_found");
  });
});

describe("sendStatusUpdateActivity", () => {
  const mockClient = {} as WebClient;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates to sendStatusUpdate with correct parameters", async () => {
    vi.mocked(sendStatusUpdate).mockResolvedValue({
      ts: "1234567890.654321",
      channel: "C98765432",
    });

    const notification: StatusNotification = {
      type: "status_update",
      taskId: "TASK-456",
      status: "completed",
      details: "PR merged successfully",
    };

    await sendStatusUpdateActivity(mockClient, notification, "C98765432");

    expect(sendStatusUpdate).toHaveBeenCalledWith(
      mockClient,
      notification,
      "C98765432",
    );
  });

  it("returns message result with ts and channel", async () => {
    vi.mocked(sendStatusUpdate).mockResolvedValue({
      ts: "1234567890.654321",
      channel: "C98765432",
    });

    const notification: StatusNotification = {
      type: "status_update",
      taskId: "TASK-456",
      status: "started",
      details: null,
    };

    const result = await sendStatusUpdateActivity(
      mockClient,
      notification,
      "C98765432",
    );

    expect(result).toEqual({
      ts: "1234567890.654321",
      channel: "C98765432",
    });
  });

  it("handles all status types", async () => {
    vi.mocked(sendStatusUpdate).mockResolvedValue({
      ts: "1234567890.000000",
      channel: "C12345",
    });

    const statuses: StatusNotification["status"][] = [
      "started",
      "completed",
      "failed",
    ];

    for (const status of statuses) {
      const notification: StatusNotification = {
        type: "status_update",
        taskId: "TASK-789",
        status,
        details: null,
      };

      await sendStatusUpdateActivity(mockClient, notification, "C12345");

      expect(sendStatusUpdate).toHaveBeenCalledWith(
        mockClient,
        notification,
        "C12345",
      );
    }
  });
});
