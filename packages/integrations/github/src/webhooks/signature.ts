/**
 * GitHub Webhook Signature Verification
 *
 * Provides signature verification for GitHub webhooks using @octokit/webhooks-methods.
 * GitHub uses X-Hub-Signature-256 header with sha256= prefix.
 */

import { createPinoLogger } from "@aesir/common";
import { verify } from "@octokit/webhooks-methods";

const logger = createPinoLogger({
  component: "integrations:github:webhooks:signature",
});

/**
 * Verify a GitHub webhook signature
 *
 * Uses @octokit/webhooks-methods for timing-safe comparison.
 * The library handles the sha256= prefix automatically.
 *
 * CRITICAL: Use the raw body string, NOT parsed JSON.
 * JSON.parse then JSON.stringify changes whitespace and breaks verification.
 *
 * @param rawBody - The raw request body as a string (NOT parsed JSON)
 * @param signature - The signature from 'x-hub-signature-256' header (with sha256= prefix)
 * @param secret - The webhook signing secret from GitHub settings
 * @returns true if signature is valid, false otherwise
 */
export async function verifySignature(
  rawBody: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  try {
    logger.debug({ hasSignature: !!signature }, "Verifying webhook signature");

    const isValid = await verify(secret, rawBody, signature);

    logger.debug({ isValid }, "Signature verification complete");

    return isValid;
  } catch (error) {
    logger.debug(
      { err: error },
      "Signature verification failed with exception",
    );
    return false;
  }
}

/**
 * Verify a webhook request and extract metadata
 *
 * Convenience wrapper that verifies signature and extracts
 * common webhook metadata from headers.
 *
 * @param headers - Request headers object
 * @param rawBody - The raw request body as a string
 * @param secret - The webhook signing secret from GitHub settings
 * @returns Verification result with extracted metadata
 */
export async function verifyWebhookRequest(
  headers: Record<string, string | undefined>,
  rawBody: string,
  secret: string,
): Promise<{
  valid: boolean;
  deliveryId?: string;
  eventType?: string;
}> {
  const signature = headers["x-hub-signature-256"];
  const deliveryId = headers["x-github-delivery"];
  const eventType = headers["x-github-event"];

  if (!signature) {
    logger.debug({}, "Missing x-hub-signature-256 header");
    // Conditional property assignment for exactOptionalPropertyTypes
    const result: {
      valid: boolean;
      deliveryId?: string;
      eventType?: string;
    } = { valid: false };
    if (deliveryId !== undefined) {
      result.deliveryId = deliveryId;
    }
    if (eventType !== undefined) {
      result.eventType = eventType;
    }
    return result;
  }

  const valid = await verifySignature(rawBody, signature, secret);

  // Conditional property assignment for exactOptionalPropertyTypes
  const result: {
    valid: boolean;
    deliveryId?: string;
    eventType?: string;
  } = { valid };
  if (deliveryId !== undefined) {
    result.deliveryId = deliveryId;
  }
  if (eventType !== undefined) {
    result.eventType = eventType;
  }
  return result;
}
