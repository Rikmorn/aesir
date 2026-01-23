import { AppError, type ErrorMetadata, type RecoveryHint } from "@aesir/common";

/**
 * Slack-specific error codes
 * Convention: INT_SLACK_<CONTEXT>
 */
export type SlackErrorCode =
  | "INT_SLACK_API" // Slack API errors (rate limit, network, etc)
  | "INT_SLACK_EVENT" // Event parsing, validation errors
  | "INT_SLACK_TOKEN" // Token encryption/decryption, storage errors
  | "INT_SLACK_OAUTH" // OAuth flow errors (invalid state, token exchange)
  | "INT_SLACK_DB"; // Database operation errors

/**
 * SlackError - Error type for Slack integration
 * Extends AppError with Slack-specific error codes
 */
export class SlackError extends AppError {
  readonly code: SlackErrorCode;

  constructor(
    code: SlackErrorCode,
    message: string,
    options?: {
      cause?: Error;
      metadata?: ErrorMetadata;
      recovery?: RecoveryHint;
    },
  ) {
    super(message, options);
    this.code = code;
    this.name = "SlackError";
  }

  get httpStatus(): number {
    switch (this.code) {
      case "INT_SLACK_TOKEN":
        return 401; // Unauthorized
      case "INT_SLACK_OAUTH":
        return 400; // Bad Request
      default:
        return 500; // Internal Server Error
    }
  }
}
