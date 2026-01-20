/**
 * Platform Database Schema - Drizzle-Kit Version
 *
 * This file is used by drizzle-kit for migration generation.
 * It mirrors schema.ts but without external dependencies that
 * drizzle-kit's CJS bundler cannot resolve.
 *
 * Keep in sync with schema.ts.
 */

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
 */
export const workspaces = platformSchema.table("workspaces", {
  id: text("id").primaryKey(),
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
 */
export const configurations = platformSchema.table(
  "configurations",
  {
    id: text("id").primaryKey(),
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
    uniqueIndex("configurations_workspace_key_unique")
      .on(table.workspace_id, table.key)
      .where(sql`${table.deleted_at} IS NULL`),
  ],
);
