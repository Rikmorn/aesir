import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  extractTaskId,
  getWorkflowId,
  handlePRReviewEvent,
  type PRReviewEvent,
} from "./github-pr-review.js";

// Mock @aesir/platform - partial mock to preserve logger and other exports
vi.mock("@aesir/platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aesir/platform")>();
  return {
    ...actual,
    sendApprovalSignal: vi.fn().mockResolvedValue(undefined),
    sendChangesRequestedSignal: vi.fn().mockResolvedValue(undefined),
  };
});

// Import after mocking
import * as temporalClient from "@aesir/platform";

describe("extractTaskId", () => {
  it('extracts task ID from "Task: ABC-123" format', () => {
    expect(extractTaskId({ title: "Fix bug", body: "Task: ABC-123" })).toBe(
      "ABC-123",
    );
  });

  it('extracts task ID from "[ABC-123]" format in title', () => {
    expect(extractTaskId({ title: "[ABC-123] Fix bug", body: null })).toBe(
      "ABC-123",
    );
  });

  it('extracts task ID from "Linear: ABC-123" format', () => {
    expect(extractTaskId({ title: "Fix bug", body: "Linear: ABC-123" })).toBe(
      "ABC-123",
    );
  });

  it("handles multi-letter project prefixes", () => {
    expect(extractTaskId({ title: "[PROJ-42] Fix bug", body: null })).toBe(
      "PROJ-42",
    );
    expect(extractTaskId({ title: "Bug fix", body: "Task: MYAPP-999" })).toBe(
      "MYAPP-999",
    );
  });

  it("extracts task ID from body when not in title", () => {
    expect(
      extractTaskId({ title: "Feature update", body: "Implements [DEV-100]" }),
    ).toBe("DEV-100");
  });

  it("returns null when no task ID found", () => {
    expect(
      extractTaskId({ title: "Fix bug", body: "Some description" }),
    ).toBeNull();
    expect(extractTaskId({ title: "Update readme", body: null })).toBeNull();
    expect(extractTaskId({ title: "No ID here", body: "" })).toBeNull();
  });

  it("handles undefined body", () => {
    expect(extractTaskId({ title: "[ABC-123] Feature", body: undefined })).toBe(
      "ABC-123",
    );
  });

  it("prefers first match when multiple patterns present", () => {
    // Task: format checked before bracket format
    expect(extractTaskId({ title: "[DEV-2]", body: "Task: ABC-123" })).toBe(
      "ABC-123",
    );
  });
});

describe("getWorkflowId", () => {
  it("generates workflow ID with approval- prefix", () => {
    expect(getWorkflowId("ABC-123")).toBe("approval-ABC-123");
  });

  it("preserves task ID case", () => {
    expect(getWorkflowId("DEV-42")).toBe("approval-DEV-42");
  });
});

describe("handlePRReviewEvent", () => {
  const mockApprovalSignal = vi.mocked(temporalClient.sendApprovalSignal);
  const mockChangesSignal = vi.mocked(
    temporalClient.sendChangesRequestedSignal,
  );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createBaseEvent = (
    overrides: Partial<PRReviewEvent> = {},
  ): PRReviewEvent => ({
    action: "submitted",
    review: {
      id: 1,
      user: { login: "reviewer" },
      body: "LGTM",
      state: "approved",
    },
    pull_request: {
      number: 42,
      title: "[ABC-123] Fix bug",
      body: null,
    },
    repository: {
      name: "repo",
      owner: { login: "owner" },
    },
    ...overrides,
  });

  describe("approval flow", () => {
    it("sends approval signal for approved review", async () => {
      const event = createBaseEvent();

      const result = await handlePRReviewEvent(event);

      expect(result.action).toBe("approved");
      expect(result.workflowId).toBe("approval-ABC-123");
      expect(mockApprovalSignal).toHaveBeenCalledWith("approval-ABC-123", {
        approved: true,
        reviewer: "reviewer",
        comment: "LGTM",
      });
    });

    it("sends approval signal without comment when review body is null", async () => {
      const event = createBaseEvent({
        review: {
          id: 1,
          user: { login: "reviewer" },
          body: null,
          state: "approved",
        },
      });

      await handlePRReviewEvent(event);

      expect(mockApprovalSignal).toHaveBeenCalledWith("approval-ABC-123", {
        approved: true,
        reviewer: "reviewer",
      });
    });
  });

  describe("changes requested flow", () => {
    it("sends changes-requested signal for changes_requested review", async () => {
      const event = createBaseEvent({
        review: {
          id: 1,
          user: { login: "reviewer" },
          body: "Please fix the tests",
          state: "changes_requested",
        },
      });

      const result = await handlePRReviewEvent(event);

      expect(result.action).toBe("changes_requested");
      expect(result.workflowId).toBe("approval-ABC-123");
      expect(mockChangesSignal).toHaveBeenCalledWith("approval-ABC-123", {
        reviewer: "reviewer",
        feedback: "Please fix the tests",
      });
    });

    it("uses default feedback message when body is null", async () => {
      const event = createBaseEvent({
        review: {
          id: 1,
          user: { login: "reviewer" },
          body: null,
          state: "changes_requested",
        },
      });

      await handlePRReviewEvent(event);

      expect(mockChangesSignal).toHaveBeenCalledWith("approval-ABC-123", {
        reviewer: "reviewer",
        feedback: "Changes requested (no details provided)",
      });
    });
  });

  describe("ignored events", () => {
    it('ignores "edited" action', async () => {
      const event = createBaseEvent({ action: "edited" });

      const result = await handlePRReviewEvent(event);

      expect(result.action).toBe("ignored");
      expect(mockApprovalSignal).not.toHaveBeenCalled();
      expect(mockChangesSignal).not.toHaveBeenCalled();
    });

    it('ignores "dismissed" action', async () => {
      const event = createBaseEvent({ action: "dismissed" });

      const result = await handlePRReviewEvent(event);

      expect(result.action).toBe("ignored");
    });

    it('ignores "commented" review state', async () => {
      const event = createBaseEvent({
        review: {
          id: 1,
          user: { login: "reviewer" },
          body: "Just a comment",
          state: "commented",
        },
      });

      const result = await handlePRReviewEvent(event);

      expect(result.action).toBe("ignored");
    });

    it('ignores "dismissed" review state', async () => {
      const event = createBaseEvent({
        review: {
          id: 1,
          user: { login: "reviewer" },
          body: null,
          state: "dismissed",
        },
      });

      const result = await handlePRReviewEvent(event);

      expect(result.action).toBe("ignored");
    });
  });

  describe("missing task ID", () => {
    it("returns no_task_id when task ID not found", async () => {
      const event = createBaseEvent({
        pull_request: {
          number: 42,
          title: "No task ID here",
          body: "Just some changes",
        },
      });

      const result = await handlePRReviewEvent(event);

      expect(result.action).toBe("no_task_id");
      expect(mockApprovalSignal).not.toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("returns error when signal fails", async () => {
      mockApprovalSignal.mockRejectedValueOnce(new Error("Workflow not found"));

      const event = createBaseEvent();

      const result = await handlePRReviewEvent(event);

      expect(result.action).toBe("error");
      expect(result.workflowId).toBe("approval-ABC-123");
      expect(result.error).toBe("Workflow not found");
    });

    it("handles non-Error exceptions", async () => {
      mockApprovalSignal.mockRejectedValueOnce("String error");

      const event = createBaseEvent();

      const result = await handlePRReviewEvent(event);

      expect(result.action).toBe("error");
      expect(result.error).toBe("String error");
    });
  });
});
