/**
 * Query Workflows Tool
 *
 * Router tool that queries the Temporal visibility API for running workflows.
 * Used by the LLM to check if a workflow exists before deciding to signal
 * or start it.
 *
 * Returns up to 20 workflow execution summaries with ID, type, and status.
 */

import { z } from "zod";
import type {
  ToolDefinition,
  ToolResult,
} from "../../shared/agent-loop/types.js";
import type { RouterDeps } from "../types.js";

// ---------------------------------------------------------------------------
// Input Schema
// ---------------------------------------------------------------------------

const QueryWorkflowsInputSchema = z.object({
  taskId: z
    .string()
    .optional()
    .describe(
      "Filter by task ID to check if a specific workflow is running (checks dev-agent-{taskId} and product-agent-{taskId} patterns)",
    ),
  workflowType: z
    .string()
    .optional()
    .describe(
      "Filter by workflow type (e.g., 'devAgentWorkflow', 'productAgentConversationWorkflow', 'orchestratorWorkflow')",
    ),
});

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the query_running_workflows tool definition.
 *
 * Queries the Temporal visibility API with SQL-like filters.
 * Returns JSON array of { workflowId, status, workflowType }.
 *
 * @param deps - Router dependencies (needs workflowClient)
 * @returns ToolDefinition for the agent loop
 */
export function createQueryWorkflowsTool(deps: RouterDeps): ToolDefinition {
  return {
    name: "query_running_workflows",
    description:
      "List running Temporal workflows. Use to check if a workflow exists before signaling it. Returns workflow IDs, types, and statuses.",
    inputSchema: QueryWorkflowsInputSchema,
    async execute(input: unknown): Promise<ToolResult> {
      const parsed = QueryWorkflowsInputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          content: `Invalid input: ${parsed.error.message}`,
          isError: true,
        };
      }

      const { taskId, workflowType } = parsed.data;

      try {
        // Build SQL-like query filter for Temporal visibility API
        const filters: string[] = ['ExecutionStatus = "Running"'];

        if (taskId) {
          // Check both dev-agent and product-agent workflow ID patterns
          filters.push(
            `(WorkflowId = "dev-agent-${taskId}" OR WorkflowId = "product-agent-${taskId}")`,
          );
        }

        if (workflowType) {
          filters.push(`WorkflowType = "${workflowType}"`);
        }

        const query = filters.join(" AND ");

        // Iterate async iterable, collect up to 20 results
        const results: Array<{
          workflowId: string;
          status: string;
          workflowType: string;
        }> = [];

        const iterable = deps.workflowClient.workflow.list({ query });

        for await (const execution of iterable) {
          results.push({
            workflowId: execution.workflowId,
            status: execution.status.name,
            workflowType: execution.type,
          });

          if (results.length >= 20) {
            break;
          }
        }

        return { content: JSON.stringify(results, null, 2) };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        deps.logger.error(
          { err: error },
          "query_running_workflows: failed to list workflows",
        );
        return {
          content: `Failed to query workflows: ${message}`,
          isError: true,
        };
      }
    },
  };
}
