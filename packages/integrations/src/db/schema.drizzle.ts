/**
 * Integrations Database Schema - Drizzle-Kit Version
 *
 * This file is used by drizzle-kit for migration generation.
 * It mirrors schema.ts but without external dependencies that
 * drizzle-kit's CJS bundler cannot resolve.
 *
 * Keep in sync with schema.ts.
 */

import { pgSchema, text, timestamp, unique } from "drizzle-orm/pg-core";

export const integrationsSchema = pgSchema("integrations");

/**
 * Credentials table
 */
export const credentials = integrationsSchema.table(
  "credentials",
  {
    id: text("id").primaryKey(),
    workspace_id: text("workspace_id").notNull(),
    provider: text("provider").notNull(),
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
    unique("credentials_workspace_provider_unique").on(
      table.workspace_id,
      table.provider,
    ),
  ],
);

/**
 * Webhook deliveries table
 */
export const webhookDeliveries = integrationsSchema.table(
  "webhook_deliveries",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    delivery_id: text("delivery_id").notNull(),
    event_type: text("event_type").notNull(),
    payload_hash: text("payload_hash"),
    processed_at: timestamp("processed_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("webhook_deliveries_provider_delivery_unique").on(
      table.provider,
      table.delivery_id,
    ),
  ],
);

/**
 * Sync cursors table
 */
export const syncCursors = integrationsSchema.table(
  "sync_cursors",
  {
    id: text("id").primaryKey(),
    workspace_id: text("workspace_id").notNull(),
    provider: text("provider").notNull(),
    resource_type: text("resource_type").notNull(),
    cursor: text("cursor"),
    last_sync_at: timestamp("last_sync_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("sync_cursors_workspace_provider_resource_unique").on(
      table.workspace_id,
      table.provider,
      table.resource_type,
    ),
  ],
);
