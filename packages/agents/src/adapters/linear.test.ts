import type { NormalizedEvent } from "@aesir/types";
import { describe, expect, it } from "vitest";
import { adaptLinearEvent } from "./linear.js";
import { IncomingEventSchema } from "./types.js";

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeEvent(overrides: Partial<NormalizedEvent>): NormalizedEvent {
  return {
    id: "evt_test789",
    type: "test.event.type",
    source: "linear",
    timestamp: new Date().toISOString(),
    correlationId: "corr_test789",
    payload: {},
    ...overrides,
  } as NormalizedEvent;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("adaptLinearEvent", () => {
  it("returns null for non-linear source", () => {
    const event = makeEvent({
      source: "slack",
      type: "slack.app_mention.created",
    });
    expect(adaptLinearEvent(event)).toBeNull();
  });

  it("returns null for unrecognized linear event type (slow-path)", () => {
    const event = makeEvent({ type: "linear.some_unknown.type" });
    expect(adaptLinearEvent(event)).toBeNull();
  });

  // --- Agent Session Created (Start Trigger) ---

  describe("agent_session.created", () => {
    it("preserves original dotted type for start-rule matching", () => {
      const event = makeEvent({
        type: "linear.agent_session.created",
        payload: { issueId: "PROJ-42" },
      });

      const result = adaptLinearEvent(event);

      expect(result).not.toBeNull();
      expect(result?.type).toBe("linear.agent_session.created");
      expect(result?.data).toEqual({ issueId: "PROJ-42" });
      expect(result?.source).toBe("linear:webhook");
      expect(result?.correlationKey).toBe("PROJ-42");
      expect(result?.deduplicationId).toBe("corr_test789");
      expect(result?.message).toBe(
        "New agent session created for issue PROJ-42",
      );

      expect(IncomingEventSchema.safeParse(result).success).toBe(true);
    });

    it("includes replyContext with channel linear and issueId", () => {
      const event = makeEvent({
        type: "linear.agent_session.created",
        payload: { issueId: "PROJ-42" },
      });

      const result = adaptLinearEvent(event);

      expect(result).not.toBeNull();
      expect(result?.replyContext).toEqual({
        channel: "linear",
        issueId: "PROJ-42",
      });
      expect(IncomingEventSchema.safeParse(result).success).toBe(true);
    });
  });

  // --- Issue Created (Ignore Event) ---

  describe("issue.created", () => {
    it("adapts with no correlationKey for IGNORE_EVENT_TYPES matching", () => {
      const event = makeEvent({
        type: "linear.issue.created",
        payload: { id: "issue_abc", title: "New issue" },
      });

      const result = adaptLinearEvent(event);

      expect(result).not.toBeNull();
      expect(result?.type).toBe("linear.issue.created");
      expect(result?.data).toEqual({ id: "issue_abc", title: "New issue" });
      expect(result?.source).toBe("linear:webhook");
      expect(result?.correlationKey).toBeUndefined();
      expect(result?.deduplicationId).toBe("corr_test789");

      expect(IncomingEventSchema.safeParse(result).success).toBe(true);
    });

    it("does NOT include replyContext (ignore event)", () => {
      const event = makeEvent({
        type: "linear.issue.created",
        payload: { id: "issue_abc", title: "New issue" },
      });

      const result = adaptLinearEvent(event);
      expect(result).not.toBeNull();
      expect(result?.replyContext).toBeUndefined();
    });
  });

  // --- Issue Updated (Ignore Event) ---

  describe("issue.updated", () => {
    it("adapts with no correlationKey for IGNORE_EVENT_TYPES matching", () => {
      const event = makeEvent({
        type: "linear.issue.updated",
        payload: { id: "issue_def", status: "In Progress" },
      });

      const result = adaptLinearEvent(event);

      expect(result).not.toBeNull();
      expect(result?.type).toBe("linear.issue.updated");
      expect(result?.data).toEqual({
        id: "issue_def",
        status: "In Progress",
      });
      expect(result?.source).toBe("linear:webhook");
      expect(result?.correlationKey).toBeUndefined();
      expect(result?.deduplicationId).toBe("corr_test789");

      expect(IncomingEventSchema.safeParse(result).success).toBe(true);
    });

    it("does NOT include replyContext (ignore event)", () => {
      const event = makeEvent({
        type: "linear.issue.updated",
        payload: { id: "issue_def", status: "In Progress" },
      });

      const result = adaptLinearEvent(event);
      expect(result).not.toBeNull();
      expect(result?.replyContext).toBeUndefined();
    });
  });

  // --- Comment Created ---

  describe("comment.created", () => {
    it('produces "issue_comment" with correlationKey = issueId', () => {
      const event = makeEvent({
        type: "linear.comment.created",
        payload: {
          body: "Looks good!",
          userId: "user_abc",
          issueId: "PROJ-99",
        },
      });

      const result = adaptLinearEvent(event);

      expect(result).not.toBeNull();
      expect(result?.type).toBe("issue_comment");
      expect(result?.data).toEqual({
        body: "Looks good!",
        userId: "user_abc",
        issueId: "PROJ-99",
      });
      expect(result?.source).toBe("linear:webhook");
      expect(result?.correlationKey).toBe("PROJ-99");
      expect(result?.deduplicationId).toBe("corr_test789");
      expect(result?.message).toBe("Looks good!");

      expect(IncomingEventSchema.safeParse(result).success).toBe(true);
    });

    it("includes replyContext with channel linear and issueId", () => {
      const event = makeEvent({
        type: "linear.comment.created",
        payload: {
          body: "Looks good!",
          userId: "user_abc",
          issueId: "PROJ-99",
        },
      });

      const result = adaptLinearEvent(event);

      expect(result).not.toBeNull();
      expect(result?.replyContext).toEqual({
        channel: "linear",
        issueId: "PROJ-99",
      });
    });
  });

  // --- Agent Session Prompted ---

  describe("agent_session.prompted", () => {
    it('produces "agent_prompt" with correlationKey = issueId', () => {
      const event = makeEvent({
        type: "linear.agent_session.prompted",
        payload: {
          issueId: "PROJ-55",
          prompt: "Please add error handling",
        },
      });

      const result = adaptLinearEvent(event);

      expect(result).not.toBeNull();
      expect(result?.type).toBe("agent_prompt");
      expect(result?.data).toEqual({
        issueId: "PROJ-55",
        prompt: "Please add error handling",
      });
      expect(result?.source).toBe("linear:webhook");
      expect(result?.correlationKey).toBe("PROJ-55");
      expect(result?.deduplicationId).toBe("corr_test789");
      expect(result?.message).toBe("Please add error handling");

      expect(IncomingEventSchema.safeParse(result).success).toBe(true);
    });

    it("falls back to body when prompt is absent", () => {
      const event = makeEvent({
        type: "linear.agent_session.prompted",
        payload: {
          issueId: "PROJ-77",
          body: "Fix the flaky test",
        },
      });

      const result = adaptLinearEvent(event);

      expect(result).not.toBeNull();
      expect(result?.type).toBe("agent_prompt");
      expect(result?.data.prompt).toBe("Fix the flaky test");
      expect(result?.message).toBe("Fix the flaky test");
    });
  });
});
