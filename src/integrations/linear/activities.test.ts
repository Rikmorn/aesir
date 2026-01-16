/**
 * Agent Activity Emitters Tests
 *
 * Tests for activity emitters using mocked LinearClient.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  emitThought,
  emitAction,
  emitResponse,
  emitError,
  emitElicitation,
  updateSessionPlan,
} from "./activities.js";
import type { LinearClient } from "@linear/sdk";
import type { AgentPlanItem } from "./types.js";

// Mock LinearClient
function createMockClient() {
  return {
    createAgentActivity: vi.fn().mockResolvedValue(undefined),
    updateAgentSession: vi.fn().mockResolvedValue(undefined),
  } as unknown as LinearClient;
}

describe("emitThought", () => {
  let client: LinearClient;

  beforeEach(() => {
    client = createMockClient();
  });

  it("should call createAgentActivity with thought type", async () => {
    const sessionId = "session-123";
    const body = "Analyzing task requirements...";

    await emitThought(client, sessionId, body);

    expect(client.createAgentActivity).toHaveBeenCalledWith({
      agentSessionId: sessionId,
      content: { type: "thought", body },
    });
  });

  it("should propagate errors from SDK", async () => {
    const error = new Error("API error");
    vi.mocked(client.createAgentActivity).mockRejectedValue(error);

    await expect(emitThought(client, "session", "body")).rejects.toThrow(
      "API error"
    );
  });
});

describe("emitAction", () => {
  let client: LinearClient;

  beforeEach(() => {
    client = createMockClient();
  });

  it("should call createAgentActivity with action type", async () => {
    const sessionId = "session-123";
    const action = "Reading";
    const parameter = "linked GitHub repository";

    await emitAction(client, sessionId, action, parameter);

    expect(client.createAgentActivity).toHaveBeenCalledWith({
      agentSessionId: sessionId,
      content: { type: "action", action, parameter },
    });
  });

  it("should handle different action/parameter combinations", async () => {
    await emitAction(client, "session", "Creating", "pull request");

    expect(client.createAgentActivity).toHaveBeenCalledWith({
      agentSessionId: "session",
      content: { type: "action", action: "Creating", parameter: "pull request" },
    });
  });
});

describe("emitResponse", () => {
  let client: LinearClient;

  beforeEach(() => {
    client = createMockClient();
  });

  it("should call createAgentActivity with response type", async () => {
    const sessionId = "session-123";
    const body = "Created PR #42 with implementation. Ready for review.";

    await emitResponse(client, sessionId, body);

    expect(client.createAgentActivity).toHaveBeenCalledWith({
      agentSessionId: sessionId,
      content: { type: "response", body },
    });
  });
});

describe("emitError", () => {
  let client: LinearClient;

  beforeEach(() => {
    client = createMockClient();
  });

  it("should call createAgentActivity with error type", async () => {
    const sessionId = "session-123";
    const body = "Failed to access repository: permission denied";

    await emitError(client, sessionId, body);

    expect(client.createAgentActivity).toHaveBeenCalledWith({
      agentSessionId: sessionId,
      content: { type: "error", body },
    });
  });
});

describe("emitElicitation", () => {
  let client: LinearClient;

  beforeEach(() => {
    client = createMockClient();
  });

  it("should call createAgentActivity with elicitation type", async () => {
    const sessionId = "session-123";
    const body = "Which branch should I target for the PR?";

    await emitElicitation(client, sessionId, body);

    expect(client.createAgentActivity).toHaveBeenCalledWith({
      agentSessionId: sessionId,
      content: { type: "elicitation", body },
    });
  });
});

describe("updateSessionPlan", () => {
  let client: LinearClient;

  beforeEach(() => {
    client = createMockClient();
  });

  it("should call updateAgentSession with plan array", async () => {
    const sessionId = "session-123";
    const plan: AgentPlanItem[] = [
      { content: "Read task requirements", status: "completed" },
      { content: "Generate implementation", status: "inProgress" },
      { content: "Run tests", status: "pending" },
      { content: "Create pull request", status: "pending" },
    ];

    await updateSessionPlan(client, sessionId, plan);

    expect(client.updateAgentSession).toHaveBeenCalledWith(sessionId, {
      plan,
    });
  });

  it("should handle empty plan array", async () => {
    const plan: AgentPlanItem[] = [];

    await updateSessionPlan(client, "session", plan);

    expect(client.updateAgentSession).toHaveBeenCalledWith("session", {
      plan: [],
    });
  });

  it("should propagate errors from SDK", async () => {
    const error = new Error("Session not found");
    vi.mocked(client.updateAgentSession).mockRejectedValue(error);

    await expect(
      updateSessionPlan(client, "session", [])
    ).rejects.toThrow("Session not found");
  });

  it("should pass all status types correctly", async () => {
    const plan: AgentPlanItem[] = [
      { content: "Step 1", status: "completed" },
      { content: "Step 2", status: "inProgress" },
      { content: "Step 3", status: "pending" },
    ];

    await updateSessionPlan(client, "session", plan);

    const call = vi.mocked(client.updateAgentSession).mock.calls[0]!;
    expect(call[1].plan).toEqual(plan);
  });
});
