/**
 * Start Workflow Tool
 *
 * Router tool that starts a new Temporal workflow for the specified agent.
 * Maps agent type to workflow name and task queue, then delegates to the
 * Temporal client.
 *
 * Handles WorkflowExecutionAlreadyStartedError gracefully -- duplicate
 * start attempts are expected in event-driven systems.
 */

import { WorkflowExecutionAlreadyStartedError } from "@temporalio/client";
import { z } from "zod";
import type {
  ToolDefinition,
  ToolResult,
} from "../../shared/agent-loop/types.js";
import type { RouterDeps } from "../types.js";

// ---------------------------------------------------------------------------
// Input Schema
// ---------------------------------------------------------------------------

const StartWorkflowInputSchema = z.object({
  agentType: z
    .enum(["dev-agent", "product-agent"])
    .describe("Which agent to start"),
  workflowId: z
    .string()
    .describe(
      "Unique workflow ID (e.g., 'dev-agent-{issueId}' or 'product-agent-{threadTs}')",
    ),
  input: z
    .record(z.unknown())
    .describe(
      "Workflow input object matching the agent's expected input schema",
    ),
});

// ---------------------------------------------------------------------------
// Agent Type -> Workflow Mapping
// ---------------------------------------------------------------------------

const WORKFLOW_MAP = {
  "dev-agent": {
    workflowName: "orchestratorWorkflow",
    taskQueue: "dev-agent-v2",
  },
  "product-agent": {
    workflowName: "productAgentConversationWorkflow",
    taskQueue: "product-agent",
  },
} as const;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the start_workflow tool definition.
 *
 * Maps agentType to workflow name and task queue, starts the workflow,
 * and handles duplicate starts gracefully.
 *
 * @param deps - Router dependencies (needs workflowClient)
 * @returns ToolDefinition for the agent loop
 */
export function createStartWorkflowTool(deps: RouterDeps): ToolDefinition {
  return {
    name: "start_workflow",
    description:
      "Start a new Temporal workflow for the specified agent. Use dev-agent for Linear issue work, product-agent for Slack conversations.",
    inputSchema: StartWorkflowInputSchema,
    async execute(input: unknown): Promise<ToolResult> {
      const parsed = StartWorkflowInputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          content: `Invalid input: ${parsed.error.message}`,
          isError: true,
        };
      }

      const { agentType, workflowId, input: workflowInput } = parsed.data;
      const { workflowName, taskQueue } = WORKFLOW_MAP[agentType];

      try {
        await deps.workflowClient.workflow.start(workflowName, {
          taskQueue,
          workflowId,
          args: [workflowInput],
        });

        deps.logger.info(
          { workflowId, workflowName, taskQueue },
          "start_workflow: workflow started",
        );

        return {
          content: JSON.stringify({ started: true, workflowId }),
        };
      } catch (error) {
        if (error instanceof WorkflowExecutionAlreadyStartedError) {
          deps.logger.info(
            { workflowId, workflowName },
            "start_workflow: workflow already exists (duplicate)",
          );
          return {
            content: JSON.stringify({
              started: false,
              reason: "already exists",
              workflowId,
            }),
          };
        }

        const message =
          error instanceof Error ? error.message : "Unknown error";
        deps.logger.error(
          { err: error, workflowId, workflowName },
          "start_workflow: failed to start workflow",
        );
        return {
          content: `Failed to start workflow: ${message}`,
          isError: true,
        };
      }
    },
  };
}
