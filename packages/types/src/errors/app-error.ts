/**
 * AppError - Base class for all application errors
 *
 * Error code convention: LAYER_COMPONENT_ERROR
 * - INT_LINEAR_RATE_LIMIT, INT_GITHUB_NOT_FOUND, INT_SLACK_AUTH
 * - PLT_DB_CONNECTION, PLT_TEMPORAL_TIMEOUT
 * - AGT_EXECUTION_FAILED, AGT_WORKFLOW_INVALID
 */

export interface ErrorMetadata {
  [key: string]: unknown;
}

export interface RecoveryHint {
  isRecoverable: boolean;
  hint?: string;
}

export abstract class AppError extends Error {
  abstract readonly code: string;
  readonly cause?: Error;
  readonly metadata: ErrorMetadata;
  readonly recovery?: RecoveryHint;
  readonly timestamp: Date;

  constructor(
    message: string,
    options?: {
      cause?: Error;
      metadata?: ErrorMetadata;
      recovery?: RecoveryHint;
    },
  ) {
    super(message);
    this.name = this.constructor.name;
    this.metadata = options?.metadata ?? {};
    this.timestamp = new Date();
    // Handle exactOptionalPropertyTypes - only assign if defined
    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
    if (options?.recovery !== undefined) {
      this.recovery = options.recovery;
    }
    Object.setPrototypeOf(this, new.target.prototype);
  }

  // Override in subclasses for HTTP mapping
  get httpStatus(): number {
    return 500;
  }

  // Serialize for logging
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      httpStatus: this.httpStatus,
      metadata: this.metadata,
      recovery: this.recovery,
      timestamp: this.timestamp.toISOString(),
      cause: this.cause?.message,
      stack: this.stack,
    };
  }
}
