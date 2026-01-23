/**
 * Slack Event Handler
 *
 * Handles Slack events with deduplication and filtering.
 * Uses event delivery store for idempotent event processing.
 */

import type { PinoLogger } from "@aesir/common";
import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import type { SlackEventDeliveryStore } from "../db/event-delivery-store.js";
import { SlackError } from "../types/errors.js";
import { normalizeEvent, parseSlackEvent } from "./parser.js";
import type { SlackEventPayload } from "./types.js";

/**
 * Message subtypes to ignore (prevent loops and noise)
 */
const IGNORED_MESSAGE_SUBTYPES = new Set([
  "bot_message", // Prevent bot message loops
  "message_changed", // Edit events
  "message_deleted", // Delete events
  "channel_join", // Join events
  "channel_leave", // Leave events
]);

/**
 * Options for creating an event handler
 */
export interface EventHandlerOptions {
  /** Event delivery store for deduplication */
  deliveryStore: SlackEventDeliveryStore;
  /** Logger instance */
  logger: PinoLogger;
}

/**
 * Event handler interface
 */
export interface EventHandler {
  /**
   * Handle an incoming Slack event
   *
   * @param payload - Raw event payload from Slack
   * @returns Normalized payload, null if duplicate/ignored, or error
   */
  handleEvent(
    payload: unknown,
  ): ResultAsync<SlackEventPayload | null, SlackError>;
}

/**
 * Check if a message event should be ignored
 *
 * @param event - Parsed event payload
 * @returns true if the event should be ignored
 */
function shouldIgnoreMessage(event: SlackEventPayload): boolean {
  if (event.eventType !== "message") {
    return false;
  }

  // Check raw event for subtype
  const rawEvent = event.raw;
  if (rawEvent.type === "message" && rawEvent.subtype) {
    return IGNORED_MESSAGE_SUBTYPES.has(rawEvent.subtype);
  }

  return false;
}

/**
 * Create an event handler with deduplication
 *
 * The handler:
 * 1. Parses incoming payloads with Zod validation
 * 2. Checks event delivery store for duplicates
 * 3. Records delivery before processing (prevents race conditions)
 * 4. Filters ignored event types (bot messages, edits, etc.)
 * 5. Returns normalized payload for consumers
 *
 * @param options - Handler dependencies
 * @returns EventHandler instance
 */
export function createEventHandler(options: EventHandlerOptions): EventHandler {
  const { deliveryStore, logger } = options;

  if (!deliveryStore) {
    throw new Error("deliveryStore is required for EventHandler");
  }
  if (!logger) {
    throw new Error("logger is required for EventHandler");
  }

  const childLogger = logger.child({ component: "slack:event-handler" });

  return {
    handleEvent(
      payload: unknown,
    ): ResultAsync<SlackEventPayload | null, SlackError> {
      // Step 1: Parse the event payload
      const parseResult = parseSlackEvent(payload);

      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors
          .map((e) => `${e.path.join(".")}: ${e.message}`)
          .join(", ");

        childLogger.warn(
          { errors: parseResult.error.errors },
          "Failed to parse Slack event",
        );

        return errAsync(
          new SlackError(
            "INT_SLACK_EVENT",
            `Invalid event payload: ${errorMessage}`,
            {
              metadata: { errors: parseResult.error.errors },
            },
          ),
        );
      }

      // Step 2: Normalize the event to extract eventId
      const normalizedEvent = normalizeEvent(parseResult.data);
      const { eventId, eventType, teamId } = normalizedEvent;

      childLogger.debug({ eventId, eventType }, "Processing Slack event");

      // Step 3: Check for duplicate delivery
      return deliveryStore
        .isDeliveryProcessed(eventId)
        .andThen((isProcessed) => {
          if (isProcessed) {
            childLogger.debug(
              { eventId, eventType },
              "Duplicate event - already processed",
            );
            // Return null for duplicates (not an error)
            return okAsync<SlackEventPayload | null, SlackError>(null);
          }

          // Step 4: Record delivery before processing (prevents race conditions)
          return deliveryStore
            .recordDelivery({ eventId, eventType, teamId })
            .andThen(() => {
              // Step 5: Filter ignored events
              if (shouldIgnoreMessage(normalizedEvent)) {
                childLogger.debug(
                  {
                    eventId,
                    eventType,
                    subtype: (normalizedEvent.raw as { subtype?: string })
                      .subtype,
                  },
                  "Ignoring message event by subtype",
                );
                return okAsync<SlackEventPayload | null, SlackError>(null);
              }

              childLogger.info(
                { eventId, eventType, channel: normalizedEvent.channel },
                "Event processed successfully",
              );

              return okAsync<SlackEventPayload | null, SlackError>(
                normalizedEvent,
              );
            });
        });
    },
  };
}
