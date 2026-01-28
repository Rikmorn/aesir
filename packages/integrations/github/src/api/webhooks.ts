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
import type { PinoLogger } from "@aesir/platform";
import type { Request, Response } from "express";
import { Router } from "express";
import type { WebhookDeliveryStore } from "../db/webhook-delivery-store.js";
import {
  createDispatcher,
  DISPATCH_ROUTES,
  normalizePRClosedEvent,
  normalizePRReviewEvent,
} from "../dispatcher/index.js";
import { config } from "../types/config.js";
import type { PRClosedPayload, PRReviewPayload } from "../webhooks/parser.js";
import {
  parsePRReviewPayload,
  parsePullRequestClosedPayload,
} from "../webhooks/parser.js";
import { verifySignature } from "../webhooks/signature.js";

export interface WebhookRouterDeps {
  logger: PinoLogger;
  deliveryStore: WebhookDeliveryStore;
  onPRReview?: (payload: PRReviewPayload, deliveryId: string) => Promise<void>;
  onPRClosed?: (payload: PRClosedPayload, deliveryId: string) => Promise<void>;
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
  const { logger, deliveryStore, onPRReview, onPRClosed } = deps;

  const router = Router();

  // Create dispatcher for event routing
  const dispatcher = createDispatcher({
    logger: logger.child({ component: "dispatcher" }),
    routes: DISPATCH_ROUTES,
  });

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

        // Normalize and dispatch event (fire-and-forget)
        const normalizedEvent = normalizePRReviewEvent(payload, deliveryId);
        dispatcher.dispatch(normalizedEvent);

        childLogger.info(
          {
            action: payload.action,
            prNumber: payload.pull_request.number,
            reviewState: payload.review.state,
            eventId: normalizedEvent.id,
          },
          "PR review webhook processed and event dispatched",
        );
      } else if (eventType === "pull_request") {
        // Handle PR closed/merged events
        let payload: unknown;
        try {
          payload = JSON.parse(rawBody);
        } catch {
          childLogger.warn("Failed to parse pull_request payload");
          res.status(400).json({ error: "Invalid JSON" });
          return;
        }

        // Check if action is "closed"
        if (
          typeof payload === "object" &&
          payload !== null &&
          "action" in payload
        ) {
          const action = (payload as { action: string }).action;

          if (action === "closed") {
            const prPayload = parsePullRequestClosedPayload(payload);

            if (prPayload) {
              // Route to handler if callback provided
              if (onPRClosed) {
                await onPRClosed(prPayload, deliveryId);
              }

              // Normalize and dispatch event (fire-and-forget)
              const normalizedEvent = normalizePRClosedEvent(
                prPayload,
                deliveryId,
              );
              dispatcher.dispatch(normalizedEvent);

              childLogger.info(
                {
                  prNumber: prPayload.pull_request.number,
                  merged: prPayload.pull_request.merged,
                  eventId: normalizedEvent.id,
                  eventType: normalizedEvent.type,
                },
                "PR closed event dispatched",
              );
            } else {
              childLogger.warn("Failed to parse PR closed payload");
            }
          } else {
            // Other PR actions (opened, synchronized, etc.) - acknowledge but don't process
            childLogger.debug(
              { eventType, action },
              "Ignoring non-closed PR action",
            );
          }
        }
      } else {
        // Other event types - acknowledge but don't process
        childLogger.debug({ eventType }, "Ignoring unsupported webhook event");
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
