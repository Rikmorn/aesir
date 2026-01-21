/**
 * Linear Database Schema (Drizzle Kit Version)
 *
 * This file is ONLY for drizzle-kit migration generation.
 * Uses inline nanoid instead of @aesir/common to avoid CJS bundler issues.
 *
 * DO NOT import this file in application code - use schema.ts instead.
 */

import { pgSchema, text, timestamp, unique } from "drizzle-orm/pg-core";
import { customAlphabet } from "nanoid";

const nanoid = customAlphabet(
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  24,
);

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
      .$defaultFn(() => `cred_${nanoid()}`),
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
      .$defaultFn(() => `whd_${nanoid()}`),
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
