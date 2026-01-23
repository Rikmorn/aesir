import { beforeEach, describe, expect, it } from "vitest";

import {
  createMockCredentialStore,
  createMockLogger,
  createTestCredential,
  createTestIssue,
  createTestPR,
  resetAllCounters,
  resetMockCredentialStoreCounter,
} from "./index.js";

describe("@aesir/test-utils", () => {
  beforeEach(() => {
    resetAllCounters();
    resetMockCredentialStoreCounter();
  });

  describe("createTestCredential", () => {
    it("creates credential with deterministic IDs", () => {
      const cred1 = createTestCredential();
      const cred2 = createTestCredential();

      expect(cred1.id).toBe("test_cred_0");
      expect(cred1.accessToken).toBe("test_token_0");
      expect(cred2.id).toBe("test_cred_1");
      expect(cred2.accessToken).toBe("test_token_1");
    });

    it("allows overriding defaults", () => {
      const cred = createTestCredential({
        provider: "github",
        workspaceId: "ws_custom",
      });

      expect(cred.provider).toBe("github");
      expect(cred.workspaceId).toBe("ws_custom");
    });
  });

  describe("createTestIssue", () => {
    it("creates issue with deterministic IDs", () => {
      const issue1 = createTestIssue();
      const issue2 = createTestIssue();

      expect(issue1.id).toBe("issue_0");
      expect(issue1.identifier).toBe("TEST-0");
      expect(issue2.id).toBe("issue_1");
      expect(issue2.identifier).toBe("TEST-1");
    });
  });

  describe("createTestPR", () => {
    it("creates PR with deterministic numbers", () => {
      const pr1 = createTestPR();
      const pr2 = createTestPR();

      expect(pr1.number).toBe(1);
      expect(pr1.id).toBe(0);
      expect(pr2.number).toBe(2);
      expect(pr2.id).toBe(1);
    });
  });

  describe("createMockLogger", () => {
    it("captures log calls", () => {
      const logger = createMockLogger();

      logger.info({ userId: 123 }, "User logged in");
      logger.error("Something went wrong");

      expect(logger.calls).toHaveLength(2);
      expect(logger.getCallsAt("info")).toHaveLength(1);
      expect(logger.getCallsAt("error")).toHaveLength(1);
    });

    it("hasLoggedAt checks log messages", () => {
      const logger = createMockLogger();

      logger.info("User authenticated");
      logger.warn("Rate limit exceeded");

      expect(logger.hasLoggedAt("info")).toBe(true);
      expect(logger.hasLoggedAt("info", "authenticated")).toBe(true);
      expect(logger.hasLoggedAt("info", /authen/)).toBe(true);
      expect(logger.hasLoggedAt("info", "nonexistent")).toBe(false);
      expect(logger.hasLoggedAt("debug")).toBe(false);
    });

    it("clear removes all calls", () => {
      const logger = createMockLogger();

      logger.info("test");
      expect(logger.calls).toHaveLength(1);

      logger.clear();
      expect(logger.calls).toHaveLength(0);
    });
  });

  describe("createMockCredentialStore", () => {
    it("stores and retrieves credentials", async () => {
      const store = createMockCredentialStore();

      const stored = await store
        .store({
          workspaceId: "ws_test",
          accessToken: "token_abc",
        })
        .unwrapOr(null);

      expect(stored).not.toBeNull();
      if (!stored) return;

      expect(stored.id).toBe("mock_cred_0");

      const retrieved = await store.get(stored.id).unwrapOr(null);
      expect(retrieved).toEqual(stored);
    });

    it("getByWorkspace finds credential", async () => {
      const store = createMockCredentialStore();

      await store.store({
        workspaceId: "ws_special",
        accessToken: "token_xyz",
      });

      const found = await store.getByWorkspace("ws_special").unwrapOr(null);
      expect(found?.workspaceId).toBe("ws_special");

      const notFound = await store.getByWorkspace("ws_other").unwrapOr(null);
      expect(notFound).toBeNull();
    });

    it("updateTokens modifies credential", async () => {
      const store = createMockCredentialStore();

      const stored = await store
        .store({
          workspaceId: "ws_test",
          accessToken: "old_token",
        })
        .unwrapOr(null);

      expect(stored).not.toBeNull();
      if (!stored) return;

      const updated = await store
        .updateTokens(stored.id, { accessToken: "new_token" })
        .unwrapOr(null);

      expect(updated?.accessToken).toBe("new_token");
    });

    it("delete removes credential", async () => {
      const store = createMockCredentialStore();

      const stored = await store
        .store({
          workspaceId: "ws_test",
          accessToken: "token",
        })
        .unwrapOr(null);

      expect(stored).not.toBeNull();
      if (!stored) return;

      const deleted = await store.delete(stored.id).unwrapOr(false);
      expect(deleted).toBe(true);

      const retrieved = await store.get(stored.id).unwrapOr(null);
      expect(retrieved).toBeNull();
    });
  });
});
