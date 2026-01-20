/**
 * Tests for Pickup Task Node
 */

import type { DevWorkflowStateType } from "@aesir/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPickupTaskNode } from "./pickup-task.js";

// Mock the Linear integration module
vi.mock("../../integrations/linear/index.js", () => ({
  readIssue: vi.fn(),
  updateIssueStatus: vi.fn(),
  emitThought: vi.fn(),
}));

import { emitThought, readIssue, updateIssueStatus } from "@aesir/integrations";

const mockReadIssue = vi.mocked(readIssue);
const mockUpdateIssueStatus = vi.mocked(updateIssueStatus);
const mockEmitThought = vi.mocked(emitThought);

describe("createPickupTaskNode", () => {
  // Mock LinearClient
  const mockLinearClient = {} as Parameters<typeof createPickupTaskNode>[0];

  // Base state for tests
  const baseState: DevWorkflowStateType = {
    taskId: "ABC-123",
    sessionId: "session-test",
    taskDescription: "",
    repositoryUrl: null,
    branchName: null,
    files: [],
    testResult: null,
    testAttempts: 0,
    status: "pending",
    error: null,
    prNumber: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should read issue from Linear", async () => {
    mockReadIssue.mockResolvedValue({
      title: "Test issue title",
      description: "Test description",
    } as Awaited<ReturnType<typeof readIssue>>);
    mockUpdateIssueStatus.mockResolvedValue(undefined);
    mockEmitThought.mockResolvedValue(undefined);

    const pickupTask = createPickupTaskNode(mockLinearClient);
    await pickupTask(baseState);

    expect(mockReadIssue).toHaveBeenCalledWith(mockLinearClient, "ABC-123");
  });

  it("should update status to In Progress", async () => {
    mockReadIssue.mockResolvedValue({
      title: "Test issue title",
      description: "Test description",
    } as Awaited<ReturnType<typeof readIssue>>);
    mockUpdateIssueStatus.mockResolvedValue(undefined);
    mockEmitThought.mockResolvedValue(undefined);

    const pickupTask = createPickupTaskNode(mockLinearClient);
    await pickupTask(baseState);

    expect(mockUpdateIssueStatus).toHaveBeenCalledWith(
      mockLinearClient,
      "ABC-123",
      "In Progress",
    );
  });

  it("should emit thought activity", async () => {
    mockReadIssue.mockResolvedValue({
      title: "Test issue title",
      description: "Test description",
    } as Awaited<ReturnType<typeof readIssue>>);
    mockUpdateIssueStatus.mockResolvedValue(undefined);
    mockEmitThought.mockResolvedValue(undefined);

    const pickupTask = createPickupTaskNode(mockLinearClient);
    await pickupTask(baseState);

    expect(mockEmitThought).toHaveBeenCalledWith(
      mockLinearClient,
      "ABC-123",
      "Starting work on: Test issue title",
    );
  });

  it("should return task description and coding status", async () => {
    mockReadIssue.mockResolvedValue({
      title: "Test issue title",
      description: "Test description",
    } as Awaited<ReturnType<typeof readIssue>>);
    mockUpdateIssueStatus.mockResolvedValue(undefined);
    mockEmitThought.mockResolvedValue(undefined);

    const pickupTask = createPickupTaskNode(mockLinearClient);
    const result = await pickupTask(baseState);

    expect(result).toEqual({
      taskDescription: "Test issue title\n\nTest description",
      status: "coding",
    });
  });

  it("should handle issue with no description", async () => {
    mockReadIssue.mockResolvedValue({
      title: "Title only issue",
      description: undefined,
    } as unknown as Awaited<ReturnType<typeof readIssue>>);
    mockUpdateIssueStatus.mockResolvedValue(undefined);
    mockEmitThought.mockResolvedValue(undefined);

    const pickupTask = createPickupTaskNode(mockLinearClient);
    const result = await pickupTask(baseState);

    expect(result).toEqual({
      taskDescription: "Title only issue\n\n",
      status: "coding",
    });
  });

  it("should propagate readIssue errors", async () => {
    mockReadIssue.mockRejectedValue(new Error("Issue not found: ABC-123"));

    const pickupTask = createPickupTaskNode(mockLinearClient);
    await expect(pickupTask(baseState)).rejects.toThrow(
      "Issue not found: ABC-123",
    );
  });

  it("should propagate updateIssueStatus errors", async () => {
    mockReadIssue.mockResolvedValue({
      title: "Test issue",
      description: "Test description",
    } as Awaited<ReturnType<typeof readIssue>>);
    mockUpdateIssueStatus.mockRejectedValue(new Error("Status update failed"));

    const pickupTask = createPickupTaskNode(mockLinearClient);
    await expect(pickupTask(baseState)).rejects.toThrow("Status update failed");
  });
});
