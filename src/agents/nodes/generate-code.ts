/**
 * Code Generation Node
 *
 * LangGraph node that generates code using LLM structured output.
 * Produces FileChange[] that can be written to sandbox for testing.
 *
 * Key design decisions:
 * - Uses withStructuredOutput for reliable JSON parsing
 * - Returns FileChange[] for multi-file operations
 * - Includes reasoning for debugging/logging
 * - Separate schema for code generation output vs file changes
 */

import { ChatAnthropic } from "@langchain/anthropic";
import { z } from "zod";
import {
  FileChangeSchema,
  type DevWorkflowStateType,
} from "../../state/dev-workflow-state.js";
import { logger } from "../../logging/index.js";

/**
 * Schema for code generation structured output
 */
export const CodeGenerationOutputSchema = z.object({
  files: z
    .array(FileChangeSchema)
    .describe("Files to create or modify for this task"),
  reasoning: z
    .string()
    .describe("Explanation of the implementation approach"),
});

export type CodeGenerationOutput = z.infer<typeof CodeGenerationOutputSchema>;

/**
 * Build the prompt for code generation
 */
function buildCodeGenPrompt(taskDescription: string): string {
  return `You are implementing a task for a TypeScript project.

Task: ${taskDescription}

Generate the files needed to implement this task.

Requirements:
- Each file should be complete and ready to run
- Follow TypeScript best practices
- Include appropriate type annotations
- Add JSDoc comments for public APIs
- Use ES module imports (import/export)
- Follow the .js extension convention for imports

Output the files array with path, content, and operation for each file.
For new files, use operation "create".
For modifying existing files, use operation "update" with the complete new content.`;
}

/**
 * Options for the generate code node
 */
export interface GenerateCodeNodeOptions {
  /** LLM model to use (default: claude-sonnet-4-20250514) */
  model?: string;
  /** Override the LLM instance (for testing) */
  llm?: ChatAnthropic;
}

/**
 * Generate code node for the dev workflow
 *
 * Takes the current workflow state and generates code based on the task description.
 * Returns FileChange[] in structured output format.
 *
 * @param state - Current dev workflow state
 * @param options - Optional configuration (model override, test LLM)
 * @returns Partial state update with files and status
 */
export async function generateCodeNode(
  state: DevWorkflowStateType,
  options: GenerateCodeNodeOptions = {}
): Promise<Partial<DevWorkflowStateType>> {
  const nodeLogger = logger.child({ node: "generate-code" });

  const timing = nodeLogger.startTimer("generate_code", {
    context: {
      taskId: state.taskId,
      taskDescriptionLength: state.taskDescription.length,
    },
    message: `Generating code for task: ${state.taskId}`,
  });

  try {
    // Use provided LLM or create a new one
    const llm =
      options.llm ?? new ChatAnthropic({ model: options.model ?? "claude-sonnet-4-20250514" });

    // Bind structured output schema (explicit type breaks infinite inference)
    const structuredLlm = llm.withStructuredOutput<CodeGenerationOutput>(CodeGenerationOutputSchema);

    // Build prompt and invoke
    const prompt = buildCodeGenPrompt(state.taskDescription);
    const result = await structuredLlm.invoke(prompt);

    nodeLogger.info("code_generated", {
      context: {
        fileCount: result.files.length,
        reasoning: result.reasoning.slice(0, 200),
      },
      message: `Generated ${result.files.length} file(s)`,
    });

    timing.success({
      context: { fileCount: result.files.length },
      message: "Code generation completed",
    });

    return {
      files: result.files,
      status: "testing" as const,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error during code generation";

    timing.failure({ message: errorMessage });

    return {
      status: "failed" as const,
      error: errorMessage,
    };
  }
}
