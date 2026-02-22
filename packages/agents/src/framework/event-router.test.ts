/**
 * EventRouter Tests
 *
 * Comprehensive tests for the EventRouter routing logic:
 * - Start routing via AgentRegistry triggers
 * - Signal routing via SIGNAL_AGENT_MAP
 * - Ignore routing via IGNORE_EVENT_TYPES
 * - Slow-path fallback for unrecognized events
 * - Edge cases (missing correlationKey, deduplicationId propagation)
 */

import type { PinoLogger } from "@aesir/platform";
import { describe, expect, it, vi } from "vitest";
import type { IncomingEvent } from "../adapters/types.js";
import { createEventRouter } from "./event-router.js";
import type { AgentDefinition, AgentRegistry } from "./types.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function createMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn().mockReturnThis(),
    level: "info",
    silent: vi.fn(),
  };
}

function createMockRegistry(definitions: AgentDefinition[]): AgentRegistry {
  return {
    get: vi.fn(
      async (id: string) => definitions.find((d) => d.id === id) ?? null,
    ),
    list: vi.fn(async () => definitions),
  };
}

/** Minimal AgentDefinition factory for testing */
function makeDefinition(
  overrides: Partial<AgentDefinition> & { id: string },
): AgentDefinition {
  return {
    name: overrides.id,
    description: `Test agent: ${overrides.id}`,
    version: "1.0",
    model: "claude-sonnet-4-20250514",
    tools: ["codebase:read_file"],
    maxIterations: 50,
    tokenBudget: 100000,
    history: {
      pruneThreshold: 40,
      protectedMessages: 4,
      summaryThreshold: 30,
      summaryModel: "claude-sonnet-4-20250514",
    },
    systemPrompt: "Test prompt",
    ...overrides,
  };
}

