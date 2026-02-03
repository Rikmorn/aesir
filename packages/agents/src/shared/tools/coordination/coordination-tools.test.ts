/**
 * Coordination Tools Tests
 *
 * Unit tests for request_human_input tool factory.
 * Tests input validation, sentinel return values, and error handling.
 */

import { describe, expect, it } from "vitest";
import {
  createRequestHumanInputTool,
  HUMAN_INPUT_MARKER,
} from "./request-human-input.js";

// ---------------------------------------------------------------------------
// request_human_input
// ---------------------------------------------------------------------------

describe("createRequestHumanInputTool", () => {
  it("returns a ToolDefinition with correct name", () => {
    const tool = createRequestHumanInputTool();
    expect(tool.name).toBe("request_human_input");
    expect(tool.description).toBeTruthy();
    expect(tool.inputSchema).toBeDefined();
    expect(tool.execute).toBeTypeOf("function");
  });

  it("returns sentinel JSON with HUMAN_INPUT_MARKER type on valid input", async () => {
    const tool = createRequestHumanInputTool();
    const result = await tool.execute({
      channel: "C1234567890",
      message: "Please approve the PR",
      requestType: "approval",
    });

    const parsed = JSON.parse(result.content);
    expect(parsed.type).toBe(HUMAN_INPUT_MARKER);
    expect(parsed.channel).toBe("C1234567890");
    expect(parsed.message).toBe("Please approve the PR");
    expect(parsed.requestType).toBe("approval");
  });

  it("returns isError:true for invalid input", async () => {
    const tool = createRequestHumanInputTool();
    const result = await tool.execute({});

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Invalid input");
  });

  it("output can be parsed as JSON and contains all expected fields", async () => {
    const tool = createRequestHumanInputTool();
    const result = await tool.execute({
      channel: "C9876543210",
      message: "Need clarification on requirements",
      requestType: "clarification",
    });

    // Should be parseable JSON
    const parsed = JSON.parse(result.content);
    expect(parsed).toHaveProperty("type");
    expect(parsed).toHaveProperty("channel");
    expect(parsed).toHaveProperty("message");
    expect(parsed).toHaveProperty("requestType");
    expect(parsed.requestType).toBe("clarification");
  });

  it("does NOT set isError flag (successful result, not an error)", async () => {
    const tool = createRequestHumanInputTool();
    const result = await tool.execute({
      channel: "C1234567890",
      message: "Escalating issue",
      requestType: "escalation",
    });

    expect(result.isError).toBeUndefined();
  });

  it("HUMAN_INPUT_MARKER constant equals 'human_input_requested'", () => {
    expect(HUMAN_INPUT_MARKER).toBe("human_input_requested");
  });
});
