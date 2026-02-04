/**
 * History Manager Tests
 *
 * Comprehensive unit tests for Phase 1 pruning pipeline:
 * - Token estimation
 * - Protected boundary calculation
 * - File read deduplication
 * - Head+tail truncation
 * - Tool type tier descriptors
 * - Immutability guarantees
 * - Full pipeline integration
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { Mock } from "vitest";
import { describe, expect, it, vi } from "vitest";
import type { HistoryConfig } from "./history-manager.js";
import {
  containsSummary,
  createHistoryManager,
  estimateMessageTokens,
  estimateTokens,
  formatArtifacts,
} from "./history-manager.js";

// ─── Test Helpers ────────────────────────────────────────────────────────────

function makeUserMessage(text: string): Anthropic.MessageParam {
  return { role: "user", content: text };
}

function makeAssistantText(text: string): Anthropic.MessageParam {
  return { role: "assistant", content: text };
}

function makeAssistantWithToolUse(
  text: string,
  toolUses: Array<{ id: string; name: string; input: unknown }>,
): Anthropic.MessageParam {
  const content: Anthropic.ContentBlockParam[] = [];
  if (text) {
    content.push({ type: "text", text });
  }
  for (const tu of toolUses) {
    content.push({
      type: "tool_use",
      id: tu.id,
      name: tu.name,
      input: tu.input,
    });
  }
  return { role: "assistant", content };
}

function makeToolResultMessage(
  results: Array<{ toolUseId: string; content: string; isError?: boolean }>,
): Anthropic.MessageParam {
  const content: Anthropic.ToolResultBlockParam[] = results.map((r) => ({
    type: "tool_result" as const,
    tool_use_id: r.toolUseId,
    content: r.content,
    is_error: r.isError ?? false,
  }));
  return { role: "user", content };
}

function makeLargeContent(tokens: number): string {
  // Each char ~ 0.25 tokens, so tokens * 4 chars
  return "x".repeat(tokens * 4);
}

/**
 * Extract the string content of the first tool_result block from a message.
 * Throws if the message doesn't have the expected structure.
 */
function getToolResultContent(
  message: Anthropic.MessageParam,
  blockIndex = 0,
): string {
  if (!Array.isArray(message.content)) {
    throw new Error("Expected array content");
  }
  const block = message.content[blockIndex] as
    | Anthropic.ToolResultBlockParam
    | undefined;
  if (!block || block.type !== "tool_result") {
    throw new Error(`Expected tool_result at index ${blockIndex}`);
  }
  return String(block.content);
}

/**
 * Extract the tool_use_id from the first tool_result block in a message.
 */
function getToolResultId(
  message: Anthropic.MessageParam,
  blockIndex = 0,
): string {
  if (!Array.isArray(message.content)) {
    throw new Error("Expected array content");
  }
  const block = message.content[blockIndex] as
    | Anthropic.ToolResultBlockParam
    | undefined;
  if (!block || block.type !== "tool_result") {
    throw new Error(`Expected tool_result at index ${blockIndex}`);
  }
  return block.tool_use_id;
}

/**
 * Find the tool_use block ID in an assistant message.
 */
function getToolUseId(message: Anthropic.MessageParam): string {
  if (!Array.isArray(message.content)) {
    throw new Error("Expected array content");
  }
  const block = message.content.find((b) => b.type === "tool_use") as
    | Anthropic.ToolUseBlockParam
    | undefined;
  if (!block) {
    throw new Error("No tool_use block found");
  }
  return block.id;
}

const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  child: vi.fn().mockReturnThis(),
  level: "debug",
  silent: vi.fn(),
} as unknown as Parameters<typeof createHistoryManager>[0]["logger"];

const testConfig: HistoryConfig = {
  pruneThreshold: 1000,
  protectedMessages: 4,
  summaryThreshold: 2000,
  summaryModel: "claude-haiku-4-5-20251001",
};

// ─── estimateTokens ──────────────────────────────────────────────────────────

describe("estimateTokens", () => {
  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("returns ceil(length/4) for known string", () => {
    // 10 chars -> ceil(10/4) = 3
    expect(estimateTokens("0123456789")).toBe(3);
    // 4 chars -> ceil(4/4) = 1
    expect(estimateTokens("abcd")).toBe(1);
    // 5 chars -> ceil(5/4) = 2
    expect(estimateTokens("abcde")).toBe(2);
    // 1 char -> ceil(1/4) = 1
    expect(estimateTokens("a")).toBe(1);
  });

  it("handles multi-byte characters by character count", () => {
    const emoji = "Hello World";
    expect(estimateTokens(emoji)).toBe(Math.ceil(emoji.length / 4));
  });
});

// ─── estimateMessageTokens ───────────────────────────────────────────────────

describe("estimateMessageTokens", () => {
  it("returns 0 for empty array", () => {
    expect(estimateMessageTokens([])).toBe(0);
  });

  it("estimates simple text messages correctly", () => {
    const messages: Anthropic.MessageParam[] = [
      makeUserMessage("Hello"), // 5 chars -> ceil(5/4) = 2 + 4 overhead = 6
      makeAssistantText("World"), // 5 chars -> ceil(5/4) = 2 + 4 overhead = 6
    ];
    expect(estimateMessageTokens(messages)).toBe(12);
  });

  it("estimates messages with tool_use and tool_result blocks", () => {
    const messages: Anthropic.MessageParam[] = [
      makeAssistantWithToolUse("thinking", [
        {
          id: "tu_1",
          name: "read_file",
          input: { file_path: "/src/index.ts" },
        },
      ]),
      makeToolResultMessage([
        { toolUseId: "tu_1", content: "file contents here" },
      ]),
    ];

    const tokens = estimateMessageTokens(messages);
    // Assistant: 4 overhead + "thinking" (2) + "read_file" (3) + JSON input
    // User: 4 overhead + "file contents here" (5)
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeGreaterThanOrEqual(8); // At minimum 4+4 overhead
  });
});

// ─── compact -- below threshold ──────────────────────────────────────────────

describe("compact -- below threshold", () => {
  it('returns phase "none" with original messages when below pruneThreshold', async () => {
    const manager = createHistoryManager({ logger: mockLogger });
    const messages: Anthropic.MessageParam[] = [
      makeUserMessage("Hello"),
      makeAssistantText("Hi there"),
    ];

    const result = await manager.compact(messages, testConfig);

    expect(result.phase).toBe("none");
    expect(result.messages).toBe(messages);
    expect(result.estimatedTokens).toBeGreaterThan(0);
  });

  it("returns tokensSaved of 0 when no pruning occurs", async () => {
    const manager = createHistoryManager({ logger: mockLogger });
    const messages: Anthropic.MessageParam[] = [
      makeUserMessage("Short message"),
    ];

    const result = await manager.compact(messages, testConfig);

    expect(result.tokensSaved).toBe(0);
    expect(result.phase).toBe("none");
  });
});

