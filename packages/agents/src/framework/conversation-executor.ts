/**
 * ConversationExecutor Implementation
 *
 * Factory producing the core API surface for managing agent conversations.
 * Implements start (idempotent, deterministic IDs, re-trigger suffixes),
 * signal (resume/queue/dedup), get, cancel, and list.
 *
 * The worker loop (Plan 03) is NOT implemented here -- this module
 * focuses on the data operations (conversation lifecycle management).
 */

import { and, desc, eq, like, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { appendReplyContextTag } from "../shared/communication/message-utils.js";
import type * as agentsSchemaModule from "../shared/db/schema.js";
import type { ConversationStatus } from "../shared/db/schema.js";
import { conversations } from "../shared/db/schema.js";
import { signalMatchesPendingWait } from "./signal-matching.js";
import type {
  ConversationExecutor,
  ConversationExecutorOptions,
  ConversationInfo,
  Signal,
  StartConversationParams,
} from "./types.js";
import { SignalSchema } from "./types.js";
import type { WorkerLoop } from "./worker-loop.js";
import { createWorkerLoop } from "./worker-loop.js";

// ─── Helper ──────────────────────────────────────────────────────────────────

/**
 * Parse the re-trigger suffix number from a conversation ID.
 * Returns the numeric suffix (e.g., 2 from "dev-agent-abc-r2"), or null if no suffix.
 */
function parseRetriggerSuffix(id: string): number | null {
  const match = id.match(/-r(\d+)$/);
  if (!match || !match[1]) return null;
  return Number.parseInt(match[1], 10);
}

// ─── Types ───────────────────────────────────────────────────────────────────

type AgentsDb = NodePgDatabase<typeof agentsSchemaModule>;

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create a ConversationExecutor instance that manages conversation lifecycle
 * through 5 API methods: start, signal, get, cancel, list.
 *
 * @example
 * ```ts
 * const executor = createConversationExecutor({
 *   db, eventLog, sessionProjection, agentRegistry, toolRegistry, logger,
 * });
 *
 * const convId = await executor.start({
 *   agentDefinitionId: "dev-agent",
 *   correlationKey: "AES-42",
 *   initialMessage: "Implement user authentication",
 * });
 *
 * const result = await executor.signal(convId, {
 *   type: "approval",
 *   data: { approved: true },
 *   source: "slack",
 * });
 * ```
 */
export function createConversationExecutor(
  options: ConversationExecutorOptions,
): ConversationExecutor {
  const {
    db,
    eventLog,
    sessionProjection,
    agentRegistry,
    toolRegistry,
    logger: parentLogger,
    correlationService,
  } = options;

  // Validate required options
  if (!db) throw new Error("db is required for ConversationExecutor");
  if (!eventLog)
    throw new Error("eventLog is required for ConversationExecutor");
  if (!sessionProjection)
    throw new Error("sessionProjection is required for ConversationExecutor");
  if (!agentRegistry)
    throw new Error("agentRegistry is required for ConversationExecutor");
  if (!toolRegistry)
    throw new Error("toolRegistry is required for ConversationExecutor");
  if (!parentLogger)
    throw new Error("logger is required for ConversationExecutor");

  const logger = parentLogger.child({ component: "conversation-executor" });

  // Create the worker loop for executing queued conversations
  let workerLoop: WorkerLoop | null = null;
  let schedulerStarted = false;

  function getOrCreateWorkerLoop(): WorkerLoop {
    if (!workerLoop) {
      const loopOpts: Parameters<typeof createWorkerLoop>[0] = {
        db,
        eventLog,
        sessionProjection,
        agentRegistry,
        toolRegistry,
        logger: parentLogger,
      };
      if (options.pollIntervalMs !== undefined)
        loopOpts.pollIntervalMs = options.pollIntervalMs;
      if (options.concurrencyLimit !== undefined)
        loopOpts.concurrencyLimit = options.concurrencyLimit;
      if (options.heartbeatIntervalMs !== undefined)
        loopOpts.heartbeatIntervalMs = options.heartbeatIntervalMs;
      if (options.staleThresholdMs !== undefined)
        loopOpts.staleThresholdMs = options.staleThresholdMs;
      if (options.workerId !== undefined) loopOpts.workerId = options.workerId;
      if (options.timeoutScheduler !== undefined)
        loopOpts.timeoutScheduler = options.timeoutScheduler;
      if (options.sandboxManager !== undefined)
        loopOpts.sandboxManager = options.sandboxManager;
      if (options.sandboxSetup !== undefined)
        loopOpts.sandboxSetup = options.sandboxSetup;
      if (options.taskService !== undefined)
        loopOpts.taskService = options.taskService;
      if (options.directoryService !== undefined)
        loopOpts.directoryService = options.directoryService;
      if (options.correlationService !== undefined)
        loopOpts.correlationService = options.correlationService;
      if (options.materializationAdapter !== undefined)
        loopOpts.materializationAdapter = options.materializationAdapter;
      if (options.scheduleRegistry !== undefined)
        loopOpts.scheduleRegistry = options.scheduleRegistry;
      if (options.identityService !== undefined)
        loopOpts.identityService = options.identityService;
      if (options.lifecycleHooks !== undefined)
        loopOpts.lifecycleHooks = options.lifecycleHooks;
      // Late-bind executor reference so the worker loop can start delegated conversations
      loopOpts.executor = executor;
      workerLoop = createWorkerLoop(loopOpts);
    }
    return workerLoop;
  }

  // Terminal statuses where re-trigger creates a new conversation
  const TERMINAL_STATUSES: ConversationStatus[] = [
    "completed",
    "failed",
    "cancelled",
  ];
  // Active statuses where start() is an idempotent no-op
  const ACTIVE_STATUSES: ConversationStatus[] = [
    "running",
    "queued",
    "waiting",
  ];

  // ─── Internal Helpers ────────────────────────────────────────────────

  /**
   * Find the next re-trigger suffix for a base conversation ID.
   * Scans existing IDs with pattern `baseId-r%` and returns the next number.
   */
  async function findNextSuffix(tx: AgentsDb, baseId: string): Promise<number> {
    const rows = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(like(conversations.id, `${baseId}-r%`))
      .orderBy(desc(conversations.id))
      .limit(1);

    if (rows.length === 0 || !rows[0]) {
      return 2;
    }

    const lastSuffix = parseRetriggerSuffix(rows[0].id);
    return (lastSuffix ?? 1) + 1;
  }

  /**
   * Map a conversations table row to ConversationInfo.
   */
  function toConversationInfo(row: {
    id: string;
    agent_definition_id: string;
    agent_definition_version: string;
    status: ConversationStatus;
    created_at: Date;
    updated_at: Date;
  }): ConversationInfo {
    return {
      id: row.id,
      agentDefinitionId: row.agent_definition_id,
      agentDefinitionVersion: row.agent_definition_version,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // ─── ConversationExecutor Interface ──────────────────────────────────

  const executor: ConversationExecutor = {
    async start(params: StartConversationParams): Promise<string> {
      const baseId = `${params.agentDefinitionId}-${params.correlationKey}`;

      // Resolve agent definition (fail fast if not found)
      const agentDef = await agentRegistry.get(params.agentDefinitionId);
      if (!agentDef) {
        throw new Error(
          `Agent definition not found: ${params.agentDefinitionId}`,
        );
      }

      return await db.transaction(async (tx) => {
        // Check for existing conversation with FOR UPDATE lock
        const existing = await tx
          .select()
          .from(conversations)
          .where(eq(conversations.id, baseId))
          .for("update");

        const existingRow = existing[0];
        if (existingRow) {
          const row = existingRow;

          // Active status: idempotent no-op
          if (ACTIVE_STATUSES.includes(row.status)) {
            logger.info(
              { conversationId: row.id, status: row.status },
              "Conversation already active, returning existing ID",
            );
            return row.id;
          }

          // Terminal status: create re-triggered conversation
          if (TERMINAL_STATUSES.includes(row.status)) {
            const suffix = await findNextSuffix(tx, baseId);
            const newId = `${baseId}-r${suffix}`;

            // Get previous attempt context for enriched initial message
            let contextPrefix = "";
            const prevSession = await sessionProjection.getSession(row.id);
            if (prevSession) {
              const failureReason =
                row.status === "failed" ? ` ${row.error_message ?? ""}` : "";
              const artifacts =
                Object.keys(prevSession.artifacts).length > 0
                  ? JSON.stringify(prevSession.artifacts)
                  : "none";
              contextPrefix = `[Previous attempt ${row.id}: ${row.status}.${failureReason} Known artifacts: ${artifacts}.] `;
            }

            const initialMessage = contextPrefix + params.initialMessage;
            const fullMessage = params.context
              ? `${params.context}\n\n${initialMessage}`
              : initialMessage;
            const messageWithContext = appendReplyContextTag(
              fullMessage,
              params.replyContext,
            );

            await tx.insert(conversations).values({
              id: newId,
              agent_definition_id: params.agentDefinitionId,
              agent_definition_version: agentDef.version,
              status: "queued",
              messages: [{ role: "user", content: messageWithContext }],
              parent_conversation_id: params.parentConversationId ?? null,
              task_id: params.taskId ?? null,
              reply_context: params.replyContext ?? null,
              queued_signals: [],
              delivered_signal_ids: [],
            });

            logger.info(
              {
                conversationId: newId,
                previousId: row.id,
                previousStatus: row.status,
              },
              "Re-triggered conversation from terminal state",
            );

            // Auto-register entity correlation for re-triggered conversation (Phase 78)
            if (params.entityRef && correlationService) {
              try {
                await correlationService.register({
                  entityType: params.entityRef.entityType,
                  entityId: params.entityRef.entityId,
                  conversationId: newId,
                  agentId: params.agentDefinitionId,
                });
              } catch (err) {
                logger.warn(
                  { err, conversationId: newId },
                  "Failed to register entity correlation (non-fatal)",
                );
              }
            }

            return newId;
          }
        }

        // No existing conversation: create new
        const fullMessage = params.context
          ? `${params.context}\n\n${params.initialMessage}`
          : params.initialMessage;
        const messageWithContext = appendReplyContextTag(
          fullMessage,
          params.replyContext,
        );

        await tx.insert(conversations).values({
          id: baseId,
          agent_definition_id: params.agentDefinitionId,
          agent_definition_version: agentDef.version,
          status: "queued",
          messages: [{ role: "user", content: messageWithContext }],
          parent_conversation_id: params.parentConversationId ?? null,
          task_id: params.taskId ?? null,
          reply_context: params.replyContext ?? null,
          queued_signals: [],
          delivered_signal_ids: [],
        });

        logger.info(
          {
            conversationId: baseId,
            agentDefinitionId: params.agentDefinitionId,
          },
          "Created new conversation",
        );

        // Auto-register entity correlation (Phase 78)
        if (params.entityRef && correlationService) {
          try {
            await correlationService.register({
              entityType: params.entityRef.entityType,
              entityId: params.entityRef.entityId,
              conversationId: baseId,
              agentId: params.agentDefinitionId,
            });
          } catch (err) {
            logger.warn(
              { err, conversationId: baseId },
              "Failed to register entity correlation (non-fatal)",
            );
          }
        }

        return baseId;
      });
    },

    async signal(
      conversationId: string,
      signal: Signal,
    ): Promise<{
      action: "resumed" | "queued" | "rejected" | "deduplicated";
    }> {
      // Validate signal payload
      const parseResult = SignalSchema.safeParse(signal);
      if (!parseResult.success) {
        logger.warn(
          { conversationId, errors: parseResult.error.issues },
          "Invalid signal payload",
        );
        return { action: "rejected" };
      }

      return await db.transaction(async (tx) => {
        // Lock conversation row
        const rows = await tx
          .select()
          .from(conversations)
          .where(eq(conversations.id, conversationId))
          .for("update");

        if (rows.length === 0) {
          logger.warn(
            { conversationId },
            "Signal rejected: conversation not found",
          );
          return { action: "rejected" };
        }

        // rows[0] is guaranteed to exist after the length check above
        const row = rows[0] as (typeof rows)[0];

        // Check deduplication
        if (signal.deduplicationId && signal.source) {
          const dedupKey = `${signal.source}:${signal.deduplicationId}`;
          const deliveredIds = (row.delivered_signal_ids ?? []) as string[];
          if (deliveredIds.includes(dedupKey)) {
            logger.info({ conversationId, dedupKey }, "Signal deduplicated");
            return { action: "deduplicated" };
          }
        }

        // Build updated delivered_signal_ids with FIFO eviction (cap at 100)
        const deliveredIds = [
          ...((row.delivered_signal_ids ?? []) as string[]),
        ];
        if (signal.deduplicationId && signal.source) {
          deliveredIds.push(`${signal.source}:${signal.deduplicationId}`);
        }
        while (deliveredIds.length > 100) {
          deliveredIds.shift();
        }

        // Handle based on conversation status
        const status = row.status;

        if (status === "waiting") {
          // Check type match against pending_wait using shared signal matching helper
          const pendingWait = row.pending_wait as Record<
            string,
            unknown
          > | null;
          if (pendingWait && !signalMatchesPendingWait(signal, pendingWait)) {
            // Normalize types for logging (backward compat: old `type` or new `types`)
            const expectedTypes = pendingWait.types
              ? (pendingWait.types as string[])
              : pendingWait.type
                ? [pendingWait.type as string]
                : [];
            logger.warn(
              {
                conversationId,
                expectedTypes,
                receivedType: signal.type,
              },
              "Signal rejected: type mismatch with pending wait",
            );
            return { action: "rejected" };
          }

          // Cancel pending timeout if one exists
          if (options.timeoutScheduler) {
            if (
              pendingWait?.timeoutJobId &&
              typeof pendingWait.timeoutJobId === "string"
            ) {
              await options.timeoutScheduler.cancel(pendingWait.timeoutJobId);
            }
          }

          // Build signal message with active_delegations context
          const signalContent =
            signal.message ??
            `Signal received: ${signal.type}. Data: ${JSON.stringify(signal.data ?? {})}`;

          // Inject active_delegations so agent knows what is in flight on resume
          const activeDelegations = (row.active_delegations ?? []) as unknown[];
          let contentWithDelegations = signalContent;
          if (activeDelegations.length > 0) {
            const delegationLines: string[] = ["<active_delegations>"];
            for (const d of activeDelegations) {
              const entry = d as {
                taskId?: string;
                targetEntityId?: string;
                description?: string;
                delegatedAt?: string;
                handshakeStatus?: string;
                estimate?: string;
              };
              const attrs = [
                `task_id="${entry.taskId ?? "unknown"}"`,
                `target="${entry.targetEntityId ?? "unknown"}"`,
                `status="${entry.handshakeStatus ?? "pending"}"`,
              ];
              if (entry.estimate) {
                attrs.push(`estimate="${entry.estimate}"`);
              }
              delegationLines.push(
                `<delegation ${attrs.join(" ")}>${entry.description ?? "No description"}`,
              );
              delegationLines.push(
                `Delegated: ${entry.delegatedAt ?? "unknown"}</delegation>`,
              );
            }
            delegationLines.push("</active_delegations>");
            contentWithDelegations = `${delegationLines.join("\n")}\n\n${signalContent}`;
          }

          const finalContent = appendReplyContextTag(
            contentWithDelegations,
            signal.replyContext,
          );
          const signalMessage = {
            role: "user",
            content: finalContent,
          };

          // Append signal message to messages and resume
          const updatedMessages = [
            ...((row.messages ?? []) as unknown[]),
            signalMessage,
          ];

          await tx
            .update(conversations)
            .set({
              status: "queued",
              messages: updatedMessages,
              pending_wait: null,
              delivered_signal_ids: deliveredIds,
              // Set pending_cancellation so worker loop enforces one-turn limit (Phase 81)
              ...(signal.type === "task_cancelled" && {
                pending_cancellation: true,
              }),
              ...(signal.replyContext && {
                reply_context: signal.replyContext,
              }),
              updated_at: new Date(),
            })
            .where(eq(conversations.id, conversationId));

          // Append signal.received event
          await eventLog.initSequence(conversationId);
          eventLog.append({
            conversationId,
            agentDefinitionId: row.agent_definition_id,
            agentDefinitionVersion: row.agent_definition_version,
            agentInstanceId: `signal-${conversationId}`,
            type: "signal.received",
            payload: {
              signalType: signal.type,
              source: signal.source,
              deduplicationId: signal.deduplicationId,
            },
          });
          await eventLog.flush();

          logger.info(
            { conversationId, signalType: signal.type },
            "Signal resumed waiting conversation",
          );

          return { action: "resumed" };
        }

        if (status === "running" || status === "queued") {
          // Queue signal for later consumption
          const queuedSignals = [
            ...((row.queued_signals ?? []) as unknown[]),
            signal,
          ];

          await tx
            .update(conversations)
            .set({
              queued_signals: queuedSignals,
              delivered_signal_ids: deliveredIds,
              // Set pending_cancellation immediately so worker loop can check after current agent loop (Phase 81)
              ...(signal.type === "task_cancelled" && {
                pending_cancellation: true,
              }),
              updated_at: new Date(),
            })
            .where(eq(conversations.id, conversationId));

          logger.info(
            { conversationId, signalType: signal.type },
            "Signal queued for active conversation",
          );

          return { action: "queued" };
        }

        // Terminal status
        logger.warn(
          { conversationId, status },
          "Signal rejected: conversation in terminal state",
        );
        return { action: "rejected" };
      });
    },

    async get(conversationId: string): Promise<ConversationInfo | null> {
      const rows = await db
        .select({
          id: conversations.id,
          agent_definition_id: conversations.agent_definition_id,
          agent_definition_version: conversations.agent_definition_version,
          status: conversations.status,
          created_at: conversations.created_at,
          updated_at: conversations.updated_at,
        })
        .from(conversations)
        .where(eq(conversations.id, conversationId))
        .limit(1);

      if (rows.length === 0 || !rows[0]) {
        return null;
      }

      return toConversationInfo(rows[0]);
    },

    async cancel(conversationId: string): Promise<boolean> {
      return await db.transaction(async (tx) => {
        // Lock row
        const rows = await tx
          .select()
          .from(conversations)
          .where(eq(conversations.id, conversationId))
          .for("update");

        if (rows.length === 0) {
          return false;
        }

        // rows[0] is guaranteed to exist after the length check above
        const row = rows[0] as (typeof rows)[0];
        const status = row.status;

        // Cannot cancel terminal conversations
        if (TERMINAL_STATUSES.includes(status)) {
          return false;
        }

        // Cancel pending timeout if conversation was waiting
        if (options.timeoutScheduler && status === "waiting") {
          const pendingWait = row.pending_wait as Record<
            string,
            unknown
          > | null;
          if (
            pendingWait?.timeoutJobId &&
            typeof pendingWait.timeoutJobId === "string"
          ) {
            await options.timeoutScheduler.cancel(pendingWait.timeoutJobId);
          }
        }

        // Transition to cancelled
        await tx
          .update(conversations)
          .set({
            status: "cancelled",
            claimed_by: null,
            claimed_at: null,
            last_heartbeat_at: null,
            updated_at: new Date(),
          })
          .where(eq(conversations.id, conversationId));

        // Append agent.completed event with error
        await eventLog.initSequence(conversationId);
        eventLog.append({
          conversationId,
          agentDefinitionId: row.agent_definition_id,
          agentDefinitionVersion: row.agent_definition_version,
          agentInstanceId: `cancel-${conversationId}`,
          type: "agent.completed",
          payload: { error: "Cancelled" },
        });
        await eventLog.flush();

        logger.info(
          { conversationId, previousStatus: status },
          "Conversation cancelled",
        );

        return true;
      });
    },

    async reopen(
      conversationId: string,
      reason: string,
    ): Promise<{ action: "reopened" | "rejected"; error?: string }> {
      if (!reason || reason.trim().length === 0) {
        return { action: "rejected", error: "Reason is required" };
      }

      return await db.transaction(async (tx) => {
        // Lock conversation row
        const rows = await tx
          .select()
          .from(conversations)
          .where(eq(conversations.id, conversationId))
          .for("update");

        if (rows.length === 0) {
          return { action: "rejected", error: "Conversation not found" };
        }

        const row = rows[0] as (typeof rows)[0];

        // Only completed and failed are reopenable
        if (row.status !== "completed" && row.status !== "failed") {
          return {
            action: "rejected",
            error: `Cannot reopen conversation in ${row.status} status`,
          };
        }

        // Build world-state user message
        const worldStateContent = [
          "<world_state>",
          `This conversation was reopened. Context: ${reason.trim()}`,
          "",
          "The world may have changed since you last acted. Verify the current state of any artifacts you previously created before taking new actions.",
          "</world_state>",
        ].join("\n");

        const updatedMessages = [
          ...((row.messages ?? []) as unknown[]),
          { role: "user", content: worldStateContent },
        ];

        // FIFO eviction for delivered_signal_ids (cap at 100)
        const deliveredIds = [
          ...((row.delivered_signal_ids ?? []) as string[]),
        ];
        deliveredIds.push(`reopen:${Date.now()}`);
        while (deliveredIds.length > 100) {
          deliveredIds.shift();
        }

        // Transition to queued with reset execution limits
        await tx
          .update(conversations)
          .set({
            status: "queued",
            messages: updatedMessages,
            retry_count: 0,
            error_message: null,
            reopen_count: sql`${conversations.reopen_count} + 1`,
            pending_wait: null,
            claimed_by: null,
            claimed_at: null,
            last_heartbeat_at: null,
            delivered_signal_ids: deliveredIds,
            updated_at: new Date(),
          })
          .where(eq(conversations.id, conversationId));

        // Emit agent.reopened event
        await eventLog.initSequence(conversationId);
        eventLog.append({
          conversationId,
          agentDefinitionId: row.agent_definition_id,
          agentDefinitionVersion: row.agent_definition_version,
          agentInstanceId: `reopen-${conversationId}`,
          type: "agent.reopened",
          payload: {
            reason: reason.trim(),
            previousStatus: row.status,
            reopenCount: (row.reopen_count ?? 0) + 1,
          },
        });
        await eventLog.flush();

        logger.info(
          {
            conversationId,
            previousStatus: row.status,
            reopenCount: (row.reopen_count ?? 0) + 1,
          },
          "Conversation reopened",
        );

        return { action: "reopened" };
      });
    },

    async list(listOptions?: {
      status?: ConversationStatus;
      agentDefinitionId?: string;
      limit?: number;
    }): Promise<ConversationInfo[]> {
      const conditions = [];

      if (listOptions?.status) {
        conditions.push(eq(conversations.status, listOptions.status));
      }

      if (listOptions?.agentDefinitionId) {
        conditions.push(
          eq(conversations.agent_definition_id, listOptions.agentDefinitionId),
        );
      }

      const selectFields = {
        id: conversations.id,
        agent_definition_id: conversations.agent_definition_id,
        agent_definition_version: conversations.agent_definition_version,
        status: conversations.status,
        created_at: conversations.created_at,
        updated_at: conversations.updated_at,
      };

      const limit = listOptions?.limit ?? 100;

      const rows =
        conditions.length > 0
          ? await db
              .select(selectFields)
              .from(conversations)
              .where(and(...conditions))
              .orderBy(desc(conversations.created_at))
              .limit(limit)
          : await db
              .select(selectFields)
              .from(conversations)
              .orderBy(desc(conversations.created_at))
              .limit(limit);

      return rows.map(toConversationInfo);
    },

    async findActiveForTask(taskId: string): Promise<ConversationInfo | null> {
      const rows = await db
        .select({
          id: conversations.id,
          agent_definition_id: conversations.agent_definition_id,
          agent_definition_version: conversations.agent_definition_version,
          status: conversations.status,
          created_at: conversations.created_at,
          updated_at: conversations.updated_at,
        })
        .from(conversations)
        .where(
          and(
            eq(conversations.task_id, taskId),
            sql`${conversations.status} IN ('running', 'waiting', 'queued')`,
          ),
        )
        .orderBy(desc(conversations.created_at))
        .limit(1);

      if (rows.length === 0 || !rows[0]) return null;
      return toConversationInfo(rows[0]);
    },

    startWorker(): void {
      const loop = getOrCreateWorkerLoop();
      loop.start();
      if (options.timeoutScheduler && !schedulerStarted) {
        schedulerStarted = true;
        void options.timeoutScheduler.start(executor).catch((err: unknown) => {
          logger.error({ err }, "Failed to start timeout scheduler");
        });
      }
    },

    async stopWorker(timeoutMs?: number): Promise<void> {
      if (workerLoop) {
        await workerLoop.close(timeoutMs);
        workerLoop = null;
      }
      if (options.timeoutScheduler) {
        await options.timeoutScheduler.close();
      }
    },

    getWorkerStatus() {
      if (!workerLoop) {
        return null;
      }
      return workerLoop.getStatus();
    },
  };

  return executor;
}
