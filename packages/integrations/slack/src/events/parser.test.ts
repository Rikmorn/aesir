/**
 * Slack Event Parser Tests
 *
 * Tests for Zod validation of Slack event payloads.
 * Validates app_mention, message, and block_actions parsing with proper error handling.
 */

import { describe, expect, it } from "vitest";
import {
  normalizeEvent,
  parseActionEvent,
  parseMentionEvent,
  parseMessageEvent,
  parseSlackEvent,
} from "./parser.js";

describe("parseMentionEvent", () => {
  it("successfully parses valid app_mention event", () => {
    const payload = {
      type: "app_mention",
      event_id: "Ev123456",
      event_time: 1234567890,
      team_id: "T1234",
      user: "U1234",
      text: "<@U0BOT> hello",
      ts: "1234567890.123456",
      channel: "C1234",
    };

    const result = parseMentionEvent(payload);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("app_mention");
      expect(result.data.event_id).toBe("Ev123456");
      expect(result.data.user).toBe("U1234");
      expect(result.data.channel).toBe("C1234");
      expect(result.data.text).toBe("<@U0BOT> hello");
    }
  });

  it("parses app_mention with thread_ts", () => {
    const payload = {
      type: "app_mention",
      event_id: "Ev789",
      event_time: 1234567890,
      team_id: "T1234",
      user: "U1234",
      text: "<@U0BOT> reply in thread",
      ts: "1234567890.123456",
      channel: "C1234",
      thread_ts: "1234567880.111111",
    };

    const result = parseMentionEvent(payload);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.thread_ts).toBe("1234567880.111111");
    }
  });

  it("returns error for missing required fields", () => {
    const payload = {
      type: "app_mention",
      event_id: "Ev123456",
      event_time: 1234567890,
      team_id: "T1234",
      // Missing: user, text, ts, channel
    };

    const result = parseMentionEvent(payload);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThan(0);
    }
  });

  it("returns error for wrong type literal", () => {
    const payload = {
      type: "message", // Wrong type
      event_id: "Ev123456",
      event_time: 1234567890,
      team_id: "T1234",
      user: "U1234",
      text: "hello",
      ts: "1234567890.123456",
      channel: "C1234",
    };

    const result = parseMentionEvent(payload);

    expect(result.success).toBe(false);
  });
});

describe("parseMessageEvent", () => {
  it("successfully parses valid message event", () => {
    const payload = {
      type: "message",
      event_id: "Ev123456",
      event_time: 1234567890,
      team_id: "T1234",
      user: "U1234",
      text: "Hello world",
      ts: "1234567890.123456",
      channel: "C1234",
    };

    const result = parseMessageEvent(payload);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("message");
      expect(result.data.user).toBe("U1234");
      expect(result.data.text).toBe("Hello world");
    }
  });

  it("parses message with subtype", () => {
    const payload = {
      type: "message",
      event_id: "Ev123456",
      event_time: 1234567890,
      team_id: "T1234",
      subtype: "bot_message",
      text: "Bot message",
      ts: "1234567890.123456",
      channel: "C1234",
    };

    const result = parseMessageEvent(payload);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.subtype).toBe("bot_message");
      // user is optional for bot_message subtype
      expect(result.data.user).toBeUndefined();
    }
  });

  it("parses message with thread_ts", () => {
    const payload = {
      type: "message",
      event_id: "Ev123456",
      event_time: 1234567890,
      team_id: "T1234",
      user: "U1234",
      text: "Thread reply",
      ts: "1234567890.123456",
      channel: "C1234",
      thread_ts: "1234567880.111111",
    };

    const result = parseMessageEvent(payload);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.thread_ts).toBe("1234567880.111111");
    }
  });

  it("parses message with channel_type", () => {
    const payload = {
      type: "message",
      event_id: "Ev123456",
      event_time: 1234567890,
      team_id: "T1234",
      user: "U1234",
      text: "DM message",
      ts: "1234567890.123456",
      channel: "D1234",
      channel_type: "im",
    };

    const result = parseMessageEvent(payload);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.channel_type).toBe("im");
    }
  });

  it("returns error for missing text field", () => {
    const payload = {
      type: "message",
      event_id: "Ev123456",
      event_time: 1234567890,
      team_id: "T1234",
      user: "U1234",
      ts: "1234567890.123456",
      channel: "C1234",
      // Missing: text
    };

    const result = parseMessageEvent(payload);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("text"))).toBe(
        true,
      );
    }
  });
});

