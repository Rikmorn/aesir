import type { NormalizedEvent } from "@aesir/types";
import { describe, expect, it } from "vitest";
import { adaptGitHubEvent } from "./github.js";
import { IncomingEventSchema } from "./types.js";

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeEvent(overrides: Partial<NormalizedEvent>): NormalizedEvent {
  return {
    id: "evt_test456",
    type: "test.event.type",
    source: "github",
    timestamp: new Date().toISOString(),
    correlationId: "corr_test456",
    payload: {},
    ...overrides,
  } as NormalizedEvent;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("adaptGitHubEvent", () => {
  it("returns null for non-github source", () => {
    const event = makeEvent({
      source: "slack",
      type: "slack.app_mention.created",
    });
    expect(adaptGitHubEvent(event)).toBeNull();
  });

  it("returns null for unrecognized github event type (slow-path)", () => {
    const event = makeEvent({
      type: "github.pull_request.review_submitted",
    });
    expect(adaptGitHubEvent(event)).toBeNull();
  });

  // --- PR Merged ---

  describe("pull_request.merged", () => {
    it("produces pr_merged with extracted task ID from branch name", () => {
      const event = makeEvent({
        type: "github.pull_request.merged",
        payload: {
          branchName: "feature/ABC-123",
          prNumber: 42,
        },
      });

      const result = adaptGitHubEvent(event);

      expect(result).not.toBeNull();
      expect(result?.type).toBe("pr_merged");
      expect(result?.data).toEqual({ merged: true, prNumber: 42 });
      expect(result?.source).toBe("github:webhook");
      expect(result?.correlationKey).toBe("ABC-123");
      expect(result?.deduplicationId).toBe("corr_test456");
      expect(result?.message).toBe(
        "PR #42 (feature/ABC-123) was merged into main.",
      );

      expect(IncomingEventSchema.safeParse(result).success).toBe(true);
    });

    it("handles case-insensitive branch matching", () => {
      const event = makeEvent({
        type: "github.pull_request.merged",
        payload: {
          branchName: "feature/xyz-999",
          prNumber: 10,
        },
      });

      const result = adaptGitHubEvent(event);

      expect(result).not.toBeNull();
      expect(result?.correlationKey).toBe("xyz-999");
    });

    it("returns null when branch name does not match BRANCH_TASK_REGEX", () => {
      const event = makeEvent({
        type: "github.pull_request.merged",
        payload: {
          branchName: "fix/some-bugfix",
          prNumber: 55,
        },
      });

      const result = adaptGitHubEvent(event);
      expect(result).toBeNull();
    });

    it("returns null when branch name is missing", () => {
      const event = makeEvent({
        type: "github.pull_request.merged",
        payload: {
          prNumber: 55,
        },
      });

      const result = adaptGitHubEvent(event);
      expect(result).toBeNull();
    });
  });

  // --- PR Closed ---

  describe("pull_request.closed", () => {
    it("produces pr_closed with extracted task ID from branch name", () => {
      const event = makeEvent({
        type: "github.pull_request.closed",
        payload: {
          branchName: "feature/DEF-456",
          prNumber: 99,
        },
      });

      const result = adaptGitHubEvent(event);

      expect(result).not.toBeNull();
      expect(result?.type).toBe("pr_closed");
      expect(result?.data).toEqual({ merged: false, prNumber: 99 });
      expect(result?.source).toBe("github:webhook");
      expect(result?.correlationKey).toBe("DEF-456");
      expect(result?.deduplicationId).toBe("corr_test456");
      expect(result?.message).toBe(
        "PR #99 (feature/DEF-456) was closed without merging.",
      );

      expect(IncomingEventSchema.safeParse(result).success).toBe(true);
    });

    it("returns null when branch name does not match BRANCH_TASK_REGEX", () => {
      const event = makeEvent({
        type: "github.pull_request.closed",
        payload: {
          branchName: "main",
          prNumber: 77,
        },
      });

      const result = adaptGitHubEvent(event);
      expect(result).toBeNull();
    });
  });
});
