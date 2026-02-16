/**
 * Webhook Filter
 *
 * Two-layer filter for incoming webhook events:
 *
 * Layer 1 (Dedup): Stateful delivery deduplication via agents.processed_webhook_events.
 *   Uses INSERT ON CONFLICT DO NOTHING to atomically detect duplicates.
 *   Events without a deduplicationId skip this layer.
 *
 * Layer 2 (Echo): Stateless bot-echo suppression via actorInfo.isBot.
 *   Events with actorInfo.isBot === true are suppressed (the agent caused them).
 *   Missing actorInfo passes through (fail-open).
 *
 * Created by Phase 75 Plan 01. Wired into routeEvent() by Plan 03.
 */

import type { PinoLogger } from "@aesir/platform";
import type { Pool } from "pg";
import type { IncomingEvent } from "../adapters/types.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface WebhookFilterResult {
  action: "accept" | "suppress";
  reason?: "duplicate" | "agent_echo";
}

export interface WebhookFilterOptions {
  pool: Pool;
  logger: PinoLogger;
}

// ─── Source Prefix Extraction ───────────────────────────────────────────────

/**
 * Extract source prefix for namespacing dedup IDs.
 * "linear:webhook" -> "linear", "github:webhook" -> "github".
 * If no colon, use the full source string.
 */
function extractSourcePrefix(source: string): string {
  const colonIndex = source.indexOf(":");
  return colonIndex > 0 ? source.substring(0, colonIndex) : source;
}

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Creates a webhook filter function that checks events against both
 * dedup and echo suppression layers.
 *
 * Usage:
 * ```ts
 * const filter = createWebhookFilter({ pool, logger });
 * const result = await filter(event);
 * if (result.action === 'suppress') { return; }
 * ```
 */
export function createWebhookFilter(options: WebhookFilterOptions) {
  const { pool, logger } = options;

  return async function filterWebhookEvent(
    event: IncomingEvent,
  ): Promise<WebhookFilterResult> {
    // ── Layer 1: Delivery Dedup (stateful) ────────────────────────────────
    if (event.deduplicationId) {
      const sourcePrefix = extractSourcePrefix(event.source);
      const namespacedId = `${sourcePrefix}:${event.deduplicationId}`;

      const result = await pool.query(
        "INSERT INTO agents.processed_webhook_events (event_id) VALUES ($1) ON CONFLICT DO NOTHING",
        [namespacedId],
      );

      if (result.rowCount === 0) {
        logger.debug(
          { eventId: namespacedId, eventType: event.type, reason: "duplicate" },
          "event suppressed",
        );
        return { action: "suppress", reason: "duplicate" };
      }
    }

    // ── Layer 2: Echo Suppression (stateless) ─────────────────────────────
    if (event.actorInfo?.isBot === true) {
      logger.debug(
        {
          eventId: event.deduplicationId,
          eventType: event.type,
          reason: "agent_echo",
        },
        "event suppressed",
      );
      return { action: "suppress", reason: "agent_echo" };
    }

    return { action: "accept" };
  };
}