describe("parseActionEvent", () => {
  it("successfully parses valid block_actions event", () => {
    const payload = {
      type: "block_actions",
      user: { id: "U1234", name: "testuser" },
      channel: { id: "C1234", name: "general" },
      message: { ts: "1234567890.123456" },
      actions: [
        {
          type: "button",
          action_id: "approve_pr",
          block_id: "approval_block",
          value: "task_123",
        },
      ],
      team: { id: "T1234" },
    };

    const result = parseActionEvent(payload);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("block_actions");
      expect(result.data.user.id).toBe("U1234");
      expect(result.data.actions).toHaveLength(1);
      expect(result.data.actions[0]?.action_id).toBe("approve_pr");
      expect(result.data.actions[0]?.value).toBe("task_123");
    }
  });

  it("parses block_actions without message (ephemeral)", () => {
    const payload = {
      type: "block_actions",
      user: { id: "U1234" },
      channel: { id: "C1234" },
      actions: [
        {
          type: "button",
          action_id: "dismiss",
        },
      ],
    };

    const result = parseActionEvent(payload);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.message).toBeUndefined();
    }
  });

  it("parses block_actions with response_url and trigger_id", () => {
    const payload = {
      type: "block_actions",
      user: { id: "U1234" },
      channel: { id: "C1234" },
      actions: [{ type: "button", action_id: "test" }],
      response_url: "https://hooks.slack.com/actions/T1234/1234/xyz",
      trigger_id: "1234567890.1234",
    };

    const result = parseActionEvent(payload);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.response_url).toBe(
        "https://hooks.slack.com/actions/T1234/1234/xyz",
      );
      expect(result.data.trigger_id).toBe("1234567890.1234");
    }
  });

  it("returns error for missing actions array", () => {
    const payload = {
      type: "block_actions",
      user: { id: "U1234" },
      channel: { id: "C1234" },
      // Missing: actions
    };

    const result = parseActionEvent(payload);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("actions"))).toBe(
        true,
      );
    }
  });
});

describe("parseSlackEvent (discriminated union)", () => {
  it("parses app_mention correctly", () => {
    const payload = {
      type: "app_mention",
      event_id: "Ev123456",
      event_time: 1234567890,
      team_id: "T1234",
      user: "U1234",
      text: "<@U0BOT> hello",
      ts: "1234567890.123456",
      channel: "C1234",
    };

    const result = parseSlackEvent(payload);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("app_mention");
    }
  });

  it("parses message correctly", () => {
    const payload = {
      type: "message",
      event_id: "Ev123456",
      event_time: 1234567890,
      team_id: "T1234",
      user: "U1234",
      text: "Hello world",
      ts: "1234567890.123456",
      channel: "C1234",
    };

    const result = parseSlackEvent(payload);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("message");
    }
  });

  it("parses block_actions correctly", () => {
    const payload = {
      type: "block_actions",
      user: { id: "U1234" },
      channel: { id: "C1234" },
      actions: [{ type: "button", action_id: "test" }],
    };

    const result = parseSlackEvent(payload);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("block_actions");
    }
  });

  it("returns error for unsupported event type", () => {
    const payload = {
      type: "unknown_event",
      event_id: "Ev123456",
    };

    const result = parseSlackEvent(payload);

    expect(result.success).toBe(false);
  });
});

