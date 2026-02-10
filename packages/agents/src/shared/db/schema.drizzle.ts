/**
 * Agents Database Schema - Drizzle-Kit Version
 *
 * This file is used by drizzle-kit for migration generation.
 * It mirrors schema.ts but without external dependencies that
 * drizzle-kit's CJS bundler cannot resolve.
 *
 * Keep in sync with schema.ts.
 */

import {
  boolean,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { customAlphabet } from "nanoid";

const nanoid = customAlphabet(
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  24,
);

export const agentsSchema = pgSchema("agents");

// ─── Enum Arrays ────────────────────────────────────────────────────────────

const conversationStatusValues = [
  "queued",
  "running",
  "waiting",
  "completed",
  "failed",
  "cancelled",
] as const;

const agentEventTypeValues = [
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
] as const;

const sessionStatusValues = [
  "running",
  "waiting",
  "completed",
  "failed",
] as const;

const taskStatusValues = [
  "created",
  "active",
  "paused",
  "completed",
  "cancelled",
] as const;

const handoffTypeValues = [
  "completion",
  "pause",
  "delegation",
  "escalation",
] as const;

// ─── Tasks ──────────────────────────────────────────────────────────────────

export const tasks = agentsSchema.table(
  "tasks",
  {
    id: text("id").primaryKey(),
    parent_id: text("parent_id"),

    creator_type: text("creator_type", {
      enum: ["agent", "human"] as const,
    }).notNull(),
    creator_id: text("creator_id").notNull(),
    assignee_type: text("assignee_type", {
      enum: ["agent", "human"] as const,
    }).notNull(),
    assignee_id: text("assignee_id").notNull(),

    status: text("status", { enum: taskStatusValues })
      .notNull()
      .default("created"),

    title: text("title").notNull(),
    objective: text("objective"),
    metadata: jsonb("metadata").default({}),

    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completed_at: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_tasks_assignee").on(
      table.assignee_type,
      table.assignee_id,
      table.status,
    ),
    index("idx_tasks_parent").on(table.parent_id),
    index("idx_tasks_status").on(table.status),
  ],
);

// ─── Conversations ───────────────────────────────────────────────────────────

export const conversations = agentsSchema.table(
  "conversations",
  {
    id: text("id").primaryKey(),
    agent_definition_id: text("agent_definition_id").notNull(),
    agent_definition_version: text("agent_definition_version").notNull(),
    messages: jsonb("messages").notNull().default([]),
    status: text("status", { enum: conversationStatusValues })
      .notNull()
      .default("queued"),
    pending_wait: jsonb("pending_wait"),
    queued_signals: jsonb("queued_signals").notNull().default([]),
    claimed_by: text("claimed_by"),
    claimed_at: timestamp("claimed_at", { withTimezone: true }),
    last_heartbeat_at: timestamp("last_heartbeat_at", { withTimezone: true }),
    retry_count: integer("retry_count").notNull().default(0),
    max_retries: integer("max_retries").notNull().default(2),
    error_message: text("error_message"),
    reopen_count: integer("reopen_count").notNull().default(0),
    delivered_signal_ids: jsonb("delivered_signal_ids").notNull().default([]),
    parent_conversation_id: text("parent_conversation_id"),
    task_id: text("task_id"),
    // Communication context: last-received channel address for reply routing (v2.6)
    reply_context: jsonb("reply_context"),
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
    index("idx_conversations_task").on(table.task_id),
  ],
);

// ─── Task Handoffs ──────────────────────────────────────────────────────────

export const taskHandoffs = agentsSchema.table(
  "task_handoffs",
  {
    id: text("id").primaryKey(),
    task_id: text("task_id").notNull(),
    conversation_id: text("conversation_id").notNull(),

    handoff_type: text("handoff_type", { enum: handoffTypeValues }).notNull(),
    context: jsonb("context").notNull(),

    author_type: text("author_type", {
      enum: ["agent", "human"] as const,
    }).notNull(),
    author_id: text("author_id").notNull(),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("idx_handoffs_task").on(table.task_id, table.created_at)],
);

// ─── Agent Events ────────────────────────────────────────────────────────────

