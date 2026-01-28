/**
 * Approval Intent Classification
 *
 * LLM-based classification for human responses to execution plans.
 * Enables natural language approval/rejection detection (e.g., "looks good",
 * "ship it", "hold on, missing tests") instead of requiring exact keywords.
 *
 * Used by both Slack message handlers and Linear comment handlers.
 *
 * Key design decisions:
 * - Structured output with Zod schema for reliable classification
 * - Extracts feedback for rejections to guide next steps
 * - Confidence levels enable routing unclear messages for clarification
 */

import { createPinoLogger, type PinoLogger } from "@aesir/common";
import type { ChatAnthropic } from "@langchain/anthropic";
import { z } from "zod";

const logger: PinoLogger = createPinoLogger({
  component: "agents:dev-agent:classification:approval",
});

/**
 * Intent types for approval classification
 */
export const ApprovalIntentSchema = z.enum([
  "approve",
  "reject",
  "unclear",
  "question",
  "guidance",
  "abort",
]);

export type ApprovalIntent = z.infer<typeof ApprovalIntentSchema>;

/**
 * Confidence levels for classification
 */
export const ApprovalConfidenceSchema = z.enum(["high", "medium", "low"]);

export type ApprovalConfidence = z.infer<typeof ApprovalConfidenceSchema>;

/**
 * Schema for approval classification output
 *
 * Uses flat structure for reliable LLM structured output.
 */
export const ApprovalClassificationSchema = z.object({
  /** The classified intent type */
  intent: ApprovalIntentSchema.describe(
    "The classified intent of the human response",
  ),
  /** Confidence in the classification */
  confidence: ApprovalConfidenceSchema.describe(
    "Confidence level in this classification",
  ),
  /** Extracted feedback if rejection or changes requested */
  feedback: z
    .string()
    .nullable()
    .describe(
      "Extracted feedback explaining concerns or requested changes, null if approving",
    ),
  /** Reasoning for the classification (for debugging/logging) */
  reasoning: z
    .string()
    .describe("Brief explanation of why this classification was chosen"),
});

export type ApprovalClassification = z.infer<
  typeof ApprovalClassificationSchema
>;

/**
 * System prompt for approval intent classification
 */
export const APPROVAL_CLASSIFICATION_PROMPT = `You are classifying a human response to an implementation plan.

The human was shown an execution plan for a development task and is responding.

Classify the response into one of these intents:

## approve
Indicates the human approves the plan and wants to proceed.

Examples:
- "looks good"
- "ship it"
- "approved"
- "go ahead"
- "LGTM" (looks good to me)
- "do it"
- "yes"
- "proceed"
- thumbs up emoji references
- "green light"
- "all good"

## reject
Indicates the human rejects the plan or requests changes before proceeding.

Examples:
- "no"
- "don't do this"
- "hold on"
- "wait"
- "missing tests"
- "need to add X first"
- "forgot about Y"
- "this won't work because..."
- "please also include..."
- "add error handling"
- "what about edge case X?"
- specific technical concerns

When rejecting, extract the feedback explaining their concerns.

## question
Indicates the human is asking for clarification, not approving or rejecting.

Examples:
- "what about X?"
- "did you consider Y?"
- "how will this handle Z?"
- "can you explain the approach?"
- "why did you choose this method?"
- clarifying questions about the plan

## unclear
Use when the response is ambiguous, off-topic, or cannot be determined.

Examples:
- random text
- unrelated topics
- "hmm" or single letters
- cannot determine intent

## guidance
Indicates the human is providing help, suggestions, or workarounds for a stuck/escalated task.
Use this when the agent has reported being stuck and the human is helping resolve it.

Examples:
- "try using mocks instead"
- "skip the tests for now"
- "the API endpoint changed to X"
- "you need to install Y first"
- "use this workaround: ..."
- "here's how to fix it: ..."
- "the issue is with Z, try..."
- technical suggestions or fixes
- workaround instructions

Extract the guidance text as feedback.

## abort
Indicates the human wants to stop/cancel the current task entirely.

Examples:
- "abort"
- "stop"
- "cancel this task"
- "don't bother"
- "forget it"
- "give up on this"
- "close the ticket"

## Guidelines

1. Be generous with approval detection - casual affirmatives like "sure", "ok", "fine" indicate approval
2. Extract specific feedback when rejecting - identify what changes or additions are requested
3. Questions about the plan are different from rejections - questions seek information, rejections block progress
4. Default to "unclear" when genuinely uncertain - it's safer to ask for clarification

Respond with the classification in the specified JSON format.`;

/**
 * Options for approval classification
 */
export interface ClassifyApprovalOptions {
  /** LLM instance for classification */
  llm: ChatAnthropic;
  /** The human's message to classify */
  message: string;
}

/**
 * Classify human response as approval intent.
 *
 * Uses LLM structured output for reliable natural language classification.
 *
 * @param options - Classification options with LLM and message
 * @returns Approval classification with intent, confidence, feedback, and reasoning
 */
export async function classifyApprovalIntent(
  options: ClassifyApprovalOptions,
): Promise<ApprovalClassification> {
  const { llm, message } = options;

  const classifyLogger = logger.child({ action: "classifyApprovalIntent" });

  classifyLogger.debug(
    { messageLength: message.length },
    "Classifying approval intent",
  );

  // Handle edge cases
  const trimmedMessage = message.trim();
  if (trimmedMessage.length === 0) {
    classifyLogger.debug("Empty message, returning unclear");
    return {
      intent: "unclear",
      confidence: "high",
      feedback: null,
      reasoning: "Empty message cannot be classified",
    };
  }

  // Truncate very long messages to avoid context limits
  const MAX_MESSAGE_LENGTH = 4000;
  const processedMessage =
    trimmedMessage.length > MAX_MESSAGE_LENGTH
      ? `${trimmedMessage.slice(0, MAX_MESSAGE_LENGTH)}... [truncated]`
      : trimmedMessage;

  try {
    // Bind structured output schema
    const structuredLlm = llm.withStructuredOutput<ApprovalClassification>(
      ApprovalClassificationSchema,
    );

    // Invoke with system prompt and user message
    const classification = await structuredLlm.invoke([
      { role: "system", content: APPROVAL_CLASSIFICATION_PROMPT },
      { role: "user", content: processedMessage },
    ]);

    classifyLogger.info(
      {
        intent: classification.intent,
        confidence: classification.confidence,
        hasFeedback: classification.feedback !== null,
      },
      `Classified as ${classification.intent} (${classification.confidence} confidence)`,
    );

    return classification;
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : "Unknown error during classification";

    classifyLogger.error({ err: error }, errorMessage);

    // On error, return unclear with low confidence
    return {
      intent: "unclear",
      confidence: "low",
      feedback: null,
      reasoning: `Classification failed: ${errorMessage}`,
    };
  }
}
