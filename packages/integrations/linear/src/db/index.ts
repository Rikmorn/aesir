/**
 * Linear Database Layer
 *
 * Barrel export for database functionality.
 */

// === CLIENT ===
export { db, pool } from "./client.js";
// === CREDENTIAL STORE ===
export type {
  DecryptedCredential,
  LinearCredentialStore,
  LinearCredentialStoreOptions,
  StoreCredentialInput,
} from "./credential-store.js";
export { createLinearCredentialStore } from "./credential-store.js";
// === ENCRYPTION ===
export {
  decryptToken,
  EncryptionKeyError,
  encryptToken,
} from "./encryption.js";
// === PERMISSIONS ===
export * from "./permissions.js";
// === SCHEMA ===
export * from "./schema.js";