// ─── compact -- protected boundary ───────────────────────────────────────────

describe("compact -- protected boundary", () => {
  it("does not modify the last N protected messages", async () => {
    const manager = createHistoryManager({ logger: mockLogger });

    const largeContent = makeLargeContent(500);
    const messages: Anthropic.MessageParam[] = [
      // Unprotected region
      makeAssistantWithToolUse("I will search", [
        { id: "tu_old", name: "search_codebase", input: { query: "test" } },
      ]),
      makeToolResultMessage([{ toolUseId: "tu_old", content: largeContent }]),
      // Protected region (last 4 messages)
      makeUserMessage("Do something else"),
      makeAssistantWithToolUse("Reading file", [
        {
          id: "tu_new",
          name: "read_file",
          input: { file_path: "/src/a.ts" },
        },
      ]),
      makeToolResultMessage([{ toolUseId: "tu_new", content: largeContent }]),
      makeAssistantText("Here is what I found"),
    ];

    const config = { ...testConfig, pruneThreshold: 100 };
    const result = await manager.compact(messages, config);

    // Protected messages (last 4) should have identical content
    expect(result.messages[2]).toEqual(messages[2]);
    expect(result.messages[3]).toEqual(messages[3]);
    expect(result.messages[4]).toEqual(messages[4]);
    expect(result.messages[5]).toEqual(messages[5]);
  });

  it("adjusts boundary backward when it would split tool_use/tool_result pair", async () => {
    const manager = createHistoryManager({ logger: mockLogger });

    const largeContent = makeLargeContent(500);
    // 7 messages total, protectedMessages = 4
    // protectedStart = 7 - 4 = 3
    // message[3] is a tool_result-only user message -> adjust to 2
    const messages: Anthropic.MessageParam[] = [
      makeUserMessage("Start task"), // 0
      makeAssistantWithToolUse("Reading", [
        { id: "tu_1", name: "read_file", input: { file_path: "/a.ts" } },
      ]), // 1
      makeAssistantWithToolUse("Searching", [
        { id: "tu_2", name: "search_codebase", input: { query: "foo" } },
      ]), // 2 - boundary adjusts to here
      makeToolResultMessage([{ toolUseId: "tu_2", content: largeContent }]), // 3 - original boundary (tool_result only)
      makeUserMessage("Continue"),
      makeAssistantText("Working on it"),
      makeAssistantText("Done"),
    ];

    const config = { ...testConfig, pruneThreshold: 100 };
    const result = await manager.compact(messages, config);

    // Both index 2 and 3 should be protected
    expect(result.messages[2]).toEqual(messages[2]);
    expect(result.messages[3]).toEqual(messages[3]);
  });

  it("handles case where all messages are protected", async () => {
    const manager = createHistoryManager({ logger: mockLogger });

    const messages: Anthropic.MessageParam[] = [
      makeUserMessage(makeLargeContent(500)),
      makeAssistantText("Response"),
    ];

    const config = {
      ...testConfig,
      pruneThreshold: 100,
      protectedMessages: 10,
    };
    const result = await manager.compact(messages, config);

    expect(result.phase).toBe("pruned");
    expect(result.messages).toEqual(messages);
  });
});

// ─── compact -- deduplication ────────────────────────────────────────────────

describe("compact -- deduplication", () => {
  it("replaces earlier duplicate file read with descriptor, preserves later read", async () => {
    const manager = createHistoryManager({ logger: mockLogger });

    const fileContent1 = makeLargeContent(200);
    const fileContent2 = makeLargeContent(200);
    const messages: Anthropic.MessageParam[] = [
      // First read (earlier -- deduped)
      makeAssistantWithToolUse("Reading file", [
        {
          id: "tu_1",
          name: "read_file",
          input: { file_path: "/src/index.ts" },
        },
      ]),
      makeToolResultMessage([{ toolUseId: "tu_1", content: fileContent1 }]),
      // Second read (later -- preserved)
      makeAssistantWithToolUse("Reading again", [
        {
          id: "tu_2",
          name: "read_file",
          input: { file_path: "/src/index.ts" },
        },
      ]),
      makeToolResultMessage([{ toolUseId: "tu_2", content: fileContent2 }]),
      // Protected tail
      makeUserMessage("Continue"),
      makeAssistantText("OK"),
      makeUserMessage("More"),
      makeAssistantText("Done"),
      makeUserMessage("End"),
      makeAssistantText("Final"),
    ];

    const config = {
      ...testConfig,
      pruneThreshold: 100,
      protectedMessages: 4,
    };
    const result = await manager.compact(messages, config);

    const firstContent = getToolResultContent(
      result.messages[1] as Anthropic.MessageParam,
    );
    expect(firstContent).toContain("Duplicate file read");
    expect(firstContent).toContain("/src/index.ts");
  });

  it("replaces all but the last read when three reads of same file", async () => {
    const manager = createHistoryManager({ logger: mockLogger });

    const messages: Anthropic.MessageParam[] = [
      makeAssistantWithToolUse("r1", [
        { id: "tu_1", name: "read_file", input: { file_path: "/a.ts" } },
      ]),
      makeToolResultMessage([
        { toolUseId: "tu_1", content: makeLargeContent(100) },
      ]),
      makeAssistantWithToolUse("r2", [
        { id: "tu_2", name: "read_file", input: { file_path: "/a.ts" } },
      ]),
      makeToolResultMessage([
        { toolUseId: "tu_2", content: makeLargeContent(100) },
      ]),
      makeAssistantWithToolUse("r3", [
        { id: "tu_3", name: "read_file", input: { file_path: "/a.ts" } },
      ]),
      makeToolResultMessage([
        { toolUseId: "tu_3", content: makeLargeContent(100) },
      ]),
      // Protected tail
      makeUserMessage("x"),
      makeAssistantText("y"),
      makeUserMessage("z"),
      makeAssistantText("w"),
    ];

    const config = {
      ...testConfig,
      pruneThreshold: 100,
      protectedMessages: 4,
    };
    const result = await manager.compact(messages, config);

    // First two reads replaced
    expect(
      getToolResultContent(result.messages[1] as Anthropic.MessageParam),
    ).toContain("Duplicate file read");
    expect(
      getToolResultContent(result.messages[3] as Anthropic.MessageParam),
    ).toContain("Duplicate file read");

    // Third read preserved
    expect(
      getToolResultContent(result.messages[5] as Anthropic.MessageParam),
    ).not.toContain("Duplicate file read");
  });

  it("preserves both reads when different file paths", async () => {
    const manager = createHistoryManager({ logger: mockLogger });

    const messages: Anthropic.MessageParam[] = [
      makeAssistantWithToolUse("r1", [
        { id: "tu_1", name: "read_file", input: { file_path: "/a.ts" } },
      ]),
      makeToolResultMessage([
        { toolUseId: "tu_1", content: makeLargeContent(100) },
      ]),
      makeAssistantWithToolUse("r2", [
        { id: "tu_2", name: "read_file", input: { file_path: "/b.ts" } },
      ]),
      makeToolResultMessage([
        { toolUseId: "tu_2", content: makeLargeContent(100) },
      ]),
      // Protected tail
      makeUserMessage("x"),
      makeAssistantText("y"),
      makeUserMessage("z"),
      makeAssistantText("w"),
    ];

    const config = {
      ...testConfig,
      pruneThreshold: 100,
      protectedMessages: 4,
    };
    const result = await manager.compact(messages, config);

    // Neither should be a duplicate
    expect(
      getToolResultContent(result.messages[1] as Anthropic.MessageParam),
    ).not.toContain("Duplicate file read");
    expect(
      getToolResultContent(result.messages[3] as Anthropic.MessageParam),
    ).not.toContain("Duplicate file read");
  });
});

