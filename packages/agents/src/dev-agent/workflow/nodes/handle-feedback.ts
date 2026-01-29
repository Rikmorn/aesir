/**
 * Handle Feedback Node
 *
 * Handles PR review feedback by resuming in the existing container,
 * analyzing feedback, making code changes, and pushing commits.
 *
 * Implements DEV-19 through DEV-21 from the dev-agent workflow spec.
 */

import type { DevContainerManager } from "@aesir/platform";
import {
  createPinoLogger,
  DEV_CONTAINER_TIMEOUTS,
  type PinoLogger,
} from "@aesir/platform";
import { ChatAnthropic } from "@langchain/anthropic";
import { z } from "zod";
import { callMcpTool } from "../../../shared/mcp/index.js";
import { detectPackageManager, getTestCommand } from "../../utils/index.js";
import type { DevAgentState } from "../state.js";

const logger: PinoLogger = createPinoLogger({
  component: "agents:dev-agent:handle-feedback",
});

export interface HandleFeedbackNodeDeps {
  manager: DevContainerManager;
  llm?: ChatAnthropic;
}

/** Schema for feedback analysis output */
const FeedbackAnalysisSchema = z.object({
  changes: z.array(
    z.object({
      file: z.string().describe("Relative file path from repo root"),
      description: z.string().describe("What needs to change in this file"),
      newContent: z.string().describe("Complete new file content"),
    }),
  ),
  commitMessage: z
    .string()
    .describe("Git commit message describing feedback changes"),
});

const FEEDBACK_SYSTEM_PROMPT = `You are addressing PR review feedback.

Analyze the feedback and determine what code changes are needed.
For each change, provide:
- The file path (relative to repo root)
- What needs to change
- The complete new file content

Be precise and follow existing code patterns.
Generate a clear commit message describing what feedback was addressed.`;

/**
 * Node that handles PR review feedback.
 *
 * Steps:
 * 1. Check if container still exists (resume or escalate)
 * 2. Pull latest changes
 * 3. Analyze feedback and generate fixes via LLM
 * 4. Write changed files via heredoc
 * 5. Run affected tests
 * 6. Commit and push
 * 7. Notify Slack when done
 *
 * On success: Sets phase to "complete" (back to awaiting more feedback or merge)
 * On container expired: Sets phase to "escalated" (needs re-spawn)
 * On failure: Sets phase to "escalated"
 */
