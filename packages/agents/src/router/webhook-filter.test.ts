/**
 * Webhook Filter Tests
 *
 * Tests for the two-layer webhook filter:
 * - Layer 1: Delivery deduplication (stateful, via pg)
 * - Layer 2: Echo suppression (stateless, via actorInfo)
 * - Edge cases: missing fields, fail-open, layer ordering, DB errors
 */

import type { PinoLogger } from "@aesir/platform";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IncomingEvent } from "../adapters/types.js";
import { createWebhookFilter } from "./webhook-filter.js";

// ─── Mock Pool ──────────────────────────────────────────────────────────────

function createMockPool(rowCount = 1) {
  return {
    query: vi.fn().mockResolvedValue({ rowCount }),
  };
}

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

function createEvent(overrides: Partial<IncomingEvent> = {}): IncomingEvent {
  return {
    type: "linear.issue.created",
    data: {},
    source: "linear:webhook",
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("createWebhookFilter", () => {
  let mockPool: ReturnType<typeof createMockPool>;
  let mockLogger: PinoLogger;

  beforeEach(() => {
    mockPool = createMockPool(1);
    mockLogger = createMockLogger();
    vi.clearAllMocks();
  });

  describe("Layer 1: Delivery Dedup", () => {
    it("accepts first delivery (rowCount = 1)", async () => {
      const filter = createWebhookFilter({
        pool: mockPool as never,
        logger: mockLogger,
      });

      const result = await filter(
        createEvent({ deduplicationId: "delivery-123" }),
      );

      expect(result).toEqual({ action: "accept" });
      expect(mockPool.query).toHaveBeenCalledWith(
        "INSERT INTO agents.processed_webhook_events (event_id) VALUES ($1) ON CONFLICT DO NOTHING",
        ["linear:delivery-123"],
      );
    });

    it("suppresses duplicate delivery (rowCount = 0)", async () => {
      mockPool = createMockPool(0);
      const filter = createWebhookFilter({
        pool: mockPool as never,
        logger: mockLogger,
      });

      const result = await filter(
        createEvent({ deduplicationId: "delivery-123" }),
      );

      expect(result).toEqual({ action: "suppress", reason: "duplicate" });
      expect(mockLogger.debug).toHaveBeenCalledWith(
        {
          eventId: "linear:delivery-123",
          eventType: "linear.issue.created",
          reason: "duplicate",
        },
        "event suppressed",
      );
    });

    it("skips dedup layer when no deduplicationId", async () => {
      const filter = createWebhookFilter({
        pool: mockPool as never,
        logger: mockLogger,
      });

      const result = await filter(createEvent());

      expect(result).toEqual({ action: "accept" });
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it("throws on DB error (does not silently accept)", async () => {
      mockPool.query.mockRejectedValue(new Error("connection refused"));
      const filter = createWebhookFilter({
        pool: mockPool as never,
        logger: mockLogger,
      });

      await expect(
        filter(createEvent({ deduplicationId: "delivery-123" })),
      ).rejects.toThrow("connection refused");
    });
  });

  describe("Layer 1: Source namespacing", () => {
    it('namespaces with "linear" from "linear:webhook"', async () => {
      const filter = createWebhookFilter({
        pool: mockPool as never,
        logger: mockLogger,
      });

      await filter(
        createEvent({
          source: "linear:webhook",
          deduplicationId: "abc-123",
        }),
      );

      expect(mockPool.query).toHaveBeenCalledWith(expect.any(String), [
        "linear:abc-123",
      ]);
    });

    it('namespaces with "github" from "github:webhook"', async () => {
      const filter = createWebhookFilter({
        pool: mockPool as never,
        logger: mockLogger,
      });

      await filter(
        createEvent({
          source: "github:webhook",
          deduplicationId: "def-456",
        }),
      );

      expect(mockPool.query).toHaveBeenCalledWith(expect.any(String), [
        "github:def-456",
      ]);
    });

    it("uses full source when no colon present", async () => {
      const filter = createWebhookFilter({
        pool: mockPool as never,
        logger: mockLogger,
      });

      await filter(
        createEvent({
          source: "passthrough",
          deduplicationId: "evt-789",
        }),
      );

      expect(mockPool.query).toHaveBeenCalledWith(expect.any(String), [
        "passthrough:evt-789",
      ]);
    });
  });

  describe("Layer 2: Echo Suppression", () => {
    it("suppresses events from bot actors", async () => {
      const filter = createWebhookFilter({
        pool: mockPool as never,
        logger: mockLogger,
      });

      const result = await filter(
        createEvent({
          actorInfo: { isBot: true, identifier: "aesir-bot" },
        }),
      );

      expect(result).toEqual({ action: "suppress", reason: "agent_echo" });
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "agent_echo" }),
        "event suppressed",
      );
    });

    it("accepts events when actorInfo.isBot is false", async () => {
      const filter = createWebhookFilter({
        pool: mockPool as never,
        logger: mockLogger,
      });

      const result = await filter(
        createEvent({
          actorInfo: { isBot: false, identifier: "human-user" },
        }),
      );

      expect(result).toEqual({ action: "accept" });
    });

    it("accepts events with no actorInfo (fail-open)", async () => {
      const filter = createWebhookFilter({
        pool: mockPool as never,
        logger: mockLogger,
      });

      const result = await filter(createEvent());

      expect(result).toEqual({ action: "accept" });
    });
  });

  describe("Layer ordering", () => {
    it("checks dedup before echo (duplicate takes precedence)", async () => {
      mockPool = createMockPool(0); // duplicate
      const filter = createWebhookFilter({
        pool: mockPool as never,
        logger: mockLogger,
      });

      const result = await filter(
        createEvent({
          deduplicationId: "delivery-123",
          actorInfo: { isBot: true, identifier: "bot" },
        }),
      );

      // Should return 'duplicate', not 'agent_echo'
      expect(result).toEqual({ action: "suppress", reason: "duplicate" });
    });

    it("reaches echo layer after dedup passes", async () => {
      mockPool = createMockPool(1); // not duplicate
      const filter = createWebhookFilter({
        pool: mockPool as never,
        logger: mockLogger,
      });

      const result = await filter(
        createEvent({
          deduplicationId: "delivery-123",
          actorInfo: { isBot: true, identifier: "bot" },
        }),
      );

      // Dedup passed (rowCount=1), echo layer catches it
      expect(result).toEqual({ action: "suppress", reason: "agent_echo" });
    });
  });
});
