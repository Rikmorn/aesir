/**
 * Materialization Module
 *
 * Barrel export for the transparent materialization system.
 * Re-exports all public types, interfaces, and schemas.
 */

export {
  type MaterializationAdapter,
  type MaterializationConfig,
  MaterializationConfigSchema,
  type MaterializationCreateParams,
  type MaterializationCreateResult,
  type MaterializationRecord,
  type MaterializationSyncStatusParams,
  type MaterializationWebhookParams,
  type MaterializationWebhookResult,
} from "./types.js";
