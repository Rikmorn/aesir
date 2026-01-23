/**
 * Mock Implementations
 *
 * Test doubles for common services and interfaces.
 */

export {
  createMockCredentialStore,
  type MockCredentialStore,
  type MockCredentialStoreError,
  resetMockCredentialStoreCounter,
} from "./credential-store.js";
export {
  createMockLogger,
  type LogCall,
  type MockLogger,
  type MockLoggerOptions,
} from "./logger.js";
