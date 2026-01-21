/**
 * Observability Database Schema - Drizzle-Kit Version
 *
 * This file is used by drizzle-kit for migration generation.
 * It mirrors schema.ts but without external dependencies that
 * drizzle-kit's CJS bundler cannot resolve.
 *
 * Keep in sync with schema.ts.
 */

import { index, integer, pgSchema, text, timestamp } from "drizzle-orm/pg-core";

export const observabilitySchema = pgSchema("observability");

/**
 * Agent status enum values
 */
const agentStatusValues = ["started", "completed", "failed"] as const;

/**
 * Agent Executions table
 */
export const agentExecutions = observabilitySchema.table(
  "agent_executions",
  {
    id: text("id").primaryKey(),
    workspace_id: text("workspace_id").notNull(),
    agent_type: text("agent_type").notNull(),
    issue_id: text("issue_id").notNull(),
    status: text("status", { enum: agentStatusValues }).notNull(),
    started_at: timestamp("started_at", { withTimezone: true }).notNull(),
    ended_at: timestamp("ended_at", { withTimezone: true }),
    duration_ms: integer("duration_ms"),
    last_known_state: text("last_known_state"),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("agent_executions_status_started_idx").on(
      table.status,
      table.started_at,
    ),
    index("agent_executions_workspace_idx").on(table.workspace_id),
  ],
);
