/**
 * Mock Credential Store
 *
 * In-memory credential store for testing without database.
 */

import { errAsync, okAsync, type ResultAsync } from "neverthrow";

import type { TestCredential } from "../factories/credentials.js";

export interface MockCredentialStoreError {
  code: string;
  message: string;
}

export interface MockCredentialStore {
  store: (
    input: Partial<TestCredential> & {
      workspaceId: string;
      accessToken: string;
    },
  ) => ResultAsync<TestCredential, MockCredentialStoreError>;

  get: (
    id: string,
  ) => ResultAsync<TestCredential | null, MockCredentialStoreError>;

  getByWorkspace: (
    workspaceId: string,
  ) => ResultAsync<TestCredential | null, MockCredentialStoreError>;

  updateTokens: (
    id: string,
    tokens: {
      accessToken?: string;
      refreshToken?: string | null;
      expiresAt?: Date | null;
    },
  ) => ResultAsync<TestCredential, MockCredentialStoreError>;

  delete: (id: string) => ResultAsync<boolean, MockCredentialStoreError>;

  health: () => Promise<{ healthy: boolean; latencyMs: number }>;
  close: () => Promise<void>;

  // Test utilities
  credentials: Map<string, TestCredential>;
  clear: () => void;
}

let storeCounter = 0;

export function createMockCredentialStore(): MockCredentialStore {
  const credentials = new Map<string, TestCredential>();

  const store: MockCredentialStore = {
    store: (input) => {
      const id = `mock_cred_${storeCounter++}`;
      const credential: TestCredential = {
        id,
        workspaceId: input.workspaceId,
        provider: input.provider ?? "linear",
        accessToken: input.accessToken,
        refreshToken: input.refreshToken ?? null,
        tokenType: input.tokenType ?? "Bearer",
        scope: input.scope ?? null,
        expiresAt: input.expiresAt ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      credentials.set(id, credential);
      return okAsync(credential);
    },

    get: (id) => {
      const cred = credentials.get(id);
      return okAsync(cred ?? null);
    },

    getByWorkspace: (workspaceId) => {
      for (const cred of credentials.values()) {
        if (cred.workspaceId === workspaceId) {
          return okAsync(cred);
        }
      }
      return okAsync(null);
    },

    updateTokens: (id, tokens) => {
      const cred = credentials.get(id);
      if (!cred) {
        return errAsync({
          code: "NOT_FOUND",
          message: `Credential ${id} not found`,
        });
      }

      const updated: TestCredential = {
        ...cred,
        ...(tokens.accessToken !== undefined && {
          accessToken: tokens.accessToken,
        }),
        ...(tokens.refreshToken !== undefined && {
          refreshToken: tokens.refreshToken,
        }),
        ...(tokens.expiresAt !== undefined && { expiresAt: tokens.expiresAt }),
        updatedAt: new Date(),
      };
      credentials.set(id, updated);
      return okAsync(updated);
    },

    delete: (id) => {
      const existed = credentials.has(id);
      credentials.delete(id);
      return okAsync(existed);
    },

    health: async () => ({ healthy: true, latencyMs: 0 }),
    close: async () => {},

    credentials,
    clear: () => {
      credentials.clear();
      storeCounter = 0;
    },
  };

  return store;
}

/**
 * Reset the store counter for test isolation.
 * Call this in beforeEach() to ensure consistent IDs across test runs.
 */
export function resetMockCredentialStoreCounter(): void {
  storeCounter = 0;
}
