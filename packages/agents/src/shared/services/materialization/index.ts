/**
 * Materialization Module
 *
 * Barrel export for the transparent materialization system.
 * Re-exports all public types, interfaces, schemas, and implementations.
 */

export {
  createForwardSyncListener,
  type ForwardSyncListener,
  type ForwardSyncListenerOptions,
} from "./forward-sync.js";
export {
  createLinearMaterializationAdapter,
  type LinearMaterializationAdapterOptions,
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
