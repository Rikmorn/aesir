/**
 * Agents Database Schema
 *
 * Defines tables for the agents layer (conversations, agent events, agent sessions).
 * Uses pgSchema for schema namespace isolation.
 *
 * Keep in sync with schema.drizzle.ts (used by drizzle-kit for migration generation).
 *
 * Note: schema.drizzle.ts retains legacy table definitions (context_snapshots, tasks,
 * execution_traces) because drizzle-kit uses that file to track existing database
 * state. Removing them there would generate destructive DROP TABLE migrations.
 */

import { createId } from "@aesir/types";
import {
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

export const agentsSchema = pgSchema("agents");

// ─── Conversations ───────────────────────────────────────────────────────────

/**
 * Conversation status values
 */
export const conversationStatusValues = [
  "queued",
  "running",
  "waiting",
  "completed",
  "failed",
  "cancelled",
] as const;
export type ConversationStatus = (typeof conversationStatusValues)[number];

/**
 * Conversations table
 *
 * Executor state for agent conversations (Phase 40).
 * Stores LLM message history, wait state, and queued signals.
 * Created now to avoid a second migration for the same table.
 */
export const conversations = agentsSchema.table(
  "conversations",
  {
    id: text("id").primaryKey(), // Deterministic ID from agent definition + correlation key
    agent_definition_id: text("agent_definition_id").notNull(),
    agent_definition_version: text("agent_definition_version").notNull(),
    messages: jsonb("messages").$type<unknown[]>().notNull().default([]),
    status: text("status", { enum: conversationStatusValues })
      .notNull()
      .default("queued"),
    pending_wait: jsonb("pending_wait").$type<Record<string, unknown> | null>(),
    queued_signals: jsonb("queued_signals")
      .$type<unknown[]>()
      .notNull()
      .default([]),
    // Executor columns (Phase 40 uses these, added now to avoid second migration)
    claimed_by: text("claimed_by"),
    claimed_at: timestamp("claimed_at", { withTimezone: true }),
    last_heartbeat_at: timestamp("last_heartbeat_at", { withTimezone: true }),
    // Retry tracking (Phase 40 executor retry loop)
    retry_count: integer("retry_count").notNull().default(0),
    max_retries: integer("max_retries").notNull().default(2),
    error_message: text("error_message"),
    // Signal deduplication: tracks which signal IDs have already been delivered
    delivered_signal_ids: jsonb("delivered_signal_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    // Sub-agent tracking: links child conversations to their parent
    parent_conversation_id: text("parent_conversation_id"),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_conversations_status").on(table.status),
    index("idx_conversations_definition").on(table.agent_definition_id),
    index("idx_conversations_parent").on(table.parent_conversation_id),
  ],
);

// ─── Agent Events ────────────────────────────────────────────────────────────

/**
 * Agent event type values (9 event types for v2.3)
 */
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

/**
 * Agent Events table
 *
 * Append-only event log for agent execution.
 * Each event records a specific action within a conversation.
 * Gapless per-conversation sequence assigned by application code.
 */
export const agentEvents = agentsSchema.table(
  "agent_events",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId.agentEvent()),
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
  },
  (table) => [
    unique("uq_agent_events_conv_seq").on(
      table.conversation_id,
      table.sequence,
    ),
    index("idx_agent_events_conversation").on(
      table.conversation_id,
      table.sequence,
    ),
    index("idx_agent_events_type").on(table.type),
    index("idx_agent_events_instance").on(table.agent_instance_id),
  ],
);

// ─── Agent Sessions ──────────────────────────────────────────────────────────

/**
 * Session status values
 */
export const sessionStatusValues = [
  "running",
  "waiting",
  "completed",
  "failed",
] as const;
export type SessionStatus = (typeof sessionStatusValues)[number];

/**
 * Agent Sessions table
 *
 * Materialized projection from agent_events.
 * Reactively updated by SessionProjection when lifecycle events occur.
 * Keyed by conversation_id (one session per conversation).
 */
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
export type NewConversation = typeof conversations.$inferInsert;
export type AgentEvent = typeof agentEvents.$inferSelect;
export type NewAgentEvent = typeof agentEvents.$inferInsert;
export type AgentSession = typeof agentSessions.$inferSelect;
export type NewAgentSession = typeof agentSessions.$inferInsert;
