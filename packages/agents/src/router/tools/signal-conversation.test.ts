/**
 * Signal Conversation Tool Tests
 *
 * Tests for replyContext auto-injection and override in signal_conversation:
 * - Auto-injects eventReplyContext from deps when LLM omits replyContext
 * - LLM-provided replyContext overrides eventReplyContext
 * - Omits replyContext when neither LLM nor deps provides it
 * - Validates replyContext with ReplyContextSchema (rejects invalid)
 * - Includes replyContext alongside all other signal fields
 */

import type { PinoLogger } from "@aesir/platform";
import { describe, expect, it, vi } from "vitest";
import type { ConversationExecutor } from "../../framework/types.js";
import type { ReplyContext } from "../../shared/communication/types.js";
import type { EventRouterDeps } from "../types.js";
import { createSignalConversationTool } from "./signal-conversation.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function createMockLogger(): PinoLogger {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn(),
    level: "info",
    silent: vi.fn(),
  };
  logger.child.mockReturnValue(logger);
  return logger as unknown as PinoLogger;
}

function createMockExecutor(): ConversationExecutor {
  return {
    start: vi.fn().mockResolvedValue("conv-123"),
    signal: vi.fn().mockResolvedValue({ action: "resumed" }),
    get: vi.fn().mockResolvedValue(null),
    cancel: vi.fn().mockResolvedValue(true),
    reopen: vi.fn().mockResolvedValue({ action: "reopened" }),
    list: vi.fn().mockResolvedValue([]),
    startWorker: vi.fn(),
    stopWorker: vi.fn().mockResolvedValue(undefined),
    getWorkerStatus: vi.fn().mockReturnValue(null),
    findActiveForTask: vi.fn().mockResolvedValue(null),
  };
}

const slackReplyContext: ReplyContext = {
  channel: "slack",
  teamId: "T123",
  channelId: "C456",
  threadTs: "1234.5678",
};

const linearReplyContext: ReplyContext = {
  channel: "linear",
  issueId: "issue-uuid-123",
};

function createDeps(overrides?: Partial<EventRouterDeps>): {
  deps: EventRouterDeps;
  executor: ConversationExecutor;
} {
  const executor = createMockExecutor();
  const deps: EventRouterDeps = {
    executor,
    logger: createMockLogger(),
    ...overrides,
  };
  // Use the override executor if provided
  return { deps, executor: overrides?.executor ?? executor };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("signal_conversation replyContext", () => {
  it("auto-injects eventReplyContext when LLM omits replyContext", async () => {
    const { deps, executor } = createDeps({
      eventReplyContext: slackReplyContext,
    });
    const tool = createSignalConversationTool(deps);

    await tool.execute({
      conversationId: "conv-test",
      signalType: "approval",
      payload: { approved: true },
      message: "Looks good",
      // No replyContext provided by LLM
    });

    expect(executor.signal).toHaveBeenCalledWith(
      "conv-test",
      expect.objectContaining({
        replyContext: slackReplyContext,
      }),
    );
  });

  it("uses LLM-provided replyContext over eventReplyContext", async () => {
    const { deps, executor } = createDeps({
      eventReplyContext: slackReplyContext,
    });
    const tool = createSignalConversationTool(deps);

    await tool.execute({
      conversationId: "conv-test",
      signalType: "user_reply",
      message: "Reply text",
      replyContext: linearReplyContext, // LLM explicitly provides Linear context
    });

    expect(executor.signal).toHaveBeenCalledWith(
      "conv-test",
      expect.objectContaining({
        replyContext: linearReplyContext,
      }),
    );

    // Verify Slack context was NOT used
    const signalArg = vi.mocked(executor.signal).mock.calls[0]?.[1];
    expect(signalArg?.replyContext).toEqual(linearReplyContext);
    expect(signalArg?.replyContext).not.toEqual(slackReplyContext);
  });

  it("omits replyContext from signal when neither LLM nor deps provides it", async () => {
    const { deps, executor } = createDeps({
      // No eventReplyContext
    });
    const tool = createSignalConversationTool(deps);

    await tool.execute({
      conversationId: "conv-test",
      signalType: "pr_review",
      payload: { status: "approved" },
      // No replyContext from LLM
    });

    expect(executor.signal).toHaveBeenCalled();
    const signalArg = vi.mocked(executor.signal).mock.calls[0]?.[1];
    // replyContext should NOT be a property of the signal object
    expect(signalArg).toBeDefined();
    expect(signalArg != null && "replyContext" in signalArg).toBe(false);
  });

  it("validates replyContext with ReplyContextSchema (rejects invalid)", async () => {
    const { deps } = createDeps();
    const tool = createSignalConversationTool(deps);

    const result = await tool.execute({
      conversationId: "conv-test",
      signalType: "approval",
      replyContext: { channel: "invalid" }, // Invalid discriminator value
    });

    expect(result.isError).toBe(true);
  });

  it("includes replyContext in signal alongside existing fields", async () => {
    const { deps, executor } = createDeps({
      eventReplyContext: slackReplyContext,
    });
    const tool = createSignalConversationTool(deps);

    await tool.execute({
      conversationId: "conv-full",
      signalType: "pr_merged",
      payload: { prNumber: 42 },
      message: "PR merged successfully",
    });

    expect(executor.signal).toHaveBeenCalledWith("conv-full", {
      type: "pr_merged",
      data: { prNumber: 42 },
      message: "PR merged successfully",
      source: "router",
      replyContext: slackReplyContext,
    });
  });
});
