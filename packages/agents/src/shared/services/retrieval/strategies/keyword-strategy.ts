/**
 * Keyword Retrieval Strategy
 *
 * PostgreSQL full-text search over knowledge entries using tsvector/tsquery.
 * Uses the GIN expression index on (to_tsvector('english', topic || ' ' || content))
 * created in migration 0021_add_knowledge_fulltext_index.sql.
 *
 * Score = ts_rank() which provides relevance ranking based on term frequency.
 * Applies the same scope/expiry/invalidation/superseded filters as vector strategy.
 */

import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as agentsSchemaModule from "../../../db/schema.js";
import { knowledgeEntries } from "../../../db/schema.js";
import type {
  RetrievalScope,
  RetrievalStrategy,
  ScoredResult,
} from "../types.js";

/**
 * Creates a keyword retrieval strategy using PostgreSQL full-text search.
 *
 * No special config is required for keyword strategy -- it only needs the db
 * connection. Config is accepted but not used (validated for consistency).
 */
export function createKeywordStrategy(
  db: NodePgDatabase<typeof agentsSchemaModule>,
  _config: Record<string, unknown>,
): RetrievalStrategy {
  return {
    type: "keyword",

    async search(
      query: string,
      scope: RetrievalScope,
      limit: number,
    ): Promise<ScoredResult[]> {
      // Build the tsvector and tsquery expressions
      const tsVector = sql`to_tsvector('english', ${knowledgeEntries.topic} || ' ' || ${knowledgeEntries.content})`;
      const tsQuery = sql`plainto_tsquery('english', ${query})`;
      const rank = sql<number>`ts_rank(${tsVector}, ${tsQuery})`;

      // Scope + validity conditions (same as vector strategy)
      const conditions = [
        gt(knowledgeEntries.expires_at, sql`NOW()`),
        eq(knowledgeEntries.invalidated, false),
        isNull(knowledgeEntries.superseded_by),
        // Scope visibility: shared entries + own private entries
        sql`(${knowledgeEntries.scope} = 'shared' OR (${knowledgeEntries.scope} = 'private' AND ${knowledgeEntries.author} = ${scope.agentId}))`,
        // Only return rows that actually match the full-text query
        sql`${tsVector} @@ ${tsQuery}`,
      ];

      const rows = await db
        .select({
          id: knowledgeEntries.id,
          type: knowledgeEntries.type,
          topic: knowledgeEntries.topic,
          content: knowledgeEntries.content,
          author: knowledgeEntries.author,
          created_at: knowledgeEntries.created_at,
          metadata: knowledgeEntries.metadata,
          rank,
        })
        .from(knowledgeEntries)
        .where(and(...conditions))
        .orderBy(desc(rank))
        .limit(limit);

      return rows.map((row) => {
        const result: ScoredResult = {
          id: row.id,
          score: row.rank,
          content: row.content,
          topic: row.topic,
          type: row.type,
          author: row.author,
          createdAt: row.created_at.toISOString(),
        };
        if (
          row.metadata &&
          typeof row.metadata === "object" &&
          Object.keys(row.metadata).length > 0
        ) {
          result.metadata = row.metadata;
        }
        return result;
      });
    },
  };
}
