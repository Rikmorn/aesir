// packages/common/src/logging/redaction.ts
import type { LoggerOptions } from "pino";

/**
 * Field paths to redact from log output.
 * Uses pino's path syntax: 'field' matches top-level, '*.field' matches nested.
 *
 * IMPORTANT: Avoid ** wildcards - they add ~50% overhead.
 * List explicit paths for performance.
 */
export const REDACTION_PATHS = [
  // Auth tokens
  "password",
  "*.password",
  "token",
  "*.token",
  "accessToken",
  "*.accessToken",
  "refreshToken",
  "*.refreshToken",

  // API keys
  "secret",
  "*.secret",
  "apiKey",
  "*.apiKey",
  "apiSecret",
  "*.apiSecret",

  // HTTP headers
  "authorization",
  "*.authorization",
  "req.headers.authorization",
  "req.headers.cookie",

  // Common secret patterns
  "credentials",
  "*.credentials",
  "privateKey",
  "*.privateKey",
];

/**
 * Create pino redaction configuration.
 * Returns undefined if LOG_REDACT=false (for development).
 */
export function createRedactionConfig(): LoggerOptions["redact"] | undefined {
  const redactEnabled = process.env.LOG_REDACT !== "false";

  if (!redactEnabled) {
    return undefined;
  }

  return {
    paths: REDACTION_PATHS,
    censor: "[REDACTED]",
  };
}
