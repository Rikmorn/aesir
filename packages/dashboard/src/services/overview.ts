/**
 * Overview Service
 *
 * Abstracts all system overview data aggregation behind typed functions.
 * Provides conversation status counts, active conversations, recent errors,
 * and token usage breakdowns for the landing page dashboard.
 *
 * This service layer runs server-side only (Next.js server components / API routes).
 * Pattern matches services/conversations.ts and services/tools.ts.
 */

import { and, asc, count, desc, eq, gte, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { agentEvents, agentSessions, conversations } from "@/lib/schema";

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Conversation counts by status with mixed time scoping.
 *
 * - running, waiting, queued: Current state counts (no time filter)
 * - completedLast24h, failedLast24h: Counts within the last 24 hours
 */
export interface StatusCounts {
  running: number;
  waiting: number;
  queued: number;
  completedLast24h: number;
  failedLast24h: number;
}

/**
 * An active (running or waiting) conversation with session metadata.
 */
export interface ActiveConversation {
  id: string;
  agentDefinitionId: string;
  status: string;
  createdAt: Date;
  lastEventType: string | null;
}

/**
 * A recent error from either a failed conversation or a tool failure.
 */
export interface RecentError {
  id: string;
  conversationId: string;
  agentDefinitionId: string;
  errorMessage: string;
  timestamp: Date;
  type: "conversation" | "tool";
}

/**
 * Token usage aggregated by agent over the last 24 hours.
 */
export interface TokenUsageByAgent {
  agentDefinitionId: string;
  inputTokens: number;
  outputTokens: number;
}

// ─── Queries ─────────────────────────────────────────────────────────────────

/**
 * Get conversation counts by status with mixed time scoping.
 *
 * Critical: running/waiting/queued are current state (no time filter),
 * while completed/failed are scoped to the last 24 hours.
 * This prevents long-running conversations from being missed while
 * keeping completed/failed counts relevant and bounded.
 *
 * @returns StatusCounts with all fields defaulting to 0 if no matching rows
 */
export async function getConversationStatusCounts(): Promise<StatusCounts> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Two queries in parallel: current state counts + 24h terminal counts
  const [currentRows, terminalRows] = await Promise.all([
    // Current state: running, waiting, queued (no time filter)
    db
      .select({
        status: conversations.status,
        count: count(),
      })
      .from(conversations)
      .where(inArray(conversations.status, ["running", "waiting", "queued"]))
      .groupBy(conversations.status),

    // Terminal state: completed, failed in last 24h
    db
      .select({
        status: conversations.status,
        count: count(),
      })
      .from(conversations)
      .where(
        and(
          inArray(conversations.status, ["completed", "failed"]),
          gte(conversations.updated_at, since),
        ),
      )
      .groupBy(conversations.status),
  ]);

  // Build a lookup map from both result sets
  const countMap = new Map<string, number>();

  for (const row of currentRows) {
    countMap.set(row.status, Number(row.count));
  }
  for (const row of terminalRows) {
    countMap.set(row.status, Number(row.count));
  }

  return {
    running: countMap.get("running") ?? 0,
    waiting: countMap.get("waiting") ?? 0,
    queued: countMap.get("queued") ?? 0,
    completedLast24h: countMap.get("completed") ?? 0,
    failedLast24h: countMap.get("failed") ?? 0,
  };
}

/**
 * Get active conversations (running or waiting) with session metadata.
 *
 * Ordered by created_at ASC (oldest first = longest running first) to
 * surface potentially stuck conversations at the top of the list.
 *
 * LEFT JOINs agent_sessions for the last_event_type field.
 *
 * @param limit - Maximum number of conversations to return (default 10)
 * @returns Array of ActiveConversation sorted by longest running first
 */
export async function getActiveConversations(
  limit = 10,
): Promise<ActiveConversation[]> {
  const rows = await db
    .select({
      id: conversations.id,
      agent_definition_id: conversations.agent_definition_id,
      status: conversations.status,
      created_at: conversations.created_at,
      last_event_type: agentSessions.last_event_type,
    })
    .from(conversations)
    .leftJoin(
      agentSessions,
      eq(agentSessions.conversation_id, conversations.id),
    )
    .where(inArray(conversations.status, ["running", "waiting"]))
    .orderBy(asc(conversations.created_at))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    agentDefinitionId: row.agent_definition_id,
    status: row.status,
    createdAt: row.created_at,
    lastEventType: row.last_event_type,
  }));
}

