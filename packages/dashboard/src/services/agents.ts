/**
 * Agents Service
 *
 * Combines agent-service HTTP API data (definitions) with database queries
 * (recent conversations). Runs server-side only (Next.js server components / API routes).
 *
 * Pattern matches services/conversations.ts: typed functions, camelCase interfaces,
 * server-side only. The service layer abstraction lets us add caching or enrichment later.
 */

import { desc, eq, sql } from "drizzle-orm";
import {
  type AgentDetail,
  type AgentSummary,
  fetchAgentDetail,
  fetchAgentList,
} from "@/lib/agent-service";
import { db } from "@/lib/db";
import { agentEvents, agentSessions, conversations } from "@/lib/schema";

// ─── Re-exports ──────────────────────────────────────────────────────────────

export type { AgentSummary, AgentDetail };

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
