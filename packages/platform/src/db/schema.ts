/**
 * Platform Database Schema
 *
 * Defines tables for the platform layer (workspaces, configurations).
 * Uses pgSchema for schema namespace isolation.
 */

import { createId } from "@aesir/common";
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

// Type exports
export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;
export type Configuration = typeof configurations.$inferSelect;
export type NewConfiguration = typeof configurations.$inferInsert;
