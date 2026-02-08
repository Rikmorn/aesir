/**
 * Start Conversation Tool Tests
 *
 * Tests for replyContext auto-injection and override in start_conversation:
 * - Auto-injects eventReplyContext from deps when LLM omits replyContext
 * - LLM-provided replyContext overrides eventReplyContext
 * - Omits replyContext from start params when neither LLM nor deps provides it
 */

import type { PinoLogger } from "@aesir/platform";
import { describe, expect, it, vi } from "vitest";
import type { ConversationExecutor } from "../../framework/types.js";
import type { ReplyContext } from "../../shared/communication/types.js";
import type { EventRouterDeps } from "../types.js";
import { createStartConversationTool } from "./start-conversation.js";

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
  return { deps, executor: overrides?.executor ?? executor };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("start_conversation replyContext", () => {
  it("auto-injects eventReplyContext when LLM omits replyContext", async () => {
    const { deps, executor } = createDeps({
      eventReplyContext: slackReplyContext,
    });
    const tool = createStartConversationTool(deps);

    await tool.execute({
      agentDefinitionId: "dev-agent",
      correlationKey: "AES-42",
      input: { issueId: "AES-42", title: "Fix bug" },
      // No replyContext from LLM
    });

    expect(executor.start).toHaveBeenCalledWith(
      expect.objectContaining({
        replyContext: slackReplyContext,
      }),
    );
  });

  it("uses LLM-provided replyContext over eventReplyContext", async () => {
    const { deps, executor } = createDeps({
      eventReplyContext: slackReplyContext,
    });
    const tool = createStartConversationTool(deps);

    await tool.execute({
      agentDefinitionId: "product-agent",
      correlationKey: "thread-123",
      input: { threadTs: "123.456" },
      replyContext: linearReplyContext, // LLM explicitly provides Linear context
    });

    expect(executor.start).toHaveBeenCalledWith(
      expect.objectContaining({
        replyContext: linearReplyContext,
      }),
    );

    // Verify Slack context was NOT used
    const startArg = vi.mocked(executor.start).mock.calls[0]?.[0];
    expect(startArg?.replyContext).toEqual(linearReplyContext);
    expect(startArg?.replyContext).not.toEqual(slackReplyContext);
  });

  it("omits replyContext from start params when neither LLM nor deps provides it", async () => {
    const { deps, executor } = createDeps({
      // No eventReplyContext
    });
    const tool = createStartConversationTool(deps);

    await tool.execute({
      agentDefinitionId: "dev-agent",
      correlationKey: "AES-99",
      input: { issueId: "AES-99" },
      // No replyContext from LLM
    });

    expect(executor.start).toHaveBeenCalled();
    const startArg = vi.mocked(executor.start).mock.calls[0]?.[0];
    expect(startArg).toBeDefined();
    // replyContext should NOT be a property of the start params
    expect(startArg != null && "replyContext" in startArg).toBe(false);
  });
});
