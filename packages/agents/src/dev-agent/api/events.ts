/**
 * Dev Agent Events Handler
 *
 * Handles incoming normalized events from the Linear integration dispatcher.
 * Starts Temporal workflows when an agent session is created (agent assigned to issue).
 *
 * Key behaviors:
 * - Only handles Linear agent_session events (source === 'linear')
 * - Triggers on agent_session.created (agent assigned to issue)
 * - Fetches full issue details via MCP before starting workflow
 * - Starts devAgentWorkflow via Temporal client
 */

import {
  createPinoLogger,
  type NormalizedEvent,
  NormalizedEventSchema,
  type PinoLogger,
} from "@aesir/common";
import type { Client as TemporalClient } from "@temporalio/client";
import { callMcpTool } from "../../mcp/index.js";
import type { DevAgentWorkflowInput } from "../../temporal/types.js";

const logger: PinoLogger = createPinoLogger({
  component: "agents:dev-agent:api:events",
});

/**
 * AgentSession event payload structure (from Linear dispatcher)
 */
interface AgentSessionPayload {
  sessionId: string;
  issueId: string;
  status: "pending" | "active" | "completed";
  url: string;
  creatorId?: string;
}

/**
 * Issue details from MCP get_issue tool
 */
interface IssueDetails {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  url: string;
  state: {
    id: string;
    name: string;
    type: string;
  };
  team: {
    id: string;
    name: string;
    key: string;
  };
  priority: number | null;
  labels: Array<{ id: string; name: string; color: string }>;
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

      // Only handle agent_session.created events
      if (event.type !== "linear.agent_session.created") {
        handlerLogger.debug(
          { type: event.type },
          "Ignoring non-agent_session.created event",
        );
        res.status(200).json({
          received: true,
          eventId: event.id,
          ignored: true,
          reason: "Not an agent_session.created event",
        });
        return;
      }

      // Process agent session event
      await handleAgentSessionCreated(event, {
        workflowClient,
        slackChannel,
        logger: handlerLogger,
        correlationId: correlationId || event.id,
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
 * Handle agent_session.created event
 *
 * When an agent is assigned to an issue in Linear, we:
 * 1. Extract the issueId from the session payload
 * 2. Fetch full issue details via MCP
 * 3. Start the dev-agent workflow
 */
async function handleAgentSessionCreated(
  event: NormalizedEvent,
  ctx: {
    workflowClient: TemporalClient;
    slackChannel: string;
    logger: PinoLogger;
    correlationId: string;
  },
): Promise<void> {
  const {
    workflowClient,
    slackChannel,
    logger: eventLogger,
    correlationId,
  } = ctx;
  const payload = event.payload as AgentSessionPayload;

  if (!payload || typeof payload !== "object") {
    eventLogger.warn("Invalid payload structure");
    return;
  }

  const { sessionId, issueId } = payload;

  if (!sessionId || !issueId) {
    eventLogger.warn(
      { sessionId, issueId },
      "Missing required agent session fields",
    );
    return;
  }

  eventLogger.info(
    { sessionId, issueId },
    "Agent session created, fetching issue details",
  );

  // Fetch full issue details via MCP
  let issue: IssueDetails;
  try {
    issue = await callMcpTool<IssueDetails>({
      integration: "linear",
      tool: "get_issue",
      params: { issueId },
      agentId: "dev-agent",
      correlationId,
    });
  } catch (error) {
    eventLogger.error(
      { err: error, issueId },
      "Failed to fetch issue details via MCP",
    );
    throw error;
  }

  eventLogger.info(
    { issueId: issue.id, identifier: issue.identifier, title: issue.title },
    "Issue details fetched",
  );

  // Create workflow ID based on issue ID
  const workflowId = `dev-agent-${issue.id}`;

  eventLogger.info(
    { workflowId, identifier: issue.identifier },
    "Starting dev-agent workflow",
  );

  const labelNames = issue.labels.map((l) => l.name);

  const input: DevAgentWorkflowInput = {
    taskId: issue.id,
    issueIdentifier: issue.identifier,
    issue: {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description,
      priority: issue.priority,
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
    // Workflow may already exist (duplicate event or re-assignment)
    const isAlreadyStarted =
      error instanceof Error &&
      (error.message.includes("already exists") ||
        error.message.includes("already started") ||
        error.name === "WorkflowExecutionAlreadyStartedError");

    if (isAlreadyStarted) {
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