// ─── compact -- head+tail truncation ─────────────────────────────────────────

describe("compact -- head+tail truncation", () => {
  it("truncates large file read content to head(500)+tail(1500) tokens", async () => {
    const manager = createHistoryManager({ logger: mockLogger });

    const largeFile = makeLargeContent(5000);
    const messages: Anthropic.MessageParam[] = [
      makeAssistantWithToolUse("reading", [
        {
          id: "tu_1",
          name: "read_file",
          input: { file_path: "/big-file.ts" },
        },
      ]),
      makeToolResultMessage([{ toolUseId: "tu_1", content: largeFile }]),
      makeUserMessage("a"),
      makeAssistantText("b"),
      makeUserMessage("c"),
      makeAssistantText("d"),
    ];

    const config = {
      ...testConfig,
      pruneThreshold: 100,
      protectedMessages: 4,
    };
    const result = await manager.compact(messages, config);

    const truncatedContent = getToolResultContent(
      result.messages[1] as Anthropic.MessageParam,
    );

    expect(truncatedContent).toContain("tokens truncated");
    expect(truncatedContent.length).toBeLessThan(largeFile.length);
    expect(truncatedContent.startsWith("x".repeat(100))).toBe(true);
    expect(truncatedContent.endsWith("x".repeat(100))).toBe(true);
  });

  it("does not truncate small file read content below threshold", async () => {
    const manager = createHistoryManager({ logger: mockLogger });

    const smallFile = makeLargeContent(500);
    const messages: Anthropic.MessageParam[] = [
      makeAssistantWithToolUse("reading", [
        {
          id: "tu_1",
          name: "read_file",
          input: { file_path: "/small.ts" },
        },
      ]),
      makeToolResultMessage([{ toolUseId: "tu_1", content: smallFile }]),
      makeUserMessage("a"),
      makeAssistantText("b"),
      makeUserMessage("c"),
      makeAssistantText("d"),
    ];

    const config = {
      ...testConfig,
      pruneThreshold: 100,
      protectedMessages: 4,
    };
    const result = await manager.compact(messages, config);

    const content = getToolResultContent(
      result.messages[1] as Anthropic.MessageParam,
    );

    expect(content).not.toContain("tokens truncated");
    expect(content).toBe(smallFile);
  });

  it("includes removed token count in truncation marker", async () => {
    const manager = createHistoryManager({ logger: mockLogger });

    // 10000 tokens. After truncation: 10000 - 500 - 1500 = 8000 removed
    const largeFile = makeLargeContent(10000);
    const messages: Anthropic.MessageParam[] = [
      makeAssistantWithToolUse("reading", [
        {
          id: "tu_1",
          name: "read_file",
          input: { file_path: "/huge.ts" },
        },
      ]),
      makeToolResultMessage([{ toolUseId: "tu_1", content: largeFile }]),
      makeUserMessage("a"),
      makeAssistantText("b"),
      makeUserMessage("c"),
      makeAssistantText("d"),
    ];

    const config = {
      ...testConfig,
      pruneThreshold: 100,
      protectedMessages: 4,
    };
    const result = await manager.compact(messages, config);

    const content = getToolResultContent(
      result.messages[1] as Anthropic.MessageParam,
    );
    expect(content).toContain("8000 tokens truncated");
  });
});

// ─── compact -- tool type tiers ──────────────────────────────────────────────

