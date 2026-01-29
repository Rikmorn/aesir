/**
 * Execute Node
 *
 * Executes the approved plan: writes files, runs tests, commits.
 * This is the "competent junior developer" execution phase - implementing
 * the approved plan step by step with test validation.
 *
 * Implements DEV-10 through DEV-12 from the dev-agent workflow spec.
 */

import type { DevContainerManager } from "@aesir/platform";
import {
  createPinoLogger,
  DEV_CONTAINER_TIMEOUTS,
  type PinoLogger,
} from "@aesir/platform";
import { ChatAnthropic } from "@langchain/anthropic";
import { z } from "zod";
import {
  detectPackageManager,
  getTestCommand,
  type PackageManager,
} from "../../utils/index.js";
import { buildFileWritePrompt, FILE_WRITE_SYSTEM_PROMPT } from "../prompts.js";
import type { DevAgentState, ExecutionPlan } from "../state.js";

const logger: PinoLogger = createPinoLogger({
  component: "agents:dev-agent:execute",
});

/** Max self-fix attempts before escalation */
const MAX_FIX_ATTEMPTS = 3;

/**
 * File extensions that don't require testing or linting.
 * These are documentation, config, or non-executable files.
 */
const NON_CODE_EXTENSIONS = [
  ".md",
  ".mdx",
  ".txt",
  ".rst",
  ".json", // config files
  ".yaml",
  ".yml",
  ".toml",
  ".lock",
  ".gitignore",
  ".gitattributes",
  ".editorconfig",
  ".prettierrc",
  ".eslintignore",
  ".dockerignore",
  "LICENSE",
  "CHANGELOG",
  "README",
];

/**
 * Check if a file is a non-code file that doesn't need testing.
 */
function isNonCodeFile(filePath: string): boolean {
  const lowerPath = filePath.toLowerCase();
  return NON_CODE_EXTENSIONS.some(
    (ext) =>
      lowerPath.endsWith(ext.toLowerCase()) ||
      lowerPath.includes(ext.toLowerCase()),
  );
}

/**
 * Check if all files in a list are non-code files.
 */
function allFilesAreNonCode(files: string[]): boolean {
  return files.length > 0 && files.every(isNonCodeFile);
}

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

    // Check if this is a non-code-only change (e.g., README update)
    const allPlanFiles = executionPlan.steps.flatMap((s) => s.files);
    const isNonCodeOnlyChange = allFilesAreNonCode(allPlanFiles);

    if (isNonCodeOnlyChange) {
      nodeLogger.info(
        { files: allPlanFiles },
        "Non-code files only - skipping package manager detection and tests",
      );
    }

    // Only detect package manager if we have code files to test
    let pm: PackageManager = "npm"; // default, won't be used for non-code
    if (!isNonCodeOnlyChange) {
      pm = await detectPackageManager({ manager, taskId });
      nodeLogger.debug({ packageManager: pm }, "Detected package manager");
    }

    let testAttempts = state.testAttempts || 0;

    try {
      for (const [stepIndex, step] of executionPlan.steps.entries()) {
        nodeLogger.info(
          { step: stepIndex + 1, description: step.description },
          "Executing step",
        );

        // Generate and write files for this step
        for (const filePath of step.files) {
          // Read existing file content if it exists (for modification tasks)
          let existingFileContent: string | undefined;
          const readResult = await manager.execute(taskId, {
            command: ["cat", filePath],
            workdir: "/workspace/repo",
            timeoutMs: 5000,
          });
          if (readResult.exitCode === 0 && readResult.stdout.trim()) {
            existingFileContent = readResult.stdout;
          }

          const content = await generateFileContent(llm, {
            filePath,
            stepDescription: step.description,
            issue,
            researchContext,
            existingPatterns: researchContext.existingPatterns,
            ...(existingFileContent ? { existingFileContent } : {}),
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

        // Skip tests for non-code files (README, docs, config)
        if (allFilesAreNonCode(step.files)) {
          nodeLogger.debug(
            { files: step.files },
            "Skipping tests for non-code files",
          );
        } else {
          // Run affected tests for this step
          const testResult = await runAffectedTests(
            manager,
            taskId,
            step.files,
            pm,
          );

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
                pm,
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

      // For non-code changes, skip verification entirely and go straight to PR
      if (isNonCodeOnlyChange) {
        nodeLogger.info(
          "Non-code change complete, skipping verification - proceeding to PR",
        );

        // Push the branch directly
        const branchToPush = state.branchName ?? `task/${taskId}`;
        const pushResult = await manager.execute(taskId, {
          command: ["git", "push", "-u", "origin", branchToPush],
          workdir: "/workspace/repo",
          timeoutMs: 30000,
        });

        if (pushResult.exitCode !== 0) {
          nodeLogger.error({ stderr: pushResult.stderr }, "Push failed");
          return {
            phase: "escalated",
            errorMessage: `Push failed: ${pushResult.stderr.slice(0, 200)}`,
          };
        }

        return {
          phase: "creating_pr",
          testAttempts,
        };
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

/** Max retries for LLM content generation */
const MAX_GENERATION_RETRIES = 2;

/**
 * Generate file content via LLM structured output.
 * Includes retry logic for transient empty responses.
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
    existingFileContent?: string;
  },
): Promise<string> {
  const structuredLlm = llm.withStructuredOutput(FileContentSchema);

  const prompt = buildFileWritePrompt({
    stepDescription: context.stepDescription,
    targetFiles: [context.filePath],
    relatedPatterns: context.existingPatterns,
    taskContext: `${context.issue.title}\n\n${context.issue.description || ""}`,
    ...(context.existingFileContent
      ? { existingFileContent: context.existingFileContent }
      : {}),
  });

  // Retry logic for transient empty responses
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= MAX_GENERATION_RETRIES; attempt++) {
    try {
      const result = await structuredLlm.invoke([
        { role: "system", content: FILE_WRITE_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ]);

      // Validate that content was returned
      if (!result.content || result.content.trim() === "") {
        throw new Error("LLM returned empty content");
      }

      return result.content;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      logger.warn(
        {
          attempt: attempt + 1,
          maxRetries: MAX_GENERATION_RETRIES,
          err: lastError,
        },
        "File content generation failed, retrying",
      );

      // Don't retry on the last attempt
      if (attempt < MAX_GENERATION_RETRIES) {
        // Brief delay before retry
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  throw lastError || new Error("Failed to generate file content after retries");
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
  pm: PackageManager,
): Promise<{ passed: boolean; output: string }> {
  // Find test files that correspond to changed files
  const testFiles = files
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => f.replace(".ts", ".test.ts"));

  if (testFiles.length === 0) {
    // No test files to run
    return { passed: true, output: "No affected tests" };
  }

  // Run tests using detected package manager
  const result = await manager.execute(taskId, {
    command: getTestCommand(pm, testFiles),
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
