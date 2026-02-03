/**
 * search_codebase Tool
 *
 * Searches the codebase using ripgrep for pattern matching.
 * Used by agents to find relevant code, usage patterns, and definitions.
 */

import { z } from "zod";
import type { ToolDefinition, ToolResult } from "../../agent-loop/types.js";
import { type CodebaseToolDeps, MAX_OUTPUT_BYTES } from "../types.js";

const inputSchema = z.object({
  pattern: z.string().describe("Regex pattern to search for"),
  glob: z
    .string()
    .optional()
    .describe('File glob filter (e.g. "*.ts", "src/**/*.js")'),
  path: z
    .string()
    .optional()
    .describe("Directory to search in, relative to repo root"),
});

/**
 * Create a search_codebase tool bound to a specific dev container.
 *
 * Uses ripgrep to search file contents with regex patterns.
 * Limited to 50 matches per search to keep output manageable.
 * Supports glob filtering and path scoping.
 */
export function createSearchCodebaseTool(
  deps: CodebaseToolDeps,
): ToolDefinition {
  const { containerManager, taskId, logger } = deps;

  return {
    name: "search_codebase",
    description:
      "Search the codebase for a regex pattern using ripgrep. Returns matching lines with file paths and line numbers. Supports glob filtering (e.g. '*.ts') and path scoping. Limited to 50 matches per search.",
    inputSchema,
    async execute(input: unknown): Promise<ToolResult> {
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          content: `Invalid input: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
          isError: true,
        };
      }

      const { pattern, glob, path } = parsed.data;

      if (!containerManager) {
        return {
          content:
            "No dev container available. This tool requires a running dev container.",
          isError: true,
        };
      }

      try {
        const command = [
          "rg",
          "--line-number",
          "--max-count",
          "50",
          "--no-heading",
        ];

        if (glob !== undefined) {
          command.push("--glob", glob);
        }

        command.push(pattern);

        if (path !== undefined) {
          command.push(path);
        }

        const result = await containerManager.execute(taskId, {
          command,
          workdir: "/workspace/repo",
          timeoutMs: 30_000,
        });

        // Exit code 1 with empty stderr means no matches (not an error)
        if (result.exitCode === 1 && result.stderr.trim() === "") {
          return { content: "No matches found" };
        }

        if (result.exitCode !== 0 && result.exitCode !== 1) {
          return {
            content: result.stderr.trim() || "Search failed",
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
          err instanceof Error ? err.message : "Unknown error searching";
        logger.error({ err, pattern, taskId }, "search_codebase tool error");
        return { content: message, isError: true };
      }
    },
  };
}
