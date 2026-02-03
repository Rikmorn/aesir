/**
 * list_directory Tool
 *
 * Lists files and directories in the dev container's workspace.
 * Used by agents to explore project structure and discover files.
 */

import { z } from "zod";
import type { ToolDefinition, ToolResult } from "../../agent-loop/types.js";
import { type CodebaseToolDeps, MAX_OUTPUT_BYTES } from "../types.js";

const inputSchema = z.object({
  path: z
    .string()
    .optional()
    .describe(
      'Directory path relative to the repository root (defaults to ".")',
    ),
});

/**
 * Create a list_directory tool bound to a specific dev container.
 *
 * Lists directory contents using `ls -la` for detailed output including
 * permissions, sizes, and modification times. Defaults to the repository root.
 */
export function createListDirectoryTool(
  deps: CodebaseToolDeps,
): ToolDefinition {
  const { containerManager, taskId, logger } = deps;

  return {
    name: "list_directory",
    description:
      "List files and directories at the given path with details (permissions, size, date). Defaults to the repository root if no path is given. Use this to explore project structure and find files.",
    inputSchema,
    async execute(input: unknown): Promise<ToolResult> {
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          content: `Invalid input: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
          isError: true,
        };
      }

      const dirPath = parsed.data.path ?? ".";

      if (!containerManager) {
        return {
          content:
            "No dev container available. This tool requires a running dev container.",
          isError: true,
        };
      }

      try {
        const result = await containerManager.execute(taskId, {
          command: ["ls", "-la", dirPath],
          workdir: "/workspace/repo",
          timeoutMs: 10_000,
        });

        if (result.exitCode !== 0) {
          return {
            content: result.stderr.trim() || "Directory not found",
            isError: true,
          };
        }

        let content = result.stdout;
        if (Buffer.byteLength(content, "utf-8") > MAX_OUTPUT_BYTES) {
          content =
            content.slice(0, MAX_OUTPUT_BYTES) +
            "\n\n[output truncated at 100KB]";
        }

        return { content };
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Unknown error listing directory";
        logger.error(
          { err, path: dirPath, taskId },
          "list_directory tool error",
        );
        return { content: message, isError: true };
      }
    },
  };
}
