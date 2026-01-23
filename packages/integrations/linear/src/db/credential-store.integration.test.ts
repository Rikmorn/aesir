/**
 * Linear Credential Store Integration Tests
 *
 * Tests the credential store against a real PostgreSQL database.
 * Uses testcontainers for isolated database and explicit cleanup for test isolation.
 *
 * IMPORTANT: This file is named *.integration.test.ts to be excluded from test:fast.
 * Run with: pnpm test:integration
 */

import type { PinoLogger } from "@aesir/common";
import {
  cleanupPostgresContainer,
  createMockLogger,
  linearMigrationSql,
  type PostgresContainerContext,
  setupPostgresContainer,
} from "@aesir/test-utils";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// Mock config to prevent environment validation
// IMPORTANT: Must be before imports that use config
vi.mock("../types/config.js", () => ({
  env: {
    PORT: 3001,
    NODE_ENV: "test",
    LOG_LEVEL: "info",
    LINEAR_CLIENT_ID: "test-client-id",
    LINEAR_CLIENT_SECRET: "test-client-secret",
    LINEAR_WEBHOOK_SECRET: "test-webhook-secret",
    DB_HOST: "localhost",
    DB_PORT: 5432,
    DB_USER: "test",
    DB_PASSWORD: "test",
    DB_NAME: "test_db",
    CREDENTIAL_ENCRYPTION_KEY: "0".repeat(64),
  },
  config: {
    server: {
      port: 3001,
      nodeEnv: "test",
    },
    linear: {
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
      webhookSecret: "test-webhook-secret",
    },
    database: {
      host: "localhost",
      port: 5432,
      user: "test",
      password: "test",
      name: "test_db",
      encryptionKey: "0".repeat(64),
    },
    logging: {
      level: "info",
    },
  },
}));

import {
  createLinearCredentialStore,
  type LinearCredentialStore,
} from "./credential-store.js";

