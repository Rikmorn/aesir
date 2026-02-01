/**
 * History Manager
 *
 * Implements token-aware history compaction for agent conversations.
 * Phase 1: Token estimation, protected boundary, file read deduplication,
 * head+tail truncation, and tool-type-tiered descriptor replacement.
 *
 * Based on JetBrains NeurIPS 2025 research: replacing old tool results
 * with descriptors preserves assistant reasoning while dramatically
 * reducing token count.
 *
 * Key invariants:
 * - NEVER mutates the input messages array
 * - NEVER prunes assistant text blocks (only tool_result content)
 * - Protected boundary never splits tool_use/tool_result pairs
 * - File reads deduplicated by path (most recent kept)
 */

import type { PinoLogger } from "@aesir/platform";
import type Anthropic from "@anthropic-ai/sdk";

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * History management configuration.
 * Matches the `history` sub-schema from AgentDefinitionYamlSchema.
 */
export interface HistoryConfig {
  /** Token threshold to trigger Phase 1 pruning */
  pruneThreshold: number;
  /** Number of recent messages protected from pruning */
  protectedMessages: number;
  /** Token threshold to trigger Phase 2 summarization */
  summaryThreshold: number;
  /** Model to use for Phase 2 summary generation */
  summaryModel: string;
}

/**
 * Result of a compaction operation.
 */
export interface CompactionResult {
  /** Compacted (or original) messages */
  messages: Anthropic.MessageParam[];
  /** Which compaction phase was applied */
  phase: "none" | "pruned" | "summarized";
  /** Estimated tokens after compaction */
  estimatedTokens: number;
  /** Tokens saved by compaction */
  tokensSaved: number;
}

/**
 * History manager interface for conversation compaction.
 */
export interface HistoryManager {
  /**
   * Compact a conversation's message history.
   *
   * Phase 1 (this plan): Token estimation + descriptor replacement.
   * Phase 2 (plan 02): Summarization when Phase 1 is insufficient.
   *
   * @param messages - Conversation messages (never mutated)
   * @param config - History management configuration
   * @param options - Optional dependencies for Phase 2
   * @returns Compaction result with phase, tokens, and savings
   */
  compact(
    messages: Anthropic.MessageParam[],
    config: HistoryConfig,
    options?: {
      artifacts?: Record<string, string>;
      anthropicClient?: Anthropic;
      systemPrompt?: string;
      tools?: Anthropic.Tool[];
    },
  ): Promise<CompactionResult>;
}

// ─── Token Estimation ────────────────────────────────────────────────────────

/**
 * Estimate token count for a text string.
 *
 * Uses chars/4 approximation (ceil) for hot-path estimation.
 * This is intentionally approximate -- accurate token counting
 * via the API is reserved for Phase 2 summary decisions only.
 *
 * @param text - Text to estimate tokens for
 * @returns Estimated token count
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Estimate total tokens in an array of Anthropic messages.
 *
 * Handles all content block types:
 * - TextBlock: text content
 * - ToolUseBlock: tool name + JSON-serialized input
 * - ToolResultBlock: string content or array of text blocks
 *
 * Adds 4 tokens per message for structural overhead (role, separators).
 *
 * @param messages - Array of Anthropic message params
 * @returns Estimated total token count
 */
export function estimateMessageTokens(
  messages: Anthropic.MessageParam[],
): number {
  let total = 0;

  for (const message of messages) {
    // Structural overhead per message (role, formatting)
    total += 4;

    if (typeof message.content === "string") {
      total += estimateTokens(message.content);
      continue;
    }

    // Array content: iterate content blocks
    if (Array.isArray(message.content)) {
      for (const block of message.content) {
        if (block.type === "text") {
          total += estimateTokens((block as Anthropic.TextBlockParam).text);
        } else if (block.type === "tool_use") {
          const toolUse = block as Anthropic.ToolUseBlockParam;
          // Tool name + serialized input
          total += estimateTokens(toolUse.name);
          total += estimateTokens(JSON.stringify(toolUse.input));
        } else if (block.type === "tool_result") {
          const toolResult = block as Anthropic.ToolResultBlockParam;
          if (typeof toolResult.content === "string") {
            total += estimateTokens(toolResult.content);
          } else if (Array.isArray(toolResult.content)) {
            for (const sub of toolResult.content) {
              if (sub.type === "text") {
                total += estimateTokens(sub.text);
              }
            }
          }
        }
      }
    }
  }

  return total;
}

// ─── Head+Tail Truncation ────────────────────────────────────────────────────

