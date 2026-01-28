// packages/common/src/logging/temporal-logger.ts

import type { Logger } from "pino";
import { createLogger } from "./pino-logger.js";

/**
 * Temporal log levels mapped to pino levels.
 * Temporal uses uppercase: TRACE, DEBUG, INFO, WARN, ERROR
 * Pino uses lowercase: trace, debug, info, warn, error
 */
const TEMPORAL_TO_PINO_LEVEL: Record<string, keyof Logger> = {
  TRACE: "trace",
  DEBUG: "debug",
  INFO: "info",
  WARN: "warn",
  ERROR: "error",
};

/**
 * Temporal log level type.
 * Re-defined here to avoid requiring @temporalio/worker as a direct dependency.
 */
export type TemporalLogLevel = "TRACE" | "DEBUG" | "INFO" | "WARN" | "ERROR";

/**
 * Temporal Logger interface.
 * Re-defined here for type compatibility without requiring @temporalio/worker import.
 */
export interface TemporalLoggerInterface {
  log(
    level: TemporalLogLevel,
    message: string,
    meta?: Record<string, unknown>,
  ): void;
  trace(message: string, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/**
 * Create a Temporal-compatible logger that routes to pino.
 *
 * Use this when configuring Temporal Runtime to ensure all Temporal
 * internal logs flow through the same pino infrastructure.
 *
 * Note: This function returns a logger that implements Temporal's Logger interface.
 * You need @temporalio/worker installed to use this with Temporal Runtime.
 *
 * @param baseLogger - Optional base pino logger to use. If not provided, creates a new one.
 * @returns A Temporal-compatible logger that routes to pino
 *
 * @example
 * ```typescript
 * import { Runtime } from '@temporalio/worker';
 * import { createTemporalLogger } from "@aesir/platform";
 *
 * // Install before creating workers
 * Runtime.install({
 *   logger: createTemporalLogger(),
 * });
 * ```
 */
export function createTemporalLogger(
  baseLogger?: Logger,
): TemporalLoggerInterface {
  const logger =
    baseLogger ??
    createLogger({
      component: "platform:temporal",
    });

  const logLevel =
    (process.env.LOG_LEVEL?.toUpperCase() as TemporalLogLevel) ?? "INFO";
  const severities: TemporalLogLevel[] = [
    "TRACE",
    "DEBUG",
    "INFO",
    "WARN",
    "ERROR",
  ];
  const minSeverity = severities.indexOf(logLevel);

  const shouldLog = (level: TemporalLogLevel): boolean => {
    return severities.indexOf(level) >= minSeverity;
  };

  const logAtLevel = (
    level: TemporalLogLevel,
    message: string,
    meta?: Record<string, unknown>,
  ): void => {
    if (!shouldLog(level)) {
      return;
    }

    const pinoLevel = TEMPORAL_TO_PINO_LEVEL[level] ?? "info";
    const logMethod = logger[pinoLevel] as (obj: object, msg: string) => void;

    if (typeof logMethod === "function") {
      logMethod.call(logger, { ...meta, temporal: true }, message);
    }
  };

  return {
    log: logAtLevel,
    trace: (message, meta) => logAtLevel("TRACE", message, meta),
    debug: (message, meta) => logAtLevel("DEBUG", message, meta),
    info: (message, meta) => logAtLevel("INFO", message, meta),
    warn: (message, meta) => logAtLevel("WARN", message, meta),
    error: (message, meta) => logAtLevel("ERROR", message, meta),
  };
}
