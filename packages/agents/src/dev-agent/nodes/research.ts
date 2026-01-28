/**
 * Research Node
 *
 * Explores codebase via shell commands and synthesizes ResearchContext.
 * This is the "competent junior developer" research phase - understanding
 * the codebase before planning implementation.
 *
 * Implements DEV-05, DEV-06, DEV-07 from the dev-agent workflow spec.
 */

import type { DevContainerManager } from "@aesir/platform";
import {
  createPinoLogger,
  DEV_CONTAINER_TIMEOUTS,
  type PinoLogger,
} from "@aesir/platform";
import { ChatAnthropic } from "@langchain/anthropic";
import { buildResearchPrompt, RESEARCH_SYSTEM_PROMPT } from "../prompts.js";
import type { DevAgentState } from "../state.js";
import { ResearchContextSchema } from "../state.js";

const logger: PinoLogger = createPinoLogger({
  component: "agents:dev-agent:research",
});

export interface ResearchNodeDeps {
  manager: DevContainerManager;
  llm?: ChatAnthropic;
}

/**
 * Node that researches codebase to understand context for implementation.
 *
 * Steps:
 * 1. Extract search terms from issue description
 * 2. Find relevant files via grep/ripgrep
 * 3. Read key files
 * 4. Get project structure
 * 5. LLM synthesizes ResearchContext
 *
 * On success: Sets researchContext, phase to "planning"
 * On failure: Sets phase to "failed" with error message
 */
export function createResearchNode(deps: ResearchNodeDeps) {
  const { manager } = deps;
  const llm =
    deps.llm ??
    new ChatAnthropic({
      modelName: "claude-sonnet-4-20250514",
      temperature: 0,
    });

  return async function researchNode(
    state: DevAgentState,
  ): Promise<Partial<DevAgentState>> {
    const { taskId, issue } = state;
    const nodeLogger = logger.child({ taskId });

    if (!issue) {
      return { phase: "failed", errorMessage: "No issue for research" };
    }

    nodeLogger.info(
      { identifier: issue.identifier },
      "Starting codebase research",
    );

    try {
      // Extract search terms from title and description
      const searchText = `${issue.title} ${issue.description || ""}`;
      const terms = extractSearchTerms(searchText);
      nodeLogger.debug({ terms }, "Search terms extracted");

      // Find relevant files via ripgrep
      const grepResult = await manager.execute(taskId, {
        command: [
          "rg",
          "-l",
          terms.join("|"),
          "src/",
          "--type",
          "ts",
          "-g",
          "!*.test.ts",
        ],
        workdir: "/workspace/repo",
        timeoutMs: DEV_CONTAINER_TIMEOUTS.research,
      });

      const relevantFiles = grepResult.stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .slice(0, 15);
      nodeLogger.info(
        { fileCount: relevantFiles.length },
        "Found relevant files",
      );

      // Read file contents
      const fileContents: Record<string, string> = {};
      for (const file of relevantFiles) {
        const catResult = await manager.execute(taskId, {
          command: ["cat", file],
          workdir: "/workspace/repo",
          timeoutMs: DEV_CONTAINER_TIMEOUTS.research,
        });
        if (catResult.exitCode === 0) {
          fileContents[file] = catResult.stdout;
        }
      }

      // Get project structure
      const treeResult = await manager.execute(taskId, {
        command: [
          "find",
          "src/",
          "-type",
          "f",
          "-name",
          "*.ts",
          "-not",
          "-name",
          "*.test.ts",
        ],
        workdir: "/workspace/repo",
        timeoutMs: DEV_CONTAINER_TIMEOUTS.research,
      });
      const projectStructure = treeResult.stdout;

      // LLM synthesizes research context
      const structuredLlm = llm.withStructuredOutput(ResearchContextSchema);
      const prompt = buildResearchPrompt({
        taskTitle: issue.title,
        taskDescription: issue.description || "",
        fileContents,
        projectStructure,
      });

      const researchContext = await structuredLlm.invoke([
        { role: "system", content: RESEARCH_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ]);

      nodeLogger.info(
        {
          patterns: researchContext.existingPatterns.length,
          risks: researchContext.risks.length,
        },
        "Research complete",
      );

      return {
        researchContext,
        phase: "planning",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      nodeLogger.error({ err: error }, "Research failed");
      return { phase: "failed", errorMessage: `Research error: ${message}` };
    }
  };
}

/**
 * Extract meaningful search terms from text
 */
function extractSearchTerms(text: string): string[] {
  // Remove common words, keep meaningful terms
  const stopWords = new Set([
    "the",
    "a",
    "an",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "will",
    "would",
    "could",
    "should",
    "may",
    "might",
    "must",
    "shall",
    "can",
    "need",
    "and",
    "or",
    "but",
    "if",
    "then",
    "else",
    "when",
    "where",
    "why",
    "how",
    "what",
    "which",
    "who",
    "whom",
    "this",
    "that",
    "these",
    "those",
    "add",
    "create",
    "implement",
    "make",
    "build",
    "update",
    "fix",
    "we",
    "our",
    "for",
    "to",
  ]);

  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));

  // Take unique terms, prioritize longer words
  const unique = [...new Set(words)];
  return unique.sort((a, b) => b.length - a.length).slice(0, 5);
}
