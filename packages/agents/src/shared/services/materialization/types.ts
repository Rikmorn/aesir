/**
 * Materialization Types
 *
 * Foundation types for the transparent materialization system.
 * Defines the adapter interface, config schema, and record types
 * used by all materialization implementations.
 *
 * The MaterializationAdapter interface is the extensibility seam --
 * dispatch is a simple switch on the `target` field.
 */

import { z } from "zod";

// ─── Configuration Schema ────────────────────────────────────────────────────

/**
 * MaterializationConfig Zod schema.
 *
 * Validates the materialization configuration passed via delegate_task.
 * Shape locked by CONTEXT.md decisions:
 * - type: "transparent" (only supported mode)
 * - target: "linear" (extensible enum for future targets)
 * - properties: target-specific optional properties
 */
export const MaterializationConfigSchema = z.object({
  type: z.literal("transparent"),
  target: z.enum(["linear"]),
  properties: z
    .object({
      /** Priority for the target system (Linear: urgent/high/medium/low/none) */
      priority: z.enum(["urgent", "high", "medium", "low", "none"]).optional(),
      /** Additional labels to apply in the target system */
      labels: z.array(z.string()).optional(),
      /** Override team placement (Linear team ID) */
      teamId: z.string().optional(),
    })
    .optional(),
});

export type MaterializationConfig = z.infer<typeof MaterializationConfigSchema>;

// ─── Adapter Interface ───────────────────────────────────────────────────────

/**
 * Parameters for creating a materialized external artifact.
 */
export interface MaterializationCreateParams {
  /** Internal task ID */
  taskId: string;
  /** Owning conversation ID */
  conversationId: string;
  /** Agent that requested materialization */
  agentId: string;
  /** Task description (becomes the external artifact's description) */
  description: string;
  /** Target-specific properties (priority, labels, teamId) */
  properties?: MaterializationConfig["properties"];
  /** Parent issue ID for sub-issue creation */
  parentIssueId?: string;
  /** Correlation ID for tracing */
  correlationId: string;
}

/**
 * Result of creating a materialized external artifact.
 */
export interface MaterializationCreateResult {
  /** External system's ID for the created artifact */
  externalId: string;
  /** URL to the external artifact */
  externalUrl: string;
}

/**
 * Parameters for syncing internal status to external artifact.
 */
export interface MaterializationSyncStatusParams {
  /** External system's ID for the artifact */
  externalId: string;
  /** Internal task ID (for logging/correlation) */
  taskId: string;
  /** New internal status to sync */
  newStatus: "active" | "completed" | "cancelled";
}

/**
 * Parameters for handling an incoming webhook from the external system.
 */
export interface MaterializationWebhookParams {
  /** External system's ID for the artifact */
  externalId: string;
  /** Type of event from the external system */
  eventType: string;
  /** Raw event data from the external system */
  eventData: Record<string, unknown>;
}

/**
 * Result of processing a webhook -- a signal to deliver to the owning conversation.
 * Returns null when the webhook should be ignored (e.g., echo of our own change).
 */
export interface MaterializationWebhookResult {
  /** Signal type to deliver (e.g., "task_cancelled", "informational") */
  signalType: string;
  /** Signal payload */
  signalData: Record<string, unknown>;
  /** Target conversation ID */
  conversationId: string;
  /** Deduplication ID for signal delivery */
  deduplicationId: string;
}

/**
 * MaterializationAdapter interface.
 *
 * The extensibility seam for materialization targets.
 * Each target (Linear, GitHub Issues, etc.) implements this interface.
 * Dispatch is a simple switch on the `target` field in the config.
 */
export interface MaterializationAdapter {
  /**
   * Create the external artifact (e.g., Linear issue).
   * Returns the external ID and URL, or null on graceful failure.
   * Delegation proceeds even if materialization fails.
   */
  create(
    params: MaterializationCreateParams,
  ): Promise<MaterializationCreateResult | null>;

  /**
   * Sync internal status change to external artifact.
   * Fire-and-forget: swallows errors internally, never blocks internal state changes.
   */
  syncStatus(params: MaterializationSyncStatusParams): Promise<void>;

  /**
   * Handle incoming webhook for a materialized artifact.
   * Returns a signal to deliver, or null to ignore.
   */
  handleWebhook(
    params: MaterializationWebhookParams,
  ): MaterializationWebhookResult | null;
}

// ─── Record Type ─────────────────────────────────────────────────────────────

/**
 * MaterializationRecord matches the agents.materialization_records DB table shape.
 * Used for correlation lookups during webhook routing and status sync.
 */
export interface MaterializationRecord {
  task_id: string;
  target: string;
  external_id: string;
  external_url: string | null;
  conversation_id: string;
  agent_id: string;
  config: Record<string, unknown>;
  sync_status: "active" | "completed" | "failed";
  created_at: Date;
  updated_at: Date;
}
