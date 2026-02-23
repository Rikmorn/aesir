/**
 * Unit tests for computeTreeHealth pure function.
 *
 * computeTreeHealth analyzes task tree nodes and events to determine health
 * indicators: orphaned signals, timeouts, rejection chains, depth limits,
 * and an overall severity (clean | warning | failure).
 */

import { describe, expect, it, vi } from "vitest";

// Mock the database module to avoid connection side effects
vi.mock("@/lib/db", () => ({
  db: {},
}));

import {
  computeTreeHealth,
  type TaskTreeNode,
  type TimelineEvent,
} from "./tasks";

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

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("computeTreeHealth", () => {
  it("returns clean severity for a healthy tree", () => {
    const nodes = [
      makeNode({ id: "t1", status: "completed" }),
      makeNode({ id: "t2", status: "completed", parentId: "t1" }),
    ];
    const events = [
      makeEvent({ id: "e1", type: "agent.started" }),
      makeEvent({ id: "e2", type: "agent.completed" }),
    ];

    const health = computeTreeHealth(nodes, events);

    expect(health.severity).toBe("clean");
    expect(health.orphanedCount).toBe(0);
    expect(health.timeoutCount).toBe(0);
    expect(health.rejectionChainCount).toBe(0);
    expect(health.depthLimitReached).toBe(false);
  });

  it("detects orphaned signals as failure severity", () => {
    const nodes = [makeNode({ id: "t1" })];
    const events = [makeEvent({ id: "e1", type: "signal.orphaned" })];

    const health = computeTreeHealth(nodes, events);

    expect(health.orphanedCount).toBe(1);
    expect(health.severity).toBe("failure");
  });

  it("detects timeout signals as warning severity", () => {
    const nodes = [makeNode({ id: "t1" })];
    const events = [
      makeEvent({
        id: "e1",
        type: "signal.received",
        payload: { signalType: "timeout" },
      }),
    ];

    const health = computeTreeHealth(nodes, events);

    expect(health.timeoutCount).toBe(1);
    expect(health.severity).toBe("warning");
  });

  it("detects rejection via metadata.rejected=true", () => {
    const nodes = [
      makeNode({
        id: "t1",
        status: "cancelled",
        metadata: { rejected: true },
      }),
    ];

    const health = computeTreeHealth(nodes, []);

    expect(health.rejectionChainCount).toBe(1);
    expect(health.severity).toBe("warning");
  });

  it("detects rejection via cancelled status + rejectionReason metadata", () => {
    const nodes = [
      makeNode({
        id: "t1",
        status: "cancelled",
        metadata: { rejectionReason: "Too complex" },
      }),
    ];

    const health = computeTreeHealth(nodes, []);

    expect(health.rejectionChainCount).toBe(1);
    expect(health.severity).toBe("warning");
  });

  it("detects depth limit reached when depth >= 5", () => {
    const nodes = [
      makeNode({ id: "t1", depth: 0 }),
      makeNode({ id: "t2", depth: 1, parentId: "t1" }),
      makeNode({ id: "t3", depth: 5, parentId: "t2" }),
    ];

    const health = computeTreeHealth(nodes, []);

    expect(health.depthLimitReached).toBe(true);
    expect(health.severity).toBe("warning");
  });

  it("detects failed node status as failure severity", () => {
    const nodes = [makeNode({ id: "t1", status: "failed" })];

    const health = computeTreeHealth(nodes, []);

    expect(health.severity).toBe("failure");
  });

  it("detects failed conversation status as failure severity", () => {
    const nodes = [
      makeNode({ id: "t1", status: "active", conversationStatus: "failed" }),
    ];

    const health = computeTreeHealth(nodes, []);

    expect(health.severity).toBe("failure");
  });

  it("failure beats warning when both present", () => {
    const nodes = [makeNode({ id: "t1" })];
    const events = [
      // Orphan -> failure
      makeEvent({ id: "e1", type: "signal.orphaned" }),
      // Timeout -> warning
      makeEvent({
        id: "e2",
        type: "signal.received",
        payload: { signalType: "timeout" },
      }),
    ];

    const health = computeTreeHealth(nodes, events);

    expect(health.orphanedCount).toBe(1);
    expect(health.timeoutCount).toBe(1);
    expect(health.severity).toBe("failure");
  });

  it("stacks multiple warning indicators", () => {
    const nodes = [
      makeNode({
        id: "t1",
        status: "cancelled",
        metadata: { rejected: true },
      }),
    ];
    const events = [
      makeEvent({
        id: "e1",
        type: "signal.received",
        payload: { signalType: "timeout" },
      }),
    ];

    const health = computeTreeHealth(nodes, events);

    expect(health.timeoutCount).toBe(1);
    expect(health.rejectionChainCount).toBe(1);
    expect(health.severity).toBe("warning");
  });

  it("returns clean severity for empty tree", () => {
    const health = computeTreeHealth([], []);

    expect(health.severity).toBe("clean");
    expect(health.orphanedCount).toBe(0);
    expect(health.timeoutCount).toBe(0);
    expect(health.rejectionChainCount).toBe(0);
    expect(health.depthLimitReached).toBe(false);
  });
});
