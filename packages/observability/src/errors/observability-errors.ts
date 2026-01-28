/**
 * Observability Error Classes
 *
 * Error code convention: OBS_COMPONENT_ERROR
 * - OBS_TRACKER_* for execution tracker errors
 */

import { AppError, type ErrorMetadata, type RecoveryHint } from "@aesir/types";

export type ExecutionTrackerErrorCode =
  | "OBS_TRACKER_START"
  | "OBS_TRACKER_COMPLETE"
  | "OBS_TRACKER_FAIL"
  | "OBS_TRACKER_QUERY";

export class ExecutionTrackerError extends AppError {
  readonly code: ExecutionTrackerErrorCode;

  constructor(
    code: ExecutionTrackerErrorCode,
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
