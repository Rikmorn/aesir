/**
 * Linear Integration Module
 *
 * @deprecated Import from @aesir/integration-linear directly.
 * This module re-exports for backward compatibility.
 *
 * The Linear integration has been extracted to a standalone package
 * (@aesir/integration-linear) to support independent deployment and versioning.
 * Update your imports to use the new package:
 *
 * @example
 * ```typescript
 * // Old (deprecated)
 * import { createLinearClient } from '@aesir/integrations';
 *
 * // New (recommended)
 * import { createLinearClient } from '@aesir/integration-linear';
 * ```
 */

// Re-export IssueStatus from common (shared type, not in integration-linear package)
export type { IssueStatus } from "@aesir/common";

// Re-export everything from the new package
export * from "@aesir/integration-linear";
