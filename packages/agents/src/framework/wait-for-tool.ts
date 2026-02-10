/**
 * Wait For Tool
 *
 * Provides the `wait_for` tool that agents use to pause a conversation
 * and wait for an external signal (e.g., human approval, PR review, CI results).
 *
 * The tool does NOT throw an error or interrupt the agent loop directly.
 * Instead, it sets a mutable WaitForState flag that the executor checks
 * after the loop exits. This allows the agent to see the confirmation
 * message and generate a clean end_turn response.
 *
 * Usage:
 *   const waitForState = createDefaultWaitForState();
 *   const waitForTool = createWaitForTool(waitForState);
 *   // ... run agent loop with waitForTool in tools array ...
 *   if (waitForState.triggered) {
 *     // Transition conversation to "waiting" status
 *   }
 */

import { z } from "zod";
import type { ToolDefinition } from "../shared/agent-loop/types.js";
import type { WaitForState } from "./types.js";

// ─── Input Schema ───────────────────────────────────────────────────────────

const WaitForInputSchema = z.object({
  type: z
    .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
    .describe(
      "What to wait for. A string or array of strings matching signal types that will wake this conversation. " +
        "Common types: 'approval', 'user_reply', 'pr_review', 'pr_merged', 'escalation_resolved'. " +
        "When an array is provided, the conversation resumes when ANY of the signal types arrives.",
    ),
  reason: z
    .string()
    .min(1)
    .describe(
      "Why you are pausing. Logged for observability and included in timeout notifications.",
    ),
  timeout: z
    .string()
    .optional()
    .describe(
      "Max time to wait. Format: '<number><unit>' where unit is h (hours) or d (days). " +
        "E.g., '72h', '7d'.",
    ),
  metadata: z
    .record(z.unknown())
    .optional()
    .describe("Additional context stored with the pause."),
});

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Create a wait_for tool that sets a mutable WaitForState when called.
 *
 * The executor creates a fresh WaitForState before each loop run and
 * passes it here. After the loop exits, the executor checks
 * `waitForState.triggered` to decide whether to pause the conversation.
 *
 * @param waitForState - Mutable state object shared with the executor
 * @returns ToolDefinition for the wait_for tool
 */
export function createWaitForTool(waitForState: WaitForState): ToolDefinition {
  return {
    name: "wait_for",
    description:
      "Pause this conversation and wait for an external signal before continuing. " +
      "Use when you need: human approval for a plan, user reply in a conversation, " +
      "PR review feedback, CI results, or any external input. " +
      "The conversation will resume automatically when the signal arrives or the timeout expires.",
    inputSchema: WaitForInputSchema,
    async execute(
      input: unknown,
    ): Promise<{ content: string; isError?: boolean }> {
      const parsed = WaitForInputSchema.parse(input);

      // Normalize type to array
      const types = Array.isArray(parsed.type) ? parsed.type : [parsed.type];

      // Set mutable state for executor interception
      waitForState.triggered = true;
      waitForState.waitTypes = types;
      waitForState.reason = parsed.reason;
      waitForState.timeout = parsed.timeout ?? null;
      waitForState.metadata = parsed.metadata ?? null;

      // Build confirmation message for the LLM
      let message = `Conversation paused. Waiting for: ${types.join(", ")}. Reason: ${parsed.reason}.`;
      if (parsed.timeout) {
        message += ` Timeout: ${parsed.timeout}.`;
      }

      return { content: message };
    },
  };
}

// ─── Helper ─────────────────────────────────────────────────────────────────

/**
 * Create a default (untriggered) WaitForState.
 *
 * Call this before each agent loop run to get a fresh state object.
 */
export function createDefaultWaitForState(): WaitForState {
  return {
    triggered: false,
    waitTypes: null,
    reason: null,
    timeout: null,
    metadata: null,
  };
}
