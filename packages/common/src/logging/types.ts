// packages/common/src/logging/types.ts

/**
 * Options for creating a logger instance.
 */
export interface CreateLoggerOptions {
  /** Service name (e.g., 'aesir', 'dev-agent'). Defaults to SERVICE_NAME env var or 'aesir'. */
  service?: string;
  /** Component identifier in layer:module format (e.g., 'integrations:github'). */
  component?: string;
  /** Initial correlation ID for request tracing. */
  correlationId?: string;
  /** Parent correlation ID if this is a child operation. */
  parentCorrelationId?: string;
  /** Root correlation ID for the request chain. */
  rootCorrelationId?: string;
  /** Log level override. Defaults to LOG_LEVEL env var or 'info'. */
  level?: string;
}

/**
 * Bindings attached to every log entry from a logger instance.
 */
export interface LoggerBindings {
  service: string;
  component?: string;
  correlationId?: string;
  parentCorrelationId?: string;
  rootCorrelationId?: string;
}

/**
 * Context for creating child loggers.
 * All fields are optional and merge with parent context.
 */
export interface ChildLoggerContext {
  component?: string;
  correlationId?: string;
  parentCorrelationId?: string;
  rootCorrelationId?: string;
  /** Additional arbitrary context fields */
  [key: string]: unknown;
}

/**
 * Re-export pino Logger type for consumers
 */
export type { Logger } from "pino";
