/**
 * Confirm Node
 *
 * LangGraph node that generates an issue draft for user confirmation.
 * Shows a formatted preview before creating the issue in Linear.
 *
 * Key design decisions:
 * - Structured output with Zod schema for reliable draft generation
 * - Builds context from state.requirements for LLM prompt
 * - Returns Slack-formatted preview message with confirmation instructions
 * - Sets awaitingConfirmation flag for workflow routing
 */

import { createPinoLogger, type PinoLogger } from "@aesir/common";
import { ChatAnthropic } from "@langchain/anthropic";
import { AIMessage } from "@langchain/core/messages";
import { z } from "zod";
import { GENERATE_ISSUE_DRAFT_PROMPT } from "../prompts.js";
import {
  type IssueDraft,
  IssueDraftSchema,
  IssuePrioritySchema,
  type ProductAgentPhase,
  type ProductAgentState,
  type ProductAgentStateUpdate,
} from "../state.js";

const logger: PinoLogger = createPinoLogger({
  component: "agents:product-agent:confirm",
});

/**
 * Schema for LLM issue draft output
 * Matches IssueDraftSchema but with explicit descriptions for structured output
 */
export const IssueDraftOutputSchema = z.object({
  title: z.string().describe("Clear, actionable issue title"),
  description: z
    .string()
    .describe("Detailed description with context about what and why"),
  acceptanceCriteria: z
    .array(z.string())
    .describe("Specific, testable conditions for done"),
  priority: IssuePrioritySchema.describe("Priority level based on urgency"),
  labels: z
    .array(z.string())
    .describe("Relevant labels like feature, bug, frontend, backend"),
});

export type IssueDraftOutput = z.infer<typeof IssueDraftOutputSchema>;

/**
 * Options for the confirm node
 */
export interface ConfirmNodeOptions {
  /** LLM instance for draft generation (default: Claude Sonnet) */
  llm?: ChatAnthropic;
  /** Model name if creating default LLM */
  model?: string;
}

/**
 * Build context string from gathered requirements for the LLM prompt.
 */
function buildRequirementsContext(state: ProductAgentState): string {
  const parts: string[] = [
    "Generate an issue draft based on these gathered requirements:",
    "",
  ];

  if (state.requirements.what) {
    parts.push("## What to Build");
    parts.push(state.requirements.what);
    parts.push("");
  }

  if (state.requirements.why) {
    parts.push("## Why It's Needed");
    parts.push(state.requirements.why);
    parts.push("");
  }

  if (state.requirements.who) {
    parts.push("## Target Users");
    parts.push(state.requirements.who);
    parts.push("");
  }

  if (state.requirements.acceptanceCriteria.length > 0) {
    parts.push("## Acceptance Criteria (from conversation)");
    for (const ac of state.requirements.acceptanceCriteria) {
      parts.push(`- ${ac}`);
    }
    parts.push("");
  }

  if (state.requirements.constraints.length > 0) {
    parts.push("## Constraints");
    for (const c of state.requirements.constraints) {
      parts.push(`- ${c}`);
    }
    parts.push("");
  }

  return parts.join("\n");
}

/**
 * Build Slack-formatted preview message from the issue draft.
 */
function buildPreviewMessage(draft: IssueDraft): string {
  const lines: string[] = [
    "I'll create this issue:",
    "",
    `*Title:* ${draft.title}`,
    "",
    "*Description:*",
    draft.description,
    "",
    "*Acceptance Criteria:*",
  ];

  for (const criterion of draft.acceptanceCriteria) {
    lines.push(`- [ ] ${criterion}`);
  }

  lines.push("");
  lines.push(`*Priority:* ${draft.priority}`);

  if (draft.labels.length > 0) {
    lines.push(`*Labels:* ${draft.labels.join(", ")}`);
  }

  lines.push("");
  lines.push('Reply "confirm" to create, or provide feedback to revise.');

  return lines.join("\n");
}

/**
 * Build Slack thread URL from context (if available).
 */
function buildSlackThreadUrl(state: ProductAgentState): string | null {
  if (!state.slackContext) {
    return null;
  }

  const { channelId, threadTs } = state.slackContext;

  if (!threadTs) {
    return null;
  }

  // Standard Slack deep link format
  // Note: This is a workspace-agnostic URL pattern
  // Full URL would be: https://{workspace}.slack.com/archives/{channelId}/p{threadTs}
  // We use a simplified format that works within the workspace context
  return `slack://channel?team=&id=${channelId}&message=${threadTs.replace(".", "")}`;
}

/**
 * Create the confirm node with injected dependencies.
 *
 * @param options - Node options with optional LLM override
 * @returns Node function for LangGraph
 */
export function confirmNode(options: ConfirmNodeOptions = {}) {
  return async (state: ProductAgentState): Promise<ProductAgentStateUpdate> => {
    const nodeLogger = logger.child({ node: "confirm" });

    nodeLogger.debug(
      {
        messageCount: state.messages.length,
        hasWhat: state.requirements.what !== null,
        hasWhy: state.requirements.why !== null,
      },
      "Generating issue draft for confirmation",
    );

    try {
      // Use provided LLM or create default
      const llm =
        options.llm ??
        new ChatAnthropic({
          model: options.model ?? "claude-sonnet-4-20250514",
        });

      // Bind structured output schema
      const structuredLlm = llm.withStructuredOutput<IssueDraftOutput>(
        IssueDraftOutputSchema,
      );

      // Build context from requirements
      const requirementsContext = buildRequirementsContext(state);

      // Generate draft
      const draftOutput = await structuredLlm.invoke([
        { role: "system", content: GENERATE_ISSUE_DRAFT_PROMPT },
        ...state.messages,
        { role: "user", content: requirementsContext },
      ]);

      // Build complete draft with Slack thread URL
      const issueDraft: IssueDraft = {
        title: draftOutput.title,
        description: draftOutput.description,
        acceptanceCriteria: draftOutput.acceptanceCriteria,
        priority: draftOutput.priority,
        labels: draftOutput.labels,
        slackThreadUrl: buildSlackThreadUrl(state),
      };

      // Validate the draft against schema
      IssueDraftSchema.parse(issueDraft);

      nodeLogger.info(
        {
          title: issueDraft.title,
          priority: issueDraft.priority,
          criteriaCount: issueDraft.acceptanceCriteria.length,
          labelCount: issueDraft.labels.length,
        },
        `Generated issue draft: ${issueDraft.title}`,
      );

      // Build preview message for Slack
      const previewMessage = buildPreviewMessage(issueDraft);

      return {
        issueDraft,
        awaitingConfirmation: true,
        phase: "confirming" as ProductAgentPhase,
        messages: [new AIMessage(previewMessage)],
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Unknown error during draft generation";

      nodeLogger.error({ err: error }, errorMessage);

      // On error, fall back to gathering phase
      return {
        phase: "gathering" as ProductAgentPhase,
      };
    }
  };
}
