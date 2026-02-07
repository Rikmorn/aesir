/**
 * Shared formatting helpers for task tool plain text responses.
 *
 * All task tool output targets the LLM as the sole consumer,
 * so plain text is preferred over JSON (per CONTEXT.md decisions).
 */

import type { Task, TaskHandoff } from "../../db/schema.js";

/**
 * Format a handoff's context fields into plain text lines.
 *
 * Extracts known structured fields (summary, key_decisions, artifacts,
 * open_questions, next_steps) from the handoff context JSONB.
 */
export function formatHandoffContext(handoff: TaskHandoff): string {
  const ctx = handoff.context as Record<string, unknown>;
  const lines: string[] = [];

  if (ctx.summary) lines.push(`Summary: ${ctx.summary}`);
  if (Array.isArray(ctx.key_decisions) && ctx.key_decisions.length > 0) {
    lines.push("Key Decisions:");
    for (const d of ctx.key_decisions) lines.push(`  - ${d}`);
  }
  if (
    ctx.artifacts &&
    typeof ctx.artifacts === "object" &&
    Object.keys(ctx.artifacts as object).length > 0
  ) {
    lines.push(`Artifacts: ${JSON.stringify(ctx.artifacts)}`);
  }
  if (Array.isArray(ctx.open_questions) && ctx.open_questions.length > 0) {
    lines.push("Open Questions:");
    for (const q of ctx.open_questions) lines.push(`  - ${q}`);
  }
  if (ctx.next_steps) lines.push(`Next Steps: ${ctx.next_steps}`);

  return lines.join("\n");
}

/**
 * Format a task as a single summary row for list_tasks output.
 *
 * Includes optional last handoff summary (truncated to 200 chars)
 * for disambiguation of similarly-titled tasks.
 */
export function formatTaskSummaryRow(
  task: Task,
  lastHandoffSummary?: string,
): string {
  const lines = [
    `${task.id} | ${task.title} | ${task.status} | ${task.assignee_type}:${task.assignee_id} | ${task.created_at.toISOString().slice(0, 10)}`,
  ];
  if (lastHandoffSummary) {
    const truncated =
      lastHandoffSummary.length > 200
        ? `${lastHandoffSummary.slice(0, 197)}...`
        : lastHandoffSummary;
    lines.push(`  Last handoff: ${truncated}`);
  }
  return lines.join("\n");
}
