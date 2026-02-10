/**
 * Linear MCP Tools - Agent Activities
 *
 * Provides MCP tools for Linear Agent SDK session operations:
 * - create_agent_activity: Create typed activities on agent sessions
 * - update_session_state: Update agent session status via activity emission
 *
 * Both tools use withTokenRefresh for automatic 401 retry with fresh credentials.
 *
 * Note on update_session_state: Linear does not expose a direct status mutation.
 * Session state is driven by the last emitted activity type:
 *   - thought/action -> active
 *   - response -> complete
 *   - error -> error
 *   - elicitation -> awaitingInput
 * This tool emits the appropriate activity type to trigger the desired state.
 */

import type { PinoLogger } from "@aesir/platform";
import type { MCPToolContext, MCPToolResult } from "@aesir/types";
import { createErrorResult, createToolResult } from "@aesir/types";
import type { AgentActivityPayload } from "@linear/sdk";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { withTokenRefresh } from "../../client/refresh-middleware.js";
import { createLinearCredentialStore } from "../../db/credential-store.js";
import { checkLinearToolPermission } from "../../db/permissions.js";
import {
  CreateAgentActivityInputSchema,
  type CreateAgentActivityOutput,
  UpdateSessionStateInputSchema,
  type UpdateSessionStateOutput,
} from "../schemas.js";

export interface ActivityToolDeps {
  db: PostgresJsDatabase;
  logger: PinoLogger;
  workspaceId: string;
}

/**
 * Handle create_agent_activity tool call
 *
 * Creates a typed activity on a Linear agent session. Activity content
 * is dispatched based on type:
 * - thought/response/error/elicitation: requires body
 * - action: requires action + parameter, optional result
 *
 * Ephemeral flag is only valid for thought and action types.
 */
