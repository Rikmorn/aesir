/**
 * GitHub Database Schema
 *
 * Defines tables in the github.* PostgreSQL schema namespace.
 * GitHub owns its data completely for independent deployment and containerization.
 */

import { createId } from "@aesir/types";
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

// ID generator for MCP permissions (not yet in common package)
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
      .$defaultFn(() => createId.credential()),
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
      .$defaultFn(() => createId.webhookDelivery()),
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
 * Uses allow-list approach: if no row exists, permission is denied.
 */
export const mcpToolPermissions = githubSchema.table(
  "mcp_tool_permissions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => `mcp_perm_${nanoid()}`),
    agentId: text("agent_id").notNull(), // e.g., 'dev-agent', 'product-agent'
    toolName: text("tool_name").notNull(), // e.g., 'create_branch', 'create_pr'
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
    uniqueIndex("github_mcp_perm_agent_tool_idx").on(
      table.agentId,
      table.toolName,
    ),
  ],
);

/**
 * Task Correlations
 *
 * Maps external integration resources (repos, PRs, branches, etc.) to v2.5 task IDs.
 * Used for reverse-lookup: when a webhook arrives for an external resource,
 * find which task created it to attach task context to the IncomingEvent.
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
    // Composite primary key
    primaryKey({ columns: [table.external_type, table.external_ref] }),
  ],
);

// Type exports
export type Credential = typeof credentials.$inferSelect;
export type NewCredential = typeof credentials.$inferInsert;
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
export type NewWebhookDelivery = typeof webhookDeliveries.$inferInsert;
export type McpToolPermission = typeof mcpToolPermissions.$inferSelect;
export type NewMcpToolPermission = typeof mcpToolPermissions.$inferInsert;
export type TaskCorrelation = typeof taskCorrelations.$inferSelect;
export type NewTaskCorrelation = typeof taskCorrelations.$inferInsert;
