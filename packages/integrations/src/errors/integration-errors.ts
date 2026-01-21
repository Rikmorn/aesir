/**
 * Integration-specific error classes
 *
 * Each error class extends AppError with typed error codes following
 * the LAYER_COMPONENT_ERROR convention (INT_LINEAR_*, INT_GITHUB_*, etc.)
 */

import { AppError, type ErrorMetadata, type RecoveryHint } from "@aesir/common";

// Linear error codes
export type LinearErrorCode =
  | "INT_LINEAR_NOT_FOUND"
  | "INT_LINEAR_RATE_LIMIT"
  | "INT_LINEAR_AUTH"
  | "INT_LINEAR_API"
  | "INT_LINEAR_VALIDATION";

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
  }

  override get httpStatus(): number {
    switch (this.code) {
      case "INT_LINEAR_NOT_FOUND":
        return 404;
      case "INT_LINEAR_RATE_LIMIT":
        return 429;
      case "INT_LINEAR_AUTH":
        return 401;
      default:
        return 500;
    }
  }
}

// GitHub error codes
export type GitHubErrorCode =
  | "INT_GITHUB_NOT_FOUND"
  | "INT_GITHUB_RATE_LIMIT"
  | "INT_GITHUB_AUTH"
  | "INT_GITHUB_API"
  | "INT_GITHUB_VALIDATION";

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
  }

  override get httpStatus(): number {
    switch (this.code) {
      case "INT_GITHUB_NOT_FOUND":
        return 404;
      case "INT_GITHUB_RATE_LIMIT":
        return 429;
      case "INT_GITHUB_AUTH":
        return 401;
      default:
        return 500;
    }
  }
}

// Slack error codes
export type SlackErrorCode =
  | "INT_SLACK_NOT_FOUND"
  | "INT_SLACK_RATE_LIMIT"
  | "INT_SLACK_AUTH"
  | "INT_SLACK_API"
  | "INT_SLACK_VALIDATION";

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
  }

  override get httpStatus(): number {
    switch (this.code) {
      case "INT_SLACK_NOT_FOUND":
        return 404;
      case "INT_SLACK_RATE_LIMIT":
        return 429;
      case "INT_SLACK_AUTH":
        return 401;
      default:
        return 500;
    }
  }
}

// Credential store error codes
export type CredentialErrorCode =
  | "INT_CRED_NOT_FOUND"
  | "INT_CRED_ENCRYPTION"
  | "INT_CRED_DECRYPTION"
  | "INT_CRED_STORE"
  | "INT_CRED_DELETE";

export class CredentialError extends AppError {
  readonly code: CredentialErrorCode;

  constructor(
    code: CredentialErrorCode,
    message: string,
    options?: {
      cause?: Error;
      metadata?: ErrorMetadata;
      recovery?: RecoveryHint;
    },
  ) {
    super(message, options);
    this.code = code;
  }
}
