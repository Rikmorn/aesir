/**
 * GitHub Database Schema (Drizzle Kit Version)
 *
 * This file is ONLY for drizzle-kit migration generation.
 * Uses inline nanoid instead of @aesir/types to avoid CJS bundler issues.
 *
 * DO NOT import this file in application code - use schema.ts instead.
 */

import {
  boolean,
  pgSchema,
  primaryKey,
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

export const githubSchema = pgSchema("github");

/**
 * Credentials table
 *
 * Stores OAuth tokens for GitHub organizations/users.
 * Tokens are encrypted at application level before storage.
 */
export const credentials = githubSchema.table(
  "credentials",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => `cred_${nanoid()}`),
    owner: text("owner").notNull(), // org or user - unique identifier
    installation_id: text("installation_id"), // nullable - for future GitHub Apps support
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
    // One active credential per owner
    unique("credentials_owner_unique").on(table.owner),
  ],
);

/**
 * Webhook deliveries table
 *
 * Tracks webhook delivery attempts for idempotency.
 */
export const webhookDeliveries = githubSchema.table(
  "webhook_deliveries",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => `whd_${nanoid()}`),
    delivery_id: text("delivery_id").notNull().unique(), // X-GitHub-Delivery header
    event_type: text("event_type").notNull(),
    payload_hash: text("payload_hash"),
    processed_at: timestamp("processed_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    // Unique delivery per GitHub delivery ID
    unique("webhook_deliveries_delivery_unique").on(table.delivery_id),
  ],
);

/**
 * MCP Tool Permissions
 * Stores agent-to-tool permission mappings for MCP tool whitelisting.
 */
export const mcpToolPermissions = githubSchema.table(
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
    uniqueIndex("github_mcp_perm_agent_tool_idx").on(
      table.agentId,
      table.toolName,
    ),
  ],
);

/**
 * Task Correlations
 * Maps external integration resources to v2.5 task IDs.
 */
export const taskCorrelations = githubSchema.table(
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
    primaryKey({ columns: [table.external_type, table.external_ref] }),
  ],
);
