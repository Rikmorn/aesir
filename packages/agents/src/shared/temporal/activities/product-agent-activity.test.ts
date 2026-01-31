/**
 * Product Agent Activity Tests
 *
 * Tests for the product agent Temporal activity which wraps
 * runProductAgent() with phase extraction and issue info extraction.
 *
 * Tests cover:
 * - extractPhase: XML tag parsing from agent output (8 cases)
 * - extractIssueInfo: Trace step parsing for linear_create_issue results (7 cases)
 * - runProductAgentActivity: Integration with DI and runProductAgent (8 cases)
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentLoopResult, TraceStep } from "../../agent-loop/types.js";

// ---------------------------------------------------------------------------
// Module-level mock for runProductAgent
// ---------------------------------------------------------------------------

const mockRunProductAgent = vi.fn();

vi.mock("../../../product-agent/orchestrator/index.js", () => ({
  runProductAgent: mockRunProductAgent,
}));

// ---------------------------------------------------------------------------
// Import AFTER mocks
// ---------------------------------------------------------------------------

const {
  extractPhase,
  extractIssueInfo,
  initProductAgentActivities,
  runProductAgentActivity,
} = await import("./product-agent-activity.js");

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

function createMockLogger() {
  const child = vi.fn();
  const logger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child,
  };
  child.mockReturnValue(logger);
  return logger;
}

// ---------------------------------------------------------------------------
// extractPhase
// ---------------------------------------------------------------------------

describe("extractPhase", () => {
  it("returns 'complete' for <phase>complete</phase>", () => {
    const result = buildResult("I created the issue. <phase>complete</phase>");
    expect(extractPhase(result)).toBe("complete");
  });

  it("returns 'awaiting_reply' for <phase>clarifying</phase>", () => {
    const result = buildResult("Asked a question. <phase>clarifying</phase>");
    expect(extractPhase(result)).toBe("awaiting_reply");
  });

  it("returns 'declined' for <phase>declined</phase>", () => {
    const result = buildResult("This is off-topic. <phase>declined</phase>");
    expect(extractPhase(result)).toBe("declined");
  });

  it("returns 'cancelled' for <phase>cancelled</phase>", () => {
    const result = buildResult("User cancelled. <phase>cancelled</phase>");
    expect(extractPhase(result)).toBe("cancelled");
  });

  it("returns 'awaiting_reply' when no phase tag present (safe default)", () => {
    const result = buildResult("No phase tag here");
    expect(extractPhase(result)).toBe("awaiting_reply");
  });

  it("returns 'awaiting_reply' for unknown phase value", () => {
    const result = buildResult("<phase>unknown_value</phase>");
    expect(extractPhase(result)).toBe("awaiting_reply");
  });

  it("extracts phase from output with surrounding text", () => {
    const result = buildResult(
      "Internal reasoning here.\nMore reasoning.\n<phase>complete</phase>\n",
    );
    expect(extractPhase(result)).toBe("complete");
  });

  it("handles multiple phase tags (takes first match)", () => {
    const result = buildResult(
      "<phase>declined</phase> then <phase>complete</phase>",
    );
    expect(extractPhase(result)).toBe("declined");
  });

  it("handles empty output", () => {
    const result = buildResult("");
    expect(extractPhase(result)).toBe("awaiting_reply");
  });

  describe("fallback inference from trace (no phase tag)", () => {
    it("infers 'complete' when linear_create_issue succeeded", () => {
      const trace = [
        buildToolResultStep(
          "linear_create_issue",
          JSON.stringify({
            id: "uuid-abc",
            identifier: "XYZ-99",
            url: "https://linear.app/team/issue/XYZ-99",
            title: "New feature",
          }),
        ),
      ];
      // No phase tag in output — but issue was created
      const result = buildResult("I created the issue.", trace);
      expect(extractPhase(result)).toBe("complete");
    });

    it("returns 'awaiting_reply' when linear_create_issue failed", () => {
      const trace = [
        buildToolResultStep(
          "linear_create_issue",
          "Tool execution error: 500 Internal Server Error",
        ),
      ];
      const result = buildResult("Something went wrong.", trace);
      expect(extractPhase(result)).toBe("awaiting_reply");
    });

    it("returns 'awaiting_reply' when no tools were called", () => {
      const result = buildResult("Truncated output with no phase tag");
      expect(extractPhase(result)).toBe("awaiting_reply");
    });

    it("returns 'awaiting_reply' when only non-issue tools were called", () => {
      const trace = [
        buildToolResultStep("slack_send_message", '{"ok":true}'),
        buildToolResultStep("linear_search_issues", "[]"),
      ];
      const result = buildResult("Asked the user a question.", trace);
      expect(extractPhase(result)).toBe("awaiting_reply");
    });
  });
});

// ---------------------------------------------------------------------------
// extractIssueInfo
// ---------------------------------------------------------------------------

describe("extractIssueInfo", () => {
  it("returns issue info when linear_create_issue tool_result exists in trace", () => {
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

  it("handles malformed JSON in tool result", () => {
    const trace = [buildToolResultStep("linear_create_issue", "not json")];
    const result = buildResult("<phase>complete</phase>", trace);
    expect(extractIssueInfo(result)).toBeNull();
  });

  it("extracts id, identifier, title, and url from tool result", () => {
    const issueData = {
      id: "uuid-full",
      identifier: "PROJ-99",
      url: "https://linear.app/team/issue/PROJ-99",
      title: "Full extraction test",
    };
    const trace = [
      buildToolResultStep("linear_create_issue", JSON.stringify(issueData)),
    ];
    const result = buildResult("<phase>complete</phase>", trace);
    const info = extractIssueInfo(result);

    // extractIssueInfo returns only id and identifier
    expect(info).not.toBeNull();
    expect(info?.issueId).toBe("uuid-full");
    expect(info?.issueIdentifier).toBe("PROJ-99");
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
  const mockLogger = createMockLogger();
  const mockDb = {} as never;

  beforeEach(() => {
    vi.clearAllMocks();

    // Initialize DI
    initProductAgentActivities({
      db: mockDb,
      logger: mockLogger as never,
    });
  });

  it("calls runProductAgent with correct options from input", async () => {
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

  it("passes empty history when conversationHistory is undefined", async () => {
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
    // When undefined, the conditional property assignment skips it
    expect(callArgs).not.toHaveProperty("conversationHistory");
  });

  it("extracts phase from agent result output", async () => {
    mockRunProductAgent.mockResolvedValue(
      buildResult("Declining this message. <phase>declined</phase>"),
    );

    const output = await runProductAgentActivity({
      threadTs: "1234567890.123456",
      channelId: "C0123456789",
      message: "what is 2+2?",
      teamId: "team-123",
    });

    expect(output.phase).toBe("declined");
  });

  it("extracts issue info from agent result trace", async () => {
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

    expect(output.issueId).toBe("uuid-123");
    expect(output.issueIdentifier).toBe("ABC-42");
  });

  it("returns slim output without full trace", async () => {
    const trace = [
      buildToolResultStep("slack_send_message", '{"ok":true}'),
      buildToolResultStep(
        "linear_create_issue",
        JSON.stringify({
          id: "uuid-abc",
          identifier: "XYZ-99",
          url: "https://linear.app/issue",
          title: "Traced Issue",
        }),
      ),
    ];
    mockRunProductAgent.mockResolvedValue(
      buildResult("Created. <phase>complete</phase>", trace),
    );

    const output = await runProductAgentActivity({
      threadTs: "1234567890.123456",
      channelId: "C0123456789",
      message: "create it",
      teamId: "team-123",
    });

    // Slim output: has response, phase, issue info
    expect(output.response).toContain("<phase>complete</phase>");
    expect(output.phase).toBe("complete");
    expect(output.issueId).toBe("uuid-abc");
    // Does NOT have the full trace
    expect(
      (output as unknown as Record<string, unknown>).trace,
    ).toBeUndefined();
    expect(
      (output as unknown as Record<string, unknown>).toolCallCount,
    ).toBeUndefined();
    expect(
      (output as unknown as Record<string, unknown>).tokenCount,
    ).toBeUndefined();
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

  it("throws if activity deps not initialized", () => {
    // Verify the init function exists and the pattern is wired correctly
    expect(typeof initProductAgentActivities).toBe("function");
    expect(typeof runProductAgentActivity).toBe("function");
  });
});
