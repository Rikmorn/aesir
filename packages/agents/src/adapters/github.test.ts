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
      type: "github.some_unknown.type",
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

    it("includes replyContext with owner, repo, prNumber when payload.repository present", () => {
      const event = makeEvent({
        type: "github.pull_request.merged",
        payload: {
          branchName: "feature/ABC-123",
          prNumber: 42,
          repository: { owner: "my-org", name: "my-repo" },
        },
      });

      const result = adaptGitHubEvent(event);

      expect(result).not.toBeNull();
      expect(result?.replyContext).toEqual({
        channel: "github",
        owner: "my-org",
        repo: "my-repo",
        prNumber: 42,
      });
      expect(IncomingEventSchema.safeParse(result).success).toBe(true);
    });

    it("omits replyContext when payload.repository is missing", () => {
      const event = makeEvent({
        type: "github.pull_request.merged",
        payload: {
          branchName: "feature/ABC-123",
          prNumber: 42,
        },
      });

      const result = adaptGitHubEvent(event);

      expect(result).not.toBeNull();
      expect(result?.replyContext).toBeUndefined();
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

    it("includes replyContext with owner, repo, prNumber when payload.repository present", () => {
      const event = makeEvent({
        type: "github.pull_request.closed",
        payload: {
          branchName: "feature/DEF-456",
          prNumber: 99,
          repository: { owner: "acme-corp", name: "backend" },
        },
      });

      const result = adaptGitHubEvent(event);

      expect(result).not.toBeNull();
      expect(result?.replyContext).toEqual({
        channel: "github",
        owner: "acme-corp",
        repo: "backend",
        prNumber: 99,
      });
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

  // --- PR Reviews ---

  describe("pull_request.review_submitted", () => {
    it('produces "pr_review" with no correlationKey', () => {
      const event = makeEvent({
        type: "github.pull_request.review_submitted",
        payload: {
          prNumber: 42,
          reviewState: "commented",
          reviewBody: "Needs a few changes",
          reviewerLogin: "reviewer1",
        },
      });

      const result = adaptGitHubEvent(event);

      expect(result).not.toBeNull();
      expect(result?.type).toBe("pr_review");
      expect(result?.data).toEqual({
        reviewState: "commented",
        reviewBody: "Needs a few changes",
        reviewerLogin: "reviewer1",
        prNumber: 42,
      });
      expect(result?.source).toBe("github:webhook");
      expect(result?.correlationKey).toBeUndefined();
      expect(result?.deduplicationId).toBe("corr_test456");
      expect(result?.message).toBe(
        "PR #42 review (commented): Needs a few changes",
      );

      expect(IncomingEventSchema.safeParse(result).success).toBe(true);
    });

    it("includes replyContext with owner and repo from payload.repository", () => {
      const event = makeEvent({
        type: "github.pull_request.review_submitted",
        payload: {
          prNumber: 42,
          reviewState: "commented",
          reviewBody: "Needs a few changes",
          reviewerLogin: "reviewer1",
          repository: { owner: "my-org", name: "my-repo" },
        },
      });

      const result = adaptGitHubEvent(event);

      expect(result).not.toBeNull();
      expect(result?.replyContext).toEqual({
        channel: "github",
        owner: "my-org",
        repo: "my-repo",
        prNumber: 42,
      });
      expect(IncomingEventSchema.safeParse(result).success).toBe(true);
    });

    it("omits replyContext when payload.repository is missing", () => {
      const event = makeEvent({
        type: "github.pull_request.review_submitted",
        payload: {
          prNumber: 42,
          reviewState: "commented",
          reviewBody: "Needs a few changes",
          reviewerLogin: "reviewer1",
        },
      });

      const result = adaptGitHubEvent(event);

      expect(result).not.toBeNull();
      expect(result?.replyContext).toBeUndefined();
    });
  });

  describe("pull_request.review_approved", () => {
    it('produces "pr_review" with approved state', () => {
      const event = makeEvent({
        type: "github.pull_request.review_approved",
        payload: {
          prNumber: 50,
          reviewState: "approved",
          reviewBody: "LGTM!",
          reviewerLogin: "lead-dev",
        },
      });

      const result = adaptGitHubEvent(event);

      expect(result).not.toBeNull();
      expect(result?.type).toBe("pr_review");
      expect(result?.data.reviewState).toBe("approved");
      expect(result?.data.prNumber).toBe(50);
      expect(result?.message).toBe("PR #50 review (approved): LGTM!");

      expect(IncomingEventSchema.safeParse(result).success).toBe(true);
    });
  });

  describe("pull_request.review_changes_requested", () => {
    it('produces "pr_review" with changes_requested state', () => {
      const event = makeEvent({
        type: "github.pull_request.review_changes_requested",
        payload: {
          prNumber: 60,
          reviewState: "changes_requested",
          reviewBody: "Please fix the types",
          reviewerLogin: "senior-dev",
        },
      });

      const result = adaptGitHubEvent(event);

      expect(result).not.toBeNull();
      expect(result?.type).toBe("pr_review");
      expect(result?.data.reviewState).toBe("changes_requested");
      expect(result?.data.prNumber).toBe(60);
      expect(result?.message).toBe(
        "PR #60 review (changes_requested): Please fix the types",
      );

      expect(IncomingEventSchema.safeParse(result).success).toBe(true);
    });
  });

  describe("pull_request.review_commented", () => {
    it('produces "pr_review" with commented state', () => {
      const event = makeEvent({
        type: "github.pull_request.review_commented",
        payload: {
          prNumber: 70,
          reviewState: "commented",
          reviewBody: "",
          reviewerLogin: "contributor",
        },
      });

      const result = adaptGitHubEvent(event);

      expect(result).not.toBeNull();
      expect(result?.type).toBe("pr_review");
      expect(result?.data.reviewState).toBe("commented");
      expect(result?.data.prNumber).toBe(70);
      expect(result?.message).toBe("PR #70 review (commented): (no comment)");

      expect(IncomingEventSchema.safeParse(result).success).toBe(true);
    });
  });

  describe("pull_request.review_dismissed", () => {
    it('produces "pr_review" with dismissed state', () => {
      const event = makeEvent({
        type: "github.pull_request.review_dismissed",
        payload: {
          prNumber: 80,
          reviewState: "dismissed",
          reviewBody: "Stale review",
          reviewerLogin: "admin",
        },
      });

      const result = adaptGitHubEvent(event);

      expect(result).not.toBeNull();
      expect(result?.type).toBe("pr_review");
      expect(result?.data.reviewState).toBe("dismissed");
      expect(result?.data.prNumber).toBe(80);
      expect(result?.message).toBe("PR #80 review (dismissed): Stale review");

      expect(IncomingEventSchema.safeParse(result).success).toBe(true);
    });
  });
});
