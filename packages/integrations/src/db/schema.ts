/**
 * Integrations Database Schema
 *
 * Defines tables for the integrations layer (credentials, webhook deliveries, sync cursors).
 * Uses pgSchema for schema namespace isolation.
 */

import { createId } from "@aesir/common";
import { pgSchema, text, timestamp, unique } from "drizzle-orm/pg-core";

export const integrationsSchema = pgSchema("integrations");

/**
 * Credentials table
 *
 * Stores OAuth tokens and API credentials for external integrations.
 * Tokens are encrypted at application level before storage.
 */
export const credentials = integrationsSchema.table(
  "credentials",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId.credential()),
    workspace_id: text("workspace_id").notNull(),
    provider: text("provider").notNull(), // 'linear', 'github', 'slack'
    encrypted_access_token: text("encrypted_access_token").notNull(),
    encrypted_refresh_token: text("encrypted_refresh_token"),
    token_type: text("token_type").default("Bearer"),
    scope: text("scope"),
    expires_at: timestamp("expires_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    deleted_at: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    // One active credential per workspace+provider
    unique("credentials_workspace_provider_unique").on(
      table.workspace_id,
      table.provider,
    ),
  ],
);

/**
 * Webhook deliveries table
 *
 * Tracks webhook delivery attempts for idempotency.
 */
export const webhookDeliveries = integrationsSchema.table(
  "webhook_deliveries",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId.webhookDelivery()),
    provider: text("provider").notNull(),
    delivery_id: text("delivery_id").notNull(), // Provider's delivery ID
    event_type: text("event_type").notNull(),
    payload_hash: text("payload_hash"),
    processed_at: timestamp("processed_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    // Unique delivery per provider
    unique("webhook_deliveries_provider_delivery_unique").on(
      table.provider,
      table.delivery_id,
    ),
  ],
);

/**
 * Sync cursors table
 *
 * Tracks synchronization progress for incremental syncs.
 */
export const syncCursors = integrationsSchema.table(
  "sync_cursors",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId.syncCursor()),
    workspace_id: text("workspace_id").notNull(),
    provider: text("provider").notNull(),
    resource_type: text("resource_type").notNull(), // 'issues', 'comments', etc.
    cursor: text("cursor"), // Provider-specific cursor value
    last_sync_at: timestamp("last_sync_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    // One cursor per workspace+provider+resource
    unique("sync_cursors_workspace_provider_resource_unique").on(
      table.workspace_id,
      table.provider,
      table.resource_type,
    ),
  ],
);

// Type exports
export type Credential = typeof credentials.$inferSelect;
export type NewCredential = typeof credentials.$inferInsert;
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
export type NewWebhookDelivery = typeof webhookDeliveries.$inferInsert;
export type SyncCursor = typeof syncCursors.$inferSelect;
export type NewSyncCursor = typeof syncCursors.$inferInsert;
