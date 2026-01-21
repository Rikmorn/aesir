/**
 * GitHub Webhook Route Handler
 *
 * Handles incoming webhook requests from GitHub with:
 * - X-Hub-Signature-256 verification (timing-safe)
 * - Idempotency protection via X-GitHub-Delivery header
 * - Zod payload validation
 * - PR review event routing
 */

import { createHash } from "node:crypto";
import type { PinoLogger } from "@aesir/common";
import type { Request, Response } from "express";
import { Router } from "express";
import type { WebhookDeliveryStore } from "../db/webhook-delivery-store.js";
import { config } from "../types/config.js";
import type { PRReviewPayload } from "../webhooks/parser.js";
import { parsePRReviewPayload } from "../webhooks/parser.js";
import { verifySignature } from "../webhooks/signature.js";

export interface WebhookRouterDeps {
  logger: PinoLogger;
  deliveryStore: WebhookDeliveryStore;
  onPRReview?: (payload: PRReviewPayload, deliveryId: string) => Promise<void>;
}

/**
 * Create webhook router with signature verification and idempotency
 *
 * IMPORTANT: This route expects raw body middleware (express.raw) applied in main.ts
 * Raw body is required for signature verification before JSON parsing.
 *
 * @param deps - Dependencies (logger, delivery store, optional event handlers)
 * @returns Express router with POST / endpoint
 */
export function createWebhookRouter(deps: WebhookRouterDeps): Router {
  const { logger, deliveryStore, onPRReview } = deps;

  const router = Router();

  router.post("/", async (req: Request, res: Response) => {
    const childLogger = logger.child({
      webhookId: req.headers["x-github-delivery"],
    });

    try {
      // Extract headers
      const signature = req.headers["x-hub-signature-256"] as
        | string
        | undefined;
      const deliveryId = req.headers["x-github-delivery"] as string | undefined;
      const eventType = req.headers["x-github-event"] as string | undefined;

      if (!signature) {
        childLogger.warn("Missing x-hub-signature-256 header");
        res.status(401).json({ error: "Missing signature header" });
        return;
      }

      if (!deliveryId) {
        childLogger.warn("Missing x-github-delivery header");
        res.status(400).json({ error: "Missing delivery ID header" });
        return;
      }

      if (!eventType) {
        childLogger.warn("Missing x-github-event header");
        res.status(400).json({ error: "Missing event type header" });
        return;
      }

      // Get raw body as string (express.raw middleware provides Buffer)
      const rawBody = req.body.toString("utf-8");

      // Verify signature with timing-safe comparison
      const signatureValid = await verifySignature(
        rawBody,
        signature,
        config.github.webhookSecret,
      );

      if (!signatureValid) {
        childLogger.warn("Invalid webhook signature");
        res.status(401).json({ error: "Invalid signature" });
        return;
      }

      // IDEMPOTENCY CHECK: Check if delivery already processed
      const alreadyProcessedResult =
        await deliveryStore.isDeliveryProcessed(deliveryId);

      if (alreadyProcessedResult.isErr()) {
        // Log error but don't fail request - best effort idempotency
        childLogger.warn(
          { err: alreadyProcessedResult.error },
          "Failed to check delivery status, processing anyway",
        );
      } else if (alreadyProcessedResult.value) {
        childLogger.info(
          { deliveryId },
          "Duplicate webhook delivery, skipping",
        );
        res.status(200).json({
          received: true,
          deliveryId,
          duplicate: true,
        });
        return;
      }

      // Parse and validate payload based on event type
      if (eventType === "pull_request_review") {
        const parseResult = parsePRReviewPayload(rawBody);

        if (!parseResult.success) {
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

        // Route to handler if callback provided
        if (onPRReview) {
          await onPRReview(payload, deliveryId);
        }

        childLogger.info(
          {
            action: payload.action,
            prNumber: payload.pull_request.number,
            reviewState: payload.review.state,
          },
          "PR review webhook processed successfully",
        );
      } else {
        // Other event types - acknowledge but don't process
        childLogger.debug({ eventType }, "Ignoring non-PR-review webhook");
      }

      // RECORD DELIVERY: After successful processing
      const payloadHash = createHash("sha256").update(rawBody).digest("hex");
      const recordResult = await deliveryStore.recordDelivery({
        deliveryId,
        eventType,
        payloadHash,
      });

      if (recordResult.isErr()) {
        // Log error but don't fail request - best effort recording
        childLogger.warn(
          { err: recordResult.error },
          "Failed to record webhook delivery",
        );
      }

      res.status(200).json({ received: true, deliveryId });
    } catch (error) {
      childLogger.error({ err: error }, "Error processing webhook");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}