describe("compact -- tool type tiers", () => {
  it("replaces search_codebase result with minimal descriptor", async () => {
    const manager = createHistoryManager({ logger: mockLogger });

    const messages: Anthropic.MessageParam[] = [
      makeAssistantWithToolUse("searching", [
        {
          id: "tu_1",
          name: "search_codebase",
          input: { query: "authentication", path: "/src" },
        },
      ]),
      makeToolResultMessage([
        {
          toolUseId: "tu_1",
          content: `Found 50 results:\n${"line 1\n".repeat(200)}`,
        },
      ]),
      makeUserMessage("a"),
      makeAssistantText("b"),
      makeUserMessage("c"),
      makeAssistantText("d"),
    ];

    const config = {
      ...testConfig,
      pruneThreshold: 100,
      protectedMessages: 4,
    };
    const result = await manager.compact(messages, config);

    const content = getToolResultContent(
      result.messages[1] as Anthropic.MessageParam,
    );

    expect(content).toContain("[Tool: search_codebase");
    expect(content).toContain("args:");
    expect(content).toContain("tokens removed.]");
  });

  it("replaces run_command result with descriptor including command and exit code", async () => {
    const manager = createHistoryManager({ logger: mockLogger });

    const verboseOutput = `exit code: 0\nAll 42 tests passed\n${"test output line\n".repeat(100)}`;
    const messages: Anthropic.MessageParam[] = [
      makeAssistantWithToolUse("running", [
        {
          id: "tu_1",
          name: "run_command",
          input: { command: "npm test" },
        },
      ]),
      makeToolResultMessage([{ toolUseId: "tu_1", content: verboseOutput }]),
      makeUserMessage("a"),
      makeAssistantText("b"),
      makeUserMessage("c"),
      makeAssistantText("d"),
    ];

    const config = {
      ...testConfig,
      pruneThreshold: 100,
      protectedMessages: 4,
    };
    const result = await manager.compact(messages, config);

    const content = getToolResultContent(
      result.messages[1] as Anthropic.MessageParam,
    );

    expect(content).toContain("[Tool: run_command");
    expect(content).toContain("command: npm test");
    expect(content).toContain("exit code: 0");
    expect(content).toContain("tokens removed.]");
  });

  it("applies head+tail truncation to read_file results", async () => {
    const manager = createHistoryManager({ logger: mockLogger });

    const largeFile = makeLargeContent(5000);
    const messages: Anthropic.MessageParam[] = [
      makeAssistantWithToolUse("reading", [
        {
          id: "tu_1",
          name: "read_file",
          input: { file_path: "/src/big.ts" },
        },
      ]),
      makeToolResultMessage([{ toolUseId: "tu_1", content: largeFile }]),
      makeUserMessage("a"),
      makeAssistantText("b"),
      makeUserMessage("c"),
      makeAssistantText("d"),
    ];

    const config = {
      ...testConfig,
      pruneThreshold: 100,
      protectedMessages: 4,
    };
    const result = await manager.compact(messages, config);

    const content = getToolResultContent(
      result.messages[1] as Anthropic.MessageParam,
    );

    expect(content).toContain("tokens truncated");
    expect(content).not.toContain("[Tool:");
  });

  it("applies head+tail truncation to integration-style tools", async () => {
    const manager = createHistoryManager({ logger: mockLogger });

    const largeResponse = makeLargeContent(5000);
    const messages: Anthropic.MessageParam[] = [
      makeAssistantWithToolUse("getting issue", [
        {
          id: "tu_1",
          name: "linear_get_issue",
          input: { issueId: "ABC-123" },
        },
      ]),
      makeToolResultMessage([{ toolUseId: "tu_1", content: largeResponse }]),
      makeUserMessage("a"),
      makeAssistantText("b"),
      makeUserMessage("c"),
      makeAssistantText("d"),
    ];

    const config = {
      ...testConfig,
      pruneThreshold: 100,
      protectedMessages: 4,
    };
    const result = await manager.compact(messages, config);

    const content = getToolResultContent(
      result.messages[1] as Anthropic.MessageParam,
    );

    expect(content).toContain("tokens truncated");
    expect(content).not.toContain("[Tool:");
  });
});

// ─── compact -- immutability ─────────────────────────────────────────────────

describe("compact -- immutability", () => {
  it("does not mutate the original messages array", async () => {
    const manager = createHistoryManager({ logger: mockLogger });

    const largeContent = makeLargeContent(500);
    const originalContent = largeContent;

    const messages: Anthropic.MessageParam[] = [
      makeAssistantWithToolUse("searching", [
        {
          id: "tu_1",
          name: "search_codebase",
          input: { query: "test" },
        },
      ]),
      makeToolResultMessage([{ toolUseId: "tu_1", content: largeContent }]),
      makeUserMessage("a"),
      makeAssistantText("b"),
      makeUserMessage("c"),
      makeAssistantText("d"),
    ];

    const snapshot = JSON.parse(JSON.stringify(messages));

    const config = {
      ...testConfig,
      pruneThreshold: 100,
      protectedMessages: 4,
    };
    await manager.compact(messages, config);

    // Original should be completely unchanged
    expect(JSON.stringify(messages)).toBe(JSON.stringify(snapshot));

    // Verify original tool result content is still the original
    const content = getToolResultContent(messages[1] as Anthropic.MessageParam);
    expect(content).toBe(originalContent);
  });
});

// ─── compact -- full pipeline ────────────────────────────────────────────────

