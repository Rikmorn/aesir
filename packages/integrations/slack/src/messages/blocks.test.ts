/**
 * Block Kit Builder Tests
 *
 * Tests for Slack Block Kit message building functions.
 * Validates block structure, button presence, and fallback text.
 */

import { describe, expect, it } from "vitest";
import {
  buildApprovalBlocks,
  buildProgressBlocks,
  buildSimpleMessage,
  buildStatusBlocks,
  getFallbackText,
} from "./blocks.js";

describe("buildApprovalBlocks", () => {
  it("builds blocks with title and summary", () => {
    const blocks = buildApprovalBlocks({
      taskId: "ABC-123",
      prUrl: "https://github.com/org/repo/pull/42",
      title: "Add new feature",
      summary: "This PR adds authentication to the API",
    });

    // First section has title
    expect(blocks[0]).toMatchObject({
      type: "section",
      text: {
        type: "mrkdwn",
        text: expect.stringContaining("Add new feature"),
      },
    });

    // Second section has summary
    expect(blocks[1]).toMatchObject({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "This PR adds authentication to the API",
      },
    });
  });

  it("includes PR link", () => {
    const blocks = buildApprovalBlocks({
      taskId: "ABC-123",
      prUrl: "https://github.com/org/repo/pull/42",
      title: "Test PR",
      summary: "Test summary",
    });

    // Third section has PR link
    expect(blocks[2]).toMatchObject({
      type: "section",
      text: {
        type: "mrkdwn",
        text: expect.stringContaining(
          "https://github.com/org/repo/pull/42|View Pull Request",
        ),
      },
    });
  });

  it("has approve and reject buttons", () => {
    const blocks = buildApprovalBlocks({
      taskId: "ABC-123",
      prUrl: "https://github.com/org/repo/pull/42",
      title: "Test PR",
      summary: "Test summary",
    });

    // Fourth block is actions with buttons
    const actionsBlock = blocks[3];
    expect(actionsBlock).toMatchObject({
      type: "actions",
    });

    // biome-ignore lint/suspicious/noExplicitAny: Test verification
    const elements = (actionsBlock as any).elements;
    expect(elements).toHaveLength(2);

    // Approve button
    expect(elements[0]).toMatchObject({
      type: "button",
      text: { type: "plain_text", text: "Approve" },
      style: "primary",
      action_id: "approve_pr",
    });

    // Reject button
    expect(elements[1]).toMatchObject({
      type: "button",
      text: { type: "plain_text", text: "Reject" },
      style: "danger",
      action_id: "reject_pr",
    });
  });

  it("includes task ID in button values", () => {
    const blocks = buildApprovalBlocks({
      taskId: "XYZ-999",
      prUrl: "https://github.com/org/repo/pull/1",
      title: "Test",
      summary: "Summary",
    });

    // biome-ignore lint/suspicious/noExplicitAny: Test verification
    const actionsBlock = blocks[3] as any;
    expect(actionsBlock.elements[0].value).toBe("XYZ-999");
    expect(actionsBlock.elements[1].value).toBe("XYZ-999");
  });

  it("uses custom action prefix", () => {
    const blocks = buildApprovalBlocks({
      taskId: "ABC-123",
      prUrl: "https://github.com/org/repo/pull/42",
      title: "Test PR",
      summary: "Test summary",
      actionPrefix: "review",
    });

    // biome-ignore lint/suspicious/noExplicitAny: Test verification
    const actionsBlock = blocks[3] as any;
    expect(actionsBlock.block_id).toBe("review_ABC-123");
    expect(actionsBlock.elements[0].action_id).toBe("review_pr");
  });

  it("includes context with task ID", () => {
    const blocks = buildApprovalBlocks({
      taskId: "ABC-123",
      prUrl: "https://github.com/org/repo/pull/42",
      title: "Test PR",
      summary: "Test summary",
    });

    // Fifth block is context
    expect(blocks[4]).toMatchObject({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: expect.stringContaining("ABC-123"),
        },
      ],
    });
  });

  it("omits PR link section when prUrl is not provided", () => {
    const blocks = buildApprovalBlocks({
      taskId: "ABC-123",
      title: "Plan approval: Add auth",
      summary: "Proposed plan for implementing authentication",
    });

    // Without prUrl: title, summary, actions, context (4 blocks, no PR link)
    expect(blocks).toHaveLength(4);
    expect(blocks[0]).toMatchObject({
      type: "section",
      text: { text: "*Plan approval: Add auth*" },
    });
    expect(blocks[1]).toMatchObject({
      type: "section",
      text: { text: "Proposed plan for implementing authentication" },
    });
    expect(blocks[2]).toMatchObject({ type: "actions" });
    expect(blocks[3]).toMatchObject({ type: "context" });
  });
});

