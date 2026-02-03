/**
 * Linear Activities Tests
 *
 * Tests for Linear Temporal activities.
 * Verifies that status is configurable (not hardcoded).
 */

import type { IssueStatus } from "@aesir/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateLinearStatusActivity } from "./linear-activities.js";

// Mock the MCP client
vi.mock("../../mcp/index.js", () => ({
  callMcpTool: vi.fn(),
}));

// Import the mocked function
import { callMcpTool } from "../../mcp/index.js";

// LEGACY: These tests cover Temporal-based workflows replaced by v2.3 ConversationExecutor.
// They are preserved for Phase 47 cleanup when Temporal code is deleted.
// Do NOT delete these tests until Phase 47.
describe.skip("LEGACY: Linear Activities — Phase 47 cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls MCP with correct parameters", async () => {
    vi.mocked(callMcpTool).mockResolvedValue(undefined);

    await updateLinearStatusActivity("TASK-123", "Done");

    expect(callMcpTool).toHaveBeenCalledWith({
      integration: "linear",
      tool: "update_issue_status",
      params: { issueId: "TASK-123", status: "Done" },
      agentId: "temporal-worker",
      correlationId: "linear-activity-TASK-123",
    });
  });

  it("passes configurable status (not hardcoded Done)", async () => {
    vi.mocked(callMcpTool).mockResolvedValue(undefined);

    // Test with In Progress - verifies status is not hardcoded
    await updateLinearStatusActivity("TASK-456", "In Progress");

    expect(callMcpTool).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { issueId: "TASK-456", status: "In Progress" },
      }),
    );
  });

  it("supports all standard issue statuses", async () => {
    vi.mocked(callMcpTool).mockResolvedValue(undefined);

    const statuses: IssueStatus[] = [
      "Ready",
      "In Progress",
      "Done",
      "Canceled",
    ];

    for (const status of statuses) {
      vi.clearAllMocks();

      await updateLinearStatusActivity(`TASK-${status}`, status);

      expect(callMcpTool).toHaveBeenCalledWith(
        expect.objectContaining({
          params: { issueId: `TASK-${status}`, status },
        }),
      );
    }
  });

  it("propagates errors from MCP", async () => {
    const error = new Error("Issue not found: TASK-999");
    vi.mocked(callMcpTool).mockRejectedValue(error);

    await expect(
      updateLinearStatusActivity("TASK-999", "Done"),
    ).rejects.toThrow("Issue not found: TASK-999");
  });

  it("propagates errors for invalid status", async () => {
    const error = new Error(
      'State "Invalid" not found for team. Available states: Todo, In Progress, Done, Canceled',
    );
    vi.mocked(callMcpTool).mockRejectedValue(error);

    await expect(
      // @ts-expect-error - Testing with invalid status
      updateLinearStatusActivity("TASK-123", "Invalid"),
    ).rejects.toThrow('State "Invalid" not found');
  });
});
