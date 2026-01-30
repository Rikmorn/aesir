/**
 * Dev Agent Events Handler
 *
 * Handles incoming normalized events from integration dispatchers.
 * Supports multiple event sources and types:
 *
 * - Linear: agent_session.created (start workflow), comment.created (approval)
 * - Slack: block_actions.* (approval button clicks)
 * - GitHub: pull_request.merged/closed (completion)
 *
 * Key behaviors:
 * - Routes events by source and type
 * - Starts Temporal workflows for new tasks
 * - Sends signals to existing workflows for approvals/completions
 */

import { createPinoLogger, type PinoLogger } from "@aesir/platform";
import { type NormalizedEvent, NormalizedEventSchema } from "@aesir/types";
import type { Client as TemporalClient } from "@temporalio/client";
import { callMcpTool } from "../../shared/mcp/index.js";
import type { OrchestratorWorkflowInput } from "../../shared/temporal/types.js";
import {
  sendApprovalSignal,
  sendCompletionSignal,
  sendEscalationResolvedSignal,
} from "./signal-handler.js";

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
 * Slack block_actions event payload structure
 */
interface SlackBlockActionsPayload {
  taskIdentifier: string;
  userId: string;
  userName?: string;
  actionId: string;
  isApproval: boolean;
  messageTs: string;
  channel: string;
}

/**
 * Slack escalation button event payload structure
 */
interface SlackEscalationPayload {
  taskIdentifier: string;
  userId: string;
  userName?: string;
  actionId: string;
  escalationAction: "retry" | "abort";
  messageTs: string;
  channel: string;
}

/**
 * GitHub PR closed/merged event payload structure
 */
interface GitHubPRClosedPayload {
  prNumber: number;
  prTitle: string;
  prUrl: string;
  merged: boolean;
  branchName: string;
  repository: { owner: string; name: string };
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

      // Handle Slack button clicks (approval/rejection)
      if (
        event.source === "slack" &&
        event.type.startsWith("slack.block_actions")
      ) {
        const payload = event.payload as SlackBlockActionsPayload;

        const isApproval =
          event.type.includes("approved") || payload.isApproval;

        const signalResult = await sendApprovalSignal(
          { workflowClient, logger: handlerLogger },
          {
            taskIdentifier: payload.taskIdentifier,
            approved: isApproval,
            ...(isApproval ? {} : { feedback: "Rejected via Slack button" }),
            approverUserId: payload.userId,
            ...(payload.userName ? { approverName: payload.userName } : {}),
            source: "slack",
            channel: payload.channel,
          },
        );

        res.status(200).json({
          received: true,
          eventId: event.id,
          type: event.type,
          signaled: signalResult.signaled,
          workflowId: signalResult.workflowId,
        });
        return;
      }

      // Handle Slack escalation button clicks (retry/abort)
      if (
        event.source === "slack" &&
        (event.type === "slack.block_actions.escalation_retry" ||
          event.type === "slack.block_actions.escalation_abort")
      ) {
        const payload = event.payload as SlackEscalationPayload;

        const signalResult = await sendEscalationResolvedSignal(
          { workflowClient, logger: handlerLogger },
          {
            taskIdentifier: payload.taskIdentifier,
            action: payload.escalationAction,
            resolverUserId: payload.userId,
            ...(payload.userName ? { resolverName: payload.userName } : {}),
            source: "slack",
          },
        );

        res.status(200).json({
          received: true,
          eventId: event.id,
          type: event.type,
          signaled: signalResult.signaled,
          escalationAction: payload.escalationAction,
          workflowId: signalResult.workflowId,
        });
        return;
      }

      // Handle GitHub PR closed/merged events
      if (
        event.source === "github" &&
        (event.type === "github.pull_request.merged" ||
          event.type === "github.pull_request.closed")
      ) {
        const payload = event.payload as GitHubPRClosedPayload;

        const signalResult = await sendCompletionSignal(
          { workflowClient, logger: handlerLogger },
          {
            prNumber: payload.prNumber,
            merged: payload.merged,
            branchName: payload.branchName,
            repository: payload.repository,
          },
        );

        res.status(200).json({
          received: true,
          eventId: event.id,
          type: event.type,
          processed: true,
          signaled: signalResult.signaled,
        });
        return;
      }

      // Linear comment events are now routed through the smart router (Phase 34).
      // The router's slow path handles comment classification via agentic loop.
      if (
        event.source === "linear" &&
        event.type === "linear.comment.created"
      ) {
        handlerLogger.info(
          "Linear comment events should be routed via smart router, skipping direct handling",
        );
        res.status(200).json({
          received: true,
          eventId: event.id,
          type: event.type,
          skipped: true,
          reason: "Comment classification moved to smart router (Phase 34)",
        });
        return;
      }

      // Handle Linear agent_session.created events (start workflow)
      if (
        event.source === "linear" &&
        event.type === "linear.agent_session.created"
      ) {
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
        return;
      }

      // Unhandled event type - acknowledge but don't process
      handlerLogger.debug(
        { type: event.type, source: event.source },
        "Unhandled event type",
      );
      res.status(200).json({
        received: true,
        eventId: event.id,
        ignored: true,
        reason: `Unhandled event type: ${event.type}`,
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

  const input: OrchestratorWorkflowInput = {
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
    await workflowClient.workflow.start("orchestratorWorkflow", {
      taskQueue: "dev-agent-v2",
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
