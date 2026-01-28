// packages/common/src/logging/correlation.ts
import { nanoid } from "nanoid";

/**
 * Operation types for correlation ID prefixes.
 * Each prefix indicates the origin of the operation.
 */
export type OperationType = "req" | "agent" | "tool" | "api" | "job";

/**
 * Correlation context for tracing operations across boundaries.
 * All fields are optional to support partial context.
 */
export interface CorrelationContext {
  /** Current operation's correlation ID */
  correlationId: string;
  /** Parent operation that spawned this one */
  parentCorrelationId?: string;
  /** Root request that started the chain */
  rootCorrelationId?: string;
}

/**
 * Generate a new correlation ID with operation type prefix.
 * Format: {type}_{nanoid(16)} e.g., req_V1StGXR8_Z5jdHi6
 */
export function generateCorrelationId(type: OperationType): string {
  return `${type}_${nanoid(16)}`;
}