describe("compact -- full pipeline", () => {
  it("processes a realistic conversation with multiple tool calls above threshold", async () => {
    const manager = createHistoryManager({ logger: mockLogger });

    const messages: Anthropic.MessageParam[] = [
      // Initial task
      makeUserMessage("Implement authentication for the API"),

      // Agent searches codebase
      makeAssistantWithToolUse("Let me search the codebase", [
        {
          id: "tu_1",
          name: "search_codebase",
          input: { query: "authentication" },
        },
      ]),
      makeToolResultMessage([
        {
          toolUseId: "tu_1",
          content: `Found results:\n${"match line\n".repeat(100)}`,
        },
      ]),

      // Agent reads a file
      makeAssistantWithToolUse("Reading auth module", [
        {
          id: "tu_2",
          name: "read_file",
          input: { file_path: "/src/auth.ts" },
        },
      ]),
      makeToolResultMessage([
        { toolUseId: "tu_2", content: makeLargeContent(3000) },
      ]),

      // Agent reads another file
      makeAssistantWithToolUse("Reading config", [
        {
          id: "tu_3",
          name: "read_file",
          input: { file_path: "/src/config.ts" },
        },
      ]),
      makeToolResultMessage([
        { toolUseId: "tu_3", content: makeLargeContent(1000) },
      ]),

      // Agent runs tests
      makeAssistantWithToolUse("Running tests", [
        { id: "tu_4", name: "run_command", input: { command: "npm test" } },
      ]),
      makeToolResultMessage([
        {
          toolUseId: "tu_4",
          content: `exit code: 1\nFailed tests:\n${"failure\n".repeat(50)}`,
        },
      ]),

      // Agent re-reads auth.ts (duplicate)
      makeAssistantWithToolUse("Re-reading auth after changes", [
        {
          id: "tu_5",
          name: "read_file",
          input: { file_path: "/src/auth.ts" },
        },
      ]),
      makeToolResultMessage([
        { toolUseId: "tu_5", content: makeLargeContent(3000) },
      ]),

      // Agent calls Linear
      makeAssistantWithToolUse("Updating issue", [
        {
          id: "tu_6",
          name: "linear_update_issue_status",
          input: { issueId: "ABC-123", status: "in_progress" },
        },
      ]),
      makeToolResultMessage([
        { toolUseId: "tu_6", content: makeLargeContent(500) },
      ]),

      // Agent lists files
      makeAssistantWithToolUse("Listing directory", [
        { id: "tu_7", name: "list_files", input: { path: "/src" } },
      ]),
      makeToolResultMessage([
        {
          toolUseId: "tu_7",
          content: `file1.ts\nfile2.ts\n${"file.ts\n".repeat(50)}`,
        },
      ]),

      // Protected tail messages
      makeUserMessage("Please also add rate limiting"),
      makeAssistantText(
        "I will add rate limiting to the authentication middleware.",
      ),
      makeUserMessage("Make sure to test it"),
      makeAssistantText("Running the full test suite now"),
    ];

    const originalTokens = estimateMessageTokens(messages);

    const config = {
      ...testConfig,
      pruneThreshold: 100,
      protectedMessages: 4,
    };
    const result = await manager.compact(messages, config);

    expect(result.phase).toBe("pruned");
    expect(result.tokensSaved).toBeGreaterThan(0);
    expect(result.estimatedTokens).toBeLessThan(originalTokens);

    // Protected messages (last 4) unchanged
    const msgCount = messages.length;
    expect(result.messages[msgCount - 1]).toEqual(messages[msgCount - 1]);
    expect(result.messages[msgCount - 2]).toEqual(messages[msgCount - 2]);
    expect(result.messages[msgCount - 3]).toEqual(messages[msgCount - 3]);
    expect(result.messages[msgCount - 4]).toEqual(messages[msgCount - 4]);

    // First read of auth.ts deduped (index 4 is the tool result)
    expect(
      getToolResultContent(result.messages[4] as Anthropic.MessageParam),
    ).toContain("Duplicate file read");

    // search_codebase has minimal descriptor
    expect(
      getToolResultContent(result.messages[2] as Anthropic.MessageParam),
    ).toContain("[Tool: search_codebase");
  });

  it("preserves tool_use_id references after pruning", async () => {
    const manager = createHistoryManager({ logger: mockLogger });

    const messages: Anthropic.MessageParam[] = [
      makeAssistantWithToolUse("searching", [
        {
          id: "tu_abc",
          name: "search_codebase",
          input: { query: "test" },
        },
      ]),
      makeToolResultMessage([
        {
          toolUseId: "tu_abc",
          content: "lots of results\n".repeat(100),
        },
      ]),
      makeAssistantWithToolUse("reading", [
        {
          id: "tu_def",
          name: "read_file",
          input: { file_path: "/src/x.ts" },
        },
      ]),
      makeToolResultMessage([
        { toolUseId: "tu_def", content: makeLargeContent(3000) },
      ]),
      // Protected
      makeUserMessage("x"),
      makeAssistantText("y"),
      makeUserMessage("z"),
      makeAssistantText("w"),
    ];

    const config = {
      ...testConfig,
      pruneThreshold: 100,
      protectedMessages: 4,
    };
    const result = await manager.compact(messages, config);

    // tool_use_id preserved in tool_result blocks
    expect(getToolResultId(result.messages[1] as Anthropic.MessageParam)).toBe(
      "tu_abc",
    );
    expect(getToolResultId(result.messages[3] as Anthropic.MessageParam)).toBe(
      "tu_def",
    );

    // tool_use blocks still reference same IDs
    expect(getToolUseId(result.messages[0] as Anthropic.MessageParam)).toBe(
      "tu_abc",
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Phase 2: Summarization Tests
// ═══════════════════════════════════════════════════════════════════════════

// ─── Mock Anthropic Client ───────────────────────────────────────────────

function createMockAnthropicClient(summaryText: string) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: `<summary>${summaryText}</summary>` }],
        usage: { input_tokens: 500, output_tokens: 200 },
        stop_reason: "end_turn",
      }),
    },
  } as unknown as Anthropic;
}

/**
 * Build a conversation that exceeds a given token threshold.
 * Creates tool_use/tool_result pairs with configurable content size.
 */
function buildLargeConversation(
  totalTokens: number,
  protectedMessages: number,
): Anthropic.MessageParam[] {
  const messages: Anthropic.MessageParam[] = [];

  // Calculate how many tool call pairs we need
  // Each pair: assistant (tool_use) + user (tool_result)
  // We need enough tokens to exceed the threshold
  const tokensPerPair = 2000;
  const pairsNeeded = Math.ceil(totalTokens / tokensPerPair);

  for (let i = 0; i < pairsNeeded; i++) {
    messages.push(
      makeAssistantWithToolUse(`Working on step ${i}`, [
        {
          id: `tu_${i}`,
          name: "read_file",
          input: { file_path: `/src/file${i}.ts` },
        },
      ]),
    );
    messages.push(
      makeToolResultMessage([
        {
          toolUseId: `tu_${i}`,
          content: makeLargeContent(tokensPerPair - 20), // subtract overhead
        },
      ]),
    );
  }

  // Add protected tail
  for (let i = 0; i < protectedMessages; i++) {
    if (i % 2 === 0) {
      messages.push(makeUserMessage(`Protected message ${i}`));
    } else {
      messages.push(makeAssistantText(`Protected response ${i}`));
    }
  }

  return messages;
}

// ─── formatArtifacts ─────────────────────────────────────────────────────

describe("formatArtifacts", () => {
  it('returns "(no artifacts recorded yet)" for empty artifacts', () => {
    expect(formatArtifacts({})).toBe("(no artifacts recorded yet)");
  });

  it('formats non-empty artifacts as "- **key**: value" lines', () => {
    const artifacts = {
      branch: "feature/auth",
      issueId: "ABC-123",
      prUrl: "https://github.com/org/repo/pull/42",
    };

    const result = formatArtifacts(artifacts);

    expect(result).toContain("- **branch**: feature/auth");
    expect(result).toContain("- **issueId**: ABC-123");
    expect(result).toContain(
      "- **prUrl**: https://github.com/org/repo/pull/42",
    );
    expect(result.split("\n")).toHaveLength(3);
  });
});

// ─── containsSummary ─────────────────────────────────────────────────────

describe("containsSummary", () => {
  it("returns hasSummary false and summaryIndex -1 for messages without summary", () => {
    const messages: Anthropic.MessageParam[] = [
      makeUserMessage("Hello"),
      makeAssistantText("Hi there"),
      makeUserMessage("Do something"),
    ];

    const result = containsSummary(messages);

    expect(result.hasSummary).toBe(false);
    expect(result.summaryIndex).toBe(-1);
  });

  it("detects summary in a user message with string content", () => {
    const messages: Anthropic.MessageParam[] = [
      {
        role: "user",
        content: "<summary>\nThis is a continuation summary.\n</summary>",
      },
      makeAssistantText("I see the summary"),
      makeUserMessage("Continue the task"),
    ];

    const result = containsSummary(messages);

    expect(result.hasSummary).toBe(true);
    expect(result.summaryIndex).toBe(0);
  });

  it("detects summary at different positions in the message array", () => {
    const messages: Anthropic.MessageParam[] = [
      makeUserMessage("Hello"),
      makeAssistantText("Hi"),
      {
        role: "user",
        content: "<summary>\nContinuation summary.\n</summary>",
      },
      makeAssistantText("Resuming work"),
    ];

    const result = containsSummary(messages);

    expect(result.hasSummary).toBe(true);
    expect(result.summaryIndex).toBe(2);
  });
});

