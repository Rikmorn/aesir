/**
 * Classify Node
 *
 * LangGraph node that classifies incoming messages to determine intent.
 * Filters messages into actionable (feature_request, bug_report) vs
 * non-actionable (question, off_topic, unclear) before entering the
 * conversation workflow.
 *
 * Key design decisions:
 * - Structured output with Zod schema for reliable classification
 * - Updates state.classification and state.classificationConfidence
 * - Sets state.phase based on classification type
 * - Non-actionable messages get polite decline responses
 * - LLM errors fall back to gathering phase (conservative approach)
 */

import { createPinoLogger, type PinoLogger } from "@aesir/common";
import { ChatAnthropic } from "@langchain/anthropic";
import { z } from "zod";
import { CLASSIFY_MESSAGE_PROMPT } from "../prompts.js";
import {
  type ClassificationConfidence,
  ClassificationConfidenceSchema,
  type ClassificationType,
  ClassificationTypeSchema,
  type ProductAgentPhase,
  type ProductAgentState,
  type ProductAgentStateUpdate,
} from "../state.js";

const logger: PinoLogger = createPinoLogger({
  component: "agents:product-agent:classify",
});

/**
 * Schema for classification output
 *
 * Uses flat structure for reliable LLM structured output.
 */
export const ClassificationOutputSchema = z.object({
  /** The classified message type */
  type: ClassificationTypeSchema,
  /** Confidence in the classification */
  confidence: ClassificationConfidenceSchema,
  /** Reasoning for the classification (for debugging) */
  reasoning: z
    .string()
    .describe("Brief explanation of why this classification"),
  /** Response to send if declining (for question/off_topic/unclear) */
  response: z
    .string()
    .nullable()
    .describe("Polite response if not proceeding, null if actionable"),
});

export type ClassificationOutput = z.infer<typeof ClassificationOutputSchema>;

/**
 * Options for the classify node
 */
export interface ClassifyNodeOptions {
  /** LLM instance for classification (default: Claude Sonnet) */
  llm?: ChatAnthropic;
  /** Model name if creating default LLM */
  model?: string;
}

/**
 * Decline responses for non-actionable message types
 */
const DECLINE_RESPONSES: Record<string, string> = {
  question:
    "I help create Linear issues for features and bugs. For questions, I'd suggest asking the team directly or checking our documentation.",
  off_topic:
    "I'm focused on helping with feature requests and bug reports. For other topics, the team can help!",
};

/**
 * Strip Slack mention patterns from text (e.g., <@U12345678>)
 */
function stripSlackMentions(text: string): string {
  return text.replace(/<@[A-Z0-9]+>/g, "").trim();
}

/**
 * Check if message text indicates user wants to confirm
 */
function isConfirmationMessage(text: string): boolean {
  const confirmPhrases = [
    "confirm",
    "yes",
    "approved",
    "approve",
    "looks good",
    "lgtm",
    "go ahead",
    "create it",
    "create the issue",
    "ship it",
    "do it",
  ];

  // Strip Slack mentions before checking (e.g., "<@U12345678> confirm" → "confirm")
  const lowerText = stripSlackMentions(text).toLowerCase().trim();
  return confirmPhrases.some(
    (phrase) =>
      lowerText === phrase ||
      lowerText.startsWith(`${phrase} `) ||
      lowerText.startsWith(`${phrase},`) ||
      lowerText.startsWith(`${phrase}!`),
  );
}

/**
 * Create the classify node with injected dependencies.
 *
 * @param options - Node options with optional LLM override
 * @returns Node function for LangGraph
 */
