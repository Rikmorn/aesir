/**
 * Linear Webhook Route Handler
 *
 * Handles incoming webhook requests from Linear with:
 * - HMAC signature verification (timing-safe)
 * - Timestamp validation (replay attack prevention)
 * - Zod payload validation
 * - Event routing (AgentSession, Comment)
 */

import type { PinoLogger } from "@aesir/platform";
import { createId } from "@aesir/types";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { Request, Response } from "express";
import { Router } from "express";
import { withTokenRefresh } from "../client/refresh-middleware.js";
import { createLinearCredentialStore } from "../db/credential-store.js";
import { lookupTaskCorrelation } from "../db/task-correlations.js";
import {
  createDispatcher,
  DISPATCH_ROUTES,
  normalizeAgentSessionEvent,
  normalizeCommentCreatedEvent,
} from "../dispatcher/index.js";
import { config } from "../types/config.js";
import {
  parseAgentSessionPayload,
  parseCommentPayload,
} from "../webhooks/parser.js";
import {
  validateWebhookTimestamp,
  verifyWebhookSignature,
} from "../webhooks/signature.js";
import type { AgentSessionPayload } from "../webhooks/types.js";

export interface WebhookRouterDeps {
  logger: PinoLogger;
  db: NodePgDatabase;
  onAgentSession?: (payload: AgentSessionPayload) => Promise<void>;
}

/**
 * Create webhook router with signature verification and event handling
 *
 * IMPORTANT: This route expects raw body middleware (express.raw) applied in main.ts
 * Raw body is required for signature verification before JSON parsing.
 *
 * @param deps - Dependencies (logger, optional event handlers)
 * @returns Express router with POST /webhook endpoint
 */
