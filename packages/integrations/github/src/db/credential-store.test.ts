/**
 * GitHub Credential Store Tests
 *
 * Type contract tests for the GitHub credential store service.
 * Verifies interface compliance and ResultAsync return types.
 *
 * Note: Full integration tests with database deferred to Phase 20.
 */

import { describe, expect, it, vi } from "vitest";
import type { StoreCredentialInput } from "./credential-store.js";

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
import { createGitHubCredentialStore } from "./credential-store.js";

describe("GitHubCredentialStore type contracts", () => {
  it("factory validates required dependencies", () => {
    expect(() => {
      // @ts-expect-error - Testing missing dependencies
      createGitHubCredentialStore({});
    }).toThrow("db is required");

    expect(() => {
      createGitHubCredentialStore({
        db: {} as never,
        // @ts-expect-error - Testing missing logger
        logger: undefined,
      });
    }).toThrow("logger is required");
  });

  it("store method returns ResultAsync", () => {
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

    const store = createGitHubCredentialStore({
      db: mockDb as never,
      logger: mockLogger as never,
    });

    const input: StoreCredentialInput = {
      owner: "test-org",
      accessToken: "test-token",
    };

    const result = store.store(input);

    // Verify ResultAsync interface
    expect(result).toHaveProperty("map");
    expect(result).toHaveProperty("mapErr");
    expect(result).toHaveProperty("match");
    expect(typeof result.map).toBe("function");
    expect(typeof result.mapErr).toBe("function");
  });

  it("getByOwner method returns ResultAsync", () => {
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

    const store = createGitHubCredentialStore({
      db: mockDb as never,
      logger: mockLogger as never,
    });

    const result = store.getByOwner("test-org");

    // Verify ResultAsync interface
    expect(result).toHaveProperty("map");
    expect(result).toHaveProperty("mapErr");
    expect(result).toHaveProperty("match");
  });

  it("delete method returns ResultAsync with boolean", () => {
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

    const store = createGitHubCredentialStore({
      db: mockDb as never,
      logger: mockLogger as never,
    });

    const result = store.delete("cred_test123");

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

    const store = createGitHubCredentialStore({
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

    const store = createGitHubCredentialStore({
      db: mockDb as never,
      logger: mockLogger as never,
    });

    const closePromise = store.close();

    // Verify it's a Promise
    expect(closePromise).toBeInstanceOf(Promise);

    await closePromise;
  });
});

describe("GitHubCredentialStore error wrapping", () => {
  it("wraps database errors as GitHubError with INT_GITHUB_TOKEN code", async () => {
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

    const store = createGitHubCredentialStore({
      db: mockDb as never,
      logger: mockLogger as never,
    });

    const result = await store.getByOwner("test-org");

    // Verify error is wrapped
    expect(result.isErr()).toBe(true);

    if (result.isErr()) {
      expect(result.error.code).toBe("INT_GITHUB_TOKEN");
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

    const store = createGitHubCredentialStore({
      db: mockDb as never,
      logger: mockLogger as never,
    });

    await store.getByOwner("test-org");

    // Verify error was logged
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.any(Error),
        owner: "test-org",
      }),
      "Failed to get GitHub credential by owner",
    );
  });
});
