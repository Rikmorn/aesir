/**
 * Worker Loop
 *
 * The execution engine that turns queued conversations into running agent loops.
 * Polls for claimable conversations using SELECT FOR UPDATE SKIP LOCKED,
 * executes agent loops with heartbeat monitoring, handles wait_for pauses,
 * manages retry/failure semantics, and supports graceful shutdown.
 *
 * Key invariants:
 * - Exactly one agent loop runs per conversation at any time (SKIP LOCKED)
 * - Heartbeat updates every N ms during execution (stale detection)
 * - Stale conversations (heartbeat > threshold) are re-enqueued or failed
 * - Messages persisted only at lifecycle boundaries (pause, complete, fail)
 * - Graceful shutdown stops accepting new work, lets running finish
 */

import { createDevContainerGit, type PinoLogger } from "@aesir/platform";
import type Anthropic from "@anthropic-ai/sdk";
import { eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { nanoid } from "nanoid";
import { runAgentLoop } from "../shared/agent-loop/run-agent-loop.js";
import { createTokenBudget } from "../shared/agent-loop/token-budget.js";
import type { AgentLoopResult } from "../shared/agent-loop/types.js";
import type * as agentsSchemaModule from "../shared/db/schema.js";
import type { Conversation } from "../shared/db/schema.js";
import { conversations } from "../shared/db/schema.js";
import { createHistoryManager } from "./history-manager.js";
import type { TimeoutScheduler } from "./timeout-scheduler.js";
import type {
  AgentRegistry,
  EventLog,
  SandboxManager,
  SessionProjection,
  ToolContext,
  ToolRegistry,
} from "./types.js";
import {
  createDefaultWaitForState,
  createWaitForTool,
} from "./wait-for-tool.js";

// ─── Types ────────────────────────────────────────────────────────────────────

type AgentsDb = NodePgDatabase<typeof agentsSchemaModule>;

/**
 * Options for creating a WorkerLoop instance.
 */
export interface WorkerLoopOptions {
  /** Database client for conversation persistence */
  db: AgentsDb;
  /** Event log for recording agent events */
  eventLog: EventLog;
  /** Session projection for tracking agent sessions */
  sessionProjection: SessionProjection;
  /** Agent registry for loading agent definitions */
  agentRegistry: AgentRegistry;
  /** Tool registry for resolving tool references */
  toolRegistry: ToolRegistry;
  /** Logger instance */
  logger: PinoLogger;
  /** How often to poll for claimable conversations (default: 5000ms) */
  pollIntervalMs?: number;
  /** Maximum concurrent conversations per worker (default: 3) */
  concurrencyLimit?: number;
  /** How often to update heartbeat timestamp (default: 30000ms) */
  heartbeatIntervalMs?: number;
  /** How long before a heartbeat is considered stale (default: 300000ms / 5 min) */
  staleThresholdMs?: number;
  /** Unique identifier for this worker instance */
  workerId?: string;
  /** Optional timeout scheduler for delayed signal delivery (Phase 41) */
  timeoutScheduler?: TimeoutScheduler;
  /** Sandbox manager for codebase tool execution (optional -- Docker in dev, Fargate/Lambda in prod) */
  sandboxManager?: SandboxManager;
  /** Sandbox workspace setup config (optional -- repo clone + credentials) */
  sandboxSetup?:
    | {
        repoUrl: string;
        githubToken?: string | undefined;
        baseBranch?: string | undefined;
      }
    | undefined;
}

/**
 * WorkerLoop - Polls for queued conversations and executes agent loops.
 */
export interface WorkerLoop {
  /** Start the polling loop */
  start(): void;
  /** Stop accepting new work and wait for running conversations to finish */
  drain(): Promise<void>;
  /** Drain and then flush/clean up resources */
  close(): Promise<void>;
  /** Whether the loop is currently running (not draining) */
  isRunning(): boolean;
  /** Number of currently executing conversations */
  getRunningCount(): number;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create a WorkerLoop instance that polls for queued conversations,
 * claims them with SKIP LOCKED, and runs agent loops.
 *
 * @param options - Worker loop configuration
 * @returns WorkerLoop interface
 */
export function createWorkerLoop(options: WorkerLoopOptions): WorkerLoop {
  const {
    db,
    eventLog,
    sessionProjection,
    agentRegistry,
    toolRegistry,
    logger: parentLogger,
    pollIntervalMs = 5000,
    concurrencyLimit = 3,
    heartbeatIntervalMs = 30000,
    staleThresholdMs = 300000,
    workerId = `wrkr_${nanoid(12)}`,
    timeoutScheduler,
    sandboxManager,
    sandboxSetup,
  } = options;

  const logger = parentLogger.child({ component: "worker-loop", workerId });

  // ─── Sandbox Setup ───────────────────────────────────────────────────

  /**
   * Spawn a sandbox container and clone the repo if needed.
   * Reuses existing containers on resume (idempotent spawn).
   * Skips repo clone if /workspace/repo/.git already exists.
   */
  async function setupSandbox(opts: {
    manager: SandboxManager;
    taskId: string;
    setup?:
      | {
          repoUrl: string;
          githubToken?: string | undefined;
          baseBranch?: string | undefined;
        }
      | undefined;
    logger: PinoLogger;
  }): Promise<void> {
    // 1. Spawn (reuses if already running)
    await opts.manager.spawn({ taskId: opts.taskId });
    opts.logger.info({ taskId: opts.taskId }, "Sandbox container ready");

    // 2. Check if repo already cloned (resume case)
    const check = await opts.manager.execute(opts.taskId, {
      command: ["test", "-d", "/workspace/repo/.git"],
      timeoutMs: 5000,
    });
    if (check.exitCode === 0) {
      opts.logger.info({ taskId: opts.taskId }, "Sandbox repo already present");
      return;
    }

    // 3. Clone repo if URL available
    if (opts.setup?.repoUrl) {
      const git = createDevContainerGit({
        manager: opts.manager,
        logger: opts.logger,
      });
      if (opts.setup.githubToken) {
        await git.configureCredentials(opts.taskId, opts.setup.githubToken);
      }
      const cloneOpts: {
        branch?: string;
        gitUser?: { name: string; email: string };
      } = {};
      if (opts.setup.baseBranch) {
        cloneOpts.branch = opts.setup.baseBranch;
      }
      const result = await git.cloneRepository(
        opts.taskId,
        opts.setup.repoUrl,
        cloneOpts,
      );
      if (!result.success) {
        throw new Error(
          `Failed to clone repo: ${result.error || result.stderr}`,
        );
      }
      opts.logger.info(
        { taskId: opts.taskId, repoUrl: opts.setup.repoUrl },
        "Repository cloned into sandbox",
      );
    }
  }

  // State
  let draining = false;
  let started = false;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  const running = new Map<string, AbortController>();

  // ─── Stale Recovery ───────────────────────────────────────────────────

  /**
   * Find conversations with status='running' and expired heartbeat.
   * Re-enqueue if retryable, fail if max retries exceeded.
   */
  async function recoverStaleConversations(): Promise<void> {
    try {
      const staleThreshold = new Date(Date.now() - staleThresholdMs);

      // Find stale running conversations
      const staleRows = await db
        .select()
        .from(conversations)
        .where(
          sql`${conversations.status} = 'running' AND ${conversations.last_heartbeat_at} < ${staleThreshold}`,
        );

      for (const row of staleRows) {
        if (row.retry_count < row.max_retries) {
          // Re-enqueue for retry
          await db
            .update(conversations)
            .set({
              status: "queued",
              claimed_by: null,
              claimed_at: null,
              last_heartbeat_at: null,
              retry_count: row.retry_count + 1,
              updated_at: new Date(),
            })
            .where(eq(conversations.id, row.id));

          logger.warn(
            {
              conversationId: row.id,
              retryCount: row.retry_count + 1,
              maxRetries: row.max_retries,
            },
            "Re-enqueued stale conversation for retry",
          );
        } else {
          // Max retries exceeded -- fail
          await db
            .update(conversations)
            .set({
              status: "failed",
              error_message: "Stale heartbeat: exceeded max retries",
              claimed_by: null,
              claimed_at: null,
              last_heartbeat_at: null,
              updated_at: new Date(),
            })
            .where(eq(conversations.id, row.id));

          logger.error(
            {
              conversationId: row.id,
              retryCount: row.retry_count,
              maxRetries: row.max_retries,
            },
            "Failed stale conversation: exceeded max retries",
          );
        }
      }
    } catch (error) {
      logger.error({ err: error }, "Error during stale conversation recovery");
    }
  }

  // ─── Claim ────────────────────────────────────────────────────────────

  /**
   * Claim up to `capacity` queued conversations using atomic CTE with SKIP LOCKED.
   * Returns claimed conversation rows.
   */
  async function claimConversations(capacity: number): Promise<Conversation[]> {
    if (capacity <= 0) return [];

    try {
      const result = await db.execute(sql`
        WITH claimable AS (
          SELECT id FROM agents.conversations
          WHERE status = 'queued'
          ORDER BY created_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT ${capacity}
        )
        UPDATE agents.conversations
        SET status = 'running',
            claimed_by = ${workerId},
            claimed_at = NOW(),
            last_heartbeat_at = NOW(),
            updated_at = NOW()
        FROM claimable
        WHERE agents.conversations.id = claimable.id
        RETURNING agents.conversations.*
      `);

      return (result.rows ?? []) as unknown as Conversation[];
    } catch (error) {
      logger.error({ err: error }, "Error claiming conversations");
      return [];
    }
  }

  // ─── Execute Conversation ─────────────────────────────────────────────

  /**
   * Execute a single conversation through the agent loop.
   * Handles tool resolution, wait_for interception, heartbeat,
   * history compaction, and post-loop state transitions.
   */
  async function executeConversation(
    conv: Conversation,
    abortSignal: AbortSignal,
  ): Promise<void> {
    const childLogger = logger.child({ conversationId: conv.id });
    const instanceId = `inst_${nanoid(12)}`;

    try {
      // 1. Load agent definition
      const definition = await agentRegistry.get(
        conv.agent_definition_id,
        conv.agent_definition_version,
      );
      if (!definition) {
        childLogger.error(
          { agentDefinitionId: conv.agent_definition_id },
          "Agent definition not found, marking conversation failed",
        );
        await db
          .update(conversations)
          .set({
            status: "failed",
            error_message: `Agent definition not found: ${conv.agent_definition_id}`,
            claimed_by: null,
            claimed_at: null,
            last_heartbeat_at: null,
            updated_at: new Date(),
          })
          .where(eq(conversations.id, conv.id));
        return;
      }

      // 1b. Validate sub-agent definitions exist (fail fast)
      if (definition.subAgents) {
        for (const [role, agentId] of Object.entries(definition.subAgents)) {
          const subDef = await agentRegistry.get(agentId);
          if (!subDef) {
            childLogger.error(
              { role, agentId },
              "Sub-agent definition not found, marking conversation failed",
            );
            await db
              .update(conversations)
              .set({
                status: "failed",
                error_message: `Sub-agent definition not found: ${agentId} (role: ${role})`,
                claimed_by: null,
                claimed_at: null,
                last_heartbeat_at: null,
                updated_at: new Date(),
              })
              .where(eq(conversations.id, conv.id));
            return;
          }
        }
      }

      // 2. Initialize event log sequence
      await eventLog.initSequence(conv.id);

      // 3. Determine if this is a fresh start or resume
      const existingMessages = (conv.messages ??
        []) as Anthropic.MessageParam[];
      const isResumed = existingMessages.length > 1;

      // Append lifecycle event
      eventLog.append({
        conversationId: conv.id,
        agentDefinitionId: conv.agent_definition_id,
        agentDefinitionVersion: conv.agent_definition_version,
        agentInstanceId: instanceId,
        type: isResumed ? "agent.resumed" : "agent.started",
        payload: { workerId },
      });

      // 4. Setup sandbox if agent uses codebase tools
      const needsSandbox = definition.tools.some((t) =>
        t.startsWith("codebase:"),
      );
      if (needsSandbox && sandboxManager) {
        await setupSandbox({
          manager: sandboxManager,
          taskId: conv.id,
          setup: sandboxSetup,
          logger: childLogger,
        });
      }

      // 5. Resolve tools
      // 5a. Create shared token budget if agent can spawn sub-agents
      const hasSpawnAgent = definition.tools.includes(
        "coordination:spawn_agent",
      );
      const tokenBudget = hasSpawnAgent
        ? createTokenBudget(definition.tokenBudget)
        : undefined;

      const toolContext: ToolContext = {
        agentId: conv.agent_definition_id,
        correlationId: conv.id,
        logger: childLogger,
        ...(needsSandbox &&
          sandboxManager && {
            containerManager: sandboxManager,
            taskId: conv.id,
          }),
        ...(hasSpawnAgent &&
          tokenBudget && {
            spawnDeps: {
              agentRegistry,
              toolRegistry,
              tokenBudget,
              eventLog,
              parentDefinition: definition,
              parentInstanceId: instanceId,
              abortSignal,
              currentDepth: 0,
              maxSpawnDepth: 3,
            },
          }),
      };
      const resolvedTools = toolRegistry.resolve(definition.tools, toolContext);

      // 5. Wire wait_for interception
      const waitForState = createDefaultWaitForState();
      const waitForToolIndex = resolvedTools.findIndex(
        (t) => t.name === "wait_for",
      );
      if (waitForToolIndex >= 0) {
        const realWaitForTool = createWaitForTool(waitForState);
        const existingTool = resolvedTools[waitForToolIndex];
        if (existingTool) {
          resolvedTools[waitForToolIndex] = {
            ...existingTool,
            execute: realWaitForTool.execute,
          };
        }
      }

      // 6. Check queued signals before running
      let currentMessages = [...existingMessages];
      const queuedSignals = (conv.queued_signals ?? []) as Array<{
        type: string;
        data?: Record<string, unknown>;
        message?: string;
      }>;
      const pendingWait = conv.pending_wait as Record<string, unknown> | null;

      if (queuedSignals.length > 0 && pendingWait?.type) {
        const matchIndex = queuedSignals.findIndex(
          (sig) => sig.type === pendingWait.type,
        );
        const matchedSignal =
          matchIndex >= 0 ? queuedSignals[matchIndex] : undefined;
        if (matchedSignal) {
          const signalContent =
            matchedSignal.message ??
            `Signal received: ${matchedSignal.type}. Data: ${JSON.stringify(matchedSignal.data ?? {})}`;

          // Append signal as user message
          currentMessages = [
            ...currentMessages,
            { role: "user" as const, content: signalContent },
          ];

          // Remove consumed signal
          const updatedSignals = [
            ...queuedSignals.slice(0, matchIndex),
            ...queuedSignals.slice(matchIndex + 1),
          ];

          // Persist changes immediately
          await db
            .update(conversations)
            .set({
              messages: currentMessages as unknown[],
              pending_wait: null,
              queued_signals: updatedSignals,
              updated_at: new Date(),
            })
            .where(eq(conversations.id, conv.id));

          childLogger.info(
            { signalType: matchedSignal.type },
            "Consumed queued signal for conversation -- skipping pause",
          );
        }
      }

      // 7. Apply history compaction
      let messagesForLoop = currentMessages;
      if (currentMessages.length > 0) {
        const historyManager = createHistoryManager({ logger: childLogger });
        const session = await sessionProjection.getSession(conv.id);
        const compactionResult = await historyManager.compact(
          currentMessages,
          definition.history,
          {
            artifacts: session?.artifacts ?? {},
          },
        );
        messagesForLoop = compactionResult.messages;
      }

      // 8. Build AgentLoopOptions
      // For new conversations: use initial message content + context from definition
      // For resumed conversations: serialize prior messages as context
      let initialMessage: string;
      let context: string | undefined;

      if (!isResumed) {
        // New conversation: first message is the initial message
        const firstMsg = messagesForLoop[0];
        initialMessage =
          typeof firstMsg?.content === "string"
            ? firstMsg.content
            : "Begin the task.";
        context = undefined; // Context already baked into the message by start()
      } else {
        // Resumed conversation: serialize history as context
        context = JSON.stringify(messagesForLoop);
        initialMessage = "Continue the conversation from where you left off.";
      }

      // 9. Heartbeat callback
      let lastBeatTime = Date.now();
      const onHeartbeat = () => {
        const now = Date.now();
        if (now - lastBeatTime >= heartbeatIntervalMs) {
          lastBeatTime = now;
          // Fire-and-forget heartbeat update
          db.update(conversations)
            .set({
              last_heartbeat_at: new Date(),
              updated_at: new Date(),
            })
            .where(
              sql`${conversations.id} = ${conv.id} AND ${conversations.claimed_by} = ${workerId}`,
            )
            .then(() => {})
            .catch((err: unknown) => {
              childLogger.error({ err }, "Heartbeat update failed (non-fatal)");
            });
        }
      };

      // 10. Event recording callbacks
      const eventBase = {
        conversationId: conv.id,
        agentDefinitionId: conv.agent_definition_id,
        agentDefinitionVersion: conv.agent_definition_version,
        agentInstanceId: instanceId,
      };

      const onToolCall = (call: {
        name: string;
        input: unknown;
        id: string;
      }) => {
        childLogger.info(
          { tool: call.name, toolCallId: call.id },
          "Tool called",
        );
        eventLog.append({
          ...eventBase,
          type: "tool.called",
          payload: {
            tool_name: call.name,
            tool_call_id: call.id,
            input: call.input as Record<string, unknown>,
          },
        });
      };

      const onToolResult = (result: {
        name: string;
        id: string;
        content: string;
        isError: boolean;
        durationMs: number;
      }) => {
        const eventType = result.isError ? "tool.failed" : "tool.succeeded";
        childLogger.info(
          {
            tool: result.name,
            toolCallId: result.id,
            isError: result.isError,
            durationMs: result.durationMs,
          },
          `Tool ${result.isError ? "failed" : "succeeded"}`,
        );
        eventLog.append({
          ...eventBase,
          type: eventType,
          payload: {
            tool_name: result.name,
            tool_call_id: result.id,
            // Truncate content to avoid bloating event log
            output: result.content.slice(0, 2000),
            is_error: result.isError,
          },
          durationMs: result.durationMs,
        });
      };

      const onResponse = (response: {
        usage: { input_tokens: number; output_tokens: number };
        stop_reason: string | null;
      }) => {
        childLogger.info(
          {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
            stopReason: response.stop_reason,
          },
          "LLM response received",
        );
        eventLog.append({
          ...eventBase,
          type: "llm.response",
          payload: { stop_reason: response.stop_reason },
          tokenCountInput: response.usage.input_tokens,
          tokenCountOutput: response.usage.output_tokens,
        });
      };

      // 11. Run agent loop
      const loopOptions: Parameters<typeof runAgentLoop>[0] = {
        systemPrompt: definition.systemPrompt,
        tools: resolvedTools,
        initialMessage,
        model: definition.model,
        maxIterations: definition.maxIterations,
        onHeartbeat,
        onToolCall,
        onToolResult,
        onResponse,
        abortSignal,
        logger: childLogger,
        ...(tokenBudget && { tokenBudget }),
      };
      if (context !== undefined) {
        loopOptions.context = context;
      }
      const result: AgentLoopResult = await runAgentLoop(loopOptions);

      // 12. Verify ownership before persisting
      const ownershipCheck = await db
        .select({ claimed_by: conversations.claimed_by })
        .from(conversations)
        .where(
          sql`${conversations.id} = ${conv.id} AND ${conversations.claimed_by} = ${workerId}`,
        );

      if (ownershipCheck.length === 0) {
        childLogger.warn(
          "Ownership changed during execution, discarding results",
        );
        return;
      }

      // 13. Build final messages array (for persistence)
      // Combine pre-loop messages with new messages from the agent loop.
      // slice(1) skips the loop's initial user message (already in currentMessages
      // as the original initial message or context-wrapper for resumed conversations).
      const finalMessages = [...currentMessages, ...result.messages.slice(1)];

      // 14. Handle result based on waitForState and loop status
      if (waitForState.triggered) {
        // Before transitioning to waiting, check if a signal was queued
        // during execution that can immediately satisfy the wait_for.
        // Re-read from DB since signals may have arrived while the loop ran.
        const freshRow = await db
          .select({
            queued_signals: conversations.queued_signals,
            delivered_signal_ids: conversations.delivered_signal_ids,
          })
          .from(conversations)
          .where(
            sql`${conversations.id} = ${conv.id} AND ${conversations.claimed_by} = ${workerId}`,
          );

        const freshSignals = (freshRow[0]?.queued_signals ?? []) as Array<{
          type: string;
          data?: Record<string, unknown>;
          message?: string;
        }>;

        const matchIdx = freshSignals.findIndex(
          (sig) => sig.type === waitForState.waitType,
        );
        const matchedQueuedSignal =
          matchIdx >= 0 ? freshSignals[matchIdx] : undefined;

        if (matchedQueuedSignal) {
          // Consume the queued signal and re-enqueue instead of pausing
          const signalContent =
            matchedQueuedSignal.message ??
            `Signal received: ${matchedQueuedSignal.type}. Data: ${JSON.stringify(matchedQueuedSignal.data ?? {})}`;

          const updatedMessages = [
            ...(finalMessages as unknown[]),
            { role: "user", content: signalContent },
          ];

          const updatedSignals = [
            ...freshSignals.slice(0, matchIdx),
            ...freshSignals.slice(matchIdx + 1),
          ];

          await db
            .update(conversations)
            .set({
              status: "queued",
              messages: updatedMessages,
              pending_wait: null,
              queued_signals: updatedSignals,
              claimed_by: null,
              claimed_at: null,
              last_heartbeat_at: null,
              updated_at: new Date(),
            })
            .where(eq(conversations.id, conv.id));

          childLogger.info(
            { signalType: matchedQueuedSignal.type },
            "Consumed queued signal at pause point, re-enqueuing conversation",
          );
        } else {
          // No matching queued signal -- transition to waiting
          // Schedule timeout if specified
          let timeoutJobId: string | undefined;
          if (timeoutScheduler && waitForState.timeout) {
            try {
              timeoutJobId = await timeoutScheduler.schedule(
                conv.id,
                waitForState.timeout,
                waitForState.waitType ?? "unknown",
                waitForState.reason ?? "Agent paused",
              );
            } catch (scheduleError) {
              childLogger.error(
                { err: scheduleError },
                "Failed to schedule timeout (non-fatal)",
              );
            }
          }

          // Build pending_wait with optional timeoutJobId
          const pendingWaitValue: Record<string, unknown> = {
            type: waitForState.waitType,
            reason: waitForState.reason,
            timeout: waitForState.timeout,
            metadata: waitForState.metadata,
          };
          if (timeoutJobId) {
            pendingWaitValue.timeoutJobId = timeoutJobId;
          }

          // Pause: transition to waiting
          await db
            .update(conversations)
            .set({
              status: "waiting",
              messages: finalMessages as unknown[],
              pending_wait: pendingWaitValue,
              claimed_by: null,
              claimed_at: null,
              last_heartbeat_at: null,
              updated_at: new Date(),
            })
            .where(eq(conversations.id, conv.id));

          eventLog.append({
            conversationId: conv.id,
            agentDefinitionId: conv.agent_definition_id,
            agentDefinitionVersion: conv.agent_definition_version,
            agentInstanceId: instanceId,
            type: "agent.paused",
            payload: {
              waitType: waitForState.waitType,
              reason: waitForState.reason,
            },
          });
          await eventLog.flush();

          childLogger.info(
            { waitType: waitForState.waitType },
            "Conversation paused, waiting for signal",
          );
        }
      } else if (result.status === "completed") {
        // Completed successfully
        await db
          .update(conversations)
          .set({
            status: "completed",
            messages: finalMessages as unknown[],
            claimed_by: null,
            claimed_at: null,
            last_heartbeat_at: null,
            updated_at: new Date(),
          })
          .where(eq(conversations.id, conv.id));

        eventLog.append({
          conversationId: conv.id,
          agentDefinitionId: conv.agent_definition_id,
          agentDefinitionVersion: conv.agent_definition_version,
          agentInstanceId: instanceId,
          type: "agent.completed",
          payload: { output: result.output.slice(0, 500) },
        });
        await eventLog.flush();

        childLogger.info("Conversation completed");
      } else if (
        result.status === "error" ||
        result.status === "max_tokens" ||
        result.status === "max_iterations"
      ) {
        // Error / resource exhaustion
        const isNonRetryable =
          result.output.includes("Token budget exhausted") ||
          result.output.includes("Agent aborted") ||
          conv.retry_count >= conv.max_retries;

        if (isNonRetryable) {
          await db
            .update(conversations)
            .set({
              status: "failed",
              messages: finalMessages as unknown[],
              error_message: result.output.slice(0, 1000),
              claimed_by: null,
              claimed_at: null,
              last_heartbeat_at: null,
              updated_at: new Date(),
            })
            .where(eq(conversations.id, conv.id));

          eventLog.append({
            conversationId: conv.id,
            agentDefinitionId: conv.agent_definition_id,
            agentDefinitionVersion: conv.agent_definition_version,
            agentInstanceId: instanceId,
            type: "agent.completed",
            payload: {
              error: result.output.slice(0, 500),
              status: result.status,
            },
          });
          await eventLog.flush();

          childLogger.error(
            { status: result.status },
            "Conversation failed (non-retryable)",
          );
        } else {
          // Retryable error -- re-enqueue
          await db
            .update(conversations)
            .set({
              status: "queued",
              messages: finalMessages as unknown[],
              retry_count: conv.retry_count + 1,
              error_message: result.output.slice(0, 1000),
              claimed_by: null,
              claimed_at: null,
              last_heartbeat_at: null,
              updated_at: new Date(),
            })
            .where(eq(conversations.id, conv.id));

          eventLog.append({
            conversationId: conv.id,
            agentDefinitionId: conv.agent_definition_id,
            agentDefinitionVersion: conv.agent_definition_version,
            agentInstanceId: instanceId,
            type: "agent.completed",
            payload: {
              error: result.output.slice(0, 500),
              status: result.status,
              retrying: true,
            },
          });
          await eventLog.flush();

          childLogger.warn(
            {
              status: result.status,
              retryCount: conv.retry_count + 1,
            },
            "Conversation re-enqueued for retry",
          );
        }
      } else if (result.status === "aborted") {
        // Graceful shutdown / abort: re-enqueue
        await db
          .update(conversations)
          .set({
            status: "queued",
            messages: finalMessages as unknown[],
            claimed_by: null,
            claimed_at: null,
            last_heartbeat_at: null,
            updated_at: new Date(),
          })
          .where(eq(conversations.id, conv.id));

        eventLog.append({
          conversationId: conv.id,
          agentDefinitionId: conv.agent_definition_id,
          agentDefinitionVersion: conv.agent_definition_version,
          agentInstanceId: instanceId,
          type: "agent.paused",
          payload: { reason: "aborted" },
        });
        await eventLog.flush();

        childLogger.info("Conversation aborted, re-enqueued");
      }
    } catch (error) {
      // Unexpected error: try to mark conversation appropriately
      childLogger.error(
        { err: error },
        "Unexpected error executing conversation",
      );

      try {
        const isRetryable = conv.retry_count < conv.max_retries;
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";

        await db
          .update(conversations)
          .set({
            status: isRetryable ? "queued" : "failed",
            retry_count: isRetryable ? conv.retry_count + 1 : conv.retry_count,
            error_message: errorMessage.slice(0, 1000),
            claimed_by: null,
            claimed_at: null,
            last_heartbeat_at: null,
            updated_at: new Date(),
          })
          .where(eq(conversations.id, conv.id));
      } catch (persistError) {
        childLogger.error(
          { err: persistError },
          "Failed to persist error state for conversation",
        );
      }
    }
  }

  // ─── Poll Cycle ───────────────────────────────────────────────────────

  async function poll(): Promise<void> {
    if (draining) return;

    try {
      // 1. Recover stale conversations
      await recoverStaleConversations();

      // 2. Calculate capacity
      const capacity = concurrencyLimit - running.size;

      // 3. Claim conversations
      if (capacity > 0) {
        const claimed = await claimConversations(capacity);

        // 4. Fire-and-forget execution for each claimed conversation
        for (const conv of claimed) {
          const controller = new AbortController();
          running.set(conv.id, controller);
          void executeConversation(conv, controller.signal).finally(() => {
            running.delete(conv.id);
          });
        }
      }
    } catch (error) {
      logger.error({ err: error }, "Error in poll cycle");
    }

    // Schedule next poll (setTimeout, not setInterval)
    if (!draining) {
      pollTimer = setTimeout(() => void poll(), pollIntervalMs);
    }
  }

  // ─── Interface ────────────────────────────────────────────────────────

  return {
    start() {
      if (started && !draining) return;

      started = true;
      draining = false;

      logger.info(
        {
          pollIntervalMs,
          concurrencyLimit,
          heartbeatIntervalMs,
          staleThresholdMs,
        },
        "Worker loop started",
      );

      // Begin first poll immediately
      void poll();
    },

    async drain(): Promise<void> {
      draining = true;

      // Clear the poll timer
      if (pollTimer !== null) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }

      logger.info(
        { runningCount: running.size },
        "Draining worker loop, waiting for running conversations",
      );

      // Wait for all running conversations to finish
      while (running.size > 0) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      logger.info("Worker loop drained, all conversations finished");
    },

    async close(): Promise<void> {
      await this.drain();
      await eventLog.flush();

      started = false;
      logger.info("Worker loop closed");
    },

    isRunning(): boolean {
      return started && !draining;
    },

    getRunningCount(): number {
      return running.size;
    },
  };
}
