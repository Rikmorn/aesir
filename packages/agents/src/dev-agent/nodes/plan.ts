/**
 * Planning Node
 *
 * Creates ExecutionPlan from ResearchContext.
 * This is the "competent junior developer" planning phase - converting
 * research into a concrete, reviewable implementation plan.
 *
 * Implements DEV-05, DEV-06, DEV-07 from the dev-agent workflow spec.
 */

import { createPinoLogger, type PinoLogger } from "@aesir/common";
import { ChatAnthropic } from "@langchain/anthropic";
import { buildPlanningPrompt, PLANNING_SYSTEM_PROMPT } from "../prompts.js";
import type { DevAgentState } from "../state.js";
import { ExecutionPlanSchema } from "../state.js";

const logger: PinoLogger = createPinoLogger({
  component: "agents:dev-agent:plan",
});

export interface PlanNodeDeps {
  llm?: ChatAnthropic;
}

/**
 * Node that creates ExecutionPlan from research context.
 *
 * The plan includes:
 * - Concrete steps to implement
 * - Files to create/modify per step
 * - Test strategy per step
 * - Confidence level (high/medium/low) with reasoning
 *
 * On success: Sets executionPlan, phase to "awaiting_approval"
 * On failure: Sets phase to "failed" with error message
 */
export function createPlanNode(deps: PlanNodeDeps = {}) {
  const llm =
    deps.llm ??
    new ChatAnthropic({
      modelName: "claude-sonnet-4-20250514",
      temperature: 0,
    });

  return async function planNode(
    state: DevAgentState,
  ): Promise<Partial<DevAgentState>> {
    const { taskId, issue, researchContext } = state;
    const nodeLogger = logger.child({ taskId });

    if (!issue) {
      return { phase: "failed", errorMessage: "No issue for planning" };
    }

    if (!researchContext) {
      return {
        phase: "failed",
        errorMessage: "No research context for planning",
      };
    }

    nodeLogger.info(
      { identifier: issue.identifier },
      "Creating execution plan",
    );

    try {
      const structuredLlm = llm.withStructuredOutput(ExecutionPlanSchema);
      const prompt = buildPlanningPrompt({
        taskTitle: issue.title,
        taskDescription: issue.description || "",
        researchContext,
      });

      const executionPlan = await structuredLlm.invoke([
        { role: "system", content: PLANNING_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ]);

      nodeLogger.info(
        {
          stepCount: executionPlan.steps.length,
          confidence: executionPlan.confidence,
        },
        "Execution plan created",
      );

      // Log confidence reasoning for visibility
      if (executionPlan.confidence === "low") {
        nodeLogger.warn(
          { reasoning: executionPlan.confidenceReasoning },
          "Plan has low confidence - gaps visible to reviewer",
        );
      }

      return {
        executionPlan,
        phase: "awaiting_approval",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      nodeLogger.error({ err: error }, "Planning failed");
      return { phase: "failed", errorMessage: `Planning error: ${message}` };
    }
  };
}