export function createHandleFeedbackNode(deps: HandleFeedbackNodeDeps) {
  const { manager } = deps;
  const llm =
    deps.llm ??
    new ChatAnthropic({
      modelName: "claude-sonnet-4-20250514",
      temperature: 0,
    });

  return async function handleFeedbackNode(
    state: DevAgentState,
  ): Promise<Partial<DevAgentState>> {
    const { taskId, issue, prFeedback, branchName, researchContext } = state;
    const nodeLogger = logger.child({ taskId });

    if (!prFeedback || !branchName) {
      return {
        phase: "failed",
        errorMessage: "Missing feedback or branch for handling",
      };
    }

    nodeLogger.info(
      { feedbackLength: prFeedback.length },
      "Handling PR feedback",
    );

    try {
      // Step 1: Check if container exists, resume or escalate
      const existingContainer = await manager.findByTaskId(taskId);

      if (!existingContainer) {
        nodeLogger.info("Container not found, escalating for re-spawn");
        // Container expired - needs to be re-spawned
        // In production, this could chain back to setup-container
        return {
          phase: "escalated",
          errorMessage:
            "Container expired - need to re-spawn for feedback handling",
        };
      }

      nodeLogger.info(
        { containerId: existingContainer.slice(0, 12) },
        "Container found, resuming",
      );

      // Detect package manager for this repo
      const pm = await detectPackageManager({ manager, taskId });
      nodeLogger.debug({ packageManager: pm }, "Detected package manager");

      // Step 2: Pull latest changes (in case of any remote updates)
      const pullResult = await manager.execute(taskId, {
        command: ["git", "pull", "origin", branchName],
        workdir: "/workspace/repo",
        timeoutMs: DEV_CONTAINER_TIMEOUTS.git,
      });

      if (
        pullResult.exitCode !== 0 &&
        !pullResult.stderr.includes("Already up to date")
      ) {
        nodeLogger.warn({ stderr: pullResult.stderr }, "Pull had issues");
      }

      // Step 3: Analyze feedback and generate fixes via LLM
      const structuredLlm = llm.withStructuredOutput(FeedbackAnalysisSchema);

      const analysisPrompt = buildFeedbackAnalysisPrompt({
        feedback: prFeedback,
        issueTitle: issue?.title || "Unknown issue",
        existingPatterns: researchContext?.existingPatterns || [],
      });

      const analysis = await structuredLlm.invoke([
        { role: "system", content: FEEDBACK_SYSTEM_PROMPT },
        { role: "user", content: analysisPrompt },
      ]);

      nodeLogger.info(
        { changeCount: analysis.changes.length },
        "Feedback analyzed",
      );

      // Step 4: Write changed files via heredoc
      const affectedFiles: string[] = [];
      for (const change of analysis.changes) {
        const delimiter = `AESIR_FEEDBACK_EOF_${Date.now()}`;

        // Ensure directory exists
        const dirPath = change.file.substring(0, change.file.lastIndexOf("/"));
        if (dirPath) {
          await manager.execute(taskId, {
            command: ["mkdir", "-p", dirPath],
            workdir: "/workspace/repo",
            timeoutMs: DEV_CONTAINER_TIMEOUTS.default,
          });
        }

        const writeResult = await manager.execute(taskId, {
          command: [
            "sh",
            "-c",
            `cat > '${change.file}' << '${delimiter}'\n${change.newContent}\n${delimiter}`,
          ],
          workdir: "/workspace/repo",
          timeoutMs: DEV_CONTAINER_TIMEOUTS.default,
        });

        if (writeResult.exitCode !== 0) {
          nodeLogger.error(
            { file: change.file, stderr: writeResult.stderr },
            "Failed to write file",
          );
          return {
            phase: "escalated",
            errorMessage: `Failed to write ${change.file} for feedback: ${writeResult.stderr}`,
          };
        }

        affectedFiles.push(change.file);
      }

      // Step 5: Run affected tests
      const testFiles = affectedFiles
        .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
        .map((f) => f.replace(".ts", ".test.ts"));

      if (testFiles.length > 0) {
        const testResult = await manager.execute(taskId, {
          command: getTestCommand(pm, testFiles),
          workdir: "/workspace/repo",
          timeoutMs: DEV_CONTAINER_TIMEOUTS.test,
        });

        if (testResult.exitCode !== 0) {
          nodeLogger.error(
            { stderr: testResult.stderr.slice(0, 500) },
            "Tests failed after feedback changes",
          );
          return {
            phase: "escalated",
            errorMessage: `Tests failed after addressing feedback: ${testResult.stderr.slice(0, 200)}`,
          };
        }
      }

      // Step 6: Commit and push
      const addResult = await manager.execute(taskId, {
        command: ["git", "add", ...affectedFiles],
        workdir: "/workspace/repo",
        timeoutMs: DEV_CONTAINER_TIMEOUTS.git,
      });

      if (addResult.exitCode !== 0) {
        nodeLogger.error({ stderr: addResult.stderr }, "Git add failed");
        return {
          phase: "escalated",
          errorMessage: `Git add failed: ${addResult.stderr}`,
        };
      }

      const commitResult = await manager.execute(taskId, {
        command: ["git", "commit", "-m", analysis.commitMessage],
        workdir: "/workspace/repo",
        timeoutMs: DEV_CONTAINER_TIMEOUTS.git,
      });

      if (
        commitResult.exitCode !== 0 &&
        !commitResult.stderr.includes("nothing to commit")
      ) {
        nodeLogger.error({ stderr: commitResult.stderr }, "Commit failed");
        return {
          phase: "escalated",
          errorMessage: `Commit failed after feedback: ${commitResult.stderr}`,
        };
      }

      const pushResult = await manager.execute(taskId, {
        command: ["git", "push"],
        workdir: "/workspace/repo",
        timeoutMs: DEV_CONTAINER_TIMEOUTS.git,
      });

      if (pushResult.exitCode !== 0) {
        nodeLogger.error({ stderr: pushResult.stderr }, "Push failed");
        return {
          phase: "escalated",
          errorMessage: `Push failed after feedback: ${pushResult.stderr}`,
        };
      }

      nodeLogger.info("Feedback addressed, changes pushed");

      // Step 7: Notify Slack that feedback was addressed
      if (state.slackChannel) {
        try {
          await callMcpTool({
            integration: "slack",
            tool: "send_message",
            params: {
              channel: state.slackChannel,
              text: `Addressed feedback for ${issue?.identifier || taskId} - ready for re-review`,
            },
            agentId: "dev-agent",
            correlationId: `feedback-notify-${taskId}`,
          });
        } catch {
          // Non-critical - don't fail the workflow for notification issues
          nodeLogger.warn("Failed to send Slack notification");
        }
      }

      return {
        phase: "complete",
        prFeedback: null, // Clear processed feedback
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      nodeLogger.error({ err: error }, "Feedback handling failed");
      return {
        phase: "escalated",
        errorMessage: `Feedback handling error: ${message}`,
      };
    }
  };
}

/**
 * Build prompt for LLM to analyze feedback and generate file changes.
 */
function buildFeedbackAnalysisPrompt(context: {
  feedback: string;
  issueTitle: string;
  existingPatterns: string[];
}): string {
  return `## PR Review Feedback

${context.feedback}

## Original Issue
${context.issueTitle}

## Existing Patterns to Follow
${context.existingPatterns.map((p) => `- ${p}`).join("\n") || "No specific patterns noted."}

Analyze the feedback and determine what changes are needed. For each file that needs changes, provide the complete new content.`;
}
