/**
 * Execute Node
 *
 * Executes the approved plan: writes files, runs tests, commits.
 * This is the "competent junior developer" execution phase - implementing
 * the approved plan step by step with test validation.
 *
 * Implements DEV-10 through DEV-12 from the dev-agent workflow spec.
 */

import { createPinoLogger, type PinoLogger } from "@aesir/common";
import type { DevContainerManager } from "@aesir/platform";
import { DEV_CONTAINER_TIMEOUTS } from "@aesir/platform";
import { ChatAnthropic } from "@langchain/anthropic";
import { z } from "zod";
import { buildFileWritePrompt, FILE_WRITE_SYSTEM_PROMPT } from "../prompts.js";
import type { DevAgentState, ExecutionPlan } from "../state.js";

const logger: PinoLogger = createPinoLogger({
  component: "agents:dev-agent:execute",
});

/** Max self-fix attempts before escalation */
const MAX_FIX_ATTEMPTS = 3;

/**
 * Patterns indicating unfixable issues that should escalate immediately.
 * These are environment/infrastructure issues, not code bugs.
 */
const UNFIXABLE_PATTERNS = [
  "ECONNREFUSED",
  "ENOENT",
  "Permission denied",
  "Cannot find module",
  "Docker",
  "OOM",
  "ENOMEM",
];

export interface ExecuteNodeDeps {
  manager: DevContainerManager;
  llm?: ChatAnthropic;
}

/** Schema for file generation output */
const FileContentSchema = z.object({
  content: z.string().describe("Complete file content"),
});

/**
 * Node that executes the approved plan.
 *
 * For each step:
 * 1. Generate file content via LLM
 * 2. Write file via heredoc (unique delimiter to avoid injection)
 * 3. Run affected tests
 * 4. If tests fail, attempt fix (up to 3 times)
 * 5. If unfixable pattern detected, escalate immediately
 * 6. Commit changes atomically
 *
 * On success: Sets phase to "verifying"
 * On test failure (exhausted retries): Sets phase to "escalated"
 */
