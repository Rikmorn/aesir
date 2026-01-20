/**
 * Logging Module Public API
 *
 * Exports pino-based structured logging utilities alongside legacy logger.
 *
 * New pino exports (preferred for new code):
 * - createPinoLogger: Factory for pino logger instances
 * - createChildLogger: Create child logger with additional context
 * - generateCorrelationId: Create prefixed correlation IDs
 *
 * Existing exports (maintained for backward compatibility):
 * - createLogger, Logger: Original implementation (will migrate in 12-04)
 * - createTimer: Timer utility
 */

// Correlation ID utilities
export {
  type CorrelationContext,
  generateChildCorrelationId,
  generateCorrelationId,
  type OperationType,
} from "./correlation.js";
// HTTP middleware
export {
  createHttpLogger,
  type HttpLogger,
  type HttpLoggerOptions,
} from "./http-logger.js";
// Existing Logger exports (maintained for backward compatibility)
// Will be migrated to pino in plan 12-04
export {
  createLogger,
  createTimer,
  type LogContext,
  type LogEntry,
  Logger,
  type LoggerOptions,
  type LogLevel,
  logger,
  type Timer,
} from "./logger.js";
// New pino-based logging (use createPinoLogger for new code)
export {
  createChildLogger,
  createLogger as createPinoLogger,
} from "./pino-logger.js";
// Redaction configuration
export { createRedactionConfig, REDACTION_PATHS } from "./redaction.js";
// Temporal adapter
export {
  createTemporalLogger,
  type TemporalLoggerInterface,
  type TemporalLogLevel,
} from "./temporal-logger.js";

// TraceStore (will be updated in plan 12-04)
export { createTraceStore, TraceStore } from "./trace-store.js";

// Types for pino logger
export type {
  ChildLoggerContext,
  CreateLoggerOptions,
  Logger as PinoLogger,
  LoggerBindings,
} from "./types.js";
