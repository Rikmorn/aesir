/**
 * Linear Credential Store Tests
 *
 * Type contract tests for LinearCredentialStore interface.
 * Following 13-04 decision: Type contract tests only, full integration tests
 * require database and are deferred to Phase 20.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock @aesir/common to prevent config validation
vi.mock("@aesir/common", () => ({
  createId: {
    credential: vi.fn(() => "cred_test_123"),
  },
  AppError: class AppError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "AppError";
    }
  },
  PinoLogger: {},
}));

// Mock config to prevent environment validation
vi.mock("../types/config.js", () => ({
  env: {
    LINEAR_CLIENT_ID: "test-client-id",
    LINEAR_CLIENT_SECRET: "test-client-secret",
    LINEAR_WEBHOOK_SECRET: "test-webhook-secret",
    CREDENTIAL_ENCRYPTION_KEY: "0".repeat(64), // 64 hex chars = 32 bytes
  },
  config: {
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    webhookSecret: "test-webhook-secret",
    credentialEncryptionKey: "0".repeat(64),
  },
}));

import {
  createLinearCredentialStore,
  type LinearCredentialStore,
} from "./credential-store.js";

describe("createLinearCredentialStore", () => {
  it("throws if db is not provided", () => {
    expect(() =>
      // biome-ignore lint/suspicious/noExplicitAny: Testing error case
      createLinearCredentialStore({ db: null as any, logger: {} as any }),
    ).toThrow("db is required for LinearCredentialStore");
  });

  it("throws if logger is not provided", () => {
    expect(() =>
      // biome-ignore lint/suspicious/noExplicitAny: Testing error case
      createLinearCredentialStore({ db: {} as any, logger: null as any }),
    ).toThrow("logger is required for LinearCredentialStore");
  });

  it("returns object with required methods", () => {
    const mockDb = {
      execute: vi.fn(),
    };
    const mockLogger = {
      info: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    };

    const store = createLinearCredentialStore({
      // biome-ignore lint/suspicious/noExplicitAny: Mock database
      db: mockDb as any,
      // biome-ignore lint/suspicious/noExplicitAny: Mock logger
      logger: mockLogger as any,
    });

    // Verify interface compliance
    expect(store).toHaveProperty("store");
    expect(store).toHaveProperty("get");
    expect(store).toHaveProperty("getByWorkspace");
    expect(store).toHaveProperty("updateTokens");
    expect(store).toHaveProperty("delete");
    expect(store).toHaveProperty("health");
    expect(store).toHaveProperty("close");

    expect(typeof store.store).toBe("function");
    expect(typeof store.get).toBe("function");
    expect(typeof store.getByWorkspace).toBe("function");
    expect(typeof store.updateTokens).toBe("function");
    expect(typeof store.delete).toBe("function");
    expect(typeof store.health).toBe("function");
    expect(typeof store.close).toBe("function");
  });
});

describe("LinearCredentialStore interface compliance", () => {
  let store: LinearCredentialStore;

  beforeEach(() => {
    const mockDb = {
      execute: vi.fn(),
    };
    const mockLogger = {
      info: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    };

    store = createLinearCredentialStore({
      // biome-ignore lint/suspicious/noExplicitAny: Mock database
      db: mockDb as any,
      // biome-ignore lint/suspicious/noExplicitAny: Mock logger
      logger: mockLogger as any,
    });
  });

  it("store method returns ResultAsync", () => {
    const result = store.store({
      workspaceId: "ws_test",
      accessToken: "token",
    });

    // ResultAsync has isOk and isErr methods
    expect(result).toHaveProperty("match");
    expect(result).toHaveProperty("mapErr");
    expect(result).toHaveProperty("andThen");
  });

  it("get method returns ResultAsync", () => {
    const result = store.get("cred_test");

    expect(result).toHaveProperty("match");
    expect(result).toHaveProperty("mapErr");
    expect(result).toHaveProperty("andThen");
  });

  it("getByWorkspace method returns ResultAsync", () => {
    const result = store.getByWorkspace("ws_test");

    expect(result).toHaveProperty("match");
    expect(result).toHaveProperty("mapErr");
    expect(result).toHaveProperty("andThen");
  });

  it("updateTokens method returns ResultAsync", () => {
    const result = store.updateTokens("cred_test", {
      accessToken: "new_token",
    });

    expect(result).toHaveProperty("match");
    expect(result).toHaveProperty("mapErr");
    expect(result).toHaveProperty("andThen");
  });

  it("delete method returns ResultAsync", () => {
    const result = store.delete("cred_test");

    expect(result).toHaveProperty("match");
    expect(result).toHaveProperty("mapErr");
    expect(result).toHaveProperty("andThen");
  });

  it("health method returns Promise", async () => {
    const result = store.health();

    expect(result).toBeInstanceOf(Promise);
  });

  it("close method returns Promise", async () => {
    const result = store.close();

    expect(result).toBeInstanceOf(Promise);
  });
});
