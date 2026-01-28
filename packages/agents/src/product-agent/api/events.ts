/**
 * Product Agent Events Handler
 *
 * Handles incoming normalized events from the Slack integration dispatcher.
 * Starts Temporal workflows for new conversations and signals existing ones.
 *
 * Key behaviors:
 * - Only handles Slack events (source === 'slack')
 * - Checks channel allowlist before processing
 * - New @mentions start productAgentConversationWorkflow
 * - Thread replies signal existing workflows (userReply or cancel)
 */

import { createPinoLogger, type PinoLogger } from "@aesir/platform";
import { type NormalizedEvent, NormalizedEventSchema } from "@aesir/types";
import type { Client as TemporalClient } from "@temporalio/client";
import {
  cancelConversationSignal,
  type ProductAgentWorkflowInput,
  userReplySignal,
} from "../../temporal/index.js";

const logger: PinoLogger = createPinoLogger({
  component: "agents:product-agent:api:events",
});

/**
 * Slack message event payload structure
 * Based on Slack's events API message event
 */
interface SlackMessagePayload {
  /** Channel ID where message was sent */
  channel: string;
  /** Slack user ID who sent the message */
  user: string;
  /** Message text content */
  text: string;
  /** Message timestamp (unique message ID) */
  ts: string;
  /** Thread timestamp (present if message is in a thread) - camelCase from dispatcher */
  threadTs?: string;
  /** Slack team ID */
  teamId?: string;
}

/**
 * Slack app_mention event payload structure
 */
interface SlackAppMentionPayload {
  /** Channel ID where mention occurred */
  channel: string;
  /** Slack user ID who sent the message */
  user: string;
  /** Message text content (includes @mention) */
  text: string;
  /** Message timestamp (unique message ID) */
  ts: string;
  /** Thread timestamp (if mention is in a thread) - camelCase from dispatcher */
  threadTs?: string;
  /** Slack team ID */
  teamId?: string;
}

/**
 * Dependencies for the events handler
 */
export interface ProductAgentEventsHandlerDeps {
  /** Temporal client for starting/signaling workflows */
  workflowClient: TemporalClient;
  /** Allowed channel IDs (comma-separated in env) */
  allowedChannels: string[];
  /** Linear team ID for issue creation */
  linearTeamId: string;
}

/**
 * Request interface for events handler
 */
export interface EventsRequest {
  headers: Record<string, string | undefined>;
  rawBody: string;
}

/**
 * Response interface for events handler
 */
export interface EventsResponse {
  status: (code: number) => { json: (body: unknown) => void };
}

/**
 * Create product-agent events handler
 *
 * @param deps - Dependencies including Temporal client and channel allowlist
 * @returns Handler function for /events endpoint
 */
