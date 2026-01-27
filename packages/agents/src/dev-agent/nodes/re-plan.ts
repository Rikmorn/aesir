/**
 * Re-Plan Node
 *
 * Handles plan rejection and generates revised plans based on feedback.
 * When a human rejects a plan, this node:
 * 1. Extracts feedback from state
 * 2. If no feedback, asks for clarification via Slack
 * 3. Generates revised plan using existing research context
 * 4. Posts revised plan to Slack thread only (NOT Linear)
 *
 * Design: Revised plans stay in Slack thread for iteration speed.
 * Only the final approved plan gets posted to Linear.
 */

import { createPinoLogger, type PinoLogger } from "@aesir/common";
import { ChatAnthropic } from "@langchain/anthropic";
import { callMcpTool } from "../../mcp/index.js";
import type { DevAgentState, ExecutionPlan } from "../state.js";
import { ExecutionPlanSchema } from "../state.js";

const logger: PinoLogger = createPinoLogger({
  component: "agents:dev-agent:re-plan",
});

/**
 * System prompt for re-planning after rejection.
 *
 * Guides the LLM to revise the plan based on human feedback.
 */
const RE_PLAN_SYSTEM_PROMPT = `You are revising an implementation plan based on human feedback.

Your task is to:
1. Understand the feedback provided
2. Identify what needs to change in the original plan
3. Generate a revised plan that addresses all feedback

IMPORTANT GUIDELINES:
- If feedback suggests the approach is fundamentally wrong, redesign it
- If feedback is about missing details, add them
- If feedback requests different scope, adjust accordingly
- Preserve what was good about the original plan
- Use the research context - don't ignore existing patterns

CONFIDENCE ADJUSTMENT:
- If you're less certain after feedback, lower your confidence
- If feedback clarified unknowns, you may increase confidence
- Be honest about remaining gaps

The revised plan should be complete and self-contained.
The reviewer will see only the revised plan, not the original.`;

export interface RePlanNodeDeps {
  llm?: ChatAnthropic;
  slackChannel: string;
}

/**
 * Format revised plan for Slack thread posting.
 *
 * Shows what changed from the original plan and requests approval.
 */
function formatRevisedPlanForSlack(
  plan: ExecutionPlan,
  feedback: string,
): string {
  const confidenceEmoji =
    plan.confidence === "high"
      ? "HIGH"
      : plan.confidence === "medium"
        ? "MEDIUM"
        : "LOW";

  const stepsText = plan.steps
    .map((step, i) => `${i + 1}. ${step.description}`)
    .join("\n");

  const risksText =
    plan.risks.length > 0
      ? `*Risks:* ${plan.risks.join("; ")}`
      : "*Risks:* None identified";

  return `*Revised Plan*

Based on your feedback:
> ${feedback.slice(0, 200)}${feedback.length > 200 ? "..." : ""}

*${plan.title}*

${plan.summary}

*Confidence:* ${confidenceEmoji}
${plan.confidence !== "high" ? plan.confidenceReasoning : ""}

*Steps:*
${stepsText}

*Estimated Changes:* ${plan.estimatedChanges}
${risksText}

---
Please review and approve or provide further feedback.`;
}

/**
 * Create the re-plan node for handling plan rejections.
 *
 * Flow:
 * 1. Check for feedback - if missing, ask for clarification
 * 2. Generate revised plan using LLM with original context
 * 3. Post revised plan to Slack thread
 * 4. Return to awaiting approval state
 *
 * @param deps - Dependencies including optional LLM and Slack channel
 * @returns Node function for LangGraph
 */
export function createRePlanNode(deps: RePlanNodeDeps) {
  const { slackChannel } = deps;

  return async function rePlanNode(
    state: DevAgentState,
  ): Promise<Partial<DevAgentState>> {
    const {
      taskId,
      issue,
      approvalFeedback,
      executionPlan,
      researchContext,
      slackMessageTs,
    } = state;
    const nodeLogger = logger.child({ taskId });
    const correlationId = `replan-${taskId}`;

    if (!issue) {
      return { phase: "failed", errorMessage: "No issue for re-planning" };
    }

    if (!executionPlan) {
      return {
        phase: "failed",
        errorMessage: "No original plan to revise",
      };
    }

    if (!researchContext) {
      return {
        phase: "failed",
        errorMessage: "No research context for re-planning",
      };
    }

    nodeLogger.info(
      { identifier: issue.identifier, hasFeeedback: !!approvalFeedback },
      "Re-planning after rejection",
    );

    // Case 1: No feedback provided - ask for clarification
    if (!approvalFeedback) {
      nodeLogger.info("No feedback provided, requesting clarification");

      try {
        await callMcpTool({
          integration: "slack",
          tool: "reply_to_thread",
          params: {
            channel: slackChannel,
            threadTs: slackMessageTs,
            text: "Got it - I understand you'd like changes to the plan. What would you like me to change?",
          },
          agentId: "dev-agent",
          correlationId,
        });
      } catch (err) {
        nodeLogger.warn(
          { err },
          "Failed to post clarification request to Slack",
        );
      }

      return {
        phase: "awaiting_approval",
        approvalStatus: "changes_requested",
      };
    }

    // Case 2: Feedback provided - generate revised plan
    nodeLogger.info(
      { feedbackLength: approvalFeedback.length },
      "Generating revised plan from feedback",
    );

    try {
      const llm =
        deps.llm ??
        new ChatAnthropic({
          modelName: "claude-sonnet-4-20250514",
          temperature: 0,
        });

      const structuredLlm = llm.withStructuredOutput(ExecutionPlanSchema);

      const userPrompt = `# Original Plan
${JSON.stringify(executionPlan, null, 2)}

# Feedback from Reviewer
${approvalFeedback}

# Research Context (use this for patterns and constraints)
## Relevant Files
${researchContext.relevantFiles.map((f) => `- ${f.path}: ${f.purpose}`).join("\n")}

## Existing Patterns
${researchContext.existingPatterns.map((p) => `- ${p}`).join("\n")}

## Dependencies
${researchContext.dependencies.map((d) => `- ${d}`).join("\n")}

## Known Risks
${researchContext.risks.map((r) => `- ${r}`).join("\n")}

## Unknowns
${researchContext.unknowns.map((u) => `- ${u}`).join("\n")}

---

Generate a revised plan that addresses the feedback while maintaining quality.
If the feedback fundamentally changes the approach, redesign accordingly.`;

      const revisedPlan = await structuredLlm.invoke([
        { role: "system", content: RE_PLAN_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ]);

      nodeLogger.info(
        {
          stepCount: revisedPlan.steps.length,
          confidence: revisedPlan.confidence,
        },
        "Revised plan generated",
      );

      // Post revised plan to Slack thread (NOT Linear)
      const slackText = formatRevisedPlanForSlack(
        revisedPlan,
        approvalFeedback,
      );

      try {
        await callMcpTool({
          integration: "slack",
          tool: "reply_to_thread",
          params: {
            channel: slackChannel,
            threadTs: slackMessageTs,
            text: slackText,
          },
          agentId: "dev-agent",
          correlationId,
        });
      } catch (slackErr) {
        nodeLogger.warn(
          { err: slackErr },
          "Failed to post revised plan to Slack",
        );
        // Continue anyway - plan is still generated
      }

      return {
        executionPlan: revisedPlan,
        phase: "awaiting_approval",
        approvalStatus: "pending",
        approvalFeedback: null, // Clear feedback for next iteration
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      nodeLogger.error({ err: error }, "Re-planning failed");
      return { phase: "failed", errorMessage: `Re-planning error: ${message}` };
    }
  };
}
