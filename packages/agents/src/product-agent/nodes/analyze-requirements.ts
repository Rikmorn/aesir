/**
 * Analyze Requirements Node
 *
 * LangGraph node that analyzes conversation to determine requirement completeness.
 * Uses LLM structured output to extract requirements and decide next steps.
 *
 * Key design decisions:
 * - Structured output with Zod schema for reliable extraction
 * - Updates state.requirements with extracted information
 * - Sets state.phase based on completeness analysis
 * - Accepts LLM via options for testability
 */

import { createLogger } from "@aesir/common";
import { ChatAnthropic } from "@langchain/anthropic";
import { z } from "zod";
import { ANALYZE_REQUIREMENTS_PROMPT } from "../prompts.js";
import type {
  ProductAgentPhase,
  ProductAgentState,
  ProductAgentStateUpdate,
  Requirements,
} from "../state.js";

const logger = createLogger({
  defaultContext: { module: "analyze-requirements" },
});

/**
 * Schema for requirement analysis output
 *
 * Note: Schema is intentionally flat (not nested) because LLMs are more reliable
 * with flat structured output. Nested objects can cause parsing failures.
 */
export const RequirementAnalysisSchema = z.object({
  // Analysis fields
  isComplete: z
    .boolean()
    .describe("Are requirements sufficient to create tasks?"),
  missingElements: z
    .array(z.string())
    .describe("What information is still needed"),
  nextQuestion: z
    .string()
    .nullable()
    .describe("Best next question to ask (null if complete)"),
  confidence: z
    .enum(["high", "medium", "low"])
    .describe("Confidence in understanding"),

  // Extracted requirements (flat, not nested)
  extractedWhat: z
    .string()
    .nullable()
    .describe("What needs to be built (null if not yet clear)"),
  extractedWhy: z
    .string()
    .nullable()
    .describe("Why it's needed - business value (null if not stated)"),
  extractedWho: z
    .string()
    .nullable()
    .describe("Who it's for - user persona (null if not specified)"),
  extractedAcceptanceCriteria: z
    .array(z.string())
    .describe("Criteria for when it's done"),
  extractedConstraints: z
    .array(z.string())
    .describe("Technical constraints or considerations"),
});

export type RequirementAnalysis = z.infer<typeof RequirementAnalysisSchema>;

/**
 * Options for the analyze requirements node
 */
export interface AnalyzeRequirementsNodeOptions {
  /** LLM instance for analysis (default: Claude Sonnet) */
  llm?: ChatAnthropic;
  /** Model name if creating default LLM */
  model?: string;
}

/**
 * Create the analyze requirements node with injected dependencies.
 *
 * @param options - Node options with optional LLM override
 * @returns Node function for LangGraph
 */
export function analyzeRequirementsNode(
  options: AnalyzeRequirementsNodeOptions = {},
) {
  return async (state: ProductAgentState): Promise<ProductAgentStateUpdate> => {
    const nodeLogger = logger.child({ node: "analyze-requirements" });

    nodeLogger.debug("analyze_requirements_start", {
      message: "Analyzing conversation for requirements",
      context: {
        messageCount: state.messages.length,
        currentPhase: state.phase,
      },
    });

    try {
      // Use provided LLM or create default
      const llm =
        options.llm ??
        new ChatAnthropic({
          model: options.model ?? "claude-sonnet-4-20250514",
        });

      // Bind structured output schema (explicit type breaks infinite inference)
      const structuredLlm = llm.withStructuredOutput<RequirementAnalysis>(
        RequirementAnalysisSchema,
      );

      // Invoke with system prompt and conversation
      const analysis = await structuredLlm.invoke([
        { role: "system", content: ANALYZE_REQUIREMENTS_PROMPT },
        ...state.messages,
      ]);

      nodeLogger.info("analyze_requirements_complete", {
        outcome: "success",
        message: `Requirements ${analysis.isComplete ? "complete" : "incomplete"}`,
        context: {
          isComplete: analysis.isComplete,
          confidence: analysis.confidence,
          missingCount: analysis.missingElements.length,
        },
      });

      // Determine next phase
      let nextPhase: ProductAgentPhase;
      if (analysis.isComplete && analysis.confidence !== "low") {
        // Ready to create tasks
        nextPhase = "creating";
      } else {
        // Need more clarification
        nextPhase = "clarifying";
      }

      // Build requirements update from extraction
      // The reducer handles partial updates via Partial<Requirements>
      const requirementsUpdate: Partial<Requirements> = {};

      // Only update fields that have values (flat schema)
      if (analysis.extractedWhat !== null) {
        requirementsUpdate.what = analysis.extractedWhat;
      }
      if (analysis.extractedWhy !== null) {
        requirementsUpdate.why = analysis.extractedWhy;
      }
      if (analysis.extractedWho !== null) {
        requirementsUpdate.who = analysis.extractedWho;
      }
      if (analysis.extractedAcceptanceCriteria.length > 0) {
        requirementsUpdate.acceptanceCriteria =
          analysis.extractedAcceptanceCriteria;
      }
      if (analysis.extractedConstraints.length > 0) {
        requirementsUpdate.constraints = analysis.extractedConstraints;
      }

      return {
        requirements: requirementsUpdate,
        phase: nextPhase,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Unknown error during analysis";

      nodeLogger.error("analyze_requirements_error", {
        outcome: "failure",
        message: errorMessage,
      });

      // On error, stay in gathering phase
      return {
        phase: "gathering" as ProductAgentPhase,
      };
    }
  };
}
