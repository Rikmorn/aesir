/**
 * Fast-Path Router Tests
 *
 * Tests for deterministic rule matching, action execution, and rule table integrity.
 * Covers all 9 rules, edge cases (unknown events, non-matching branches),
 * and executeFastPath behavior for signal, start, and ignore actions.
 */

import type { PinoLogger } from "@aesir/platform";
import type { NormalizedEvent } from "@aesir/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RouterDeps } from "./types.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../shared/mcp/index.js", () => ({
  callMcpTool: vi.fn().mockResolvedValue({
    id: "issue-123",
    identifier: "ABC-123",
    title: "Test Issue",
    description: "Test description",
    priority: 1,
    labels: [{ id: "lbl-1", name: "bug", color: "#ff0000" }],
  }),
}));

// We need to import after mocks are set up
const { DETERMINISTIC_RULES, executeFastPath, matchFastPath } = await import(
  "./fast-path.js"
);

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

function createTestEvent(
  overrides: Partial<NormalizedEvent> = {},
): NormalizedEvent {
  return {
    id: "evt_test123",
    type: "slack.block_actions.approved",
    source: "slack",
    timestamp: "2026-01-30T12:00:00Z",
    correlationId: "corr-test",
    payload: { taskIdentifier: "ABC-123" },
    ...overrides,
  };
}

function createMockDeps(): RouterDeps {
  const mockSignal = vi.fn().mockResolvedValue(undefined);
  const mockStart = vi.fn().mockResolvedValue(undefined);
  const mockGetHandle = vi.fn().mockReturnValue({ signal: mockSignal });

  return {
    workflowClient: {
      workflow: {
        getHandle: mockGetHandle,
        start: mockStart,
        list: vi.fn(),
      },
    } as unknown as RouterDeps["workflowClient"],
    logger: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      child: vi.fn().mockReturnValue({
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
        child: vi.fn().mockReturnThis(),
      }),
    } as unknown as PinoLogger,
    alertsChannel: "C-alerts",
  };
}

// ---------------------------------------------------------------------------
// matchFastPath
// ---------------------------------------------------------------------------

