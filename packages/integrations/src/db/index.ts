export { closeDatabase, db } from "./client.js";
export {
  createCredentialStore,
  type CredentialProvider,
  type CredentialStore,
  type CredentialStoreOptions,
  type DecryptedCredential,
  deleteCredential,
  getCredential,
  getCredentialByProvider,
  type StoreCredentialInput,
  storeCredential,
  updateCredentialTokens,
} from "./credential-store.js";
export {
  decryptToken,
  EncryptionKeyError,
  encryptToken,
} from "./encryption.js";
export * from "./schema.js";
