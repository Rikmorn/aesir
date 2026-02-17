/**
 * CorrelationService
 *
 * Factory-based service for managing work correlations between external
 * entities (Linear issues, GitHub PRs, Slack threads) and agent conversations.
 *
 * Follows the createService factory pattern from CLAUDE.md:
 * - Options object with fail-fast validation
 * - Interface return type
 * - health() and close() lifecycle methods
 *
 * Key behaviors:
 * - Register creates or re-activates correlations (ON CONFLICT upsert)
 * - Correlations persist with terminal status (never deleted)
 * - Trust agent input (validation at tool level, not service level)
 * - 5 statuses: active, waiting, completed, failed, superseded
 */

import type { PinoLogger } from "@aesir/platform";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as agentsSchemaModule from "../db/schema.js";
import { type CorrelationStatus, workCorrelations } from "../db/schema.js";

// ─── Exported Types ─────────────────────────────────────────────────────────

export interface WorkCorrelationRow {
  entityType: string;
  entityId: string;
  conversationId: string;
  agentId: string;
  status: string;
  createdAt: string; // ISO string
}

export interface CorrelationServiceOptions {
  db: NodePgDatabase<typeof agentsSchemaModule>;
  logger: PinoLogger;
}

// ─── Service Interface ──────────────────────────────────────────────────────

export interface CorrelationService {
  register(params: {
    entityType: string;
    entityId: string;
    conversationId: string;
    agentId: string;
  }): Promise<void>;
  queryActive(
    entityType: string,
    entityId: string,
  ): Promise<WorkCorrelationRow[]>;
  queryTerminal(
    entityType: string,
    entityId: string,
  ): Promise<WorkCorrelationRow[]>;
  queryAll(entityType: string, entityId: string): Promise<WorkCorrelationRow[]>;
  updateStatus(
    conversationId: string,
    status: CorrelationStatus,
  ): Promise<void>;
  health(): Promise<{ healthy: boolean; latencyMs: number }>;
  close(): Promise<void>;
}

// ─── Factory ────────────────────────────────────────────────────────────────

export function createCorrelationService(
  options: CorrelationServiceOptions,
): CorrelationService {
  const { db, logger } = options;

  if (!db) throw new Error("db is required for CorrelationService");
  if (!logger) throw new Error("logger is required for CorrelationService");

  const log = logger.child({ component: "correlation-service" });

  /**
   * Map a database row to the external WorkCorrelationRow shape.
   */
  function mapRow(row: {
    entity_type: string;
    entity_id: string;
    conversation_id: string;
    agent_id: string;
    status: string;
    created_at: Date;
  }): WorkCorrelationRow {
    return {
      entityType: row.entity_type,
      entityId: row.entity_id,
      conversationId: row.conversation_id,
      agentId: row.agent_id,
      status: row.status,
      createdAt: row.created_at.toISOString(),
    };
  }

  return {
    async register(params) {
      const { entityType, entityId, conversationId, agentId } = params;

      await db
        .insert(workCorrelations)
        .values({
          entity_type: entityType,
          entity_id: entityId,
          conversation_id: conversationId,
          agent_id: agentId,
          status: "active",
        })
        .onConflictDoUpdate({
          target: [
            workCorrelations.entity_type,
            workCorrelations.entity_id,
            workCorrelations.conversation_id,
          ],
          set: {
            status: "active",
            updated_at: sql`NOW()`,
          },
        });

      log.info(
        { entityType, entityId, conversationId, agentId },
        "Work correlation registered",
      );
    },

    async queryActive(entityType, entityId) {
      const rows = await db
        .select()
        .from(workCorrelations)
        .where(
          and(
            eq(workCorrelations.entity_type, entityType),
            eq(workCorrelations.entity_id, entityId),
            inArray(workCorrelations.status, ["active", "waiting"]),
          ),
        );

      return rows.map(mapRow);
    },

    async queryTerminal(entityType, entityId) {
      // Per CONTEXT.md: superseded treated as no active correlation, excluded from terminal results
      const rows = await db
        .select()
        .from(workCorrelations)
        .where(
          and(
            eq(workCorrelations.entity_type, entityType),
            eq(workCorrelations.entity_id, entityId),
            inArray(workCorrelations.status, ["completed", "failed"]),
          ),
        );

      return rows.map(mapRow);
    },

    async queryAll(entityType, entityId) {
      const rows = await db
        .select()
        .from(workCorrelations)
        .where(
          and(
            eq(workCorrelations.entity_type, entityType),
            eq(workCorrelations.entity_id, entityId),
          ),
        );

      return rows.map(mapRow);
    },

    async updateStatus(conversationId, status) {
      await db
        .update(workCorrelations)
        .set({
          status,
          updated_at: sql`NOW()`,
        })
        .where(eq(workCorrelations.conversation_id, conversationId));

      log.info({ conversationId, status }, "Work correlation status updated");
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
      log.info("CorrelationService closed (DB connection managed externally)");
    },
  };
}
