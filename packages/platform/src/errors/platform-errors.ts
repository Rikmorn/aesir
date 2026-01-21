/**
 * Platform Error Classes
 *
 * Error code convention: PLT_COMPONENT_ERROR
 * - PLT_DB_* for database errors
 * - PLT_TEMPORAL_* for Temporal errors
 * - PLT_SANDBOX_* for sandbox errors
 * - PLT_CLEANUP_* for cleanup service errors
 */

import { AppError, type ErrorMetadata, type RecoveryHint } from "@aesir/common";

// Database error codes
export type DatabaseErrorCode =
  | "PLT_DB_CONNECTION"
  | "PLT_DB_QUERY"
  | "PLT_DB_CONSTRAINT"
  | "PLT_DB_TIMEOUT";

export class DatabaseError extends AppError {
  readonly code: DatabaseErrorCode;

  constructor(
    code: DatabaseErrorCode,
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
      case "PLT_DB_TIMEOUT":
        return 504;
      default:
        return 500;
    }
  }
}

// Temporal error codes
export type TemporalErrorCode =
  | "PLT_TEMPORAL_CONNECTION"
  | "PLT_TEMPORAL_TIMEOUT"
  | "PLT_TEMPORAL_WORKFLOW"
  | "PLT_TEMPORAL_SIGNAL";

export class TemporalError extends AppError {
  readonly code: TemporalErrorCode;

  constructor(
    code: TemporalErrorCode,
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
      case "PLT_TEMPORAL_TIMEOUT":
        return 504;
      default:
        return 500;
    }
  }
}

// Sandbox error codes
export type SandboxErrorCode =
  | "PLT_SANDBOX_START"
  | "PLT_SANDBOX_TIMEOUT"
  | "PLT_SANDBOX_EXECUTION"
  | "PLT_SANDBOX_CLEANUP";

export class SandboxError extends AppError {
  readonly code: SandboxErrorCode;

  constructor(
    code: SandboxErrorCode,
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
      case "PLT_SANDBOX_TIMEOUT":
        return 504;
      default:
        return 500;
    }
  }
}

// Cleanup service error codes
export type CleanupErrorCode =
  | "PLT_CLEANUP_CHECKPOINTS"
  | "PLT_CLEANUP_WEBHOOKS"
  | "PLT_CLEANUP_EXECUTIONS";

export class CleanupError extends AppError {
  readonly code: CleanupErrorCode;

  constructor(
    code: CleanupErrorCode,
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
