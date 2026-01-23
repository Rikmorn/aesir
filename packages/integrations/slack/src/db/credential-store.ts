/**
 * Slack Credential Store
 *
 * Database-backed storage for Slack OAuth installations with application-level encryption.
 * Compatible with Bolt's installationStore interface pattern.
 *
 * All service boundary methods return ResultAsync for explicit error handling.
 */

import type { PinoLogger } from "@aesir/common";
import { createId } from "@aesir/common";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { fromPromise, type ResultAsync } from "neverthrow";
import { SlackError } from "../types/errors.js";
import { decryptToken, encryptToken } from "./encryption.js";
import { type Installation, installations } from "./schema.js";

/** Input for storing an installation (matches Bolt's Installation) */
export interface StoreInstallationInput {
  teamId: string; // Slack workspace ID (T1234...)
  enterpriseId?: string; // For Enterprise Grid
  userId?: string; // User who installed
  isEnterpriseInstall?: boolean;
  botToken: string; // xoxb-...
  userToken?: string; // xoxp-... if requested
  botId?: string;
  botUserId?: string;
  botScopes?: string[]; // Stored as comma-separated string
  appId?: string;
}

/** Query for fetching an installation */
export interface FetchInstallationQuery {
  teamId?: string;
  enterpriseId?: string;
  isEnterpriseInstall?: boolean;
}

/** Query for deleting an installation */
export interface DeleteInstallationQuery {
  teamId?: string;
  enterpriseId?: string;
  isEnterpriseInstall?: boolean;
}

/** Decrypted installation output */
export interface DecryptedInstallation {
  id: string;
  teamId: string;
  enterpriseId: string | null;
  userId: string | null;
  isEnterpriseInstall: boolean;
  botToken: string;
  userToken: string | null;
  botId: string | null;
  botUserId: string | null;
  botScopes: string[];
  appId: string | null;
  tokenType: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Options for creating a Slack credential store */
export interface SlackCredentialStoreOptions {
  db: NodePgDatabase;
  logger: PinoLogger;
}

/** Slack credential store service interface */
export interface SlackCredentialStore {
  /**
   * Store an installation with encryption
   *
   * If an installation already exists for the team/enterprise, it is soft-deleted
   * and a new one is created (ensures single active installation per workspace).
   *
   * @param input - Installation data to store
   * @returns ResultAsync with installation ID or SlackError
   */
  storeInstallation(
    input: StoreInstallationInput,
  ): ResultAsync<string, SlackError>;

  /**
   * Fetch an installation by team/enterprise
   *
   * @param query - Query parameters for finding installation
   * @returns ResultAsync with decrypted installation or null if not found
   */
  fetchInstallation(
    query: FetchInstallationQuery,
  ): ResultAsync<DecryptedInstallation | null, SlackError>;

  /**
   * Delete an installation (soft delete)
   *
   * @param query - Query parameters for finding installation
   * @returns ResultAsync with true if deleted, false if not found
   */
  deleteInstallation(
    query: DeleteInstallationQuery,
  ): ResultAsync<boolean, SlackError>;

  /**
   * Health check for the service
   */
  health(): Promise<{ healthy: boolean; latencyMs: number }>;

