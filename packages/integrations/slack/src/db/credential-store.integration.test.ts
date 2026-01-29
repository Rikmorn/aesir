/**
 * Slack Credential Store Integration Tests
 *
 * Tests the credential store against a real PostgreSQL database.
 * Uses testcontainers for isolated database and explicit cleanup for test isolation.
 *
 * IMPORTANT: This file is named *.integration.test.ts to be excluded from test:fast.
 * Run with: pnpm test:integration
 */

import {
  cleanupPostgresContainer,
  createMockLogger,
  type PostgresContainerContext,
  setupPostgresContainer,
  slackMigrationSql,
} from "@aesir/test-utils";
import type { MCPLogger } from "@aesir/types";
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
    PORT: 3003,
    NODE_ENV: "test",
    LOG_LEVEL: "info",
    SLACK_CLIENT_ID: "test-client-id",
    SLACK_CLIENT_SECRET: "test-client-secret",
    SLACK_SIGNING_SECRET: "test-signing-secret",
    DB_HOST: "localhost",
    DB_PORT: 5432,
    DB_USER: "test",
    DB_PASSWORD: "test",
    DB_NAME: "test_db",
    CREDENTIAL_ENCRYPTION_KEY: "0".repeat(64),
  },
  config: {
    server: {
      port: 3003,
      nodeEnv: "test",
    },
    slack: {
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
      signingSecret: "test-signing-secret",
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
  createSlackCredentialStore,
  type SlackCredentialStore,
} from "./credential-store.js";

describe("SlackCredentialStore Integration", () => {
  // Container context - shared across all tests in this suite
  let containerCtx: PostgresContainerContext;
  let sql: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase;

  // Per-test cleanup tracking
  let testTeamIds: string[] = [];

  // Start container once for all tests (60 second timeout for startup)
  beforeAll(async () => {
    containerCtx = await setupPostgresContainer();

    // Create postgres.js client for drizzle
    sql = postgres(containerCtx.connectionUri);
    db = drizzle(sql);

    // Run migrations
    await containerCtx.sql.unsafe(slackMigrationSql);
  }, 60000);

  afterAll(async () => {
    await sql.end();
    await cleanupPostgresContainer(containerCtx);
  });

  // Clean up test data after each test instead of using transactions
  // This is simpler and avoids driver mismatch issues
  beforeEach(() => {
    testTeamIds = [];
  });

  afterEach(async () => {
    // Clean up any installations created during the test
    if (testTeamIds.length > 0) {
      await containerCtx.sql.unsafe(
        `
        DELETE FROM slack.installations
        WHERE team_id = ANY($1::text[])
      `,
        [testTeamIds],
      );
    }
  });

  // Helper to track team IDs for cleanup
  function trackTeam(teamId: string): string {
    testTeamIds.push(teamId);
    return teamId;
  }

  // Create a fresh store for each test
  function createStore(): SlackCredentialStore {
    return createSlackCredentialStore({
      db,
      // MockLogger implements enough of MCPLogger for our needs
      logger: createMockLogger() as unknown as MCPLogger,
    });
  }

  describe("storeInstallation()", () => {
    it("should store a new installation", async () => {
      const store = createStore();
      const teamId = trackTeam("T_STORE_1");

      const result = await store.storeInstallation({
        teamId,
        botToken: "xoxb-test-token",
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toMatch(/^cred_/);
      }
    });

    it("should soft-delete existing installation when storing new one", async () => {
      const store = createStore();
      const teamId = trackTeam("T_STORE_2");

      // Store first installation
      const first = await store.storeInstallation({
        teamId,
        botToken: "xoxb-token-1",
      });
      expect(first.isOk()).toBe(true);

      // Store second installation for same team
      const second = await store.storeInstallation({
        teamId,
        botToken: "xoxb-token-2",
      });
      expect(second.isOk()).toBe(true);

      if (!first.isOk() || !second.isOk()) return;

      // IDs should be different (new installation created)
      expect(first.value).not.toBe(second.value);

      // Fetch should return the new one only
      const current = await store.fetchInstallation({ teamId });
      expect(current.isOk()).toBe(true);
      if (current.isOk() && current.value) {
        expect(current.value.id).toBe(second.value);
      }
    });

    it("should encrypt tokens before storage", async () => {
      const store = createStore();
      const teamId = trackTeam("T_STORE_3");
      const plainToken = "xoxb-secret-token";

      const result = await store.storeInstallation({
        teamId,
        botToken: plainToken,
      });

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      // Verify raw DB doesn't contain plaintext
      const rows = await containerCtx.sql`
        SELECT encrypted_bot_token
        FROM slack.installations
        WHERE id = ${result.value}
      `;

      expect(rows.length).toBe(1);
      const row = rows[0];
      expect(row).toBeDefined();
      if (row) {
        expect(row.encrypted_bot_token).not.toBe(plainToken);
        // Encrypted format is iv:ciphertext (hex encoded)
        expect(row.encrypted_bot_token).toMatch(/^[a-f0-9]+:[a-f0-9]+$/);
      }
    });

    it("should store all optional fields", async () => {
      const store = createStore();
      const teamId = trackTeam("T_STORE_4");

      const result = await store.storeInstallation({
        teamId,
        enterpriseId: "E1234567890",
        userId: "U1234567890",
        isEnterpriseInstall: false,
        botToken: "xoxb-full-token",
        userToken: "xoxp-user-token",
        botId: "B1234567890",
        botUserId: "U0BOT",
        botScopes: ["chat:write", "channels:read"],
        appId: "A1234567890",
      });

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      const retrieved = await store.fetchInstallation({ teamId });
      expect(retrieved.isOk()).toBe(true);
      if (retrieved.isOk() && retrieved.value) {
        expect(retrieved.value.enterpriseId).toBe("E1234567890");
        expect(retrieved.value.userId).toBe("U1234567890");
        expect(retrieved.value.isEnterpriseInstall).toBe(false);
        expect(retrieved.value.botId).toBe("B1234567890");
        expect(retrieved.value.botUserId).toBe("U0BOT");
        expect(retrieved.value.botScopes).toEqual([
          "chat:write",
          "channels:read",
        ]);
        expect(retrieved.value.appId).toBe("A1234567890");
        // User token should be decrypted
        expect(retrieved.value.userToken).toBe("xoxp-user-token");
      }
    });
  });

  describe("fetchInstallation()", () => {
    it("should return null for non-existent team", async () => {
      const store = createStore();

      const result = await store.fetchInstallation({ teamId: "T_NONEXISTENT" });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBeNull();
      }
    });

    it("should retrieve installation by team ID", async () => {
      const store = createStore();
      const teamId = trackTeam("T_FETCH_1");
      const testToken = "xoxb-fetch-token";

      await store.storeInstallation({
        teamId,
        botToken: testToken,
      });

      const result = await store.fetchInstallation({ teamId });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).not.toBeNull();
        expect(result.value?.teamId).toBe(teamId);
        // Token should be decrypted
        expect(result.value?.botToken).toBe(testToken);
      }
    });

    it("should not retrieve soft-deleted installations", async () => {
      const store = createStore();
      const teamId = trackTeam("T_FETCH_2");

      // Store and then delete
      await store.storeInstallation({
        teamId,
        botToken: "xoxb-test",
      });

      const deleted = await store.deleteInstallation({ teamId });
      expect(deleted.isOk()).toBe(true);

      // Should not be retrievable
      const result = await store.fetchInstallation({ teamId });
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBeNull();
      }
    });

    it("should distinguish between teams with same enterprise", async () => {
      const store = createStore();
      const teamId1 = trackTeam("T_FETCH_3A");
      const teamId2 = trackTeam("T_FETCH_3B");
      const enterpriseId = "E_SHARED";

      // Store two installations for different teams in same enterprise
      await store.storeInstallation({
        teamId: teamId1,
        enterpriseId,
        botToken: "xoxb-team1",
      });

      await store.storeInstallation({
        teamId: teamId2,
        enterpriseId,
        botToken: "xoxb-team2",
      });

      // Should retrieve correct team
      const result1 = await store.fetchInstallation({ teamId: teamId1 });
      expect(result1.isOk()).toBe(true);
      if (result1.isOk()) {
        expect(result1.value?.teamId).toBe(teamId1);
        expect(result1.value?.botToken).toBe("xoxb-team1");
      }

      const result2 = await store.fetchInstallation({ teamId: teamId2 });
      expect(result2.isOk()).toBe(true);
      if (result2.isOk()) {
        expect(result2.value?.teamId).toBe(teamId2);
        expect(result2.value?.botToken).toBe("xoxb-team2");
      }
    });
  });

  describe("deleteInstallation()", () => {
    it("should return false for non-existent team", async () => {
      const store = createStore();

      const result = await store.deleteInstallation({
        teamId: "T_DELETE_NONE",
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(false);
      }
    });

    it("should soft-delete existing installation", async () => {
      const store = createStore();
      const teamId = trackTeam("T_DELETE_1");

      const stored = await store.storeInstallation({
        teamId,
        botToken: "xoxb-delete-test",
      });
      expect(stored.isOk()).toBe(true);
      if (!stored.isOk()) return;

      const deleted = await store.deleteInstallation({ teamId });
      expect(deleted.isOk()).toBe(true);
      if (deleted.isOk()) {
        expect(deleted.value).toBe(true);
      }

      // Should no longer be retrievable
      const result = await store.fetchInstallation({ teamId });
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBeNull();
      }

      // But should still exist in DB with deleted_at set
      const rows = await containerCtx.sql`
        SELECT deleted_at
        FROM slack.installations
        WHERE id = ${stored.value}
      `;
      expect(rows.length).toBe(1);
      const row = rows[0];
      expect(row).toBeDefined();
      if (row) {
        expect(row.deleted_at).not.toBeNull();
      }
    });

    it("should return false when deleting already-deleted installation", async () => {
      const store = createStore();
      const teamId = trackTeam("T_DELETE_2");

      await store.storeInstallation({
        teamId,
        botToken: "xoxb-test",
      });

      // Delete once
      const first = await store.deleteInstallation({ teamId });
      expect(first.isOk()).toBe(true);
      if (first.isOk()) {
        expect(first.value).toBe(true);
      }

      // Delete again
      const second = await store.deleteInstallation({ teamId });
      expect(second.isOk()).toBe(true);
      if (second.isOk()) {
        expect(second.value).toBe(false);
      }
    });

    it("should return false when no query parameters provided", async () => {
      const store = createStore();

      const result = await store.deleteInstallation({});

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(false);
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
    it("first test creates team data", async () => {
      const store = createStore();
      const teamId = trackTeam("T_ISOLATION");

      await store.storeInstallation({
        teamId,
        botToken: "xoxb-isolation-1",
      });

      const result = await store.fetchInstallation({ teamId });
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value?.botToken).toBe("xoxb-isolation-1");
      }
    });

    it("second test cannot see first test data", async () => {
      const store = createStore();

      // This team should have been cleaned up after the first test
      const result = await store.fetchInstallation({ teamId: "T_ISOLATION" });
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBeNull();
      }
    });
  });
});
