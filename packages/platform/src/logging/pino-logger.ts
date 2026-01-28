// packages/common/src/logging/pino-logger.ts

import type { Logger } from "pino";
import pino from "pino";
import { createRedactionConfig } from "./redaction.js";
import type { ChildLoggerContext, CreateLoggerOptions } from "./types.js";

/**
 * Parse component-level log overrides from environment.
 * Format: LOG_LEVEL_INTEGRATIONS_GITHUB=debug
 * Maps to component 'integrations:github'
 */
function parseComponentLevels(): Map<string, string> {
  const levels = new Map<string, string>();

  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("LOG_LEVEL_") && key !== "LOG_LEVEL" && value) {
      // LOG_LEVEL_INTEGRATIONS_GITHUB -> integrations:github
      const component = key
        .replace("LOG_LEVEL_", "")
        .toLowerCase()
        .replace(/_/g, ":");
      levels.set(component, value.toLowerCase());
    }
  }

  return levels;
}

// Cache component levels at module load
const componentLevelOverrides = parseComponentLevels();

/**
 * Get effective log level for a component.
 * Checks component-specific override, then falls back to default.
 */
function getEffectiveLevel(
  component: string | undefined,
  defaultLevel: string,
): string {
  if (component) {
    const override = componentLevelOverrides.get(component);
    if (override) {
      return override;
    }
  }
  return defaultLevel;
}

/**
 * Create a pino logger instance with Aesir configuration.
 *
 * Configuration per CONTEXT.md:
 * - Dual timestamps (ISO 8601 + Unix epoch ms)
 * - Service and component fields in base bindings
 * - Redaction of sensitive fields (configurable via LOG_REDACT)
 * - Log level from LOG_LEVEL env var (default: 'info')
 * - Per-component overrides via LOG_LEVEL_<COMPONENT>
 *
 * @example
 * ```typescript
 * const logger = createLogger({
 *   service: 'aesir',
 *   component: 'integrations:github',
 * });
 *
 * logger.info({ prNumber: 123 }, 'PR created');
 * // Output: {"level":"info","timestamp":"2026-01-20T...","time":1737388800000,"service":"aesir","component":"integrations:github","prNumber":123,"msg":"PR created"}
 * ```
 */
export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const {
    service = process.env.SERVICE_NAME ?? "aesir",
    component,
    correlationId,
    parentCorrelationId,
    rootCorrelationId,
    level,
  } = options;

  const defaultLevel = process.env.LOG_LEVEL ?? "info";
  const effectiveLevel = level ?? getEffectiveLevel(component, defaultLevel);

  const redactionConfig = createRedactionConfig();

  return pino({
    level: effectiveLevel,

    // Base fields on every log entry
    base: {
      service,
      ...(component && { component }),
      ...(correlationId && { correlationId }),
      ...(parentCorrelationId && { parentCorrelationId }),
      ...(rootCorrelationId && { rootCorrelationId }),
    },

    // Dual timestamp format per CONTEXT.md
    // Both ISO string for humans and epoch ms for machines
    timestamp: () => {
      const now = new Date();
      return `,"timestamp":"${now.toISOString()}","time":${now.getTime()}`;
    },

    // Use string level names instead of numbers
    formatters: {
      level: (label) => ({ level: label }),
    },

    // Redaction config (only include if enabled, per exactOptionalPropertyTypes)
    ...(redactionConfig && { redact: redactionConfig }),
  });
}

/**
 * Create a child logger with additional context.
 * Child inherits all parent bindings and adds/overrides with new context.
 *
 * Use for:
 * - Adding correlation IDs to request handlers
 * - Scoping logs to specific operations
 * - Adding component-specific context
 *
 * @example
 * ```typescript
 * const baseLogger = createLogger({ service: 'aesir' });
 * const requestLogger = createChildLogger(baseLogger, {
 *   component: 'api:webhooks',
 *   correlationId: 'req_abc123',
 * });
 * ```
 */
export function createChildLogger(
  parent: Logger,
  context: ChildLoggerContext,
): Logger {
  return parent.child(context);
}
