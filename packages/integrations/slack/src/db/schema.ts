/**
 * Slack Database Schema
 *
 * Defines tables in the slack.* PostgreSQL schema namespace.
 * Slack owns its data completely for independent deployment and containerization.
 *
 * Tables:
 * - installations: Bolt's Installation model for OAuth tokens
 * - event_deliveries: Event deduplication via event_id
 */

import { createId } from "@aesir/types";
import {
  boolean,
  index,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { customAlphabet } from "nanoid";

// ID generator for MCP permissions (not yet in common package)
const nanoid = customAlphabet(
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  24,
);

export const slackSchema = pgSchema("slack");

/**
 * Installations table
 *
 * Stores Slack OAuth installations in Bolt's Installation format.
 * Tokens are encrypted at application level before storage.
 *
 * This maps to Bolt's installationStore interface:
 * - storeInstallation() -> INSERT
 * - fetchInstallation() -> SELECT by team_id/enterprise_id
 * - deleteInstallation() -> soft delete via deleted_at
 */
export const installations = slackSchema.table(
  "installations",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId.credential()),

    // Workspace/Enterprise identification
    team_id: text("team_id").notNull(), // Slack workspace ID (T1234...)
    enterprise_id: text("enterprise_id"), // For Enterprise Grid installations
    user_id: text("user_id"), // User who installed (for user tokens)
    is_enterprise_install: boolean("is_enterprise_install")
      .default(false)
      .notNull(),

    // Encrypted tokens
    encrypted_bot_token: text("encrypted_bot_token").notNull(), // xoxb-...
    encrypted_user_token: text("encrypted_user_token"), // xoxp-... if requested

    // Bot metadata
    bot_id: text("bot_id"),
    bot_user_id: text("bot_user_id"),
    bot_scopes: text("bot_scopes"), // Comma-separated scopes

    // App metadata
    app_id: text("app_id"),
    token_type: text("token_type").default("bot").notNull(),

    // Timestamps
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    deleted_at: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    // Composite unique on team_id + enterprise_id
    // Soft-delete handling done at application layer before inserting new
    unique("installations_team_enterprise_unique").on(
      table.team_id,
      table.enterprise_id,
    ),
  ],
);

/**
 * Event deliveries table
 *
 * Tracks processed Slack events for deduplication.
 * Slack sends the same event multiple times if we don't respond quickly.
 * This table enables idempotent event handling via event_id.
 */
export const eventDeliveries = slackSchema.table(
  "event_deliveries",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId.webhookDelivery()),

    // Event identification
    event_id: text("event_id").notNull().unique(), // From Slack event payload
    event_type: text("event_type").notNull(), // e.g., "app_mention", "message"
    team_id: text("team_id"), // Workspace for tracking

    // Processing status
    processed_at: timestamp("processed_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    // Fast lookups by event_id
    index("event_deliveries_event_id_idx").on(table.event_id),
    // Cleanup queries by created_at
    index("event_deliveries_created_at_idx").on(table.created_at),
  ],
);

/**
 * MCP Tool Permissions
 * Stores agent-to-tool permission mappings for MCP tool whitelisting.
 * Uses allow-list approach: if no row exists, permission is denied.
 */
export const mcpToolPermissions = slackSchema.table(
  "mcp_tool_permissions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => `mcp_perm_${nanoid()}`),
    agentId: text("agent_id").notNull(), // e.g., 'dev-agent', 'product-agent'
    toolName: text("tool_name").notNull(), // e.g., 'send_message', 'post_approval'
    allowed: boolean("allowed").notNull().default(true), // Allow-list: row exists = allowed
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Unique constraint on agent + tool combination
    uniqueIndex("slack_mcp_perm_agent_tool_idx").on(
      table.agentId,
      table.toolName,
    ),
  ],
);

/**
 * Task Correlations
 *
 * Maps external integration resources (channels, messages, threads) to v2.5 task IDs.
 * Used for reverse-lookup: when a webhook arrives for an external resource,
 * find which task created it to attach task context to the IncomingEvent.
 */
export const taskCorrelations = slackSchema.table(
  "task_correlations",
  {
    external_type: text("external_type").notNull(),
    external_ref: text("external_ref").notNull(),
    task_id: text("task_id").notNull(),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    // Composite primary key
    primaryKey({ columns: [table.external_type, table.external_ref] }),
  ],
);

// Type exports
export type Installation = typeof installations.$inferSelect;
export type NewInstallation = typeof installations.$inferInsert;
export type EventDelivery = typeof eventDeliveries.$inferSelect;
export type NewEventDelivery = typeof eventDeliveries.$inferInsert;
export type McpToolPermission = typeof mcpToolPermissions.$inferSelect;
export type NewMcpToolPermission = typeof mcpToolPermissions.$inferInsert;
export type TaskCorrelation = typeof taskCorrelations.$inferSelect;
export type NewTaskCorrelation = typeof taskCorrelations.$inferInsert;