describe("normalizeEvent", () => {
  it("normalizes app_mention event", () => {
    const event = {
      type: "app_mention" as const,
      event_id: "Ev123456",
      event_time: 1234567890,
      team_id: "T1234",
      user: "U1234",
      text: "<@U0BOT> hello",
      ts: "1234567890.123456",
      channel: "C1234",
    };

    const result = normalizeEvent(event);

    expect(result.eventId).toBe("Ev123456");
    expect(result.eventType).toBe("app_mention");
    expect(result.teamId).toBe("T1234");
    expect(result.userId).toBe("U1234");
    expect(result.channel).toBe("C1234");
    expect(result.text).toBe("<@U0BOT> hello");
    expect(result.ts).toBe("1234567890.123456");
    expect(result.threadTs).toBeUndefined();
    expect(result.raw).toEqual(event);
  });

  it("normalizes app_mention with thread_ts", () => {
    const event = {
      type: "app_mention" as const,
      event_id: "Ev123456",
      event_time: 1234567890,
      team_id: "T1234",
      user: "U1234",
      text: "threaded mention",
      ts: "1234567890.123456",
      channel: "C1234",
      thread_ts: "1234567880.111111",
    };

    const result = normalizeEvent(event);

    expect(result.threadTs).toBe("1234567880.111111");
  });

  it("normalizes message event", () => {
    const event = {
      type: "message" as const,
      event_id: "Ev789",
      event_time: 1234567890,
      team_id: "T5678",
      user: "U5678",
      text: "Hello",
      ts: "1234567890.654321",
      channel: "C5678",
    };

    const result = normalizeEvent(event);

    expect(result.eventId).toBe("Ev789");
    expect(result.eventType).toBe("message");
    expect(result.teamId).toBe("T5678");
    expect(result.userId).toBe("U5678");
    expect(result.channel).toBe("C5678");
  });

  it("normalizes message without user (bot_message)", () => {
    const event = {
      type: "message" as const,
      event_id: "Ev789",
      event_time: 1234567890,
      team_id: "T5678",
      subtype: "bot_message",
      text: "Bot says hello",
      ts: "1234567890.654321",
      channel: "C5678",
    };

    const result = normalizeEvent(event);

    expect(result.userId).toBeUndefined();
  });

  it("normalizes block_actions event", () => {
    const event = {
      type: "block_actions" as const,
      user: { id: "U1234", name: "testuser" },
      channel: { id: "C1234", name: "general" },
      message: { ts: "1234567890.123456" },
      actions: [
        { type: "button", action_id: "approve_pr", value: "task_123" },
        { type: "button", action_id: "reject_pr", value: "task_123" },
      ],
      team: { id: "T1234" },
    };

    const result = normalizeEvent(event);

    // block_actions generates eventId from context
    expect(result.eventId).toBe(
      "block_actions:C1234:1234567890.123456:approve_pr,reject_pr",
    );
    expect(result.eventType).toBe("block_actions");
    expect(result.teamId).toBe("T1234");
    expect(result.userId).toBe("U1234");
    expect(result.channel).toBe("C1234");
    expect(result.ts).toBe("1234567890.123456");
    expect(result.actions).toHaveLength(2);
    expect(result.actions?.[0]?.actionId).toBe("approve_pr");
    expect(result.actions?.[0]?.value).toBe("task_123");
  });

  it("normalizes block_actions without message", () => {
    const event = {
      type: "block_actions" as const,
      user: { id: "U1234" },
      channel: { id: "C1234" },
      actions: [{ type: "button", action_id: "test" }],
    };

    const result = normalizeEvent(event);

    // Without message.ts, uses "no_message"
    expect(result.eventId).toBe("block_actions:C1234:no_message:test");
    expect(result.ts).toBe("");
  });

  it("normalizes block_actions without team", () => {
    const event = {
      type: "block_actions" as const,
      user: { id: "U1234" },
      channel: { id: "C1234" },
      actions: [{ type: "button", action_id: "test" }],
    };

    const result = normalizeEvent(event);

    expect(result.teamId).toBe("unknown");
  });
});
