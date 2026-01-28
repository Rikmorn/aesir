import {
  AppError,
  type ErrorMetadata,
  type RecoveryHint,
} from "./app-error.js";

/**
 * Zod-compatible flattened errors type
 * Matches output of ZodError.flatten()
 */
export interface FlattenedErrors {
  formErrors: string[];
  fieldErrors: Record<string, string[]>;
}

/**
 * ValidationError - For Zod validation failures and input validation
 */
export class ValidationError extends AppError {
  readonly code: string;
  readonly validationErrors: FlattenedErrors;

  constructor(
    code: string,
    message: string,
    options?: {
      cause?: Error;
      metadata?: ErrorMetadata;
      recovery?: RecoveryHint;
      validationErrors?: FlattenedErrors;
    },
  ) {
    super(message, options);
    this.code = code;
    this.validationErrors = options?.validationErrors ?? {
      formErrors: [],
      fieldErrors: {},
    };
  }

  override get httpStatus(): number {
    return 400; // Bad Request for validation errors
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      validationErrors: this.validationErrors,
    };
  }
}
