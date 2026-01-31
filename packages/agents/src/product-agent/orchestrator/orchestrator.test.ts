/**
 * Unit tests for the product agent orchestrator.
 *
 * Tests conversation history compaction logic that prevents
 * unbounded history growth from consuming the agent's token budget.
 */

import { describe, expect, it, vi } from "vitest";
import { compactConversationHistory, escapeXml } from "./orchestrator.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type HistoryMessage = { role: "user" | "assistant"; content: string };

/** Create N user/assistant exchange pairs */
function createHistory(turnCount: number, contentSize = 100): HistoryMessage[] {
  const messages: HistoryMessage[] = [];
  for (let i = 0; i < turnCount; i++) {
    messages.push({
      role: "user",
      content: `User message ${i + 1}: ${"x".repeat(contentSize)}`,
    });
    messages.push({
      role: "assistant",
      content: `Agent response ${i + 1}: ${"y".repeat(contentSize)}`,
    });
  }
  return messages;
}

/** Minimal mock logger */
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn().mockReturnThis(),
} as unknown as Parameters<typeof compactConversationHistory>[1];

/** Mock Anthropic client that returns a canned summary */
function createMockAnthropicClient(
  summary = "- User requested a feature\n- Agent drafted issue",
) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: summary }],
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
    },
  } as unknown as Parameters<typeof compactConversationHistory>[2];
}