/**
 * Truncate text to head + tail with a truncation marker in between.
 *
 * Preserves the beginning and end of content (where tool outputs
 * typically have the most useful information: headers/summaries at
 * the top, final results at the bottom).
 *
 * Default: 500 tokens head + 1500 tokens tail (biased toward recent content).
 *
 * @param text - Text to truncate
 * @param headTokens - Tokens to keep from the beginning (default: 500)
 * @param tailTokens - Tokens to keep from the end (default: 1500)
 * @returns Truncated text and tokens removed
 */
function headTailTruncate(
  text: string,
  headTokens = 500,
  tailTokens = 1500,
): { truncated: string; removedTokens: number } {
  const totalTokens = estimateTokens(text);

  if (totalTokens <= headTokens + tailTokens) {
    return { truncated: text, removedTokens: 0 };
  }

  const headChars = headTokens * 4;
  const tailChars = tailTokens * 4;
  const head = text.slice(0, headChars);
  const tail = text.slice(-tailChars);
  const removedTokens = totalTokens - headTokens - tailTokens;

  const truncated = `${head}\n\n[... ${removedTokens} tokens truncated ...]\n\n${tail}`;
  return { truncated, removedTokens };
}

// ─── Tool Type Classification ────────────────────────────────────────────────

type ToolTier =
  | "file_read"
  | "search_list"
  | "command"
  | "integration"
  | "unknown";

/**
 * Classify a tool by its name into a pruning tier.
 *
 * Tiers determine the replacement strategy:
 * - file_read: head+tail truncation (500+1500 tokens)
 * - search_list: minimal descriptor (name + args + tokens removed)
 * - command: minimal descriptor (name + command + exit code + tokens removed)
 * - integration: head+tail truncation (same as file reads)
 * - unknown: no replacement (left as-is)
 */
function classifyTool(toolName: string): ToolTier {
  // File reads
  if (toolName === "read_file" || toolName === "get_file_contents") {
    return "file_read";
  }

  // Search/list tools
  if (
    toolName === "search_codebase" ||
    toolName === "list_directory" ||
    toolName === "list_files"
  ) {
    return "search_list";
  }

  // Command execution
  if (toolName === "run_command") {
    return "command";
  }

  // Integration tools (Linear, GitHub, Slack -- prefixed with integration name)
  if (
    toolName.startsWith("linear_") ||
    toolName.startsWith("github_") ||
    toolName.startsWith("slack_")
  ) {
    return "integration";
  }

  return "unknown";
}

// ─── Tool Name Lookup ────────────────────────────────────────────────────────

/**
 * Find the tool_use block in a preceding assistant message that matches
 * a tool_result's tool_use_id.
 *
 * Returns the tool name and input, or null if not found.
 */
function findToolUseForResult(
  toolUseId: string,
  precedingMessage: Anthropic.MessageParam | undefined,
): { name: string; input: unknown } | null {
  if (!precedingMessage || precedingMessage.role !== "assistant") {
    return null;
  }

  if (!Array.isArray(precedingMessage.content)) {
    return null;
  }

  for (const block of precedingMessage.content) {
    if (block.type === "tool_use") {
      const toolUse = block as Anthropic.ToolUseBlockParam;
      if (toolUse.id === toolUseId) {
        return { name: toolUse.name, input: toolUse.input };
      }
    }
  }

  return null;
}

// ─── Content Extraction Helpers ──────────────────────────────────────────────

/**
 * Extract the text content from a tool_result block.
 * Handles both string content and array-of-text-blocks content.
 */
function extractToolResultText(block: Anthropic.ToolResultBlockParam): string {
  if (typeof block.content === "string") {
    return block.content;
  }

  if (Array.isArray(block.content)) {
    return block.content
      .filter((sub) => sub.type === "text")
      .map((sub) => sub.text)
      .join("\n");
  }

  return "";
}

/**
 * Extract a value from a tool_use input object by key.
 */
function extractInputField(input: unknown, field: string): string {
  if (input && typeof input === "object" && field in input) {
    return String((input as Record<string, unknown>)[field]);
  }
  return "";
}

// ─── Descriptor Builders ─────────────────────────────────────────────────────

/**
 * Build a minimal descriptor for search/list tool results.
 */
function buildSearchDescriptor(
  toolName: string,
  toolInput: unknown,
  removedTokens: number,
): string {
  return `[Tool: ${toolName} -- args: ${JSON.stringify(toolInput)}. ${removedTokens} tokens removed.]`;
}

/**
 * Build a minimal descriptor for command tool results.
 * Extracts the command from tool_use input and exit code from tool_result content.
 */
