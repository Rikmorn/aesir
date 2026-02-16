import type { NormalizedEvent } from "@aesir/types";
import { describe, expect, it, vi } from "vitest";
import { adaptSlackEvent } from "./slack.js";
import {
  type IncomingEvent,
  IncomingEventSchema,
  isAdapterIgnore,
} from "./types.js";

// Mock the config module for controlling echo.slackAppId
vi.mock("../shared/env/config.js", () => ({
  config: {
    echo: {
      slackAppId: "A123BOTAPP",
    },
  },
}));

/** Narrow adapter result to IncomingEvent for test assertions. */
function asIncoming(
  result: ReturnType<typeof adaptSlackEvent>,
): IncomingEvent | null {
  if (result === null || isAdapterIgnore(result)) return null;
  return result;
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeEvent(overrides: Partial<NormalizedEvent>): NormalizedEvent {
  return {
    id: "evt_test123",
    type: "test.event.type",
    source: "slack",
    timestamp: new Date().toISOString(),
    correlationId: "corr_test123",
    payload: {},
    ...overrides,
  } as NormalizedEvent;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("adaptSlackEvent", () => {
  it("returns null for non-slack source", () => {
    const event = makeEvent({
      source: "github",
      type: "github.pull_request.merged",
    });
    expect(adaptSlackEvent(event)).toBeNull();
  });

  it("returns null for unrecognized slack event type (slow-path)", () => {
    const event = makeEvent({ type: "slack.some_unknown.type" });
    expect(adaptSlackEvent(event)).toBeNull();
  });

  // --- Approval ---

  describe("block_actions.approved", () => {
    it("produces correct approval IncomingEvent", () => {
      const event = makeEvent({
        type: "slack.block_actions.approved",
        payload: { taskIdentifier: "ABC-123" },
      });

      const result = asIncoming(adaptSlackEvent(event));

      expect(result).not.toBeNull();
      expect(result?.type).toBe("approval");
      expect(result?.data).toEqual({ approved: true, source: "slack" });
      expect(result?.source).toBe("slack:webhook");
      expect(result?.correlationKey).toBe("ABC-123");
      expect(result?.deduplicationId).toBe("corr_test123");
      expect(result?.message).toBe("Plan approved via Slack button.");

      // Validate against Zod schema
      expect(IncomingEventSchema.safeParse(result).success).toBe(true);
    });

    it("omits replyContext when teamId/channel missing from payload", () => {
      const event = makeEvent({
        type: "slack.block_actions.approved",
        payload: { taskIdentifier: "ABC-123" },
      });

      const result = asIncoming(adaptSlackEvent(event));

      expect(result).not.toBeNull();
      expect(result?.replyContext).toBeUndefined();
    });

    it("includes replyContext when teamId and channel are present", () => {
      const event = makeEvent({
        type: "slack.block_actions.approved",
        payload: {
          taskIdentifier: "ABC-123",
          teamId: "T789",
          channel: "C123",
          threadTs: "1234567890.000000",
        },
      });

      const result = asIncoming(adaptSlackEvent(event));

      expect(result).not.toBeNull();
      expect(result?.replyContext).toEqual({
        channel: "slack",
        teamId: "T789",
        channelId: "C123",
        threadTs: "1234567890.000000",
      });
      expect(IncomingEventSchema.safeParse(result).success).toBe(true);
    });

    it("includes replyContext without threadTs when not in a thread", () => {
      const event = makeEvent({
        type: "slack.block_actions.approved",
        payload: {
          taskIdentifier: "ABC-123",
          teamId: "T789",
          channel: "C123",
        },
      });

      const result = asIncoming(adaptSlackEvent(event));

      expect(result).not.toBeNull();
      expect(result?.replyContext).toEqual({
        channel: "slack",
        teamId: "T789",
        channelId: "C123",
      });
    });
  });

  describe("block_actions.rejected", () => {
    it("produces correct rejection IncomingEvent with feedback", () => {
      const event = makeEvent({
        type: "slack.block_actions.rejected",
        payload: { taskIdentifier: "DEF-456" },
      });

      const result = asIncoming(adaptSlackEvent(event));

      expect(result).not.toBeNull();
      expect(result?.type).toBe("approval");
      expect(result?.data).toEqual({
        approved: false,
        feedback: "Rejected via Slack button",
        source: "slack",
      });
      expect(result?.source).toBe("slack:webhook");
      expect(result?.correlationKey).toBe("DEF-456");
      expect(result?.deduplicationId).toBe("corr_test123");
      expect(result?.message).toContain("Plan rejected via Slack button");
      expect(result?.message).toContain("Rejected via Slack button");

      expect(IncomingEventSchema.safeParse(result).success).toBe(true);
    });
  });

  // --- Escalation ---

  describe("block_actions.escalation_retry", () => {
    it("produces escalation_resolved with action: retry", () => {
      const event = makeEvent({
        type: "slack.block_actions.escalation_retry",
        payload: { taskIdentifier: "GHI-789" },
      });

      const result = asIncoming(adaptSlackEvent(event));

      expect(result).not.toBeNull();
      expect(result?.type).toBe("escalation_resolved");
      expect(result?.data).toEqual({ action: "retry" });
      expect(result?.source).toBe("slack:webhook");
      expect(result?.correlationKey).toBe("GHI-789");
      expect(result?.deduplicationId).toBe("corr_test123");
      expect(result?.message).toBe("Escalation resolved: retry.");

      expect(IncomingEventSchema.safeParse(result).success).toBe(true);
    });
  });

  describe("block_actions.escalation_abort", () => {
    it("produces escalation_resolved with action: abort", () => {
      const event = makeEvent({
        type: "slack.block_actions.escalation_abort",
        payload: { taskIdentifier: "JKL-012" },
      });

      const result = asIncoming(adaptSlackEvent(event));

      expect(result).not.toBeNull();
      expect(result?.type).toBe("escalation_resolved");
      expect(result?.data).toEqual({ action: "abort" });
      expect(result?.source).toBe("slack:webhook");
      expect(result?.correlationKey).toBe("JKL-012");
      expect(result?.deduplicationId).toBe("corr_test123");
      expect(result?.message).toBe("Escalation resolved: abort.");

      expect(IncomingEventSchema.safeParse(result).success).toBe(true);
    });
  });

  // --- App Mention (Start Trigger) ---

  describe("app_mention.created", () => {
    it("preserves original dotted type for start-rule matching", () => {
      const event = makeEvent({
        type: "slack.app_mention.created",
        payload: {
          channel: "C123",
          user: "U456",
          text: "Hey @aesir build this",
          ts: "1234567890.123456",
          threadTs: "1234567890.000000",
          teamId: "T789",
        },
      });

      const result = asIncoming(adaptSlackEvent(event));

      expect(result).not.toBeNull();
      expect(result?.type).toBe("slack.app_mention.created");
      expect(result?.data).toEqual({
        threadTs: "1234567890.000000",
        channelId: "C123",
        initialMessage: "Hey @aesir build this",
        userId: "U456",
        slackTeamId: "T789",
      });
      expect(result?.source).toBe("slack:webhook");
      expect(result?.correlationKey).toBe("1234567890.000000");
      expect(result?.message).toBe("Hey @aesir build this");

      expect(IncomingEventSchema.safeParse(result).success).toBe(true);
    });

    it("uses ts as correlationKey when threadTs is absent", () => {
      const event = makeEvent({
        type: "slack.app_mention.created",
        payload: {
          channel: "C123",
          user: "U456",
          text: "Hello",
          ts: "9999999999.999999",
          teamId: "T789",
        },
      });

      const result = asIncoming(adaptSlackEvent(event));

      expect(result).not.toBeNull();
      expect(result?.correlationKey).toBe("9999999999.999999");
      expect(result?.data.threadTs).toBe("9999999999.999999");
    });

    it("includes replyContext with teamId, channelId, and threadTs when all present", () => {
      const event = makeEvent({
        type: "slack.app_mention.created",
        payload: {
          channel: "C123",
          user: "U456",
          text: "Hey @aesir do the thing",
          ts: "1234567890.123456",
          threadTs: "1234567890.000000",
          teamId: "T789",
        },
      });

      const result = asIncoming(adaptSlackEvent(event));

      expect(result).not.toBeNull();
      expect(result?.replyContext).toEqual({
        channel: "slack",
        teamId: "T789",
        channelId: "C123",
        threadTs: "1234567890.000000",
      });
      expect(IncomingEventSchema.safeParse(result).success).toBe(true);
    });

    it("omits replyContext when teamId is missing from payload", () => {
      const event = makeEvent({
        type: "slack.app_mention.created",
        payload: {
          channel: "C123",
          user: "U456",
          text: "Hello",
          ts: "9999999999.999999",
        },
      });

      const result = asIncoming(adaptSlackEvent(event));

      expect(result).not.toBeNull();
      expect(result?.replyContext).toBeUndefined();
    });
  });

  // --- Message Created ---

  describe("message.created", () => {
    it('returns "thread_reply" with correlationKey = threadTs when threadTs exists', () => {
      const event = makeEvent({
        type: "slack.message.created",
        payload: {
          text: "Looks good, ship it!",
          user: "U456",
          channel: "C123",
          ts: "1234567890.123456",
          threadTs: "1234567890.000000",
        },
      });

      const result = asIncoming(adaptSlackEvent(event));

      expect(result).not.toBeNull();
      expect(result?.type).toBe("thread_reply");
      expect(result?.data).toEqual({
        text: "Looks good, ship it!",
        userId: "U456",
        channelId: "C123",
        threadTs: "1234567890.000000",
      });
      expect(result?.source).toBe("slack:webhook");
      expect(result?.correlationKey).toBe("1234567890.000000");
      expect(result?.deduplicationId).toBe("corr_test123");
      expect(result?.message).toBe("Looks good, ship it!");

      expect(IncomingEventSchema.safeParse(result).success).toBe(true);
    });

    it("includes replyContext with teamId, channelId, and threadTs for thread replies", () => {
      const event = makeEvent({
        type: "slack.message.created",
        payload: {
          text: "Looks good, ship it!",
          user: "U456",
          channel: "C123",
          ts: "1234567890.123456",
          threadTs: "1234567890.000000",
          teamId: "T789",
        },
      });

      const result = asIncoming(adaptSlackEvent(event));

      expect(result).not.toBeNull();
      expect(result?.replyContext).toEqual({
        channel: "slack",
        teamId: "T789",
        channelId: "C123",
        threadTs: "1234567890.000000",
      });
      expect(IncomingEventSchema.safeParse(result).success).toBe(true);
    });

    it("omits replyContext for thread replies when teamId is missing", () => {
      const event = makeEvent({
        type: "slack.message.created",
        payload: {
          text: "Looks good!",
          user: "U456",
          channel: "C123",
          ts: "1234567890.123456",
          threadTs: "1234567890.000000",
        },
      });

      const result = asIncoming(adaptSlackEvent(event));

      expect(result).not.toBeNull();
      expect(result?.replyContext).toBeUndefined();
    });

    it("returns AdapterIgnore for channel messages without threadTs (handled by app_mention)", () => {
      const event = makeEvent({
        type: "slack.message.created",
        payload: {
          text: "Hey team, new update!",
          user: "U789",
          channel: "C456",
          ts: "9999999999.999999",
        },
      });

      const result = adaptSlackEvent(event);

      expect(result).toEqual({
        action: "ignore",
        reason: expect.stringContaining("app_mention"),
      });
    });
  });

  // --- Actor Info (Echo Suppression) ---

  describe("actorInfo extraction", () => {
    it("sets actorInfo.isBot = true when apiAppId matches SLACK_APP_ID", () => {
      const event = makeEvent({
        type: "slack.app_mention.created",
        payload: {
          channel: "C123",
          user: "U456",
          text: "Hello",
          ts: "1234567890.123456",
          teamId: "T789",
          apiAppId: "A123BOTAPP",
        },
      });

      const result = asIncoming(adaptSlackEvent(event));

      expect(result).not.toBeNull();
      expect(result?.actorInfo).toEqual({
        isBot: true,
        identifier: "A123BOTAPP",
      });
      expect(IncomingEventSchema.safeParse(result).success).toBe(true);
    });

    it("sets actorInfo.isBot = false when apiAppId does not match", () => {
      const event = makeEvent({
        type: "slack.message.created",
        payload: {
          text: "Thread reply",
          user: "U456",
          channel: "C123",
          threadTs: "1234567890.000000",
          apiAppId: "A999OTHER",
        },
      });

      const result = asIncoming(adaptSlackEvent(event));

      expect(result).not.toBeNull();
      expect(result?.actorInfo).toEqual({
        isBot: false,
        identifier: "A999OTHER",
      });
    });

    it("leaves actorInfo undefined when apiAppId is absent", () => {
      const event = makeEvent({
        type: "slack.app_mention.created",
        payload: {
          channel: "C123",
          user: "U456",
          text: "Hello",
          ts: "1234567890.123456",
          teamId: "T789",
        },
      });

      const result = asIncoming(adaptSlackEvent(event));

      expect(result).not.toBeNull();
      expect(result?.actorInfo).toBeUndefined();
    });

    it("does not add actorInfo to block_actions events regardless of apiAppId", () => {
      const event = makeEvent({
        type: "slack.block_actions.approved",
        payload: {
          taskIdentifier: "ABC-123",
          apiAppId: "A123BOTAPP",
        },
      });

      const result = asIncoming(adaptSlackEvent(event));

      expect(result).not.toBeNull();
      expect(result?.actorInfo).toBeUndefined();
    });

    it("leaves actorInfo undefined when SLACK_APP_ID is not configured", async () => {
      // Temporarily override the mock to simulate missing config
      const configModule = await import("../shared/env/config.js");
      const originalAppId = configModule.config.echo.slackAppId;
      (
        configModule.config as { echo: { slackAppId: string | undefined } }
      ).echo.slackAppId = undefined;

      const event = makeEvent({
        type: "slack.app_mention.created",
        payload: {
          channel: "C123",
          user: "U456",
          text: "Hello",
          ts: "1234567890.123456",
          teamId: "T789",
          apiAppId: "A123BOTAPP",
        },
      });

      const result = asIncoming(adaptSlackEvent(event));

      expect(result).not.toBeNull();
      expect(result?.actorInfo).toBeUndefined();

      // Restore
      (
        configModule.config as { echo: { slackAppId: string | undefined } }
      ).echo.slackAppId = originalAppId;
    });
  });
});