// ─── compact -- Phase 2 trigger ──────────────────────────────────────────

describe("compact -- Phase 2 trigger", () => {
  it('triggers Phase 2 when pruned tokens exceed summaryThreshold (phase "summarized")', async () => {
    const manager = createHistoryManager({ logger: mockLogger });
    const mockClient = createMockAnthropicClient(
      "This is a structured summary of the work done.",
    );

    // Build conversation that exceeds summaryThreshold even after pruning
    // summaryThreshold = 2000, so we need > 2000 tokens after Phase 1
    const messages = buildLargeConversation(5000, 4);

    const config: HistoryConfig = {
      pruneThreshold: 1000,
      protectedMessages: 4,
      summaryThreshold: 2000,
      summaryModel: "claude-haiku-4-5-20251001",
    };

    const result = await manager.compact(messages, config, {
      anthropicClient: mockClient,
      artifacts: { branch: "feature/test" },
    });

    expect(result.phase).toBe("summarized");
    expect(result.tokensSaved).toBeGreaterThan(0);
    expect(mockClient.messages.create).toHaveBeenCalledOnce();
  });

  it('does NOT trigger Phase 2 when pruned tokens are below summaryThreshold (phase "pruned")', async () => {
    const manager = createHistoryManager({ logger: mockLogger });
    const mockClient = createMockAnthropicClient("Should not be called");

    // Build conversation that is above pruneThreshold but below summaryThreshold after pruning
    // After Phase 1 pruning, search results get descriptors which are very small
    const messages: Anthropic.MessageParam[] = [];
    // Add search results that will be heavily pruned
    for (let i = 0; i < 5; i++) {
      messages.push(
        makeAssistantWithToolUse(`Searching ${i}`, [
          {
            id: `tu_${i}`,
            name: "search_codebase",
            input: { query: `query${i}` },
          },
        ]),
      );
      messages.push(
        makeToolResultMessage([
          { toolUseId: `tu_${i}`, content: makeLargeContent(400) },
        ]),
      );
    }
    // Protected tail
    messages.push(makeUserMessage("Continue"));
    messages.push(makeAssistantText("Working on it"));
    messages.push(makeUserMessage("More"));
    messages.push(makeAssistantText("Done"));

    const config: HistoryConfig = {
      pruneThreshold: 1000,
      protectedMessages: 4,
      summaryThreshold: 5000, // High threshold -- pruned result should be below this
      summaryModel: "claude-haiku-4-5-20251001",
    };

    const result = await manager.compact(messages, config, {
      anthropicClient: mockClient,
      artifacts: {},
    });

    expect(result.phase).toBe("pruned");
    expect(mockClient.messages.create).not.toHaveBeenCalled();
  });

  it('skips Phase 2 when no anthropicClient provided even if above threshold (phase "pruned")', async () => {
    const manager = createHistoryManager({ logger: mockLogger });

    // Build conversation exceeding summaryThreshold
    const messages = buildLargeConversation(5000, 4);

    const config: HistoryConfig = {
      pruneThreshold: 1000,
      protectedMessages: 4,
      summaryThreshold: 2000,
      summaryModel: "claude-haiku-4-5-20251001",
    };

    const result = await manager.compact(messages, config, {
      artifacts: { branch: "feature/test" },
      // No anthropicClient provided
    });

    expect(result.phase).toBe("pruned");
  });
});

// ─── compact -- summary generation ───────────────────────────────────────

describe("compact -- summary generation", () => {
  it("includes artifact data in the prompt sent to the LLM", async () => {
    const manager = createHistoryManager({ logger: mockLogger });
    const mockClient = createMockAnthropicClient("Summary with artifacts.");

    const messages = buildLargeConversation(5000, 4);
    const artifacts = {
      branch: "feature/auth-module",
      issueId: "DEV-456",
    };

    const config: HistoryConfig = {
      pruneThreshold: 1000,
      protectedMessages: 4,
      summaryThreshold: 2000,
      summaryModel: "claude-haiku-4-5-20251001",
    };

    await manager.compact(messages, config, {
      anthropicClient: mockClient,
      artifacts,
    });

    // Verify the LLM was called with a prompt containing the artifacts
    const createMock = mockClient.messages.create as unknown as Mock;
    const callArgs = createMock.mock.calls[0]?.[0] as {
      messages: Array<{ content: string }>;
    };
    const promptContent = callArgs.messages[0]?.content;

    expect(promptContent).toContain("feature/auth-module");
    expect(promptContent).toContain("DEV-456");
    expect(promptContent).toContain("Ground-Truth Artifacts");
  });

  it("wraps summary in <summary> tags in the output messages", async () => {
    const manager = createHistoryManager({ logger: mockLogger });
    const summaryContent =
      "Task: Implement authentication.\nCompleted: JWT setup.";
    const mockClient = createMockAnthropicClient(summaryContent);

    const messages = buildLargeConversation(5000, 4);

    const config: HistoryConfig = {
      pruneThreshold: 1000,
      protectedMessages: 4,
      summaryThreshold: 2000,
      summaryModel: "claude-haiku-4-5-20251001",
    };

    const result = await manager.compact(messages, config, {
      anthropicClient: mockClient,
      artifacts: {},
    });

    expect(result.phase).toBe("summarized");

    // First message should be the summary
    const firstMessage = result.messages[0];
    expect(firstMessage?.role).toBe("user");

    const content = firstMessage?.content as string;
    expect(content).toContain("<summary>");
    expect(content).toContain("</summary>");
    expect(content).toContain(summaryContent);
  });

  it("preserves protected messages after summary message", async () => {
    const manager = createHistoryManager({ logger: mockLogger });
    const mockClient = createMockAnthropicClient("Summary of work.");

    const messages = buildLargeConversation(5000, 4);

    const config: HistoryConfig = {
      pruneThreshold: 1000,
      protectedMessages: 4,
      summaryThreshold: 2000,
      summaryModel: "claude-haiku-4-5-20251001",
    };

    const result = await manager.compact(messages, config, {
      anthropicClient: mockClient,
      artifacts: {},
    });

    expect(result.phase).toBe("summarized");

    // Result should be: summary + protected messages
    // Protected = last 4 messages from the pruned set
    const totalMessages = result.messages.length;

    // First message is the summary
    const summaryMsg = result.messages[0];
    expect(summaryMsg?.role).toBe("user");
    expect(summaryMsg?.content as string).toContain("<summary>");

    // Remaining messages are the protected tail
    // They should match the original protected messages
    const originalProtected = messages.slice(-4);
    for (let i = 0; i < 4; i++) {
      expect(result.messages[totalMessages - 4 + i]).toEqual(
        originalProtected[i],
      );
    }
  });
});

