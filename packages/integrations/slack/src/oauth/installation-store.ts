/**
 * Slack Installation Store Adapter
 *
 * Implements Bolt's InstallationStore interface with PostgreSQL backend.
 * Bridges between Bolt's OAuth flow and our credential storage.
 */

import type { PinoLogger } from "@aesir/common";
import type {
  Installation,
  InstallationQuery,
  InstallationStore,
} from "@slack/bolt";
import type { SlackCredentialStore } from "../db/credential-store.js";

/** Options for creating a Slack installation store adapter */
export interface SlackInstallationStoreOptions {
  /** Slack credential store instance */
  credentialStore: SlackCredentialStore;
  /** Logger instance */
  logger: PinoLogger;
}

/**
 * Create a Bolt-compatible InstallationStore backed by PostgreSQL
 *
 * This adapter maps between Bolt's Installation interface and our
 * credential store, enabling OAuth installations to persist to database.
 *
 * @param options - Credential store and logger dependencies
 * @returns InstallationStore compatible with Bolt's OAuth flow
 */
export function createSlackInstallationStore(
  options: SlackInstallationStoreOptions,
): InstallationStore {
  const { credentialStore, logger } = options;

  return {
    /**
     * Store an installation from OAuth flow
     *
     * Maps Bolt's Installation to our credential store format.
     * Throws on error (Bolt expects rejected promise for failures).
     */
    storeInstallation: async (installation: Installation): Promise<void> => {
      const teamId = installation.team?.id;
      const enterpriseId = installation.enterprise?.id;

      logger.info({ teamId, enterpriseId }, "Storing Slack installation");

      if (!teamId && !enterpriseId) {
        throw new Error(
          "Installation must have either team.id or enterprise.id",
        );
      }

      const botToken = installation.bot?.token;
      if (!botToken) {
        throw new Error("Installation must have bot.token");
      }

      // Map Bolt Installation to our store format
      // biome-ignore lint/suspicious/noExplicitAny: Conditional property assignment for exactOptionalPropertyTypes
      const input: any = {
        teamId: teamId ?? "",
        botToken,
        isEnterpriseInstall: installation.isEnterpriseInstall ?? false,
      };

      // Conditionally add optional fields
      if (enterpriseId !== undefined) {
        input.enterpriseId = enterpriseId;
      }
      if (installation.user?.id !== undefined) {
        input.userId = installation.user.id;
      }
      if (installation.user?.token !== undefined) {
        input.userToken = installation.user.token;
      }
      if (installation.bot?.id !== undefined) {
        input.botId = installation.bot.id;
      }
      if (installation.bot?.userId !== undefined) {
        input.botUserId = installation.bot.userId;
      }
      if (installation.bot?.scopes !== undefined) {
        input.botScopes = installation.bot.scopes;
      }
      if (installation.appId !== undefined) {
        input.appId = installation.appId;
      }

      const result = await credentialStore.storeInstallation(input);

      if (result.isErr()) {
        throw result.error;
      }

      logger.debug(
        { teamId, enterpriseId },
        "Slack installation stored successfully",
      );
    },

    /**
     * Fetch an installation for message handling
     *
     * Maps query parameters to our credential store and returns
     * Bolt-compatible Installation object.
     */
    fetchInstallation: async (
      query: InstallationQuery<boolean>,
    ): Promise<Installation> => {
      const teamId = query.teamId;
      const enterpriseId = query.enterpriseId;
      const isEnterpriseInstall = query.isEnterpriseInstall;

      logger.debug(
        { teamId, enterpriseId, isEnterpriseInstall },
        "Fetching Slack installation",
      );

      // Build query for credential store
      // biome-ignore lint/suspicious/noExplicitAny: Conditional property assignment for exactOptionalPropertyTypes
      const storeQuery: any = {};

      if (teamId !== undefined) {
        storeQuery.teamId = teamId;
      }
      if (enterpriseId !== undefined) {
        storeQuery.enterpriseId = enterpriseId;
      }
      if (isEnterpriseInstall !== undefined) {
        storeQuery.isEnterpriseInstall = isEnterpriseInstall;
      }

      const result = await credentialStore.fetchInstallation(storeQuery);

      if (result.isErr()) {
        logger.error(
          { err: result.error, teamId, enterpriseId },
          "Failed to fetch Slack installation",
        );
        // Throw error - Bolt handles this and returns appropriate response
        throw result.error;
      }

      const credential = result.value;

      if (!credential) {
        logger.error({ teamId, enterpriseId }, "Slack installation not found");
        throw new Error(
          `No installation found for team ${teamId ?? enterpriseId}`,
        );
      }

      // Map stored credential back to Bolt Installation
      // biome-ignore lint/suspicious/noExplicitAny: Conditional property assignment for exactOptionalPropertyTypes
      const installation: any = {
        team: { id: credential.teamId },
        bot: {
          token: credential.botToken,
          scopes: credential.botScopes,
        },
        isEnterpriseInstall: credential.isEnterpriseInstall,
      };

      // Conditionally add optional fields
      if (credential.enterpriseId !== null) {
        installation.enterprise = { id: credential.enterpriseId };
      }
      if (credential.botId !== null) {
        installation.bot.id = credential.botId;
      }
      if (credential.botUserId !== null) {
        installation.bot.userId = credential.botUserId;
      }
      if (credential.userToken !== null) {
        installation.user = {
          token: credential.userToken,
        };
        if (credential.userId !== null) {
          installation.user.id = credential.userId;
        }
      }
      if (credential.appId !== null) {
        installation.appId = credential.appId;
      }

      return installation as Installation;
    },

    /**
     * Delete an installation (app uninstalled)
     *
     * Soft-deletes the installation in our credential store.
     */
    deleteInstallation: async (
      query: InstallationQuery<boolean>,
    ): Promise<void> => {
      const teamId = query.teamId;
      const enterpriseId = query.enterpriseId;
      const isEnterpriseInstall = query.isEnterpriseInstall;

      logger.info(
        { teamId, enterpriseId, isEnterpriseInstall },
        "Deleting Slack installation",
      );

      // Build query for credential store
      // biome-ignore lint/suspicious/noExplicitAny: Conditional property assignment for exactOptionalPropertyTypes
      const storeQuery: any = {};

      if (teamId !== undefined) {
        storeQuery.teamId = teamId;
      }
      if (enterpriseId !== undefined) {
        storeQuery.enterpriseId = enterpriseId;
      }
      if (isEnterpriseInstall !== undefined) {
        storeQuery.isEnterpriseInstall = isEnterpriseInstall;
      }

      const result = await credentialStore.deleteInstallation(storeQuery);

      if (result.isErr()) {
        throw result.error;
      }

      logger.debug({ teamId, enterpriseId }, "Slack installation deleted");
    },
  };
}
