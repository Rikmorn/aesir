/**
 * Materialization Module
 *
 * Barrel export for the transparent materialization system.
 * Re-exports all public types, interfaces, schemas, and implementations.
 */

export {
  type ForwardSyncListener,
  type ForwardSyncListenerOptions,
  createForwardSyncListener,
} from "./forward-sync.js";
export {
  type LinearMaterializationAdapterOptions,
  createLinearMaterializationAdapter,
} from "./linear-adapter.js";
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
