/**
 * Permission Checker Tests for Linear Integration
 *
 * Tests the checkLinearToolPermission function with mocked database.
 * Full integration tests with real database deferred to Phase 20.
 */

import { createMockLogger, type MockLogger } from "@aesir/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock @aesir/types to prevent config validation during schema.ts import
vi.mock("@aesir/types", () => ({
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

import { checkLinearToolPermission } from "./permissions.js";

describe("checkLinearToolPermission", () => {
  let mockLogger: MockLogger;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLogger = createMockLogger();
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

    const result = await checkLinearToolPermission(
      // biome-ignore lint/suspicious/noExplicitAny: Mock database and logger
      { db: mockDb as any, logger: mockLogger as any },
      { agentId: "dev-agent", toolName: "get_issue" },
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

    const result = await checkLinearToolPermission(
      // biome-ignore lint/suspicious/noExplicitAny: Mock database and logger
      { db: mockDb as any, logger: mockLogger as any },
      { agentId: "dev-agent", toolName: "delete_issue" },
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

    const result = await checkLinearToolPermission(
      // biome-ignore lint/suspicious/noExplicitAny: Mock database and logger
      { db: mockDb as any, logger: mockLogger as any },
      { agentId: "unknown-agent", toolName: "get_issue" },
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

    const result = await checkLinearToolPermission(
      // biome-ignore lint/suspicious/noExplicitAny: Mock database and logger
      { db: mockDb as any, logger: mockLogger as any },
      { agentId: "dev-agent", toolName: "get_issue" },
    );

    expect(result).toBe(false);
    expect(mockLogger.hasLoggedAt("error")).toBe(true);
  });
});
