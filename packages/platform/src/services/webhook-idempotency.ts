/**
 * Webhook Idempotency Service
 *
 * Prevents duplicate processing of webhook deliveries using PostgreSQL
 * atomic insert (ON CONFLICT DO NOTHING) for race-condition-safe deduplication.
 */

import type { PinoLogger } from "@aesir/platform";
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { fromPromise, type ResultAsync } from "neverthrow";
import { webhookDeliveries } from "../db/schema.js";
import { WebhookError } from "../errors/platform-errors.js";

/**
 * Webhook delivery ID headers by provider
 * Linear and GitHub use headers, Slack uses event_id in payload body
 */
export const WEBHOOK_DELIVERY_HEADERS = {
  linear: "Linear-Delivery",
  github: "X-GitHub-Delivery",
  slack: null, // Use event_id from payload body
} as const;

export type WebhookProvider = keyof typeof WEBHOOK_DELIVERY_HEADERS;

export interface WebhookIdempotencyOptions {
  db: PostgresJsDatabase;
  logger: PinoLogger;
}

export interface CheckAndRecordResult {
  isDuplicate: boolean;
  deliveryRecordId?: string | undefined;
}

export interface WebhookIdempotencyService {
  /**
   * Check if delivery exists and record if not (atomic operation)
   *
   * @param provider - Webhook provider (linear, github, slack)
   * @param deliveryId - Provider's unique delivery identifier
   * @param eventType - Type of webhook event for logging
   * @returns ResultAsync with isDuplicate: true if already processed, false if newly recorded
   */
  checkAndRecord(
    provider: WebhookProvider,
    deliveryId: string,
    eventType: string,
  ): ResultAsync<CheckAndRecordResult, WebhookError>;

  /**
   * Health check for the service
   */
  health(): Promise<{ healthy: boolean; latencyMs: number }>;

  /**
   * Cleanup resources (no-op for this service, but interface consistency)
   */
  close(): Promise<void>;
}

/**
 * Create webhook idempotency service
 *
 * Uses INSERT ... ON CONFLICT DO NOTHING for atomic deduplication.
 * If insert succeeds (row returned), it's a new delivery.
 * If insert returns nothing (conflict), it's a duplicate.
 */
export function createWebhookIdempotencyService(
  options: WebhookIdempotencyOptions,
): WebhookIdempotencyService {
  const { db, logger } = options;

  if (!db) throw new Error("db is required for WebhookIdempotencyService");
  if (!logger)
    throw new Error("logger is required for WebhookIdempotencyService");

  return {
    checkAndRecord(
      provider: WebhookProvider,
      deliveryId: string,
      eventType: string,
    ): ResultAsync<CheckAndRecordResult, WebhookError> {
      return fromPromise(
        checkAndRecordImpl(db, logger, provider, deliveryId, eventType),
        (error) => {
          logger.error(
            { err: error, provider, deliveryId, eventType },
            "Failed to check/record webhook delivery",
          );
          return new WebhookError(
            "PLT_WEBHOOK_DATABASE",
            "Failed to check/record webhook delivery",
            {
              cause: error instanceof Error ? error : new Error(String(error)),
              metadata: { provider, deliveryId, eventType },
            },
          );
        },
      );
    },

    async health(): Promise<{ healthy: boolean; latencyMs: number }> {
      const start = Date.now();
      try {
        // Simple connectivity check
        await db.execute(sql`SELECT 1`);
        return { healthy: true, latencyMs: Date.now() - start };
      } catch {
        return { healthy: false, latencyMs: Date.now() - start };
      }
    },

    async close(): Promise<void> {
      // No resources to clean up - db connection is managed externally
    },
  };
}

// Internal implementation function (throw is OK - wrapped by fromPromise)

async function checkAndRecordImpl(
  db: PostgresJsDatabase,
  logger: PinoLogger,
  provider: WebhookProvider,
  deliveryId: string,
  eventType: string,
): Promise<CheckAndRecordResult> {
  // Atomic insert-or-skip: ON CONFLICT DO NOTHING
  const result = await db
    .insert(webhookDeliveries)
    .values({
      provider,
      delivery_id: deliveryId,
      event_type: eventType,
    })
    .onConflictDoNothing({
      target: [webhookDeliveries.provider, webhookDeliveries.delivery_id],
    })
    .returning({ id: webhookDeliveries.id });

  const isDuplicate = result.length === 0;

  if (isDuplicate) {
    logger.debug(
      { provider, deliveryId, eventType },
      "Duplicate webhook delivery detected",
    );
  } else {
    logger.info(
      { provider, deliveryId, eventType, recordId: result[0]?.id },
      "Webhook delivery recorded",
    );
  }

  return {
    isDuplicate,
    deliveryRecordId: result[0]?.id,
  };
}