function buildCommandDescriptor(
  toolName: string,
  toolInput: unknown,
  resultText: string,
  removedTokens: number,
): string {
  const command = extractInputField(toolInput, "command");

  // Try to extract exit code from the result text
  // Common patterns: "exit code: 0", "exitCode: 1", first line might have it
  let exitCode = "unknown";
  const exitCodeMatch = resultText.match(/exit[_\s]?code[:\s]+(\d+)/i);
  if (exitCodeMatch?.[1]) {
    exitCode = exitCodeMatch[1];
  } else {
    // Check if input has an exit code field (some tool results include it)
    const inputExitCode = extractInputField(toolInput, "exitCode");
    if (inputExitCode) {
      exitCode = inputExitCode;
    }
  }

  return `[Tool: ${toolName} -- command: ${command}, exit code: ${exitCode}. ${removedTokens} tokens removed.]`;
}

// ─── Deduplication ───────────────────────────────────────────────────────────

/**
 * File path tracking for deduplication.
 * Maps file paths to their indices in the messages array,
 * tracking which reads should be replaced with descriptors.
 */
interface FileReadInfo {
  /** Message index in the messages array */
  messageIndex: number;
  /** Block index within the message's content array */
  blockIndex: number;
  /** The file path being read */
  filePath: string;
}

/**
 * Identify duplicate file reads in unprotected messages.
 *
 * Scans from END to START to find the most recent read of each file path.
 * Earlier reads of the same path are marked for descriptor replacement.
 *
 * @returns Set of "messageIndex:blockIndex" strings to replace with descriptors
 */
function findDuplicateFileReads(
  messages: Anthropic.MessageParam[],
  protectedStart: number,
): Set<string> {
  const duplicates = new Set<string>();
  const seenPaths = new Map<string, FileReadInfo>();

  // Scan from end to start (unprotected region only)
  for (let i = protectedStart - 1; i >= 0; i--) {
    const message = messages[i];
    if (
      !message ||
      message.role !== "user" ||
      !Array.isArray(message.content)
    ) {
      continue;
    }

    for (let j = message.content.length - 1; j >= 0; j--) {
      const block = message.content[j];
      if (!block || block.type !== "tool_result") continue;

      const toolResult = block as Anthropic.ToolResultBlockParam;
      const precedingMessage = i > 0 ? messages[i - 1] : undefined;
      const toolInfo = findToolUseForResult(
        toolResult.tool_use_id,
        precedingMessage,
      );

      if (!toolInfo) continue;

      const tier = classifyTool(toolInfo.name);
      if (tier !== "file_read") continue;

      // Extract file path from tool_use input
      const filePath =
        extractInputField(toolInfo.input, "file_path") ||
        extractInputField(toolInfo.input, "path") ||
        extractInputField(toolInfo.input, "filePath");

      if (!filePath) continue;

      if (seenPaths.has(filePath)) {
        // This is an earlier (older) read -- mark as duplicate
        duplicates.add(`${i}:${j}`);
      } else {
        // This is the most recent read -- keep it
        seenPaths.set(filePath, {
          messageIndex: i,
          blockIndex: j,
          filePath,
        });
      }
    }
  }

  return duplicates;
}

// ─── Deep Clone ──────────────────────────────────────────────────────────────

/**
 * Deep clone messages to avoid mutating the input array.
 * Uses structured clone for correctness.
 */
function deepCloneMessages(
  messages: Anthropic.MessageParam[],
): Anthropic.MessageParam[] {
  return structuredClone(messages);
}

// ─── Phase 1 Pruning Pipeline ────────────────────────────────────────────────

/**
 * Apply Phase 1 pruning to unprotected messages.
 *
 * Pipeline:
 * 1. Calculate protected boundary (adjusting for tool_use/tool_result pairs)
 * 2. Deep-clone unprotected messages
 * 3. Deduplicate file reads (replace earlier reads with descriptors)
 * 4. Apply tier-based replacement to remaining tool results
 * 5. Return pruned messages with protected messages unchanged
 */
