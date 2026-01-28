import { AppError, type ErrorMetadata } from "./app-error.js";

/**
 * UnknownError - Concrete error for wrapping unknown errors
 */
export class UnknownError extends AppError {
  readonly code: string;

  constructor(
    message: string,
    options?: {
      cause?: Error;
      metadata?: ErrorMetadata;
      code?: string;
    },
  ) {
    super(message, options);
    this.code = options?.code ?? "UNKNOWN_ERROR";
  }
}

/**
 * Wrap unknown errors with AppError for consistent handling
 *
 * - Preserves existing AppError instances
 * - Wraps standard Error with context
 * - Converts non-Error values to UnknownError
 */
export function toAppError(
  error: unknown,
  code: string,
  context?: ErrorMetadata,
): AppError {
  // Already an AppError - preserve it
  if (error instanceof AppError) {
    return error;
  }

  // Standard Error - wrap with context
  const cause = error instanceof Error ? error : new Error(String(error));
  const message = cause.message || "An unknown error occurred";

  return new UnknownError(message, {
    cause,
    ...(context !== undefined ? { metadata: context } : {}),
    code,
  });
}
