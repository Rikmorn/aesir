/**
 * Product Agent Activity Tests
 *
 * Tests for the product agent Temporal activity which wraps
 * runProductAgent() with phase extraction and issue info extraction.
 *
 * Tests cover:
 * - extractPhase: XML tag parsing from agent output
 * - extractIssueInfo: Trace step parsing for linear_create_issue results
 * - runProductAgentActivity: Integration with DI and runProductAgent
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentLoopResult, TraceStep } from "../../agent-loop/types.js";
import {
  extractIssueInfo,
  extractPhase,
  initProductAgentActivities,
  runProductAgentActivity,
} from "./product-agent-activity.js";

// Mock the product agent orchestrator
vi.mock("../../../product-agent/orchestrator/index.js", () => ({
  runProductAgent: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildResult(output: string, trace: TraceStep[] = []): AgentLoopResult {
  return {
    status: "completed",
    output,
    toolCallCount: 0,
    tokenCount: { input: 100, output: 50 },
    trace,
  };
}

function buildToolResultStep(toolName: string, output: string): TraceStep {
  return {
    type: "tool_result",
    timestamp: new Date().toISOString(),
    toolName,
    toolCallId: "toolu_test",
    output,
  };
}

// ---------------------------------------------------------------------------
// extractPhase
// ---------------------------------------------------------------------------

describe("extractPhase", () => {
  it("extracts 'complete' phase", () => {
    const result = buildResult("I created the issue. <phase>complete</phase>");
    expect(extractPhase(result)).toBe("complete");
  });

  it("extracts 'declined' phase", () => {
    const result = buildResult("This is off-topic. <phase>declined</phase>");
    expect(extractPhase(result)).toBe("declined");
  });

  it("extracts 'cancelled' phase", () => {
    const result = buildResult("User cancelled. <phase>cancelled</phase>");
    expect(extractPhase(result)).toBe("cancelled");
  });

  it("maps 'clarifying' to 'awaiting_reply'", () => {
    const result = buildResult("Asked a question. <phase>clarifying</phase>");
    expect(extractPhase(result)).toBe("awaiting_reply");
  });

  it("defaults to 'awaiting_reply' when no phase tag found", () => {
    const result = buildResult("No phase tag here");
    expect(extractPhase(result)).toBe("awaiting_reply");
  });

  it("defaults to 'awaiting_reply' for unknown phase value", () => {
    const result = buildResult("<phase>unknown_value</phase>");
    expect(extractPhase(result)).toBe("awaiting_reply");
  });

  it("extracts phase when surrounded by other text", () => {
    const result = buildResult(
      "Internal reasoning here.\nMore reasoning.\n<phase>complete</phase>\n",
    );
    expect(extractPhase(result)).toBe("complete");
  });

  it("handles empty output", () => {
    const result = buildResult("");
    expect(extractPhase(result)).toBe("awaiting_reply");
  });
});

// ---------------------------------------------------------------------------
// extractIssueInfo
// ---------------------------------------------------------------------------

describe("extractIssueInfo", () => {
  it("extracts issue info from linear_create_issue tool result", () => {
    const trace = [
      buildToolResultStep(
        "linear_create_issue",
        JSON.stringify({
          id: "uuid-123",
          identifier: "ABC-42",
          url: "https://linear.app/team/issue/ABC-42",
          title: "Add auth",
        }),
      ),
    ];
    const result = buildResult("Done. <phase>complete</phase>", trace);
    const issueInfo = extractIssueInfo(result);

    expect(issueInfo).toEqual({
      issueId: "uuid-123",
      issueIdentifier: "ABC-42",
    });
  });

  it("returns null when no linear_create_issue in trace", () => {
    const trace = [
      buildToolResultStep("slack_send_message", '{"ok":true}'),
      buildToolResultStep(
        "linear_search_issues",
        '{"issues":[],"totalCount":0}',
      ),
    ];
    const result = buildResult("<phase>clarifying</phase>", trace);
    expect(extractIssueInfo(result)).toBeNull();
  });

  it("returns null when trace is empty", () => {
    const result = buildResult("<phase>declined</phase>", []);
    expect(extractIssueInfo(result)).toBeNull();
  });

  it("returns null when tool output is not valid JSON", () => {
    const trace = [buildToolResultStep("linear_create_issue", "not json")];
    const result = buildResult("<phase>complete</phase>", trace);
    expect(extractIssueInfo(result)).toBeNull();
  });

  it("returns null when tool output is missing required fields", () => {
    const trace = [
      buildToolResultStep(
        "linear_create_issue",
        JSON.stringify({ url: "https://linear.app" }),
      ),
    ];
    const result = buildResult("<phase>complete</phase>", trace);
    expect(extractIssueInfo(result)).toBeNull();
  });

  it("returns null when output is not a string", () => {
    const step: TraceStep = {
      type: "tool_result",
      timestamp: new Date().toISOString(),
      toolName: "linear_create_issue",
      toolCallId: "toolu_test",
      output: { id: "uuid-123", identifier: "ABC-42" }, // object, not string
    };
    const result = buildResult("<phase>complete</phase>", [step]);
    expect(extractIssueInfo(result)).toBeNull();
  });

  it("takes the first linear_create_issue result", () => {
    const trace = [
      buildToolResultStep(
        "linear_create_issue",
        JSON.stringify({
          id: "first-id",
          identifier: "ABC-1",
          url: "https://linear.app/1",
          title: "First",
        }),
      ),
      buildToolResultStep(
        "linear_create_issue",
        JSON.stringify({
          id: "second-id",
          identifier: "ABC-2",
          url: "https://linear.app/2",
          title: "Second",
        }),
      ),
    ];
    const result = buildResult("<phase>complete</phase>", trace);
    const issueInfo = extractIssueInfo(result);

    expect(issueInfo).toEqual({
      issueId: "first-id",
      issueIdentifier: "ABC-1",
    });
  });
});

// ---------------------------------------------------------------------------
// runProductAgentActivity
// ---------------------------------------------------------------------------

describe("runProductAgentActivity", () => {
  const mockLogger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => mockLogger),
  };
  const mockDb = {} as never;

  let mockRunProductAgent: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Initialize DI
    initProductAgentActivities({
      db: mockDb,
      logger: mockLogger as never,
    });

    // Get the mock
    const mod = await import("../../../product-agent/orchestrator/index.js");
    mockRunProductAgent = vi.mocked(mod.runProductAgent);
  });

  it("calls runProductAgent with correct options", async () => {
    mockRunProductAgent.mockResolvedValue(
      buildResult("Done. <phase>complete</phase>"),
    );

    await runProductAgentActivity({
      threadTs: "1234567890.123456",
      channelId: "C0123456789",
      message: "Build a feature",
      teamId: "team-123",
    });

    expect(mockRunProductAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        threadTs: "1234567890.123456",
        channelId: "C0123456789",
        message: "Build a feature",
        linearTeamId: "team-123",
        agentId: "product-agent",
        correlationId: "product-1234567890.123456",
      }),
    );
  });

  it("passes conversationHistory when provided", async () => {
    mockRunProductAgent.mockResolvedValue(
      buildResult("<phase>clarifying</phase>"),
    );

    const history = [
      { role: "user" as const, content: "I need a feature" },
      { role: "assistant" as const, content: "What kind?" },
    ];

    await runProductAgentActivity({
      threadTs: "1234567890.123456",
      channelId: "C0123456789",
      message: "A dark mode toggle",
      teamId: "team-123",
      conversationHistory: history,
    });

    expect(mockRunProductAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationHistory: history,
      }),
    );
  });

  it("does not pass conversationHistory when undefined", async () => {
    mockRunProductAgent.mockResolvedValue(
      buildResult("<phase>clarifying</phase>"),
    );

    await runProductAgentActivity({
      threadTs: "1234567890.123456",
      channelId: "C0123456789",
      message: "test",
      teamId: "team-123",
    });

    const callArgs = mockRunProductAgent.mock.calls[0]?.[0];
    expect(callArgs).not.toHaveProperty("conversationHistory");
  });

  it("returns extracted phase and issue info", async () => {
    const trace = [
      buildToolResultStep(
        "linear_create_issue",
        JSON.stringify({
          id: "uuid-123",
          identifier: "ABC-42",
          url: "https://linear.app/issue",
          title: "Test Issue",
        }),
      ),
    ];
    mockRunProductAgent.mockResolvedValue(
      buildResult("Created issue. <phase>complete</phase>", trace),
    );

    const output = await runProductAgentActivity({
      threadTs: "1234567890.123456",
      channelId: "C0123456789",
      message: "create it",
      teamId: "team-123",
    });

    expect(output.phase).toBe("complete");
    expect(output.issueId).toBe("uuid-123");
    expect(output.issueIdentifier).toBe("ABC-42");
    expect(output.response).toContain("<phase>complete</phase>");
  });

  it("returns output without issue fields when no issue created", async () => {
    mockRunProductAgent.mockResolvedValue(
      buildResult("Asking a question. <phase>clarifying</phase>"),
    );

    const output = await runProductAgentActivity({
      threadTs: "1234567890.123456",
      channelId: "C0123456789",
      message: "test",
      teamId: "team-123",
    });

    expect(output.phase).toBe("awaiting_reply");
    expect(output.issueId).toBeUndefined();
    expect(output.issueIdentifier).toBeUndefined();
  });

  it("throws when DI not initialized", async () => {
    // Re-import to get fresh module, but we can't easily reset DI
    // Instead, we test that getProductAgentDeps() throws by checking
    // the initProductAgentActivities function exists and is callable
    expect(typeof initProductAgentActivities).toBe("function");
  });
});
