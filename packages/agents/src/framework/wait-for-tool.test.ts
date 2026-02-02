/**
 * Wait For Tool Tests
 *
 * Tests for createWaitForTool() and createDefaultWaitForState().
 * Verifies tool metadata, mutable state interception, confirmation
 * messages, and handling of optional fields.
 */

import { describe, expect, it } from "vitest";
import {
  createDefaultWaitForState,
  createWaitForTool,
} from "./wait-for-tool.js";

describe("createWaitForTool", () => {
  it("returns a ToolDefinition with name 'wait_for'", () => {
    const state = createDefaultWaitForState();
    const tool = createWaitForTool(state);

    expect(tool.name).toBe("wait_for");
  });

  it("has a description mentioning pause and signal", () => {
    const state = createDefaultWaitForState();
    const tool = createWaitForTool(state);

    expect(tool.description).toContain("Pause");
    expect(tool.description).toContain("signal");
  });

  it("has an inputSchema that is a Zod schema", () => {
    const state = createDefaultWaitForState();
    const tool = createWaitForTool(state);

    expect(tool.inputSchema).toBeDefined();
    // Verify it's a Zod schema by checking it has a parse method
    expect(typeof tool.inputSchema.parse).toBe("function");
  });

  it("sets waitForState.triggered to true on execute", async () => {
    const state = createDefaultWaitForState();
    const tool = createWaitForTool(state);

    expect(state.triggered).toBe(false);

    await tool.execute({ type: "approval", reason: "Plan needs review" });

    expect(state.triggered).toBe(true);
  });

  it("populates waitType from input.type", async () => {
    const state = createDefaultWaitForState();
    const tool = createWaitForTool(state);

    await tool.execute({ type: "pr_review", reason: "PR ready for feedback" });

    expect(state.waitType).toBe("pr_review");
  });

  it("populates reason from input.reason", async () => {
    const state = createDefaultWaitForState();
    const tool = createWaitForTool(state);

    await tool.execute({
      type: "approval",
      reason: "Implementation plan needs approval",
    });

    expect(state.reason).toBe("Implementation plan needs approval");
  });

  it("populates timeout when provided", async () => {
    const state = createDefaultWaitForState();
    const tool = createWaitForTool(state);

    await tool.execute({
      type: "approval",
      reason: "Needs review",
      timeout: "72h",
    });

    expect(state.timeout).toBe("72h");
  });

  it("populates metadata when provided", async () => {
    const state = createDefaultWaitForState();
    const tool = createWaitForTool(state);

    const metadata = {
      prUrl: "https://github.com/org/repo/pull/42",
      issueId: "AES-123",
    };
    await tool.execute({ type: "pr_review", reason: "PR created", metadata });

    expect(state.metadata).toEqual(metadata);
  });

  it("returns a confirmation message (not isError)", async () => {
    const state = createDefaultWaitForState();
    const tool = createWaitForTool(state);

    const result = await tool.execute({
      type: "approval",
      reason: "Plan needs review",
    });

    expect(result.content).toBeTruthy();
    expect(result.isError).toBeUndefined();
  });

  it("confirmation message includes type and reason", async () => {
    const state = createDefaultWaitForState();
    const tool = createWaitForTool(state);

    const result = await tool.execute({
      type: "user_reply",
      reason: "Waiting for clarification",
    });

    expect(result.content).toContain("user_reply");
    expect(result.content).toContain("Waiting for clarification");
  });

  it("confirmation message includes timeout when present", async () => {
    const state = createDefaultWaitForState();
    const tool = createWaitForTool(state);

    const result = await tool.execute({
      type: "approval",
      reason: "Needs review",
      timeout: "7d",
    });

    expect(result.content).toContain("7d");
  });

  it("leaves optional fields as null when not provided", async () => {
    const state = createDefaultWaitForState();
    const tool = createWaitForTool(state);

    await tool.execute({ type: "approval", reason: "Plan ready" });

    expect(state.timeout).toBeNull();
    expect(state.metadata).toBeNull();
  });
});

describe("createDefaultWaitForState", () => {
  it("returns an untriggered state with all fields null", () => {
    const state = createDefaultWaitForState();

    expect(state).toEqual({
      triggered: false,
      waitType: null,
      reason: null,
      timeout: null,
      metadata: null,
    });
  });
});