function makeEvent(
  overrides: Partial<IncomingEvent> & { type: string },
): IncomingEvent {
  return {
    data: {},
    source: "test",
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("EventRouter", () => {
  const devAgent = makeDefinition({
    id: "dev-agent",
    triggers: [{ event: "linear.agent_session.created" }],
  });

  const productAgent = makeDefinition({
    id: "product-agent",
    triggers: [{ event: "slack.app_mention.created" }],
  });

  const definitions = [devAgent, productAgent];

  async function createRouter() {
    const logger = createMockLogger();
    const registry = createMockRegistry(definitions);
    const router = createEventRouter({
      agentRegistry: registry,
      logger: logger as unknown as PinoLogger,
    });
    await router.loadStartRules();
    return { router, logger, registry };
  }

  // ── Start Routing ──────────────────────────────────────────────────────

  describe("start routing", () => {
    it("routes linear.agent_session.created to dev-agent", async () => {
      const { router } = await createRouter();

      const result = router.handle(
        makeEvent({
          type: "linear.agent_session.created",
          correlationKey: "ISSUE-123",
          source: "linear:webhook",
          data: { issueId: "ISSUE-123" },
        }),
      );

      expect(result).toEqual({
        action: "start",
        agentDefinitionId: "dev-agent",
        conversationId: "dev-agent-ISSUE-123",
        correlationKey: "ISSUE-123",
        message: '{"issueId":"ISSUE-123"}',
        event: expect.objectContaining({
          type: "linear.agent_session.created",
        }),
      });
    });

    it("routes slack.app_mention.created to product-agent", async () => {
      const { router } = await createRouter();

      const result = router.handle(
        makeEvent({
          type: "slack.app_mention.created",
          correlationKey: "1234567890.123456",
          source: "slack:webhook",
          data: { threadTs: "1234567890.123456" },
        }),
      );

      expect(result).toEqual({
        action: "start",
        agentDefinitionId: "product-agent",
        conversationId: "product-agent-1234567890.123456",
        correlationKey: "1234567890.123456",
        message: '{"threadTs":"1234567890.123456"}',
        event: expect.objectContaining({ type: "slack.app_mention.created" }),
      });
    });

    it("uses event.message when available instead of JSON.stringify(data)", async () => {
      const { router } = await createRouter();

      const result = router.handle(
        makeEvent({
          type: "linear.agent_session.created",
          correlationKey: "ISSUE-456",
          source: "linear:webhook",
          data: { issueId: "ISSUE-456" },
          message: "Work on ISSUE-456: Fix login bug",
        }),
      );

      expect(result).toEqual(
        expect.objectContaining({
          action: "start",
          message: "Work on ISSUE-456: Fix login bug",
        }),
      );
    });

    it("falls to slow_path when start event has no correlationKey", async () => {
      const { router, logger } = await createRouter();

      const event = makeEvent({
        type: "linear.agent_session.created",
        source: "linear:webhook",
        data: { issueId: "ISSUE-123" },
      });
      const result = router.handle(event);

      expect(result).toEqual({ action: "slow_path", event });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "linear.agent_session.created",
          agentDefinitionId: "dev-agent",
        }),
        expect.stringContaining("missing correlationKey"),
      );
    });

    it("includes event reference in start result for enrichment", async () => {
      const { router } = await createRouter();

      const event = makeEvent({
        type: "linear.agent_session.created",
        correlationKey: "ISSUE-789",
        source: "linear:webhook",
        data: { issueId: "ISSUE-789", title: "Test issue" },
      });
      const result = router.handle(event);

      expect(result.action).toBe("start");
      if (result.action === "start") {
        expect(result.event).toBe(event);
      }
    });
  });

  // ── Signal Routing ─────────────────────────────────────────────────────

  describe("signal routing", () => {
    it("routes approval signal to dev-agent conversation", async () => {
      const { router } = await createRouter();

      const result = router.handle(
        makeEvent({
          type: "approval",
          correlationKey: "ISSUE-123",
          source: "slack:webhook",
          data: { approved: true, reviewer: "user1" },
          message: "Approved by user1",
        }),
      );

      expect(result).toEqual({
        action: "signal",
        conversationId: "dev-agent-ISSUE-123",
        signal: {
          type: "approval",
          data: { approved: true, reviewer: "user1" },
          message: "Approved by user1",
          source: "slack:webhook",
          deduplicationId: undefined,
        },
        event: expect.objectContaining({ type: "approval" }),
      });
    });

    it("routes pr_merged signal to dev-agent conversation", async () => {
      const { router } = await createRouter();

      const result = router.handle(
        makeEvent({
          type: "pr_merged",
          correlationKey: "ABC-456",
          source: "github:webhook",
          data: { prNumber: 42 },
        }),
      );

      expect(result).toEqual(
        expect.objectContaining({
          action: "signal",
          conversationId: "dev-agent-ABC-456",
        }),
      );
      if (result.action === "signal") {
        expect(result.signal.type).toBe("pr_merged");
      }
    });

    it("routes pr_closed signal to dev-agent conversation", async () => {
      const { router } = await createRouter();

      const result = router.handle(
        makeEvent({
          type: "pr_closed",
          correlationKey: "ABC-456",
          source: "github:webhook",
          data: { prNumber: 42 },
        }),
      );

      expect(result).toEqual(
        expect.objectContaining({
          action: "signal",
          conversationId: "dev-agent-ABC-456",
        }),
      );
      if (result.action === "signal") {
        expect(result.signal.type).toBe("pr_closed");
      }
    });

    it("routes pr_review signal to dev-agent conversation", async () => {
      const { router } = await createRouter();

      const result = router.handle(
        makeEvent({
          type: "pr_review",
          correlationKey: "DEF-789",
          source: "github:webhook",
          data: { reviewId: "r1" },
        }),
      );

      expect(result).toEqual(
        expect.objectContaining({
          action: "signal",
          conversationId: "dev-agent-DEF-789",
        }),
      );
    });

    it("routes escalation_resolved signal to dev-agent conversation", async () => {
      const { router } = await createRouter();

      const result = router.handle(
        makeEvent({
          type: "escalation_resolved",
          correlationKey: "ISSUE-789",
          source: "slack:webhook",
          data: { resolution: "retry" },
        }),
      );

      expect(result).toEqual(
        expect.objectContaining({
          action: "signal",
          conversationId: "dev-agent-ISSUE-789",
        }),
      );
      if (result.action === "signal") {
        expect(result.signal.type).toBe("escalation_resolved");
      }
    });

    it("routes user_reply signal to product-agent conversation", async () => {
      const { router } = await createRouter();

      const result = router.handle(
        makeEvent({
          type: "user_reply",
          correlationKey: "1234567890.123456",
          source: "slack:webhook",
          data: { text: "Yes, proceed" },
        }),
      );

      expect(result).toEqual(
        expect.objectContaining({
          action: "signal",
          conversationId: "product-agent-1234567890.123456",
        }),
      );
      if (result.action === "signal") {
        expect(result.signal.type).toBe("user_reply");
      }
    });

    it("routes cancel signal to dev-agent conversation", async () => {
      const { router } = await createRouter();

      const result = router.handle(
        makeEvent({
          type: "cancel",
          correlationKey: "ISSUE-999",
          source: "slack:webhook",
          data: { reason: "admin" },
        }),
      );

      expect(result).toEqual(
        expect.objectContaining({
          action: "signal",
          conversationId: "dev-agent-ISSUE-999",
        }),
      );
      if (result.action === "signal") {
        expect(result.signal.type).toBe("cancel");
      }
    });

    it("falls to slow_path when signal event has no correlationKey", async () => {
      const { router, logger } = await createRouter();

      const event = makeEvent({
        type: "approval",
        source: "slack:webhook",
        data: { approved: true },
      });
      const result = router.handle(event);

      expect(result).toEqual({ action: "slow_path", event });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "approval",
          signalAgentId: "dev-agent",
        }),
        expect.stringContaining("missing correlationKey"),
      );
    });

    it("includes deduplicationId in signal payload", async () => {
      const { router } = await createRouter();

      const result = router.handle(
        makeEvent({
          type: "approval",
          correlationKey: "ISSUE-123",
          source: "slack:webhook",
          data: { approved: true },
          deduplicationId: "webhook-delivery-abc123",
        }),
      );

      expect(result.action).toBe("signal");
      if (result.action === "signal") {
        expect(result.signal.deduplicationId).toBe("webhook-delivery-abc123");
      }
    });

    it("includes message in signal payload", async () => {
      const { router } = await createRouter();

      const result = router.handle(
        makeEvent({
          type: "approval",
          correlationKey: "ISSUE-123",
          source: "slack:webhook",
          data: { approved: true },
          message: "Plan approved by @reviewer",
        }),
      );

      expect(result.action).toBe("signal");
      if (result.action === "signal") {
        expect(result.signal.message).toBe("Plan approved by @reviewer");
      }
    });

    it("signal route includes replyContext from IncomingEvent", async () => {
      const { router } = await createRouter();

      const result = router.handle(
        makeEvent({
          type: "approval",
          correlationKey: "ISSUE-123",
          source: "slack:webhook",
          data: { approved: true },
          replyContext: {
            channel: "slack",
            teamId: "T1",
            channelId: "C1",
          },
        }),
      );

      expect(result.action).toBe("signal");
      if (result.action === "signal") {
        expect(result.signal.replyContext).toEqual({
          channel: "slack",
          teamId: "T1",
          channelId: "C1",
        });
      }
    });

    it("signal route works without replyContext (backward compatible)", async () => {
      const { router } = await createRouter();

      const result = router.handle(
        makeEvent({
          type: "approval",
          correlationKey: "ISSUE-123",
          source: "slack:webhook",
          data: { approved: true },
        }),
      );

      expect(result.action).toBe("signal");
      if (result.action === "signal") {
        expect(result.signal.replyContext).toBeUndefined();
      }
    });

    it("includes event reference in signal result", async () => {
      const { router } = await createRouter();

      const event = makeEvent({
        type: "approval",
        correlationKey: "ISSUE-123",
        source: "slack:webhook",
        data: { approved: true },
      });
      const result = router.handle(event);

      expect(result.action).toBe("signal");
      if (result.action === "signal") {
        expect(result.event).toBe(event);
      }
    });
  });

  // ── Ignore Routing ─────────────────────────────────────────────────────

  describe("ignore routing", () => {
    it("ignores linear.issue.created events", async () => {
      const { router } = await createRouter();

      const result = router.handle(
        makeEvent({
          type: "linear.issue.created",
          source: "linear:webhook",
          data: { issueId: "ISSUE-100" },
        }),
      );

      expect(result).toEqual({
        action: "ignore",
        reason: "Event type explicitly ignored: linear.issue.created",
      });
    });

    it("ignores linear.issue.updated events", async () => {
      const { router } = await createRouter();

      const result = router.handle(
        makeEvent({
          type: "linear.issue.updated",
          source: "linear:webhook",
          data: { issueId: "ISSUE-100" },
        }),
      );

      expect(result).toEqual({
        action: "ignore",
        reason: "Event type explicitly ignored: linear.issue.updated",
      });
    });

    it("ignore takes priority over start rules (if event type were in both)", async () => {
      // Ignore is checked before start rules -- important ordering guarantee
      const { router } = await createRouter();

      // linear.issue.created is in IGNORE_EVENT_TYPES -- even if it were
      // somehow also in start rules, it should be ignored
      const result = router.handle(
        makeEvent({
          type: "linear.issue.created",
          correlationKey: "ISSUE-123",
          source: "linear:webhook",
          data: {},
        }),
      );

      expect(result.action).toBe("ignore");
    });
  });

  // ── Schedule Trigger Routing ───────────────────────────────────────────

  describe("schedule.triggered routing", () => {
    it("routes schedule.triggered with valid agentId and correlationKey to start", async () => {
      const { router } = await createRouter();

      const result = router.handle(
        makeEvent({
          type: "schedule.triggered",
          source: "scheduler",
          correlationKey: "dev-agent:daily-standup",
          data: {
            agentId: "dev-agent",
            scheduleName: "daily-standup",
            cron: "0 9 * * *",
          },
          message: "Scheduled run: daily-standup",
        }),
      );

      expect(result).toEqual({
        action: "start",
        agentDefinitionId: "dev-agent",
        conversationId: "dev-agent-dev-agent:daily-standup",
        correlationKey: "dev-agent:daily-standup",
        message: "Scheduled run: daily-standup",
        event: expect.objectContaining({ type: "schedule.triggered" }),
      });
    });

    it("returns ignore when schedule.triggered is missing agentId", async () => {
      const { router } = await createRouter();

      const result = router.handle(
        makeEvent({
          type: "schedule.triggered",
          source: "scheduler",
          correlationKey: "some-key",
          data: { scheduleName: "daily-standup" },
        }),
      );

      expect(result).toEqual({
        action: "ignore",
        reason: "Malformed schedule.triggered event",
      });
    });

    it("returns ignore when schedule.triggered is missing correlationKey", async () => {
      const { router, logger } = await createRouter();

      const result = router.handle(
        makeEvent({
          type: "schedule.triggered",
          source: "scheduler",
          data: { agentId: "dev-agent", scheduleName: "daily-standup" },
        }),
      );

      expect(result).toEqual({
        action: "ignore",
        reason: "Malformed schedule.triggered event",
      });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ event: expect.any(Object) }),
        expect.stringContaining("missing agentId or correlationKey"),
      );
    });

    it("uses default message when event.message is not provided", async () => {
      const { router } = await createRouter();

      const result = router.handle(
        makeEvent({
          type: "schedule.triggered",
          source: "scheduler",
          correlationKey: "dev-agent:cleanup",
          data: { agentId: "dev-agent", scheduleName: "cleanup" },
        }),
      );

      expect(result.action).toBe("start");
      if (result.action === "start") {
        expect(result.message).toBe("Scheduled run");
      }
    });

    it("schedule.triggered takes priority over start rules (not in startRules map)", async () => {
      const { router } = await createRouter();

      // schedule.triggered is not in start rules -- it's handled by the special check
      // before start rules. Verify it still works.
      const result = router.handle(
        makeEvent({
          type: "schedule.triggered",
          source: "scheduler",
          correlationKey: "product-agent:weekly-report",
          data: { agentId: "product-agent", scheduleName: "weekly-report" },
          message: "Weekly report run",
        }),
      );

      expect(result).toEqual(
        expect.objectContaining({
          action: "start",
          agentDefinitionId: "product-agent",
          conversationId: "product-agent-product-agent:weekly-report",
        }),
      );
    });
  });

  // ── Slow-path Fallback ─────────────────────────────────────────────────

  describe("slow-path fallback", () => {
    it("returns slow_path for linear.comment.created (no matching rule)", async () => {
      const { router } = await createRouter();

      const event = makeEvent({
        type: "linear.comment.created",
        source: "linear:webhook",
        data: { commentId: "c1" },
        correlationKey: "ISSUE-123",
      });
      const result = router.handle(event);

      expect(result).toEqual({ action: "slow_path", event });
    });

    it("returns slow_path for completely unknown event types", async () => {
      const { router } = await createRouter();

      const event = makeEvent({
        type: "some.unknown.event",
        source: "unknown",
        data: {},
      });
      const result = router.handle(event);

      expect(result).toEqual({ action: "slow_path", event });
    });

    it("slow_path result includes original event", async () => {
      const { router } = await createRouter();

      const event = makeEvent({
        type: "jira.issue.created",
        source: "jira:webhook",
        data: { key: "PROJ-1" },
        correlationKey: "PROJ-1",
      });
      const result = router.handle(event);

      expect(result.action).toBe("slow_path");
      if (result.action === "slow_path") {
        expect(result.event).toBe(event);
      }
    });
  });

  // ── loadStartRules ─────────────────────────────────────────────────────

  describe("loadStartRules", () => {
    it("loads rules from AgentRegistry", async () => {
      const { registry } = await createRouter();
      expect(registry.list).toHaveBeenCalledTimes(1);
    });

    it("can be called multiple times to refresh rules", async () => {
      const logger = createMockLogger();
      const registry = createMockRegistry(definitions);
      const router = createEventRouter({
        agentRegistry: registry,
        logger: logger as unknown as PinoLogger,
      });

      await router.loadStartRules();
      await router.loadStartRules();

      expect(registry.list).toHaveBeenCalledTimes(2);
    });

    it("handles agents with no triggers gracefully", async () => {
      const logger = createMockLogger();
      const noTriggerAgent = makeDefinition({ id: "no-trigger-agent" });
      const registry = createMockRegistry([noTriggerAgent]);
      const router = createEventRouter({
        agentRegistry: registry,
        logger: logger as unknown as PinoLogger,
      });

      await router.loadStartRules();

      // No start rules loaded, everything goes to slow_path
      const result = router.handle(
        makeEvent({ type: "anything", source: "test", data: {} }),
      );
      expect(result.action).toBe("slow_path");
    });

    it("logs a warning on duplicate trigger events (first registration wins)", async () => {
      const logger = createMockLogger();
      const agent1 = makeDefinition({
        id: "agent-1",
        triggers: [{ event: "shared.event" }],
      });
      const agent2 = makeDefinition({
        id: "agent-2",
        triggers: [{ event: "shared.event" }],
      });
      const registry = createMockRegistry([agent1, agent2]);
      const router = createEventRouter({
        agentRegistry: registry,
        logger: logger as unknown as PinoLogger,
      });

      await router.loadStartRules();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "shared.event",
          existingAgent: "agent-1",
          newAgent: "agent-2",
        }),
        expect.stringContaining("Duplicate start rule"),
      );

      // First registration wins
      const result = router.handle(
        makeEvent({
          type: "shared.event",
          correlationKey: "key-1",
          source: "test",
          data: {},
        }),
      );
      expect(result.action).toBe("start");
      if (result.action === "start") {
        expect(result.agentDefinitionId).toBe("agent-1");
      }
    });

    it("refreshes rules on subsequent loadStartRules calls", async () => {
      const logger = createMockLogger();
      const agent1 = makeDefinition({
        id: "agent-1",
        triggers: [{ event: "event.a" }],
      });

      let currentDefs = [agent1];
      const registry: AgentRegistry = {
        get: vi.fn(async (id) => currentDefs.find((d) => d.id === id) ?? null),
        list: vi.fn(async () => currentDefs),
      };

      const router = createEventRouter({
        agentRegistry: registry,
        logger: logger as unknown as PinoLogger,
      });
      await router.loadStartRules();

      // event.a routes to agent-1
      const result1 = router.handle(
        makeEvent({
          type: "event.a",
          correlationKey: "k1",
          source: "test",
          data: {},
        }),
      );
      expect(result1.action).toBe("start");

      // Swap definitions
      const agent2 = makeDefinition({
        id: "agent-2",
        triggers: [{ event: "event.b" }],
      });
      currentDefs = [agent2];
      await router.loadStartRules();

      // event.a no longer routes to start
      const result2 = router.handle(
        makeEvent({
          type: "event.a",
          correlationKey: "k1",
          source: "test",
          data: {},
        }),
      );
      expect(result2.action).toBe("slow_path");

      // event.b now routes to agent-2
      const result3 = router.handle(
        makeEvent({
          type: "event.b",
          correlationKey: "k2",
          source: "test",
          data: {},
        }),
      );
      expect(result3.action).toBe("start");
      if (result3.action === "start") {
        expect(result3.agentDefinitionId).toBe("agent-2");
      }
    });
  });
});
