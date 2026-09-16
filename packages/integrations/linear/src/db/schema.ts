/**
 * Linear Database Schema
 *
 * Defines tables in the linear.* PostgreSQL schema namespace.
 * Linear owns its data completely for independent deployment and containerization.
 */

import { createId } from "@aesir/types";
import { sql } from "drizzle-orm";
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
      .$defaultFn(() => createId.credential()),
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
    // One ACTIVE credential per workspace. Partial, so a soft-deleted row does
    // not block re-authorising the workspace (#62).
    uniqueIndex("credentials_workspace_active_unique")
      .on(table.workspace_id)
      .where(sql`${table.deleted_at} IS NULL`),
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
      .$defaultFn(() => createId.webhookDelivery()),
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

/**
 * MCP Tool Permissions
 * Stores agent-to-tool permission mappings for MCP tool whitelisting.
 * Uses allow-list approach: if no row exists, permission is denied.
 */
export const mcpToolPermissions = linearSchema.table(
  "mcp_tool_permissions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => `mcp_perm_${nanoid()}`),
    agentId: text("agent_id").notNull(), // e.g., 'dev-agent', 'product-agent'
    toolName: text("tool_name").notNull(), // e.g., 'get_issue', 'create_issue'
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
    uniqueIndex("linear_mcp_perm_agent_tool_idx").on(
      table.agentId,
      table.toolName,
    ),
  ],
);

/**
 * Task Correlations
 *
 * Maps external integration resources (issues, PRs, etc.) to v2.5 task IDs.
 * Used for reverse-lookup: when a webhook arrives for an external resource,
 * find which task created it to attach task context to the IncomingEvent.
 */
export const taskCorrelations = linearSchema.table(
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
