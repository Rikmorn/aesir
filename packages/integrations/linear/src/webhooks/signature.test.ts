/**
 * Webhook Signature Verification Tests
 *
 * Tests for webhook signature verification and timestamp validation.
 * Uses HMAC-SHA256 with timing-safe comparison to prevent timing attacks.
 */

import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  validateWebhookTimestamp,
  verifyWebhookSignature,
} from "./signature.js";

describe("verifyWebhookSignature", () => {
  const secret = "test-webhook-secret";
  const rawBody = '{"type":"Issue","action":"create","data":{}}';

  // Pre-compute the valid signature for testing
  const validSignature = createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  it("returns true for valid signature", () => {
    const result = verifyWebhookSignature(validSignature, rawBody, secret);
    expect(result).toBe(true);
  });

  it("returns false for invalid signature", () => {
    const wrongSignature = "0".repeat(64); // Invalid signature (all zeros)
    const result = verifyWebhookSignature(wrongSignature, rawBody, secret);
    expect(result).toBe(false);
  });

  it("returns false for tampered body", () => {
    const tamperedBody = '{"type":"Issue","action":"update","data":{}}';
    const result = verifyWebhookSignature(validSignature, tamperedBody, secret);
    expect(result).toBe(false);
  });

  it("returns false for invalid hex signature", () => {
    const result = verifyWebhookSignature("not-hex", rawBody, secret);
    expect(result).toBe(false);
  });
});

describe("validateWebhookTimestamp", () => {
  it("returns true for recent timestamp", () => {
    const now = Date.now();
    const result = validateWebhookTimestamp(now);
    expect(result).toBe(true);
  });

  it("returns false for old timestamp", () => {
    const twoMinutesAgo = Date.now() - 120_000;
    const result = validateWebhookTimestamp(twoMinutesAgo);
    expect(result).toBe(false);
  });

  it("handles custom tolerance", () => {
    const thirtySecondsAgo = Date.now() - 30_000;
    // Should fail with 10 second tolerance
    const result = validateWebhookTimestamp(thirtySecondsAgo, 10_000);
    expect(result).toBe(false);
  });
});