export async function handleCreateAgentActivity(
  context: MCPToolContext,
  args: unknown,
  deps: ActivityToolDeps,
): Promise<MCPToolResult<CreateAgentActivityOutput>> {
  const { db, workspaceId } = deps;

  // Check permission
  const hasPermission = await checkLinearToolPermission(
    { db, logger: context.logger },
    { agentId: context.agentId, toolName: "create_agent_activity" },
  );

  if (!hasPermission) {
    context.logger.warn(
      { agentId: context.agentId, tool: "create_agent_activity" },
      "Permission denied",
    );
    return createErrorResult(
      context,
      "Permission denied: create_agent_activity not allowed for this agent",
    );
  }

  // Validate input
  const parseResult = CreateAgentActivityInputSchema.safeParse(args);
  if (!parseResult.success) {
    context.logger.warn(
      { errors: parseResult.error.errors },
      "Invalid input for create_agent_activity",
    );
    return createErrorResult(
      context,
      `Invalid input: ${parseResult.error.errors.map((e) => e.message).join(", ")}`,
    );
  }

  const input = parseResult.data;

  // Validate ephemeral constraint (Pitfall 4 from research)
  if (
    input.ephemeral !== undefined &&
    input.type !== "thought" &&
    input.type !== "action"
  ) {
    return createErrorResult(
      context,
      "ephemeral is only valid for thought and action types",
    );
  }

  // Build content payload based on type
  // biome-ignore lint/suspicious/noExplicitAny: Linear SDK content is JSONObject scalar (Record<string, unknown>)
  let contentPayload: any;

  switch (input.type) {
    case "thought":
    case "response":
    case "error":
    case "elicitation": {
      if (!input.body) {
        return createErrorResult(
          context,
          `body is required for ${input.type} activity type`,
        );
      }
      contentPayload = { type: input.type, body: input.body };
      break;
    }
    case "action": {
      if (!input.action || !input.parameter) {
        return createErrorResult(
          context,
          "action and parameter are required for action activity type",
        );
      }
      contentPayload = {
        type: "action",
        action: input.action,
        parameter: input.parameter,
        ...(input.result && { result: input.result }),
      };
      break;
    }
  }

  try {
    const credentialStore = createLinearCredentialStore({
      db: deps.db,
      logger: deps.logger,
    });

    const result: AgentActivityPayload = await withTokenRefresh(
      async (client) =>
        client.createAgentActivity({
          agentSessionId: input.agentSessionId,
          content: contentPayload,
          ...((input.type === "thought" || input.type === "action") &&
            input.ephemeral !== undefined && { ephemeral: input.ephemeral }),
        }),
      { credentialStore, workspaceId, logger: deps.logger },
    );

    const output: CreateAgentActivityOutput = {
      success: result.success,
      type: input.type,
    };

    context.logger.info(
      {
        agentSessionId: input.agentSessionId,
        type: input.type,
        success: result.success,
      },
      "Agent activity created",
    );

    return createToolResult(
      context,
      `Activity created: ${input.type} on session ${input.agentSessionId}`,
      output,
    );
  } catch (error) {
    context.logger.error(
      { err: error, agentSessionId: input.agentSessionId, type: input.type },
      "Failed to create agent activity",
    );
    return createErrorResult(
      context,
      `Failed to create agent activity: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * Maps a desired session status to the activity type that triggers it.
 *
 * Linear tracks session state automatically from the last emitted activity:
 *   pending   -> no direct trigger (initial state)
 *   active    -> thought activity
 *   awaitingInput -> elicitation activity
 *   complete  -> response activity
 *   error     -> error activity
 */
const STATUS_TO_ACTIVITY: Record<
  string,
  {
    type: "thought" | "response" | "error" | "elicitation";
    body: string;
  } | null
> = {
  pending: null,
  active: {
    type: "thought",
    body: "Resuming session...",
  },
  awaitingInput: {
    type: "elicitation",
    body: "Waiting for input...",
  },
  complete: {
    type: "response",
    body: "Session completed.",
  },
  error: {
    type: "error",
    body: "Session encountered an error.",
  },
};

/**
 * Handle update_session_state tool call
 *
 * Updates the status of a Linear agent session by emitting the appropriate
 * activity type. Linear does not expose a direct status mutation -- session
 * state is driven by the last emitted activity type. This tool abstracts
 * that mapping for callers who think in terms of state transitions.
 *
 * Used by the executor for explicit lifecycle transitions (e.g., marking
 * error state on conversation failure).
 */
export async function handleUpdateSessionState(
  context: MCPToolContext,
  args: unknown,
  deps: ActivityToolDeps,
): Promise<MCPToolResult<UpdateSessionStateOutput>> {
  const { db, workspaceId } = deps;

  // Check permission
  const hasPermission = await checkLinearToolPermission(
    { db, logger: context.logger },
    { agentId: context.agentId, toolName: "update_session_state" },
  );

  if (!hasPermission) {
    context.logger.warn(
      { agentId: context.agentId, tool: "update_session_state" },
      "Permission denied",
    );
    return createErrorResult(
      context,
      "Permission denied: update_session_state not allowed for this agent",
    );
  }

  // Validate input
  const parseResult = UpdateSessionStateInputSchema.safeParse(args);
  if (!parseResult.success) {
    context.logger.warn(
      { errors: parseResult.error.errors },
      "Invalid input for update_session_state",
    );
    return createErrorResult(
      context,
      `Invalid input: ${parseResult.error.errors.map((e) => e.message).join(", ")}`,
    );
  }

  const input = parseResult.data;

  // Map status to activity type
  const activityConfig = STATUS_TO_ACTIVITY[input.status];
  if (!activityConfig) {
    return createErrorResult(
      context,
      `Cannot transition to "${input.status}" status -- this is the initial state and cannot be set via activity`,
    );
  }

  try {
    const credentialStore = createLinearCredentialStore({
      db: deps.db,
      logger: deps.logger,
    });

    // Emit the appropriate activity type to trigger the state transition
    const result: AgentActivityPayload = await withTokenRefresh(
      async (client) =>
        client.createAgentActivity({
          agentSessionId: input.sessionId,
          content: {
            type: activityConfig.type,
            body: activityConfig.body,
          },
        }),
      { credentialStore, workspaceId, logger: deps.logger },
    );

    const output: UpdateSessionStateOutput = {
      success: result.success,
      sessionId: input.sessionId,
      status: input.status,
    };

    context.logger.info(
      {
        sessionId: input.sessionId,
        status: input.status,
        activityType: activityConfig.type,
      },
      "Session state updated via activity emission",
    );

    return createToolResult(
      context,
      `Session ${input.sessionId} transitioned to ${input.status} (via ${activityConfig.type} activity)`,
      output,
    );
  } catch (error) {
    context.logger.error(
      { err: error, sessionId: input.sessionId, status: input.status },
      "Failed to update session state",
    );
    return createErrorResult(
      context,
      `Failed to update session state: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}