// ─── compact -- summary merge ────────────────────────────────────────────

describe("compact -- summary merge", () => {
  it("replaces existing summary with new summary (not nested)", async () => {
    const manager = createHistoryManager({ logger: mockLogger });
    const newSummaryText = "Updated summary with new work.";
    const mockClient = createMockAnthropicClient(newSummaryText);

    // Build conversation with an existing summary at the start
    const messages: Anthropic.MessageParam[] = [
      // Existing summary
      {
        role: "user",
        content: "<summary>\nOld summary from previous compaction.\n</summary>",
      },
      // Additional conversation after the summary
      ...buildLargeConversation(5000, 0),
      // Protected tail
      makeUserMessage("Final instruction"),
      makeAssistantText("Working on it"),
      makeUserMessage("More details"),
      makeAssistantText("All done"),
    ];

    const config: HistoryConfig = {
      pruneThreshold: 1000,
      protectedMessages: 4,
      summaryThreshold: 2000,
      summaryModel: "claude-haiku-4-5-20251001",
    };

    const result = await manager.compact(messages, config, {
      anthropicClient: mockClient,
      artifacts: { branch: "feature/merged" },
    });

    expect(result.phase).toBe("summarized");

    // Should have exactly 1 summary message, not nested
    const summaryMessages = result.messages.filter(
      (m) =>
        m.role === "user" &&
        typeof m.content === "string" &&
        m.content.includes("<summary>"),
    );
    expect(summaryMessages).toHaveLength(1);

    // Should contain the new summary, not the old one
    const summaryContent = summaryMessages[0]?.content as string;
    expect(summaryContent).toContain(newSummaryText);
    expect(summaryContent).not.toContain(
      "Old summary from previous compaction",
    );
  });

  it("passes old summary content to the LLM for context during merge", async () => {
    const manager = createHistoryManager({ logger: mockLogger });
    const mockClient = createMockAnthropicClient("Merged summary.");

    const oldSummary =
      "Previous work: set up project structure and database schema.";
    const messages: Anthropic.MessageParam[] = [
      {
        role: "user",
        content: `<summary>\n${oldSummary}\n</summary>`,
      },
      // Add enough content to exceed thresholds
      ...buildLargeConversation(5000, 0),
      makeUserMessage("Continue"),
      makeAssistantText("Working"),
      makeUserMessage("More"),
      makeAssistantText("Done"),
    ];

    const config: HistoryConfig = {
      pruneThreshold: 1000,
      protectedMessages: 4,
      summaryThreshold: 2000,
      summaryModel: "claude-haiku-4-5-20251001",
    };

    await manager.compact(messages, config, {
      anthropicClient: mockClient,
      artifacts: {},
    });

    // Verify the LLM was called with content that includes the old summary
    const createMock = mockClient.messages.create as unknown as Mock;
    const callArgs = createMock.mock.calls[0]?.[0] as {
      messages: Array<{ content: string }>;
    };
    const promptContent = callArgs.messages[0]?.content;

    expect(promptContent).toContain(oldSummary);
  });
});

// ─── compact -- error handling ───────────────────────────────────────────

describe("compact -- error handling", () => {
  it('returns Phase 1 pruned result as fallback when LLM call rejects (phase "pruned")', async () => {
    const manager = createHistoryManager({ logger: mockLogger });

    const failingClient = {
      messages: {
        create: vi.fn().mockRejectedValue(new Error("API rate limit exceeded")),
      },
    } as unknown as Anthropic;

    // Use large file reads that will be truncated by Phase 1
    // Each read is 5000 tokens, head+tail keeps 2000, so Phase 1 actually saves tokens
    const messages: Anthropic.MessageParam[] = [];
    for (let i = 0; i < 3; i++) {
      messages.push(
        makeAssistantWithToolUse(`Reading file ${i}`, [
          {
            id: `tu_${i}`,
            name: "read_file",
            input: { file_path: `/src/file${i}.ts` },
          },
        ]),
      );
      messages.push(
        makeToolResultMessage([
          { toolUseId: `tu_${i}`, content: makeLargeContent(5000) },
        ]),
      );
    }
    // Protected tail
    messages.push(makeUserMessage("Continue"));
    messages.push(makeAssistantText("Working"));
    messages.push(makeUserMessage("More"));
    messages.push(makeAssistantText("Done"));

    const config: HistoryConfig = {
      pruneThreshold: 1000,
      protectedMessages: 4,
      summaryThreshold: 2000,
      summaryModel: "claude-haiku-4-5-20251001",
    };

    const result = await manager.compact(messages, config, {
      anthropicClient: failingClient,
      artifacts: {},
    });

    // Should fall back to pruned, not throw
    expect(result.phase).toBe("pruned");
    expect(result.tokensSaved).toBeGreaterThan(0);
    expect(result.messages.length).toBeGreaterThan(0);
  });

  it("uses full response text as summary when LLM returns without <summary> tags", async () => {
    const manager = createHistoryManager({ logger: mockLogger });
    const rawSummary = "This is the summary without any XML tags.";

    const noTagsClient = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: rawSummary }],
          usage: { input_tokens: 500, output_tokens: 100 },
          stop_reason: "end_turn",
        }),
      },
    } as unknown as Anthropic;

    const messages = buildLargeConversation(5000, 4);

    const config: HistoryConfig = {
      pruneThreshold: 1000,
      protectedMessages: 4,
      summaryThreshold: 2000,
      summaryModel: "claude-haiku-4-5-20251001",
    };

    const result = await manager.compact(messages, config, {
      anthropicClient: noTagsClient,
      artifacts: {},
    });

    expect(result.phase).toBe("summarized");

    // The summary message should wrap the raw text in tags
    const summaryMsg = result.messages[0];
    expect(summaryMsg?.content as string).toContain("<summary>");
    expect(summaryMsg?.content as string).toContain(rawSummary);
  });
});

// ─── compact -- full end-to-end pipeline ─────────────────────────────────

