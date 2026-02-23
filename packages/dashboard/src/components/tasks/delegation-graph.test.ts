/**
 * Unit tests for graph transformation utilities.
 *
 * Tests the pure functions in graph-utils.ts:
 * - transformTreeToGraph: converts flat task tree into positioned graph nodes/edges
 * - getNodeStatus: maps task status to visual node status
 * - getEdgeState: derives edge visual state from child status + events
 * - getHealthBadge: detects orphan/timeout indicators per node
 * - truncate: text truncation with ellipsis
 *
 * Helper functions are tested indirectly through transformTreeToGraph output
 * and directly via named exports.
 */

import { describe, expect, it } from "vitest";

import type { TaskTreeNode, TimelineEvent, TreeHealth } from "@/services/tasks";

import {
  type GraphNodeData,
  getEdgeState,
  getHealthBadge,
  getNodeStatus,
  transformTreeToGraph,
  truncate,
} from "./graph-utils";

// ─── Test Factories ──────────────────────────────────────────────────────────

function makeNode(overrides: Partial<TaskTreeNode> = {}): TaskTreeNode {
  return {
    id: "task-1",
    parentId: null,
    creatorId: "agent-1",
    assigneeId: "agent-2",
    entityName: "dev-agent",
    status: "active",
    title: "Test task",
    objective: null,
    depth: 0,
    completionResult: null,
    metadata: null,
    conversationId: null,
    conversationStatus: null,
    createdAt: "2026-02-11T00:00:00Z",
    updatedAt: "2026-02-11T00:00:00Z",
    completedAt: null,
    groupId: null,
    groupPolicy: null,
    groupStatus: null,
    subtreeAllocation: null,
    subtreeConsumed: null,
    ...overrides,
  };
}

function makeEvent(overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    id: "evt-1",
    conversationId: "conv-1",
    taskId: "task-1",
    entityName: "dev-agent",
    type: "agent.started",
    payload: {},
    timestamp: "2026-02-11T00:00:00Z",
    ...overrides,
  };
}

const defaultHealth: TreeHealth = {
  orphanedCount: 0,
  timeoutCount: 0,
  rejectionChainCount: 0,
  depthLimitReached: false,
  severity: "clean",
};

// ─── transformTreeToGraph ────────────────────────────────────────────────────

describe("transformTreeToGraph", () => {
  it("produces a single node and no edges for a standalone task", () => {
    const nodes = [makeNode({ id: "root" })];

    const { nodes: graphNodes, edges } = transformTreeToGraph(
      nodes,
      [],
      defaultHealth,
    );

    expect(graphNodes).toHaveLength(1);
    expect(graphNodes[0]?.id).toBe("root");
    expect(graphNodes[0]?.type).toBe("task");
    expect(edges).toHaveLength(0);
  });

  it("produces parent-child edge with correct source and target", () => {
    const nodes = [
      makeNode({ id: "parent" }),
      makeNode({ id: "child", parentId: "parent" }),
    ];

    const { nodes: graphNodes, edges } = transformTreeToGraph(
      nodes,
      [],
      defaultHealth,
    );

    expect(graphNodes).toHaveLength(2);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.source).toBe("parent");
    expect(edges[0]?.target).toBe("child");
    expect(edges[0]?.id).toBe("parent-child");
  });

  it("truncates titles longer than 50 characters", () => {
    const longTitle =
      "This is a very long task title that should be truncated because it exceeds fifty characters";
    const nodes = [makeNode({ id: "t1", title: longTitle })];

    const { nodes: graphNodes } = transformTreeToGraph(
      nodes,
      [],
      defaultHealth,
    );

    const d = graphNodes[0]?.data as GraphNodeData;
    expect(d.summary.length).toBeLessThanOrEqual(52); // 49 chars + "..."
    expect(d.summary).toContain("...");
  });

  it("preserves short titles without truncation", () => {
    const shortTitle = "Short task";
    const nodes = [makeNode({ id: "t1", title: shortTitle })];

    const { nodes: graphNodes } = transformTreeToGraph(
      nodes,
      [],
      defaultHealth,
    );

    expect((graphNodes[0]?.data as GraphNodeData).summary).toBe(shortTitle);
  });

  it("uses assigneeId when entityName is null", () => {
    const nodes = [
      makeNode({ id: "t1", entityName: null, assigneeId: "agent-123" }),
    ];

    const { nodes: graphNodes } = transformTreeToGraph(
      nodes,
      [],
      defaultHealth,
    );

    expect((graphNodes[0]?.data as GraphNodeData).entityName).toBe("agent-123");
  });

  it("uses entityName when available", () => {
    const nodes = [
      makeNode({ id: "t1", entityName: "dev-agent", assigneeId: "agent-123" }),
    ];

    const { nodes: graphNodes } = transformTreeToGraph(
      nodes,
      [],
      defaultHealth,
    );

    expect((graphNodes[0]?.data as GraphNodeData).entityName).toBe("dev-agent");
  });
});

// ─── getNodeStatus ───────────────────────────────────────────────────────────

