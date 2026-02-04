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

import { integer, jsonb, pgSchema, text, timestamp } from "drizzle-orm/pg-core";

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
  status: text("status", { enum: conversationStatusValues })
    .notNull()
    .default("queued"),
  retry_count: integer("retry_count").notNull().default(0),
  error_message: text("error_message"),
  parent_conversation_id: text("parent_conversation_id"),
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
  "signal.received",
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

// ─── Type Exports ────────────────────────────────────────────────────────────

export type Conversation = typeof conversations.$inferSelect;
export type AgentEvent = typeof agentEvents.$inferSelect;
export type AgentSession = typeof agentSessions.$inferSelect;
