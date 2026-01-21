import { AppError, type ErrorMetadata, type RecoveryHint } from "@aesir/common";

/**
 * Linear-specific error codes
 * Convention: INT_LINEAR_<CONTEXT>
 */
export type LinearErrorCode =
  | "INT_LINEAR_API" // Linear API errors (rate limit, network, etc)
  | "INT_LINEAR_WEBHOOK" // Webhook signature verification, parsing errors
  | "INT_LINEAR_TOKEN" // Token encryption/decryption, storage errors
  | "INT_LINEAR_OAUTH"; // OAuth flow errors (invalid state, token exchange)

/**
 * LinearError - Error type for Linear integration
 * Extends AppError with Linear-specific error codes
 */
export class LinearError extends AppError {
  readonly code: LinearErrorCode;

  constructor(
    code: LinearErrorCode,
    message: string,
    options?: {
      cause?: Error;
      metadata?: ErrorMetadata;
      recovery?: RecoveryHint;
    },
  ) {
    super(message, options);
    this.code = code;
    this.name = "LinearError";
  }

  get httpStatus(): number {
    switch (this.code) {
      case "INT_LINEAR_WEBHOOK":
      case "INT_LINEAR_TOKEN":
        return 401; // Unauthorized
      case "INT_LINEAR_OAUTH":
        return 400; // Bad Request
      default:
        return 500; // Internal Server Error
    }
  }
}
