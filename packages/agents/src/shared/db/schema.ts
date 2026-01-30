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

// ─── Type Exports ────────────────────────────────────────────────────────────

export type ContextSnapshot = typeof contextSnapshots.$inferSelect;
export type NewContextSnapshot = typeof contextSnapshots.$inferInsert;
export type AgentTask = typeof tasks.$inferSelect;
export type NewAgentTask = typeof tasks.$inferInsert;
export type ExecutionTrace = typeof executionTraces.$inferSelect;
export type NewExecutionTrace = typeof executionTraces.$inferInsert;
