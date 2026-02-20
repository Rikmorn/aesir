/**
 * task:group_status Tool Factory
 *
 * Returns aggregated state of a delegation group including per-task breakdown,
 * policy assessment, and completion counts. Read-only tool for monitoring
 * parallel delegation progress.
 */

import { z } from "zod";
import type { ToolContext } from "../../../framework/types.js";
import type { ToolDefinition, ToolResult } from "../../agent-loop/types.js";
import { evaluatePolicy } from "../../services/group-service.js";

// ─── Input Schema ───────────────────────────────────────────────────────────

const GroupStatusInputSchema = z.object({
  groupId: z.string().min(1).describe("ID of the group to check status"),
});

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Create the task:group_status tool.
 *
 * Requires ctx.delegationDeps with groupService to be populated.
 */
export function createGroupStatusTool(ctx: ToolContext): ToolDefinition {
  return {
    name: "group_status",
    description:
      "Get the current status of a delegation group including per-task breakdown, " +
      "completion counts, and policy assessment (satisfied / unsatisfiable / in progress).",
    inputSchema: GroupStatusInputSchema,
    async execute(input: unknown): Promise<ToolResult> {
      const parsed = GroupStatusInputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          content: `Invalid input: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
          isError: true,
        };
      }

      const deps = ctx.delegationDeps;
      if (!deps) {
        return {
          content:
            "Delegation not available -- this agent is not configured for delegation.",
          isError: true,
        };
      }

      if (!deps.groupService) {
        return {
          content:
            "Group status not available -- groupService is not configured.",
          isError: true,
        };
      }

      const { groupId } = parsed.data;

      try {
        const state = await deps.groupService.getGroupState(groupId);

        // Format policy label
        let policyLabel: string;
        if (state.policy.type === "all_required") {
          policyLabel = "all_required";
        } else if (state.policy.type === "any_sufficient") {
          policyLabel = "any_sufficient";
        } else if (state.policy.type === "min_required") {
          policyLabel = `min_required (${state.policy.threshold})`;
        } else {
          policyLabel = state.policy.type;
        }

        // Evaluate policy assessment
        const assessment = evaluatePolicy(state.policy, {
          total: state.total,
          completed: state.completed,
          failed: state.failed,
          cancelled: state.cancelled,
        });

        let assessmentLabel: string;
        if (assessment.satisfied) {
          assessmentLabel = "SATISFIED -- policy conditions met";
        } else if (assessment.unsatisfiable) {
          assessmentLabel = "UNSATISFIABLE -- policy can no longer be met";
        } else {
          assessmentLabel = "IN PROGRESS -- waiting for more results";
        }

        // Format per-task breakdown
        const taskLines = state.tasks.map((t) => {
          let line = `  - ${t.taskId} | ${t.assigneeId} | ${t.status}`;
          if (
            t.completionResult &&
            (t.status === "completed" || t.status === "failed")
          ) {
            const summary =
              typeof t.completionResult.summary === "string"
                ? t.completionResult.summary
                : JSON.stringify(t.completionResult).slice(0, 200);
            line += ` | ${summary}`;
          }
          return line;
        });

        return {
          content: [
            `Group: ${state.groupId}`,
            `Status: ${state.status}`,
            `Policy: ${policyLabel}`,
            `Assessment: ${assessmentLabel}`,
            ``,
            `Counts:`,
            `  Completed: ${state.completed}`,
            `  Failed: ${state.failed}`,
            `  Cancelled: ${state.cancelled}`,
            `  Running: ${state.running}`,
            `  Pending: ${state.pending}`,
            `  Total: ${state.total}`,
            ``,
            `Tasks:`,
            ...taskLines,
          ].join("\n"),
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        if (message.includes("not found")) {
          return {
            content: `Group not found: ${groupId}`,
            isError: true,
          };
        }
        return {
          content: `Failed to get group status: ${message}`,
          isError: true,
        };
      }
    },
  };
}
