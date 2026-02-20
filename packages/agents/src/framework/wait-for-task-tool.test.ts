/**
 * Wait For Task Tool Tests
 *
 * Tests for createWaitForTaskTool() verifying mutable WaitForState
 * mutation, waitTypes array, timeoutSignalType, taskId metadata,
 * timeout passthrough, and content message.
 */

import { describe, expect, it } from "vitest";
import { createWaitForTaskTool } from "./wait-for-task-tool.js";
import { createDefaultWaitForState } from "./wait-for-tool.js";

describe("createWaitForTaskTool", () => {
  it("returns a ToolDefinition with name 'wait_for_task'", () => {
    const state = createDefaultWaitForState();
    const tool = createWaitForTaskTool(state);

    expect(tool.name).toBe("wait_for_task");
  });

  it("sets triggered to true on execute", async () => {
    const state = createDefaultWaitForState();
    const tool = createWaitForTaskTool(state);

    expect(state.triggered).toBe(false);
    await tool.execute({ taskId: "task_abc123" });
    expect(state.triggered).toBe(true);
  });

  it("sets waitTypes to all 5 delegation-related signal types", async () => {
    const state = createDefaultWaitForState();
    const tool = createWaitForTaskTool(state);

    await tool.execute({ taskId: "task_abc123" });

    expect(state.waitTypes).toEqual([
      "task_completion",
      "task_failure",
      "task_timeout",
      "task_clarification",
      "task_counter_proposed",
    ]);
  });

  it("sets timeoutSignalType to 'task_timeout'", async () => {
    const state = createDefaultWaitForState();
    const tool = createWaitForTaskTool(state);

    await tool.execute({ taskId: "task_abc123" });

    expect(state.timeoutSignalType).toBe("task_timeout");
  });

  it("sets metadata.taskId to the provided taskId", async () => {
    const state = createDefaultWaitForState();
    const tool = createWaitForTaskTool(state);

    await tool.execute({ taskId: "task_xyz789" });

    expect(state.metadata).toEqual({ taskId: "task_xyz789" });
  });

  it("sets reason including the taskId", async () => {
    const state = createDefaultWaitForState();
    const tool = createWaitForTaskTool(state);

    await tool.execute({ taskId: "task_abc123" });

    expect(state.reason).toContain("task_abc123");
  });

  it("sets timeout when provided", async () => {
    const state = createDefaultWaitForState();
    const tool = createWaitForTaskTool(state);

    await tool.execute({ taskId: "task_abc123", timeout: "24h" });

    expect(state.timeout).toBe("24h");
  });

  it("sets timeout to null when omitted", async () => {
    const state = createDefaultWaitForState();
    const tool = createWaitForTaskTool(state);

    await tool.execute({ taskId: "task_abc123" });

    expect(state.timeout).toBeNull();
  });

  it("returns content message including the taskId", async () => {
    const state = createDefaultWaitForState();
    const tool = createWaitForTaskTool(state);

    const result = await tool.execute({ taskId: "task_abc123" });

    expect(result.content).toContain("task_abc123");
    expect(result.isError).toBeUndefined();
  });

  it("returns content message including timeout when provided", async () => {
    const state = createDefaultWaitForState();
    const tool = createWaitForTaskTool(state);

    const result = await tool.execute({
      taskId: "task_abc123",
      timeout: "7d",
    });

    expect(result.content).toContain("7d");
  });

  it("rejects empty taskId with validation error", async () => {
    const state = createDefaultWaitForState();
    const tool = createWaitForTaskTool(state);

    await expect(tool.execute({ taskId: "" })).rejects.toThrow();
  });
});
