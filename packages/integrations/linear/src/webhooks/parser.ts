/**
 * Linear Webhook Parser with Zod Validation
 *
 * Validates and parses Linear webhook payloads using Zod schemas.
 * Provides type-safe payload parsing and type guards for event detection.
 */

import { z } from "zod";
import type { AgentSessionPayload, WebhookPayloadBase } from "./types.js";

/**
 * AgentSession object within the webhook payload
 */
const AgentSessionObjectSchema = z.object({
  /** Agent session ID */
  id: z.string(),
  /** ID of the issue this session is for */
  issueId: z.string(),
  /** Session status */
  status: z.enum(["pending", "active", "completed"]),
  /** URL to the agent session in Linear */
  url: z.string(),
  /** Creator information (optional) */
  creator: z
    .object({
      id: z.string(),
    })
    .optional(),
});

/**
 * Full webhook payload from Linear for AgentSession events
 */
export const AgentSessionSchema = z.object({
  /** Resource type is always 'AgentSessionEvent' */
  type: z.literal("AgentSessionEvent"),
  /** Action type: 'created' for new delegation, 'prompted' for follow-up */
  action: z.enum(["created", "prompted"]),
  /** Timestamp when webhook was created (milliseconds since epoch) */
  webhookTimestamp: z.number(),
  /** Unique identifier for this webhook delivery */
  webhookId: z.string(),
  /** Agent session data */
  agentSession: AgentSessionObjectSchema,
  /** Resource data (from WebhookPayloadBase) */
  data: z.unknown(),
});

/**
 * Parse and validate a Linear AgentSession webhook payload
 *
 * @param rawBody - Raw request body string (JSON)
 * @returns Zod safeParse result with typed data or ZodError
 */
export function parseAgentSessionPayload(rawBody: string) {
  try {
    const json: unknown = JSON.parse(rawBody);
    return AgentSessionSchema.safeParse(json);
  } catch {
    // JSON parse error - create a synthetic Zod error
    return {
      success: false,
      error: new z.ZodError([
        {
          code: z.ZodIssueCode.custom,
          message: "Invalid JSON",
          path: [],
        },
      ]),
    } as const;
  }
}

/**
 * Parse a webhook payload from raw body string
 *
 * Call this AFTER signature verification to preserve the raw body for verification.
 *
 * @param rawBody - The raw request body string
 * @returns Parsed payload with type assertion
 */
export function parseWebhookPayload<T = WebhookPayloadBase>(
  rawBody: string,
): T {
  return JSON.parse(rawBody) as T;
}

/**
 * Type guard to check if a webhook payload is an AgentSession event
 *
 * @param payload - The parsed webhook payload
 * @returns true if this is an AgentSession webhook, with narrowed type
 */
export function isAgentSessionEvent(
  payload: WebhookPayloadBase,
): payload is AgentSessionPayload {
  // Linear sends "AgentSessionEvent" as the type for agent session webhooks
  return payload.type === "AgentSessionEvent";
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
