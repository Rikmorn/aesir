/**
 * Linear Webhook Comment Dispatch Tests
 *
 * Verifies that all inbound comment webhooks are dispatched to the agent
 * pipeline. Echo filtering was removed in 67-04 because agent activities
 * and user comments are structurally distinct -- activities never re-enter
 * the inbound comment pipeline.
 *
 * Uses vi.mock with vi.hoisted to control config, signature verification,
 * dispatcher, and task correlations. Tests the createWebhookRouter handler
 * directly via a minimal Express app with fetch.
 */

import { createHmac } from "node:crypto";
import express from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.hoisted runs before vi.mock factories -- safe for shared state
const { mockConfig, mockDispatch } = vi.hoisted(() => ({
  mockConfig: {
    linear: {
      webhookSecret: "test-secret",
    },
  },
  mockDispatch: vi.fn(),
}));

vi.mock("../types/config.js", () => ({
  config: mockConfig,
}));

vi.mock("../webhooks/signature.js", () => ({
  verifyWebhookSignature: vi.fn().mockReturnValue(true),
  validateWebhookTimestamp: vi.fn().mockReturnValue(true),
}));

vi.mock("../db/task-correlations.js", () => ({
  lookupTaskCorrelation: vi.fn().mockResolvedValue(null),
}));

vi.mock("../dispatcher/index.js", () => ({
  createDispatcher: vi.fn(() => ({ dispatch: mockDispatch })),
  DISPATCH_ROUTES: [],
  normalizeCommentCreatedEvent: vi.fn(
    (payload: { data: { id: string } }, deliveryId: string) => ({
      id: `evt_${deliveryId}`,
      type: "linear.comment.created",
      source: "linear",
      timestamp: new Date().toISOString(),
      correlationId: `evt_${deliveryId}`,
      payload: { commentId: payload.data.id },
    }),
  ),
  normalizeAgentSessionEvent: vi.fn(),
}));

// Import after mocks are set up
import { createWebhookRouter } from "./webhooks.js";

// Helper: create a valid comment webhook payload
function createCommentPayload(userId: string) {
  return {
    type: "Comment",
    action: "create",
    data: {
      id: "comment-123",
      body: "Test comment body",
      issueId: "issue-456",
      userId,
      createdAt: new Date().toISOString(),
    },
    actor: {
      id: userId,
      name: "Test User",
    },
    webhookTimestamp: Date.now(),
    webhookId: "webhook-abc",
  };
}

// Helper: create Express app with webhook router mounted
function createTestApp() {
  const app = express();
  // Simulate express.raw middleware (webhook handler calls req.body.toString)
  app.use(express.raw({ type: "*/*" }));

  const mockLogger = {
    child: vi.fn().mockReturnThis(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const mockDb = {} as Parameters<typeof createWebhookRouter>[0]["db"];

  const router = createWebhookRouter({
    // biome-ignore lint/suspicious/noExplicitAny: Mock logger for testing
    logger: mockLogger as any,
    db: mockDb,
  });

  app.use(router);

  return { app, mockLogger };
}

// Helper: make a POST request to the webhook endpoint
async function postWebhook(
  app: express.Express,
  payload: object,
): Promise<{ status: number; body: unknown }> {
  const body = JSON.stringify(payload);
  const signature = createHmac("sha256", "test-secret")
    .update(body)
    .digest("hex");

  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Failed to get server address"));
        return;
      }

      fetch(`http://127.0.0.1:${address.port}/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "linear-signature": signature,
          "linear-delivery": `delivery-${Date.now()}`,
        },
        body,
      })
        .then(async (res) => {
          const json = await res.json();
          server.close();
          resolve({ status: res.status, body: json });
        })
        .catch((err) => {
          server.close();
          reject(err);
        });
    });
  });
}

describe("Linear webhook comment dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dispatches all comments regardless of userId (echo filter removed)", async () => {
    const { app } = createTestApp();
    const payload = createCommentPayload("any-user-001");
    const result = await postWebhook(app, payload);

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ received: true });
    expect(mockDispatch).toHaveBeenCalledTimes(1);
  });

  it("dispatches comment from any user without filtering", async () => {
    const { app } = createTestApp();
    // Even a user ID that would have been a "bot" is dispatched now
    const payload = createCommentPayload("bot-user-001");
    const result = await postWebhook(app, payload);

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ received: true });
    expect(mockDispatch).toHaveBeenCalledTimes(1);
  });

  it("ignores non-create comment actions", async () => {
    const { app } = createTestApp();
    const payload = {
      ...createCommentPayload("user-001"),
      action: "update",
    };
    const result = await postWebhook(app, payload);

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ received: true });
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});
