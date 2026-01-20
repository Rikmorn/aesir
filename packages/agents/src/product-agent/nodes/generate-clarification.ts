/**
 * Generate Clarification Node
 *
 * LangGraph node that generates focused follow-up questions.
 * Uses the analysis results to ask the most relevant clarifying question.
 *
 * Key design decisions:
 * - Generates a natural, conversational follow-up question
 * - Adds AI message to state.messages for conversation continuity
 * - Keeps phase as 'clarifying' until requirements complete
 * - Accepts LLM via options for testability
 */

import { ChatAnthropic } from "@langchain/anthropic";
import { AIMessage } from "@langchain/core/messages";
import { createLogger } from "@aesir/common";
import { GENERATE_CLARIFICATION_PROMPT } from "../prompts.js";
import type {
  ProductAgentPhase,
  ProductAgentState,
  ProductAgentStateUpdate,
} from "../state.js";

const logger = createLogger({
  defaultContext: { module: "generate-clarification" },
});

/**
 * Options for the generate clarification node
 */
export interface GenerateClarificationNodeOptions {
  /** LLM instance for generation (default: Claude Sonnet) */
  llm?: ChatAnthropic;
  /** Model name if creating default LLM */
  model?: string;
}

/**
 * Create the generate clarification node with injected dependencies.
 *
 * @param options - Node options with optional LLM override
 * @returns Node function for LangGraph
 */
export function generateClarificationNode(
  options: GenerateClarificationNodeOptions = {},
) {
  return async (state: ProductAgentState): Promise<ProductAgentStateUpdate> => {
    const nodeLogger = logger.child({ node: "generate-clarification" });

    nodeLogger.debug("generate_clarification_start", {
      message: "Generating clarifying question",
      context: {
        messageCount: state.messages.length,
        requirementsWhat: state.requirements.what !== null,
        requirementsWhy: state.requirements.why !== null,
      },
    });

    try {
      // Use provided LLM or create default
      const llm =
        options.llm ??
        new ChatAnthropic({
          model: options.model ?? "claude-sonnet-4-20250514",
        });

      // Build context for the clarification prompt
      const contextMessage = buildClarificationContext(state);

      // Invoke to generate the clarifying question
      const response = await llm.invoke([
        { role: "system", content: GENERATE_CLARIFICATION_PROMPT },
        ...state.messages,
        { role: "user", content: contextMessage },
      ]);

      // Extract the content from the response
      const questionContent =
        typeof response.content === "string"
          ? response.content
          : Array.isArray(response.content)
            ? response.content
                .map((c) =>
                  typeof c === "string" ? c : "text" in c ? c.text : "",
                )
                .join("")
            : "";

      nodeLogger.info("generate_clarification_complete", {
        outcome: "success",
        message: "Generated clarifying question",
        context: {
          questionLength: questionContent.length,
        },
      });

      // Create AI message for the conversation
      const aiMessage = new AIMessage(questionContent);

      return {
        messages: [aiMessage],
        phase: "clarifying" as ProductAgentPhase,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Unknown error during clarification";

      nodeLogger.error("generate_clarification_error", {
        outcome: "failure",
        message: errorMessage,
      });

      // On error, create a generic fallback question
      const fallbackMessage = new AIMessage(
        "I want to make sure I understand correctly. Could you tell me more about what you're trying to build?",
      );

      return {
        messages: [fallbackMessage],
        phase: "clarifying" as ProductAgentPhase,
      };
    }
  };
}

/**
 * Build context for the clarification prompt based on current state.
 */
function buildClarificationContext(state: ProductAgentState): string {
  const parts: string[] = [
    "Based on the conversation, here's what I understand so far:",
  ];

  if (state.requirements.what) {
    parts.push(`- What to build: ${state.requirements.what}`);
  }
  if (state.requirements.why) {
    parts.push(`- Why it's needed: ${state.requirements.why}`);
  }
  if (state.requirements.who) {
    parts.push(`- For whom: ${state.requirements.who}`);
  }
  if (state.requirements.acceptanceCriteria.length > 0) {
    parts.push(
      `- Acceptance criteria: ${state.requirements.acceptanceCriteria.join(", ")}`,
    );
  }
  if (state.requirements.constraints.length > 0) {
    parts.push(`- Constraints: ${state.requirements.constraints.join(", ")}`);
  }

  // What's missing
  const missing: string[] = [];
  if (!state.requirements.what) {
    missing.push("what specifically needs to be built");
  }
  if (!state.requirements.why) {
    missing.push("why this is needed (the problem it solves)");
  }
  if (state.requirements.acceptanceCriteria.length === 0) {
    missing.push("how we'll know it's done (acceptance criteria)");
  }

  if (missing.length > 0) {
    parts.push("");
    parts.push("I still need to understand:");
    missing.forEach((m) => parts.push(`- ${m}`));
  }

  parts.push("");
  parts.push(
    "Generate a single, focused follow-up question to gather the most important missing information.",
  );

  return parts.join("\n");
}
