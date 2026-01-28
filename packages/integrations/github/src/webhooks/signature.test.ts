/**
 * GitHub Webhook Signature Verification Tests
 *
 * Tests for webhook signature verification using @octokit/webhooks-methods.
 * GitHub uses X-Hub-Signature-256 header with sha256= prefix.
 */

import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

// Mock @aesir/common to prevent config validation
vi.mock("@aesir/common", () => ({
  createPinoLogger: vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  })),
}));

import { verifySignature, verifyWebhookRequest } from "./signature.js";

describe("verifySignature", () => {
  const secret = "test-webhook-secret";
  const rawBody = '{"action":"submitted","review":{"id":123}}';

  // Pre-compute valid signature for testing
  const validSignature = `sha256=${createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex")}`;

  it("returns true for valid signature", async () => {
    const result = await verifySignature(rawBody, validSignature, secret);
    expect(result).toBe(true);
  });

  it("returns false for invalid signature", async () => {
    const wrongSignature = `sha256=${"0".repeat(64)}`; // Invalid signature
    const result = await verifySignature(rawBody, wrongSignature, secret);
    expect(result).toBe(false);
  });

  it("returns false for tampered body", async () => {
    const tamperedBody = '{"action":"edited","review":{"id":123}}';
    const result = await verifySignature(tamperedBody, validSignature, secret);
    expect(result).toBe(false);
  });

  it("returns false for wrong secret", async () => {
    const wrongSecret = "wrong-secret";
    const result = await verifySignature(rawBody, validSignature, wrongSecret);
    expect(result).toBe(false);
  });

  it("returns false for malformed signature", async () => {
    const result = await verifySignature(rawBody, "not-a-signature", secret);
    expect(result).toBe(false);
  });
});

describe("verifyWebhookRequest", () => {
  const secret = "test-webhook-secret";
  const rawBody = '{"action":"submitted","review":{"id":123}}';

  const validSignature = `sha256=${createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex")}`;

  it("verifies request with all valid headers", async () => {
    const headers = {
      "x-hub-signature-256": validSignature,
      "x-github-delivery": "12345-67890-abcdef",
      "x-github-event": "pull_request_review",
    };

    const result = await verifyWebhookRequest(headers, rawBody, secret);

    expect(result.valid).toBe(true);
    expect(result.deliveryId).toBe("12345-67890-abcdef");
    expect(result.eventType).toBe("pull_request_review");
  });

  it("returns false when signature header is missing", async () => {
    const headers = {
      "x-github-delivery": "12345-67890-abcdef",
      "x-github-event": "pull_request_review",
    };

    const result = await verifyWebhookRequest(headers, rawBody, secret);

    expect(result.valid).toBe(false);
    expect(result.deliveryId).toBe("12345-67890-abcdef");
    expect(result.eventType).toBe("pull_request_review");
  });

  it("returns false when signature is invalid", async () => {
    const headers = {
      "x-hub-signature-256": `sha256=${"0".repeat(64)}`,
      "x-github-delivery": "12345-67890-abcdef",
      "x-github-event": "pull_request_review",
    };

    const result = await verifyWebhookRequest(headers, rawBody, secret);

    expect(result.valid).toBe(false);
  });

  it("includes metadata even when signature is missing", async () => {
    const headers = {
      "x-github-delivery": "test-delivery-id",
      "x-github-event": "push",
    };

    const result = await verifyWebhookRequest(headers, rawBody, secret);

    expect(result.valid).toBe(false);
    expect(result.deliveryId).toBe("test-delivery-id");
    expect(result.eventType).toBe("push");
  });
});
