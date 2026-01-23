/**
 * Slack Event Handler Tests
 *
 * Tests for event handling with deduplication and filtering.
 * Uses mocked event delivery store to verify deduplication logic.
 */

import { okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

// Mock @aesir/common to prevent config validation
vi.mock("@aesir/common", () => ({
  createId: {
    credential: vi.fn(() => "cred_test123"),
    webhookDelivery: vi.fn(() => "del_test123"),
  },
  createPinoLogger: vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    child: vi.fn().mockReturnThis(),
  })),
  AppError: class AppError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));

import type { SlackEventDeliveryStore } from "../db/event-delivery-store.js";
// Import after mocking
import { createEventHandler } from "./handler.js";

// Mock logger
const createMockLogger = () => ({
  info: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  child: vi.fn(() => createMockLogger()),
});

// Mock delivery store factory
const createMockDeliveryStore = (
  overrides: Partial<SlackEventDeliveryStore> = {},
): SlackEventDeliveryStore => ({
  isDeliveryProcessed: vi.fn().mockReturnValue(okAsync(false)),
  recordDelivery: vi.fn().mockReturnValue(okAsync("del_123")),
  ...overrides,
});

describe("createEventHandler", () => {
  it("requires deliveryStore dependency", () => {
    expect(() => {
      createEventHandler({
        // @ts-expect-error - Testing missing dependency
        deliveryStore: undefined,
        logger: createMockLogger() as never,
      });
    }).toThrow("deliveryStore is required");
  });

  it("requires logger dependency", () => {
    expect(() => {
      createEventHandler({
        deliveryStore: createMockDeliveryStore(),
        // @ts-expect-error - Testing missing dependency
        logger: undefined,
      });
    }).toThrow("logger is required");
  });
});

