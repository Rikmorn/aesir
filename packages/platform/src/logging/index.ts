/**
 * Logging Module Public API
 *
 * Exports pino-based structured logging utilities.
 */

// Correlation ID utilities
export {
  type CorrelationContext,
  generateCorrelationId,
  type OperationType,
} from "./correlation.js";

// HTTP middleware
export {
  createHttpLogger,
  type HttpLogger,
  type HttpLoggerOptions,
} from "./http-logger.js";
// Core logger factory
export {
  createChildLogger,
  createLogger,
  // Re-export as createPinoLogger for explicit naming during migration
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
// TraceEntry types for workflow debugging
export type {
  TraceContext,
  TraceEntry,
  TraceLevel,
} from "./trace-entry.js";
// TraceStore for workflow observability
export { createTraceStore, TraceStore } from "./trace-store.js";
// Types for pino logger
// Re-export Logger as PinoLogger for explicit naming
export type {
  ChildLoggerContext,
  CreateLoggerOptions,
  Logger,
  Logger as PinoLogger,
  LoggerBindings,
} from "./types.js";
