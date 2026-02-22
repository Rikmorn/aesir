/**
 * IdentityService
 *
 * Factory-based service for persistent agent identity documents.
 * Agents maintain versioned documents (mental models, personality notes,
 * project context, etc.) that persist across all conversations and are
 * injected into the system prompt at conversation start.
 *
 * Follows the createService factory pattern from CLAUDE.md:
 * - Options object with fail-fast validation
 * - Interface return type
 * - health() and close() lifecycle methods
 *
 * Key behaviors:
 * - Full replacement semantics: every update creates a new version row
 * - Agent scoping: all queries are scoped to the calling agent's ID
 * - 5-document cap per agent (distinct document_type values)
 * - 12,000 character limit per document
 * - Version history preserved for audit/rollback
 */

import type { PinoLogger } from "@aesir/platform";
import { createId } from "@aesir/types";
import { and, desc, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as agentsSchemaModule from "../db/schema.js";
import { identityDocuments } from "../db/schema.js";

// ─── Constants ───────────────────────────────────────────────────────────────

export const IDENTITY_MAX_DOCUMENTS = 5;
export const IDENTITY_MAX_CHARS_PER_DOCUMENT = 12_000;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface IdentityDocumentVersion {
  id: string;
  agentId: string;
  documentType: string;
  content: string;
  version: number;
  conversationId: string | null;
  createdAt: string;
}

export interface UpdateDocumentParams {
  agentId: string;
  documentType: string;
  content: string;
  conversationId: string;
}

export interface UpdateDocumentResult {
  version: number;
  documentType: string;
  allDocuments: string[];
}

// ─── Service Interface ──────────────────────────────────────────────────────

export interface IdentityServiceOptions {
  db: NodePgDatabase<typeof agentsSchemaModule>;
  logger: PinoLogger;
}

export interface IdentityService {
  /**
   * Get the latest version of each document for an agent.
   * Returns documents ordered by document_type.
   */
  getCurrentDocuments(agentId: string): Promise<IdentityDocumentVersion[]>;

  /**
   * Get version history for a specific document, newest first.
   */
  getDocumentHistory(
    agentId: string,
    documentType: string,
    options?: { limit?: number; offset?: number },
  ): Promise<IdentityDocumentVersion[]>;

  /**
   * Create a new version of a document.
   * Validates char limit (12,000) and document cap (5 per agent).
   */
  updateDocument(params: UpdateDocumentParams): Promise<UpdateDocumentResult>;

  /**
   * Get count of distinct document types for an agent.
   */
  getDocumentCount(agentId: string): Promise<number>;

  /**
   * Health check: verifies database connectivity.
   */
  health(): Promise<{ healthy: boolean; latencyMs: number }>;

  /**
   * Graceful shutdown.
   */
  close(): Promise<void>;
}

// ─── Factory ────────────────────────────────────────────────────────────────

export function createIdentityService(
  options: IdentityServiceOptions,
): IdentityService {
  const { db, logger } = options;

  if (!db) throw new Error("db is required for IdentityService");
  if (!logger) throw new Error("logger is required for IdentityService");

  const log = logger.child({ component: "identity-service" });

  /**
   * Map a database row to the public IdentityDocumentVersion shape.
   */
  function toVersion(row: {
    id: string;
    agent_id: string;
    document_type: string;
    content: string;
    version: number;
    conversation_id: string | null;
    created_at: Date;
  }): IdentityDocumentVersion {
    return {
      id: row.id,
      agentId: row.agent_id,
      documentType: row.document_type,
      content: row.content,
      version: row.version,
      conversationId: row.conversation_id,
      createdAt: row.created_at.toISOString(),
    };
  }

  return {
    async getCurrentDocuments(agentId) {
      // DISTINCT ON (document_type) with ORDER BY document_type, version DESC
      // gives us the latest version of each document_type for this agent.
      const rows = await db.execute(sql`
        SELECT DISTINCT ON (document_type) *
        FROM agents.identity_documents
        WHERE agent_id = ${agentId}
        ORDER BY document_type, version DESC
      `);

      return (
        rows.rows as Array<{
          id: string;
          agent_id: string;
          document_type: string;
          content: string;
          version: number;
          conversation_id: string | null;
          created_at: Date;
        }>
      ).map(toVersion);
    },

    async getDocumentHistory(agentId, documentType, opts) {
      const limit = opts?.limit ?? 20;
      const offset = opts?.offset ?? 0;

      const rows = await db
        .select()
        .from(identityDocuments)
        .where(
          and(
            eq(identityDocuments.agent_id, agentId),
            eq(identityDocuments.document_type, documentType),
          ),
        )
        .orderBy(desc(identityDocuments.version))
        .limit(limit)
        .offset(offset);

      return rows.map(toVersion);
    },

    async updateDocument(params) {
      const { agentId, documentType, content, conversationId } = params;

      // Validate character limit
      if (content.length > IDENTITY_MAX_CHARS_PER_DOCUMENT) {
        throw new Error(
          `Document exceeds 12,000 character limit (submitted: ${content.length}). Rewrite more concisely.`,
        );
      }

      // Check if this is an existing document_type for this agent
      const [existingVersion] = await db
        .select({ version: identityDocuments.version })
        .from(identityDocuments)
        .where(
          and(
            eq(identityDocuments.agent_id, agentId),
            eq(identityDocuments.document_type, documentType),
          ),
        )
        .orderBy(desc(identityDocuments.version))
        .limit(1);

      // If this is a new document_type, check the document cap
      if (!existingVersion) {
        const count = await this.getDocumentCount(agentId);
        if (count >= IDENTITY_MAX_DOCUMENTS) {
          // Get current document types for the error message
          const currentDocs = await db
            .selectDistinct({ documentType: identityDocuments.document_type })
            .from(identityDocuments)
            .where(eq(identityDocuments.agent_id, agentId));

          const docList = currentDocs
            .map((d) => d.documentType)
            .sort()
            .join(", ");

          throw new Error(
            `Maximum 5 identity documents reached. Your documents: ${docList}. Update an existing document or replace one.`,
          );
        }
      }

      // Determine next version
      const nextVersion = existingVersion ? existingVersion.version + 1 : 1;

      // Insert new version
      const id = createId.identityDocument();
      await db.insert(identityDocuments).values({
        id,
        agent_id: agentId,
        document_type: documentType,
        content,
        version: nextVersion,
        conversation_id: conversationId,
      });

      // Get all current document types for this agent
      const allDocs = await db
        .selectDistinct({ documentType: identityDocuments.document_type })
        .from(identityDocuments)
        .where(eq(identityDocuments.agent_id, agentId));

      const allDocuments = allDocs.map((d) => d.documentType).sort();

      log.info(
        {
          agentId,
          documentType,
          version: nextVersion,
          contentLength: content.length,
        },
        "Identity document updated",
      );

      return {
        version: nextVersion,
        documentType,
        allDocuments,
      };
    },

    async getDocumentCount(agentId) {
      const [result] = await db
        .select({
          count: sql<number>`COUNT(DISTINCT ${identityDocuments.document_type})`,
        })
        .from(identityDocuments)
        .where(eq(identityDocuments.agent_id, agentId));

      return Number(result?.count ?? 0);
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
      log.info("IdentityService closed (DB connection managed externally)");
    },
  };
}
