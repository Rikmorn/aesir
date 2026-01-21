import { AppError, type ErrorMetadata, type RecoveryHint } from "@aesir/common";

/**
 * GitHub-specific error codes
 * Convention: INT_GITHUB_<CONTEXT>
 */
export type GitHubErrorCode =
  | "INT_GITHUB_API" // GitHub API errors (rate limit, network, etc)
  | "INT_GITHUB_WEBHOOK" // Webhook signature verification, parsing errors
  | "INT_GITHUB_TOKEN" // Token encryption/decryption, storage errors
  | "INT_GITHUB_OAUTH"; // OAuth flow errors (invalid state, token exchange)

/**
 * GitHubError - Error type for GitHub integration
 * Extends AppError with GitHub-specific error codes
 */
export class GitHubError extends AppError {
  readonly code: GitHubErrorCode;

  constructor(
    code: GitHubErrorCode,
    message: string,
    options?: {
      cause?: Error;
      metadata?: ErrorMetadata;
      recovery?: RecoveryHint;
    },
  ) {
    super(message, options);
    this.code = code;
    this.name = "GitHubError";
  }

  get httpStatus(): number {
    switch (this.code) {
      case "INT_GITHUB_WEBHOOK":
      case "INT_GITHUB_TOKEN":
        return 401; // Unauthorized
      case "INT_GITHUB_OAUTH":
        return 400; // Bad Request
      default:
        return 500; // Internal Server Error
    }
  }
}
