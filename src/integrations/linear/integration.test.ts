/**
 * Linear Integration Test
 *
 * Demonstrates the complete webhook → activity flow with mocked client.
 * Tests that all components work together correctly.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import type { LinearClient } from "@linear/sdk";
import {
  verifyWebhookSignature,
  validateWebhookTimestamp,
  parseWebhookPayload,
  isAgentSessionEvent,
  emitThought,
  emitAction,
  emitResponse,
  updateSessionPlan,
} from "./index.js";
import type { WebhookPayloadBase, AgentPlanItem } from "./types.js";

// Mock LinearClient factory
function createMockClient() {
  return {
    createAgentActivity: vi.fn().mockResolvedValue(undefined),
    updateAgentSession: vi.fn().mockResolvedValue(undefined),
  } as unknown as LinearClient;
}

describe("Linear Integration - Complete Webhook to Activity Flow", () => {
  const webhookSecret = "test-webhook-secret-12345";
  let mockClient: LinearClient;

  beforeEach(() => {
    mockClient = createMockClient();
    vi.clearAllMocks();
  });

  it("should process AgentSession webhook and emit activities", async () => {
    // 1. Simulate incoming AgentSession webhook
    const sessionId = "session-abc123";
    const issueId = "issue-xyz789";
    const webhookPayload = {
      type: "AgentSession",
      action: "created",
      data: {
        id: sessionId,
        issueId: issueId,
        promptContext: "Implement the login feature as described in the issue.",
      },
      webhookTimestamp: Date.now(),
      webhookId: "webhook-001",
    };
    const rawBody = JSON.stringify(webhookPayload);

    // 2. Compute signature (simulating what Linear would send)
    const signature = createHmac("sha256", webhookSecret)
      .update(rawBody)
      .digest("hex");

    // 3. Verify signature (would reject unauthorized calls)
    const isValid = verifyWebhookSignature(signature, rawBody, webhookSecret);
    expect(isValid).toBe(true);

    // 4. Validate timestamp
    const isRecent = validateWebhookTimestamp(webhookPayload.webhookTimestamp);
    expect(isRecent).toBe(true);

    // 5. Parse payload only after verification
    const payload = parseWebhookPayload<WebhookPayloadBase>(rawBody);
    expect(payload.type).toBe("AgentSession");
    expect(payload.webhookId).toBe("webhook-001");

    // 6. Type guard to handle specific event types
    if (isAgentSessionEvent(payload)) {
      // TypeScript now knows this is AgentSessionPayload
      expect(payload.data.id).toBe(sessionId);
      expect(payload.data.issueId).toBe(issueId);
      expect(payload.data.promptContext).toContain("login feature");

      // 7. Emit activity using client (acknowledge immediately)
      await emitThought(mockClient, payload.data.id, "Analyzing task requirements...");

      expect(mockClient.createAgentActivity).toHaveBeenCalledWith({
        agentSessionId: sessionId,
        content: { type: "thought", body: "Analyzing task requirements..." },
      });

      // 8. Emit action for tool use
      await emitAction(mockClient, payload.data.id, "Reading", "linked issue description");

      expect(mockClient.createAgentActivity).toHaveBeenCalledTimes(2);
      expect(mockClient.createAgentActivity).toHaveBeenLastCalledWith({
        agentSessionId: sessionId,
        content: { type: "action", action: "Reading", parameter: "linked issue description" },
      });

      // 9. Update plan with progress
      const plan: AgentPlanItem[] = [
        { content: "Read task requirements", status: "completed" },
        { content: "Generate implementation", status: "inProgress" },
        { content: "Run tests", status: "pending" },
      ];
      await updateSessionPlan(mockClient, payload.data.id, plan);

      expect(mockClient.updateAgentSession).toHaveBeenCalledWith(sessionId, {
        plan,
      });

      // 10. Emit final response
      await emitResponse(mockClient, payload.data.id, "Login feature implemented. PR #42 created.");

      expect(mockClient.createAgentActivity).toHaveBeenCalledTimes(3);
    } else {
      // This branch shouldn't be reached
      expect.fail("Expected AgentSession event");
    }
  });

  it("should reject webhook with invalid signature", () => {
    const payload = {
      type: "AgentSession",
      action: "created",
      data: { id: "session-1", issueId: "issue-1" },
      webhookTimestamp: Date.now(),
      webhookId: "webhook-002",
    };
    const rawBody = JSON.stringify(payload);

    // Wrong signature
    const isValid = verifyWebhookSignature(
      "invalid-signature-0000000000000000000000000000000000000000000000000000000000000000",
      rawBody,
      webhookSecret
    );

    expect(isValid).toBe(false);
    // Should NOT proceed to parse or emit activities
  });

  it("should reject webhook with stale timestamp", () => {
    const twoMinutesAgo = Date.now() - 120_000;
    const payload = {
      type: "AgentSession",
      action: "created",
      data: { id: "session-1", issueId: "issue-1" },
      webhookTimestamp: twoMinutesAgo,
      webhookId: "webhook-003",
    };
    const rawBody = JSON.stringify(payload);

    // Valid signature
    const signature = createHmac("sha256", webhookSecret)
      .update(rawBody)
      .digest("hex");

    // Signature is valid
    expect(verifyWebhookSignature(signature, rawBody, webhookSecret)).toBe(true);

    // But timestamp is stale
    expect(validateWebhookTimestamp(payload.webhookTimestamp)).toBe(false);
    // Should NOT proceed to process the webhook
  });

  it("should correctly identify Issue events vs AgentSession events", () => {
    const issuePayload: WebhookPayloadBase = {
      type: "Issue",
      data: { id: "issue-1", title: "Test Issue" },
      webhookTimestamp: Date.now(),
      webhookId: "webhook-004",
    };

    const sessionPayload: WebhookPayloadBase = {
      type: "AgentSession",
      data: { id: "session-1", issueId: "issue-1" },
      webhookTimestamp: Date.now(),
      webhookId: "webhook-005",
    };

    // Issue event
    expect(isAgentSessionEvent(issuePayload)).toBe(false);

    // AgentSession event
    expect(isAgentSessionEvent(sessionPayload)).toBe(true);
  });

  it("should handle follow-up prompts (prompted action)", async () => {
    const sessionId = "session-follow-up";
    const payload = {
      type: "AgentSession",
      action: "prompted",
      data: {
        id: sessionId,
        issueId: "issue-123",
      },
      agentActivity: {
        body: "Can you also add unit tests for the login feature?",
      },
      webhookTimestamp: Date.now(),
      webhookId: "webhook-006",
    };
    const rawBody = JSON.stringify(payload);
    const signature = createHmac("sha256", webhookSecret)
      .update(rawBody)
      .digest("hex");

    // Verify and parse
    expect(verifyWebhookSignature(signature, rawBody, webhookSecret)).toBe(true);
    const parsed = parseWebhookPayload<typeof payload>(rawBody);

    // Check it's a follow-up prompt
    expect(parsed.action).toBe("prompted");
    expect(parsed.agentActivity?.body).toContain("unit tests");

    // Respond to the follow-up
    await emitThought(mockClient, sessionId, "Acknowledged. Adding unit tests...");
    expect(mockClient.createAgentActivity).toHaveBeenCalledWith({
      agentSessionId: sessionId,
      content: { type: "thought", body: "Acknowledged. Adding unit tests..." },
    });
  });
});

describe("Module Exports", () => {
  it("should export all required functions and types", async () => {
    const exports = await import("./index.js");

    // Client factory and helpers
    expect(typeof exports.createLinearClient).toBe("function");
    expect(typeof exports.getLinearClient).toBe("function");
    expect(typeof exports.refreshOAuthToken).toBe("function");
    expect(typeof exports.readIssue).toBe("function");
    expect(typeof exports.updateIssueStatus).toBe("function");

    // Webhook functions
    expect(typeof exports.verifyWebhookSignature).toBe("function");
    expect(typeof exports.validateWebhookTimestamp).toBe("function");
    expect(typeof exports.parseWebhookPayload).toBe("function");
    expect(typeof exports.isAgentSessionEvent).toBe("function");
    expect(typeof exports.isIssueEvent).toBe("function");

    // Activity emitters
    expect(typeof exports.emitThought).toBe("function");
    expect(typeof exports.emitAction).toBe("function");
    expect(typeof exports.emitResponse).toBe("function");
    expect(typeof exports.emitError).toBe("function");
    expect(typeof exports.emitElicitation).toBe("function");
    expect(typeof exports.updateSessionPlan).toBe("function");
  });
});