describe("EventHandler.handleEvent", () => {
  it("returns null for duplicate event", async () => {
    const mockStore = createMockDeliveryStore({
      isDeliveryProcessed: vi.fn().mockReturnValue(okAsync(true)),
    });
    const mockLogger = createMockLogger();

    const handler = createEventHandler({
      deliveryStore: mockStore,
      logger: mockLogger as never,
    });

    const payload = {
      type: "app_mention",
      event_id: "Ev123456",
      event_time: 1234567890,
      team_id: "T1234",
      user: "U1234",
      text: "hello",
      ts: "1234567890.123456",
      channel: "C1234",
    };

    const result = await handler.handleEvent(payload);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBeNull();
    }

    // Verify duplicate check was called
    expect(mockStore.isDeliveryProcessed).toHaveBeenCalledWith("Ev123456");
    // recordDelivery should NOT be called for duplicates
    expect(mockStore.recordDelivery).not.toHaveBeenCalled();
  });

  it("processes new event and records delivery", async () => {
    const mockStore = createMockDeliveryStore();
    const mockLogger = createMockLogger();

    const handler = createEventHandler({
      deliveryStore: mockStore,
      logger: mockLogger as never,
    });

    const payload = {
      type: "app_mention",
      event_id: "Ev123456",
      event_time: 1234567890,
      team_id: "T1234",
      user: "U1234",
      text: "<@UBOT> hello",
      ts: "1234567890.123456",
      channel: "C1234",
    };

    const result = await handler.handleEvent(payload);

    expect(result.isOk()).toBe(true);
    if (result.isOk() && result.value !== null) {
      expect(result.value.eventId).toBe("Ev123456");
      expect(result.value.eventType).toBe("app_mention");
      expect(result.value.userId).toBe("U1234");
      expect(result.value.text).toBe("<@UBOT> hello");
    }

    // Verify delivery was recorded
    expect(mockStore.recordDelivery).toHaveBeenCalledWith({
      eventId: "Ev123456",
      eventType: "app_mention",
      teamId: "T1234",
    });
  });

  it("filters out bot_message subtype", async () => {
    const mockStore = createMockDeliveryStore();
    const mockLogger = createMockLogger();

    const handler = createEventHandler({
      deliveryStore: mockStore,
      logger: mockLogger as never,
    });

    const payload = {
      type: "message",
      event_id: "Ev123456",
      event_time: 1234567890,
      team_id: "T1234",
      subtype: "bot_message",
      text: "Bot says hello",
      ts: "1234567890.123456",
      channel: "C1234",
    };

    const result = await handler.handleEvent(payload);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      // bot_message is filtered - returns null
      expect(result.value).toBeNull();
    }

    // Delivery should still be recorded to prevent re-processing
    expect(mockStore.recordDelivery).toHaveBeenCalled();
  });

  it("filters out message_changed subtype", async () => {
    const mockStore = createMockDeliveryStore();
    const mockLogger = createMockLogger();

    const handler = createEventHandler({
      deliveryStore: mockStore,
      logger: mockLogger as never,
    });

    const payload = {
      type: "message",
      event_id: "Ev789",
      event_time: 1234567890,
      team_id: "T1234",
      subtype: "message_changed",
      user: "U1234",
      text: "Edited message",
      ts: "1234567890.123456",
      channel: "C1234",
    };

    const result = await handler.handleEvent(payload);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBeNull();
    }
  });

  it("filters out message_deleted subtype", async () => {
    const mockStore = createMockDeliveryStore();
    const mockLogger = createMockLogger();

    const handler = createEventHandler({
      deliveryStore: mockStore,
      logger: mockLogger as never,
    });

    const payload = {
      type: "message",
      event_id: "Ev999",
      event_time: 1234567890,
      team_id: "T1234",
      subtype: "message_deleted",
      user: "U1234",
      text: "",
      ts: "1234567890.123456",
      channel: "C1234",
    };

    const result = await handler.handleEvent(payload);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBeNull();
    }
  });

  it("processes regular message without subtype", async () => {
    const mockStore = createMockDeliveryStore();
    const mockLogger = createMockLogger();

    const handler = createEventHandler({
      deliveryStore: mockStore,
      logger: mockLogger as never,
    });

    const payload = {
      type: "message",
      event_id: "Ev123456",
      event_time: 1234567890,
      team_id: "T1234",
      user: "U1234",
      text: "Hello world",
      ts: "1234567890.123456",
      channel: "C1234",
    };

    const result = await handler.handleEvent(payload);

    expect(result.isOk()).toBe(true);
    if (result.isOk() && result.value !== null) {
      expect(result.value.eventType).toBe("message");
      expect(result.value.text).toBe("Hello world");
    }
  });

  it("processes block_actions event", async () => {
    const mockStore = createMockDeliveryStore();
    const mockLogger = createMockLogger();

    const handler = createEventHandler({
      deliveryStore: mockStore,
      logger: mockLogger as never,
    });

    const payload = {
      type: "block_actions",
      user: { id: "U1234", name: "testuser" },
      channel: { id: "C1234", name: "general" },
      message: { ts: "1234567890.123456" },
      actions: [{ type: "button", action_id: "approve_pr", value: "task_123" }],
      team: { id: "T1234" },
    };

    const result = await handler.handleEvent(payload);

    expect(result.isOk()).toBe(true);
    if (result.isOk() && result.value !== null) {
      expect(result.value.eventType).toBe("block_actions");
      expect(result.value.actions).toHaveLength(1);
      expect(result.value.actions?.[0]?.actionId).toBe("approve_pr");
    }
  });

  it("returns error for invalid payload", async () => {
    const mockStore = createMockDeliveryStore();
    const mockLogger = createMockLogger();

    const handler = createEventHandler({
      deliveryStore: mockStore,
      logger: mockLogger as never,
    });

    const payload = {
      type: "unknown_type",
      // Invalid payload
    };

    const result = await handler.handleEvent(payload);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe("INT_SLACK_EVENT");
    }
  });

  it("returns error for payload missing required fields", async () => {
    const mockStore = createMockDeliveryStore();
    const mockLogger = createMockLogger();

    const handler = createEventHandler({
      deliveryStore: mockStore,
      logger: mockLogger as never,
    });

    const payload = {
      type: "app_mention",
      // Missing required fields
    };

    const result = await handler.handleEvent(payload);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe("INT_SLACK_EVENT");
      // The error message is constructed from validation errors
      // Just verify we get a SlackError with the correct code
    }
  });
});

describe("EventHandler deduplication timing", () => {
  it("records delivery before filtering", async () => {
    const callOrder: string[] = [];

    const mockStore = createMockDeliveryStore({
      isDeliveryProcessed: vi.fn().mockImplementation(() => {
        callOrder.push("isDeliveryProcessed");
        return okAsync(false);
      }),
      recordDelivery: vi.fn().mockImplementation(() => {
        callOrder.push("recordDelivery");
        return okAsync("del_123");
      }),
    });
    const mockLogger = createMockLogger();

    const handler = createEventHandler({
      deliveryStore: mockStore,
      logger: mockLogger as never,
    });

    // Use a filterable message
    const payload = {
      type: "message",
      event_id: "Ev123456",
      event_time: 1234567890,
      team_id: "T1234",
      subtype: "bot_message",
      text: "Bot message",
      ts: "1234567890.123456",
      channel: "C1234",
    };

    await handler.handleEvent(payload);

    // Verify recordDelivery is called before filtering returns null
    expect(callOrder).toEqual(["isDeliveryProcessed", "recordDelivery"]);
  });
});
