/**
 * Signal Matching Tests
 *
 * Tests for signalMatchesPendingWait() covering type matching,
 * multi-type matching, backward compatibility, taskId-scoped matching,
 * and edge cases.
 */

import { describe, expect, it } from "vitest";
import { signalMatchesPendingWait } from "./signal-matching.js";

describe("signalMatchesPendingWait", () => {
  it("returns true for single-type match", () => {
    const signal = { type: "approval" };
    const pendingWait = { types: ["approval"] };

    expect(signalMatchesPendingWait(signal, pendingWait)).toBe(true);
  });

  it("returns true for multi-type match", () => {
    const signal = { type: "task_failure" };
    const pendingWait = {
      types: ["task_completion", "task_failure", "task_timeout"],
    };

    expect(signalMatchesPendingWait(signal, pendingWait)).toBe(true);
  });

  it("returns false for type mismatch", () => {
    const signal = { type: "pr_review" };
    const pendingWait = { types: ["approval"] };

    expect(signalMatchesPendingWait(signal, pendingWait)).toBe(false);
  });

  it("returns false for null pendingWait", () => {
    const signal = { type: "approval" };

    expect(signalMatchesPendingWait(signal, null)).toBe(false);
  });

  it("returns false for undefined pendingWait", () => {
    const signal = { type: "approval" };

    expect(signalMatchesPendingWait(signal, undefined)).toBe(false);
  });

  it("returns false for empty types array", () => {
    const signal = { type: "approval" };
    const pendingWait = { types: [] };

    expect(signalMatchesPendingWait(signal, pendingWait)).toBe(false);
  });

  it("backward compat: returns true when pendingWait uses old type (string) format", () => {
    const signal = { type: "approval" };
    // Old format: { type: string } instead of { types: string[] }
    const pendingWait = { type: "approval" };

    expect(signalMatchesPendingWait(signal, pendingWait)).toBe(true);
  });

  it("taskId-scoped: returns true when signal taskId matches pendingWait metadata taskId", () => {
    const signal = {
      type: "task_completion",
      data: { taskId: "task_abc123" },
    };
    const pendingWait = {
      types: ["task_completion", "task_failure", "task_timeout"],
      metadata: { taskId: "task_abc123" },
    };

    expect(signalMatchesPendingWait(signal, pendingWait)).toBe(true);
  });

  it("taskId-scoped: returns false when signal taskId does NOT match pendingWait metadata taskId", () => {
    const signal = {
      type: "task_completion",
      data: { taskId: "task_other" },
    };
    const pendingWait = {
      types: ["task_completion", "task_failure", "task_timeout"],
      metadata: { taskId: "task_abc123" },
    };

    expect(signalMatchesPendingWait(signal, pendingWait)).toBe(false);
  });

  it("taskId-scoped: returns true when pendingWait has no taskId metadata (non-task wait_for)", () => {
    const signal = {
      type: "approval",
      data: { taskId: "task_abc123" },
    };
    const pendingWait = {
      types: ["approval"],
      metadata: null,
    };

    expect(signalMatchesPendingWait(signal, pendingWait)).toBe(true);
  });
});
