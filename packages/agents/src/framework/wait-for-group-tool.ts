/**
 * Wait For Group Tool
 *
 * Provides the `wait_for_group` tool that agents use to pause a conversation
 * and wait for a parallel delegation group to complete its policy, settle,
 * or encounter issues (timeouts, failures, clarifications).
 *
 * Two wake modes:
 * - "policy" (default): wakes on policy satisfaction, unsatisfiability,
 *   individual task failures/counter-proposals, clarifications, or group timeout.
 * - "settled": wakes only when ALL tasks reach terminal state, or on
 *   clarifications, counter-proposals, or group timeout.
 *
 * Uses the same mutable WaitForState pattern as wait_for and wait_for_task --
 * the executor creates a fresh WaitForState before each loop run and wires it
 * to this tool. After the loop exits, the executor checks `triggered` to decide
 * whether to transition the conversation to "waiting" status.
 */

import { z } from "zod";
import type { ToolDefinition } from "../shared/agent-loop/types.js";
import type { ToolContext, WaitForState } from "./types.js";

// ─── Input Schema ───────────────────────────────────────────────────────────

const WaitForGroupInputSchema = z.object({
  groupId: z
    .string()
    .min(1)
    .describe("ID of the delegation group to wait for."),
  until: z
    .enum(["policy", "settled"])
    .optional()
    .default("policy")
    .describe(
      "When to wake: 'policy' (default) wakes on policy satisfaction, unsatisfiability, " +
        "or individual task failures/counter-proposals. 'settled' wakes only when ALL tasks " +
        "reach terminal state. Both modes always wake on counter-proposals and clarifications.",
    ),
});

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Create a wait_for_group tool that sets a mutable WaitForState when called.
 *
 * The executor creates a fresh WaitForState before each loop run and
 * passes it here. After the loop exits, the executor checks
 * `waitForState.triggered` to decide whether to pause the conversation.
 *
 * @param waitForState - Mutable state object shared with the executor
 * @param ctx - Optional ToolContext for group existence verification
 * @returns ToolDefinition for the wait_for_group tool
 */
export function createWaitForGroupTool(
  waitForState: WaitForState,
  ctx?: ToolContext,
): ToolDefinition {
  return {
    name: "wait_for_group",
    description:
      "Pause this conversation and wait for a parallel delegation group's completion policy " +
      "to be satisfied. Automatically listens for policy satisfaction, unsatisfiability, " +
      "individual task failures, counter-proposals, clarifications, and group timeouts. " +
      "Use mode 'settled' to wait until ALL tasks reach terminal state instead. " +
      "Use after calling delegate_group to wait for the group result.",
    inputSchema: WaitForGroupInputSchema,
    async execute(
      input: unknown,
    ): Promise<{ content: string; isError?: boolean }> {
      const parsed = WaitForGroupInputSchema.parse(input);

      // Verify the group exists if GroupService is available
      if (ctx?.delegationDeps?.groupService) {
        const group = await ctx.delegationDeps.groupService.get(
          parsed.groupId,
        );
        if (!group) {
          return {
            content: `Error: Group ${parsed.groupId} not found. Verify the group ID from delegate_group output.`,
            isError: true,
          };
        }
      }

      // Set wake types based on until parameter
      if (parsed.until === "settled") {
        waitForState.waitTypes = [
          "group_settled",
          "task_clarification",
          "task_counter_proposed",
          "group_timeout",
        ];
      } else {
        // Default: "policy"
        waitForState.waitTypes = [
          "group_policy_satisfied",
          "group_policy_unsatisfiable",
          "group_task_failed",
          "task_clarification",
          "task_counter_proposed",
          "group_timeout",
        ];
      }

      // Set metadata for signal matching and executor interception
      waitForState.triggered = true;
      waitForState.reason = `Waiting for group ${parsed.groupId} (until: ${parsed.until})`;
      waitForState.timeout = null; // Group timeout is handled via pg-boss, not wait_for's timeout
      waitForState.metadata = { groupId: parsed.groupId };
      waitForState.timeoutSignalType = "group_timeout";

      // Build confirmation message for the LLM
      const wakeDescription =
        parsed.until === "settled"
          ? "all tasks settling, clarifications, counter-proposals, or group timeout"
          : "policy satisfaction, policy unsatisfiability, task failure, clarifications, counter-proposals, or group timeout";

      return {
        content: `Conversation paused. Waiting for group ${parsed.groupId} (mode: ${parsed.until}). Will wake on ${wakeDescription}.`,
      };
    },
  };
}
