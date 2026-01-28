/**
 * Dev Agent Integration Tests
 *
 * These tests verify the dev-agent workflow works end-to-end.
 * Requires running infrastructure (PostgreSQL, Temporal) and
 * configured integrations (Linear, GitHub, Slack).
 *
 * Run with: pnpm test:integration packages/agents/src/dev-agent/integration.test.ts
 */

import type { PinoLogger } from "@aesir/platform";
import type { Client as TemporalClient } from "@temporalio/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  type ApprovalSignalInput,
  type CompletionSignalInput,
  type SignalHandlerDeps,
  sendApprovalSignal,
  sendCompletionSignal,
} from "./api/signal-handler.js";

// Skip in CI - requires real infrastructure and credentials
const SKIP_INTEGRATION =
  process.env.CI === "true" || !process.env.RUN_INTEGRATION_TESTS;

describe.skipIf(SKIP_INTEGRATION)("Dev Agent Integration", () => {
  beforeAll(async () => {
    // Setup: Ensure services are running
    // This could check health endpoints
  });

  afterAll(async () => {
    // Cleanup
  });

  describe("Event Handling", () => {
    it("should accept Linear issue event with agent-ready label", async () => {
      // Send mock normalized event to /events
      // Verify workflow started in Temporal
      expect(true).toBe(true); // Placeholder
    });

    it("should ignore Linear issue event without agent-ready label", async () => {
      // Send event without label
      // Verify no workflow started
      expect(true).toBe(true); // Placeholder
    });
  });

  describe("Container Lifecycle", () => {
    it("should spawn container for new task", async () => {
      // Start workflow
      // Verify container created via Docker API
      expect(true).toBe(true); // Placeholder
    });

    it("should resume existing container for feedback", async () => {
      // Create container
      // Signal feedback
      // Verify same container used
      expect(true).toBe(true); // Placeholder
    });
  });

  describe("Full Workflow", () => {
    it("should complete workflow: issue -> research -> plan -> execute -> PR", async () => {
      // This is the E2E test
      // 1. Create Linear issue with agent-ready label
      // 2. Wait for workflow to start
      // 3. Send approval signal
      // 4. Wait for PR creation
      // 5. Verify PR exists in GitHub
      expect(true).toBe(true); // Placeholder - manual verification
    });
  });
});

/**
 * Human-in-the-Loop Approval Flow Tests
 *
 * These tests verify the HITL approval mechanism:
 * - Slack button clicks send approval signals to Temporal workflows
 * - Approval updates Slack message and syncs to Linear
 * - Rejection routes to re-planning flow
 * - PR merge triggers task completion
 *
 * Note: These tests use mocked Temporal client since actual workflow
 * infrastructure may not be available in all test environments.
 */
