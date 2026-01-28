// packages/common/src/logging/http-logger.ts

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Logger } from "pino";
import type { HttpLogger } from "pino-http";
import { pinoHttp, stdSerializers } from "pino-http";
import { generateCorrelationId } from "./correlation.js";

/**
 * Serialized request type from pino-http stdSerializers.
 */
interface SerializedRequest {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Serialized response type from pino-http stdSerializers.
 */
interface SerializedResponse {
  statusCode: number;
}

/**
 * Options for HTTP logger middleware.
 */
export interface HttpLoggerOptions {
  /** Base logger instance to use. If not provided, uses default pino. */
  logger?: Logger;
}

/**
 * Create pino-http middleware for HTTP request/response logging.
 *
 * Features per CONTEXT.md:
 * - Generates correlation ID for each request (prefixed with req_)
 * - Maps incoming X-Correlation-ID to parentCorrelationId
 * - Logs request start and response completion
 * - Includes method, path, status code, and response time
 * - Custom log levels based on status code
 *
 * @example
 * ```typescript
 * import express from 'express';
 * import { createLogger, createHttpLogger } from "@aesir/platform";
 *
 * const app = express();
 * const baseLogger = createLogger({ component: 'api:webhooks' });
 * app.use(createHttpLogger({ logger: baseLogger }));
 * ```
 */
export function createHttpLogger(options: HttpLoggerOptions = {}): HttpLogger {
  return pinoHttp({
    logger: options.logger,

    // Generate correlation ID for each request
    genReqId: (_req: IncomingMessage, _res: ServerResponse) => {
      return generateCorrelationId("req");
    },

    // Add parent correlation ID if incoming header present
    // Per CONTEXT.md: map external ID to parent, generate new internal ID
    customProps: (req: IncomingMessage) => {
      const externalCorrelationId = req.headers["x-correlation-id"];

      if (externalCorrelationId && typeof externalCorrelationId === "string") {
        return {
          parentCorrelationId: externalCorrelationId,
        };
      }

      return {};
    },

    // Custom log levels based on response status
    customLogLevel: (
      _req: IncomingMessage,
      res: ServerResponse,
      err: Error | undefined,
    ) => {
      if (err || res.statusCode >= 500) {
        return "error";
      }
      if (res.statusCode >= 400) {
        return "warn";
      }
      return "info";
    },

    // Customize what gets logged from request
    customAttributeKeys: {
      req: "request",
      res: "response",
      err: "error",
      responseTime: "durationMs",
    },

    // Redact sensitive headers (authorization handled by pino redact)
    serializers: {
      req: (req: IncomingMessage): SerializedRequest => {
        // Use default serializer first, then pick what we want
        const serialized = stdSerializers.req(req);
        return {
          method: serialized.method,
          url: serialized.url,
          // Don't log full headers - authorization already redacted by pino
          // But we want to show correlation headers
          headers: {
            "content-type": serialized.headers["content-type"],
            "x-correlation-id": serialized.headers["x-correlation-id"],
          },
        };
      },
      res: (res: ServerResponse): SerializedResponse => ({
        statusCode: res.statusCode,
      }),
    },

    // Use correlationId as the request ID field name
    // This makes the auto-generated ID appear as correlationId in logs
    customReceivedMessage: (req: IncomingMessage) => {
      return `Request received: ${req.method} ${req.url}`;
    },

    customSuccessMessage: (
      req: IncomingMessage,
      res: ServerResponse,
      responseTime: number,
    ) => {
      return `Request completed: ${req.method} ${req.url} ${res.statusCode} ${Math.round(responseTime)}ms`;
    },

    customErrorMessage: (
      req: IncomingMessage,
      res: ServerResponse,
      err: Error,
    ) => {
      return `Request failed: ${req.method} ${req.url} ${res.statusCode} - ${err.message}`;
    },
  });
}

/**
 * Type for the HTTP logger middleware.
 * Re-export for consumers who need to type middleware arrays.
 */
export type { HttpLogger } from "pino-http";
