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

// ─── Context Snapshots ───────────────────────────────────────────────────────

const taskStatusValues = [
  "pending",
  "researching",
  "planning",
  "approved",
  "executing",
  "complete",
  "failed",
] as const;

const approvalStatusValues = ["pending", "approved", "rejected"] as const;

const traceTypeValues = [
  "tool_call",
  "tool_result",
  "llm_response",
  "agent_spawn",
  "agent_complete",
] as const;

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
  "signal.received",
] as const;

const sessionStatusValues = [
  "running",
  "waiting",
  "completed",
  "failed",
] as const;

export const contextSnapshots = agentsSchema.table(
  "context_snapshots",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => `ctx_${nanoid()}`),
    task_id: text("task_id").notNull(),
    workflow_id: text("workflow_id").notNull(),
    agent_type: text("agent_type").notNull(),
    stage: text("stage").notNull(),

    summary: text("summary").notNull(),
    completed_actions: jsonb("completed_actions").default([]),
    pending_intent: text("pending_intent"),
    known_issues: jsonb("known_issues").default([]),
    project_context: jsonb("project_context").default({}),
    key_files: jsonb("key_files").default([]),
    research_findings: jsonb("research_findings"),
    plan: jsonb("plan"),

    tool_call_count: integer("tool_call_count").notNull().default(0),
    token_count: jsonb("token_count").default({ input: 0, output: 0 }),
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

export const tasks = agentsSchema.table(
  "tasks",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => `atask_${nanoid()}`),
    task_id: text("task_id").notNull().unique(),
    issue_id: text("issue_id"),
    issue_identifier: text("issue_identifier"),
    agent_type: text("agent_type").notNull(),
    workflow_id: text("workflow_id"),
    status: text("status", { enum: taskStatusValues })
      .notNull()
      .default("pending"),

    container_id: text("container_id"),
    branch_name: text("branch_name"),
    pr_number: integer("pr_number"),
    pr_url: text("pr_url"),
    approval_status: text("approval_status", {
      enum: approvalStatusValues,
    }).default("pending"),
    approval_feedback: text("approval_feedback"),

    error: text("error"),
    escalation_reason: text("escalation_reason"),

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

export const executionTraces = agentsSchema.table(
  "execution_traces",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => `trace_${nanoid()}`),
    task_id: text("task_id").notNull(),
    workflow_id: text("workflow_id").notNull(),
    agent_type: text("agent_type").notNull(),
    agent_instance_id: text("agent_instance_id").notNull(),
    parent_agent_instance_id: text("parent_agent_instance_id"),
    step_number: integer("step_number").notNull(),

    type: text("type", { enum: traceTypeValues }).notNull(),
    tool_name: text("tool_name"),
    input: jsonb("input"),
    output: jsonb("output"),

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
    delivered_signal_ids: jsonb("delivered_signal_ids").notNull().default([]),
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
