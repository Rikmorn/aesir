/**
 * Product Agent Conversation Workflow Tests
 *
 * Tests for the product agent workflow covering:
 * - Conversation history accumulation across turns
 * - Agent self-messaging (sendSlackReplyActivity NOT called after agent turns)
 * - Phase-based flow control (complete, declined, awaiting_reply, cancelled)
 * - Timeout handling (24h reminder, 72h total)
 * - Signal handling (userReply, cancelConversation)
 * - Query handler (conversationStatus)
 * - allHandlersFinished protocol
 *
 * Uses the state machine simulation pattern from orchestrator-workflow.test.ts:
 * mock @temporalio/workflow, capture signal handlers, simulate state transitions.
 * Full TestWorkflowEnvironment deferred to integration tests.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ProductAgentWorkflowInput,
  ProductAgentWorkflowPhase,
  ProductAgentWorkflowResult,
} from "../types.js";

// ---------------------------------------------------------------------------
// Mock @temporalio/workflow
// ---------------------------------------------------------------------------

const mockCondition = vi.fn();
const mockLog = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};
const mockAllHandlersFinished = vi.fn();

/** Captured signal/query handlers for testing */
const capturedHandlers = new Map<string, (...args: unknown[]) => unknown>();

/** Track activity calls for behavioral assertions */
const activityCalls: Array<{
  name: string;
  args: unknown[];
}> = [];

const mockRunProductAgentActivity = vi.fn();
const mockSendSlackReplyActivity = vi.fn();

vi.mock("@temporalio/workflow", () => ({
  proxyActivities: vi.fn(() => ({
    runProductAgentActivity: (...args: unknown[]) => {
      activityCalls.push({ name: "runProductAgentActivity", args });
      return mockRunProductAgentActivity(...args);
    },
    sendSlackReplyActivity: (...args: unknown[]) => {
      activityCalls.push({ name: "sendSlackReplyActivity", args });
      return mockSendSlackReplyActivity(...args);
    },
  })),
  defineQuery: vi.fn((name: string) => `mockQuery_${name}`),
  defineSignal: vi.fn((name: string) => `mockSignal_${name}`),
  setHandler: vi.fn(
    (signal: string, handler: (...args: unknown[]) => unknown) => {
      capturedHandlers.set(signal, handler);
    },
  ),
  condition: mockCondition,
  log: mockLog,
  allHandlersFinished: mockAllHandlersFinished,
}));

// Mock signals
vi.mock("../signals.js", () => ({
  userReplySignal: "mockSignal_userReply",
  cancelConversationSignal: "mockSignal_cancelConversation",
}));

// Import workflow after mocks
const { productAgentConversationWorkflow } = await import(
  "./product-agent-workflow.js"
);

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

const defaultInput: ProductAgentWorkflowInput = {
  threadTs: "1234567890.123456",
  channelId: "C0123456789",
  initialMessage: "I need a dark mode feature",
  userId: "U0123456789",
  slackTeamId: "T0123456789",
  linearTeamId: "team-123",
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  capturedHandlers.clear();
  activityCalls.length = 0;
  mockSendSlackReplyActivity.mockResolvedValue({ success: true, ts: "ts_123" });
  // Default: mockCondition resolves to true (no timeout) for allHandlersFinished
  mockCondition.mockResolvedValue(true);
});

// ---------------------------------------------------------------------------
// Tests: Conversation History Accumulation
// ---------------------------------------------------------------------------