describe("matchFastPath", () => {
  // === Slack Approval/Rejection ===

  it("matches slack.block_actions.approved -> signal planApproval (approved: true)", () => {
    const event = createTestEvent({
      source: "slack",
      type: "slack.block_actions.approved",
      payload: { taskIdentifier: "TASK-42" },
    });

    const action = matchFastPath(event);
    expect(action).not.toBeNull();
    expect(action?.type).toBe("signal");
    if (action?.type === "signal") {
      expect(action.workflowId).toBe("dev-agent-TASK-42");
      expect(action.signal).toBe("planApproval");
      expect(action.payload).toEqual({ approved: true, source: "slack" });
    }
  });

  it("matches slack.block_actions.rejected -> signal planApproval (approved: false)", () => {
    const event = createTestEvent({
      source: "slack",
      type: "slack.block_actions.rejected",
      payload: { taskIdentifier: "TASK-42" },
    });

    const action = matchFastPath(event);
    expect(action).not.toBeNull();
    expect(action?.type).toBe("signal");
    if (action?.type === "signal") {
      expect(action.workflowId).toBe("dev-agent-TASK-42");
      expect(action.signal).toBe("planApproval");
      expect(action.payload).toEqual({
        approved: false,
        feedback: "Rejected via Slack button",
        source: "slack",
      });
    }
  });

  // === Slack Escalation ===

  it("matches slack.block_actions.escalation_retry -> signal escalationResolved (action: retry)", () => {
    const event = createTestEvent({
      source: "slack",
      type: "slack.block_actions.escalation_retry",
      payload: { taskIdentifier: "TASK-99" },
    });

    const action = matchFastPath(event);
    expect(action).not.toBeNull();
    expect(action?.type).toBe("signal");
    if (action?.type === "signal") {
      expect(action.workflowId).toBe("dev-agent-TASK-99");
      expect(action.signal).toBe("escalationResolved");
      expect(action.payload).toEqual({ action: "retry" });
    }
  });

  it("matches slack.block_actions.escalation_abort -> signal escalationResolved (action: abort)", () => {
    const event = createTestEvent({
      source: "slack",
      type: "slack.block_actions.escalation_abort",
      payload: { taskIdentifier: "TASK-99" },
    });

    const action = matchFastPath(event);
    expect(action).not.toBeNull();
    expect(action?.type).toBe("signal");
    if (action?.type === "signal") {
      expect(action.workflowId).toBe("dev-agent-TASK-99");
      expect(action.signal).toBe("escalationResolved");
      expect(action.payload).toEqual({ action: "abort" });
    }
  });

  // === GitHub PR Events ===

  it("matches github.pull_request.merged -> signal prCompletion (merged: true)", () => {
    const event = createTestEvent({
      source: "github",
      type: "github.pull_request.merged",
      payload: { branchName: "feature/ABC-123", prNumber: 42 },
    });

    const action = matchFastPath(event);
    expect(action).not.toBeNull();
    expect(action?.type).toBe("signal");
    if (action?.type === "signal") {
      expect(action.workflowId).toBe("dev-agent-ABC-123");
      expect(action.signal).toBe("prCompletion");
      expect(action.payload).toEqual({ merged: true, prNumber: 42 });
    }
  });

  it("matches github.pull_request.closed -> signal prCompletion (merged: false)", () => {
    const event = createTestEvent({
      source: "github",
      type: "github.pull_request.closed",
      payload: { branchName: "feature/DEF-456", prNumber: 99 },
    });

    const action = matchFastPath(event);
    expect(action).not.toBeNull();
    expect(action?.type).toBe("signal");
    if (action?.type === "signal") {
      expect(action.workflowId).toBe("dev-agent-DEF-456");
      expect(action.signal).toBe("prCompletion");
      expect(action.payload).toEqual({ merged: false, prNumber: 99 });
    }
  });

  // === Linear Agent Session ===

  it("matches linear.agent_session.created -> start orchestratorWorkflow", () => {
    const event = createTestEvent({
      source: "linear",
      type: "linear.agent_session.created",
      payload: { issueId: "issue-uuid-abc" },
    });

    const action = matchFastPath(event);
    expect(action).not.toBeNull();
    expect(action?.type).toBe("start");
    if (action?.type === "start") {
      expect(action.workflowName).toBe("orchestratorWorkflow");
      expect(action.taskQueue).toBe("dev-agent-v2");
      expect(action.workflowId).toBe("dev-agent-issue-uuid-abc");
      expect(action.needsEnrichment).toBe(true);
      expect(action.enrichmentContext).toEqual({ issueId: "issue-uuid-abc" });
    }
  });

  // === Linear Ignore Rules ===

  it("matches linear.issue.created -> ignore", () => {
    const event = createTestEvent({
      source: "linear",
      type: "linear.issue.created",
      payload: {},
    });

    const action = matchFastPath(event);
    expect(action).not.toBeNull();
    expect(action?.type).toBe("ignore");
    if (action?.type === "ignore") {
      expect(action.reason).toContain("Linear webhooks");
    }
  });

  it("matches linear.issue.updated -> ignore", () => {
    const event = createTestEvent({
      source: "linear",
      type: "linear.issue.updated",
      payload: {},
    });

    const action = matchFastPath(event);
    expect(action).not.toBeNull();
    expect(action?.type).toBe("ignore");
    if (action?.type === "ignore") {
      expect(action.reason).toContain("Linear webhooks");
    }
  });

  // === Edge Cases: No Match (slow-path candidates) ===

  it("returns null for unknown event types", () => {
    const event = createTestEvent({
      source: "slack",
      type: "slack.unknown.event",
    });

    expect(matchFastPath(event)).toBeNull();
  });

  it("returns null for slack.message.created (slow-path event)", () => {
    const event = createTestEvent({
      source: "slack",
      type: "slack.message.created",
      payload: { text: "hello world" },
    });

    expect(matchFastPath(event)).toBeNull();
  });

  it("returns null for linear.comment.created (slow-path event)", () => {
    const event = createTestEvent({
      source: "linear",
      type: "linear.comment.created",
      payload: { body: "looks good" },
    });

    expect(matchFastPath(event)).toBeNull();
  });

  it("returns null for github.pull_request.review_submitted (slow-path event)", () => {
    const event = createTestEvent({
      source: "github",
      type: "github.pull_request.review_submitted",
      payload: { review: "LGTM" },
    });

    expect(matchFastPath(event)).toBeNull();
  });

  // === PR Branch Extraction Edge Cases ===

  it("returns ignore for merged PR with non-matching branch name", () => {
    const event = createTestEvent({
      source: "github",
      type: "github.pull_request.merged",
      payload: { branchName: "main", prNumber: 10 },
    });

    const action = matchFastPath(event);
    expect(action).not.toBeNull();
    expect(action?.type).toBe("ignore");
    if (action?.type === "ignore") {
      expect(action.reason).toContain("Cannot extract task ID");
      expect(action.reason).toContain("main");
    }
  });

  it("returns ignore for closed PR with non-matching branch name", () => {
    const event = createTestEvent({
      source: "github",
      type: "github.pull_request.closed",
      payload: { branchName: "hotfix/quick-fix", prNumber: 11 },
    });

    const action = matchFastPath(event);
    expect(action).not.toBeNull();
    expect(action?.type).toBe("ignore");
    if (action?.type === "ignore") {
      expect(action.reason).toContain("Cannot extract task ID");
    }
  });

  it("extracts task ID from case-insensitive branch name", () => {
    const event = createTestEvent({
      source: "github",
      type: "github.pull_request.merged",
      payload: { branchName: "Feature/XYZ-789", prNumber: 55 },
    });

    const action = matchFastPath(event);
    expect(action).not.toBeNull();
    expect(action?.type).toBe("signal");
    if (action?.type === "signal") {
      expect(action.workflowId).toBe("dev-agent-XYZ-789");
    }
  });
});

