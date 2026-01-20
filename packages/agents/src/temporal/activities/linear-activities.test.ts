/**
 * Linear Activities Tests
 *
 * Tests for Linear Temporal activities.
 * Verifies that status is configurable (not hardcoded).
 */

import type { IssueStatus } from "@aesir/common";
import type { LinearClient } from "@linear/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateLinearStatusActivity } from "./linear-activities.js";

// Mock the integrations module
vi.mock("@aesir/integrations", () => ({
  updateIssueStatus: vi.fn(),
}));

// Import the mocked function
import { updateIssueStatus } from "@aesir/integrations";

describe("updateLinearStatusActivity", () => {
  const mockClient = {} as LinearClient;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls updateIssueStatus with correct parameters", async () => {
    vi.mocked(updateIssueStatus).mockResolvedValue();

    await updateLinearStatusActivity(mockClient, "TASK-123", "Done");

    expect(updateIssueStatus).toHaveBeenCalledWith(
      mockClient,
      "TASK-123",
      "Done",
    );
  });

  it("passes configurable status (not hardcoded Done)", async () => {
    vi.mocked(updateIssueStatus).mockResolvedValue();

    // Test with In Progress - verifies status is not hardcoded
    await updateLinearStatusActivity(mockClient, "TASK-456", "In Progress");

    expect(updateIssueStatus).toHaveBeenCalledWith(
      mockClient,
      "TASK-456",
      "In Progress",
    );
  });

  it("supports all standard issue statuses", async () => {
    vi.mocked(updateIssueStatus).mockResolvedValue();

    const statuses: IssueStatus[] = [
      "Ready",
      "In Progress",
      "Done",
      "Canceled",
    ];

    for (const status of statuses) {
      vi.clearAllMocks();

      await updateLinearStatusActivity(mockClient, `TASK-${status}`, status);

      expect(updateIssueStatus).toHaveBeenCalledWith(
        mockClient,
        `TASK-${status}`,
        status,
      );
    }
  });

  it("propagates errors from updateIssueStatus", async () => {
    const error = new Error("Issue not found: TASK-999");
    vi.mocked(updateIssueStatus).mockRejectedValue(error);

    await expect(
      updateLinearStatusActivity(mockClient, "TASK-999", "Done"),
    ).rejects.toThrow("Issue not found: TASK-999");
  });

  it("propagates errors for invalid status", async () => {
    const error = new Error(
      'State "Invalid" not found for team. Available states: Todo, In Progress, Done, Canceled',
    );
    vi.mocked(updateIssueStatus).mockRejectedValue(error);

    await expect(
      // @ts-expect-error - Testing with invalid status
      updateLinearStatusActivity(mockClient, "TASK-123", "Invalid"),
    ).rejects.toThrow('State "Invalid" not found');
  });
});
