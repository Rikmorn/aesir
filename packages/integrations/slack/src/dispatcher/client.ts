/**
 * Event Dispatcher Client
 *
 * Fire-and-forget HTTP client for dispatching normalized events to agents.
 * Same implementation as Linear/GitHub dispatcher - could be shared in future.
 */

import type { NormalizedEvent } from "@aesir/common";
import type { PinoLogger } from "@aesir/platform";
import type { DispatchRoute } from "./routes.js";

export interface DispatcherOptions {
  logger: PinoLogger;
  routes: DispatchRoute[];
}

export interface Dispatcher {
  /** Dispatch event to matching routes (fire-and-forget) */
  dispatch(event: NormalizedEvent): void;
}

/**
 * Create dispatcher instance
 *
 * Dispatch is fire-and-forget - does not await response.
 * Errors are logged but do not propagate.
 */
export function createDispatcher(options: DispatcherOptions): Dispatcher {
  const { logger, routes } = options;

  return {
    dispatch(event: NormalizedEvent): void {
      const matchingRoutes = routes.filter((r) => event.type === r.eventType);

      if (matchingRoutes.length === 0) {
        logger.debug(
          { eventType: event.type },
          "No dispatch routes for event type",
        );
        return;
      }

      for (const route of matchingRoutes) {
        const timeout = route.mode === "async" ? 5000 : 30000;

        // Fire-and-forget: don't await
        fetch(route.target, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Correlation-ID": event.correlationId,
            "X-Event-ID": event.id,
          },
          body: JSON.stringify(event),
          signal: AbortSignal.timeout(timeout),
        })
          .then((res) => {
            if (!res.ok) {
              logger.warn(
                { eventId: event.id, target: route.target, status: res.status },
                "Event dispatch received non-OK response",
              );
            } else {
              logger.info(
                { eventId: event.id, target: route.target },
                "Event dispatched successfully",
              );
            }
          })
          .catch((err) => {
            logger.error(
              { err, eventId: event.id, target: route.target },
              "Event dispatch failed",
            );
          });
      }
    },
  };
}