export function createProductAgentEventsHandler(
  deps: ProductAgentEventsHandlerDeps,
) {
  const { workflowClient, allowedChannels, linearTeamId } = deps;

  return async (req: EventsRequest, res: EventsResponse): Promise<void> => {
    const correlationId = req.headers["x-correlation-id"];
    const eventId = req.headers["x-event-id"];

    const handlerLogger = logger.child({
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
        handlerLogger.warn("Invalid JSON in request body");
        res.status(400).json({ error: "Invalid JSON" });
        return;
      }

      // Validate against NormalizedEvent schema
      const parseResult = NormalizedEventSchema.safeParse(body);

      if (!parseResult.success) {
        handlerLogger.warn(
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

      handlerLogger.info(
        { eventType: event.type, source: event.source, eventId: event.id },
        "Event received",
      );

      // Only handle Slack events
      if (event.source !== "slack") {
        handlerLogger.debug(
          { source: event.source },
          "Ignoring non-Slack event",
        );
        res.status(200).json({
          received: true,
          eventId: event.id,
          ignored: true,
          reason: "Not a Slack event",
        });
        return;
      }

      // Route to appropriate handler based on event type
      await handleSlackEvent(event, {
        workflowClient,
        allowedChannels,
        linearTeamId,
        logger: handlerLogger,
      });

      // Acknowledge receipt
      res.status(200).json({
        received: true,
        eventId: event.id,
        type: event.type,
      });
    } catch (error) {
      handlerLogger.error({ err: error }, "Unexpected error processing event");
      res.status(500).json({ error: "Internal server error" });
    }
  };
}

/**
 * Handle Slack events - route to workflow start or signal
 */
async function handleSlackEvent(
  event: NormalizedEvent,
  ctx: {
    workflowClient: TemporalClient;
    allowedChannels: string[];
    linearTeamId: string;
    logger: PinoLogger;
  },
): Promise<void> {
  const {
    workflowClient,
    allowedChannels,
    linearTeamId,
    logger: eventLogger,
  } = ctx;

  // Extract payload based on event type
  const eventType = event.type;
  const payload = event.payload as SlackMessagePayload | SlackAppMentionPayload;

  // Validate payload has required fields
  if (!payload || typeof payload !== "object") {
    eventLogger.warn({ eventType }, "Invalid payload structure");
    return;
  }

  const { channel, user, text, ts, threadTs, teamId } = payload;

  if (!channel || !user || !text || !ts) {
    eventLogger.warn(
      { channel, user, hasText: !!text, ts },
      "Missing required payload fields",
    );
    return;
  }

  // Check channel allowlist
  if (allowedChannels.length > 0 && !allowedChannels.includes(channel)) {
    eventLogger.info(
      { channel, allowedChannels },
      "Channel not in allowlist, ignoring",
    );
    return;
  }

  // Determine if this is a new conversation or thread reply
  const isThreadReply = Boolean(threadTs);
  const workflowThreadTs = threadTs || ts; // Use threadTs for replies, ts for new messages

  // Create workflow ID based on thread timestamp
  const workflowId = `product-agent-${workflowThreadTs}`;

  if (eventType === "slack.app_mention.created" && !isThreadReply) {
    // New @mention - start a new workflow
    eventLogger.info(
      { workflowId, channel, user, threadTs: workflowThreadTs },
      "Starting new product-agent conversation workflow",
    );

    const input: ProductAgentWorkflowInput = {
      threadTs: workflowThreadTs,
      channelId: channel,
      initialMessage: text,
      userId: user,
      slackTeamId: teamId || "unknown",
      linearTeamId,
    };

    try {
      await workflowClient.workflow.start("productAgentConversationWorkflow", {
        taskQueue: "product-agent",
        workflowId,
        args: [input],
      });

      eventLogger.info({ workflowId }, "Workflow started successfully");
    } catch (error) {
      // Workflow may already exist - that's OK for duplicate events
      if (error instanceof Error && error.message.includes("already exists")) {
        eventLogger.info(
          { workflowId },
          "Workflow already exists, treating as duplicate event",
        );
      } else {
        eventLogger.error(
          { err: error, workflowId },
          "Failed to start workflow",
        );
        throw error;
      }
    }
  } else if (isThreadReply) {
    // Thread reply - signal existing workflow
    const isCancel = isCancellationMessage(text);

    eventLogger.info(
      { workflowId, channel, user, isCancel },
      "Signaling existing workflow with user reply",
    );

    try {
      const handle = workflowClient.workflow.getHandle(workflowId);

      if (isCancel) {
        await handle.signal(cancelConversationSignal);
        eventLogger.info({ workflowId }, "Sent cancel signal");
      } else {
        await handle.signal(userReplySignal, text);
        eventLogger.info({ workflowId }, "Sent user reply signal");
      }
    } catch (error) {
      // Workflow may not exist (already completed or never started)
      if (
        error instanceof Error &&
        (error.message.includes("not found") ||
          error.message.includes("not exist"))
      ) {
        eventLogger.info(
          { workflowId },
          "Workflow not found - conversation may have completed",
        );
      } else {
        eventLogger.error(
          { err: error, workflowId },
          "Failed to signal workflow",
        );
        throw error;
      }
    }
  } else {
    // app_mention in a thread (not the first message) - signal
    eventLogger.debug(
      { eventType, isThreadReply },
      "Unhandled event type/context",
    );
  }
}

/**
 * Check if message text indicates user wants to cancel
 */
function isCancellationMessage(text: string): boolean {
  const cancelPhrases = [
    "nevermind",
    "never mind",
    "cancel",
    "stop",
    "forget it",
    "forget about it",
    "nvm",
  ];

  const lowerText = text.toLowerCase().trim();
  return cancelPhrases.some(
    (phrase) =>
      lowerText === phrase ||
      lowerText.startsWith(`${phrase} `) ||
      lowerText.endsWith(` ${phrase}`),
  );
}
