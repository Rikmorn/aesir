/**
 * @aesir/test-utils
 *
 * Shared test infrastructure for the Aesir monorepo.
 *
 * Deliberately small: it holds the helpers that more than one package needs and
 * nothing speculative. Factories, MSW handlers, a credential-store double and
 * transaction helpers all lived here with no importer, and a rule file pointing
 * at them sent readers to code nothing ran (#44).
 */

// Testcontainers setup for suites that need a real PostgreSQL
export * from "./containers/index.js";
// Reads a package's real migrations, in journal order
export * from "./migrations/index.js";
// Test doubles
export * from "./mocks/index.js";