  /**
   * Cleanup resources
   */
  close(): Promise<void>;
}

/**
 * Create a Slack credential store service
 *
 * Factory function for dependency-injected credential store.
 * Factory validation throws errors (startup fail-fast behavior).
 * Service methods return ResultAsync (service boundary calls).
 *
 * @param options - Database and logger dependencies
 * @returns SlackCredentialStore instance
 */
export function createSlackCredentialStore(
  options: SlackCredentialStoreOptions,
): SlackCredentialStore {
  const { db, logger } = options;

  // Factory validation - throws are OK here (startup fail-fast)
  if (!db) throw new Error("db is required for SlackCredentialStore");
  if (!logger) throw new Error("logger is required for SlackCredentialStore");

  return {
    storeInstallation(
      input: StoreInstallationInput,
    ): ResultAsync<string, SlackError> {
      return fromPromise(storeInstallationImpl(db, logger, input), (error) => {
        logger.error(
          {
            err: error,
            teamId: input.teamId,
            enterpriseId: input.enterpriseId,
          },
          "Failed to store Slack installation",
        );
        return new SlackError(
          "INT_SLACK_TOKEN",
          "Failed to store installation",
          {
            cause: error instanceof Error ? error : new Error(String(error)),
            metadata: {
              teamId: input.teamId,
              enterpriseId: input.enterpriseId,
            },
          },
        );
      });
    },

    fetchInstallation(
      query: FetchInstallationQuery,
    ): ResultAsync<DecryptedInstallation | null, SlackError> {
      return fromPromise(fetchInstallationImpl(db, query), (error) => {
        logger.error(
          { err: error, query },
          "Failed to fetch Slack installation",
        );
        return new SlackError(
          "INT_SLACK_TOKEN",
          "Failed to fetch installation",
          {
            cause: error instanceof Error ? error : new Error(String(error)),
            metadata: { ...query },
          },
        );
      });
    },

    deleteInstallation(
      query: DeleteInstallationQuery,
    ): ResultAsync<boolean, SlackError> {
      return fromPromise(deleteInstallationImpl(db, logger, query), (error) => {
        logger.error(
          { err: error, query },
          "Failed to delete Slack installation",
        );
        return new SlackError(
          "INT_SLACK_TOKEN",
          "Failed to delete installation",
          {
            cause: error instanceof Error ? error : new Error(String(error)),
            metadata: { ...query },
          },
        );
      });
    },

    async health(): Promise<{ healthy: boolean; latencyMs: number }> {
      const start = Date.now();
      try {
        // Simple connectivity check
        await db.execute(sql`SELECT 1`);
        return { healthy: true, latencyMs: Date.now() - start };
      } catch {
        return { healthy: false, latencyMs: Date.now() - start };
      }
    },

    async close(): Promise<void> {
      // No resources to clean up - db connection is managed externally
    },
  };
}

// Internal implementation functions (throw is OK - wrapped by fromPromise)

async function storeInstallationImpl(
  db: NodePgDatabase,
  logger: PinoLogger,
  input: StoreInstallationInput,
): Promise<string> {
  const {
    teamId,
    enterpriseId,
    userId,
    isEnterpriseInstall = false,
    botToken,
    userToken,
    botId,
    botUserId,
    botScopes,
    appId,
  } = input;

  logger.info({ teamId, enterpriseId }, "Storing Slack installation");

  // Build conditions for finding existing installation
  const conditions = [
    eq(installations.team_id, teamId),
    isNull(installations.deleted_at),
  ];

  // Handle enterprise_id - NULL vs specific value
  if (enterpriseId) {
    conditions.push(eq(installations.enterprise_id, enterpriseId));
  } else {
    conditions.push(isNull(installations.enterprise_id));
  }

  // Soft-delete existing installation for this team/enterprise
  const existing = await db
    .select({ id: installations.id })
    .from(installations)
    .where(and(...conditions))
    .limit(1);

  if (existing.length > 0 && existing[0]) {
    logger.info(
      { teamId, enterpriseId, existingId: existing[0].id },
      "Soft-deleting existing Slack installation",
    );
    await db
      .update(installations)
      .set({ deleted_at: new Date() })
      .where(eq(installations.id, existing[0].id));
  }

  // Encrypt tokens
  const encryptedBotToken = encryptToken(botToken);
  const encryptedUserToken = userToken ? encryptToken(userToken) : null;

  // Insert new installation
  const id = createId.credential();

  // Build insert object with conditional property assignment
  // biome-ignore lint/suspicious/noExplicitAny: Conditional property assignment for exactOptionalPropertyTypes
  const insertData: any = {
    id,
    team_id: teamId,
    is_enterprise_install: isEnterpriseInstall,
    encrypted_bot_token: encryptedBotToken,
    token_type: "bot",
  };

  // Conditionally add optional fields
  if (enterpriseId !== undefined) {
    insertData.enterprise_id = enterpriseId;
  }
  if (userId !== undefined) {
    insertData.user_id = userId;
  }
  if (encryptedUserToken !== null) {
    insertData.encrypted_user_token = encryptedUserToken;
  }
  if (botId !== undefined) {
    insertData.bot_id = botId;
  }
  if (botUserId !== undefined) {
    insertData.bot_user_id = botUserId;
  }
  if (botScopes !== undefined) {
    insertData.bot_scopes = botScopes.join(",");
  }
  if (appId !== undefined) {
    insertData.app_id = appId;
  }

  await db.insert(installations).values(insertData);

  logger.info({ teamId, enterpriseId, id }, "Slack installation stored");
  return id;
}

async function fetchInstallationImpl(
  db: NodePgDatabase,
  query: FetchInstallationQuery,
): Promise<DecryptedInstallation | null> {
  const { teamId, enterpriseId, isEnterpriseInstall } = query;

  // Build conditions based on query
  const conditions = [isNull(installations.deleted_at)];

  if (isEnterpriseInstall && enterpriseId) {
    // Enterprise install - look up by enterprise ID only
    conditions.push(eq(installations.enterprise_id, enterpriseId));
    conditions.push(eq(installations.is_enterprise_install, true));
  } else if (teamId) {
    // Regular workspace install
    conditions.push(eq(installations.team_id, teamId));

    // Handle enterprise_id - NULL vs specific value
    if (enterpriseId) {
      conditions.push(eq(installations.enterprise_id, enterpriseId));
    }
  } else {
    // No valid query parameters
    return null;
  }

  const rows = await db
    .select()
    .from(installations)
    .where(and(...conditions))
    .limit(1);

  if (rows.length === 0 || !rows[0]) {
    return null;
  }

  return decryptInstallationRow(rows[0]);
}

async function deleteInstallationImpl(
  db: NodePgDatabase,
  logger: PinoLogger,
  query: DeleteInstallationQuery,
): Promise<boolean> {
  const { teamId, enterpriseId, isEnterpriseInstall } = query;

  logger.info({ teamId, enterpriseId }, "Deleting Slack installation");

  // Build conditions based on query
  const conditions = [isNull(installations.deleted_at)];

  if (isEnterpriseInstall && enterpriseId) {
    // Enterprise install - look up by enterprise ID only
    conditions.push(eq(installations.enterprise_id, enterpriseId));
    conditions.push(eq(installations.is_enterprise_install, true));
  } else if (teamId) {
    // Regular workspace install
    conditions.push(eq(installations.team_id, teamId));

    // Handle enterprise_id - NULL vs specific value
    if (enterpriseId) {
      conditions.push(eq(installations.enterprise_id, enterpriseId));
    }
  } else {
    // No valid query parameters
    logger.debug({ query }, "No valid query parameters for delete");
    return false;
  }

  // Check if installation exists
  const existing = await db
    .select({ id: installations.id })
    .from(installations)
    .where(and(...conditions))
    .limit(1);

  if (existing.length === 0) {
    logger.debug(
      { teamId, enterpriseId },
      "Slack installation not found or already deleted",
    );
    return false;
  }

  // Soft delete
  await db
    .update(installations)
    .set({ deleted_at: new Date() })
    // biome-ignore lint/style/noNonNullAssertion: Existence checked above with existing.length > 0
    .where(eq(installations.id, existing[0]!.id));

  return true;
}

/**
 * Decrypt an installation row from the database
 */
function decryptInstallationRow(row: Installation): DecryptedInstallation {
  return {
    id: row.id,
    teamId: row.team_id,
    enterpriseId: row.enterprise_id,
    userId: row.user_id,
    isEnterpriseInstall: row.is_enterprise_install,
    botToken: decryptToken(row.encrypted_bot_token),
    userToken: row.encrypted_user_token
      ? decryptToken(row.encrypted_user_token)
      : null,
    botId: row.bot_id,
    botUserId: row.bot_user_id,
    botScopes: row.bot_scopes ? row.bot_scopes.split(",") : [],
    appId: row.app_id,
    tokenType: row.token_type,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