describe("LinearCredentialStore Integration", () => {
  // Container context - shared across all tests in this suite
  let containerCtx: PostgresContainerContext;
  let sql: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase;

  // Per-test cleanup tracking
  let testWorkspaceIds: string[] = [];

  // Start container once for all tests (60 second timeout for startup)
  beforeAll(async () => {
    containerCtx = await setupPostgresContainer();

    // Create postgres.js client for drizzle
    sql = postgres(containerCtx.connectionUri);
    db = drizzle(sql);

    // Run migrations
    await containerCtx.sql.unsafe(linearMigrationSql);
  }, 60000);

  afterAll(async () => {
    await sql.end();
    await cleanupPostgresContainer(containerCtx);
  });

  // Clean up test data after each test instead of using transactions
  // This is simpler and avoids driver mismatch issues
  beforeEach(() => {
    testWorkspaceIds = [];
  });

  afterEach(async () => {
    // Clean up any credentials created during the test
    if (testWorkspaceIds.length > 0) {
      await containerCtx.sql.unsafe(
        `
        DELETE FROM linear.credentials
        WHERE workspace_id = ANY($1::text[])
      `,
        [testWorkspaceIds],
      );
    }
  });

  // Helper to track workspace IDs for cleanup
  function trackWorkspace(workspaceId: string): string {
    testWorkspaceIds.push(workspaceId);
    return workspaceId;
  }

  // Create a fresh store for each test
  function createStore(): LinearCredentialStore {
    return createLinearCredentialStore({
      db,
      // MockLogger implements enough of PinoLogger for our needs
      logger: createMockLogger() as unknown as PinoLogger,
    });
  }

  describe("store()", () => {
    it("should store a new credential", async () => {
      const store = createStore();
      const workspaceId = trackWorkspace("ws_integ_store_1");

      const result = await store.store({
        workspaceId,
        accessToken: "test_access_token",
        refreshToken: "test_refresh_token",
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toMatch(/^cred_/);
      }
    });

    it("should soft-delete existing credential when storing new one", async () => {
      const store = createStore();
      const workspaceId = trackWorkspace("ws_integ_store_2");

      // Store first credential
      const first = await store.store({
        workspaceId,
        accessToken: "token_1",
      });
      expect(first.isOk()).toBe(true);

      // Store second credential for same workspace
      const second = await store.store({
        workspaceId,
        accessToken: "token_2",
      });
      expect(second.isOk()).toBe(true);

      if (!first.isOk() || !second.isOk()) return;

      // IDs should be different (new credential created)
      expect(first.value).not.toBe(second.value);

      // Get should return the new one only
      const current = await store.getByWorkspace(workspaceId);
      expect(current.isOk()).toBe(true);
      if (current.isOk() && current.value) {
        // Should be the second credential
        expect(current.value.id).toBe(second.value);
      }
    });

    it("should encrypt tokens before storage", async () => {
      const store = createStore();
      const workspaceId = trackWorkspace("ws_integ_store_3");
      const plainToken = "my_secret_token";

      const result = await store.store({
        workspaceId,
        accessToken: plainToken,
      });

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      // Verify raw DB doesn't contain plaintext
      const rows = await containerCtx.sql`
        SELECT encrypted_access_token
        FROM linear.credentials
        WHERE id = ${result.value}
      `;

      expect(rows.length).toBe(1);
      const row = rows[0];
      expect(row).toBeDefined();
      if (row) {
        expect(row.encrypted_access_token).not.toBe(plainToken);
        // Encrypted format is iv:ciphertext (hex encoded)
        expect(row.encrypted_access_token).toMatch(/^[a-f0-9]+:[a-f0-9]+$/);
      }
    });
  });

  describe("get()", () => {
    it("should return null for non-existent credential", async () => {
      const store = createStore();

      const result = await store.get("cred_nonexistent_12345");

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBeNull();
      }
    });

    it("should retrieve stored credential by ID", async () => {
      const store = createStore();
      const workspaceId = trackWorkspace("ws_integ_get_1");

      // First store a credential
      const stored = await store.store({
        workspaceId,
        accessToken: "test_token_get",
      });

      expect(stored.isOk()).toBe(true);
      if (!stored.isOk()) return;

      // Then retrieve it
      const result = await store.get(stored.value);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).not.toBeNull();
        expect(result.value?.workspaceId).toBe(workspaceId);
        // Token should be decrypted
        expect(result.value?.accessToken).toBe("test_token_get");
      }
    });

    it("should not retrieve soft-deleted credentials", async () => {
      const store = createStore();
      const workspaceId = trackWorkspace("ws_integ_get_2");

      // Store and then delete
      const stored = await store.store({
        workspaceId,
        accessToken: "test_token",
      });
      expect(stored.isOk()).toBe(true);
      if (!stored.isOk()) return;

      const deleted = await store.delete(stored.value);
      expect(deleted.isOk()).toBe(true);

      // Should not be retrievable
      const result = await store.get(stored.value);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBeNull();
      }
    });
  });

  describe("getByWorkspace()", () => {
    it("should return null for workspace with no credentials", async () => {
      const store = createStore();

      const result = await store.getByWorkspace("ws_integ_empty_nonexistent");

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBeNull();
      }
    });

    it("should retrieve credential by workspace ID", async () => {
      const store = createStore();
      const workspaceId = trackWorkspace("ws_integ_getbyws_1");
      const testToken = "workspace_specific_token";

      await store.store({
        workspaceId,
        accessToken: testToken,
      });

      const result = await store.getByWorkspace(workspaceId);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).not.toBeNull();
        expect(result.value?.workspaceId).toBe(workspaceId);
        expect(result.value?.accessToken).toBe(testToken);
      }
    });
  });

  describe("updateTokens()", () => {
    it("should update access token", async () => {
      const store = createStore();
      const workspaceId = trackWorkspace("ws_integ_update_1");

      const stored = await store.store({
        workspaceId,
        accessToken: "original_token",
      });
      expect(stored.isOk()).toBe(true);
      if (!stored.isOk()) return;

      const updated = await store.updateTokens(stored.value, {
        accessToken: "updated_token",
      });
      expect(updated.isOk()).toBe(true);

      // Verify the token was updated
      const result = await store.get(stored.value);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value?.accessToken).toBe("updated_token");
      }
    });

    it("should update refresh token and expiry", async () => {
      const store = createStore();
      const workspaceId = trackWorkspace("ws_integ_update_2");
      const newExpiry = new Date("2025-12-31T23:59:59Z");

      const stored = await store.store({
        workspaceId,
        accessToken: "original_token",
        refreshToken: "original_refresh",
      });
      expect(stored.isOk()).toBe(true);
      if (!stored.isOk()) return;

      const updated = await store.updateTokens(stored.value, {
        accessToken: "new_access",
        refreshToken: "new_refresh",
        expiresAt: newExpiry,
      });
      expect(updated.isOk()).toBe(true);

      // Verify all fields were updated
      const result = await store.get(stored.value);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value?.accessToken).toBe("new_access");
        expect(result.value?.refreshToken).toBe("new_refresh");
        expect(result.value?.expiresAt?.toISOString()).toBe(
          newExpiry.toISOString(),
        );
      }
    });
  });

  describe("delete()", () => {
    it("should return false for non-existent credential", async () => {
      const store = createStore();

      const result = await store.delete("cred_nonexistent_delete");

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(false);
      }
    });

    it("should soft-delete existing credential", async () => {
      const store = createStore();
      const workspaceId = trackWorkspace("ws_integ_delete_1");

      const stored = await store.store({
        workspaceId,
        accessToken: "test_token",
      });

      expect(stored.isOk()).toBe(true);
      if (!stored.isOk()) return;

      const deleted = await store.delete(stored.value);
      expect(deleted.isOk()).toBe(true);
      if (deleted.isOk()) {
        expect(deleted.value).toBe(true);
      }

      // Should no longer be retrievable
      const result = await store.get(stored.value);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBeNull();
      }

      // But should still exist in DB with deleted_at set
      const rows = await containerCtx.sql`
        SELECT deleted_at
        FROM linear.credentials
        WHERE id = ${stored.value}
      `;
      expect(rows.length).toBe(1);
      const row = rows[0];
      expect(row).toBeDefined();
      if (row) {
        expect(row.deleted_at).not.toBeNull();
      }
    });

    it("should return false when deleting already-deleted credential", async () => {
      const store = createStore();
      const workspaceId = trackWorkspace("ws_integ_delete_2");

      const stored = await store.store({
        workspaceId,
        accessToken: "test_token",
      });
      expect(stored.isOk()).toBe(true);
      if (!stored.isOk()) return;

      // Delete once
      const first = await store.delete(stored.value);
      expect(first.isOk()).toBe(true);
      if (first.isOk()) {
        expect(first.value).toBe(true);
      }

      // Delete again
      const second = await store.delete(stored.value);
      expect(second.isOk()).toBe(true);
      if (second.isOk()) {
        expect(second.value).toBe(false);
      }
    });
  });

  describe("health()", () => {
    it("should return healthy status with latency", async () => {
      const store = createStore();

      const result = await store.health();

      expect(result.healthy).toBe(true);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("test isolation verification", () => {
    it("first test creates workspace data", async () => {
      const store = createStore();
      const workspaceId = trackWorkspace("ws_isolation_test");

      await store.store({
        workspaceId,
        accessToken: "isolation_token_1",
      });

      const result = await store.getByWorkspace(workspaceId);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value?.accessToken).toBe("isolation_token_1");
      }
    });

    it("second test cannot see first test data", async () => {
      const store = createStore();

      // This workspace should have been cleaned up after the first test
      const result = await store.getByWorkspace("ws_isolation_test");
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBeNull();
      }
    });
  });
});
