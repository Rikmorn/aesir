/**
 * Slack Events Route Handler
 *
 * Handles incoming event payloads from Slack's Events API with:
 * - URL verification challenge (initial webhook setup)
 * - Event callback processing with deduplication
 * - Retry handling (X-Slack-Retry-Num header)
 */

import type { PinoLogger } from "@aesir/common";
import type { Request, Response } from "express";
import { Router } from "express";
import type { SlackEventDeliveryStore } from "../db/event-delivery-store.js";
import { createEventHandler } from "../events/handler.js";
import type { SlackEventPayload } from "../events/types.js";

export interface EventsRouterDeps {
  /** Event delivery store for deduplication */
  eventDeliveryStore: SlackEventDeliveryStore;
  /** Logger instance */
  logger: PinoLogger;
  /** Optional callback for processed events */
  onEvent?: (payload: SlackEventPayload) => Promise<void>;
}

/**
 * Create events router for Slack Events API
 *
 * Handles:
 * - URL verification challenge (type: url_verification)
 * - Event callbacks (type: event_callback)
 * - Slack retries via X-Slack-Retry-Num header
 *
 * @param deps - Dependencies (delivery store, logger, optional event callback)
 * @returns Express router with POST /events endpoint
 */
export function createEventsRouter(deps: EventsRouterDeps): Router {
  const { eventDeliveryStore, logger, onEvent } = deps;

  const router = Router();

  // Create event handler with deduplication
  const eventHandler = createEventHandler({
    deliveryStore: eventDeliveryStore,
    logger,
  });

  router.post("/events", async (req: Request, res: Response) => {
    const childLogger = logger.child({
      eventId: req.body?.event_id ?? req.body?.event?.event_id,
      retryNum: req.headers["x-slack-retry-num"],
    });

    try {
      const body = req.body;

      // Handle Slack retry header - log at debug level
      const retryNum = req.headers["x-slack-retry-num"];
      if (retryNum) {
        childLogger.debug(
          { retryNum },
          "Received Slack retry - deduplication will handle",
        );
      }

      // Step 1: URL verification challenge
      // Slack sends this when setting up webhook endpoint
      if (body.type === "url_verification") {
        childLogger.info("Responding to Slack URL verification challenge");
        res.json({ challenge: body.challenge });
        return;
      }

      // Step 2: Event callback processing
      if (body.type === "event_callback") {
        const event = body.event;

        if (!event) {
          childLogger.warn("Event callback missing event payload");
          res.status(400).json({ error: "Missing event payload" });
          return;
        }

        // Merge event_id from body into event if not present
        // Slack puts event_id at the top level, not in the event object
        if (!event.event_id && body.event_id) {
          event.event_id = body.event_id;
        }
        if (!event.event_time && body.event_time) {
          event.event_time = body.event_time;
        }
        if (!event.team_id && body.team_id) {
          event.team_id = body.team_id;
        }

        // Process event through handler (deduplication + validation)
        const result = await eventHandler.handleEvent(event);

        if (result.isErr()) {
          childLogger.error(
            { err: result.error },
            "Error processing Slack event",
          );
          res.status(500).json({ error: "Event processing failed" });
          return;
        }

        // null means duplicate or filtered event - acknowledge without processing
        if (result.value === null) {
          childLogger.debug("Event filtered or duplicate - acknowledging");
          res.status(200).json({ received: true, filtered: true });
          return;
        }

        // Call optional event callback (fire and forget to avoid 3-second timeout)
        if (onEvent) {
          // Don't await - Slack requires response within 3 seconds
          onEvent(result.value).catch((err) => {
            childLogger.error(
              { err },
              "Error in onEvent callback (non-blocking)",
            );
          });
        }

        childLogger.info(
          { eventType: result.value.eventType, channel: result.value.channel },
          "Slack event processed successfully",
        );

        // Acknowledge receipt (Slack 3-second rule)
        res.status(200).json({ received: true });
        return;
      }

      // Unknown event type
      childLogger.debug({ type: body.type }, "Ignoring unknown event type");
      res.status(200).json({ received: true, ignored: true });
    } catch (error) {
      childLogger.error({ err: error }, "Unexpected error processing event");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}
