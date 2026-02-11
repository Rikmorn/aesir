/**
 * Dashboard Database Schema (Read-Only)
 *
 * Local Drizzle table definitions for the agents schema.
 * These mirror the canonical definitions in @aesir/agents but are maintained
 * independently to avoid coupling the dashboard to the full agents package
 * dependency tree (@anthropic-ai/sdk, @slack/bolt, pg-boss, etc.).
 *
 * The dashboard only reads from these tables -- it never writes.
 * Schema changes are infrequent; if the agents schema changes, update this file.
 *
 * Source of truth: packages/agents/src/shared/db/schema.ts
 */

import {
  boolean,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const agentsSchema = pgSchema("agents");

// ─── Conversations ───────────────────────────────────────────────────────────

export const conversationStatusValues = [
  "queued",
  "running",
  "waiting",
  "completed",
  "failed",
  "cancelled",
] as const;

export type ConversationStatus = (typeof conversationStatusValues)[number];

export const conversations = agentsSchema.table("conversations", {
  id: text("id").primaryKey(),
  agent_definition_id: text("agent_definition_id").notNull(),
  agent_definition_version: text("agent_definition_version").notNull(),
  messages: jsonb("messages").$type<unknown[]>().notNull().default([]),
  status: text("status", { enum: conversationStatusValues })
    .notNull()
    .default("queued"),
  retry_count: integer("retry_count").notNull().default(0),
  error_message: text("error_message"),
  reopen_count: integer("reopen_count").notNull().default(0),
  parent_conversation_id: text("parent_conversation_id"),
  task_id: text("task_id"),
  created_at: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ─── Agent Events ────────────────────────────────────────────────────────────

export const agentEventTypeValues = [
  "tool.called",
  "tool.succeeded",
  "tool.failed",
  "llm.response",
  "agent.started",
  "agent.completed",
  "agent.paused",
  "agent.resumed",
  "agent.reopened",
  "signal.received",
  "signal.orphaned",
] as const;

export type AgentEventType = (typeof agentEventTypeValues)[number];

export const agentEvents = agentsSchema.table("agent_events", {
  id: text("id").primaryKey(),
  conversation_id: text("conversation_id").notNull(),
  agent_definition_id: text("agent_definition_id").notNull(),
  agent_definition_version: text("agent_definition_version").notNull(),
  agent_instance_id: text("agent_instance_id").notNull(),
  parent_instance_id: text("parent_instance_id"),
  sequence: integer("sequence").notNull(),
  type: text("type", { enum: agentEventTypeValues }).notNull(),
  payload: jsonb("payload")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  timestamp: timestamp("timestamp", { withTimezone: true })
    .notNull()
    .defaultNow(),
  token_count_input: integer("token_count_input"),
  token_count_output: integer("token_count_output"),
  duration_ms: integer("duration_ms"),
});

// ─── Agent Event Content ─────────────────────────────────────────────────────

export const agentEventContent = agentsSchema.table("agent_event_content", {
  event_id: text("event_id").primaryKey(),
  content: jsonb("content").$type<unknown[]>().notNull(),
  created_at: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ─── Tasks ──────────────────────────────────────────────────────────────────

export const taskStatusValues = [
  "created",
  "active",
  "paused",
  "completed",
  "cancelled",
] as const;

export type TaskStatus = (typeof taskStatusValues)[number];

export const handoffTypeValues = [
  "completion",
  "pause",
  "delegation",
  "escalation",
] as const;

export type HandoffType = (typeof handoffTypeValues)[number];

export const tasks = agentsSchema.table("tasks", {
  id: text("id").primaryKey(),
  parent_id: text("parent_id"),
  creator_type: text("creator_type").notNull(),
  creator_id: text("creator_id").notNull(),
  assignee_type: text("assignee_type").notNull(),
  assignee_id: text("assignee_id").notNull(),
  status: text("status", { enum: taskStatusValues })
    .notNull()
    .default("created"),
  title: text("title").notNull(),
  objective: text("objective"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  depth: integer("depth").notNull().default(0),
  completion_result: jsonb("completion_result").$type<Record<
    string,
    unknown
  > | null>(),
  created_at: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  completed_at: timestamp("completed_at", { withTimezone: true }),
});

// ─── Task Handoffs ──────────────────────────────────────────────────────────

export const taskHandoffs = agentsSchema.table("task_handoffs", {
  id: text("id").primaryKey(),
  task_id: text("task_id").notNull(),
  conversation_id: text("conversation_id").notNull(),
  handoff_type: text("handoff_type", { enum: handoffTypeValues }).notNull(),
  context: jsonb("context").$type<Record<string, unknown>>().notNull(),
  author_type: text("author_type").notNull(),
  author_id: text("author_id").notNull(),
  created_at: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ─── Entity Directory ───────────────────────────────────────────────────────

export const entityDirectoryStatusValues = ["active", "inactive"] as const;
export type EntityDirectoryStatus =
  (typeof entityDirectoryStatusValues)[number];

export const entityDirectoryTypeValues = ["agent", "human"] as const;
export type EntityDirectoryType = (typeof entityDirectoryTypeValues)[number];

export const entityDirectory = agentsSchema.table("entity_directory", {
  id: text("id").primaryKey(),
  type: text("type", { enum: entityDirectoryTypeValues }).notNull(),
  name: text("name").notNull(),
  description: text("description"),
  capabilities: jsonb("capabilities").$type<string[]>().notNull().default([]),
  status: text("status", { enum: entityDirectoryStatusValues })
    .notNull()
    .default("active"),
  created_at: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ─── Agent Sessions ──────────────────────────────────────────────────────────

export const sessionStatusValues = [
  "running",
  "waiting",
  "completed",
  "failed",
] as const;

export type SessionStatus = (typeof sessionStatusValues)[number];

export const agentSessions = agentsSchema.table("agent_sessions", {
  conversation_id: text("conversation_id").primaryKey(),
  agent_definition_id: text("agent_definition_id").notNull(),
  status: text("status", { enum: sessionStatusValues }).notNull(),
  last_event_type: text("last_event_type").notNull(),
  last_event_at: timestamp("last_event_at", { withTimezone: true }).notNull(),
  artifacts: jsonb("artifacts")
    .$type<Record<string, string>>()
    .notNull()
    .default({}),
  started_at: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─── Integration Schemas (MCP Permissions) ──────────────────────────────────

export const linearSchema = pgSchema("linear");
export const githubSchema = pgSchema("github");
export const slackSchema = pgSchema("slack");

export const linearMcpPermissions = linearSchema.table("mcp_tool_permissions", {
  id: text("id").primaryKey(),
  agent_id: text("agent_id").notNull(),
  tool_name: text("tool_name").notNull(),
  allowed: boolean("allowed").notNull(),
});

export const githubMcpPermissions = githubSchema.table("mcp_tool_permissions", {
  id: text("id").primaryKey(),
  agent_id: text("agent_id").notNull(),
  tool_name: text("tool_name").notNull(),
  allowed: boolean("allowed").notNull(),
});

export const slackMcpPermissions = slackSchema.table("mcp_tool_permissions", {
  id: text("id").primaryKey(),
  agent_id: text("agent_id").notNull(),
  tool_name: text("tool_name").notNull(),
  allowed: boolean("allowed").notNull(),
});

// ─── Type Exports ────────────────────────────────────────────────────────────

export type Conversation = typeof conversations.$inferSelect;
export type AgentEvent = typeof agentEvents.$inferSelect;
export type AgentSession = typeof agentSessions.$inferSelect;
export type AgentEventContent = typeof agentEventContent.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type TaskHandoff = typeof taskHandoffs.$inferSelect;
export type EntityDirectoryEntry = typeof entityDirectory.$inferSelect;