/**
 * Get recent errors interleaving failed conversations and tool failures.
 *
 * Queries two sources in parallel:
 * 1. Failed conversations in the last 24 hours
 * 2. Tool failure events (type='tool.failed') in the last 24 hours
 *
 * Results are normalized into a common RecentError shape, merged,
 * sorted by timestamp DESC (most recent first), and sliced to limit.
 *
 * Error messages are truncated to 120 characters for display.
 *
 * @param limit - Maximum number of errors to return (default 10)
 * @returns Array of RecentError sorted by most recent first
 */
export async function getRecentErrors(limit = 10): Promise<RecentError[]> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [failedConversations, toolFailures] = await Promise.all([
    // Failed conversations in last 24h
    db
      .select({
        id: conversations.id,
        agent_definition_id: conversations.agent_definition_id,
        error_message: conversations.error_message,
        updated_at: conversations.updated_at,
      })
      .from(conversations)
      .where(
        and(
          eq(conversations.status, "failed"),
          gte(conversations.updated_at, since),
        ),
      )
      .orderBy(desc(conversations.updated_at))
      .limit(limit),

    // Tool failures in last 24h
    db
      .select({
        id: agentEvents.id,
        conversation_id: agentEvents.conversation_id,
        agent_definition_id: agentEvents.agent_definition_id,
        payload: agentEvents.payload,
        timestamp: agentEvents.timestamp,
      })
      .from(agentEvents)
      .where(
        and(
          eq(agentEvents.type, "tool.failed"),
          gte(agentEvents.timestamp, since),
        ),
      )
      .orderBy(desc(agentEvents.timestamp))
      .limit(limit),
  ]);

  // Normalize failed conversations into RecentError
  const conversationErrors: RecentError[] = failedConversations.map((row) => ({
    id: row.id,
    conversationId: row.id,
    agentDefinitionId: row.agent_definition_id,
    errorMessage: truncate(row.error_message ?? "Unknown error", 120),
    timestamp: row.updated_at,
    type: "conversation" as const,
  }));

  // Normalize tool failures into RecentError
  const toolErrors: RecentError[] = toolFailures.map((row) => {
    const payload = row.payload as Record<string, unknown>;
    const toolName = payload.tool_name as string | undefined;
    const output = payload.output as string | undefined;
    const errorMessage = output ?? `${toolName ?? "unknown"} failed`;

    return {
      id: row.id,
      conversationId: row.conversation_id,
      agentDefinitionId: row.agent_definition_id,
      errorMessage: truncate(errorMessage, 120),
      timestamp: row.timestamp,
      type: "tool" as const,
    };
  });

  // Merge, sort by timestamp DESC, and take top N
  return [...conversationErrors, ...toolErrors]
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    .slice(0, limit);
}

/**
 * Get token usage aggregated by agent for a given time range.
 *
 * Filters to type='llm.response' events only (the only event type
 * that records token counts) within the specified window.
 *
 * @param since - Start of the time range (defaults to 24 hours ago)
 * @returns Array of TokenUsageByAgent with input and output token totals
 */
export async function getTokenUsageByAgent(
  since?: Date,
): Promise<TokenUsageByAgent[]> {
  const effectiveSince = since ?? new Date(Date.now() - 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      agent_definition_id: agentEvents.agent_definition_id,
      total_input: sql<number>`coalesce(sum(${agentEvents.token_count_input}), 0)`,
      total_output: sql<number>`coalesce(sum(${agentEvents.token_count_output}), 0)`,
    })
    .from(agentEvents)
    .where(
      and(
        eq(agentEvents.type, "llm.response"),
        gte(agentEvents.timestamp, effectiveSince),
      ),
    )
    .groupBy(agentEvents.agent_definition_id);

  return rows.map((row) => ({
    agentDefinitionId: row.agent_definition_id,
    inputTokens: Number(row.total_input),
    outputTokens: Number(row.total_output),
  }));
}

// ─── Internal Helpers ───────────────────────────────────────────────────────

/**
 * Truncate a string to the specified length, appending ellipsis if truncated.
 */
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return `${str.slice(0, maxLength - 1)}…`;
}
