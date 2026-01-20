/**
 * Fix Code Node
 *
 * LangGraph node that uses LLM to fix code based on test failures.
 * Part of the Generator-Critic pattern where tests serve as the critic.
 *
 * Key design decisions:
 * - Uses structured output for reliable JSON parsing
 * - Includes test stdout/stderr in prompt for context
 * - Includes current file contents for minimal changes
 * - Returns FileChange[] for sandbox to write
 */

import { ChatAnthropic } from "@langchain/anthropic";
import { z } from "zod";
import { logger } from "../../logging/index.js";
import {
  type DevWorkflowStateType,
  FileChangeSchema,
} from "../../state/dev-workflow-state.js";

/**
 * Schema for fix code structured output
 */
export const FixCodeOutputSchema = z.object({
  files: z
    .array(FileChangeSchema)
    .describe("Corrected files with fixes applied"),
  reasoning: z
    .string()
    .describe("Explanation of what was wrong and how it was fixed"),
});

export type FixCodeOutput = z.infer<typeof FixCodeOutputSchema>;

/**
 * Build the prompt for code fixing
 */
function buildFixCodePrompt(state: DevWorkflowStateType): string {
  const testOutput = state.testResult
    ? `stdout: ${state.testResult.stdout}
stderr: ${state.testResult.stderr}`
    : "No test output available";

  const currentFiles = state.files
    .map((f) => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``)
    .join("\n\n");

  return `The tests failed. Fix the code.

Task: ${state.taskDescription}

Test output:
${testOutput}

Current files:
${currentFiles}

Generate corrected files. Make minimal changes to fix the specific error.
Focus on the test failure, not on adding unrelated improvements.

Output the corrected files array with path, content, and operation for each file.`;
}

/**
 * Options for the fix code node
 */
export interface FixCodeNodeOptions {
  /** LLM model to use (default: claude-sonnet-4-20250514) */
  model?: string;
  /** Override the LLM instance (for testing) */
  llm?: ChatAnthropic;
}

/**
 * Fix code node for the dev workflow
 *
 * Takes the current workflow state with test failures and generates fixes.
 * Returns FileChange[] with corrected code.
 *
 * @param state - Current dev workflow state with test result
 * @param options - Optional configuration (model override, test LLM)
 * @returns Partial state update with fixed files and status
 */
export async function fixCodeNode(
  state: DevWorkflowStateType,
  options: FixCodeNodeOptions = {},
): Promise<Partial<DevWorkflowStateType>> {
  const nodeLogger = logger.child({ node: "fix-code" });

  const timing = nodeLogger.startTimer("fix_code", {
    context: {
      taskId: state.taskId,
      testAttempts: state.testAttempts,
      fileCount: state.files.length,
    },
    message: `Fixing code for task: ${state.taskId}`,
  });

  try {
    // Use provided LLM or create a new one
    const llm =
      options.llm ??
      new ChatAnthropic({ model: options.model ?? "claude-sonnet-4-20250514" });

    // Bind structured output schema (explicit type breaks infinite inference)
    const structuredLlm =
      llm.withStructuredOutput<FixCodeOutput>(FixCodeOutputSchema);

    // Build prompt and invoke
    const prompt = buildFixCodePrompt(state);
    const result = await structuredLlm.invoke(prompt);

    nodeLogger.info("code_fixed", {
      context: {
        fileCount: result.files.length,
        reasoning: result.reasoning.slice(0, 200),
      },
      message: `Generated ${result.files.length} fixed file(s)`,
    });

    timing.success({
      context: { fileCount: result.files.length },
      message: "Code fix completed",
    });

    return {
      files: result.files,
      status: "testing" as const,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error during code fix";

    timing.failure({ message: errorMessage });

    return {
      status: "failed" as const,
      error: errorMessage,
    };
  }
}
