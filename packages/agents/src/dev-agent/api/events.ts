/**
 * Dev Agent Events Handler
 *
 * Handles incoming normalized events from the Linear integration dispatcher.
 * Starts Temporal workflows for issues with "agent-ready" label.
 *
 * Key behaviors:
 * - Only handles Linear events (source === 'linear')
 * - Filters for "agent-ready" label
 * - Handles both issue.created and issue.updated (for late label addition)
 * - Starts devAgentWorkflow via Temporal client
 */

import {
  createPinoLogger,
  type NormalizedEvent,
  NormalizedEventSchema,
  type PinoLogger,
} from "@aesir/common";
import type { Client as TemporalClient } from "@temporalio/client";
import type { DevAgentWorkflowInput } from "../../temporal/types.js";

const logger: PinoLogger = createPinoLogger({
  component: "agents:dev-agent:api:events",
});

/**
 * Linear issue event payload structure
 */
interface LinearIssuePayload {
  id: string;
  identifier: string;
  title: string;
  description?: string | null;
  priority?: number | null;
  labels?: Array<{ id: string; name: string }>;
  state?: { name: string };
}

/**
 * Dependencies for the events handler
 */
export interface DevAgentEventsHandlerDeps {
  workflowClient: TemporalClient;
  slackChannel: string;
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
 * Create dev-agent events handler
 */
export function createDevAgentEventsHandler(deps: DevAgentEventsHandlerDeps) {
  const { workflowClient, slackChannel } = deps;

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

      // Only handle Linear events
      if (event.source !== "linear") {
        handlerLogger.debug(
          { source: event.source },
          "Ignoring non-Linear event",
        );
        res.status(200).json({
          received: true,
          eventId: event.id,
          ignored: true,
          reason: "Not a Linear event",
        });
        return;
      }

      // Only handle issue events
      if (!event.type.startsWith("linear.issue")) {
        handlerLogger.debug({ type: event.type }, "Ignoring non-issue event");
        res.status(200).json({
          received: true,
          eventId: event.id,
          ignored: true,
          reason: "Not an issue event",
        });
        return;
      }

      // Process issue event
      await handleLinearIssueEvent(event, {
        workflowClient,
        slackChannel,
        logger: handlerLogger,
      });

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
 * Handle Linear issue event
 */
async function handleLinearIssueEvent(
  event: NormalizedEvent,
  ctx: {
    workflowClient: TemporalClient;
    slackChannel: string;
    logger: PinoLogger;
  },
): Promise<void> {
  const { workflowClient, slackChannel, logger: eventLogger } = ctx;
  const payload = event.payload as LinearIssuePayload;

  if (!payload || typeof payload !== "object") {
    eventLogger.warn("Invalid payload structure");
    return;
  }

  const { id, identifier, title, description, priority, labels } = payload;

  if (!id || !identifier || !title) {
    eventLogger.warn(
      { id, identifier, title },
      "Missing required issue fields",
    );
    return;
  }

  // Check for agent-ready label (DEV-02)
  const labelNames = labels?.map((l) => l.name) || [];
  const hasAgentReadyLabel = labelNames.includes("agent-ready");

  if (!hasAgentReadyLabel) {
    eventLogger.debug(
      { labels: labelNames },
      "Issue does not have agent-ready label",
    );
    return;
  }

  // Create workflow ID based on issue ID
  const workflowId = `dev-agent-${id}`;

  eventLogger.info(
    { workflowId, identifier, hasAgentReadyLabel },
    "Starting dev-agent workflow",
  );

  const input: DevAgentWorkflowInput = {
    taskId: id,
    issueIdentifier: identifier,
    issue: {
      id,
      identifier,
      title,
      description: description || null,
      priority: priority || null,
      labels: labelNames,
    },
    slackChannel,
  };

  try {
    await workflowClient.workflow.start("devAgentWorkflow", {
      taskQueue: "dev-agent",
      workflowId,
      args: [input],
    });

    eventLogger.info({ workflowId }, "Workflow started successfully");
  } catch (error) {
    // Workflow may already exist (duplicate event)
    if (error instanceof Error && error.message.includes("already exists")) {
      eventLogger.info(
        { workflowId },
        "Workflow already exists, treating as duplicate",
      );
    } else {
      eventLogger.error({ err: error, workflowId }, "Failed to start workflow");
      throw error;
    }
  }
}