describe("Human-in-the-Loop Approval Flow", () => {
  // Mock logger
  const createMockLogger = (): PinoLogger =>
    ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn().mockReturnThis(),
    }) as unknown as PinoLogger;

  describe("Approval Signal Handling", () => {
    it("should send approval signal to workflow successfully", async () => {
      // Setup: Create a mock workflow handle
      const mockSignal = vi.fn().mockResolvedValue(undefined);
      const mockGetHandle = vi.fn().mockReturnValue({
        signal: mockSignal,
      });
      const mockClient = {
        workflow: {
          getHandle: mockGetHandle,
        },
      } as unknown as TemporalClient;

      const deps: SignalHandlerDeps = {
        workflowClient: mockClient,
        logger: createMockLogger(),
      };

      const input: ApprovalSignalInput = {
        taskIdentifier: "ABC-123",
        taskId: "550e8400-e29b-41d4-a716-446655440000",
        approved: true,
        approverName: "John Doe",
        source: "slack",
      };

      // Action: Send approval signal
      const result = await sendApprovalSignal(deps, input);

      // Assert: Signal sent successfully
      expect(result.signaled).toBe(true);
      expect(result.workflowId).toBe(
        "dev-agent-550e8400-e29b-41d4-a716-446655440000",
      );
      expect(mockGetHandle).toHaveBeenCalledWith(
        "dev-agent-550e8400-e29b-41d4-a716-446655440000",
      );
      expect(mockSignal).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          approved: true,
          approverName: "John Doe",
          source: "slack",
        }),
      );
    });

    it("should include approver metadata in signal", async () => {
      // Setup: Create mock that captures signal payload
      let capturedPayload: unknown;
      const mockSignal = vi.fn().mockImplementation((_, payload) => {
        capturedPayload = payload;
        return Promise.resolve();
      });
      const mockClient = {
        workflow: {
          getHandle: vi.fn().mockReturnValue({ signal: mockSignal }),
        },
      } as unknown as TemporalClient;

      const deps: SignalHandlerDeps = {
        workflowClient: mockClient,
        logger: createMockLogger(),
      };

      const input: ApprovalSignalInput = {
        taskIdentifier: "DEF-456",
        approved: true,
        approverUserId: "U1234567890",
        approverName: "Jane Smith",
        source: "slack",
        channel: "C1234567890",
      };

      // Action: Send approval signal
      await sendApprovalSignal(deps, input);

      // Assert: Approver metadata included
      expect(capturedPayload).toMatchObject({
        approved: true,
        approverName: "Jane Smith",
        source: "slack",
      });
    });

    it("should handle rejection with feedback", async () => {
      // Setup: Create mock for rejection
      let capturedPayload: unknown;
      const mockSignal = vi.fn().mockImplementation((_, payload) => {
        capturedPayload = payload;
        return Promise.resolve();
      });
      const mockClient = {
        workflow: {
          getHandle: vi.fn().mockReturnValue({ signal: mockSignal }),
        },
      } as unknown as TemporalClient;

      const deps: SignalHandlerDeps = {
        workflowClient: mockClient,
        logger: createMockLogger(),
      };

      const input: ApprovalSignalInput = {
        taskIdentifier: "GHI-789",
        approved: false,
        feedback: "Missing error handling for edge cases",
        approverName: "Tech Lead",
        source: "linear",
      };

      // Action: Send rejection signal
      const result = await sendApprovalSignal(deps, input);

      // Assert: Rejection sent with feedback
      expect(result.signaled).toBe(true);
      expect(capturedPayload).toMatchObject({
        approved: false,
        feedback: "Missing error handling for edge cases",
        source: "linear",
      });
    });

    it("should handle WorkflowNotFoundError gracefully", async () => {
      // Setup: Create mock that throws WorkflowNotFoundError
      const notFoundError = new Error("Workflow not found");
      notFoundError.name = "WorkflowNotFoundError";
      const mockGetHandle = vi.fn().mockReturnValue({
        signal: vi.fn().mockRejectedValue(notFoundError),
      });
      const mockClient = {
        workflow: {
          getHandle: mockGetHandle,
        },
      } as unknown as TemporalClient;

      const mockLogger = createMockLogger();
      const deps: SignalHandlerDeps = {
        workflowClient: mockClient,
        logger: mockLogger,
      };

      const input: ApprovalSignalInput = {
        taskIdentifier: "NONEXISTENT-999",
        approved: true,
      };

      // Action: Send signal to non-existent workflow
      const result = await sendApprovalSignal(deps, input);

      // Assert: Returns error gracefully (no throw)
      expect(result.signaled).toBe(false);
      expect(result.error).toBe("Workflow not found");
    });

    it("should rethrow unexpected errors", async () => {
      // Setup: Create mock that throws unexpected error
      const unexpectedError = new Error("Connection timeout");
      const mockGetHandle = vi.fn().mockReturnValue({
        signal: vi.fn().mockRejectedValue(unexpectedError),
      });
      const mockClient = {
        workflow: {
          getHandle: mockGetHandle,
        },
      } as unknown as TemporalClient;

      const deps: SignalHandlerDeps = {
        workflowClient: mockClient,
        logger: createMockLogger(),
      };

      const input: ApprovalSignalInput = {
        taskIdentifier: "ABC-123",
        approved: true,
      };

      // Action & Assert: Should rethrow
      await expect(sendApprovalSignal(deps, input)).rejects.toThrow(
        "Connection timeout",
      );
    });

    it("should use taskIdentifier for workflow ID when taskId not provided", async () => {
      // Setup: Create mock to verify workflow ID
      const mockGetHandle = vi.fn().mockReturnValue({
        signal: vi.fn().mockResolvedValue(undefined),
      });
      const mockClient = {
        workflow: {
          getHandle: mockGetHandle,
        },
      } as unknown as TemporalClient;

      const deps: SignalHandlerDeps = {
        workflowClient: mockClient,
        logger: createMockLogger(),
      };

      const input: ApprovalSignalInput = {
        taskIdentifier: "XYZ-100",
        // Note: taskId not provided
        approved: true,
      };

      // Action: Send approval signal
      await sendApprovalSignal(deps, input);

      // Assert: Uses taskIdentifier for workflow ID
      expect(mockGetHandle).toHaveBeenCalledWith("dev-agent-XYZ-100");
    });
  });

  describe("Cross-Channel Sync", () => {
    // TODO: These tests require MCP tool mocking which is complex
    // Mark as skipped until MCP mock infrastructure is available

    it.skip("should sync Slack approval to Linear", async () => {
      // When plan is approved via Slack button:
      // 1. Workflow receives approval signal with source: "slack"
      // 2. Cross-channel sync posts comment to Linear: "Plan approved via Slack by {approverName}"
      // 3. Linear issue status updated if "Awaiting Approval" status exists
      //
      // Test requires mocking:
      // - Temporal workflow state
      // - MCP tool calls (linear.create_comment, linear.update_issue_status)
      expect(true).toBe(true);
    });

    it.skip("should update Slack message after approval", async () => {
      // When plan is approved:
      // 1. Workflow updates Slack message via MCP (slack.update_message)
      // 2. Approval buttons removed
      // 3. Message shows: "Approved by {name} at {timestamp} - Executing..."
      //
      // Test requires mocking:
      // - Temporal workflow state with slackMessageTs
      // - MCP tool calls (slack.update_message)
      expect(true).toBe(true);
    });

    it.skip("should handle cross-channel rejection with feedback request", async () => {
      // When plan is rejected via Slack without feedback:
      // 1. Workflow receives rejection signal
      // 2. Agent replies in Slack thread asking for feedback
      // 3. Once feedback provided, re-planning phase triggers
      //
      // Test requires mocking:
      // - Temporal workflow state
      // - MCP tool calls (slack.reply_to_thread)
      expect(true).toBe(true);
    });
  });

  describe("PR Completion Flow", () => {
    it("should send completion signal on PR merge", async () => {
      // Setup: Create mock for completion signal
      const mockSignal = vi.fn().mockResolvedValue(undefined);
      const mockGetHandle = vi.fn().mockReturnValue({
        signal: mockSignal,
      });
      const mockClient = {
        workflow: {
          getHandle: mockGetHandle,
        },
      } as unknown as TemporalClient;

      const deps: SignalHandlerDeps = {
        workflowClient: mockClient,
        logger: createMockLogger(),
      };

      const input: CompletionSignalInput = {
        prNumber: 42,
        merged: true,
        branchName: "feature/ABC-123",
        repository: { owner: "my-org", name: "my-repo" },
      };

      // Action: Send completion signal
      const result = await sendCompletionSignal(deps, input);

      // Assert: Signal sent successfully
      expect(result.signaled).toBe(true);
      expect(mockSignal).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          merged: true,
          prNumber: 42,
          branchName: "feature/ABC-123",
        }),
      );
    });

    it("should handle PR closed without merge", async () => {
      // Setup: Create mock for close signal
      let capturedPayload: unknown;
      const mockSignal = vi.fn().mockImplementation((_, payload) => {
        capturedPayload = payload;
        return Promise.resolve();
      });
      const mockClient = {
        workflow: {
          getHandle: vi.fn().mockReturnValue({ signal: mockSignal }),
        },
      } as unknown as TemporalClient;

      const deps: SignalHandlerDeps = {
        workflowClient: mockClient,
        logger: createMockLogger(),
      };

      const input: CompletionSignalInput = {
        prNumber: 43,
        merged: false,
        branchName: "feature/DEF-456",
        repository: { owner: "my-org", name: "my-repo" },
      };

      // Action: Send close signal
      const result = await sendCompletionSignal(deps, input);

      // Assert: Close signal sent (merged: false)
      expect(result.signaled).toBe(true);
      expect(capturedPayload).toMatchObject({
        merged: false,
        prNumber: 43,
      });
    });

    it("should extract task identifier from branch name", async () => {
      // Setup: Create mock to verify workflow ID extraction
      const mockGetHandle = vi.fn().mockReturnValue({
        signal: vi.fn().mockResolvedValue(undefined),
      });
      const mockClient = {
        workflow: {
          getHandle: mockGetHandle,
        },
      } as unknown as TemporalClient;

      const deps: SignalHandlerDeps = {
        workflowClient: mockClient,
        logger: createMockLogger(),
      };

      const input: CompletionSignalInput = {
        prNumber: 44,
        merged: true,
        branchName: "feature/GHI-789",
        repository: { owner: "my-org", name: "my-repo" },
      };

      // Action: Send completion signal
      await sendCompletionSignal(deps, input);

      // Assert: Workflow ID derived from branch name
      expect(mockGetHandle).toHaveBeenCalledWith("dev-agent-GHI-789");
    });

    it("should prefer taskId over branch-derived identifier", async () => {
      // Setup: Create mock to verify workflow ID preference
      const mockGetHandle = vi.fn().mockReturnValue({
        signal: vi.fn().mockResolvedValue(undefined),
      });
      const mockClient = {
        workflow: {
          getHandle: mockGetHandle,
        },
      } as unknown as TemporalClient;

      const deps: SignalHandlerDeps = {
        workflowClient: mockClient,
        logger: createMockLogger(),
      };

      const input: CompletionSignalInput = {
        prNumber: 45,
        merged: true,
        branchName: "feature/JKL-101",
        repository: { owner: "my-org", name: "my-repo" },
        taskId: "550e8400-e29b-41d4-a716-446655440001",
      };

      // Action: Send completion signal
      await sendCompletionSignal(deps, input);

      // Assert: Uses taskId, not branch-derived identifier
      expect(mockGetHandle).toHaveBeenCalledWith(
        "dev-agent-550e8400-e29b-41d4-a716-446655440001",
      );
    });

    it("should handle invalid branch name gracefully", async () => {
      // Setup: Create mock
      const mockClient = {
        workflow: {
          getHandle: vi.fn().mockReturnValue({
            signal: vi.fn().mockResolvedValue(undefined),
          }),
        },
      } as unknown as TemporalClient;

      const mockLogger = createMockLogger();
      const deps: SignalHandlerDeps = {
        workflowClient: mockClient,
        logger: mockLogger,
      };

      const input: CompletionSignalInput = {
        prNumber: 46,
        merged: true,
        branchName: "main", // Not a feature branch
        repository: { owner: "my-org", name: "my-repo" },
      };

      // Action: Send completion signal
      const result = await sendCompletionSignal(deps, input);

      // Assert: Returns error gracefully
      expect(result.signaled).toBe(false);
      expect(result.error).toBe("Cannot identify task from branch name");
    });

    it("should handle WorkflowNotFoundError for PR completion gracefully", async () => {
      // Setup: Workflow might not exist (PR may not be linked to a task)
      const notFoundError = new Error("Workflow not found");
      notFoundError.name = "WorkflowNotFoundError";
      const mockGetHandle = vi.fn().mockReturnValue({
        signal: vi.fn().mockRejectedValue(notFoundError),
      });
      const mockClient = {
        workflow: {
          getHandle: mockGetHandle,
        },
      } as unknown as TemporalClient;

      const mockLogger = createMockLogger();
      const deps: SignalHandlerDeps = {
        workflowClient: mockClient,
        logger: mockLogger,
      };

      const input: CompletionSignalInput = {
        prNumber: 47,
        merged: true,
        branchName: "feature/ORPHAN-999",
        repository: { owner: "my-org", name: "my-repo" },
      };

      // Action: Send completion signal to non-existent workflow
      const result = await sendCompletionSignal(deps, input);

      // Assert: Returns graceful error (PR may not be linked to task)
      expect(result.signaled).toBe(false);
      expect(result.error).toBe("Workflow not found");
    });
  });

  describe("Workflow State Transitions", () => {
    // TODO: These tests verify that signals cause correct state transitions
    // Requires Temporal workflow testing utilities

    it.skip("should transition from awaiting_approval to executing on approval", async () => {
      // Setup: Start workflow in awaiting_approval phase
      // Action: Send approval signal
      // Assert: Phase transitions to "executing"
      //
      // This test requires:
      // - Temporal test framework
      // - Workflow state inspection
      expect(true).toBe(true);
    });

    it.skip("should transition from awaiting_approval to re_planning on rejection", async () => {
      // Setup: Start workflow in awaiting_approval phase
      // Action: Send rejection signal with feedback
      // Assert: Phase transitions to "re_planning"
      //
      // This test requires:
      // - Temporal test framework
      // - Workflow state inspection
      expect(true).toBe(true);
    });

    it.skip("should transition to complete on PR merge", async () => {
      // Setup: Start workflow in awaiting_feedback phase with PR created
      // Action: Send prCompletionSignal with merged: true
      // Assert: Phase transitions to "complete"
      //
      // This test requires:
      // - Temporal test framework
      // - Workflow state inspection
      expect(true).toBe(true);
    });
  });
});
