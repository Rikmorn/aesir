/**
 * Slack Credential Store Tests
 *
 * Type contract tests for the Slack credential store service.
 * Verifies interface compliance and ResultAsync return types.
 *
 * Note: Full integration tests with database deferred to Phase 20.
 */

import { describe, expect, it, vi } from "vitest";
import type { StoreInstallationInput } from "./credential-store.js";

// Mock @aesir/types to prevent config validation
vi.mock("@aesir/types", () => ({
  createId: {
    credential: vi.fn(() => "cred_test123"),
  },
  createPinoLogger: vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  })),
  AppError: class AppError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));

// Mock drizzle-orm to prevent requiring actual database
vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  eq: vi.fn(),
  isNull: vi.fn(),
  sql: vi.fn(),
}));

vi.mock("drizzle-orm/node-postgres", () => ({
  drizzle: vi.fn(),
}));

// Mock encryption to prevent requiring CREDENTIAL_ENCRYPTION_KEY
vi.mock("./encryption.js", () => ({
  encryptToken: vi.fn((token) => `encrypted_${token}`),
  decryptToken: vi.fn((encrypted) => encrypted.replace("encrypted_", "")),
}));

// Import after mocking
import { createSlackCredentialStore } from "./credential-store.js";

describe("SlackCredentialStore type contracts", () => {
  it("factory validates required dependencies", () => {
    expect(() => {
      // @ts-expect-error - Testing missing dependencies
      createSlackCredentialStore({});
    }).toThrow("db is required");

    expect(() => {
      createSlackCredentialStore({
        db: {} as never,
        // @ts-expect-error - Testing missing logger
        logger: undefined,
      });
    }).toThrow("logger is required");
  });

  it("storeInstallation method returns ResultAsync", () => {
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue([]),
    };

    const mockLogger = {
      info: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    };

    const store = createSlackCredentialStore({
      db: mockDb as never,
      logger: mockLogger as never,
    });

    const input: StoreInstallationInput = {
      teamId: "T1234",
      botToken: "xoxb-test-token",
    };

    const result = store.storeInstallation(input);

    // Verify ResultAsync interface
    expect(result).toHaveProperty("map");
    expect(result).toHaveProperty("mapErr");
    expect(result).toHaveProperty("match");
    expect(typeof result.map).toBe("function");
    expect(typeof result.mapErr).toBe("function");
  });

  it("fetchInstallation method returns ResultAsync", () => {
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockResolvedValue([]),
    };

    const mockLogger = {
      info: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    };

    const store = createSlackCredentialStore({
      db: mockDb as never,
      logger: mockLogger as never,
    });

    const result = store.fetchInstallation({ teamId: "T1234" });

    // Verify ResultAsync interface
    expect(result).toHaveProperty("map");
    expect(result).toHaveProperty("mapErr");
    expect(result).toHaveProperty("match");
  });

  it("deleteInstallation method returns ResultAsync with boolean", () => {
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue([]),
    };

    const mockLogger = {
      info: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    };

    const store = createSlackCredentialStore({
      db: mockDb as never,
      logger: mockLogger as never,
    });

    const result = store.deleteInstallation({ teamId: "T1234" });

    // Verify ResultAsync interface
    expect(result).toHaveProperty("map");
    expect(result).toHaveProperty("mapErr");
    expect(result).toHaveProperty("match");
  });

  it("health method returns Promise", async () => {
    const mockDb = {
      execute: vi.fn().mockResolvedValue([]),
    };

    const mockLogger = {
      info: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    };

    const store = createSlackCredentialStore({
      db: mockDb as never,
      logger: mockLogger as never,
    });

    const health = store.health();

    // Verify it's a Promise
    expect(health).toBeInstanceOf(Promise);

    const result = await health;

    // Verify health check structure
    expect(result).toHaveProperty("healthy");
    expect(result).toHaveProperty("latencyMs");
    expect(typeof result.healthy).toBe("boolean");
    expect(typeof result.latencyMs).toBe("number");
  });

  it("close method returns Promise", async () => {
    const mockDb = {};

    const mockLogger = {
      info: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    };

    const store = createSlackCredentialStore({
      db: mockDb as never,
      logger: mockLogger as never,
    });

    const closePromise = store.close();

    // Verify it's a Promise
    expect(closePromise).toBeInstanceOf(Promise);

    await closePromise;
  });
});

describe("StoreInstallationInput validation", () => {
  it("accepts minimal required fields", () => {
    const input: StoreInstallationInput = {
      teamId: "T1234567890",
      botToken: "xoxb-1234-5678-abcdef",
    };

    expect(input.teamId).toBe("T1234567890");
    expect(input.botToken).toBe("xoxb-1234-5678-abcdef");
    expect(input.enterpriseId).toBeUndefined();
  });

  it("accepts all optional fields", () => {
    const input: StoreInstallationInput = {
      teamId: "T1234567890",
      enterpriseId: "E1234567890",
      userId: "U1234567890",
      isEnterpriseInstall: true,
      botToken: "xoxb-1234-5678-abcdef",
      userToken: "xoxp-1234-5678-ghijkl",
      botId: "B1234567890",
      botUserId: "U0BOT",
      botScopes: ["chat:write", "app_mentions:read", "channels:history"],
      appId: "A1234567890",
    };

    expect(input.enterpriseId).toBe("E1234567890");
    expect(input.userId).toBe("U1234567890");
    expect(input.isEnterpriseInstall).toBe(true);
    expect(input.userToken).toBe("xoxp-1234-5678-ghijkl");
    expect(input.botId).toBe("B1234567890");
    expect(input.botUserId).toBe("U0BOT");
    expect(input.botScopes).toEqual([
      "chat:write",
      "app_mentions:read",
      "channels:history",
    ]);
    expect(input.appId).toBe("A1234567890");
  });
});

describe("SlackCredentialStore error wrapping", () => {
  it("wraps database errors as SlackError with INT_SLACK_TOKEN code", async () => {
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockRejectedValue(new Error("Database connection failed")),
    };

    const mockLogger = {
      info: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    };

    const store = createSlackCredentialStore({
      db: mockDb as never,
      logger: mockLogger as never,
    });

    const result = await store.fetchInstallation({ teamId: "T1234" });

    // Verify error is wrapped
    expect(result.isErr()).toBe(true);

    if (result.isErr()) {
      expect(result.error.code).toBe("INT_SLACK_TOKEN");
    }
  });

  it("logs errors before returning", async () => {
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockRejectedValue(new Error("DB error")),
    };

    const mockLogger = {
      info: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    };

    const store = createSlackCredentialStore({
      db: mockDb as never,
      logger: mockLogger as never,
    });

    await store.fetchInstallation({ teamId: "T1234" });

    // Verify error was logged
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.any(Error),
        query: { teamId: "T1234" },
      }),
      "Failed to fetch Slack installation",
    );
  });

  it("health returns unhealthy on database error", async () => {
    const mockDb = {
      execute: vi.fn().mockRejectedValue(new Error("Connection refused")),
    };

    const mockLogger = {
      info: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    };

    const store = createSlackCredentialStore({
      db: mockDb as never,
      logger: mockLogger as never,
    });

    const result = await store.health();

    expect(result.healthy).toBe(false);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
