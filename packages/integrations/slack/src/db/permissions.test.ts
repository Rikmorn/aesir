/**
 * Permission Checker Tests for Slack Integration
 *
 * Tests the checkSlackToolPermission function with mocked database.
 * Full integration tests with real database deferred to Phase 20.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock @aesir/common to prevent config validation during schema.ts import
vi.mock("@aesir/common", () => ({
  createId: {
    credential: vi.fn(() => "cred_test_123"),
  },
  createPinoLogger: vi.fn(() => ({
    child: vi.fn().mockReturnThis(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
  AppError: class AppError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "AppError";
    }
  },
  PinoLogger: {},
}));

import { checkSlackToolPermission } from "./permissions.js";

describe("checkSlackToolPermission", () => {
  const mockLogger = {
    child: vi.fn().mockReturnThis(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return true when permission exists with allowed=true", async () => {
    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ allowed: true }]),
          }),
        }),
      }),
    };

    const result = await checkSlackToolPermission(
      // biome-ignore lint/suspicious/noExplicitAny: Mock database and logger
      { db: mockDb as any, logger: mockLogger as any },
      { agentId: "dev-agent", toolName: "send_message" },
    );

    expect(result).toBe(true);
  });

  it("should return false when permission exists with allowed=false", async () => {
    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ allowed: false }]),
          }),
        }),
      }),
    };

    const result = await checkSlackToolPermission(
      // biome-ignore lint/suspicious/noExplicitAny: Mock database and logger
      { db: mockDb as any, logger: mockLogger as any },
      { agentId: "dev-agent", toolName: "delete_channel" },
    );

    expect(result).toBe(false);
  });

  it("should return false when no permission row exists (default deny)", async () => {
    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    };

    const result = await checkSlackToolPermission(
      // biome-ignore lint/suspicious/noExplicitAny: Mock database and logger
      { db: mockDb as any, logger: mockLogger as any },
      { agentId: "unknown-agent", toolName: "send_message" },
    );

    expect(result).toBe(false);
  });

  it("should return false and log error when database query fails", async () => {
    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockRejectedValue(new Error("DB connection failed")),
          }),
        }),
      }),
    };

    const result = await checkSlackToolPermission(
      // biome-ignore lint/suspicious/noExplicitAny: Mock database and logger
      { db: mockDb as any, logger: mockLogger as any },
      { agentId: "dev-agent", toolName: "send_message" },
    );

    expect(result).toBe(false);
    expect(mockLogger.error).toHaveBeenCalled();
  });
});
