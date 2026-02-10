/**
 * KnowledgeService
 *
 * Factory-based service for shared agent knowledge with semantic search.
 * Agents store classified knowledge (discoveries, constraints, decisions,
 * thoughts, preferences, test results) and retrieve it via pgvector
 * cosine similarity search.
 *
 * Follows the createService factory pattern from CLAUDE.md:
 * - Options object with fail-fast validation
 * - Interface return type
 * - health() and close() lifecycle methods
 *
 * Key behaviors:
 * - Scope defaults derived from type (thought is private, rest shared)
 * - Mandatory expiry per type (24h to 30d)
 * - Deduplication: same topic+type auto-supersedes existing entry
 * - Graceful degradation: null embeddings don't block store/query
 * - Query-time expiry filtering (no background job required for freshness)
 */

import type { PinoLogger } from "@aesir/platform";
import { createId } from "@aesir/types";
import { and, cosineDistance, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";
import type * as agentsSchemaModule from "../db/schema.js";
import { knowledgeEntries } from "../db/schema.js";
import type { EmbeddingService } from "../embedding/types.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const KNOWLEDGE_TYPES = [
  "discovery",
  "constraint",
  "architecture_decision",
  "thought",
  "preference",
  "test_result",
] as const;

const SCOPE_DEFAULTS: Record<string, "shared" | "private"> = {
  discovery: "shared",
  constraint: "shared",
  architecture_decision: "shared",
  preference: "shared",
  test_result: "shared",
  thought: "private",
};

const EXPIRY_DURATIONS: Record<string, number> = {
  discovery: 24 * 60 * 60 * 1000, // 24h
  constraint: 30 * 24 * 60 * 60 * 1000, // 30d
  architecture_decision: 7 * 24 * 60 * 60 * 1000, // 7d
  thought: 24 * 60 * 60 * 1000, // 24h
  preference: 30 * 24 * 60 * 60 * 1000, // 30d
  test_result: 7 * 24 * 60 * 60 * 1000, // 7d
};

const SIMILARITY_THRESHOLD = 0.3;
const MAX_CONTENT_LENGTH = 2000;
const MAX_QUERY_LIMIT = 25;
const DEFAULT_QUERY_LIMIT = 10;

// ─── Zod Validation Schemas ─────────────────────────────────────────────────

const StoreKnowledgeParamsSchema = z.object({
  type: z.enum(KNOWLEDGE_TYPES),
  topic: z.string().min(1, "Topic is required"),
  content: z
    .string()
    .min(1, "Content is required")
    .max(
      MAX_CONTENT_LENGTH,
      `Content must be under ${MAX_CONTENT_LENGTH} characters`,
    ),
  author: z.string().min(1, "Author is required"),
  scope: z.enum(["shared", "private"]).optional(),
  tags: z.array(z.string()).optional(),
});

const QueryKnowledgeParamsSchema = z.object({
  query: z.string().min(1, "Query is required"),
  agentId: z.string().min(1, "agentId is required"),
  type: z.enum(KNOWLEDGE_TYPES).optional(),
  topic: z.string().optional(),
  limit: z.number().int().min(1).max(MAX_QUERY_LIMIT).optional(),
});

const SupersedeParamsSchema = z.object({
  content: z.string().min(1, "Content is required").max(MAX_CONTENT_LENGTH),
  author: z.string().min(1, "Author is required"),
  type: z.enum(KNOWLEDGE_TYPES).optional(),
  topic: z.string().optional(),
  scope: z.enum(["shared", "private"]).optional(),
  tags: z.array(z.string()).optional(),
});

// ─── Exported Types ─────────────────────────────────────────────────────────

export type StoreKnowledgeParams = z.input<typeof StoreKnowledgeParamsSchema>;
export type QueryKnowledgeParams = z.input<typeof QueryKnowledgeParamsSchema>;
export type SupersedeParams = z.input<typeof SupersedeParamsSchema>;

export interface StoreKnowledgeResult {
  id: string;
  topic: string;
  type: string;
}

export interface KnowledgeQueryResult {
  id: string;
  type: string;
  topic: string;
  content: string;
  author: string;
  createdAt: string;
}

// ─── Service Interface ──────────────────────────────────────────────────────

export interface KnowledgeServiceOptions {
  db: NodePgDatabase<typeof agentsSchemaModule>;
  embeddingService: EmbeddingService;
  logger: PinoLogger;
}

export interface KnowledgeService {
  store(params: StoreKnowledgeParams): Promise<StoreKnowledgeResult>;
  query(params: QueryKnowledgeParams): Promise<KnowledgeQueryResult[]>;
  supersede(
    entryId: string,
    params: SupersedeParams,
  ): Promise<StoreKnowledgeResult>;
  invalidate(entryId: string, reason?: string): Promise<void>;
  cleanupExpired(): Promise<number>;
  health(): Promise<{ healthy: boolean; latencyMs: number }>;
  close(): Promise<void>;
}