describe("getNodeStatus", () => {
  it("maps active to running", () => {
    expect(getNodeStatus(makeNode({ status: "active" }))).toBe("running");
  });

  it("maps completed to completed", () => {
    expect(getNodeStatus(makeNode({ status: "completed" }))).toBe("completed");
  });

  it("maps created to pending", () => {
    expect(getNodeStatus(makeNode({ status: "created" }))).toBe("pending");
  });

  it("maps paused to waiting", () => {
    expect(getNodeStatus(makeNode({ status: "paused" }))).toBe("waiting");
  });

  it("maps cancelled with rejected metadata to rejected", () => {
    expect(
      getNodeStatus(
        makeNode({ status: "cancelled", metadata: { rejected: true } }),
      ),
    ).toBe("rejected");
  });

  it("maps cancelled with rejectionReason to rejected", () => {
    expect(
      getNodeStatus(
        makeNode({
          status: "cancelled",
          metadata: { rejectionReason: "Too complex" },
        }),
      ),
    ).toBe("rejected");
  });

  it("maps cancelled without rejection to pending", () => {
    expect(getNodeStatus(makeNode({ status: "cancelled" }))).toBe("pending");
  });

  it("maps unknown status to pending fallback", () => {
    expect(getNodeStatus(makeNode({ status: "unknown_status" }))).toBe(
      "pending",
    );
  });
});

// ─── getEdgeState ────────────────────────────────────────────────────────────

describe("getEdgeState", () => {
  it("returns pending for created child", () => {
    expect(getEdgeState(makeNode({ status: "created" }), [])).toBe("pending");
  });

  it("returns active for active child", () => {
    expect(getEdgeState(makeNode({ status: "active" }), [])).toBe("active");
  });

  it("returns completed for completed child without orphan events", () => {
    expect(getEdgeState(makeNode({ status: "completed" }), [])).toBe(
      "completed",
    );
  });

  it("returns orphaned for completed child with signal.orphaned event", () => {
    const child = makeNode({ id: "child-1", status: "completed" });
    const events = [
      makeEvent({
        id: "e1",
        type: "signal.orphaned",
        taskId: "child-1",
      }),
    ];

    expect(getEdgeState(child, events)).toBe("orphaned");
  });

  it("returns rejected for cancelled child with rejected metadata", () => {
    const child = makeNode({
      status: "cancelled",
      metadata: { rejected: true },
    });

    expect(getEdgeState(child, [])).toBe("rejected");
  });

  it("returns rejected for cancelled child with rejectionReason", () => {
    const child = makeNode({
      status: "cancelled",
      metadata: { rejectionReason: "Not my domain" },
    });

    expect(getEdgeState(child, [])).toBe("rejected");
  });

  it("returns timeout for child with timeout signal event", () => {
    const child = makeNode({ id: "child-1", status: "active" });
    const events = [
      makeEvent({
        id: "e1",
        type: "signal.received",
        taskId: "child-1",
        payload: { signalType: "timeout" },
      }),
    ];

    expect(getEdgeState(child, events)).toBe("timeout");
  });

  it("returns failed for child with failed conversation status", () => {
    const child = makeNode({
      status: "paused",
      conversationStatus: "failed",
    });

    expect(getEdgeState(child, [])).toBe("failed");
  });

  it("returns pending for cancelled child without rejection", () => {
    expect(getEdgeState(makeNode({ status: "cancelled" }), [])).toBe("pending");
  });

  it("prioritizes rejected over timeout", () => {
    const child = makeNode({
      id: "child-1",
      status: "cancelled",
      metadata: { rejected: true },
    });
    const events = [
      makeEvent({
        id: "e1",
        type: "signal.received",
        taskId: "child-1",
        payload: { signalType: "timeout" },
      }),
    ];

    // rejected check happens before timeout check
    expect(getEdgeState(child, events)).toBe("rejected");
  });
});

// ─── getHealthBadge ──────────────────────────────────────────────────────────

describe("getHealthBadge", () => {
  it("returns orphan when signal.orphaned event targets the node", () => {
    const node = makeNode({ id: "t1" });
    const events = [
      makeEvent({ id: "e1", type: "signal.orphaned", taskId: "t1" }),
    ];

    expect(getHealthBadge(node, events)).toBe("orphan");
  });

  it("returns timeout when timeout signal event targets the node", () => {
    const node = makeNode({ id: "t1" });
    const events = [
      makeEvent({
        id: "e1",
        type: "signal.received",
        taskId: "t1",
        payload: { signalType: "timeout" },
      }),
    ];

    expect(getHealthBadge(node, events)).toBe("timeout");
  });

  it("returns null when no problem events exist", () => {
    const node = makeNode({ id: "t1" });
    const events = [makeEvent({ id: "e1", type: "agent.started" })];

    expect(getHealthBadge(node, events)).toBeNull();
  });

  it("returns null for events targeting a different node", () => {
    const node = makeNode({ id: "t1" });
    const events = [
      makeEvent({ id: "e1", type: "signal.orphaned", taskId: "t2" }),
    ];

    expect(getHealthBadge(node, events)).toBeNull();
  });

  it("prioritizes orphan over timeout", () => {
    const node = makeNode({ id: "t1" });
    const events = [
      makeEvent({ id: "e1", type: "signal.orphaned", taskId: "t1" }),
      makeEvent({
        id: "e2",
        type: "signal.received",
        taskId: "t1",
        payload: { signalType: "timeout" },
      }),
    ];

    expect(getHealthBadge(node, events)).toBe("orphan");
  });
});

// ─── truncate ────────────────────────────────────────────────────────────────

describe("truncate", () => {
  it("does not truncate text shorter than maxLen", () => {
    expect(truncate("short", 50)).toBe("short");
  });

  it("does not truncate text equal to maxLen", () => {
    expect(truncate("12345", 5)).toBe("12345");
  });

  it("truncates text longer than maxLen with ellipsis", () => {
    const result = truncate("This is a long text", 10);
    expect(result).toBe("This is a...");
    expect(result.length).toBe(12); // 9 chars + "..."
  });
});
