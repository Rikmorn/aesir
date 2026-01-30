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
