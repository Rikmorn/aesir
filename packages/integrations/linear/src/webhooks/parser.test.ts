/**
 * Webhook Parser Tests
 *
 * Tests for Zod validation of Linear webhook payloads and type guards.
 * Validates AgentSession payload parsing and event type detection.
 */

import { describe, expect, it } from "vitest";
import {
  isAgentSessionEvent,
  isIssueEvent,
  parseAgentSessionPayload,
} from "./parser.js";
import type { WebhookPayloadBase } from "./types.js";

describe("parseAgentSessionPayload", () => {
  it("successfully parses valid AgentSession payload", () => {
    const rawBody = JSON.stringify({
      type: "AgentSessionEvent",
      action: "created",
      agentSession: {
        id: "session-123",
        issueId: "issue-456",
        status: "pending",
        url: "https://linear.app/test",
      },
      webhookTimestamp: 1234567890,
      webhookId: "webhook-abc",
      data: {},
    });

    const result = parseAgentSessionPayload(rawBody);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("AgentSessionEvent");
      expect(result.data.action).toBe("created");
      expect(result.data.agentSession.id).toBe("session-123");
      expect(result.data.agentSession.issueId).toBe("issue-456");
    }
  });

  it("returns error for invalid payload", () => {
    const rawBody = JSON.stringify({
      type: "AgentSessionEvent",
      action: "invalid-action", // Invalid action
      agentSession: {
        id: "session-123",
        issueId: "issue-456",
        status: "pending",
        url: "https://linear.app/test",
      },
      webhookTimestamp: 1234567890,
      webhookId: "webhook-abc",
      data: {},
    });

    const result = parseAgentSessionPayload(rawBody);

    expect(result.success).toBe(false);
  });

  it("returns error for missing required fields", () => {
    const rawBody = JSON.stringify({
      type: "AgentSessionEvent",
      action: "created",
      // Missing agentSession field
      webhookTimestamp: 1234567890,
      webhookId: "webhook-abc",
      data: {},
    });

    const result = parseAgentSessionPayload(rawBody);

    expect(result.success).toBe(false);
  });
});

describe("type guards", () => {
  it("isAgentSessionEvent returns true for AgentSessionEvent type", () => {
    const payload: WebhookPayloadBase = {
      type: "AgentSessionEvent",
      data: {},
      webhookTimestamp: Date.now(),
      webhookId: "abc",
    };

    expect(isAgentSessionEvent(payload)).toBe(true);
  });

  it("isAgentSessionEvent returns false for other types", () => {
    const payload: WebhookPayloadBase = {
      type: "Issue",
      data: {},
      webhookTimestamp: Date.now(),
      webhookId: "abc",
    };

    expect(isAgentSessionEvent(payload)).toBe(false);
  });

  it("isIssueEvent returns true for Issue type", () => {
    const payload: WebhookPayloadBase = {
      type: "Issue",
      data: {},
      webhookTimestamp: Date.now(),
      webhookId: "abc",
    };

    expect(isIssueEvent(payload)).toBe(true);
  });
});
