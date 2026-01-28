/**
 * Slack Event Delivery Store
 *
 * Tracks processed Slack events for deduplication using event_id.
 * Prevents duplicate event processing via database-backed storage.
 *
 * Slack may send the same event multiple times if the initial response
 * is delayed. This store enables idempotent event handling.
 */

import type { PinoLogger } from "@aesir/platform";
import { createId } from "@aesir/types";
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { fromPromise, type ResultAsync } from "neverthrow";
import { SlackError } from "../types/errors.js";
import { eventDeliveries } from "./schema.js";

export interface SlackEventDeliveryStoreOptions {
  db: NodePgDatabase;
  logger: PinoLogger;
}

export interface RecordDeliveryInput {
  eventId: string; // Unique event identifier from Slack
  eventType: string; // e.g., "app_mention", "message"
  teamId?: string; // Workspace ID for tracking
}

export interface SlackEventDeliveryStore {
  /**
   * Check if an event has already been processed
   *
   * @param eventId - Unique event identifier from Slack payload
   * @returns true if event was already processed, false otherwise
   */
  isDeliveryProcessed(eventId: string): ResultAsync<boolean, SlackError>;

  /**
   * Record an event delivery as processed
   *
   * Uses ON CONFLICT DO NOTHING for atomic deduplication.
   * If the event already exists, returns the existing ID.
   *
   * @param input - Event delivery metadata
   * @returns ID of the delivery record (new or existing)
   */
  recordDelivery(input: RecordDeliveryInput): ResultAsync<string, SlackError>;
}

/**
 * Create an event delivery store for Slack
 *
 * @param options - Database client and logger
 * @returns SlackEventDeliveryStore instance
 */
export function createSlackEventDeliveryStore(
  options: SlackEventDeliveryStoreOptions,
): SlackEventDeliveryStore {
  const { db, logger } = options;

  if (!db) {
    throw new Error("db is required for SlackEventDeliveryStore");
  }
  if (!logger) {
    throw new Error("logger is required for SlackEventDeliveryStore");
  }

  const childLogger = logger.child({ component: "slack:delivery-store" });

  return {
    isDeliveryProcessed(eventId: string): ResultAsync<boolean, SlackError> {
      childLogger.debug({ eventId }, "Checking if event already processed");

      return fromPromise(
        db
          .select()
          .from(eventDeliveries)
          .where(eq(eventDeliveries.event_id, eventId))
          .limit(1),
        (error) => {
          childLogger.error(
            { err: error, eventId },
            "Failed to check event delivery status",
          );
          return new SlackError(
            "INT_SLACK_DB",
            "Failed to check event delivery status",
            {
              metadata: { eventId },
              cause: error instanceof Error ? error : new Error(String(error)),
            },
          );
        },
      ).map((rows) => {
        const exists = rows.length > 0;
        childLogger.debug({ eventId, exists }, "Event delivery check complete");
        return exists;
      });
    },

    recordDelivery(
      input: RecordDeliveryInput,
    ): ResultAsync<string, SlackError> {
      const { eventId, eventType, teamId } = input;

      childLogger.info({ eventId, eventType }, "Recording event delivery");

      // Build insert object with conditional property assignment
      // biome-ignore lint/suspicious/noExplicitAny: Conditional property assignment for exactOptionalPropertyTypes
      const insertData: any = {
        id: createId.webhookDelivery(),
        event_id: eventId,
        event_type: eventType,
        processed_at: new Date(),
      };

      if (teamId !== undefined) {
        insertData.team_id = teamId;
      }

      return fromPromise(
        db
          .insert(eventDeliveries)
          .values(insertData)
          .onConflictDoNothing({ target: eventDeliveries.event_id })
          .returning(),
        (error) => {
          childLogger.error(
            { err: error, eventId, eventType },
            "Failed to record event delivery",
          );
          return new SlackError(
            "INT_SLACK_DB",
            "Failed to record event delivery",
            {
              metadata: { eventId, eventType },
              cause: error instanceof Error ? error : new Error(String(error)),
            },
          );
        },
      ).map((rows) => {
        if (rows.length === 0 || !rows[0]) {
          // ON CONFLICT DO NOTHING - event already existed
          // This is expected behavior for duplicate events
          childLogger.debug(
            { eventId },
            "Event already recorded (duplicate delivery)",
          );
          return insertData.id;
        }

        childLogger.info(
          { eventId, recordId: rows[0].id },
          "Event delivery recorded",
        );
        return rows[0].id;
      });
    },
  };
}
