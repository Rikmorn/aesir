/**
 * Agents Database Schema
 *
 * Defines tables for the agents layer (context snapshots, tasks, execution traces).
 * Uses pgSchema for schema namespace isolation.
 *
 * Keep in sync with schema.drizzle.ts (used by drizzle-kit for migration generation).
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

// ─── Context Snapshots ───────────────────────────────────────────────────────

/**
 * Context Snapshots table
 *
 * Stores semantic context at Temporal activity boundaries.
 * Written at the end of each activity, read at the start of the next.
 * Contains LLM-generated summaries and programmatic extraction of key state.
 */
export const contextSnapshots = agentsSchema.table(
  "context_snapshots",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId.contextSnapshot()),
    task_id: text("task_id").notNull(),
    workflow_id: text("workflow_id").notNull(),
    agent_type: text("agent_type").notNull(), // "dev-orchestrator", "product", etc.
    stage: text("stage").notNull(), // "post-research", "post-approval", "post-execution"

    // Semantic context (LLM-generated + programmatic)
    summary: text("summary").notNull(),
    completed_actions: jsonb("completed_actions").$type<string[]>().default([]),
    pending_intent: text("pending_intent"),
    known_issues: jsonb("known_issues").$type<string[]>().default([]),
    project_context: jsonb("project_context")
      .$type<Record<string, unknown>>()
      .default({}),
    key_files: jsonb("key_files").$type<string[]>().default([]),
    research_findings: jsonb("research_findings").$type<unknown>(),
    plan: jsonb("plan").$type<unknown>(),

    // Metadata
    tool_call_count: integer("tool_call_count").notNull().default(0),
    token_count: jsonb("token_count")
      .$type<{ input: number; output: number }>()
      .default({ input: 0, output: 0 }),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("context_snapshots_task_idx").on(table.task_id),
    index("context_snapshots_workflow_idx").on(table.workflow_id),
  ],
);

// ─── Tasks ───────────────────────────────────────────────────────────────────

/**
 * Task status values
 */
export const taskStatusValues = [
  "pending",
  "researching",
  "planning",
  "approved",
  "executing",
  "complete",
  "failed",
] as const;
export type TaskStatus = (typeof taskStatusValues)[number];

/**
 * Approval status values
 */
export const approvalStatusValues = [
  "pending",
  "approved",
  "rejected",
] as const;
export type ApprovalStatus = (typeof approvalStatusValues)[number];

/**
 * Tasks table
 *
 * Tracks agent task lifecycle and critical structured data.
 * One row per external task (e.g., Linear issue).
 */
export const tasks = agentsSchema.table(
  "tasks",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId.agentTask()),
    task_id: text("task_id").notNull().unique(), // External task ID (e.g., Linear issue UUID)
    issue_id: text("issue_id"),
    issue_identifier: text("issue_identifier"), // e.g., "AES-42"
    agent_type: text("agent_type").notNull(), // "dev" or "product"
    workflow_id: text("workflow_id"),
    status: text("status", { enum: taskStatusValues })
      .notNull()
      .default("pending"),

    // Critical structured data (typed columns, not JSONB)
    container_id: text("container_id"),
    branch_name: text("branch_name"),
    pr_number: integer("pr_number"),
    pr_url: text("pr_url"),
    approval_status: text("approval_status", {
      enum: approvalStatusValues,
    }).default("pending"),
    approval_feedback: text("approval_feedback"),

    // Error tracking
    error: text("error"),
    escalation_reason: text("escalation_reason"),

    // Slack context
    slack_channel: text("slack_channel"),
    slack_message_ts: text("slack_message_ts"),

    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("tasks_workflow_idx").on(table.workflow_id),
    index("tasks_status_idx").on(table.status),
  ],
);

// ─── Execution Traces ────────────────────────────────────────────────────────

/**
 * Trace type values
 */
export const traceTypeValues = [
  "tool_call",
  "tool_result",
  "llm_response",
  "agent_spawn",
  "agent_complete",
] as const;
export type TraceType = (typeof traceTypeValues)[number];

/**
 * Execution Traces table
 *
 * Records per-step execution traces for debugging and observability.
 * Written by the trace recorder callbacks during runAgentLoop().
 * Supports parent/child correlation for orchestrator + sub-agent hierarchies.
 */
export const executionTraces = agentsSchema.table(
  "execution_traces",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId.executionTrace()),
    task_id: text("task_id").notNull(),
    workflow_id: text("workflow_id").notNull(),
    agent_type: text("agent_type").notNull(), // "dev-orchestrator", "researcher", "coder"
    agent_instance_id: text("agent_instance_id").notNull(), // Unique per agent invocation
    parent_agent_instance_id: text("parent_agent_instance_id"), // null for orchestrator
    step_number: integer("step_number").notNull(),

    type: text("type", { enum: traceTypeValues }).notNull(),
    tool_name: text("tool_name"), // null for LLM responses
    input: jsonb("input").$type<unknown>(), // Tool params or spawn context
    output: jsonb("output").$type<unknown>(), // Tool result or agent result

    // Cost tracking
    token_count_input: integer("token_count_input"),
    token_count_output: integer("token_count_output"),
    duration_ms: integer("duration_ms"),

    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("execution_traces_task_idx").on(table.task_id),
    index("execution_traces_instance_idx").on(table.agent_instance_id),
    index("execution_traces_parent_idx").on(table.parent_agent_instance_id),
    index("execution_traces_workflow_idx").on(table.workflow_id),
  ],
);

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

export type ContextSnapshot = typeof contextSnapshots.$inferSelect;
export type NewContextSnapshot = typeof contextSnapshots.$inferInsert;
export type AgentTask = typeof tasks.$inferSelect;
export type NewAgentTask = typeof tasks.$inferInsert;
export type ExecutionTrace = typeof executionTraces.$inferSelect;
export type NewExecutionTrace = typeof executionTraces.$inferInsert;
export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type AgentEvent = typeof agentEvents.$inferSelect;
export type NewAgentEvent = typeof agentEvents.$inferInsert;
export type AgentSession = typeof agentSessions.$inferSelect;
export type NewAgentSession = typeof agentSessions.$inferInsert;
