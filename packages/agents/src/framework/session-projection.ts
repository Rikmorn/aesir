/**
 * Session Projection
 *
 * Reactive projection that subscribes to EventLog events and maintains
 * the agent_sessions table with current status, timing, and ground-truth
 * artifacts extracted from tool.succeeded events.
 *
 * Downstream consumers (History Manager, management endpoints) read
 * agent_sessions instead of scanning the full event log.
 */

import { eq, sql } from "drizzle-orm";
import type { AgentEvent } from "../shared/db/schema.js";
import { agentSessions } from "../shared/db/schema.js";
import type { SessionProjection, SessionProjectionOptions } from "./types.js";

// ─── Helper ─────────────────────────────────────────────────────────────────

/**
 * Resolve a dot-notation path into a nested object value.
 * Returns undefined if any segment is missing.
 *
 * Example: getNestedValue({ result: { prUrl: "..." } }, "result.prUrl") -> "..."
 */
export function getNestedValue(
  obj: Record<string, unknown>,
  path: string,
): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (current, key) =>
        current !== null && current !== undefined && typeof current === "object"
          ? (current as Record<string, unknown>)[key]
          : undefined,
      obj,
    );
}

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Create a SessionProjection that reactively updates agent_sessions
 * from EventLog lifecycle and tool events.
 *
 * Follows the dependency injection factory pattern from task-store.ts.
 */
export function createSessionProjection(
  options: SessionProjectionOptions,
): SessionProjection {
  const { db, logger: parentLogger, eventLog, artifactConfig } = options;

  if (!db) throw new Error("db is required for SessionProjection");
  if (!parentLogger)
    throw new Error("logger is required for SessionProjection");
  if (!eventLog) throw new Error("eventLog is required for SessionProjection");
  if (!artifactConfig)
    throw new Error("artifactConfig is required for SessionProjection");

  const logger = parentLogger.child({ component: "session-projection" });

  // ─── Event Handlers ─────────────────────────────────────────────────────

  async function handleAgentStarted(event: AgentEvent): Promise<void> {
    await db
      .insert(agentSessions)
      .values({
        conversation_id: event.conversation_id,
        agent_definition_id: event.agent_definition_id,
        status: "running",
        last_event_type: event.type,
        last_event_at: event.timestamp,
        artifacts: {},
        started_at: event.timestamp,
      })
      .onConflictDoUpdate({
        target: agentSessions.conversation_id,
        set: {
          status: "running",
          last_event_type: event.type,
          last_event_at: event.timestamp,
          updated_at: new Date(),
        },
      });
  }

  async function handleAgentCompleted(event: AgentEvent): Promise<void> {
    const status = (event.payload as Record<string, unknown>)?.error
      ? "failed"
      : "completed";

    await db
      .update(agentSessions)
      .set({
        status,
        last_event_type: event.type,
        last_event_at: event.timestamp,
        updated_at: new Date(),
      })
      .where(eq(agentSessions.conversation_id, event.conversation_id));
  }

  async function handleAgentPaused(event: AgentEvent): Promise<void> {
    await db
      .update(agentSessions)
      .set({
        status: "waiting",
        last_event_type: event.type,
        last_event_at: event.timestamp,
        updated_at: new Date(),
      })
      .where(eq(agentSessions.conversation_id, event.conversation_id));
  }

  async function handleAgentResumed(event: AgentEvent): Promise<void> {
    await db
      .update(agentSessions)
      .set({
        status: "running",
        last_event_type: event.type,
        last_event_at: event.timestamp,
        updated_at: new Date(),
      })
      .where(eq(agentSessions.conversation_id, event.conversation_id));
  }

  async function handleAgentReopened(event: AgentEvent): Promise<void> {
    await db
      .update(agentSessions)
      .set({
        status: "running",
        last_event_type: event.type,
        last_event_at: event.timestamp,
        updated_at: new Date(),
      })
      .where(eq(agentSessions.conversation_id, event.conversation_id));
  }

  async function handleToolSucceeded(event: AgentEvent): Promise<void> {
    const toolName = (event.payload as Record<string, unknown>)?.toolName as
      | string
      | undefined;
    if (!toolName) return;

    const extractor = artifactConfig.get(toolName);
    if (!extractor) return;

    const value = getNestedValue(
      event.payload as Record<string, unknown>,
      extractor.payloadPath,
    );
    if (value === undefined || value === null) return;

    // Atomic JSONB merge -- no read step needed
    await db
      .update(agentSessions)
      .set({
        artifacts: sql`COALESCE(${agentSessions.artifacts}, '{}'::jsonb) || ${JSON.stringify({ [extractor.artifactKey]: String(value) })}::jsonb`,
        last_event_type: event.type,
        last_event_at: event.timestamp,
        updated_at: new Date(),
      })
      .where(eq(agentSessions.conversation_id, event.conversation_id));
  }

  // ─── Event Router ─────────────────────────────────────────────────────────

  async function handleEvent(event: AgentEvent): Promise<void> {
    switch (event.type) {
      case "agent.started":
        await handleAgentStarted(event);
        break;
      case "agent.completed":
        await handleAgentCompleted(event);
        break;
      case "agent.paused":
        await handleAgentPaused(event);
        break;
      case "agent.resumed":
        await handleAgentResumed(event);
        break;
      case "agent.reopened":
        await handleAgentReopened(event);
        break;
      case "tool.succeeded":
        await handleToolSucceeded(event);
        break;
    }
  }

  // ─── Subscribe to EventLog ────────────────────────────────────────────────

  const unsubscribe = eventLog.subscribe(
    {
      types: [
        "agent.started",
        "agent.completed",
        "agent.paused",
        "agent.resumed",
        "agent.reopened",
        "tool.succeeded",
      ],
    },
    async (event) => {
      try {
        await handleEvent(event);
      } catch (err) {
        logger.error(
          {
            err,
            eventType: event.type,
            conversationId: event.conversation_id,
          },
          "SessionProjection failed to handle event",
        );
      }
    },
  );

  // ─── Public Interface ─────────────────────────────────────────────────────

  return {
    async getSession(conversationId: string) {
      const rows = await db
        .select()
        .from(agentSessions)
        .where(eq(agentSessions.conversation_id, conversationId))
        .limit(1);

      return rows[0] ?? null;
    },

    close() {
      unsubscribe();
      logger.info("SessionProjection closed");
    },
  };
}
