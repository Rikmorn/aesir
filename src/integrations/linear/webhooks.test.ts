/**
 * Webhook Verification Tests
 *
 * Tests for webhook signature verification, timestamp validation, and type guards.
 */

import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  verifyWebhookSignature,
  validateWebhookTimestamp,
  parseWebhookPayload,
  isAgentSessionEvent,
  isIssueEvent,
} from "./webhooks.js";
import type { WebhookPayload, WebhookPayloadBase, AgentSessionPayload } from "./types.js";

describe("verifyWebhookSignature", () => {
  const secret = "test-webhook-secret";
  const rawBody = '{"type":"Issue","action":"create","data":{}}';

  // Pre-compute the valid signature for testing
  const validSignature = createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  it("should return true for valid signature", () => {
    const result = verifyWebhookSignature(validSignature, rawBody, secret);
    expect(result).toBe(true);
  });

  it("should return false for wrong signature", () => {
    const wrongSignature = "0".repeat(64); // Invalid signature (all zeros)
    const result = verifyWebhookSignature(wrongSignature, rawBody, secret);
    expect(result).toBe(false);
  });

  it("should return false for tampered body", () => {
    const tamperedBody = '{"type":"Issue","action":"update","data":{}}';
    const result = verifyWebhookSignature(validSignature, tamperedBody, secret);
    expect(result).toBe(false);
  });

  it("should return false for wrong secret", () => {
    const result = verifyWebhookSignature(validSignature, rawBody, "wrong-secret");
    expect(result).toBe(false);
  });

  it("should return false for invalid hex signature", () => {
    const result = verifyWebhookSignature("not-hex", rawBody, secret);
    expect(result).toBe(false);
  });

  it("should return false for empty signature", () => {
    const result = verifyWebhookSignature("", rawBody, secret);
    expect(result).toBe(false);
  });

  it("should verify signature with different body content", () => {
    const differentBody = '{"type":"AgentSession","action":"created","data":{"id":"123"}}';
    const differentSignature = createHmac("sha256", secret)
      .update(differentBody)
      .digest("hex");

    const result = verifyWebhookSignature(differentSignature, differentBody, secret);
    expect(result).toBe(true);
  });
});

describe("validateWebhookTimestamp", () => {
  it("should accept recent timestamp", () => {
    const now = Date.now();
    const result = validateWebhookTimestamp(now);
    expect(result).toBe(true);
  });

  it("should accept timestamp within tolerance", () => {
    const thirtySecondsAgo = Date.now() - 30_000;
    const result = validateWebhookTimestamp(thirtySecondsAgo);
    expect(result).toBe(true);
  });

  it("should reject timestamp older than default tolerance", () => {
    const twoMinutesAgo = Date.now() - 120_000;
    const result = validateWebhookTimestamp(twoMinutesAgo);
    expect(result).toBe(false);
  });

  it("should reject timestamp in the future beyond tolerance", () => {
    const twoMinutesFromNow = Date.now() + 120_000;
    const result = validateWebhookTimestamp(twoMinutesFromNow);
    expect(result).toBe(false);
  });

  it("should use custom tolerance", () => {
    const thirtySecondsAgo = Date.now() - 30_000;
    // Should fail with 10 second tolerance
    const result = validateWebhookTimestamp(thirtySecondsAgo, 10_000);
    expect(result).toBe(false);
  });

  it("should accept timestamp at exactly the tolerance boundary", () => {
    const exactlyOneMinuteAgo = Date.now() - 60_000;
    const result = validateWebhookTimestamp(exactlyOneMinuteAgo, 60_000);
    expect(result).toBe(true);
  });
});

describe("parseWebhookPayload", () => {
  it("should parse valid JSON payload", () => {
    const rawBody = '{"type":"Issue","action":"create","data":{"id":"123"},"webhookTimestamp":1234567890,"webhookId":"abc"}';
    const result = parseWebhookPayload<WebhookPayload>(rawBody);

    expect(result.type).toBe("Issue");
    expect(result.action).toBe("create");
    expect(result.webhookTimestamp).toBe(1234567890);
    expect(result.webhookId).toBe("abc");
  });

  it("should parse AgentSessionEvent payload", () => {
    const rawBody = '{"type":"AgentSessionEvent","action":"created","agentSession":{"id":"session-123","issueId":"issue-456","status":"pending","url":"https://linear.app/test"},"webhookTimestamp":1234567890,"webhookId":"abc"}';
    const result = parseWebhookPayload<AgentSessionPayload>(rawBody);

    expect(result.type).toBe("AgentSessionEvent");
    expect(result.action).toBe("created");
    expect(result.agentSession.id).toBe("session-123");
    expect(result.agentSession.issueId).toBe("issue-456");
  });

  it("should throw for invalid JSON", () => {
    expect(() => parseWebhookPayload("not json")).toThrow();
  });
});

describe("isAgentSessionEvent", () => {
  it("should return true for AgentSessionEvent type", () => {
    const payload: WebhookPayloadBase = {
      type: "AgentSessionEvent",
      data: {},
      webhookTimestamp: Date.now(),
      webhookId: "abc",
    };

    expect(isAgentSessionEvent(payload)).toBe(true);
  });

  it("should return false for Issue type", () => {
    const payload: WebhookPayloadBase = {
      type: "Issue",
      data: {},
      webhookTimestamp: Date.now(),
      webhookId: "abc",
    };

    expect(isAgentSessionEvent(payload)).toBe(false);
  });

  it("should narrow type correctly for AgentSessionEvent", () => {
    // Use the actual Linear payload structure
    const payload = {
      type: "AgentSessionEvent",
      action: "created",
      agentSession: { id: "123", issueId: "456", status: "pending", url: "https://linear.app/test" },
      webhookTimestamp: Date.now(),
      webhookId: "abc",
      data: {},
    } as WebhookPayloadBase;

    if (isAgentSessionEvent(payload)) {
      // TypeScript should know payload is AgentSessionPayload here
      expect(payload.agentSession.id).toBe("123");
      expect(payload.agentSession.issueId).toBe("456");
    }
  });
});

describe("isIssueEvent", () => {
  it("should return true for Issue type", () => {
    const payload: WebhookPayloadBase = {
      type: "Issue",
      data: {},
      webhookTimestamp: Date.now(),
      webhookId: "abc",
    };

    expect(isIssueEvent(payload)).toBe(true);
  });

  it("should return false for AgentSessionEvent type", () => {
    const payload: WebhookPayloadBase = {
      type: "AgentSessionEvent",
      data: {},
      webhookTimestamp: Date.now(),
      webhookId: "abc",
    };

    expect(isIssueEvent(payload)).toBe(false);
  });

  it("should return false for other types", () => {
    const payload: WebhookPayloadBase = {
      type: "Comment",
      data: {},
      webhookTimestamp: Date.now(),
      webhookId: "abc",
    };

    expect(isIssueEvent(payload)).toBe(false);
  });
});
