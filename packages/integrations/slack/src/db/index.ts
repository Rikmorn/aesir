/**
 * Slack Database Layer
 *
 * Barrel export for database functionality.
 */

// === CLIENT ===
export { db, pool } from "./client.js";
// === CREDENTIAL STORE ===
export type {
  DecryptedInstallation,
  DeleteInstallationQuery,
  FetchInstallationQuery,
  SlackCredentialStore,
  SlackCredentialStoreOptions,
  StoreInstallationInput,
} from "./credential-store.js";
export { createSlackCredentialStore } from "./credential-store.js";
// === ENCRYPTION ===
export {
  decryptToken,
  EncryptionKeyError,
  encryptToken,
} from "./encryption.js";
// === EVENT DELIVERY STORE ===
export type {
  RecordDeliveryInput,
  SlackEventDeliveryStore,
  SlackEventDeliveryStoreOptions,
} from "./event-delivery-store.js";
export { createSlackEventDeliveryStore } from "./event-delivery-store.js";
// === SCHEMA ===
export * from "./schema.js";
