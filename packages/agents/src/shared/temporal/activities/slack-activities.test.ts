/**
 * Slack Activities Tests
 *
 * Tests for Slack Temporal activities.
 * Mocks MCP calls to verify activity behavior.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ApprovalNotification,
  type StatusNotification,
  sendApprovalRequestActivity,
  sendStatusUpdateActivity,
} from "./slack-activities.js";

// Mock the MCP client
vi.mock("../../mcp/index.js", () => ({
  callMcpTool: vi.fn(),
}));

// Import the mocked function
import { callMcpTool } from "../../mcp/index.js";

// LEGACY: These tests cover Temporal-based workflows replaced by v2.3 ConversationExecutor.
// They are preserved for Phase 47 cleanup when Temporal code is deleted.
// Do NOT delete these tests until Phase 47.
describe.skip("LEGACY: Slack Activities — Phase 47 cleanup", () => {
  describe("sendApprovalRequestActivity", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("calls MCP with correct parameters", async () => {
      vi.mocked(callMcpTool).mockResolvedValue({
        success: true,
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

      await sendApprovalRequestActivity(notification, "C12345678");

      expect(callMcpTool).toHaveBeenCalledWith({
        integration: "slack",
        tool: "send_approval_request",
        params: {
          channel: "C12345678",
          taskId: "TASK-123",
          prUrl: "https://github.com/owner/repo/pull/42",
          title: "Add new feature",
          summary: "This PR implements a new feature",
        },
        agentId: "dev-agent",
        correlationId: "slack-approval-TASK-123",
      });
    });

    it("returns message result", async () => {
      vi.mocked(callMcpTool).mockResolvedValue({
        success: true,
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
        notification,
        "C12345678",
      );

      expect(result).toEqual({
        success: true,
        ts: "1234567890.123456",
        channel: "C12345678",
      });
    });

    it("propagates errors from MCP", async () => {
      vi.mocked(callMcpTool).mockRejectedValue(new Error("channel_not_found"));

      const notification: ApprovalNotification = {
        type: "approval_needed",
        taskId: "TASK-123",
        prUrl: "https://github.com/owner/repo/pull/42",
        title: "Test",
        summary: "Test summary",
      };

      await expect(
        sendApprovalRequestActivity(notification, "invalid"),
      ).rejects.toThrow("channel_not_found");
    });
  });

  describe("sendStatusUpdateActivity", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("calls MCP with correct parameters", async () => {
      vi.mocked(callMcpTool).mockResolvedValue({
        success: true,
        ts: "1234567890.654321",
        channel: "C98765432",
      });

      const notification: StatusNotification = {
        taskId: "TASK-456",
        status: "completed",
        message: "PR merged successfully",
      };

      await sendStatusUpdateActivity(notification, "C98765432");

      expect(callMcpTool).toHaveBeenCalledWith({
        integration: "slack",
        tool: "send_message",
        params: {
          channel: "C98765432",
          text: "*Task TASK-456*: completed\nPR merged successfully",
        },
        agentId: "dev-agent",
        correlationId: "slack-status-TASK-456",
      });
    });

    it("returns message result", async () => {
      vi.mocked(callMcpTool).mockResolvedValue({
        success: true,
        ts: "1234567890.654321",
        channel: "C98765432",
      });

      const notification: StatusNotification = {
        taskId: "TASK-456",
        status: "started",
        message: "Starting work",
      };

      const result = await sendStatusUpdateActivity(notification, "C98765432");

      expect(result).toEqual({
        success: true,
        ts: "1234567890.654321",
        channel: "C98765432",
      });
    });

    it("handles different status types", async () => {
      vi.mocked(callMcpTool).mockResolvedValue({
        success: true,
        ts: "1234567890.000000",
        channel: "C12345",
      });

      const statuses = ["started", "completed", "failed"];

      for (const status of statuses) {
        vi.clearAllMocks();

        const notification: StatusNotification = {
          taskId: "TASK-789",
          status,
          message: `Status is ${status}`,
        };

        await sendStatusUpdateActivity(notification, "C12345");

        expect(callMcpTool).toHaveBeenCalledWith(
          expect.objectContaining({
            params: expect.objectContaining({
              text: expect.stringContaining(status),
            }),
          }),
        );
      }
    });
  });
}); // end LEGACY describe.skip