function applyPhase1Pruning(
  messages: Anthropic.MessageParam[],
  config: HistoryConfig,
  logger: PinoLogger,
): Anthropic.MessageParam[] {
  // Calculate protected boundary
  let protectedStart = Math.max(0, messages.length - config.protectedMessages);

  // Adjust boundary if it would split a tool_use/tool_result pair.
  // If the message at protectedStart is a user message containing ONLY
  // tool_result blocks, move protectedStart back by 1 to include the
  // preceding assistant message with matching tool_use blocks.
  if (protectedStart > 0 && protectedStart < messages.length) {
    const boundaryMessage = messages[protectedStart];
    if (
      boundaryMessage &&
      boundaryMessage.role === "user" &&
      Array.isArray(boundaryMessage.content)
    ) {
      const allToolResults = boundaryMessage.content.every(
        (block) => block.type === "tool_result",
      );
      if (allToolResults && boundaryMessage.content.length > 0) {
        protectedStart = protectedStart - 1;
        logger.debug(
          { protectedStart },
          "Adjusted protected boundary to avoid splitting tool_use/tool_result pair",
        );
      }
    }
  }

  // If everything is protected, nothing to prune
  if (protectedStart <= 0) {
    return deepCloneMessages(messages);
  }

  // Deep-clone all messages (we modify unprotected ones, but return the full array)
  const cloned = deepCloneMessages(messages);

  // Step 1: Find duplicate file reads
  const duplicateKeys = findDuplicateFileReads(cloned, protectedStart);

  // Step 2: Process unprotected messages
  for (let i = 0; i < protectedStart; i++) {
    const message = cloned[i];
    if (
      !message ||
      message.role !== "user" ||
      !Array.isArray(message.content)
    ) {
      continue;
    }

    for (let j = 0; j < message.content.length; j++) {
      const block = message.content[j];
      if (!block || block.type !== "tool_result") continue;

      const toolResult = block as Anthropic.ToolResultBlockParam;
      const precedingMessage = i > 0 ? cloned[i - 1] : undefined;
      const toolInfo = findToolUseForResult(
        toolResult.tool_use_id,
        precedingMessage,
      );

      if (!toolInfo) continue;

      const key = `${i}:${j}`;
      const originalText = extractToolResultText(toolResult);
      const originalTokens = estimateTokens(originalText);

      // Check if this is a duplicate file read
      if (duplicateKeys.has(key)) {
        const filePath =
          extractInputField(toolInfo.input, "file_path") ||
          extractInputField(toolInfo.input, "path") ||
          extractInputField(toolInfo.input, "filePath");

        toolResult.content = `[Duplicate file read: ${filePath}. ${originalTokens} tokens removed. See later read for current content.]`;
        continue;
      }

      // Apply tier-based replacement
      const tier = classifyTool(toolInfo.name);

      switch (tier) {
        case "file_read": {
          const { truncated, removedTokens } = headTailTruncate(originalText);
          if (removedTokens > 0) {
            toolResult.content = truncated;
          }
          break;
        }

        case "search_list": {
          toolResult.content = buildSearchDescriptor(
            toolInfo.name,
            toolInfo.input,
            originalTokens,
          );
          break;
        }

        case "command": {
          toolResult.content = buildCommandDescriptor(
            toolInfo.name,
            toolInfo.input,
            originalText,
            originalTokens,
          );
          break;
        }

        case "integration": {
          const { truncated, removedTokens } = headTailTruncate(originalText);
          if (removedTokens > 0) {
            toolResult.content = truncated;
          }
          break;
        }

        case "unknown":
          // Leave unknown tools untouched
          break;
      }
    }
  }

  return cloned;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create a HistoryManager instance.
 *
 * The history manager compacts conversation history to fit within
 * context window limits while preserving critical information.
 *
 * Phase 1 (this plan): Descriptor replacement for old tool results.
 * Phase 2 (plan 02): Summarization when Phase 1 is insufficient.
 *
 * @param options - Logger dependency
 * @returns HistoryManager instance
 */
export function createHistoryManager(options: {
  logger: PinoLogger;
}): HistoryManager {
  const { logger } = options;

  if (!logger) {
    throw new Error("logger is required for HistoryManager");
  }

  return {
    async compact(
      messages: Anthropic.MessageParam[],
      config: HistoryConfig,
      _options?: {
        artifacts?: Record<string, string>;
        anthropicClient?: Anthropic;
        systemPrompt?: string;
        tools?: Anthropic.Tool[];
      },
    ): Promise<CompactionResult> {
      const originalTokens = estimateMessageTokens(messages);

      // Below threshold: no pruning needed
      if (originalTokens < config.pruneThreshold) {
        logger.debug(
          { tokens: originalTokens, threshold: config.pruneThreshold },
          "History below prune threshold, no compaction needed",
        );
        return {
          messages,
          phase: "none",
          estimatedTokens: originalTokens,
          tokensSaved: 0,
        };
      }

      // Phase 1: Descriptor replacement
      logger.info(
        { tokens: originalTokens, threshold: config.pruneThreshold },
        "History above prune threshold, applying Phase 1 pruning",
      );

      const prunedMessages = applyPhase1Pruning(messages, config, logger);
      const prunedTokens = estimateMessageTokens(prunedMessages);
      const tokensSaved = originalTokens - prunedTokens;

      logger.info(
        {
          originalTokens,
          prunedTokens,
          tokensSaved,
          savedPercent: Math.round((tokensSaved / originalTokens) * 100),
        },
        "Phase 1 pruning complete",
      );

      // Phase 2 check will be added in plan 02
      // For now, return Phase 1 result

      return {
        messages: prunedMessages,
        phase: "pruned",
        estimatedTokens: prunedTokens,
        tokensSaved,
      };
    },
  };
}
