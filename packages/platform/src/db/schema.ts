/**
 * Platform Database Schema
 *
 * Defines tables for the platform layer (workspaces, configurations).
 * Uses pgSchema for schema namespace isolation.
 */

import { createId } from "@aesir/types";
import { sql } from "drizzle-orm";
import {
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const platformSchema = pgSchema("platform");

/**
 * Workspaces table
 *
 * Multi-tenancy support - each workspace represents an isolated tenant.
 * Single workspace used initially, schema supports future expansion.
 */
export const workspaces = platformSchema.table("workspaces", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId.workspace()),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  metadata: jsonb("metadata"),
  created_at: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  deleted_at: timestamp("deleted_at", { withTimezone: true }),
});

/**
 * Configurations table
 *
 * Key-value configuration store per workspace.
 * JSONB value allows flexible configuration shapes.
 */
export const configurations = platformSchema.table(
  "configurations",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId.configuration()),
    workspace_id: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    deleted_at: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    // Unique key per workspace (excluding soft-deleted)
    // Note: Partial index with WHERE clause applied via migration SQL
    uniqueIndex("configurations_workspace_key_unique")
      .on(table.workspace_id, table.key)
      .where(sql`${table.deleted_at} IS NULL`),
  ],
);

/**
 * Webhook deliveries table
 *
 * Tracks webhook delivery attempts for idempotency.
 */
export const webhookDeliveries = platformSchema.table(
  "webhook_deliveries",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId.webhookDelivery()),
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
    uniqueIndex("webhook_deliveries_provider_delivery_unique").on(
      table.provider,
      table.delivery_id,
    ),
  ],
);

// Type exports
export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;
export type Configuration = typeof configurations.$inferSelect;
export type NewConfiguration = typeof configurations.$inferInsert;
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
export type NewWebhookDelivery = typeof webhookDeliveries.$inferInsert;
