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
// === PERMISSIONS ===
export * from "./permissions.js";
// === SCHEMA ===
export * from "./schema.js";
// === WEBHOOK DELIVERY STORE ===
export type {
  RecordDeliveryInput,
  WebhookDeliveryStore,
  WebhookDeliveryStoreOptions,
} from "./webhook-delivery-store.js";
export { createWebhookDeliveryStore } from "./webhook-delivery-store.js";
