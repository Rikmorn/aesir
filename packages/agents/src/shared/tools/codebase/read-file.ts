/**
 * read_file Tool
 *
 * Reads a file from the dev container's workspace.
 * Used by agents to understand existing code before making changes.
 */

import { z } from "zod";
import type { ToolDefinition, ToolResult } from "../../agent-loop/types.js";
import { type CodebaseToolDeps, MAX_OUTPUT_BYTES } from "../types.js";

const inputSchema = z.object({
  path: z.string().describe("File path relative to the repository root"),
});

/**
 * Create a read_file tool bound to a specific dev container.
 *
 * Reads file content via `cat` in the container. Returns the file content
 * as a string, or an error if the file doesn't exist or can't be read.
 */
export function createReadFileTool(deps: CodebaseToolDeps): ToolDefinition {
  const { containerManager, taskId, logger } = deps;

  return {
    name: "read_file",
    description:
      "Read the contents of a file at the given path. Use this to understand existing code, configuration, or documentation before making changes. Returns the full file content as text.",
    inputSchema,
    async execute(input: unknown): Promise<ToolResult> {
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          content: `Invalid input: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
          isError: true,
        };
      }

      const { path } = parsed.data;

      try {
        const result = await containerManager.execute(taskId, {
          command: ["cat", path],
          workdir: "/workspace/repo",
          timeoutMs: 30_000,
        });

        if (result.exitCode !== 0) {
          const errorMsg = result.stderr.trim() || "File not found";
          return { content: errorMsg, isError: true };
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
          err instanceof Error ? err.message : "Unknown error reading file";
        logger.error({ err, path, taskId }, "read_file tool error");
        return { content: message, isError: true };
      }
    },
  };
}
