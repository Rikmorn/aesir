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
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

/**
 * Custom unconstrained vector type for pgvector.
 *
 * Drizzle's built-in `vector()` requires a fixed dimensions parameter,
 * but we need unconstrained vector columns to support different embedding
 * providers (768 for Ollama/dev, 1024 for Voyage/prod) without schema changes.
 *
 * Maps number[] <-> PostgreSQL vector string format: "[1.0,2.0,3.0]"
 */
const vectorColumn = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector";
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    // PostgreSQL returns vectors as "[1.0,2.0,3.0]"
    return value
      .slice(1, -1)
      .split(",")
      .map((v) => Number.parseFloat(v));
  },
});

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
    // Recovery context: event log sequence at last message persistence (Phase 76)
    last_persisted_sequence: integer("last_persisted_sequence").default(0),
    // Reopen tracking (Phase 57 -- manual conversation reopening)
    reopen_count: integer("reopen_count").notNull().default(0),
    // Signal deduplication: tracks which signal IDs have already been delivered
    delivered_signal_ids: jsonb("delivered_signal_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    // Sub-agent tracking: links child conversations to their parent
    parent_conversation_id: text("parent_conversation_id"),
    // Task association (Phase 58.1 -- v2.5 task primitive)
    task_id: text("task_id").references(() => tasks.id),
    // Active delegations tracking (Phase 71 -- survives history compaction)
    active_delegations: jsonb("active_delegations")
      .$type<unknown[]>()
      .notNull()
      .default([]),
    // Cancellation lifecycle: one-cleanup-turn pattern (Phase 81)
    pending_cancellation: boolean("pending_cancellation")
      .notNull()
      .default(false),
    // Tree-level token budget tracking (Phase 83)
    subtree_allocation: integer("subtree_allocation"), // NULL = no tree budget (BUD-06)
    subtree_consumed: integer("subtree_consumed").notNull().default(0),
    tree_budget_warning_delivered: boolean("tree_budget_warning_delivered")
      .notNull()
      .default(false),
    // Communication context: last-received channel address for reply routing (v2.6)
    reply_context: jsonb("reply_context").$type<Record<
      string,
      unknown
    > | null>(),
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
  "agent.reopened",
  "signal.received",
  "signal.orphaned",
  "mcp.error",
  "mcp.rate_limited",
  "mcp.retries_exhausted",
  "notification.failed",
  "agent.stale_recovered",
  "agent.retry_scheduled",
  "event.routed",
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

// ─── Agent Event Content ─────────────────────────────────────────────────────

/**
 * Agent Event Content table
 *
 * Stores full LLM response content separately from the lean event log.
 * Content is stored as JSONB matching Anthropic.Message.content format.
 * One-to-one relationship with agent_events (event_id is PK and FK).
 * Cascade delete ensures content is removed when events are purged.
 */
export const agentEventContent = agentsSchema.table("agent_event_content", {
  event_id: text("event_id")
    .primaryKey()
    .references(() => agentEvents.id, { onDelete: "cascade" }),
  content: jsonb("content").$type<unknown[]>().notNull(),
  created_at: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ─── Task Groups ────────────────────────────────────────────────────────────

/**
 * Group status lifecycle: active -> satisfied | unsatisfiable | cancelled -> settled
 */
export const groupStatusValues = [
  "active",
  "satisfied",
  "unsatisfiable",
  "cancelled",
  "settled",
] as const;
export type GroupStatus = (typeof groupStatusValues)[number];

/**
 * Task Groups table
 *
 * Groups parallel delegated tasks under a completion policy.
 * The delegator pauses and resumes when the policy is satisfied/unsatisfiable.
 */
export const taskGroups = agentsSchema.table(
  "task_groups",
  {
    id: text("id").primaryKey(),
    delegator_conversation_id: text("delegator_conversation_id").notNull(), // FK to conversations.id defined in migration SQL (avoids circular Drizzle reference)
    policy: jsonb("policy")
      .$type<{ type: string; threshold?: number }>()
      .notNull(),
    status: text("status", { enum: groupStatusValues })
      .notNull()
      .default("active"),
    timeout_duration: text("timeout_duration"),
    timeout_job_id: text("timeout_job_id"),
    token_budget: integer("token_budget"), // PAR-07: nullable, no enforcement in Phase 81
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_task_groups_delegator").on(table.delegator_conversation_id),
    index("idx_task_groups_status").on(table.status),
  ],
);

// ─── Tasks ──────────────────────────────────────────────────────────────────

/**
 * Task status values (v2.5 task primitive)
 */
export const taskStatusValues = [
  "created",
  "counter_proposed",
  "active",
  "paused",
  "completed",
  "failed",
  "cancelled",
] as const;
export type TaskStatus = (typeof taskStatusValues)[number];

/**
 * Handoff type values (v2.5 task handoffs)
 */
export const handoffTypeValues = [
  "completion",
  "pause",
  "delegation",
  "escalation",
] as const;
export type HandoffType = (typeof handoffTypeValues)[number];

/**
 * Tasks table
 *
 * Core coordination entity for v2.5 agentic conversations.
 * Groups related conversations around a single unit of work.
 * Supports subtask trees via self-referential parent_id FK.
 */
export const tasks = agentsSchema.table(
  "tasks",
  {
    id: text("id").primaryKey(),
    parent_id: text("parent_id"),
    group_id: text("group_id"), // FK to task_groups.id defined in migration SQL (avoids circular Drizzle reference)

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
  },
  (table) => [
    index("idx_tasks_assignee").on(
      table.assignee_type,
      table.assignee_id,
      table.status,
    ),
    index("idx_tasks_parent").on(table.parent_id),
    index("idx_tasks_group").on(table.group_id),
    index("idx_tasks_status").on(table.status),
    index("idx_tasks_depth").on(table.depth),
  ],
);

/**
 * Task Handoffs table
 *
 * Records context handoffs between conversations within a task.
 * Each handoff captures a structured snapshot for the next agent/conversation.
 */
export const taskHandoffs = agentsSchema.table(
  "task_handoffs",
  {
    id: text("id").primaryKey(),
    task_id: text("task_id")
      .notNull()
      .references(() => tasks.id),
    conversation_id: text("conversation_id")
      .notNull()
      .references(() => conversations.id),

    handoff_type: text("handoff_type", { enum: handoffTypeValues }).notNull(),
    context: jsonb("context").$type<Record<string, unknown>>().notNull(),

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

// ─── Knowledge Entries ──────────────────────────────────────────────────────

/**
 * Knowledge entry type values (6 fixed types for v2.7 knowledge taxonomy)
 */
export const knowledgeEntryTypeValues = [
  "discovery",
  "constraint",
  "architecture_decision",
  "thought",
  "preference",
  "test_result",
] as const;
export type KnowledgeEntryType = (typeof knowledgeEntryTypeValues)[number];

/**
 * Knowledge entry scope values
 */
export const knowledgeEntryScopeValues = ["shared", "private"] as const;
export type KnowledgeEntryScope = (typeof knowledgeEntryScopeValues)[number];

/**
 * Knowledge Entries table
 *
 * Shared agent knowledge store for v2.7 Agent Collaboration.
 * Agents store discoveries, constraints, decisions, thoughts, preferences,
 * and test results that other agents can query via semantic search.
 *
 * Uses pgvector for embedding-based similarity search.
 * Supports deduplication via type + normalized topic matching.
 * Entries expire (mandatory expires_at) and can be superseded or invalidated.
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
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    embedding: vectorColumn("embedding"),
    superseded_by: text("superseded_by"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
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
 * Entity directory status values
 */
export const entityDirectoryStatusValues = ["active", "inactive"] as const;
export type EntityDirectoryStatus =
  (typeof entityDirectoryStatusValues)[number];

/**
 * Entity directory type values
 */
export const entityDirectoryTypeValues = ["agent", "human"] as const;
export type EntityDirectoryType = (typeof entityDirectoryTypeValues)[number];

/**
 * Entity Directory table
 *
 * Stores agents (and future humans) with capabilities and pgvector embeddings
 * for semantic matching. Agents use their definition ID as the primary key
 * (e.g., "dev-agent"). Future human entries use createId.directoryEntry().
 *
 * Capabilities are stored as a JSONB string array and embedded via pgvector
 * for semantic capability matching in agent discovery.
 */
export const entityDirectory = agentsSchema.table(
  "entity_directory",
  {
    id: text("id").primaryKey(),
    type: text("type", { enum: entityDirectoryTypeValues }).notNull(),
    name: text("name").notNull(),
    description: text("description"),
    capabilities: jsonb("capabilities").$type<string[]>().notNull().default([]),
    capabilities_embedding: vectorColumn("capabilities_embedding"),
    reach_via: jsonb("reach_via").$type<Record<string, unknown> | null>(),
    status: text("status", { enum: entityDirectoryStatusValues })
      .notNull()
      .default("active"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
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

// ─── Work Correlations ──────────────────────────────────────────────────────

/**
 * Correlation status values (Phase 78 work correlation)
 */
export const correlationStatusValues = [
  "active",
  "waiting",
  "completed",
  "failed",
  "superseded",
] as const;
export type CorrelationStatus = (typeof correlationStatusValues)[number];

/**
 * Work Correlations table
 *
 * Maps external work entities (Linear issues, GitHub PRs, Slack threads) to
 * agent conversations. A single entity can have multiple correlated conversations
 * (e.g., a Linear issue worked on by dev-agent and then qa-agent).
 *
 * Composite unique key: (entity_type, entity_id, conversation_id).
 * The migration SQL uses a real composite PK; Drizzle uses a unique constraint.
 */
export const workCorrelations = agentsSchema.table(
  "work_correlations",
  {
    entity_type: text("entity_type").notNull(),
    entity_id: text("entity_id").notNull(),
    conversation_id: text("conversation_id")
      .notNull()
      .references(() => conversations.id),
    agent_id: text("agent_id").notNull(),
    status: text("status", { enum: correlationStatusValues })
      .notNull()
      .default("active"),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("uq_correlations_entity_conversation").on(
      table.entity_type,
      table.entity_id,
      table.conversation_id,
    ),
    index("idx_correlations_entity").on(table.entity_type, table.entity_id),
    index("idx_correlations_conversation").on(table.conversation_id),
    index("idx_correlations_status").on(
      table.entity_type,
      table.entity_id,
      table.status,
    ),
  ],
);

// ─── Materialization Records ─────────────────────────────────────────────────

/**
 * Materialization sync status values
 */
export const materializationSyncStatusValues = [
  "active",
  "completed",
  "failed",
] as const;
export type MaterializationSyncStatus =
  (typeof materializationSyncStatusValues)[number];

/**
 * Materialization Records table
 *
 * Links agent tasks to their materialized external artifacts (e.g., Linear issues).
 * Created at materialization time, queried on webhook receipt for reverse sync routing.
 * Internal task state is authoritative; the external artifact is a projection.
 *
 * One-to-one: each task has at most one materialization record.
 */
export const materializationRecords = agentsSchema.table(
  "materialization_records",
  {
    task_id: text("task_id").notNull().primaryKey(),
    target: text("target").notNull(), // "linear" (extensible for future targets)
    external_id: text("external_id").notNull(), // Linear issue UUID
    external_url: text("external_url"), // Linear issue URL
    conversation_id: text("conversation_id").notNull(), // Owning conversation
    agent_id: text("agent_id").notNull(), // Agent that requested materialization
    config: jsonb("config")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}), // Full MaterializationConfig snapshot
    sync_status: text("sync_status", {
      enum: materializationSyncStatusValues,
    })
      .notNull()
      .default("active"),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_materialization_external").on(table.target, table.external_id),
    index("idx_materialization_conversation").on(table.conversation_id),
  ],
);

// ─── Schedule State ──────────────────────────────────────────────────────────

/**
 * Schedule State table
 *
 * Tracks schedule execution history for cron-based agent triggers.
 * One row per agent-schedule pair. Updated after each run completes.
 * Used for context injection (SCH-06) and dashboard display.
 */
export const scheduleState = agentsSchema.table(
  "schedule_state",
  {
    agent_id: text("agent_id").notNull(),
    schedule_name: text("schedule_name").notNull(),
    last_run_at: timestamp("last_run_at", { withTimezone: true }),
    last_run_outcome: text("last_run_outcome"),
    last_run_conversation_id: text("last_run_conversation_id"),
    last_run_summary: text("last_run_summary"),
    run_count: integer("run_count").notNull().default(0),
  },
  (table) => [
    primaryKey({
      columns: [table.agent_id, table.schedule_name],
      name: "schedule_state_pkey",
    }),
  ],
);

// ─── Identity Documents ──────────────────────────────────────────────────────

/**
 * Identity Documents table
 *
 * Versioned identity documents for persistent agent identity (Phase 86).
 * Each update creates a new version row. Agents are capped at 5 distinct
 * document types, each limited to 12,000 characters.
 *
 * Documents persist across all conversations and are injected into the
 * system prompt at conversation start.
 */
export const identityDocuments = agentsSchema.table(
  "identity_documents",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId.identityDocument()),
    agent_id: text("agent_id").notNull(),
    document_type: text("document_type").notNull(),
    content: text("content").notNull(),
    version: integer("version").notNull(),
    conversation_id: text("conversation_id").references(
      () => conversations.id,
      { onDelete: "set null" },
    ),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_identity_agent_type").on(table.agent_id, table.document_type),
    index("idx_identity_agent_type_version").on(
      table.agent_id,
      table.document_type,
      table.version,
    ),
    unique("uq_identity_agent_type_version").on(
      table.agent_id,
      table.document_type,
      table.version,
    ),
  ],
);

// ─── Type Exports ────────────────────────────────────────────────────────────

export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type AgentEvent = typeof agentEvents.$inferSelect;
export type NewAgentEvent = typeof agentEvents.$inferInsert;
export type AgentSession = typeof agentSessions.$inferSelect;
export type NewAgentSession = typeof agentSessions.$inferInsert;
export type AgentEventContent = typeof agentEventContent.$inferSelect;
export type NewAgentEventContent = typeof agentEventContent.$inferInsert;
export type TaskGroup = typeof taskGroups.$inferSelect;
export type NewTaskGroup = typeof taskGroups.$inferInsert;
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type TaskHandoff = typeof taskHandoffs.$inferSelect;
export type NewTaskHandoff = typeof taskHandoffs.$inferInsert;
export type KnowledgeEntry = typeof knowledgeEntries.$inferSelect;
export type NewKnowledgeEntry = typeof knowledgeEntries.$inferInsert;
export type EntityDirectory = typeof entityDirectory.$inferSelect;
export type NewEntityDirectory = typeof entityDirectory.$inferInsert;
export type WorkCorrelation = typeof workCorrelations.$inferSelect;
export type NewWorkCorrelation = typeof workCorrelations.$inferInsert;
export type MaterializationRecord = typeof materializationRecords.$inferSelect;
export type NewMaterializationRecord =
  typeof materializationRecords.$inferInsert;
export type ScheduleStateRow = typeof scheduleState.$inferSelect;
export type NewScheduleStateRow = typeof scheduleState.$inferInsert;
export type IdentityDocument = typeof identityDocuments.$inferSelect;
export type NewIdentityDocument = typeof identityDocuments.$inferInsert;
