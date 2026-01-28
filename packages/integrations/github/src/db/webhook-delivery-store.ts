/**
 * GitHub Webhook Delivery Store
 *
 * Tracks processed webhook deliveries for idempotency using X-GitHub-Delivery header.
 * Prevents duplicate webhook processing via database-backed storage.
 */

import { createId } from "@aesir/common";
import type { PinoLogger } from "@aesir/platform";
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { fromPromise, type ResultAsync } from "neverthrow";
import { GitHubError } from "../types/errors.js";
import { webhookDeliveries } from "./schema.js";

export interface WebhookDeliveryStoreOptions {
  db: NodePgDatabase;
  logger: PinoLogger;
}

export interface RecordDeliveryInput {
  deliveryId: string; // X-GitHub-Delivery header
  eventType: string; // X-GitHub-Event header
  payloadHash?: string; // Optional SHA-256 hash of payload
}

export interface WebhookDeliveryStore {
  /**
   * Check if a webhook delivery has already been processed
   *
   * @param deliveryId - X-GitHub-Delivery header value
   * @returns true if delivery was already processed, false otherwise
   */
  isDeliveryProcessed(deliveryId: string): ResultAsync<boolean, GitHubError>;

  /**
   * Record a webhook delivery as processed
   *
   * @param input - Delivery metadata
   * @returns ID of the delivery record
   */
  recordDelivery(input: RecordDeliveryInput): ResultAsync<string, GitHubError>;
}

/**
 * Create a webhook delivery store for GitHub
 *
 * @param options - Database client and logger
 * @returns WebhookDeliveryStore instance
 */
export function createWebhookDeliveryStore(
  options: WebhookDeliveryStoreOptions,
): WebhookDeliveryStore {
  const { db, logger } = options;

  if (!db) {
    throw new Error("db is required for WebhookDeliveryStore");
  }
  if (!logger) {
    throw new Error("logger is required for WebhookDeliveryStore");
  }

  const childLogger = logger.child({ component: "github:delivery-store" });

  return {
    isDeliveryProcessed(deliveryId: string): ResultAsync<boolean, GitHubError> {
      childLogger.debug(
        { deliveryId },
        "Checking if delivery already processed",
      );

      return fromPromise(
        db
          .select()
          .from(webhookDeliveries)
          .where(eq(webhookDeliveries.delivery_id, deliveryId))
          .limit(1),
        (error) => {
          childLogger.error(
            { err: error, deliveryId },
            "Failed to check delivery status",
          );
          return new GitHubError(
            "INT_GITHUB_DB",
            "Failed to check webhook delivery status",
            {
              metadata: { deliveryId },
              cause: error instanceof Error ? error : new Error(String(error)),
            },
          );
        },
      ).map((rows) => {
        const exists = rows.length > 0;
        childLogger.debug(
          { deliveryId, exists },
          "Delivery status check complete",
        );
        return exists;
      });
    },

    recordDelivery(
      input: RecordDeliveryInput,
    ): ResultAsync<string, GitHubError> {
      const { deliveryId, eventType, payloadHash } = input;

      childLogger.info({ deliveryId, eventType }, "Recording webhook delivery");

      // Build insert object with conditional property assignment
      // biome-ignore lint/suspicious/noExplicitAny: Conditional property assignment for exactOptionalPropertyTypes
      const insertData: any = {
        id: createId.webhookDelivery(),
        delivery_id: deliveryId,
        event_type: eventType,
        processed_at: new Date(),
      };

      if (payloadHash !== undefined) {
        insertData.payload_hash = payloadHash;
      }

      return fromPromise(
        db.insert(webhookDeliveries).values(insertData).returning(),
        (error) => {
          childLogger.error(
            { err: error, deliveryId, eventType },
            "Failed to record webhook delivery",
          );
          return new GitHubError(
            "INT_GITHUB_DB",
            "Failed to record webhook delivery",
            {
              metadata: { deliveryId, eventType },
              cause: error instanceof Error ? error : new Error(String(error)),
            },
          );
        },
      ).map((rows) => {
        const record = rows[0];
        if (!record) {
          throw new GitHubError(
            "INT_GITHUB_DB",
            "No record returned after insert",
            {
              metadata: { deliveryId, eventType },
            },
          );
        }
        childLogger.info(
          { deliveryId, recordId: record.id },
          "Webhook delivery recorded",
        );
        return record.id;
      });
    },
  };
}