/** Mock Anthropic client that throws */
function createFailingAnthropicClient() {
  return {
    messages: {
      create: vi.fn().mockRejectedValue(new Error("API rate limited")),
    },
  } as unknown as Parameters<typeof compactConversationHistory>[2];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("compactConversationHistory", () => {
  describe("below threshold — passthrough", () => {
    it("passes through short history unchanged", async () => {
      const history = createHistory(3); // 6 messages, threshold is 16
      const { formatted, compacted } = await compactConversationHistory(
        history,
        mockLogger,
      );

      expect(compacted).toBe(false);
      expect(formatted).toContain("User message 1");
      expect(formatted).toContain("Agent response 3");
      expect(formatted).not.toContain("conversation_summary");
    });

    it("passes through history just below threshold", async () => {
      const history = createHistory(7); // 14 messages, threshold is 16
      const { compacted } = await compactConversationHistory(
        history,
        mockLogger,
      );

      expect(compacted).toBe(false);
    });

    it("handles empty history", async () => {
      const { formatted, compacted } = await compactConversationHistory(
        [],
        mockLogger,
      );

      expect(compacted).toBe(false);
      expect(formatted).toBe("");
    });
  });

  describe("above threshold — compaction", () => {
    it("summarizes older messages and keeps recent ones verbatim", async () => {
      const history = createHistory(10); // 20 messages, threshold is 16
      const mockClient = createMockAnthropicClient();
      const { formatted, compacted } = await compactConversationHistory(
        history,
        mockLogger,
        mockClient,
      );

      expect(compacted).toBe(true);
      expect(formatted).toContain("<conversation_summary>");
      expect(formatted).toContain("User requested a feature");
      expect(formatted).toContain("Recent messages:");
      // Recent messages (last 12) should be verbatim — turn 5 onward
      expect(formatted).toContain("User message 5");
      expect(formatted).toContain("Agent response 10");
    });

    it("calls compaction model with older messages only", async () => {
      const history = createHistory(10); // 20 messages
      const mockClient = createMockAnthropicClient();
      await compactConversationHistory(history, mockLogger, mockClient);

      const createCall = (
        mockClient as unknown as {
          messages: { create: ReturnType<typeof vi.fn> };
        }
      ).messages.create;
      expect(createCall).toHaveBeenCalledTimes(1);

      // Older messages = first 8 (20 - 12 recent)
      const userContent = createCall.mock.calls[0]?.[0]?.messages[0]?.content;
      expect(userContent).toContain("User message 1");
      expect(userContent).toContain("Agent response 4");
      // Should NOT contain recent messages
      expect(userContent).not.toContain("User message 5");
    });

    it("includes summary message count", async () => {
      const history = createHistory(10);
      const mockClient = createMockAnthropicClient();
      const { formatted } = await compactConversationHistory(
        history,
        mockLogger,
        mockClient,
      );

      expect(formatted).toContain("Summary of 8 earlier messages");
    });
  });

  describe("fallback on compaction failure", () => {
    it("falls back to recent messages when API call fails", async () => {
      const history = createHistory(10); // 20 messages
      const mockClient = createFailingAnthropicClient();
      const { formatted, compacted } = await compactConversationHistory(
        history,
        mockLogger,
        mockClient,
      );

      expect(compacted).toBe(true);
      expect(formatted).toContain("earlier messages could not be summarized");
      // Recent messages should still be present
      expect(formatted).toContain("User message 5");
      expect(formatted).toContain("Agent response 10");
      // Older messages should NOT be present (use word boundary to avoid matching "10")
      expect(formatted).not.toMatch(/User message 1:/);
      expect(formatted).not.toMatch(/Agent response 4:/);
    });

    it("logs warning on compaction failure", async () => {
      const history = createHistory(10);
      const mockClient = createFailingAnthropicClient();
      await compactConversationHistory(history, mockLogger, mockClient);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(Error) }),
        expect.stringContaining("compaction failed"),
      );
    });
  });

  describe("edge cases", () => {
    it("handles history at exactly the threshold", async () => {
      const history = createHistory(8); // 16 messages = COMPACTION_THRESHOLD
      const mockClient = createMockAnthropicClient();
      const { compacted } = await compactConversationHistory(
        history,
        mockLogger,
        mockClient,
      );

      expect(compacted).toBe(true);
    });

    it("does not mutate the original array", async () => {
      const history = createHistory(10);
      const originalLength = history.length;
      const mockClient = createMockAnthropicClient();

      await compactConversationHistory(history, mockLogger, mockClient);

      expect(history).toHaveLength(originalLength);
    });

    it("handles compaction model returning empty text", async () => {
      const history = createHistory(10);
      const mockClient = {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [{ type: "text", text: "" }],
          }),
        },
      } as unknown as Parameters<typeof compactConversationHistory>[2];

      const { formatted, compacted } = await compactConversationHistory(
        history,
        mockLogger,
        mockClient,
      );

      // Should fall back — empty summary is treated as failure
      expect(compacted).toBe(true);
      expect(formatted).toContain("could not be summarized");
    });
  });

  describe("XML escaping in formatted output", () => {
    it("escapes XML in user messages below threshold", async () => {
      const history: HistoryMessage[] = [
        { role: "user", content: "I need a <button> component" },
        { role: "assistant", content: "Sure, I can help with that" },
      ];
      const { formatted } = await compactConversationHistory(
        history,
        mockLogger,
      );

      expect(formatted).toContain("&lt;button&gt;");
      expect(formatted).not.toContain("<button>");
    });

    it("escapes closing XML tags that could break structure", async () => {
      const history: HistoryMessage[] = [
        {
          role: "user",
          content: "Use </conversation_history> in the template",
        },
        { role: "assistant", content: "Noted" },
      ];
      const { formatted } = await compactConversationHistory(
        history,
        mockLogger,
      );

      expect(formatted).toContain("&lt;/conversation_history&gt;");
      expect(formatted).not.toContain("</conversation_history>");
    });

    it("escapes phase tags in history to prevent misinterpretation", async () => {
      const history: HistoryMessage[] = [
        { role: "user", content: "test" },
        {
          role: "assistant",
          content: "reasoning here <phase>complete</phase>",
        },
      ];
      const { formatted } = await compactConversationHistory(
        history,
        mockLogger,
      );

      expect(formatted).toContain("&lt;phase&gt;complete&lt;/phase&gt;");
      expect(formatted).not.toContain("<phase>");
    });

    it("escapes ampersands to prevent double-escaping issues", async () => {
      const history: HistoryMessage[] = [
        { role: "user", content: "Tom & Jerry use <div>" },
        { role: "assistant", content: "Got it" },
      ];
      const { formatted } = await compactConversationHistory(
        history,
        mockLogger,
      );

      expect(formatted).toContain("Tom &amp; Jerry use &lt;div&gt;");
    });

    it("escapes XML in recent messages after compaction", async () => {
      const history = createHistory(9); // 18 messages, over threshold
      // Replace the last user message with XML content
      history[history.length - 2] = {
        role: "user",
        content: "Add <input type='text' /> to the form",
      };
      const mockClient = createMockAnthropicClient();
      const { formatted } = await compactConversationHistory(
        history,
        mockLogger,
        mockClient,
      );

      // Angle brackets must be escaped (single quotes are safe in XML context)
      expect(formatted).not.toMatch(/<input/);
      expect(formatted).toContain("&lt;input type='text' /&gt;");
    });
  });
});

// ---------------------------------------------------------------------------
// escapeXml unit tests
// ---------------------------------------------------------------------------

describe("escapeXml", () => {
  it("escapes angle brackets", () => {
    expect(escapeXml("<div>hello</div>")).toBe("&lt;div&gt;hello&lt;/div&gt;");
  });

  it("escapes ampersands", () => {
    expect(escapeXml("Tom & Jerry")).toBe("Tom &amp; Jerry");
  });

  it("escapes ampersands before angle brackets (order matters)", () => {
    expect(escapeXml("&lt;already escaped&gt;")).toBe(
      "&amp;lt;already escaped&amp;gt;",
    );
  });

  it("leaves plain text unchanged", () => {
    expect(escapeXml("hello world 123")).toBe("hello world 123");
  });

  it("handles empty string", () => {
    expect(escapeXml("")).toBe("");
  });

  it("escapes mixed content", () => {
    expect(escapeXml("if (a < b && c > d) {}")).toBe(
      "if (a &lt; b &amp;&amp; c &gt; d) {}",
    );
  });
});
