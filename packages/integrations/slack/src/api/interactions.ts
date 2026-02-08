/**
 * Slack Interactions Route Handler
 *
 * Handles interactive component payloads from Slack (button clicks).
 * When users click Approve/Reject buttons in approval messages, Slack
 * sends a POST to this endpoint with a form-encoded payload.
 *
 * Key considerations:
 * - Slack sends interactive payloads as application/x-www-form-urlencoded
 * - The "payload" field contains a JSON string that must be parsed
 * - Response must be sent within 3 seconds (Slack timeout)
 * - Dispatch to router is fire-and-forget (async)
 */

import type { PinoLogger } from "@aesir/platform";
import { createId, type NormalizedEvent } from "@aesir/types";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Request, Response } from "express";
import { Router } from "express";
import { lookupTaskCorrelation } from "../db/task-correlations.js";

/**
 * Dependencies for the interactions router
 */
export interface InteractionsRouterDeps {
  /** Database connection for task correlation lookups */
  db: NodePgDatabase;
  /** Logger instance */
  logger: PinoLogger;
  /** URL to dispatch events to (router /events endpoint) */
  dispatchUrl: string;
}

/**
 * Slack block_actions payload structure (relevant fields)
 */
interface SlackBlockActionsPayload {
  type: "block_actions";
  trigger_id: string;
  user: {
    id: string;
    username: string;
    name: string;
    team_id: string;
  };
  channel: {
    id: string;
    name: string;
  };
  message: {
    ts: string;
    thread_ts?: string;
  };
  actions: Array<{
    action_id: string;
    value: string;
    type: string;
  }>;
  response_url: string;
}

/**
 * Parse action_id to extract approval intent and task identifier
 *
 * Expected formats:
 * - approve_plan_{taskId}_{suffix} -> { isApproval: true, taskIdentifier: taskId }
 * - reject_plan_{taskId}_{suffix} -> { isApproval: false, taskIdentifier: taskId }
 *
 * @param actionId - The action_id from the button click
 * @returns Parsed action details or null if format doesn't match
 */
function parseActionId(actionId: string): {
  isApproval: boolean;
  taskIdentifier: string;
} | null {
  // Match: approve_plan_ABC-123_pr or reject_plan_ABC-123_pr
  const approveMatch = actionId.match(/^approve_plan_([^_]+)/);
  if (approveMatch?.[1]) {
    return { isApproval: true, taskIdentifier: approveMatch[1] };
  }

  const rejectMatch = actionId.match(/^reject_plan_([^_]+)/);
  if (rejectMatch?.[1]) {
    return { isApproval: false, taskIdentifier: rejectMatch[1] };
  }

  return null;
}

/**
 * Create interactions router for Slack interactive components
 *
 * Handles POST /interactions endpoint for button clicks.
 *
 * IMPORTANT: Requires express.urlencoded({ extended: true }) middleware
 * to be applied BEFORE this router (see main.ts).
 *
 * @param deps - Dependencies (logger, dispatch URL)
 * @returns Express router with POST /interactions endpoint
 */
export function createInteractionsRouter(deps: InteractionsRouterDeps): Router {
  const { db, logger, dispatchUrl } = deps;

  const router = Router();

  router.post("/interactions", async (req: Request, res: Response) => {
    const childLogger = logger.child({ endpoint: "/interactions" });

    try {
      // Step 1: Parse the form-encoded payload
      // Slack sends { payload: '{"type":"block_actions",...}' }
      const payloadString = req.body?.payload;

      if (typeof payloadString !== "string") {
        childLogger.warn("Missing or invalid payload field in request body");
        res.status(400).json({ error: "Missing payload" });
        return;
      }

      let payload: SlackBlockActionsPayload;
      try {
        payload = JSON.parse(payloadString);
      } catch (parseErr) {
        childLogger.warn({ parseErr }, "Failed to parse payload JSON");
        res.status(400).json({ error: "Invalid payload JSON" });
        return;
      }

      // Step 2: Validate payload type
      if (payload.type !== "block_actions") {
        childLogger.debug(
          { type: payload.type },
          "Ignoring non-block_actions payload",
        );
        // Acknowledge but don't process
        res.status(200).json({ received: true, ignored: true });
        return;
      }

      // Step 3: Extract action details
      const action = payload.actions[0];
      if (!action) {
        childLogger.warn("block_actions payload missing actions array");
        res.status(400).json({ error: "Missing actions" });
        return;
      }

      const actionId = action.action_id;
      const actionValue = action.value;
      const userId = payload.user.id;
      const messageTs = payload.message.ts;
      const channelId = payload.channel.id;

      childLogger.info(
        { actionId, userId, channelId, messageTs },
        "Received block_actions interaction",
      );

      // Step 4: Parse the action to determine intent
      const parsedAction = parseActionId(actionId);
      if (!parsedAction) {
        childLogger.debug(
          { actionId },
          "Action ID does not match approval pattern, ignoring",
        );
        res.status(200).json({ received: true, ignored: true });
        return;
      }

      const { isApproval, taskIdentifier } = parsedAction;

      // Look up task correlation for this approval message
      const correlatedTaskId = await lookupTaskCorrelation(
        db,
        "approval",
        `${channelId}:${messageTs}`,
        childLogger,
      );

      // Step 5: Normalize to event format for router
      const eventId = createId.event();
      const normalizedEvent: NormalizedEvent = {
        id: eventId,
        type: isApproval
          ? "slack.block_actions.approved"
          : "slack.block_actions.rejected",
        source: "slack",
        timestamp: new Date().toISOString(),
        correlationId: eventId,
        payload: {
          taskIdentifier,
          userId,
          actionId,
          actionValue,
          isApproval,
          messageTs,
          channel: channelId,
          teamId: payload.user.team_id,
          threadTs: payload.message.thread_ts,
          responseUrl: payload.response_url,
          ...(correlatedTaskId && { taskId: correlatedTaskId }),
        },
      };

      childLogger.info(
        {
          eventId,
          eventType: normalizedEvent.type,
          taskIdentifier,
          isApproval,
        },
        "Dispatching approval event to router",
      );

      // Step 6: Dispatch to router (fire-and-forget)
      // Don't await - Slack requires response within 3 seconds
      fetch(dispatchUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Correlation-ID": eventId,
          "X-Event-ID": eventId,
        },
        body: JSON.stringify(normalizedEvent),
        signal: AbortSignal.timeout(5000),
      })
        .then((response) => {
          if (!response.ok) {
            childLogger.warn(
              { eventId, status: response.status },
              "Router dispatch received non-OK response",
            );
          } else {
            childLogger.info(
              { eventId },
              "Approval event dispatched successfully",
            );
          }
        })
        .catch((err) => {
          childLogger.error(
            { err, eventId },
            "Failed to dispatch approval event to router",
          );
        });

      // Step 7: Acknowledge immediately (Slack 3-second rule)
      res.status(200).json({ received: true });
    } catch (error) {
      childLogger.error(
        { err: error },
        "Unexpected error processing interaction",
      );
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}
