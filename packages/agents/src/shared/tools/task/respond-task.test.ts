/**
 * Tests for the task:respond tool schema.
 *
 * The API-facing schema is a flat object (the Anthropic API rejects a union),
 * so execute() is the only place a variant-invalid shape is caught. These cover
 * that boundary; the object-schema conversion itself is covered for every
 * registered tool in framework/tool-factories.test.ts.
 */

import type { PinoLogger } from "@aesir/platform";
import { describe, expect, it, vi } from "vitest";
import type { DelegationDeps, ToolContext } from "../../../framework/types.js";
import { createRespondTaskTool } from "./respond-task.js";

function createContext(): ToolContext {
  return {
    agentId: "test-agent",
    correlationId: "test-correlation",
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as PinoLogger,
    delegationDeps: {
      taskService: { get: vi.fn().mockResolvedValue(null) },
      executor: { findActiveForTask: vi.fn().mockResolvedValue(null) },
    } as unknown as DelegationDeps,
  };
}

describe("createRespondTaskTool", () => {
  it("accepts every variant shape against the flat input schema", () => {
    const { inputSchema } = createRespondTaskTool(createContext());

    expect(
      inputSchema.safeParse({ taskId: "t1", type: "accept" }).success,
    ).toBe(true);
    expect(
      inputSchema.safeParse({
        taskId: "t1",
        type: "reject",
        reason: "no capacity",
      }).success,
    ).toBe(true);
    expect(
      inputSchema.safeParse({
        taskId: "t1",
        type: "counter_propose",
        proposal: "smaller scope",
      }).success,
    ).toBe(true);
  });

  it("names the missing field when counter_propose omits its proposal", async () => {
    const tool = createRespondTaskTool(createContext());

    const result = await tool.execute({
      taskId: "t1",
      type: "counter_propose",
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("proposal");
  });
});
