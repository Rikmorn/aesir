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
 * - Thread replies signal existing workflows via userReply
 *
 * Cancellation detection is handled by the agent via its
 * <cancellation_detection> prompt — NOT by phrase matching in the router.
 * All thread replies are forwarded to the agent as userReplySignal.
 */

import { createPinoLogger, type PinoLogger } from "@aesir/platform";
import { type NormalizedEvent, NormalizedEventSchema } from "@aesir/types";
import type { Client as TemporalClient } from "@temporalio/client";
import {
  type ProductAgentWorkflowInput,
  userReplySignal,
} from "../../shared/temporal/index.js";

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
    // Thread reply — forward to agent via userReplySignal.
    // Cancellation detection is the agent's job (via <cancellation_detection> prompt),
    // not the router's. All replies go through the same path.
    eventLogger.info(
      { workflowId, channel, user },
      "Signaling existing workflow with user reply",
    );

    const sent = await signalWorkflowWithRetry(
      workflowClient,
      workflowId,
      text,
      eventLogger,
    );

    if (sent) {
      eventLogger.info({ workflowId }, "Sent user reply signal");
    } else {
      eventLogger.info(
        { workflowId },
        "Workflow not found after retries - conversation may have completed",
      );
    }
  } else {
    // app_mention in a thread (not the first message) - signal
    eventLogger.debug(
      { eventType, isThreadReply },
      "Unhandled event type/context",
    );
  }
}

// ---------------------------------------------------------------------------
// Retry helper for workflow signals
// ---------------------------------------------------------------------------

/** Delay between retry attempts (500ms, 1000ms) */
const SIGNAL_RETRY_DELAYS_MS = [500, 1000];

/**
 * Check if an error indicates the workflow was not found in Temporal.
 */
function isWorkflowNotFoundError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes("not found") || error.message.includes("not exist"))
  );
}

/**
 * Signal a workflow with retry on "not found" errors.
 *
 * Handles the race condition where a Slack thread reply arrives before
 * workflow.start() has fully registered the workflow in Temporal. Retries
 * up to 2 times with 500ms → 1000ms delays (1.5s total window).
 *
 * Non-"not found" errors are thrown immediately. If the workflow is still
 * not found after retries, returns false (conversation likely completed).
 *
 * @returns true if signal was sent, false if workflow not found after retries
 */
async function signalWorkflowWithRetry(
  workflowClient: TemporalClient,
  workflowId: string,
  text: string,
  eventLogger: PinoLogger,
): Promise<boolean> {
  for (let attempt = 0; attempt <= SIGNAL_RETRY_DELAYS_MS.length; attempt++) {
    try {
      const handle = workflowClient.workflow.getHandle(workflowId);
      await handle.signal(userReplySignal, text);
      return true;
    } catch (error) {
      if (!isWorkflowNotFoundError(error)) {
        eventLogger.error(
          { err: error, workflowId },
          "Failed to signal workflow",
        );
        throw error;
      }

      // Last attempt — give up
      if (attempt >= SIGNAL_RETRY_DELAYS_MS.length) {
        return false;
      }

      const delayMs = SIGNAL_RETRY_DELAYS_MS[attempt];
      eventLogger.info(
        { workflowId, attempt: attempt + 1, delayMs },
        "Workflow not found, retrying signal after delay",
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return false;
}
