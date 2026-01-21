/**
 * Observability Database Schema
 *
 * Defines tables for the observability layer (agent executions, metrics).
 * Uses pgSchema for schema namespace isolation.
 */

import { createId } from "@aesir/common";
import { index, integer, pgSchema, text, timestamp } from "drizzle-orm/pg-core";

export const observabilitySchema = pgSchema("observability");

/**
 * Agent status enum values
 * - started: Execution has begun
 * - completed: Execution finished successfully
 * - failed: Execution encountered an error
 */
export const agentStatusValues = ["started", "completed", "failed"] as const;
export type AgentStatus = (typeof agentStatusValues)[number];

/**
 * Agent Executions table
 *
 * Tracks agent execution lifecycle for observability and debugging.
 * Records start/end times, status, and state capture on failure.
 */
export const agentExecutions = observabilitySchema.table(
  "agent_executions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId.execution()),
    workspace_id: text("workspace_id").notNull(),
    agent_type: text("agent_type").notNull(), // 'dev-agent', 'product-agent'
    issue_id: text("issue_id").notNull(), // Linear issue ID
    status: text("status", { enum: agentStatusValues }).notNull(),
    started_at: timestamp("started_at", { withTimezone: true }).notNull(),
    ended_at: timestamp("ended_at", { withTimezone: true }),
    duration_ms: integer("duration_ms"),
    last_known_state: text("last_known_state"), // JSON state captured on failure
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    // For querying recent failures and status-based queries
    index("agent_executions_status_started_idx").on(
      table.status,
      table.started_at,
    ),
    // For multi-tenant filtering
    index("agent_executions_workspace_idx").on(table.workspace_id),
  ],
);

// Type exports
export type AgentExecution = typeof agentExecutions.$inferSelect;
export type NewAgentExecution = typeof agentExecutions.$inferInsert;
