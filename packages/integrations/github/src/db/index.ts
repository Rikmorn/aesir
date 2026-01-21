/**
 * GitHub Database Layer
 *
 * Barrel export for database functionality.
 */

// === CLIENT ===
export { db, pool } from "./client.js";
// === CREDENTIAL STORE ===
export type {
  DecryptedCredential,
  GitHubCredentialStore,
  GitHubCredentialStoreOptions,
  StoreCredentialInput,
} from "./credential-store.js";
export { createGitHubCredentialStore } from "./credential-store.js";
// === ENCRYPTION ===
export {
  decryptToken,
  EncryptionKeyError,
  encryptToken,
} from "./encryption.js";
// === SCHEMA ===
export * from "./schema.js";
