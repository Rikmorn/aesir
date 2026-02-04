/**
 * Conversations Service
 *
 * Abstracts all conversation database queries behind typed functions.
 * This service layer runs server-side only (Next.js server components / API routes).
 *
 * When the dashboard eventually migrates from direct DB access to REST API calls,
 * only this file needs to change -- all consumers use the same typed interface.
 */

import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  lte,
  type SQL,
  sql,
} from "drizzle-orm";

import { db } from "@/lib/db";
import {
  agentEvents,
  agentSessions,
  type ConversationStatus,
  conversations,
} from "@/lib/schema";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ConversationListParams {
  status?: string[];
  agentDefinitionId?: string[];
  timeRange?: { from: Date; to?: Date };
  hasErrors?: boolean;
  limit?: number;
  offset?: number;
}

export interface ConversationListItem {
  id: string;
  agentDefinitionId: string;
  status: string;
  triggerEventType: string | null;
  tokenInput: number;
  tokenOutput: number;
  createdAt: Date;
  updatedAt: Date;
  lastActivity: Date | null;
  errorMessage: string | null;
}

export interface ConversationStatusCount {
  status: string;
  count: number;
}

// ─── Queries ─────────────────────────────────────────────────────────────────

/**
 * List conversations with multi-filter support, token aggregation, and pagination.
 *
 * Returns typed ConversationListItem objects with:
 * - Token usage (input + output) aggregated from llm.response events
 * - Trigger event type derived from the first agent_events row
 * - Last activity from agent_sessions
 * - Pagination total count for page controls
 *
 * Ordered by created_at DESC (newest first).
 */
export async function listConversations(
  params: ConversationListParams,
): Promise<{ items: ConversationListItem[]; total: number }> {
  const limit = params.limit ?? 25;
  const offset = params.offset ?? 0;
  const conditions = buildFilters(params);
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Token aggregation subquery: sum input/output tokens from llm.response events
  const tokenAgg = db
    .select({
      conversation_id: agentEvents.conversation_id,
      total_input:
        sql<number>`coalesce(sum(${agentEvents.token_count_input}), 0)`.as(
          "total_input",
        ),
      total_output:
        sql<number>`coalesce(sum(${agentEvents.token_count_output}), 0)`.as(
          "total_output",
        ),
    })
    .from(agentEvents)
    .where(eq(agentEvents.type, "llm.response"))
    .groupBy(agentEvents.conversation_id)
    .as("token_agg");

  // Main query with joins and trigger event type subquery
  const rows = await db
    .select({
      id: conversations.id,
      agent_definition_id: conversations.agent_definition_id,
      status: conversations.status,
      error_message: conversations.error_message,
      created_at: conversations.created_at,
      updated_at: conversations.updated_at,
      last_event_at: agentSessions.last_event_at,
      token_input: sql<number>`coalesce(${tokenAgg.total_input}, 0)`,
      token_output: sql<number>`coalesce(${tokenAgg.total_output}, 0)`,
      trigger_event_type: sql<
        string | null
      >`(SELECT type FROM agents.agent_events WHERE conversation_id = ${conversations.id} ORDER BY sequence ASC LIMIT 1)`.as(
        "trigger_event_type",
      ),
    })
    .from(conversations)
    .leftJoin(
      agentSessions,
      eq(agentSessions.conversation_id, conversations.id),
    )
    .leftJoin(tokenAgg, eq(tokenAgg.conversation_id, conversations.id))
    .where(whereClause)
    .orderBy(desc(conversations.created_at))
    .limit(limit)
    .offset(offset);

  // Separate total count query for pagination
  const [countResult] = await db
    .select({ total: count() })
    .from(conversations)
    .where(whereClause);

  return {
    items: rows.map((row) => ({
      id: row.id,
      agentDefinitionId: row.agent_definition_id,
      status: row.status,
      triggerEventType: row.trigger_event_type,
      tokenInput: Number(row.token_input),
      tokenOutput: Number(row.token_output),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastActivity: row.last_event_at,
      errorMessage: row.error_message,
    })),
    total: Number(countResult?.total ?? 0),
  };
}

/**
 * Get distinct agent definition IDs for filter dropdown population.
 *
 * Returns a sorted array of unique agent IDs that have at least one conversation.
 */
export async function getDistinctAgentDefinitions(): Promise<string[]> {
  const rows = await db
    .selectDistinct({
      agentDefinitionId: conversations.agent_definition_id,
    })
    .from(conversations);

  return rows.map((r) => r.agentDefinitionId).sort();
}

/**
 * Count conversations grouped by status.
 *
 * Returns an array of { status, count } objects for each status
 * that has at least one conversation.
 */
export async function countConversationsByStatus(): Promise<
  ConversationStatusCount[]
> {
  const rows = await db
    .select({
      status: conversations.status,
      count: count(),
    })
    .from(conversations)
    .groupBy(conversations.status);

  return rows.map((row) => ({
    status: row.status,
    count: Number(row.count),
  }));
}

// ─── Filter Builder ──────────────────────────────────────────────────────────

/**
 * Build dynamic WHERE conditions from filter parameters.
 *
 * Returns an array of SQL conditions. Use with `and(...conditions)` when non-empty,
 * or `undefined` when empty (no filters applied).
 */
function buildFilters(params: ConversationListParams): SQL[] {
  const conditions: SQL[] = [];

  if (params.status?.length) {
    conditions.push(
      inArray(conversations.status, params.status as ConversationStatus[]),
    );
  }

  if (params.agentDefinitionId?.length) {
    conditions.push(
      inArray(conversations.agent_definition_id, params.agentDefinitionId),
    );
  }

  if (params.timeRange?.from) {
    conditions.push(gte(conversations.created_at, params.timeRange.from));
  }

  if (params.timeRange?.to) {
    conditions.push(lte(conversations.created_at, params.timeRange.to));
  }

  if (params.hasErrors) {
    conditions.push(eq(conversations.status, "failed" as ConversationStatus));
  }

  return conditions;
}
