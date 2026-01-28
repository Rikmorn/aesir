/**
 * Normalized Event Handler
 *
 * Handles incoming normalized events from integration dispatchers.
 * Validates payloads, routes by source, and logs for observability.
 */

import type { PinoLogger } from "@aesir/platform";
import { type NormalizedEvent, NormalizedEventSchema } from "@aesir/types";

export interface EventsHandlerDeps {
  logger: PinoLogger;
  /** Optional callback for Linear events */
  onLinearEvent?: (event: NormalizedEvent) => Promise<void>;
  /** Optional callback for GitHub events */
  onGitHubEvent?: (event: NormalizedEvent) => Promise<void>;
  /** Optional callback for Slack events */
  onSlackEvent?: (event: NormalizedEvent) => Promise<void>;
}

export interface EventsRequest {
  headers: Record<string, string | undefined>;
  rawBody: string;
}

export interface EventsResponse {
  status: (code: number) => { json: (body: unknown) => void };
}

/**
 * Create events handler
 *
 * @param deps - Dependencies including logger and optional event callbacks
 * @returns Handler function for /events endpoint
 */
export function createEventsHandler(deps: EventsHandlerDeps) {
  const { logger, onLinearEvent, onGitHubEvent, onSlackEvent } = deps;

  return async (req: EventsRequest, res: EventsResponse): Promise<void> => {
    const correlationId = req.headers["x-correlation-id"];
    const eventId = req.headers["x-event-id"];

    const childLogger = logger.child({
      endpoint: "/events",
      correlationId,
      eventId,
    });

    try {
      // Parse JSON body
      let body: unknown;
      try {
        body = JSON.parse(req.rawBody);
      } catch {
        childLogger.warn("Invalid JSON in request body");
        res.status(400).json({ error: "Invalid JSON" });
        return;
      }

      // Validate against NormalizedEvent schema
      const parseResult = NormalizedEventSchema.safeParse(body);

      if (!parseResult.success) {
        childLogger.warn(
          { errors: parseResult.error.errors },
          "Event payload validation failed",
        );
        res.status(400).json({
          error: "Invalid event payload",
          details: parseResult.error.errors,
        });
        return;
      }

      const event = parseResult.data;

      childLogger.info(
        { eventType: event.type, source: event.source, eventId: event.id },
        "Event received",
      );

      // Route to appropriate handler based on source
      // Note: Handlers are optional - for v2.1 we just acknowledge receipt
      // Actual event processing will be added in Phase 26 (Dev Agent Workflow)
      try {
        switch (event.source) {
          case "linear":
            if (onLinearEvent) {
              await onLinearEvent(event);
            }
            break;
          case "github":
            if (onGitHubEvent) {
              await onGitHubEvent(event);
            }
            break;
          case "slack":
            if (onSlackEvent) {
              await onSlackEvent(event);
            }
            break;
        }
      } catch (handlerError) {
        // Log but don't fail - event was received successfully
        childLogger.error(
          { err: handlerError, source: event.source },
          "Error in event handler callback",
        );
      }

      // Always acknowledge receipt
      res.status(200).json({
        received: true,
        eventId: event.id,
        type: event.type,
      });
    } catch (error) {
      childLogger.error({ err: error }, "Unexpected error processing event");
      res.status(500).json({ error: "Internal server error" });
    }
  };
}
