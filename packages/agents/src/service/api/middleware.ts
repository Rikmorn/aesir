/**
 * API Middleware
 *
 * Shared utilities for /api/ route handlers:
 * - sendApiError: consistent error envelope
 * - validateParams: pure Zod validation (no Express middleware)
 * - asyncHandler: wraps async Express handlers with error catching
 */

import type { PinoLogger } from "@aesir/platform";
import type { NextFunction, Request, Response } from "express";
import type { ZodError, ZodType } from "zod";
import { type ApiError, ErrorCodes } from "./types.js";

// ─── Error Envelope ──────────────────────────────────────────────────────────

/**
 * Send a standardized error response.
 * All /api/ endpoints use this for consistent error formatting.
 */
export function sendApiError(
  res: Response,
  status: number,
  code: string,
  message: string,
  details?: unknown[],
): void {
  const body: ApiError = {
    error: {
      code,
      message,
    },
  };
  if (details) {
    body.error.details = details;
  }
  res.status(status).json(body);
}

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Result type for validateParams.
 * Discriminated union so callers can handle success/failure cleanly.
 */
export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; error: ZodError };

/**
 * Pure function that validates params against a Zod schema.
 * Does NOT touch Express req/res -- callers decide how to respond.
 */
export function validateParams<T>(
  schema: ZodType<T>,
  params: unknown,
): ValidationResult<T> {
  const result = schema.safeParse(params);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}

// ─── Async Handler Wrapper ───────────────────────────────────────────────────

/**
 * Wraps an async Express route handler to catch unhandled errors
 * and respond with a standardized INTERNAL_ERROR envelope.
 *
 * Usage:
 *   router.get("/", asyncHandler(logger, async (req, res) => { ... }));
 */
export function asyncHandler(
  logger: PinoLogger,
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch((err: unknown) => {
      logger.error({ err, path: req.path }, "Unhandled API error");
      if (!res.headersSent) {
        sendApiError(
          res,
          500,
          ErrorCodes.INTERNAL_ERROR,
          "Internal server error",
        );
      }
    });
  };
}
