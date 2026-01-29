/**
 * GitHub Webhook Parser Tests
 *
 * Tests for Zod validation of GitHub webhook payloads.
 * Validates PR review payload parsing with proper error handling.
 */

import { describe, expect, it } from "vitest";
import { parsePRReviewPayload } from "./parser.js";

describe("parsePRReviewPayload", () => {
  it("successfully parses valid PR review payload with approved state", () => {
    const rawBody = JSON.stringify({
      action: "submitted",
      review: {
        id: 123456,
        user: {
          login: "octocat",
        },
        body: "Looks good to me!",
        state: "approved",
        submitted_at: "2024-01-15T10:30:00Z",
      },
      pull_request: {
        number: 42,
        title: "Add new feature",
        body: "This PR adds a new feature",
        html_url: "https://github.com/test-org/test-repo/pull/42",
      },
      repository: {
        name: "test-repo",
        full_name: "test-org/test-repo",
        owner: {
          login: "test-org",
        },
      },
    });

    const result = parsePRReviewPayload(rawBody);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.action).toBe("submitted");
      expect(result.data.review.id).toBe(123456);
      expect(result.data.review.state).toBe("approved");
      expect(result.data.pull_request.number).toBe(42);
      expect(result.data.repository.name).toBe("test-repo");
    }
  });

  it("successfully parses valid payload with changes_requested state", () => {
    const rawBody = JSON.stringify({
      action: "submitted",
      review: {
        id: 789,
        user: {
          login: "reviewer",
        },
        body: "Please fix the tests",
        state: "changes_requested",
        submitted_at: "2024-01-15T11:00:00Z",
      },
      pull_request: {
        number: 10,
        title: "Fix bug",
        body: null,
        html_url: "https://github.com/my-org/my-repo/pull/10",
      },
      repository: {
        name: "my-repo",
        full_name: "my-org/my-repo",
        owner: {
          login: "my-org",
        },
      },
    });

    const result = parsePRReviewPayload(rawBody);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.review.state).toBe("changes_requested");
      expect(result.data.pull_request.body).toBeNull();
    }
  });

  it("successfully parses payload with commented state", () => {
    const rawBody = JSON.stringify({
      action: "submitted",
      review: {
        id: 999,
        user: {
          login: "commenter",
        },
        body: "Just a comment",
        state: "commented",
        submitted_at: "2024-01-15T12:00:00Z",
      },
      pull_request: {
        number: 5,
        title: "Update docs",
        body: "Documentation updates",
        html_url: "https://github.com/docs-org/docs-repo/pull/5",
      },
      repository: {
        name: "docs-repo",
        full_name: "docs-org/docs-repo",
        owner: {
          login: "docs-org",
        },
      },
    });

    const result = parsePRReviewPayload(rawBody);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.review.state).toBe("commented");
    }
  });

  it("returns error for invalid JSON", () => {
    const rawBody = "not valid json {";

    const result = parsePRReviewPayload(rawBody);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("Invalid JSON");
    }
  });

  it("returns error for missing required fields", () => {
    const rawBody = JSON.stringify({
      action: "submitted",
      review: {
        id: 123,
        user: {
          login: "octocat",
        },
        body: "LGTM",
        state: "approved",
        submitted_at: "2024-01-15T10:00:00Z",
      },
      // Missing pull_request field
      repository: {
        name: "test-repo",
        full_name: "test-org/test-repo",
        owner: {
          login: "test-org",
        },
      },
    });

    const result = parsePRReviewPayload(rawBody);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThan(0);
      expect(
        result.error.issues.some((issue) =>
          issue.path.includes("pull_request"),
        ),
      ).toBe(true);
    }
  });

  it("returns error for invalid action enum value", () => {
    const rawBody = JSON.stringify({
      action: "invalid_action",
      review: {
        id: 123,
        user: {
          login: "octocat",
        },
        body: "LGTM",
        state: "approved",
        submitted_at: "2024-01-15T10:00:00Z",
      },
      pull_request: {
        number: 42,
        title: "Test PR",
        body: null,
        html_url: "https://github.com/test-org/test-repo/pull/42",
      },
      repository: {
        name: "test-repo",
        full_name: "test-org/test-repo",
        owner: {
          login: "test-org",
        },
      },
    });

    const result = parsePRReviewPayload(rawBody);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) => issue.path.includes("action")),
      ).toBe(true);
    }
  });

  it("returns error for invalid review state enum value", () => {
    const rawBody = JSON.stringify({
      action: "submitted",
      review: {
        id: 123,
        user: {
          login: "octocat",
        },
        body: "LGTM",
        state: "invalid_state",
        submitted_at: "2024-01-15T10:00:00Z",
      },
      pull_request: {
        number: 42,
        title: "Test PR",
        body: null,
        html_url: "https://github.com/test-org/test-repo/pull/42",
      },
      repository: {
        name: "test-repo",
        full_name: "test-org/test-repo",
        owner: {
          login: "test-org",
        },
      },
    });

    const result = parsePRReviewPayload(rawBody);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) => {
          return issue.path.includes("review") && issue.path.includes("state");
        }),
      ).toBe(true);
    }
  });

  it("parses payload with null review body", () => {
    const rawBody = JSON.stringify({
      action: "submitted",
      review: {
        id: 456,
        user: {
          login: "octocat",
        },
        body: null,
        state: "approved",
        submitted_at: "2024-01-15T10:00:00Z",
      },
      pull_request: {
        number: 42,
        title: "Test PR",
        body: "PR body",
        html_url: "https://github.com/test-org/test-repo/pull/42",
      },
      repository: {
        name: "test-repo",
        full_name: "test-org/test-repo",
        owner: {
          login: "test-org",
        },
      },
    });

    const result = parsePRReviewPayload(rawBody);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.review.body).toBeNull();
    }
  });

  it("parses payload with dismissed action", () => {
    const rawBody = JSON.stringify({
      action: "dismissed",
      review: {
        id: 789,
        user: {
          login: "octocat",
        },
        body: "Dismissed review",
        state: "dismissed",
        submitted_at: "2024-01-15T10:00:00Z",
      },
      pull_request: {
        number: 42,
        title: "Test PR",
        body: null,
        html_url: "https://github.com/test-org/test-repo/pull/42",
      },
      repository: {
        name: "test-repo",
        full_name: "test-org/test-repo",
        owner: {
          login: "test-org",
        },
      },
    });

    const result = parsePRReviewPayload(rawBody);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.action).toBe("dismissed");
      expect(result.data.review.state).toBe("dismissed");
    }
  });
});
