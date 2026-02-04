/**
 * Conversations Service
 *
 * Abstracts all conversation database queries behind typed functions.
 * This service layer runs server-side only (Next.js server components / API routes).
 *
 * When the dashboard eventually migrates from direct DB access to REST API calls,
 * only this file needs to change -- all consumers use the same typed interface.
 */

import { count, desc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { type ConversationStatus, conversations } from "@/lib/schema";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ConversationSummary {
  id: string;
  agentDefinitionId: string;
  status: string;
  retryCount: number;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversationStatusCount {
  status: string;
  count: number;
}

// ─── Queries ─────────────────────────────────────────────────────────────────

/**
 * List conversations with optional filtering and pagination.
 *
 * Returns typed ConversationSummary objects with camelCase field names,
 * ordered by most recently updated first.
 */
export async function listConversations(opts?: {
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<ConversationSummary[]> {
  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;

  const query = db
    .select({
      id: conversations.id,
      agent_definition_id: conversations.agent_definition_id,
      status: conversations.status,
      retry_count: conversations.retry_count,
      error_message: conversations.error_message,
      created_at: conversations.created_at,
      updated_at: conversations.updated_at,
    })
    .from(conversations)
    .orderBy(desc(conversations.updated_at))
    .limit(limit)
    .offset(offset);

  const rows = opts?.status
    ? await query.where(
        eq(conversations.status, opts.status as ConversationStatus),
      )
    : await query;

  return rows.map((row) => ({
    id: row.id,
    agentDefinitionId: row.agent_definition_id,
    status: row.status,
    retryCount: row.retry_count,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
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
