/**
 * Linear Webhook Payload Zod Schemas
 *
 * Validates Linear webhook payloads before processing.
 * Schemas match the AgentSessionPayload type from @aesir/integrations.
 */

import { z } from "zod";

/**
 * AgentSession object within the webhook payload
 */
export const AgentSessionSchema = z.object({
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
export const AgentSessionPayloadSchema = z.object({
  /** Resource type is always 'AgentSessionEvent' */
  type: z.literal("AgentSessionEvent"),
  /** Action type: 'created' for new delegation, 'prompted' for follow-up */
  action: z.enum(["created", "prompted"]),
  /** Timestamp when webhook was created (milliseconds since epoch) */
  webhookTimestamp: z.number(),
  /** Unique identifier for this webhook delivery */
  webhookId: z.string(),
  /** Agent session data */
  agentSession: AgentSessionSchema,
});

export type AgentSessionPayload = z.infer<typeof AgentSessionPayloadSchema>;
export type AgentSession = z.infer<typeof AgentSessionSchema>;

/**
 * Parse and validate a Linear AgentSession webhook payload
 *
 * @param rawBody - Raw request body string (JSON)
 * @returns Zod safeParse result with typed data or ZodError
 */
export function parseAgentSessionPayload(
  rawBody: string,
): z.SafeParseReturnType<unknown, AgentSessionPayload> {
  try {
    const json: unknown = JSON.parse(rawBody);
    return AgentSessionPayloadSchema.safeParse(json);
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
    };
  }
}
