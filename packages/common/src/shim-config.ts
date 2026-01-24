/**
 * TEMPORARY CONFIG SHIM
 *
 * This is a temporary shim to prevent build failures during the config extraction
 * process (Phase 22.1). Each package should eventually have its own config.ts.
 *
 * This file provides the config interface without validation, reading directly
 * from process.env. It will be removed when all packages have their own config.
 *
 * TODO: Remove this file after Plans 22.1-02 through 22.1-05 are complete.
 *
 * @deprecated Use package-specific config.ts instead
 */

/**
 * Temporary config object that reads from process.env without validation
 *
 * @deprecated Each package should have its own config.ts with proper validation
 */
export const config = {
  database: {
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT) || 5432,
    user: process.env.DB_USER || "temporal",
    password: process.env.DB_PASSWORD || "temporal",
    name: process.env.DB_NAME || "temporal",
    url:
      process.env.DATABASE_URL ||
      `postgresql://${process.env.DB_USER || "temporal"}:${process.env.DB_PASSWORD || "temporal"}@${process.env.DB_HOST || "localhost"}:${process.env.DB_PORT || "5432"}/${process.env.DB_NAME || "temporal"}`,
    encryptionKey: process.env.CREDENTIAL_ENCRYPTION_KEY,
  },
  retention: {
    days: Number(process.env.RETENTION_DAYS) || 14,
  },
} as const;
