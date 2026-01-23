/**
 * MCP Tool Schema Tests for Slack Integration
 *
 * Tests Zod schema validation for Slack MCP tools.
 * Validates input boundary conditions: required fields, optional fields, min lengths, default values.
 */

import { describe, expect, it } from "vitest";
import {
  GetMessageInputSchema,
  ListChannelsInputSchema,
  ReplyToThreadInputSchema,
  SendApprovalRequestInputSchema,
  SendMessageInputSchema,
} from "./schemas.js";

describe("Slack MCP Tool Schemas", () => {
  describe("SendMessageInputSchema", () => {
    it("should accept valid minimal input", () => {
      const result = SendMessageInputSchema.safeParse({
        channel: "C1234567890",
        text: "Hello, world!",
      });
      expect(result.success).toBe(true);
    });

    it("should accept valid input with blocks", () => {
      const result = SendMessageInputSchema.safeParse({
        channel: "C1234567890",
        text: "Fallback text",
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: "Hello *world*" },
          },
        ],
      });
      expect(result.success).toBe(true);
    });

    it("should accept valid input with threadTs", () => {
      const result = SendMessageInputSchema.safeParse({
        channel: "C1234567890",
        text: "Reply in thread",
        threadTs: "1234567890.123456",
      });
      expect(result.success).toBe(true);
    });

    it("should reject missing channel", () => {
      const result = SendMessageInputSchema.safeParse({
        text: "Hello, world!",
      });
      expect(result.success).toBe(false);
    });

    it("should reject missing text", () => {
      const result = SendMessageInputSchema.safeParse({
        channel: "C1234567890",
      });
      expect(result.success).toBe(false);
    });

    it("should reject empty text", () => {
      const result = SendMessageInputSchema.safeParse({
        channel: "C1234567890",
        text: "",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("SendApprovalRequestInputSchema", () => {
    it("should accept valid minimal input", () => {
      const result = SendApprovalRequestInputSchema.safeParse({
        channel: "C1234567890",
        taskId: "ABC-123",
        title: "Add user authentication",
        summary: "Implements JWT-based auth",
      });
      expect(result.success).toBe(true);
    });

    it("should accept valid input with prUrl", () => {
      const result = SendApprovalRequestInputSchema.safeParse({
        channel: "C1234567890",
        taskId: "ABC-123",
        title: "Add user authentication",
        summary: "Implements JWT-based auth",
        prUrl: "https://github.com/org/repo/pull/42",
      });
      expect(result.success).toBe(true);
    });

    it("should default actionPrefix to approve", () => {
      const result = SendApprovalRequestInputSchema.safeParse({
        channel: "C1234567890",
        taskId: "ABC-123",
        title: "Add user authentication",
        summary: "Implements JWT-based auth",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.actionPrefix).toBe("approve");
      }
    });

    it("should accept custom actionPrefix", () => {
      const result = SendApprovalRequestInputSchema.safeParse({
        channel: "C1234567890",
        taskId: "ABC-123",
        title: "Add user authentication",
        summary: "Implements JWT-based auth",
        actionPrefix: "custom",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.actionPrefix).toBe("custom");
      }
    });

    it("should reject invalid prUrl", () => {
      const result = SendApprovalRequestInputSchema.safeParse({
        channel: "C1234567890",
        taskId: "ABC-123",
        title: "Add user authentication",
        summary: "Implements JWT-based auth",
        prUrl: "not-a-url",
      });
      expect(result.success).toBe(false);
    });

    it("should reject missing required fields", () => {
      const result = SendApprovalRequestInputSchema.safeParse({
        channel: "C1234567890",
        taskId: "ABC-123",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("GetMessageInputSchema", () => {
    it("should accept valid input", () => {
      const result = GetMessageInputSchema.safeParse({
        channel: "C1234567890",
        ts: "1234567890.123456",
      });
      expect(result.success).toBe(true);
    });

    it("should reject missing channel", () => {
      const result = GetMessageInputSchema.safeParse({
        ts: "1234567890.123456",
      });
      expect(result.success).toBe(false);
    });

    it("should reject missing ts", () => {
      const result = GetMessageInputSchema.safeParse({
        channel: "C1234567890",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("ReplyToThreadInputSchema", () => {
    it("should accept valid minimal input", () => {
      const result = ReplyToThreadInputSchema.safeParse({
        channel: "C1234567890",
        threadTs: "1234567890.123456",
        text: "Reply text",
      });
      expect(result.success).toBe(true);
    });

    it("should accept valid input with blocks", () => {
      const result = ReplyToThreadInputSchema.safeParse({
        channel: "C1234567890",
        threadTs: "1234567890.123456",
        text: "Fallback text",
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: "Reply *message*" },
          },
        ],
      });
      expect(result.success).toBe(true);
    });

    it("should reject empty text", () => {
      const result = ReplyToThreadInputSchema.safeParse({
        channel: "C1234567890",
        threadTs: "1234567890.123456",
        text: "",
      });
      expect(result.success).toBe(false);
    });

    it("should reject missing threadTs", () => {
      const result = ReplyToThreadInputSchema.safeParse({
        channel: "C1234567890",
        text: "Reply text",
      });
      expect(result.success).toBe(false);
    });

    it("should reject missing channel", () => {
      const result = ReplyToThreadInputSchema.safeParse({
        threadTs: "1234567890.123456",
        text: "Reply text",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("ListChannelsInputSchema", () => {
    it("should accept empty object with defaults", () => {
      const result = ListChannelsInputSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.types).toBe("public_channel,private_channel");
        expect(result.data.limit).toBe(100);
        expect(result.data.excludeArchived).toBe(true);
      }
    });

    it("should accept custom types", () => {
      const result = ListChannelsInputSchema.safeParse({
        types: "public_channel",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.types).toBe("public_channel");
      }
    });

    it("should accept custom limit within bounds", () => {
      const result = ListChannelsInputSchema.safeParse({
        limit: 50,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.limit).toBe(50);
      }
    });

    it("should reject limit less than 1", () => {
      const result = ListChannelsInputSchema.safeParse({
        limit: 0,
      });
      expect(result.success).toBe(false);
    });

    it("should reject limit greater than 1000", () => {
      const result = ListChannelsInputSchema.safeParse({
        limit: 1001,
      });
      expect(result.success).toBe(false);
    });

    it("should accept custom excludeArchived", () => {
      const result = ListChannelsInputSchema.safeParse({
        excludeArchived: false,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.excludeArchived).toBe(false);
      }
    });

    it("should accept limit at boundaries (1 and 1000)", () => {
      const result1 = ListChannelsInputSchema.safeParse({ limit: 1 });
      expect(result1.success).toBe(true);

      const result2 = ListChannelsInputSchema.safeParse({ limit: 1000 });
      expect(result2.success).toBe(true);
    });
  });
});
