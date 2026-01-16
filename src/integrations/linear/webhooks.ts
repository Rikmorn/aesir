/**
 * Linear Webhook Handlers
 *
 * Provides signature verification and payload parsing for Linear webhooks.
 * All functions are pure and don't depend on LinearClient.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { WebhookPayloadBase, AgentSessionPayload } from "./types.js";

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
  secret: string
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
  toleranceMs: number = 60_000
): boolean {
  const now = Date.now();
  const age = Math.abs(now - timestamp);
  return age <= toleranceMs;
}

/**
 * Parse a webhook payload from raw body string
 *
 * Call this AFTER signature verification to preserve the raw body for verification.
 *
 * @param rawBody - The raw request body string
 * @returns Parsed payload with type assertion
 */
export function parseWebhookPayload<T = WebhookPayloadBase>(rawBody: string): T {
  return JSON.parse(rawBody) as T;
}

/**
 * Type guard to check if a webhook payload is an AgentSession event
 *
 * @param payload - The parsed webhook payload
 * @returns true if this is an AgentSession webhook, with narrowed type
 */
export function isAgentSessionEvent(
  payload: WebhookPayloadBase
): payload is AgentSessionPayload {
  return payload.type === "AgentSession";
}

/**
 * Check if a webhook payload is an Issue event
 *
 * @param payload - The parsed webhook payload
 * @returns true if this is an Issue webhook
 */
export function isIssueEvent(payload: WebhookPayloadBase): boolean {
  return payload.type === "Issue";
}
