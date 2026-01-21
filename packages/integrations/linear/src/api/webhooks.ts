/**
 * Linear Webhook Route Handler
 *
 * Handles incoming webhook requests from Linear with:
 * - HMAC signature verification (timing-safe)
 * - Timestamp validation (replay attack prevention)
 * - Zod payload validation
 * - AgentSession event routing
 */

import type { PinoLogger } from "@aesir/common";
import type { Request, Response } from "express";
import { Router } from "express";
import { config } from "../types/config.js";
import {
  isAgentSessionEvent,
  parseAgentSessionPayload,
} from "../webhooks/parser.js";
import {
  validateWebhookTimestamp,
  verifyWebhookSignature,
} from "../webhooks/signature.js";
import type { AgentSessionPayload } from "../webhooks/types.js";

export interface WebhookRouterDeps {
  logger: PinoLogger;
  onAgentSession?: (payload: AgentSessionPayload) => Promise<void>;
}

/**
 * Create webhook router with signature verification and event handling
 *
 * IMPORTANT: This route expects raw body middleware (express.raw) applied in main.ts
 * Raw body is required for signature verification before JSON parsing.
 *
 * @param deps - Dependencies (logger, optional event handlers)
 * @returns Express router with POST /webhook endpoint
 */
export function createWebhookRouter(deps: WebhookRouterDeps): Router {
  const { logger, onAgentSession } = deps;

  const router = Router();

  router.post("/webhook", async (req: Request, res: Response) => {
    const childLogger = logger.child({
      webhookId: req.headers["linear-delivery"],
    });

    try {
      // Extract headers
      const signature = req.headers["linear-signature"] as string | undefined;
      const deliveryId = req.headers["linear-delivery"] as string | undefined;

      if (!signature) {
        childLogger.warn("Missing linear-signature header");
        res.status(401).json({ error: "Missing signature header" });
        return;
      }

      if (!deliveryId) {
        childLogger.warn("Missing linear-delivery header");
        res.status(400).json({ error: "Missing delivery ID header" });
        return;
      }

      // Get raw body as string (express.raw middleware provides Buffer)
      const rawBody = req.body.toString("utf-8");

      // Verify signature with timing-safe comparison
      const signatureValid = verifyWebhookSignature(
        signature,
        rawBody,
        config.linear.webhookSecret,
      );

      if (!signatureValid) {
        childLogger.warn("Invalid webhook signature");
        res.status(401).json({ error: "Invalid signature" });
        return;
      }

      // Parse payload to get timestamp
      const parseResult = parseAgentSessionPayload(rawBody);

      if (!parseResult.success) {
        // Check if this is an AgentSession event before logging validation error
        const basicPayload = JSON.parse(rawBody) as { type?: string };

        if (
          !isAgentSessionEvent(basicPayload as unknown as AgentSessionPayload)
        ) {
          // Not an AgentSession event - ignore gracefully
          childLogger.debug(
            { type: basicPayload.type },
            "Ignoring non-AgentSession webhook",
          );
          res.status(200).json({ received: true });
          return;
        }

        // AgentSession event with validation error - log and reject
        childLogger.warn(
          { errors: parseResult.error.errors },
          "Webhook payload validation failed",
        );
        res.status(400).json({
          error: "Invalid payload",
          details: parseResult.error.errors,
        });
        return;
      }

      const payload = parseResult.data;

      // Validate timestamp (replay attack prevention)
      const timestampValid = validateWebhookTimestamp(payload.webhookTimestamp);

      if (!timestampValid) {
        childLogger.warn(
          { timestamp: payload.webhookTimestamp },
          "Webhook timestamp too old",
        );
        res.status(400).json({ error: "Timestamp too old" });
        return;
      }

      // Route to handler if callback provided
      if (onAgentSession) {
        // payload is validated AgentSession event at this point
        await onAgentSession(payload as AgentSessionPayload);
      }

      childLogger.info(
        { action: payload.action, sessionId: payload.agentSession.id },
        "Webhook processed successfully",
      );

      res.status(200).json({ received: true });
    } catch (error) {
      childLogger.error({ err: error }, "Error processing webhook");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}
