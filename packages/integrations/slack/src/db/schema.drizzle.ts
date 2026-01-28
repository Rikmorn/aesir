/**
 * Slack Database Schema (Drizzle Kit Version)
 *
 * This file is ONLY for drizzle-kit migration generation.
 * Uses inline nanoid instead of @aesir/types to avoid CJS bundler issues.
 *
 * DO NOT import this file in application code - use schema.ts instead.
 */

import {
  boolean,
  index,
  pgSchema,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { customAlphabet } from "nanoid";

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
 */
export const installations = slackSchema.table(
  "installations",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => `cred_${nanoid()}`),

    // Workspace/Enterprise identification
    team_id: text("team_id").notNull(),
    enterprise_id: text("enterprise_id"),
    user_id: text("user_id"),
    is_enterprise_install: boolean("is_enterprise_install")
      .default(false)
      .notNull(),

    // Encrypted tokens
    encrypted_bot_token: text("encrypted_bot_token").notNull(),
    encrypted_user_token: text("encrypted_user_token"),

    // Bot metadata
    bot_id: text("bot_id"),
    bot_user_id: text("bot_user_id"),
    bot_scopes: text("bot_scopes"),

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
 */
export const eventDeliveries = slackSchema.table(
  "event_deliveries",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => `whd_${nanoid()}`),

    event_id: text("event_id").notNull().unique(),
    event_type: text("event_type").notNull(),
    team_id: text("team_id"),

    processed_at: timestamp("processed_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("event_deliveries_event_id_idx").on(table.event_id),
    index("event_deliveries_created_at_idx").on(table.created_at),
  ],
);

/**
 * MCP Tool Permissions
 * Stores agent-to-tool permission mappings for MCP tool whitelisting.
 */
export const mcpToolPermissions = slackSchema.table(
  "mcp_tool_permissions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => `mcp_perm_${nanoid()}`),
    agentId: text("agent_id").notNull(),
    toolName: text("tool_name").notNull(),
    allowed: boolean("allowed").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("slack_mcp_perm_agent_tool_idx").on(
      table.agentId,
      table.toolName,
    ),
  ],
);