export function createExecuteNode(deps: ExecuteNodeDeps) {
  const { manager } = deps;
  const llm =
    deps.llm ??
    new ChatAnthropic({
      modelName: "claude-sonnet-4-20250514",
      temperature: 0,
    });

  return async function executeNode(
    state: DevAgentState,
  ): Promise<Partial<DevAgentState>> {
    const { taskId, issue, executionPlan, researchContext } = state;
    const nodeLogger = logger.child({ taskId });

    if (!issue || !executionPlan || !researchContext) {
      return {
        phase: "failed",
        errorMessage: "Missing required state for execution",
      };
    }

    nodeLogger.info(
      { identifier: issue.identifier, steps: executionPlan.steps.length },
      "Starting execution",
    );

    let testAttempts = state.testAttempts || 0;

    try {
      for (const [stepIndex, step] of executionPlan.steps.entries()) {
        nodeLogger.info(
          { step: stepIndex + 1, description: step.description },
          "Executing step",
        );

        // Generate and write files for this step
        for (const filePath of step.files) {
          const content = await generateFileContent(llm, {
            filePath,
            stepDescription: step.description,
            issue,
            researchContext,
            existingPatterns: researchContext.existingPatterns,
          });

          const writeResult = await writeFileViaHeredoc(
            manager,
            taskId,
            filePath,
            content,
          );
          if (!writeResult.success) {
            return {
              phase: "failed",
              errorMessage: `Failed to write ${filePath}: ${writeResult.error}`,
            };
          }
        }

        // Run affected tests for this step
        const testResult = await runAffectedTests(manager, taskId, step.files);

        if (!testResult.passed) {
          // Check for unfixable patterns
          if (isUnfixable(testResult.output)) {
            nodeLogger.error(
              { output: testResult.output.slice(0, 500) },
              "Unfixable error detected",
            );
            return {
              phase: "escalated",
              errorMessage: `Unfixable error during step ${stepIndex + 1}: ${testResult.output.slice(0, 200)}`,
              testAttempts,
            };
          }

          // Attempt fixes
          let fixed = false;
          while (testAttempts < MAX_FIX_ATTEMPTS && !fixed) {
            testAttempts++;
            nodeLogger.info(
              { attempt: testAttempts },
              "Attempting to fix test failure",
            );

            // TODO: In future, use LLM to analyze and fix
            // For now, re-run tests (simple retry for flaky tests)
            const retryResult = await runAffectedTests(
              manager,
              taskId,
              step.files,
            );
            if (retryResult.passed) {
              fixed = true;
            } else if (isUnfixable(retryResult.output)) {
              return {
                phase: "escalated",
                errorMessage: `Unfixable error after ${testAttempts} attempts: ${retryResult.output.slice(0, 200)}`,
                testAttempts,
              };
            }
          }

          if (!fixed) {
            nodeLogger.error(
              { testAttempts },
              "Exhausted fix attempts, escalating",
            );
            return {
              phase: "escalated",
              errorMessage: `Tests still failing after ${testAttempts} fix attempts`,
              testAttempts,
            };
          }
        }

        // Commit changes for this step
        const commitResult = await commitChanges(manager, taskId, step);
        if (!commitResult.success) {
          nodeLogger.warn(
            { error: commitResult.error },
            "Commit failed (non-critical for now)",
          );
        }
      }

      nodeLogger.info("Execution complete, proceeding to verification");

      return {
        phase: "verifying",
        testAttempts,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      nodeLogger.error({ err: error }, "Execution failed");
      return {
        phase: "failed",
        errorMessage: `Execution error: ${message}`,
        testAttempts,
      };
    }
  };
}

/**
 * Generate file content via LLM structured output.
 */
async function generateFileContent(
  llm: ChatAnthropic,
  context: {
    filePath: string;
    stepDescription: string;
    issue: { title: string; description: string | null };
    researchContext: {
      existingPatterns: string[];
      relevantFiles: Array<{ path: string; patterns: string[] }>;
    };
    existingPatterns: string[];
  },
): Promise<string> {
  const structuredLlm = llm.withStructuredOutput(FileContentSchema);

  const prompt = buildFileWritePrompt({
    stepDescription: context.stepDescription,
    targetFiles: [context.filePath],
    relatedPatterns: context.existingPatterns,
    taskContext: `${context.issue.title}\n\n${context.issue.description || ""}`,
  });

  const result = await structuredLlm.invoke([
    { role: "system", content: FILE_WRITE_SYSTEM_PROMPT },
    { role: "user", content: prompt },
  ]);

  return result.content;
}

/**
 * Write file content using cat heredoc with unique delimiter.
 *
 * Uses timestamp-based delimiter to prevent injection attacks.
 */
async function writeFileViaHeredoc(
  manager: DevContainerManager,
  taskId: string,
  filePath: string,
  content: string,
): Promise<{ success: boolean; error?: string }> {
  // Use unique delimiter to prevent injection
  const delimiter = `AESIR_EOF_${Date.now()}`;

  // Ensure directory exists
  const dirPath = filePath.substring(0, filePath.lastIndexOf("/"));
  if (dirPath) {
    await manager.execute(taskId, {
      command: ["mkdir", "-p", dirPath],
      workdir: "/workspace/repo",
      timeoutMs: DEV_CONTAINER_TIMEOUTS.default,
    });
  }

  // Write file via heredoc
  const result = await manager.execute(taskId, {
    command: [
      "sh",
      "-c",
      `cat > '${filePath}' << '${delimiter}'\n${content}\n${delimiter}`,
    ],
    workdir: "/workspace/repo",
    timeoutMs: DEV_CONTAINER_TIMEOUTS.default,
  });

  if (result.exitCode !== 0) {
    return { success: false, error: result.stderr };
  }

  return { success: true };
}

/**
 * Run tests for files affected by the current step.
 *
 * Only runs tests that correspond to modified files.
 */
async function runAffectedTests(
  manager: DevContainerManager,
  taskId: string,
  files: string[],
): Promise<{ passed: boolean; output: string }> {
  // Find test files that correspond to changed files
  const testFiles = files
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => f.replace(".ts", ".test.ts"));

  if (testFiles.length === 0) {
    // No test files to run
    return { passed: true, output: "No affected tests" };
  }

  // Run tests via pnpm
  const result = await manager.execute(taskId, {
    command: ["pnpm", "test", "--", ...testFiles],
    workdir: "/workspace/repo",
    timeoutMs: DEV_CONTAINER_TIMEOUTS.test,
  });

  return {
    passed: result.exitCode === 0,
    output: result.stdout + result.stderr,
  };
}

/**
 * Commit changes for a single step atomically.
 */
async function commitChanges(
  manager: DevContainerManager,
  taskId: string,
  step: ExecutionPlan["steps"][0],
): Promise<{ success: boolean; error?: string }> {
  // Stage changed files
  const addResult = await manager.execute(taskId, {
    command: ["git", "add", ...step.files],
    workdir: "/workspace/repo",
    timeoutMs: DEV_CONTAINER_TIMEOUTS.git,
  });

  if (addResult.exitCode !== 0) {
    return { success: false, error: addResult.stderr };
  }

  // Commit with descriptive message
  const commitMessage = `feat: ${step.description}`;
  const commitResult = await manager.execute(taskId, {
    command: ["git", "commit", "-m", commitMessage],
    workdir: "/workspace/repo",
    timeoutMs: DEV_CONTAINER_TIMEOUTS.git,
  });

  if (
    commitResult.exitCode !== 0 &&
    !commitResult.stderr.includes("nothing to commit")
  ) {
    return { success: false, error: commitResult.stderr };
  }

  return { success: true };
}

/**
 * Check if output contains unfixable error patterns.
 * These indicate environment/infrastructure issues that need human intervention.
 */
function isUnfixable(output: string): boolean {
  return UNFIXABLE_PATTERNS.some((pattern) => output.includes(pattern));
}
