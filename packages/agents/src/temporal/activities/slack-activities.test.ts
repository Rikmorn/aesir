/**
 * Slack Activities Tests
 *
 * Tests for Slack Temporal activities.
 * Mocks sendApprovalRequest and sendStatusUpdate.
 */

import type { WebClient } from "@slack/web-api";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ApprovalNotification,
  StatusNotification,
} from "@aesir/integrations";
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
      success: true,
      timestamp: "1234567890.123456",
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

  it("returns notification result", async () => {
    vi.mocked(sendApprovalRequest).mockResolvedValue({
      success: true,
      timestamp: "1234567890.123456",
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
      success: true,
      timestamp: "1234567890.123456",
    });
  });

  it("returns failure result on error", async () => {
    vi.mocked(sendApprovalRequest).mockResolvedValue({
      success: false,
      error: "channel_not_found",
    });

    const notification: ApprovalNotification = {
      type: "approval_needed",
      taskId: "TASK-123",
      prUrl: "https://github.com/owner/repo/pull/42",
      title: "Test",
      summary: "Test summary",
    };

    const result = await sendApprovalRequestActivity(
      mockClient,
      notification,
      "invalid",
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("channel_not_found");
  });
});

describe("sendStatusUpdateActivity", () => {
  const mockClient = {} as WebClient;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates to sendStatusUpdate with correct parameters", async () => {
    vi.mocked(sendStatusUpdate).mockResolvedValue({
      success: true,
      timestamp: "1234567890.654321",
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

  it("returns notification result", async () => {
    vi.mocked(sendStatusUpdate).mockResolvedValue({
      success: true,
      timestamp: "1234567890.654321",
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
      success: true,
      timestamp: "1234567890.654321",
    });
  });

  it("handles all status types", async () => {
    vi.mocked(sendStatusUpdate).mockResolvedValue({ success: true });

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