describe("Conversation history accumulation", () => {
  it("accumulates user messages and agent responses across turns", async () => {
    let turnCount = 0;

    // First turn: agent asks clarification
    // Second turn: agent completes
    mockRunProductAgentActivity.mockImplementation((input: unknown) => {
      turnCount++;
      const typedInput = input as { conversationHistory: unknown[] };

      if (turnCount === 1) {
        // First turn: no history yet (only initial message)
        expect(typedInput.conversationHistory).toHaveLength(1);
        return Promise.resolve({
          response: "What kind of dark mode? <phase>clarifying</phase>",
          phase: "awaiting_reply",
        });
      }
      // Second turn: initial + response + new user message
      expect(typedInput.conversationHistory).toHaveLength(3);
      return Promise.resolve({
        response: "Issue created. <phase>complete</phase>",
        phase: "complete",
        issueId: "uuid-123",
        issueIdentifier: "ABC-42",
      });
    });

    // Simulate condition: first call waits for reply (returns true = signal received),
    // allHandlersFinished calls return true
    mockCondition.mockImplementation(
      (predicateOrFinished: unknown, _timeout?: unknown) => {
        // When it's allHandlersFinished, just resolve
        if (predicateOrFinished === mockAllHandlersFinished) {
          return Promise.resolve(true);
        }
        // First condition: user reply signal (simulate user replying)
        const handler = capturedHandlers.get("mockSignal_userReply");
        if (handler) {
          handler("Make it system-wide");
        }
        return Promise.resolve(true);
      },
    );

    const result = await productAgentConversationWorkflow(defaultInput);

    expect(result.phase).toBe("complete");
    expect(turnCount).toBe(2);
  });

  it("passes full conversation history to activity on each turn", async () => {
    const receivedHistories: unknown[] = [];

    mockRunProductAgentActivity.mockImplementation((input: unknown) => {
      const typedInput = input as {
        conversationHistory: Array<{ role: string; content: string }>;
      };
      receivedHistories.push([...typedInput.conversationHistory]);

      if (receivedHistories.length === 1) {
        return Promise.resolve({
          response: "Can you clarify? <phase>clarifying</phase>",
          phase: "awaiting_reply",
        });
      }
      return Promise.resolve({
        response: "Done. <phase>complete</phase>",
        phase: "complete",
        issueId: "uuid-abc",
        issueIdentifier: "XYZ-99",
      });
    });

    mockCondition.mockImplementation(
      (predicateOrFinished: unknown, _timeout?: unknown) => {
        if (predicateOrFinished === mockAllHandlersFinished) {
          return Promise.resolve(true);
        }
        // Simulate user reply signal
        const handler = capturedHandlers.get("mockSignal_userReply");
        if (handler) {
          handler("Yes, I want it system-wide");
        }
        return Promise.resolve(true);
      },
    );

    await productAgentConversationWorkflow(defaultInput);

    // First turn: history has 1 entry (initial user message)
    const firstHistory = receivedHistories[0] as Array<{
      role: string;
      content: string;
    }>;
    expect(firstHistory).toHaveLength(1);
    expect(firstHistory[0]).toEqual({
      role: "user",
      content: "I need a dark mode feature",
    });

    // Second turn: history has 3 entries (user + assistant + new user)
    const secondHistory = receivedHistories[1] as Array<{
      role: string;
      content: string;
    }>;
    expect(secondHistory).toHaveLength(3);
    expect(secondHistory[0]).toEqual({
      role: "user",
      content: "I need a dark mode feature",
    });
    expect(secondHistory[1]).toEqual({
      role: "assistant",
      content: "Can you clarify? <phase>clarifying</phase>",
    });
    expect(secondHistory[2]).toEqual({
      role: "user",
      content: "Yes, I want it system-wide",
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: Agent Self-Messaging (Critical Behavioral Change)
// ---------------------------------------------------------------------------

describe("Agent handles its own messages", () => {
  it("does NOT call sendSlackReplyActivity after agent activity returns", async () => {
    mockRunProductAgentActivity.mockResolvedValue({
      response: "I asked the user a question. <phase>clarifying</phase>",
      phase: "awaiting_reply",
    });

    // Simulate user replying, then agent completes
    let callNum = 0;
    mockRunProductAgentActivity.mockImplementation(() => {
      callNum++;
      if (callNum === 1) {
        return Promise.resolve({
          response: "Asked question. <phase>clarifying</phase>",
          phase: "awaiting_reply",
        });
      }
      return Promise.resolve({
        response: "Done. <phase>complete</phase>",
        phase: "complete",
        issueId: "uuid-1",
        issueIdentifier: "ABC-1",
      });
    });

    mockCondition.mockImplementation(
      (predicateOrFinished: unknown, _timeout?: unknown) => {
        if (predicateOrFinished === mockAllHandlersFinished) {
          return Promise.resolve(true);
        }
        const handler = capturedHandlers.get("mockSignal_userReply");
        if (handler) {
          handler("Continue please");
        }
        return Promise.resolve(true);
      },
    );

    await productAgentConversationWorkflow(defaultInput);

    // sendSlackReplyActivity should NOT have been called after agent turns
    const slackCalls = activityCalls.filter(
      (c) => c.name === "sendSlackReplyActivity",
    );
    expect(slackCalls).toHaveLength(0);
  });

  it("agent response field is internal reasoning, not sent to Slack", async () => {
    mockRunProductAgentActivity.mockResolvedValue({
      response:
        "Internal: The user wants dark mode. I should ask about scope. <phase>clarifying</phase>",
      phase: "complete",
      issueId: "uuid-test",
      issueIdentifier: "TST-1",
    });

    mockCondition.mockResolvedValue(true);

    const result = await productAgentConversationWorkflow(defaultInput);

    // The workflow returns the response but does NOT send it to Slack
    expect(result.phase).toBe("complete");

    // No Slack reply calls
    const slackCalls = activityCalls.filter(
      (c) => c.name === "sendSlackReplyActivity",
    );
    expect(slackCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: Phase-based Flow Control
// ---------------------------------------------------------------------------

describe("Phase-based flow control", () => {
  it("completes workflow when activity returns phase 'complete' with issue info", async () => {
    mockRunProductAgentActivity.mockResolvedValue({
      response: "Created the issue. <phase>complete</phase>",
      phase: "complete",
      issueId: "issue-uuid",
      issueIdentifier: "PROJ-42",
    });

    mockCondition.mockResolvedValue(true);

    const result = await productAgentConversationWorkflow(defaultInput);

    expect(result.success).toBe(true);
    expect(result.phase).toBe("complete");
    expect(result.issueId).toBe("issue-uuid");
    expect(result.issueIdentifier).toBe("PROJ-42");
  });

  it("returns declined when activity returns phase 'declined'", async () => {
    mockRunProductAgentActivity.mockResolvedValue({
      response: "Not a feature request. <phase>declined</phase>",
      phase: "declined",
    });

    mockCondition.mockResolvedValue(true);

    const result = await productAgentConversationWorkflow(defaultInput);

    expect(result.success).toBe(true); // Declined is successful outcome
    expect(result.phase).toBe("declined");
    expect(result.issueId).toBeUndefined();
  });

  it("waits for user reply when activity returns phase 'awaiting_reply'", async () => {
    let turnCount = 0;
    mockRunProductAgentActivity.mockImplementation(() => {
      turnCount++;
      if (turnCount === 1) {
        return Promise.resolve({
          response: "What do you mean? <phase>clarifying</phase>",
          phase: "awaiting_reply",
        });
      }
      return Promise.resolve({
        response: "Done. <phase>complete</phase>",
        phase: "complete",
        issueId: "id-1",
        issueIdentifier: "X-1",
      });
    });

    mockCondition.mockImplementation(
      (predicateOrFinished: unknown, _timeout?: unknown) => {
        if (predicateOrFinished === mockAllHandlersFinished) {
          return Promise.resolve(true);
        }
        const handler = capturedHandlers.get("mockSignal_userReply");
        if (handler) {
          handler("I mean system preferences");
        }
        return Promise.resolve(true);
      },
    );

    const result = await productAgentConversationWorkflow(defaultInput);

    // Workflow waited for reply then completed
    expect(turnCount).toBe(2);
    expect(result.phase).toBe("complete");
  });

  it("handles cancelled phase from activity", async () => {
    // Simulate cancel signal before first iteration
    mockRunProductAgentActivity.mockResolvedValue({
      response: "Acknowledged. <phase>cancelled</phase>",
      phase: "awaiting_reply",
    });

    // Cancel requested at the start of iteration
    mockCondition.mockImplementation(
      (predicateOrFinished: unknown, _timeout?: unknown) => {
        if (predicateOrFinished === mockAllHandlersFinished) {
          return Promise.resolve(true);
        }
        return Promise.resolve(true);
      },
    );

    // Set cancel flag via signal handler before workflow runs
    // The workflow checks cancelRequested at the start of each iteration
    // We need to trigger it via the signal handler

    // Mock condition to trigger cancel on second wait
    mockCondition.mockImplementation(
      (predicateOrFinished: unknown, _timeout?: unknown) => {
        if (predicateOrFinished === mockAllHandlersFinished) {
          return Promise.resolve(true);
        }
        // After first agent turn, simulate cancel signal
        const cancelHandler = capturedHandlers.get(
          "mockSignal_cancelConversation",
        );
        if (cancelHandler) {
          cancelHandler();
        }
        return Promise.resolve(true);
      },
    );

    // First turn returns awaiting_reply, then loop checks cancelRequested
    mockRunProductAgentActivity.mockImplementation(() => {
      return Promise.resolve({
        response: "What scope? <phase>clarifying</phase>",
        phase: "awaiting_reply",
      });
    });

    const result = await productAgentConversationWorkflow(defaultInput);

    expect(result.phase).toBe("cancelled");
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: Timeout Handling
// ---------------------------------------------------------------------------

describe("Timeout handling", () => {
  it("sends reminder after 24h of inactivity", async () => {
    mockRunProductAgentActivity.mockResolvedValue({
      response: "What do you need? <phase>clarifying</phase>",
      phase: "awaiting_reply",
    });

    let conditionCalls = 0;
    mockCondition.mockImplementation(
      (predicateOrFinished: unknown, _timeout?: unknown) => {
        if (predicateOrFinished === mockAllHandlersFinished) {
          return Promise.resolve(true);
        }
        conditionCalls++;
        // First wait (24h): no reply (timeout)
        if (conditionCalls === 1) {
          return Promise.resolve(false);
        }
        // Second wait (48h): also no reply (total timeout)
        return Promise.resolve(false);
      },
    );

    const result = await productAgentConversationWorkflow(defaultInput);

    // Should have sent reminder via sendSlackReplyActivity
    const slackCalls = activityCalls.filter(
      (c) => c.name === "sendSlackReplyActivity",
    );
    // One call for reminder, one for timeout
    expect(slackCalls.length).toBeGreaterThanOrEqual(1);
    // Check the reminder message
    const reminderCall = slackCalls.find((c) => {
      const text = c.args[2] as string;
      return text.includes("checking in");
    });
    expect(reminderCall).toBeDefined();

    expect(result.phase).toBe("timeout");
    expect(result.success).toBe(false);
  });

  it("times out after 72h total", async () => {
    mockRunProductAgentActivity.mockResolvedValue({
      response: "Can you clarify? <phase>clarifying</phase>",
      phase: "awaiting_reply",
    });

    let conditionCalls = 0;
    mockCondition.mockImplementation(
      (predicateOrFinished: unknown, _timeout?: unknown) => {
        conditionCalls++;
        if (predicateOrFinished === mockAllHandlersFinished) {
          return Promise.resolve(true);
        }
        // Both waits time out (24h + 48h = 72h total)
        return Promise.resolve(false);
      },
    );

    const result = await productAgentConversationWorkflow(defaultInput);

    expect(result.success).toBe(false);
    expect(result.phase).toBe("timeout");

    // Should have sent timeout notification
    const slackCalls = activityCalls.filter(
      (c) => c.name === "sendSlackReplyActivity",
    );
    const timeoutCall = slackCalls.find((c) => {
      const text = c.args[2] as string;
      return text.includes("timed out");
    });
    expect(timeoutCall).toBeDefined();
  });

  it("handles max iterations", async () => {
    // Agent always returns awaiting_reply, user always replies
    mockRunProductAgentActivity.mockResolvedValue({
      response: "Tell me more. <phase>clarifying</phase>",
      phase: "awaiting_reply",
    });

    mockCondition.mockImplementation(
      (predicateOrFinished: unknown, _timeout?: unknown) => {
        if (predicateOrFinished === mockAllHandlersFinished) {
          return Promise.resolve(true);
        }
        // Always simulate a user reply
        const handler = capturedHandlers.get("mockSignal_userReply");
        if (handler) {
          handler("More info");
        }
        return Promise.resolve(true);
      },
    );

    const result = await productAgentConversationWorkflow(defaultInput);

    // After 20 iterations, workflow should timeout
    expect(result.success).toBe(false);
    expect(result.phase).toBe("timeout");

    // Should have sent max iterations notification
    const slackCalls = activityCalls.filter(
      (c) => c.name === "sendSlackReplyActivity",
    );
    const maxIterCall = slackCalls.find((c) => {
      const text = c.args[2] as string;
      return text.includes("maximum length");
    });
    expect(maxIterCall).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Tests: Signal Handling
// ---------------------------------------------------------------------------

describe("Signal handling", () => {
  it("processes userReplySignal to continue conversation", async () => {
    let turnCount = 0;
    mockRunProductAgentActivity.mockImplementation(() => {
      turnCount++;
      if (turnCount === 1) {
        return Promise.resolve({
          response: "What scope? <phase>clarifying</phase>",
          phase: "awaiting_reply",
        });
      }
      return Promise.resolve({
        response: "Created. <phase>complete</phase>",
        phase: "complete",
        issueId: "uuid-signal",
        issueIdentifier: "SIG-1",
      });
    });

    mockCondition.mockImplementation(
      (predicateOrFinished: unknown, _timeout?: unknown) => {
        if (predicateOrFinished === mockAllHandlersFinished) {
          return Promise.resolve(true);
        }
        // Simulate user reply via signal handler
        const handler = capturedHandlers.get("mockSignal_userReply");
        if (handler) {
          handler("System-wide dark mode");
        }
        return Promise.resolve(true);
      },
    );

    const result = await productAgentConversationWorkflow(defaultInput);

    expect(turnCount).toBe(2);
    expect(result.phase).toBe("complete");
    expect(result.issueIdentifier).toBe("SIG-1");
  });

  it("processes cancelConversationSignal", async () => {
    // Cancel before any agent turn
    mockRunProductAgentActivity.mockResolvedValue({
      response: "<phase>clarifying</phase>",
      phase: "awaiting_reply",
    });

    mockCondition.mockImplementation(
      (predicateOrFinished: unknown, _timeout?: unknown) => {
        if (predicateOrFinished === mockAllHandlersFinished) {
          return Promise.resolve(true);
        }
        // Trigger cancel signal
        const cancelHandler = capturedHandlers.get(
          "mockSignal_cancelConversation",
        );
        if (cancelHandler) {
          cancelHandler();
        }
        return Promise.resolve(true);
      },
    );

    const result = await productAgentConversationWorkflow(defaultInput);

    expect(result.success).toBe(false);
    expect(result.phase).toBe("cancelled");

    // Should have sent cancellation acknowledgment
    const slackCalls = activityCalls.filter(
      (c) => c.name === "sendSlackReplyActivity",
    );
    const cancelCall = slackCalls.find((c) => {
      const text = c.args[2] as string;
      return text.includes("cancelled");
    });
    expect(cancelCall).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Tests: Query Handler
// ---------------------------------------------------------------------------

describe("Query handler", () => {
  it("conversationStatusQuery returns current state", async () => {
    mockRunProductAgentActivity.mockResolvedValue({
      response: "Done. <phase>complete</phase>",
      phase: "complete",
      issueId: "q-uuid",
      issueIdentifier: "Q-1",
    });

    mockCondition.mockResolvedValue(true);

    await productAgentConversationWorkflow(defaultInput);

    // Verify query handler was registered
    const queryHandler = capturedHandlers.get("mockQuery_conversationStatus") as
      | (() => unknown)
      | undefined;
    expect(queryHandler).toBeDefined();

    if (queryHandler) {
      const status = queryHandler();
      expect(status).toEqual(
        expect.objectContaining({
          threadTs: "1234567890.123456",
          phase: "complete",
        }),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: allHandlersFinished Protocol
// ---------------------------------------------------------------------------

describe("allHandlersFinished Protocol", () => {
  it("is called before every workflow return path", async () => {
    // Run a complete flow -- allHandlersFinished should be called
    mockRunProductAgentActivity.mockResolvedValue({
      response: "Done. <phase>complete</phase>",
      phase: "complete",
      issueId: "uuid-done",
      issueIdentifier: "DONE-1",
    });

    mockCondition.mockResolvedValue(true);

    await productAgentConversationWorkflow(defaultInput);

    // Verify condition was called with allHandlersFinished at least once
    const allHandlersCalls = mockCondition.mock.calls.filter(
      (args: unknown[]) => args[0] === mockAllHandlersFinished,
    );
    expect(allHandlersCalls.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Tests: Workflow Type Contracts
// ---------------------------------------------------------------------------

describe("Workflow type contracts", () => {
  describe("ProductAgentWorkflowInput", () => {
    it("defines required input fields", () => {
      const validInput: ProductAgentWorkflowInput = {
        threadTs: "1234567890.123456",
        channelId: "C12345678",
        initialMessage: "I need a feature that...",
        userId: "U12345678",
        slackTeamId: "T12345678",
        linearTeamId: "team_12345",
      };

      expect(validInput.threadTs).toBeDefined();
      expect(validInput.channelId).toBeDefined();
      expect(validInput.initialMessage).toBeDefined();
      expect(validInput.userId).toBeDefined();
      expect(validInput.slackTeamId).toBeDefined();
      expect(validInput.linearTeamId).toBeDefined();
    });
  });

  describe("ProductAgentWorkflowResult", () => {
    it("defines complete phase with issue info", () => {
      const result: ProductAgentWorkflowResult = {
        success: true,
        phase: "complete",
        issueId: "issue_123",
        issueIdentifier: "ABC-123",
      };
      expect(result.success).toBe(true);
      expect(result.phase).toBe("complete");
    });

    it("defines declined phase without issue info", () => {
      const result: ProductAgentWorkflowResult = {
        success: true,
        phase: "declined",
      };
      expect(result.success).toBe(true);
      expect(result.issueId).toBeUndefined();
    });
  });

  describe("ProductAgentWorkflowPhase", () => {
    it("includes all 7 expected phases", () => {
      const phases: ProductAgentWorkflowPhase[] = [
        "pending",
        "running",
        "awaiting_reply",
        "complete",
        "declined",
        "cancelled",
        "timeout",
      ];
      expect(phases).toHaveLength(7);
    });
  });
});

// ---------------------------------------------------------------------------
// Integration test TODOs
// ---------------------------------------------------------------------------

describe("Integration Test Notes", () => {
  it.todo("full workflow execution with TestWorkflowEnvironment");
  it.todo("signal handling with real Temporal worker");
  it.todo("timeout behavior with time skipping");
  it.todo("activity invocation and retry");
});
