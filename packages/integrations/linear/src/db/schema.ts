/**
 * Linear Database Schema
 *
 * Defines tables in the linear.* PostgreSQL schema namespace.
 * Linear owns its data completely for independent deployment and containerization.
 */

import { createId } from "@aesir/common";
import { pgSchema, text, timestamp, unique } from "drizzle-orm/pg-core";

export const linearSchema = pgSchema("linear");

/**
 * Credentials table
 *
 * Stores OAuth tokens for Linear workspaces.
 * Tokens are encrypted at application level before storage.
 */
export const credentials = linearSchema.table(
  "credentials",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId.credential()),
    workspace_id: text("workspace_id").notNull(),
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
    // One active credential per workspace (Linear-specific, no provider field)
    unique("credentials_workspace_unique").on(table.workspace_id),
  ],
);

/**
 * Webhook deliveries table
 *
 * Tracks webhook delivery attempts for idempotency.
 */
export const webhookDeliveries = linearSchema.table(
  "webhook_deliveries",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId.webhookDelivery()),
    delivery_id: text("delivery_id").notNull().unique(), // Linear's delivery ID
    event_type: text("event_type").notNull(),
    payload_hash: text("payload_hash"),
    processed_at: timestamp("processed_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    // Unique delivery per Linear delivery ID
    unique("webhook_deliveries_delivery_unique").on(table.delivery_id),
  ],
);

// Type exports
export type Credential = typeof credentials.$inferSelect;
export type NewCredential = typeof credentials.$inferInsert;
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
export type NewWebhookDelivery = typeof webhookDeliveries.$inferInsert;