describe("compact -- full end-to-end pipeline", () => {
  it("summarizes conversation exceeding summaryThreshold with realistic tool calls", async () => {
    const manager = createHistoryManager({ logger: mockLogger });
    const summaryText =
      "Task: Implement auth. Completed: JWT token generation, middleware setup. Artifacts: branch feature/auth, issue DEV-789.";
    const mockClient = createMockAnthropicClient(summaryText);

    // Build a realistic conversation with mixed tool types
    const messages: Anthropic.MessageParam[] = [
      makeUserMessage("Implement JWT authentication for the API"),

      // Agent searches
      makeAssistantWithToolUse("Searching for auth patterns", [
        {
          id: "tu_1",
          name: "search_codebase",
          input: { query: "authentication middleware" },
        },
      ]),
      makeToolResultMessage([
        {
          toolUseId: "tu_1",
          content: `Found results:\n${"match line\n".repeat(200)}`,
        },
      ]),

      // Agent reads files (large content)
      makeAssistantWithToolUse("Reading main server file", [
        {
          id: "tu_2",
          name: "read_file",
          input: { file_path: "/src/server.ts" },
        },
      ]),
      makeToolResultMessage([
        { toolUseId: "tu_2", content: makeLargeContent(3000) },
      ]),

      // Agent reads another file
      makeAssistantWithToolUse("Reading auth types", [
        {
          id: "tu_3",
          name: "read_file",
          input: { file_path: "/src/types/auth.ts" },
        },
      ]),
      makeToolResultMessage([
        { toolUseId: "tu_3", content: makeLargeContent(2000) },
      ]),

      // Agent runs command
      makeAssistantWithToolUse("Running tests", [
        {
          id: "tu_4",
          name: "run_command",
          input: { command: "npm test -- --coverage" },
        },
      ]),
      makeToolResultMessage([
        {
          toolUseId: "tu_4",
          content: `exit code: 0\nAll tests passed\n${"output\n".repeat(100)}`,
        },
      ]),

      // Agent reads server.ts again (duplicate)
      makeAssistantWithToolUse("Re-reading server after changes", [
        {
          id: "tu_5",
          name: "read_file",
          input: { file_path: "/src/server.ts" },
        },
      ]),
      makeToolResultMessage([
        { toolUseId: "tu_5", content: makeLargeContent(3000) },
      ]),

      // Agent calls Linear
      makeAssistantWithToolUse("Updating issue status", [
        {
          id: "tu_6",
          name: "linear_update_issue_status",
          input: { issueId: "DEV-789", status: "in_progress" },
        },
      ]),
      makeToolResultMessage([
        { toolUseId: "tu_6", content: makeLargeContent(500) },
      ]),

      // More file reads
      makeAssistantWithToolUse("Reading middleware", [
        {
          id: "tu_7",
          name: "read_file",
          input: { file_path: "/src/middleware/auth.ts" },
        },
      ]),
      makeToolResultMessage([
        { toolUseId: "tu_7", content: makeLargeContent(2000) },
      ]),

      // Protected tail
      makeUserMessage("Please also handle token refresh"),
      makeAssistantText("I will implement refresh token rotation."),
      makeUserMessage("Make sure refresh tokens expire after 7 days"),
      makeAssistantText("Setting refresh token TTL to 7 days."),
    ];

    const config: HistoryConfig = {
      pruneThreshold: 1000,
      protectedMessages: 4,
      summaryThreshold: 2000,
      summaryModel: "claude-haiku-4-5-20251001",
    };

    const originalTokens = estimateMessageTokens(messages);

    const result = await manager.compact(messages, config, {
      anthropicClient: mockClient,
      artifacts: { branch: "feature/auth", issueId: "DEV-789" },
    });

    // Phase should be summarized
    expect(result.phase).toBe("summarized");

    // Tokens saved should be significant
    expect(result.tokensSaved).toBeGreaterThan(0);
    expect(result.estimatedTokens).toBeLessThan(originalTokens);

    // First message should be the summary with tags
    const summaryMsg = result.messages[0];
    expect(summaryMsg?.role).toBe("user");
    expect(summaryMsg?.content as string).toContain("<summary>");
    expect(summaryMsg?.content as string).toContain("</summary>");
    expect(summaryMsg?.content as string).toContain(summaryText);

    // Protected messages should be intact at the end
    const lastFour = result.messages.slice(-4);
    expect(lastFour[0]).toEqual(
      makeUserMessage("Please also handle token refresh"),
    );
    expect(lastFour[1]).toEqual(
      makeAssistantText("I will implement refresh token rotation."),
    );
    expect(lastFour[2]).toEqual(
      makeUserMessage("Make sure refresh tokens expire after 7 days"),
    );
    expect(lastFour[3]).toEqual(
      makeAssistantText("Setting refresh token TTL to 7 days."),
    );

    // LLM should have been called with the correct model
    const createMock = mockClient.messages.create as unknown as Mock;
    const callArgs = createMock.mock.calls[0]?.[0] as {
      model: string;
    };
    expect(callArgs.model).toBe("claude-haiku-4-5-20251001");
  });

  it("stops at Phase 1 when below summaryThreshold and does not call LLM", async () => {
    const manager = createHistoryManager({ logger: mockLogger });
    const mockClient = createMockAnthropicClient("Should not be called");

    // Build conversation above pruneThreshold but with search results
    // that will be heavily pruned by Phase 1 (descriptors are tiny)
    const messages: Anthropic.MessageParam[] = [];

    // Add 10 search results -- each will be replaced with a tiny descriptor
    for (let i = 0; i < 10; i++) {
      messages.push(
        makeAssistantWithToolUse(`Search ${i}`, [
          {
            id: `tu_${i}`,
            name: "search_codebase",
            input: { query: `query ${i}` },
          },
        ]),
      );
      messages.push(
        makeToolResultMessage([
          { toolUseId: `tu_${i}`, content: makeLargeContent(300) },
        ]),
      );
    }

    // Protected tail
    messages.push(makeUserMessage("Continue"));
    messages.push(makeAssistantText("Working"));
    messages.push(makeUserMessage("More"));
    messages.push(makeAssistantText("Done"));

    const config: HistoryConfig = {
      pruneThreshold: 1000,
      protectedMessages: 4,
      summaryThreshold: 50000, // Very high -- will not be exceeded after pruning
      summaryModel: "claude-haiku-4-5-20251001",
    };

    const result = await manager.compact(messages, config, {
      anthropicClient: mockClient,
      artifacts: {},
    });

    expect(result.phase).toBe("pruned");
    expect(mockClient.messages.create).not.toHaveBeenCalled();
  });
});