// ─── Factory ────────────────────────────────────────────────────────────────

export function createKnowledgeService(
  options: KnowledgeServiceOptions,
): KnowledgeService {
  const { db, embeddingService, logger } = options;

  if (!db) throw new Error("db is required for KnowledgeService");
  if (!embeddingService)
    throw new Error("embeddingService is required for KnowledgeService");
  if (!logger) throw new Error("logger is required for KnowledgeService");

  const log = logger.child({ component: "knowledge-service" });

  /**
   * Generate embedding for text, returning null on failure (graceful degradation).
   */
  async function generateEmbedding(text: string): Promise<number[] | null> {
    try {
      return await embeddingService.embed(text);
    } catch (error) {
      log.warn(
        { err: error },
        "Embedding generation failed, storing without vector",
      );
      return null;
    }
  }

  /**
   * Create a new knowledge entry row. Shared by store and supersede.
   */
  async function insertEntry(params: {
    type: string;
    topic: string;
    content: string;
    author: string;
    scope: "shared" | "private";
    tags: string[];
    embedding: number[] | null;
    expiresAt: Date;
  }): Promise<StoreKnowledgeResult> {
    const id = createId.knowledgeEntry();

    await db.insert(knowledgeEntries).values({
      id,
      type: params.type as (typeof KNOWLEDGE_TYPES)[number],
      topic: params.topic,
      content: params.content,
      author: params.author,
      scope: params.scope,
      tags: params.tags,
      embedding: params.embedding,
      expires_at: params.expiresAt,
    });

    return { id, topic: params.topic, type: params.type };
  }

  return {
    async store(params) {
      const validated = StoreKnowledgeParamsSchema.parse(params);

      // Normalize topic
      const normalizedTopic = validated.topic.trim().toLowerCase();

      // Determine scope
      const scope =
        validated.scope ?? SCOPE_DEFAULTS[validated.type] ?? "shared";

      // Calculate expiry
      const expiresAt = new Date(
        Date.now() + (EXPIRY_DURATIONS[validated.type] ?? 24 * 60 * 60 * 1000),
      );

      // Deduplication: check for existing active entry with same topic + type
      const [existing] = await db
        .select({ id: knowledgeEntries.id })
        .from(knowledgeEntries)
        .where(
          and(
            eq(knowledgeEntries.type, validated.type),
            sql`LOWER(TRIM(${knowledgeEntries.topic})) = ${normalizedTopic}`,
            eq(knowledgeEntries.invalidated, false),
            isNull(knowledgeEntries.superseded_by),
            gt(knowledgeEntries.expires_at, sql`NOW()`),
          ),
        )
        .limit(1);

      // Generate embedding
      const embedding = await generateEmbedding(
        `${normalizedTopic}: ${validated.content}`,
      );

      // Insert new entry
      const result = await insertEntry({
        type: validated.type,
        topic: normalizedTopic,
        content: validated.content,
        author: validated.author,
        scope,
        tags: validated.tags ?? [],
        embedding,
        expiresAt,
      });

      // If duplicate found, mark old entry as superseded
      if (existing) {
        await db
          .update(knowledgeEntries)
          .set({ superseded_by: result.id })
          .where(eq(knowledgeEntries.id, existing.id));

        log.info(
          { oldId: existing.id, newId: result.id, topic: normalizedTopic },
          "Knowledge entry auto-superseded (duplicate topic+type)",
        );
      }

      log.info(
        { id: result.id, type: validated.type, topic: normalizedTopic },
        "Knowledge entry stored",
      );
      return result;
    },

    async query(params) {
      const validated = QueryKnowledgeParamsSchema.parse(params);
      const limit = validated.limit ?? DEFAULT_QUERY_LIMIT;
      const hasStructuredFilters =
        validated.type !== undefined || validated.topic !== undefined;

      // Build base conditions (always applied)
      const baseConditions = [
        gt(knowledgeEntries.expires_at, sql`NOW()`),
        eq(knowledgeEntries.invalidated, false),
        isNull(knowledgeEntries.superseded_by),
        // Scope visibility: shared entries + own private entries
        sql`(${knowledgeEntries.scope} = 'shared' OR (${knowledgeEntries.scope} = 'private' AND ${knowledgeEntries.author} = ${validated.agentId}))`,
      ];

      // Optional structured filters
      if (validated.type) {
        baseConditions.push(eq(knowledgeEntries.type, validated.type));
      }
      if (validated.topic) {
        const normalizedFilterTopic = validated.topic.trim().toLowerCase();
        baseConditions.push(
          sql`LOWER(TRIM(${knowledgeEntries.topic})) = ${normalizedFilterTopic}`,
        );
      }

      // Attempt to embed the query
      const queryEmbedding = await generateEmbedding(validated.query);

      if (queryEmbedding) {
        // Semantic search: cosine similarity ordering with threshold
        const similarity = sql<number>`1 - (${cosineDistance(knowledgeEntries.embedding, queryEmbedding)})`;

        const rows = await db
          .select({
            id: knowledgeEntries.id,
            type: knowledgeEntries.type,
            topic: knowledgeEntries.topic,
            content: knowledgeEntries.content,
            author: knowledgeEntries.author,
            created_at: knowledgeEntries.created_at,
            similarity,
          })
          .from(knowledgeEntries)
          .where(and(...baseConditions, gt(similarity, SIMILARITY_THRESHOLD)))
          .orderBy(desc(similarity))
          .limit(limit);

        return rows.map((row) => ({
          id: row.id,
          type: row.type,
          topic: row.topic,
          content: row.content,
          author: row.author,
          createdAt: row.created_at.toISOString(),
        }));
      }

      // Embedding failed -- fallback behavior
      if (hasStructuredFilters) {
        // Fall back to structured-only query
        const rows = await db
          .select({
            id: knowledgeEntries.id,
            type: knowledgeEntries.type,
            topic: knowledgeEntries.topic,
            content: knowledgeEntries.content,
            author: knowledgeEntries.author,
            created_at: knowledgeEntries.created_at,
          })
          .from(knowledgeEntries)
          .where(and(...baseConditions))
          .orderBy(desc(knowledgeEntries.created_at))
          .limit(limit);

        return rows.map((row) => ({
          id: row.id,
          type: row.type,
          topic: row.topic,
          content: row.content,
          author: row.author,
          createdAt: row.created_at.toISOString(),
        }));
      }

      // No embedding and no structured filters: return empty (MEM-08)
      return [];
    },

    async supersede(entryId, params) {
      const validated = SupersedeParamsSchema.parse(params);

      // Verify original entry exists and is active
      const [original] = await db
        .select()
        .from(knowledgeEntries)
        .where(eq(knowledgeEntries.id, entryId))
        .limit(1);

      if (!original) {
        throw new Error(`Knowledge entry not found: ${entryId}`);
      }

      if (original.superseded_by !== null) {
        throw new Error(`Knowledge entry already superseded: ${entryId}`);
      }

      if (original.invalidated) {
        throw new Error(`Knowledge entry already invalidated: ${entryId}`);
      }

      // Determine values (inherit from original unless overridden)
      const type = validated.type ?? original.type;
      const topic = (validated.topic ?? original.topic).trim().toLowerCase();
      const scope = validated.scope ?? original.scope;
      const tags = validated.tags ?? (original.tags as string[]);

      // Calculate new expiry
      const expiresAt = new Date(
        Date.now() + (EXPIRY_DURATIONS[type] ?? 24 * 60 * 60 * 1000),
      );

      // Generate embedding for new content
      const embedding = await generateEmbedding(
        `${topic}: ${validated.content}`,
      );

      // Insert new entry
      const result = await insertEntry({
        type,
        topic,
        content: validated.content,
        author: validated.author,
        scope,
        tags,
        embedding,
        expiresAt,
      });

      // Mark original as superseded
      await db
        .update(knowledgeEntries)
        .set({ superseded_by: result.id })
        .where(eq(knowledgeEntries.id, entryId));

      log.info(
        { oldId: entryId, newId: result.id, topic },
        "Knowledge entry superseded",
      );
      return result;
    },

    async invalidate(entryId, reason) {
      const [entry] = await db
        .select({ id: knowledgeEntries.id })
        .from(knowledgeEntries)
        .where(eq(knowledgeEntries.id, entryId))
        .limit(1);

      if (!entry) {
        throw new Error(`Knowledge entry not found: ${entryId}`);
      }

      await db
        .update(knowledgeEntries)
        .set({
          invalidated: true,
          invalidation_reason: reason ?? null,
        })
        .where(eq(knowledgeEntries.id, entryId));

      log.info({ entryId, reason }, "Knowledge entry invalidated");
    },

    async cleanupExpired() {
      const result = await db
        .delete(knowledgeEntries)
        .where(
          sql`${knowledgeEntries.expires_at} < NOW() - INTERVAL '24 hours'`,
        )
        .returning({ id: knowledgeEntries.id });

      const count = result.length;
      if (count > 0) {
        log.info({ count }, "Expired knowledge entries cleaned up");
      }
      return count;
    },

    async health() {
      const start = Date.now();
      try {
        await db.execute(sql`SELECT 1`);
        return { healthy: true, latencyMs: Date.now() - start };
      } catch {
        return { healthy: false, latencyMs: Date.now() - start };
      }
    },

    async close() {
      log.info("KnowledgeService closed (DB connection managed externally)");
    },
  };
}