export function createWebhookRouter(deps: WebhookRouterDeps): Router {
  const { logger, db, onAgentSession } = deps;

  // Create dispatcher for event routing
  const dispatcher = createDispatcher({
    logger: logger.child({ component: "dispatcher" }),
    routes: DISPATCH_ROUTES,
  });

  const router = Router();

  router.post("/webhook", async (req: Request, res: Response) => {
    const childLogger = logger.child({
      webhookId: req.headers["linear-delivery"],
    });

    try {
      // Extract headers
      const signature = req.headers["linear-signature"] as string | undefined;
      const deliveryId = req.headers["linear-delivery"] as string | undefined;

      if (!signature) {
        childLogger.warn("Missing linear-signature header");
        res.status(401).json({ error: "Missing signature header" });
        return;
      }

      if (!deliveryId) {
        childLogger.warn("Missing linear-delivery header");
        res.status(400).json({ error: "Missing delivery ID header" });
        return;
      }

      // Get raw body as string (express.raw middleware provides Buffer)
      const rawBody = req.body.toString("utf-8");

      // Verify signature with timing-safe comparison
      const signatureValid = verifyWebhookSignature(
        signature,
        rawBody,
        config.linear.webhookSecret,
      );

      if (!signatureValid) {
        childLogger.warn("Invalid webhook signature");
        res.status(401).json({ error: "Invalid signature" });
        return;
      }

      // Parse raw JSON first to determine event type
      const basicPayload = JSON.parse(rawBody) as {
        type?: string;
        action?: string;
        webhookTimestamp?: number;
      };

      // Route by event type
      // Handle Comment events (for approval intent classification via Linear)
      if (basicPayload.type === "Comment") {
        // Only handle "create" action for new comments
        if (basicPayload.action !== "create") {
          childLogger.debug(
            { action: basicPayload.action },
            "Ignoring non-create Comment event",
          );
          res.status(200).json({ received: true });
          return;
        }

        const commentPayload = parseCommentPayload(basicPayload);

        if (!commentPayload) {
          childLogger.warn("Failed to parse Comment payload");
          res.status(400).json({ error: "Invalid Comment payload" });
          return;
        }

        // Validate timestamp (replay attack prevention)
        const timestampValid = validateWebhookTimestamp(
          commentPayload.webhookTimestamp,
        );

        if (!timestampValid) {
          childLogger.warn(
            { timestamp: commentPayload.webhookTimestamp },
            "Comment webhook timestamp too old",
          );
          res.status(400).json({ error: "Timestamp too old" });
          return;
        }

        // Echo filter removed: agent activities and user comments are structurally distinct.
        // Agent uses create_agent_activity (activity types), users use comments.
        // No filtering needed -- activities never re-enter the inbound comment pipeline.

        // Normalize and dispatch comment event
        const normalizedEvent = normalizeCommentCreatedEvent(
          commentPayload,
          deliveryId,
        );

        // Look up task correlation for the issue (non-fatal)
        const commentTaskId = await lookupTaskCorrelation(
          db,
          "issue",
          commentPayload.data.issueId,
          childLogger,
        );
        if (commentTaskId) {
          (normalizedEvent.payload as Record<string, unknown>).taskId =
            commentTaskId;
        }

        dispatcher.dispatch(normalizedEvent);

        childLogger.info(
          {
            commentId: commentPayload.data.id,
            issueId: commentPayload.data.issueId,
            eventId: normalizedEvent.id,
            ...(commentTaskId && { taskId: commentTaskId }),
          },
          "Comment created event dispatched",
        );

        res.status(200).json({ received: true });
        return;
      }

      // Handle Issue events (for materialized task sync, Phase 82)
      if (basicPayload.type === "Issue") {
        if (basicPayload.action !== "update") {
          childLogger.debug(
            { action: basicPayload.action },
            "Ignoring non-update Issue event",
          );
          res.status(200).json({ received: true });
          return;
        }

        // Validate timestamp
        if (basicPayload.webhookTimestamp === undefined) {
          childLogger.warn("Issue webhook missing timestamp");
          res.status(400).json({ error: "Missing timestamp" });
          return;
        }
        const issueTimestampValid = validateWebhookTimestamp(
          basicPayload.webhookTimestamp,
        );
        if (!issueTimestampValid) {
          childLogger.warn("Issue webhook timestamp too old");
          res.status(400).json({ error: "Timestamp too old" });
          return;
        }

        // Parse the Issue payload
        const issuePayload = basicPayload as {
          type: string;
          action: string;
          data: {
            id: string;
            title?: string;
            state?: { id: string; name: string; type: string };
            assignee?: { id: string; name: string; isMe?: boolean };
          };
          updatedFrom?: { stateId?: string; assigneeId?: string };
          webhookTimestamp: number;
        };

        // Build normalized event
        const normalizedIssueEvent = {
          id: createId.event(),
          type: "linear.issue.updated" as const,
          source: "linear" as const,
          correlationId: deliveryId,
          payload: {
            issueId: issuePayload.data.id,
            title: issuePayload.data.title,
            state: issuePayload.data.state,
            assignee: issuePayload.data.assignee,
            updatedFrom: issuePayload.updatedFrom,
            actorType:
              (basicPayload as Record<string, unknown>).actorType ?? "user",
          },
          timestamp: new Date().toISOString(),
        };

        // Look up task correlation for potential materialized issues
        const issueTaskId = await lookupTaskCorrelation(
          db,
          "issue",
          issuePayload.data.id,
          childLogger,
        );
        if (issueTaskId) {
          (normalizedIssueEvent.payload as Record<string, unknown>).taskId =
            issueTaskId;
        }

        // Dispatch via existing dispatcher
        dispatcher.dispatch(normalizedIssueEvent);
        childLogger.info(
          { issueId: issuePayload.data.id, eventId: normalizedIssueEvent.id },
          "Issue.update event dispatched",
        );

        res.status(200).json({ received: true });
        return;
      }

      // Handle AgentSession events
      if (basicPayload.type === "AgentSessionEvent") {
        const parseResult = parseAgentSessionPayload(rawBody);

        if (!parseResult.success) {
          childLogger.warn(
            { errors: parseResult.error.errors },
            "AgentSession payload validation failed",
          );
          res.status(400).json({
            error: "Invalid payload",
            details: parseResult.error.errors,
          });
          return;
        }

        const payload = parseResult.data;

        // Validate timestamp (replay attack prevention)
        const timestampValid = validateWebhookTimestamp(
          payload.webhookTimestamp,
        );

        if (!timestampValid) {
          childLogger.warn(
            { timestamp: payload.webhookTimestamp },
            "AgentSession webhook timestamp too old",
          );
          res.status(400).json({ error: "Timestamp too old" });
          return;
        }

        // Route to handler if callback provided
        if (onAgentSession) {
          await onAgentSession(payload as AgentSessionPayload);
        }

        // Emit ephemeral acknowledgment thought on session creation (fire-and-forget)
        // This provides immediate feedback in Linear while the agent processes the request.
        // Non-blocking: do NOT await -- webhook must respond within 5 seconds.
        if (payload.action === "created") {
          emitAcknowledgmentThought(
            payload.agentSession.id,
            db as unknown as PostgresJsDatabase,
            logger,
          ).catch((err) => {
            childLogger.error(
              { err, sessionId: payload.agentSession.id },
              "Failed to emit acknowledgment thought",
            );
          });
        }

        // Normalize and dispatch event (fire-and-forget)
        const normalizedEvent = normalizeAgentSessionEvent(
          payload as AgentSessionPayload,
          deliveryId,
        );

        // Look up task correlation for the issue (non-fatal)
        const sessionTaskId = await lookupTaskCorrelation(
          db,
          "issue",
          payload.agentSession.issueId,
          childLogger,
        );
        if (sessionTaskId) {
          (normalizedEvent.payload as Record<string, unknown>).taskId =
            sessionTaskId;
        }

        dispatcher.dispatch(normalizedEvent);

        childLogger.info(
          {
            action: payload.action,
            sessionId: payload.agentSession.id,
            eventId: normalizedEvent.id,
            ...(sessionTaskId && { taskId: sessionTaskId }),
          },
          "AgentSession webhook processed and event dispatched",
        );

        res.status(200).json({ received: true });
        return;
      }

      // Unknown event type - ignore gracefully
      childLogger.debug(
        { type: basicPayload.type },
        "Ignoring unhandled webhook type",
      );
      res.status(200).json({ received: true });
    } catch (error) {
      childLogger.error({ err: error }, "Error processing webhook");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}

/**
 * Emit an ephemeral acknowledgment thought on a newly created agent session.
 *
 * This provides immediate visual feedback in Linear's UI ("Looking into this...")
 * while the agent processes the request. The activity is ephemeral, so it
 * disappears when the agent emits its first real activity.
 *
 * Uses withTokenRefresh for automatic 401 retry with fresh credentials.
 * Non-fatal: failures are logged but do not affect webhook processing.
 */
async function emitAcknowledgmentThought(
  sessionId: string,
  db: PostgresJsDatabase,
  logger: PinoLogger,
): Promise<void> {
  const childLogger = logger.child({
    component: "session-acknowledgment",
    sessionId,
  });

  try {
    const credentialStore = createLinearCredentialStore({ db, logger });

    await withTokenRefresh(
      async (client) =>
        client.createAgentActivity({
          agentSessionId: sessionId,
          content: {
            type: "thought",
            body: "Looking into this...",
          },
          ephemeral: true,
        }),
      { credentialStore, workspaceId: "ws_default", logger },
    );

    childLogger.info("Acknowledgment thought emitted");
  } catch (error) {
    childLogger.error({ err: error }, "Failed to emit acknowledgment thought");
    // Non-fatal: agent will still process the session
  }
}
