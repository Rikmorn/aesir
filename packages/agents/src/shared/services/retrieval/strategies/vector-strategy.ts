/**
 * Vector Retrieval Strategy
 *
 * Wraps the existing cosine distance search logic from KnowledgeService.query()
 * into the RetrievalStrategy interface. Uses pgvector cosine distance for
 * semantic similarity search over knowledge entry embeddings.
 *
 * Score = 1 - cosineDistance (cosine similarity).
 * Same SIMILARITY_THRESHOLD (0.3) as KnowledgeService.
 */

import { and, cosineDistance, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as agentsSchemaModule from "../../../db/schema.js";
import { knowledgeEntries } from "../../../db/schema.js";
import type { EmbeddingService } from "../../../embedding/types.js";
import type {
  RetrievalScope,
  RetrievalStrategy,
  ScoredResult,
} from "../types.js";

const SIMILARITY_THRESHOLD = 0.3;

/**
 * Creates a vector retrieval strategy that uses pgvector cosine distance.
 *
 * Config must include `embeddingService` -- validated at factory call time.
 * This reuses the exact same cosine distance logic as KnowledgeService.query()
 * semantic path, ensuring behavioral consistency.
 */
export function createVectorStrategy(
  db: NodePgDatabase<typeof agentsSchemaModule>,
  config: Record<string, unknown>,
): RetrievalStrategy {
  const embeddingService = config.embeddingService as
    | EmbeddingService
    | undefined;
  if (!embeddingService) {
    throw new Error(
      "Vector strategy requires embeddingService in config. Provide config.embeddingService.",
    );
  }

  return {
    type: "vector",

    async search(
      query: string,
      scope: RetrievalScope,
      limit: number,
    ): Promise<ScoredResult[]> {
      // Generate embedding for the query
      const queryEmbedding = await embeddingService.embed(query);
      if (!queryEmbedding) {
        // Graceful degradation: return empty if embedding fails
        return [];
      }

      const similarity = sql<number>`1 - (${cosineDistance(knowledgeEntries.embedding, queryEmbedding)})`;

      // Build scope + validity conditions (same as KnowledgeService.query())
      const conditions = [
        gt(knowledgeEntries.expires_at, sql`NOW()`),
        eq(knowledgeEntries.invalidated, false),
        isNull(knowledgeEntries.superseded_by),
        // Scope visibility: shared entries + own private entries
        sql`(${knowledgeEntries.scope} = 'shared' OR (${knowledgeEntries.scope} = 'private' AND ${knowledgeEntries.author} = ${scope.agentId}))`,
        gt(similarity, SIMILARITY_THRESHOLD),
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
          similarity,
        })
        .from(knowledgeEntries)
        .where(and(...conditions))
        .orderBy(desc(similarity))
        .limit(limit);

      return rows.map((row) => {
        const result: ScoredResult = {
          id: row.id,
          score: row.similarity,
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