export function classifyNode(options: ClassifyNodeOptions = {}) {
  return async (state: ProductAgentState): Promise<ProductAgentStateUpdate> => {
    const nodeLogger = logger.child({ node: "classify" });

    nodeLogger.debug(
      {
        messageCount: state.messages.length,
        awaitingConfirmation: state.awaitingConfirmation,
      },
      "Classifying incoming message",
    );

    // If awaiting confirmation, check for confirmation response
    if (state.awaitingConfirmation && state.issueDraft) {
      const lastMessage = state.messages[state.messages.length - 1];
      const messageText =
        typeof lastMessage?.content === "string" ? lastMessage.content : "";

      if (isConfirmationMessage(messageText)) {
        nodeLogger.info(
          { messageText: messageText.slice(0, 50) },
          "User confirmed issue creation",
        );
        return {
          phase: "creating" as ProductAgentPhase,
          awaitingConfirmation: false,
        };
      }

      // Not a confirmation - user might have feedback
      // Reset awaitingConfirmation and let normal flow handle it
      nodeLogger.info(
        { messageText: messageText.slice(0, 50) },
        "User provided feedback instead of confirmation",
      );
    }

    try {
      // Use provided LLM or create default
      const llm =
        options.llm ??
        new ChatAnthropic({
          model: options.model ?? "claude-sonnet-4-20250514",
        });

      // Bind structured output schema
      const structuredLlm = llm.withStructuredOutput<ClassificationOutput>(
        ClassificationOutputSchema,
      );

      // Invoke with system prompt and conversation
      const classification = await structuredLlm.invoke([
        { role: "system", content: CLASSIFY_MESSAGE_PROMPT },
        ...state.messages,
      ]);

      nodeLogger.info(
        {
          type: classification.type,
          confidence: classification.confidence,
          reasoning: classification.reasoning,
        },
        `Message classified as ${classification.type}`,
      );

      // Determine next phase and response based on classification
      const result = determineNextPhase(classification, nodeLogger);

      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Unknown error during classification";

      nodeLogger.error({ err: error }, errorMessage);

      // On error, fall back to gathering phase (conservative approach)
      // The analyze-requirements node can handle ambiguous input
      return {
        phase: "gathering" as ProductAgentPhase,
        classification: null,
        classificationConfidence: null,
      };
    }
  };
}

/**
 * Determine next phase based on classification result
 */
function determineNextPhase(
  classification: ClassificationOutput,
  nodeLogger: PinoLogger,
): ProductAgentStateUpdate {
  const { type, confidence, response } = classification;

  // Low confidence on any type -> clarifying
  if (confidence === "low") {
    nodeLogger.debug("Low confidence, requesting clarification");
    return {
      classification: type as ClassificationType,
      classificationConfidence: confidence as ClassificationConfidence,
      phase: "clarifying" as ProductAgentPhase,
    };
  }

  // Actionable types -> gathering
  if (type === "feature_request" || type === "bug_report") {
    return {
      classification: type as ClassificationType,
      classificationConfidence: confidence as ClassificationConfidence,
      phase: "gathering" as ProductAgentPhase,
    };
  }

  // Non-actionable types -> declined
  if (type === "question" || type === "off_topic") {
    const declineResponse = response ?? DECLINE_RESPONSES[type];
    nodeLogger.debug(
      { response: declineResponse },
      "Non-actionable message, declining",
    );
    return {
      classification: type as ClassificationType,
      classificationConfidence: confidence as ClassificationConfidence,
      phase: "declined" as ProductAgentPhase,
    };
  }

  // Unclear -> clarifying
  if (type === "unclear") {
    const clarifyResponse =
      response ??
      "Could you tell me more about what you're looking for? I can help with feature requests and bug reports.";
    nodeLogger.debug(
      { response: clarifyResponse },
      "Unclear message, requesting clarification",
    );
    return {
      classification: type as ClassificationType,
      classificationConfidence: confidence as ClassificationConfidence,
      phase: "clarifying" as ProductAgentPhase,
    };
  }

  // Fallback (shouldn't reach here due to Zod validation)
  nodeLogger.warn(
    { type },
    "Unknown classification type, defaulting to gathering",
  );
  return {
    classification: null,
    classificationConfidence: null,
    phase: "gathering" as ProductAgentPhase,
  };
}