// ---------------------------------------------------------------------------
// executeFastPath
// ---------------------------------------------------------------------------

describe("executeFastPath", () => {
  let deps: RouterDeps;

  beforeEach(() => {
    deps = createMockDeps();
  });

  // === Ignore Action ===

  it("returns ignored status for ignore actions", async () => {
    const result = await executeFastPath(
      { type: "ignore", reason: "Handled elsewhere" },
      deps,
    );

    expect(result.status).toBe("ignored");
    expect(result.action).toContain("ignore");
    expect(result.action).toContain("Handled elsewhere");
  });

  // === Signal Action ===

  it("sends signal via getHandle + signal for signal actions", async () => {
    const result = await executeFastPath(
      {
        type: "signal",
        workflowId: "dev-agent-TASK-1",
        signal: "planApproval",
        payload: { approved: true },
      },
      deps,
    );

    expect(result.status).toBe("routed");
    expect(result.action).toBe("signal:planApproval");
    expect(result.workflowId).toBe("dev-agent-TASK-1");

    const client = deps.workflowClient as unknown as {
      workflow: {
        getHandle: ReturnType<typeof vi.fn>;
        start: ReturnType<typeof vi.fn>;
      };
    };
    expect(client.workflow.getHandle).toHaveBeenCalledWith("dev-agent-TASK-1");
  });

  it("returns failed status when workflow not found (WorkflowNotFoundError name)", async () => {
    const notFoundError = new Error("Workflow not found");
    notFoundError.name = "WorkflowNotFoundError";

    const mockHandle = { signal: vi.fn().mockRejectedValue(notFoundError) };
    (
      deps.workflowClient as unknown as {
        workflow: { getHandle: ReturnType<typeof vi.fn> };
      }
    ).workflow.getHandle = vi.fn().mockReturnValue(mockHandle);

    const result = await executeFastPath(
      {
        type: "signal",
        workflowId: "dev-agent-GONE",
        signal: "planApproval",
        payload: { approved: true },
      },
      deps,
    );

    expect(result.status).toBe("failed");
    expect(result.error).toBe("Workflow not found");
    expect(result.workflowId).toBe("dev-agent-GONE");
  });

  it("returns failed status when workflow not found (message includes 'not found')", async () => {
    const mockHandle = {
      signal: vi
        .fn()
        .mockRejectedValue(new Error("Workflow not found in namespace")),
    };
    (
      deps.workflowClient as unknown as {
        workflow: { getHandle: ReturnType<typeof vi.fn> };
      }
    ).workflow.getHandle = vi.fn().mockReturnValue(mockHandle);

    const result = await executeFastPath(
      {
        type: "signal",
        workflowId: "dev-agent-GONE-2",
        signal: "escalationResolved",
        payload: { action: "retry" },
      },
      deps,
    );

    expect(result.status).toBe("failed");
    expect(result.error).toBe("Workflow not found");
  });

  it("returns failed status for generic signal errors", async () => {
    const mockHandle = {
      signal: vi.fn().mockRejectedValue(new Error("Network timeout")),
    };
    (
      deps.workflowClient as unknown as {
        workflow: { getHandle: ReturnType<typeof vi.fn> };
      }
    ).workflow.getHandle = vi.fn().mockReturnValue(mockHandle);

    const result = await executeFastPath(
      {
        type: "signal",
        workflowId: "dev-agent-ERR",
        signal: "prCompletion",
        payload: { merged: true, prNumber: 1 },
      },
      deps,
    );

    expect(result.status).toBe("failed");
    expect(result.error).toBe("Network timeout");
  });

  // === Start Action ===

  it("starts workflow for start actions", async () => {
    const result = await executeFastPath(
      {
        type: "start",
        workflowName: "orchestratorWorkflow",
        taskQueue: "dev-agent-v2",
        workflowId: "dev-agent-NEW-1",
        args: [],
      },
      deps,
    );

    expect(result.status).toBe("routed");
    expect(result.action).toBe("start:orchestratorWorkflow");
    expect(result.workflowId).toBe("dev-agent-NEW-1");

    const client = deps.workflowClient as unknown as {
      workflow: { start: ReturnType<typeof vi.fn> };
    };
    expect(client.workflow.start).toHaveBeenCalledWith("orchestratorWorkflow", {
      taskQueue: "dev-agent-v2",
      workflowId: "dev-agent-NEW-1",
      args: [],
    });
  });

  it("returns routed (duplicate) for WorkflowExecutionAlreadyStartedError", async () => {
    const alreadyStartedError = new Error("Workflow already exists");
    alreadyStartedError.name = "WorkflowExecutionAlreadyStartedError";

    (
      deps.workflowClient as unknown as {
        workflow: { start: ReturnType<typeof vi.fn> };
      }
    ).workflow.start = vi.fn().mockRejectedValue(alreadyStartedError);

    const result = await executeFastPath(
      {
        type: "start",
        workflowName: "orchestratorWorkflow",
        taskQueue: "dev-agent-v2",
        workflowId: "dev-agent-DUP-1",
        args: [],
      },
      deps,
    );

    expect(result.status).toBe("routed");
    expect(result.action).toContain("duplicate");
  });

  it("returns failed for generic start errors", async () => {
    (
      deps.workflowClient as unknown as {
        workflow: { start: ReturnType<typeof vi.fn> };
      }
    ).workflow.start = vi
      .fn()
      .mockRejectedValue(new Error("Connection refused"));

    const result = await executeFastPath(
      {
        type: "start",
        workflowName: "orchestratorWorkflow",
        taskQueue: "dev-agent-v2",
        workflowId: "dev-agent-FAIL-1",
        args: [],
      },
      deps,
    );

    expect(result.status).toBe("failed");
    expect(result.error).toBe("Connection refused");
  });

  // === Start Action with Enrichment ===

  it("enriches via MCP when needsEnrichment is true", async () => {
    const { callMcpTool } = await import("../shared/mcp/index.js");

    const result = await executeFastPath(
      {
        type: "start",
        workflowName: "orchestratorWorkflow",
        taskQueue: "dev-agent-v2",
        workflowId: "dev-agent-ENRICH-1",
        args: [],
        needsEnrichment: true,
        enrichmentContext: { issueId: "issue-123" },
      },
      deps,
    );

    expect(result.status).toBe("routed");
    expect(callMcpTool).toHaveBeenCalledWith(
      expect.objectContaining({
        integration: "linear",
        tool: "get_issue",
        params: { issueId: "issue-123" },
        agentId: "router",
      }),
    );

    // Verify the enriched args were passed to workflow.start
    const client = deps.workflowClient as unknown as {
      workflow: { start: ReturnType<typeof vi.fn> };
    };
    const startCall = client.workflow.start.mock.calls[0]!;
    expect(startCall[1].args).toHaveLength(1);
    expect(startCall[1].args[0]).toMatchObject({
      taskId: "issue-123",
      issueIdentifier: "ABC-123",
      issue: {
        id: "issue-123",
        identifier: "ABC-123",
        title: "Test Issue",
        description: "Test description",
        priority: 1,
        labels: ["bug"],
      },
    });
  });
});

// ---------------------------------------------------------------------------
// DETERMINISTIC_RULES
// ---------------------------------------------------------------------------

describe("DETERMINISTIC_RULES", () => {
  it("has exactly 9 rules", () => {
    expect(DETERMINISTIC_RULES).toHaveLength(9);
  });

  it("all rules have unique names", () => {
    const names = DETERMINISTIC_RULES.map((r: { name: string }) => r.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });

  it("all rules have match and action functions", () => {
    for (const rule of DETERMINISTIC_RULES) {
      expect(rule.match).toBeTypeOf("function");
      expect(rule.action).toBeTypeOf("function");
      expect(rule.name).toBeTruthy();
    }
  });

  it("rule names match expected set", () => {
    const names = DETERMINISTIC_RULES.map((r: { name: string }) => r.name);
    expect(names).toEqual([
      "slack-approval-button",
      "slack-rejection-button",
      "slack-escalation-retry",
      "slack-escalation-abort",
      "github-pr-merged",
      "github-pr-closed",
      "linear-agent-session-created",
      "linear-issue-created",
      "linear-issue-updated",
    ]);
  });
});
