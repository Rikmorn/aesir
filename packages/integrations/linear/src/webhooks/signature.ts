/**
 * Linear Webhook Signature Verification
 *
 * Provides HMAC-SHA256 signature verification for Linear webhooks.
 * Uses timing-safe comparison to prevent timing attacks.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify a webhook signature using HMAC-SHA256
 *
 * CRITICAL: Use the raw body string, NOT parsed JSON.
 * JSON.parse then JSON.stringify changes whitespace and breaks verification.
 *
 * @param signature - The signature from the 'linear-signature' header (hex encoded)
 * @param rawBody - The raw request body as a string (NOT parsed JSON)
 * @param secret - The webhook signing secret from Linear settings
 * @returns true if signature is valid, false otherwise
 */
export function verifyWebhookSignature(
  signature: string,
  rawBody: string,
  secret: string,
): boolean {
  try {
    // Convert hex signature from header to Buffer
    const headerSignature = Buffer.from(signature, "hex");

    // Compute HMAC-SHA256 of the raw body
    const computedSignature = createHmac("sha256", secret)
      .update(rawBody)
      .digest();

    // Use timing-safe comparison to prevent timing attacks
    return timingSafeEqual(computedSignature, headerSignature);
  } catch {
    // Return false for any errors (invalid hex, buffer length mismatch, etc.)
    return false;
  }
}

/**
 * Validate that a webhook timestamp is recent
 *
 * Prevents replay attacks by rejecting stale webhooks.
 *
 * @param timestamp - The webhookTimestamp from the payload (milliseconds since epoch)
 * @param toleranceMs - Maximum age of webhook in milliseconds (default: 60 seconds)
 * @returns true if timestamp is within tolerance, false otherwise
 */
export function validateWebhookTimestamp(
  timestamp: number,
  toleranceMs: number = 60_000,
): boolean {
  const now = Date.now();
  const age = Math.abs(now - timestamp);
  return age <= toleranceMs;
}
