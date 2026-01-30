/**
 * run_command Tool
 *
 * Runs arbitrary shell commands in the dev container.
 * Used by agents for builds, tests, package installs, and other operations.
 */

import { z } from "zod";
import type { ToolDefinition, ToolResult } from "../../agent-loop/types.js";
import {
  type CodebaseToolDeps,
  MAX_OUTPUT_BYTES,
  MAX_STDERR_BYTES,
} from "../types.js";

const inputSchema = z.object({
  command: z.string().describe("Shell command to execute (e.g. 'pnpm test')"),
  timeoutMs: z
    .number()
    .optional()
    .describe("Timeout in milliseconds (default: 180000 for test runs)"),
});

/** Default timeout for run_command (3 minutes, suited for test suites) */
const DEFAULT_TIMEOUT_MS = 180_000;

/**
 * Create a run_command tool bound to a specific dev container.
 *
 * Executes shell commands via `sh -c` for full shell feature support
 * (pipes, redirects, environment variables). Output includes labeled
 * STDOUT and STDERR sections with the exit code.
 */
export function createRunCommandTool(deps: CodebaseToolDeps): ToolDefinition {
  const { containerManager, taskId, logger } = deps;

  return {
    name: "run_command",
    description:
      "Run a shell command in the dev container. Use this for running tests, builds, package installs, git operations, and other CLI tools. The command is executed via `sh -c` so pipes, redirects, and shell features work. Default timeout is 3 minutes.",
    inputSchema,
    async execute(input: unknown): Promise<ToolResult> {
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          content: `Invalid input: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
          isError: true,
        };
      }

      const { command, timeoutMs } = parsed.data;
      const timeout = timeoutMs ?? DEFAULT_TIMEOUT_MS;

      try {
        const result = await containerManager.execute(taskId, {
          command: ["sh", "-c", command],
          workdir: "/workspace/repo",
          timeoutMs: timeout,
        });

        // Truncate stdout and stderr separately
        let stdout = result.stdout;
        if (Buffer.byteLength(stdout, "utf-8") > MAX_OUTPUT_BYTES) {
          stdout =
            stdout.slice(0, MAX_OUTPUT_BYTES) +
            "\n\n[stdout truncated at 100KB]";
        }

        let stderr = result.stderr;
        if (Buffer.byteLength(stderr, "utf-8") > MAX_STDERR_BYTES) {
          stderr =
            stderr.slice(0, MAX_STDERR_BYTES) +
            "\n\n[stderr truncated at 50KB]";
        }

        // Build formatted output
        const timedOutLabel = result.timedOut ? " [TIMED OUT]" : "";
        const parts = [`Exit code: ${result.exitCode}${timedOutLabel}`];

        if (stdout.trim()) {
          parts.push(`\nSTDOUT:\n${stdout}`);
        }
        if (stderr.trim()) {
          parts.push(`\nSTDERR:\n${stderr}`);
        }

        const content = parts.join("\n");
        const isError = result.exitCode !== 0;

        const toolResult: ToolResult = { content };
        if (isError) {
          toolResult.isError = true;
        }

        return toolResult;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unknown error running command";
        logger.error({ err, command, taskId }, "run_command tool error");
        return { content: message, isError: true };
      }
    },
  };
}