export const agentEvents = agentsSchema.table(
  "agent_events",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => `aevt_${nanoid()}`),
    conversation_id: text("conversation_id").notNull(),
    agent_definition_id: text("agent_definition_id").notNull(),
    agent_definition_version: text("agent_definition_version").notNull(),
    agent_instance_id: text("agent_instance_id").notNull(),
    parent_instance_id: text("parent_instance_id"),
    sequence: integer("sequence").notNull(),
    type: text("type", { enum: agentEventTypeValues }).notNull(),
    payload: jsonb("payload").notNull().default({}),
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

export const agentSessions = agentsSchema.table("agent_sessions", {
  conversation_id: text("conversation_id").primaryKey(),
  agent_definition_id: text("agent_definition_id").notNull(),
  status: text("status", { enum: sessionStatusValues }).notNull(),
  last_event_type: text("last_event_type").notNull(),
  last_event_at: timestamp("last_event_at", { withTimezone: true }).notNull(),
  artifacts: jsonb("artifacts").notNull().default({}),
  started_at: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─── Agent Event Content ─────────────────────────────────────────────────────

export const agentEventContent = agentsSchema.table("agent_event_content", {
  event_id: text("event_id").primaryKey(),
  content: jsonb("content").notNull(),
  created_at: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ─── Knowledge Entries ──────────────────────────────────────────────────────

const entityDirectoryStatusValues = ["active", "inactive"] as const;
const entityDirectoryTypeValues = ["agent", "human"] as const;

const knowledgeEntryTypeValues = [
  "discovery",
  "constraint",
  "architecture_decision",
  "thought",
  "preference",
  "test_result",
] as const;

const knowledgeEntryScopeValues = ["shared", "private"] as const;

/**
 * Knowledge Entries table (drizzle-kit mirror)
 *
 * Note: The `embedding` column is defined as `text` here because drizzle-kit's
 * CJS bundler cannot resolve the customType vector definition from schema.ts.
 * The actual column type is `vector` (pgvector) -- defined in the hand-written
 * migration 0007_add_knowledge_entries.sql. This placeholder prevents drizzle-kit
 * from generating destructive migration diffs.
 */
export const knowledgeEntries = agentsSchema.table(
  "knowledge_entries",
  {
    id: text("id").primaryKey(),
    type: text("type", { enum: knowledgeEntryTypeValues }).notNull(),
    topic: text("topic").notNull(),
    content: text("content").notNull(),
    author: text("author").notNull(),
    scope: text("scope", { enum: knowledgeEntryScopeValues }).notNull(),
    tags: jsonb("tags").notNull().default([]),
    // Placeholder: actual type is `vector` (pgvector), defined in migration SQL.
    // Using text here because drizzle-kit CJS cannot resolve customType vector.
    embedding: text("embedding"),
    superseded_by: text("superseded_by"),
    invalidated: boolean("invalidated").notNull().default(false),
    invalidation_reason: text("invalidation_reason"),
    expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_knowledge_type_topic").on(table.type, table.topic),
    index("idx_knowledge_scope_author").on(table.scope, table.author),
    index("idx_knowledge_expires").on(table.expires_at),
    index("idx_knowledge_not_superseded").on(table.id),
  ],
);

// ─── Entity Directory ──────────────────────────────────────────────────────

/**
 * Entity Directory table (drizzle-kit mirror)
 *
 * Note: The `capabilities_embedding` column is defined as `text` here because
 * drizzle-kit's CJS bundler cannot resolve the customType vector definition
 * from schema.ts. The actual column type is `vector` (pgvector) -- defined in
 * the hand-written migration 0008_add_entity_directory.sql. This placeholder
 * prevents drizzle-kit from generating destructive migration diffs.
 */
export const entityDirectory = agentsSchema.table(
  "entity_directory",
  {
    id: text("id").primaryKey(),
    type: text("type", { enum: entityDirectoryTypeValues }).notNull(),
    name: text("name").notNull(),
    description: text("description"),
    capabilities: jsonb("capabilities").notNull().default([]),
    // Placeholder: actual type is `vector` (pgvector), defined in migration SQL.
    // Using text here because drizzle-kit CJS cannot resolve customType vector.
    capabilities_embedding: text("capabilities_embedding"),
    reach_via: jsonb("reach_via"),
    status: text("status", { enum: entityDirectoryStatusValues })
      .notNull()
      .default("active"),
    metadata: jsonb("metadata").notNull().default({}),
    last_seeded_at: timestamp("last_seeded_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_directory_type_status").on(table.type, table.status),
    index("idx_directory_name").on(table.name),
  ],
);
