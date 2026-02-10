/**
 * DirectoryService
 *
 * Factory-based service for the entity directory with semantic capability matching.
 * Agents discover each other by describing capabilities they need; pgvector cosine
 * similarity ranks matching entities.
 *
 * Follows the createService factory pattern from CLAUDE.md:
 * - Options object with fail-fast validation
 * - Interface return type
 * - health() and close() lifecycle methods
 *
 * Key behaviors:
 * - find() uses pgvector cosine similarity for semantic capability matching
 * - find() excludes the calling agent (self-exclusion)
 * - find() returns [] on embedding failure (DIR-06 graceful degradation)
 * - get() returns null for inactive entities (not-found semantics)
 * - upsert() uses ON CONFLICT for idempotent seeding
 * - deactivateStale() scoped to type='agent' only
 */

import type { PinoLogger } from "@aesir/platform";
import {
  and,
  cosineDistance,
  desc,
  eq,
  gt,
  isNotNull,
  ne,
  notInArray,
  sql,
} from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as agentsSchemaModule from "../db/schema.js";
import { entityDirectory } from "../db/schema.js";
import type { EmbeddingService } from "../embedding/types.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const SIMILARITY_THRESHOLD = 0.3;

// ─── Exported Types ─────────────────────────────────────────────────────────

export interface DirectoryEntry {
  id: string;
  name: string;
  type: "agent" | "human";
  description: string;
  capabilities: string[];
}

export interface DirectoryEntryFull extends DirectoryEntry {
  reachVia: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
}

export interface UpsertDirectoryEntry {
  id: string;
  type: "agent" | "human";
  name: string;
  description: string;
  capabilities: string[];
  capabilitiesEmbedding: number[] | null;
  reachVia?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
}

// ─── Service Interface ──────────────────────────────────────────────────────

export interface DirectoryService {
  find(query: string, excludeAgentId: string): Promise<DirectoryEntry[]>;
  get(entityId: string): Promise<DirectoryEntryFull | null>;
  upsert(entry: UpsertDirectoryEntry): Promise<void>;
  deactivateStale(activeIds: string[]): Promise<number>;
  health(): Promise<{ healthy: boolean; latencyMs: number }>;
  close(): Promise<void>;
}

export interface DirectoryServiceOptions {
  db: NodePgDatabase<typeof agentsSchemaModule>;
  embeddingService: EmbeddingService;
  logger: PinoLogger;
}

// ─── Factory ────────────────────────────────────────────────────────────────

export function createDirectoryService(
  options: DirectoryServiceOptions,
): DirectoryService {
  const { db, embeddingService, logger } = options;

  if (!db) throw new Error("db is required for DirectoryService");
  if (!embeddingService)
    throw new Error("embeddingService is required for DirectoryService");
  if (!logger) throw new Error("logger is required for DirectoryService");

  const log = logger.child({ component: "directory-service" });

  return {
    async find(query, excludeAgentId) {
      // Generate query embedding; return [] on failure (DIR-06)
      let queryEmbedding: number[] | null;
      try {
        queryEmbedding = await embeddingService.embed(query);
      } catch (error) {
        log.warn(
          { err: error },
          "Embedding generation failed for directory query, returning empty results",
        );
        return [];
      }

      if (!queryEmbedding) {
        log.warn(
          "Embedding returned null for directory query, returning empty results",
        );
        return [];
      }

      // Cosine similarity: 1 - cosineDistance
      const similarity = sql<number>`1 - (${cosineDistance(entityDirectory.capabilities_embedding, queryEmbedding)})`;

      const rows = await db
        .select({
          id: entityDirectory.id,
          name: entityDirectory.name,
          type: entityDirectory.type,
          description: entityDirectory.description,
          capabilities: entityDirectory.capabilities,
          similarity,
        })
        .from(entityDirectory)
        .where(
          and(
            eq(entityDirectory.status, "active"),
            ne(entityDirectory.id, excludeAgentId),
            isNotNull(entityDirectory.capabilities_embedding),
            gt(similarity, SIMILARITY_THRESHOLD),
          ),
        )
        .orderBy(desc(similarity));

      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        type: row.type as "agent" | "human",
        description: row.description ?? "",
        capabilities: (row.capabilities as string[]) ?? [],
      }));
    },

    async get(entityId) {
      const [row] = await db
        .select()
        .from(entityDirectory)
        .where(eq(entityDirectory.id, entityId))
        .limit(1);

      if (!row) {
        return null;
      }

      // Inactive entities return null (not-found semantics)
      if (row.status === "inactive") {
        log.debug(
          { entityId, name: row.name },
          "Entity '%s' is inactive",
          row.name,
        );
        return null;
      }

      return {
        id: row.id,
        name: row.name,
        type: row.type as "agent" | "human",
        description: row.description ?? "",
        capabilities: (row.capabilities as string[]) ?? [],
        reachVia: (row.reach_via as Record<string, unknown> | null) ?? null,
        metadata: (row.metadata as Record<string, unknown>) ?? {},
      };
    },

    async upsert(entry) {
      await db
        .insert(entityDirectory)
        .values({
          id: entry.id,
          type: entry.type,
          name: entry.name,
          description: entry.description,
          capabilities: entry.capabilities,
          capabilities_embedding: entry.capabilitiesEmbedding ?? undefined,
          reach_via: entry.reachVia ?? null,
          status: "active",
          metadata: entry.metadata ?? {},
          last_seeded_at: new Date(),
        })
        .onConflictDoUpdate({
          target: entityDirectory.id,
          set: {
            name: entry.name,
            description: entry.description,
            capabilities: entry.capabilities,
            ...(entry.capabilitiesEmbedding !== null && {
              capabilities_embedding: entry.capabilitiesEmbedding,
            }),
            reach_via: entry.reachVia ?? null,
            status: "active",
            metadata: entry.metadata ?? {},
            last_seeded_at: new Date(),
            updated_at: new Date(),
          },
        });
    },

    async deactivateStale(activeIds) {
      const result = await db
        .update(entityDirectory)
        .set({ status: "inactive", updated_at: new Date() })
        .where(
          and(
            eq(entityDirectory.type, "agent"),
            eq(entityDirectory.status, "active"),
            notInArray(entityDirectory.id, activeIds),
          ),
        )
        .returning({ id: entityDirectory.id });

      return result.length;
    },

    async health() {
      const start = Date.now();
      try {
        await db.execute(sql`SELECT 1 FROM agents.entity_directory LIMIT 1`);
        return { healthy: true, latencyMs: Date.now() - start };
      } catch {
        return { healthy: false, latencyMs: Date.now() - start };
      }
    },

    async close() {
      log.info("DirectoryService closed (DB connection managed externally)");
    },
  };
}
