/**
 * Dev Containers Schema
 *
 * Tracks dev container state for lifecycle management.
 * Database-first approach enables multi-host scenarios and audit trail.
 */

import { createId } from "@aesir/types";
import { text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { platformSchema } from "../schema.js";

/**
 * Dev containers table
 *
 * Tracks container state per task. One container per task (1:1 mapping).
 * Status synced with Docker API on each operation.
 */
export const devContainers = platformSchema.table(
  "dev_containers",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId.devContainer()),
    task_id: text("task_id").notNull(),
    container_id: text("container_id").notNull(),
    status: text("status").$type<"running" | "stopped" | "failed">().notNull(),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    last_activity: timestamp("last_activity", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    // One container per task
    uniqueIndex("dev_containers_task_id_unique").on(table.task_id),
  ],
);

// Type exports
export type DevContainer = typeof devContainers.$inferSelect;
export type NewDevContainer = typeof devContainers.$inferInsert;
