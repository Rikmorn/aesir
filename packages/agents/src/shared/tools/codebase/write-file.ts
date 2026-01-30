/**
 * write_file Tool
 *
 * Writes content to a file in the dev container's workspace.
 * Creates parent directories automatically and overwrites existing files.
 */

import { z } from "zod";
import type { ToolDefinition, ToolResult } from "../../agent-loop/types.js";
import type { CodebaseToolDeps } from "../types.js";

const inputSchema = z.object({
  path: z.string().describe("File path relative to the repository root"),
  content: z.string().describe("Complete file content to write"),
});

/**
 * Create a write_file tool bound to a specific dev container.
 *
 * Writes file content via base64 encoding to avoid shell escaping issues.
 * Automatically creates parent directories if they don't exist.
 * Overwrites existing files completely -- there is no append mode.
 */
export function createWriteFileTool(deps: CodebaseToolDeps): ToolDefinition {
  const { containerManager, taskId, logger } = deps;

  return {
    name: "write_file",
    description:
      "Write content to a file at the given path. This overwrites the file if it already exists and creates parent directories automatically. Use this to create new files or replace existing ones with updated content.",
    inputSchema,
    async execute(input: unknown): Promise<ToolResult> {
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          content: `Invalid input: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
          isError: true,
        };
      }

      const { path, content } = parsed.data;

      try {
        // Create parent directories if path has directories
        const lastSlash = path.lastIndexOf("/");
        if (lastSlash > 0) {
          const dir = path.slice(0, lastSlash);
          const mkdirResult = await containerManager.execute(taskId, {
            command: ["mkdir", "-p", dir],
            workdir: "/workspace/repo",
            timeoutMs: 30_000,
          });

          if (mkdirResult.exitCode !== 0) {
            return {
              content: `Failed to create directory ${dir}: ${mkdirResult.stderr.trim()}`,
              isError: true,
            };
          }
        }

        // Write via base64 to avoid shell escaping issues
        const b64 = Buffer.from(content).toString("base64");
        const writeResult = await containerManager.execute(taskId, {
          command: ["sh", "-c", `printf '%s' '${b64}' | base64 -d > '${path}'`],
          workdir: "/workspace/repo",
          timeoutMs: 30_000,
        });

        if (writeResult.exitCode !== 0) {
          return {
            content: `Failed to write ${path}: ${writeResult.stderr.trim()}`,
            isError: true,
          };
        }

        return { content: `Successfully wrote ${path}` };
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unknown error writing file";
        logger.error({ err, path, taskId }, "write_file tool error");
        return { content: message, isError: true };
      }
    },
  };
}
