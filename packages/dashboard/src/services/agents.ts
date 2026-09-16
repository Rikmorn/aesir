/**
 * Agents Service
 *
 * Combines agent-service HTTP API data (definitions) with database queries
 * (recent conversations). Runs server-side only (Next.js server components / API routes).
 *
 * Pattern matches services/conversations.ts: typed functions, camelCase interfaces,
 * server-side only. The service layer abstraction lets us add caching or enrichment later.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import {
  type AgentDetail,
  type AgentSummary,
  fetchAgentDetail,
  fetchAgentList,
  fetchScheduleStates,
  type ScheduleState,
} from "@/lib/agent-service";
import { db } from "@/lib/db";
import {
  agentEvents,
  agentSessions,
  conversations,
  identityDocuments,
} from "@/lib/schema";

// ─── Re-exports ──────────────────────────────────────────────────────────────

export type { AgentDetail, AgentSummary, ScheduleState };

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RecentConversation {
  id: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  lastActivity: Date | null;
  tokenInput: number;
  tokenOutput: number;
}

export interface IdentityDocumentSummary {
  documentType: string;
  content: string;
  version: number;
  charCount: number;
  conversationId: string | null;
  updatedAt: string; // ISO string
}

export interface IdentityDocumentVersion {
  version: number;
  content: string;
  charCount: number;
  conversationId: string | null;
  createdAt: string; // ISO string
}

// ─── Agent Definitions (HTTP API) ────────────────────────────────────────────

/**
 * Get all agent definitions from the agent-service registry.
 *
 * Delegates to fetchAgentList(). Returns empty array if agent-service is unreachable.
 */
export async function getAgentList(): Promise<AgentSummary[]> {
  return fetchAgentList();
}

/**
 * Get a single agent definition by ID from the agent-service registry.
 *
 * Delegates to fetchAgentDetail(). Returns null if not found or unreachable.
 */
export async function getAgentDetail(id: string): Promise<AgentDetail | null> {
  return fetchAgentDetail(id);
}

// ─── Schedule States (HTTP API) ──────────────────────────────────────────────

/**
 * Get schedule states for a specific agent.
 *
 * Delegates to fetchScheduleStates(). Returns empty array if agent-service is unreachable.
 */
export async function getScheduleStatesForAgent(
  agentId: string,
): Promise<ScheduleState[]> {
  return fetchScheduleStates(agentId);
}

// ─── Recent Conversations (Database) ─────────────────────────────────────────

/**
 * Get recent conversations for a specific agent definition.
 *
 * Queries the conversations table filtered by agent_definition_id,
 * ordered by created_at DESC, with token aggregation from agent_events
 * and last activity from agent_sessions.
 *
 * @param agentDefinitionId - The agent definition ID to filter by
 * @param limit - Maximum number of conversations to return (default 10)
 */
export async function getRecentConversationsByAgent(
  agentDefinitionId: string,
  limit = 10,
): Promise<RecentConversation[]> {
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

  const rows = await db
    .select({
      id: conversations.id,
      status: conversations.status,
      created_at: conversations.created_at,
      updated_at: conversations.updated_at,
      last_event_at: agentSessions.last_event_at,
      token_input: sql<number>`coalesce(${tokenAgg.total_input}, 0)`,
      token_output: sql<number>`coalesce(${tokenAgg.total_output}, 0)`,
    })
    .from(conversations)
    .leftJoin(
      agentSessions,
      eq(agentSessions.conversation_id, conversations.id),
    )
    .leftJoin(tokenAgg, eq(tokenAgg.conversation_id, conversations.id))
    .where(eq(conversations.agent_definition_id, agentDefinitionId))
    .orderBy(desc(conversations.created_at))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastActivity: row.last_event_at,
    tokenInput: Number(row.token_input),
    tokenOutput: Number(row.token_output),
  }));
}

// ─── Identity Documents (Database) ──────────────────────────────────────────

/**
 * Get the current (latest version) of each identity document for an agent.
 *
 * Uses DISTINCT ON (document_type) with ORDER BY version DESC to get the
 * most recent version of each document type in a single query.
 *
 * @param agentId - The agent definition ID
 */
export async function getIdentityDocumentsForAgent(
  agentId: string,
): Promise<IdentityDocumentSummary[]> {
  const rows = await db
    .select({
      document_type: identityDocuments.document_type,
      content: identityDocuments.content,
      version: identityDocuments.version,
      conversation_id: identityDocuments.conversation_id,
      created_at: identityDocuments.created_at,
    })
    .from(identityDocuments)
    .where(eq(identityDocuments.agent_id, agentId))
    .orderBy(identityDocuments.document_type, desc(identityDocuments.version));

  // Deduplicate: keep only the first row (highest version) per document_type
  const seen = new Set<string>();
  const current: IdentityDocumentSummary[] = [];
  for (const row of rows) {
    if (!seen.has(row.document_type)) {
      seen.add(row.document_type);
      current.push({
        documentType: row.document_type,
        content: row.content,
        version: row.version,
        charCount: row.content.length,
        conversationId: row.conversation_id,
        updatedAt: row.created_at.toISOString(),
      });
    }
  }

  return current;
}

/**
 * Get version history for a specific identity document type.
 *
 * Returns paginated versions (newest first) with a hasMore flag
 * using the limit+1 trick.
 *
 * @param agentId - The agent definition ID
 * @param documentType - The document type string
 * @param limit - Maximum versions to return (default 20)
 * @param offset - Number of versions to skip (default 0)
 */
export async function getIdentityDocumentHistory(
  agentId: string,
  documentType: string,
  limit = 20,
  offset = 0,
): Promise<{ versions: IdentityDocumentVersion[]; hasMore: boolean }> {
  const rows = await db
    .select({
      version: identityDocuments.version,
      content: identityDocuments.content,
      conversation_id: identityDocuments.conversation_id,
      created_at: identityDocuments.created_at,
    })
    .from(identityDocuments)
    .where(
      and(
        eq(identityDocuments.agent_id, agentId),
        eq(identityDocuments.document_type, documentType),
      ),
    )
    .orderBy(desc(identityDocuments.version))
    .limit(limit + 1)
    .offset(offset);

  const hasMore = rows.length > limit;
  const trimmed = hasMore ? rows.slice(0, limit) : rows;

  return {
    versions: trimmed.map((row) => ({
      version: row.version,
      content: row.content,
      charCount: row.content.length,
      conversationId: row.conversation_id,
      createdAt: row.created_at.toISOString(),
    })),
    hasMore,
  };
}