describe("buildStatusBlocks", () => {
  it("builds blocks for started status", () => {
    const blocks = buildStatusBlocks({
      taskId: "ABC-123",
      status: "started",
    });

    expect(blocks[0]).toMatchObject({
      type: "section",
      text: {
        type: "mrkdwn",
        text: expect.stringContaining("Task Started"),
      },
    });

    // Check for started emoji
    // biome-ignore lint/suspicious/noExplicitAny: Test verification
    expect((blocks[0] as any).text.text).toContain(":arrow_forward:");
    // biome-ignore lint/suspicious/noExplicitAny: Test verification
    expect((blocks[0] as any).text.text).toContain("ABC-123");
  });

  it("builds blocks for completed status", () => {
    const blocks = buildStatusBlocks({
      taskId: "ABC-123",
      status: "completed",
    });

    expect(blocks[0]).toMatchObject({
      type: "section",
      text: {
        type: "mrkdwn",
        text: expect.stringContaining("Task Completed"),
      },
    });

    // Check for completed emoji
    // biome-ignore lint/suspicious/noExplicitAny: Test verification
    expect((blocks[0] as any).text.text).toContain(":white_check_mark:");
  });

  it("builds blocks for failed status", () => {
    const blocks = buildStatusBlocks({
      taskId: "ABC-123",
      status: "failed",
    });

    expect(blocks[0]).toMatchObject({
      type: "section",
      text: {
        type: "mrkdwn",
        text: expect.stringContaining("Task Failed"),
      },
    });

    // Check for failed emoji
    // biome-ignore lint/suspicious/noExplicitAny: Test verification
    expect((blocks[0] as any).text.text).toContain(":x:");
  });

  it("includes details when provided", () => {
    const blocks = buildStatusBlocks({
      taskId: "ABC-123",
      status: "failed",
      details: "Connection timeout after 30 seconds",
    });

    expect(blocks).toHaveLength(2);
    expect(blocks[1]).toMatchObject({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "Connection timeout after 30 seconds",
        },
      ],
    });
  });

  it("omits context block when no details", () => {
    const blocks = buildStatusBlocks({
      taskId: "ABC-123",
      status: "completed",
    });

    expect(blocks).toHaveLength(1);
  });
});

describe("buildSimpleMessage", () => {
  it("creates single section block", () => {
    const blocks = buildSimpleMessage("Hello, world!");

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "Hello, world!",
      },
    });
  });

  it("supports mrkdwn formatting", () => {
    const blocks = buildSimpleMessage("*Bold* and _italic_ and `code`");

    expect(blocks[0]).toMatchObject({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*Bold* and _italic_ and `code`",
      },
    });
  });

  it("handles empty string", () => {
    const blocks = buildSimpleMessage("");

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "",
      },
    });
  });
});

describe("buildProgressBlocks", () => {
  it("builds blocks with title only", () => {
    const blocks = buildProgressBlocks({
      title: "Processing Request",
    });

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      type: "header",
      text: {
        type: "plain_text",
        text: "Processing Request",
      },
    });
  });

  it("includes description when provided", () => {
    const blocks = buildProgressBlocks({
      title: "Building Feature",
      description: "Creating the authentication module",
    });

    expect(blocks).toHaveLength(2);
    expect(blocks[1]).toMatchObject({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "Creating the authentication module",
      },
    });
  });

  it("includes steps when provided", () => {
    const blocks = buildProgressBlocks({
      title: "Deployment",
      steps: ["Build image", "Push to registry", "Update deployment"],
    });

    expect(blocks).toHaveLength(2);
    expect(blocks[1]).toMatchObject({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "- Build image\n- Push to registry\n- Update deployment",
      },
    });
  });

  it("includes both description and steps", () => {
    const blocks = buildProgressBlocks({
      title: "CI/CD Pipeline",
      description: "Running automated tests and deployment",
      steps: ["Lint", "Test", "Build", "Deploy"],
    });

    expect(blocks).toHaveLength(3);

    // Description
    expect(blocks[1]).toMatchObject({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "Running automated tests and deployment",
      },
    });

    // Steps
    expect(blocks[2]).toMatchObject({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "- Lint\n- Test\n- Build\n- Deploy",
      },
    });
  });

  it("handles empty steps array", () => {
    const blocks = buildProgressBlocks({
      title: "Progress",
      steps: [],
    });

    expect(blocks).toHaveLength(1); // Only header, no steps section
  });
});

describe("getFallbackText", () => {
  it("returns approval fallback with title", () => {
    const text = getFallbackText(
      "approval_needed",
      "ABC-123",
      "Add authentication feature",
    );

    expect(text).toBe("Approval needed: Add authentication feature");
  });

  it("returns status fallback for started", () => {
    const text = getFallbackText(
      "status_update",
      "ABC-123",
      undefined,
      "started",
    );

    expect(text).toBe("Task ABC-123 started");
  });

  it("returns status fallback for completed", () => {
    const text = getFallbackText(
      "status_update",
      "XYZ-999",
      undefined,
      "completed",
    );

    expect(text).toBe("Task XYZ-999 completed");
  });

  it("returns status fallback for failed", () => {
    const text = getFallbackText(
      "status_update",
      "DEF-456",
      undefined,
      "failed",
    );

    expect(text).toBe("Task DEF-456 failed");
  });

  it("returns generic fallback when missing data", () => {
    const text = getFallbackText("approval_needed", "ABC-123");

    expect(text).toBe("Task ABC-123 update");
  });

  it("returns generic fallback for status without status value", () => {
    const text = getFallbackText("status_update", "ABC-123");

    expect(text).toBe("Task ABC-123 update");
  });
});
