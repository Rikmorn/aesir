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
import type {
  AgentLoopResult,
  LLMResponse,
} from "../shared/agent-loop/types.js";
import { denormalize } from "../shared/communication/denormalizer.js";
import { appendReplyContextTag } from "../shared/communication/message-utils.js";
import type { ReplyContext } from "../shared/communication/types.js";
import type * as agentsSchemaModule from "../shared/db/schema.js";
import type { Conversation, TaskHandoff } from "../shared/db/schema.js";
import { conversations } from "../shared/db/schema.js";
import type { CorrelationService } from "../shared/services/correlation-service.js";
import type { DirectoryService } from "../shared/services/directory-service.js";
import type { TaskService } from "../shared/services/task-service.js";
import { hasTextContent } from "./event-content.js";
import { createHistoryManager } from "./history-manager.js";
import { signalMatchesPendingWait } from "./signal-matching.js";
import type { TimeoutScheduler } from "./timeout-scheduler.js";
import type {
  AgentEventType,
  AgentRegistry,
  ConversationExecutor,
  EventLog,
  SandboxManager,
  SessionProjection,
  ToolContext,
  ToolRegistry,
} from "./types.js";
import { createWaitForTaskTool } from "./wait-for-task-tool.js";
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
  /** TaskService for task context injection (Phase 58.2) */
  taskService?: TaskService | undefined;
  /** DirectoryService for delegation target validation (Phase 70) */
  directoryService?: DirectoryService | undefined;
  /** ConversationExecutor for starting delegated conversations (Phase 70, late-bound) */
  executor?: ConversationExecutor | undefined;
  /** CorrelationService for work correlation status propagation (Phase 78) */
  correlationService?: CorrelationService | undefined;
}

/**
 * Status snapshot of the worker loop, returned by getStatus().
 */
export interface WorkerLoopStatus {
  /** Number of currently executing conversations */
  activeClaims: number;
  /** Maximum concurrent conversations allowed */
  maxConcurrent: number;
  /** How often the worker polls for new work (ms) */
  pollIntervalMs: number;
  /** When the last poll cycle started, or null if never polled */
  lastPollAt: Date | null;
  /** Milliseconds since the worker loop started */
  uptimeMs: number;
  /** Whether the loop is currently running (not draining) */
  isRunning: boolean;
}

/**
 * WorkerLoop - Polls for queued conversations and executes agent loops.
 */
export interface WorkerLoop {
  /** Start the polling loop */
  start(): void;
  /** Stop accepting new work and wait for running conversations to finish.
   *  If timeoutMs is provided, aborts in-flight conversations after the deadline. */
  drain(timeoutMs?: number): Promise<void>;
  /** Drain and then flush/clean up resources.
   *  If timeoutMs is provided, limits drain wait to that duration. */
  close(timeoutMs?: number): Promise<void>;
  /** Whether the loop is currently running (not draining) */
  isRunning(): boolean;
  /** Whether the loop is currently draining (shutdown in progress) */
  isDraining(): boolean;
  /** Number of currently executing conversations */
  getRunningCount(): number;
  /** Get a snapshot of current worker loop status */
  getStatus(): WorkerLoopStatus;
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
    taskService,
    directoryService,
  } = options;

  // executor is accessed via options.executor (late-bound reference)
  // because the executor and worker loop are created in sequence and
  // the executor passes itself after both are constructed.

  const logger = parentLogger.child({ component: "worker-loop", workerId });

  // ─── Sandbox Setup ───────────────────────────────────────────────────

  /**
   * Spawn a sandbox container and clone the repo if needed.
   * Reuses existing containers on resume (idempotent spawn).
   * Skips repo clone if /workspace/repo/.git already exists.
   */
  async function setupSandbox(opts: {
    manager: SandboxManager;
    sandboxId: string;
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
    await opts.manager.spawn({ taskId: opts.sandboxId });
    opts.logger.info({ sandboxId: opts.sandboxId }, "Sandbox container ready");

    // 2. Check if repo already cloned (resume case)
    const check = await opts.manager.execute(opts.sandboxId, {
      command: ["test", "-d", "/workspace/repo/.git"],
      timeoutMs: 5000,
    });
    if (check.exitCode === 0) {
      opts.logger.info(
        { sandboxId: opts.sandboxId },
        "Sandbox repo already present",
      );
      return;
    }

    // 3. Clone repo if URL available
    if (opts.setup?.repoUrl) {
      const git = createDevContainerGit({
        manager: opts.manager,
        logger: opts.logger,
      });
      if (opts.setup.githubToken) {
        await git.configureCredentials(opts.sandboxId, opts.setup.githubToken);
      }
      const cloneOpts: {
        branch?: string;
        gitUser?: { name: string; email: string };
      } = {};
      if (opts.setup.baseBranch) {
        cloneOpts.branch = opts.setup.baseBranch;
      }
      const result = await git.cloneRepository(
        opts.sandboxId,
        opts.setup.repoUrl,
        cloneOpts,
      );
      if (!result.success) {
        throw new Error(
          `Failed to clone repo: ${result.error || result.stderr}`,
        );
      }
      opts.logger.info(
        { sandboxId: opts.sandboxId, repoUrl: opts.setup.repoUrl },
        "Repository cloned into sandbox",
      );
    }
  }

  // ─── Task Context Builder ─────────────────────────────────────────────

  /**
   * Build the <task_context> XML block for injection into conversations.
   * Two modes: metadata-only (no handoffs) or metadata + latest handoff.
   * Per CONTEXT.md: always inject when task_id exists, truncate at 4000 chars,
   * include get_task_context pointer only when truncated or multiple handoffs.
   */
  function buildTaskContextBlock(
    task: {
      id: string;
      title: string;
      objective: string | null;
      status: string;
      assignee_type: string;
      assignee_id: string;
    },
    latestHandoff: TaskHandoff | null,
    handoffCount: number,
  ): string {
    const lines: string[] = ["<task_context>"];
    lines.push(`Task: ${task.id}`);
    lines.push(`Title: ${task.title}`);
    if (task.objective) lines.push(`Objective: ${task.objective}`);
    lines.push(`Status: ${task.status}`);
    lines.push(`Assignee: ${task.assignee_type}:${task.assignee_id}`);

    if (!latestHandoff) {
      lines.push("");
      lines.push("No handoffs recorded yet.");
      lines.push("</task_context>");
      return lines.join("\n");
    }

    // Add latest handoff
    lines.push("");
    lines.push("--- Latest Handoff ---");
    lines.push(`Type: ${latestHandoff.handoff_type}`);
    lines.push(
      `Author: ${latestHandoff.author_type}:${latestHandoff.author_id}`,
    );
    lines.push(`Date: ${latestHandoff.created_at.toISOString()}`);

    // Format handoff context fields
    const ctx = latestHandoff.context as Record<string, unknown>;
    if (ctx.summary) lines.push(`Summary: ${ctx.summary}`);
    if (Array.isArray(ctx.key_decisions) && ctx.key_decisions.length > 0) {
      lines.push("Key Decisions:");
      for (const d of ctx.key_decisions) lines.push(`  - ${d}`);
    }
    if (
      ctx.artifacts &&
      typeof ctx.artifacts === "object" &&
      Object.keys(ctx.artifacts as object).length > 0
    ) {
      lines.push(`Artifacts: ${JSON.stringify(ctx.artifacts)}`);
    }
    if (Array.isArray(ctx.open_questions) && ctx.open_questions.length > 0) {
      lines.push("Open Questions:");
      for (const q of ctx.open_questions) lines.push(`  - ${q}`);
    }
    if (ctx.next_steps) lines.push(`Next Steps: ${ctx.next_steps}`);

    // Check total length and apply truncation
    const closingTag = "</task_context>";
    let block = lines.join("\n");
    const MAX_CHARS = 4000;

    if (block.length + closingTag.length + 1 > MAX_CHARS) {
      // Truncate and add pointer
      const truncateAt = MAX_CHARS - closingTag.length - 80; // room for truncation note
      block = block.slice(0, truncateAt);
      block += "\n...\n[Truncated -- call get_task_context for full history]";
    } else if (handoffCount > 1) {
      // Not truncated but multiple handoffs exist -- add pointer
      block += `\n\n${handoffCount} total handoffs. Call get_task_context for full history.`;
    }

    block += `\n${closingTag}`;
    return block;
  }

  // ─── Active Delegations Context ──────────────────────────────────────

  /**
   * Format the active_delegations array as an XML block for injection
   * into signal messages. Gives the agent full orientation on what
   * delegations are currently pending, regardless of why it was woken.
   *
   * Returns empty string if no active delegations.
   */
  function formatActiveDelegations(delegations: unknown[]): string {
    if (!delegations || delegations.length === 0) return "";

    const entries = delegations as Array<{
      taskId?: string;
      targetEntityId?: string;
      description?: string;
      delegatedAt?: string;
      handshakeStatus?: string;
      estimate?: string;
    }>;

    const lines: string[] = ["<active_delegations>"];
    for (const entry of entries) {
      const attrs = [
        `task_id="${entry.taskId ?? "unknown"}"`,
        `target="${entry.targetEntityId ?? "unknown"}"`,
        `status="${entry.handshakeStatus ?? "pending"}"`,
      ];
      if (entry.estimate) {
        attrs.push(`estimate="${entry.estimate}"`);
      }
      lines.push(
        `<delegation ${attrs.join(" ")}>${entry.description ?? "No description"}`,
      );
      lines.push(`Delegated: ${entry.delegatedAt ?? "unknown"}</delegation>`);
    }
    lines.push("</active_delegations>");
    return lines.join("\n");
  }

  /**
   * Compute updated active_delegations after processing a signal.
   *
   * - task_completion / task_failure / task_timeout: remove the matching entry
   * - task_handshake with response=accepted: update handshakeStatus + estimate
   * - task_handshake with response=rejected: remove the matching entry
   * - Other signal types: no change
   *
   * Returns null if no changes needed (caller should skip the update).
   */
  function computeUpdatedDelegations(
    currentDelegations: unknown[],
    signalType: string,
    signalData: Record<string, unknown> | undefined,
  ): unknown[] | null {
    if (!currentDelegations || currentDelegations.length === 0) return null;

    const taskId = signalData?.taskId as string | undefined;
    if (!taskId) return null;

    const REMOVAL_SIGNAL_TYPES = [
      "task_completion",
      "task_failure",
      "task_timeout",
    ];

    if (REMOVAL_SIGNAL_TYPES.includes(signalType)) {
      const filtered = currentDelegations.filter(
        (d) => (d as { taskId?: string }).taskId !== taskId,
      );
      // Only return if something changed
      return filtered.length !== currentDelegations.length ? filtered : null;
    }

    if (signalType === "task_handshake") {
      const response = signalData?.response as string | undefined;
      if (response === "rejected") {
        // Remove the rejected delegation
        const filtered = currentDelegations.filter(
          (d) => (d as { taskId?: string }).taskId !== taskId,
        );
        return filtered.length !== currentDelegations.length ? filtered : null;
      }
      if (response === "accepted") {
        // Update handshakeStatus and add estimate if provided
        const updated = currentDelegations.map((d) => {
          const entry = d as { taskId?: string; [key: string]: unknown };
          if (entry.taskId === taskId) {
            const updated: Record<string, unknown> = {
              ...entry,
              handshakeStatus: "accepted",
            };
            if (signalData?.estimate) {
              updated.estimate = signalData.estimate as string;
            }
            return updated;
          }
          return d;
        });
        return updated;
      }
    }

    return null;
  }

  // ─── Failure Notification ─────────────────────────────────────────────

  /**
   * Build a human-readable failure message for notification delivery.
   * Includes agent name, classified failure reason, retry count, task context,
   * and conversation ID for log correlation.
   */
  function buildFailureMessage(
    conv: Conversation,
    failureReason: string,
  ): string {
    const retryInfo =
      conv.retry_count > 0
        ? `Failed after ${conv.retry_count}/${conv.max_retries} retries`
        : "Failed (non-retryable)";

    const lines = [
      `**${conv.agent_definition_id}** encountered an error and could not complete its work.`,
      "",
      `**Reason:** ${failureReason}`,
      `**Status:** ${retryInfo}`,
    ];

    if (conv.task_id) {
      lines.push(`**Task:** ${conv.task_id}`);
    }
    lines.push(`**Conversation:** ${conv.id}`);

    return lines.join("\n");
  }

  /**
   * Send a failure notification to the originating channel via the denormalizer.
   * All channels (Slack, Linear, GitHub) receive the same notification.
   *
   * When no reply_context exists, the failure is logged and skipped
   * (the dashboard is the backstop for these cases).
   *
   * When the notification itself fails to deliver, a notification.failed
   * event is emitted to the event log for dashboard visibility.
   */
  async function notifyFailure(
    conv: Conversation,
    failureReason: string,
    deps: { logger: PinoLogger; eventLog: EventLog; instanceId: string },
  ): Promise<void> {
    const replyContext = conv.reply_context as ReplyContext | null;
    if (!replyContext) {
      deps.logger.info(
        { conversationId: conv.id },
        "No reply_context, skipping failure notification (dashboard only)",
      );
      return;
    }

    const message = buildFailureMessage(conv, failureReason);

    try {
      await denormalize(
        { replyContext, text: message },
        {
          agentId: conv.agent_definition_id,
          correlationId: conv.id,
          logger: deps.logger,
        },
      );
      deps.logger.info(
        { conversationId: conv.id, channel: replyContext.channel },
        "Failure notification sent",
      );
    } catch (error) {
      // Backstop: emit notification.failed event for dashboard visibility
      deps.eventLog.append({
        conversationId: conv.id,
        agentDefinitionId: conv.agent_definition_id,
        agentDefinitionVersion: conv.agent_definition_version ?? "unknown",
        agentInstanceId: deps.instanceId,
        type: "notification.failed",
        payload: {
          channel: replyContext.channel,
          error: error instanceof Error ? error.message : String(error),
          originalReason: failureReason.slice(0, 500),
        },
      });
      deps.logger.warn(
        { err: error, conversationId: conv.id, channel: replyContext.channel },
        "Failure notification delivery failed (dashboard backstop)",
      );
    }
  }

  // ─── Recovery Context ────────────────────────────────────────────────

  /**
   * Truncate a string output to a maximum length, appending "..." if truncated.
   */
  function truncateOutput(text: string | undefined, maxLen: number): string {
    if (!text) return "(no output)";
    return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text;
  }

  /**
   * Build a <recovery_context> block for injection when a conversation resumes
   * after a crash. Queries the event log for events that occurred after the
   * last persisted message boundary, giving the agent visibility into work
   * that happened between its last checkpoint and the interruption.
   *
   * Returns null if no recovery events exist (nothing happened after checkpoint).
   */
  async function buildRecoveryContext(
    conv: Conversation,
    eventLogRef: EventLog,
    childLogger: PinoLogger,
  ): Promise<string | null> {
    const afterSequence = conv.last_persisted_sequence ?? 0;

    // Query events after last persistence point
    const recoveryEvents = await eventLogRef.query(conv.id, {
      types: [
        "tool.succeeded",
        "tool.failed",
        "agent.completed",
        "signal.received",
      ],
      afterSequence,
    });

    if (recoveryEvents.length === 0) return null;

    childLogger.info(
      { recoveryEvents: recoveryEvents.length, afterSequence },
      "Building recovery context",
    );

    const lines: string[] = ["<recovery_context>"];

    // Retry awareness
    if (conv.retry_count > 0) {
      const retryLabel =
        conv.retry_count >= conv.max_retries
          ? `retry ${conv.retry_count} of ${conv.max_retries} (final attempt)`
          : `retry ${conv.retry_count} of ${conv.max_retries}`;
      lines.push(
        `This conversation was interrupted (${retryLabel}) and is being resumed.`,
      );
      if (conv.error_message) {
        lines.push(`Previous interruption: ${conv.error_message}`);
      }
    } else {
      lines.push("This conversation is being resumed after an interruption.");
    }

    lines.push("");
    lines.push(
      "Work completed since your last checkpoint (not in your message history):",
    );
    lines.push("");

    for (const event of recoveryEvents) {
      const payload = event.payload as Record<string, unknown>;

      switch (event.type) {
        case "agent.completed": {
          // Sub-agent completions (most important -- re-spawning is expensive)
          if (event.parent_instance_id) {
            const role = (payload.role as string) ?? event.agent_definition_id;
            const error = payload.error as string | undefined;
            if (error) {
              lines.push(
                `- Sub-agent "${role}" failed: ${truncateOutput(error, 200)}`,
              );
            } else {
              const output = truncateOutput(
                payload.output as string | undefined,
                300,
              );
              lines.push(`- Sub-agent "${role}" completed: ${output}`);
            }
          }
          // Omit agent.completed events that are NOT sub-agents
          break;
        }
        case "tool.succeeded": {
          const toolName = (payload.tool_name as string) ?? "unknown";
          const output = truncateOutput(
            payload.output as string | undefined,
            200,
          );
          lines.push(`- Tool "${toolName}" succeeded: ${output}`);
          break;
        }
        case "tool.failed": {
          const toolName = (payload.tool_name as string) ?? "unknown";
          const error = truncateOutput(
            (payload.error as string | undefined) ??
              (payload.output as string | undefined),
            200,
          );
          lines.push(`- Tool "${toolName}" failed: ${error}`);
          break;
        }
        case "signal.received": {
          const signalType =
            (payload.signalType as string) ??
            (payload.type as string) ??
            "unknown";
          const source = (payload.source as string) ?? "unknown";
          lines.push(`- Signal received: ${signalType} from ${source}`);
          break;
        }
      }
    }

    lines.push("");
    lines.push("Continue from where you left off, accounting for the above.");
    lines.push("</recovery_context>");

    return lines.join("\n");
  }

  // ─── Resume Activity Emission ─────────────────────────────────────────

  /**
   * Emit a best-effort thought activity to Linear when a conversation resumes.
   * Transitions the Linear session to `active` state promptly.
   * Only fires when the conversation has a Linear agent session in its replyContext.
   * Fire-and-forget: failures are logged but never mask execution.
   */
  async function emitResumeActivity(
    replyContext: unknown,
    deps: { logger: PinoLogger; agentId: string; correlationId: string },
  ): Promise<void> {
    try {
      const ctx = replyContext as Record<string, unknown> | undefined;
      if (!ctx || ctx.channel !== "linear" || !ctx.agentSessionId) return;

      const { callMcpTool } = await import("../shared/mcp/client.js");

      await callMcpTool({
        integration: "linear",
        tool: "create_agent_activity",
        params: {
          agentSessionId: ctx.agentSessionId as string,
          type: "thought",
          body: "Resuming work...",
        },
        agentId: deps.agentId,
        correlationId: deps.correlationId,
      });

      deps.logger.info(
        { sessionId: ctx.agentSessionId },
        "Resume activity emitted to Linear",
      );
    } catch (error) {
      deps.logger.warn(
        { err: error },
        "Failed to emit resume activity to Linear (non-fatal)",
      );
    }
  }

  // ─── Completion Activity Emission ───────────────────────────────────────

  /**
   * Emit a best-effort response activity to Linear when a conversation completes.
   * Transitions the Linear session to `complete` state.
   * Only fires when the conversation has a Linear agent session in its replyContext.
   * Fire-and-forget: failures are logged but never mask execution.
   */
  async function emitCompletionActivity(
    replyContext: unknown,
    deps: { logger: PinoLogger; agentId: string; correlationId: string },
  ): Promise<void> {
    try {
      const ctx = replyContext as Record<string, unknown> | undefined;
      if (!ctx || ctx.channel !== "linear" || !ctx.agentSessionId) return;

      const { callMcpTool } = await import("../shared/mcp/client.js");

      await callMcpTool({
        integration: "linear",
        tool: "create_agent_activity",
        params: {
          agentSessionId: ctx.agentSessionId as string,
          type: "response",
          body: "Task completed.",
        },
        agentId: deps.agentId,
        correlationId: deps.correlationId,
      });

      deps.logger.info(
        { sessionId: ctx.agentSessionId },
        "Completion activity emitted to Linear",
      );
    } catch (error) {
      deps.logger.warn(
        { err: error },
        "Failed to emit completion activity to Linear (non-fatal)",
      );
    }
  }

  // State
  let draining = false;
  let started = false;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  const running = new Map<string, AbortController>();
  let startedAt: Date | null = null;
  let lastPollAt: Date | null = null;

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

          // Emit stale_recovered event (non-fatal)
          try {
            eventLog.append({
              conversationId: row.id,
              agentDefinitionId: row.agent_definition_id,
              agentDefinitionVersion: row.agent_definition_version,
              agentInstanceId: `stale-recovery-${row.id}`,
              parentInstanceId: row.parent_conversation_id
                ? `parent-${row.parent_conversation_id}`
                : null,
              type: "agent.stale_recovered",
              payload: {
                workerId: workerId,
                staleDurationMs:
                  Date.now() - (row.last_heartbeat_at?.getTime() ?? Date.now()),
                retryCount: row.retry_count + 1,
                maxRetries: row.max_retries,
              },
            });
          } catch (eventErr) {
            logger.warn(
              { err: eventErr, conversationId: row.id },
              "Failed to emit agent.stale_recovered event (non-fatal)",
            );
          }

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

          // Emit stale_recovered with exhausted flag (non-fatal)
          try {
            eventLog.append({
              conversationId: row.id,
              agentDefinitionId: row.agent_definition_id,
              agentDefinitionVersion: row.agent_definition_version,
              agentInstanceId: `stale-recovery-${row.id}`,
              parentInstanceId: row.parent_conversation_id
                ? `parent-${row.parent_conversation_id}`
                : null,
              type: "agent.stale_recovered",
              payload: {
                workerId: workerId,
                staleDurationMs:
                  Date.now() - (row.last_heartbeat_at?.getTime() ?? Date.now()),
                retryCount: row.retry_count,
                maxRetries: row.max_retries,
                exhausted: true,
              },
            });
          } catch (eventErr) {
            logger.warn(
              { err: eventErr, conversationId: row.id },
              "Failed to emit agent.stale_recovered event (non-fatal)",
            );
          }

          logger.error(
            {
              conversationId: row.id,
              retryCount: row.retry_count,
              maxRetries: row.max_retries,
            },
            "Failed stale conversation: exceeded max retries",
          );

          // Notify originating channel of failure
          await notifyFailure(row, "Stale heartbeat: exceeded max retries", {
            logger,
            eventLog,
            instanceId: `notification-${row.id}`,
          });
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

        await notifyFailure(
          conv,
          `Agent definition not found: ${conv.agent_definition_id}`,
          {
            logger: childLogger,
            eventLog,
            instanceId,
          },
        );
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

            await notifyFailure(
              conv,
              `Sub-agent definition not found: ${agentId} (role: ${role})`,
              {
                logger: childLogger,
                eventLog,
                instanceId,
              },
            );
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

      // Extract initial context from first message (for new conversations)
      const firstMessage = existingMessages[0];
      const initialContext =
        !isResumed && firstMessage
          ? typeof firstMessage.content === "string"
            ? firstMessage.content
            : JSON.stringify(firstMessage.content)
          : undefined;

      // Append lifecycle event
      // For agent.started, capture the system prompt and initial context
      // so we know exactly what was used for this conversation
      eventLog.append({
        conversationId: conv.id,
        agentDefinitionId: conv.agent_definition_id,
        agentDefinitionVersion: conv.agent_definition_version,
        agentInstanceId: instanceId,
        type: isResumed ? "agent.resumed" : "agent.started",
        payload: isResumed
          ? { workerId }
          : {
              workerId,
              systemPrompt: definition.systemPrompt,
              initialContext,
            },
      });

      // 3a. Emit resume activity to Linear (best-effort, transitions session to active)
      if (isResumed) {
        await emitResumeActivity(conv.reply_context, {
          logger: childLogger,
          agentId: conv.agent_definition_id,
          correlationId: conv.id,
        });
      }

      // 3b. Inject task context if conversation has a task (Phase 58.2, TASK-23)
      if (conv.task_id && taskService) {
        try {
          const task = await taskService.get(conv.task_id);
          if (task) {
            const latestHandoff = await taskService.getLatestHandoff(
              conv.task_id,
            );
            // Get handoff count for pointer logic
            const allHandoffs = await taskService.getHandoffs(conv.task_id);
            const handoffCount = allHandoffs.length;

            const taskContextBlock = buildTaskContextBlock(
              task,
              latestHandoff,
              handoffCount,
            );

            if (!isResumed && existingMessages.length > 0) {
              // New conversation: insert task_context after workspace_context in first message
              const firstMsg = existingMessages[0];
              if (firstMsg && typeof firstMsg.content === "string") {
                // Find the end of </workspace_context> if it exists, insert after it
                const wsEnd = firstMsg.content.indexOf("</workspace_context>");
                if (wsEnd >= 0) {
                  const insertAt = wsEnd + "</workspace_context>".length;
                  firstMsg.content =
                    firstMsg.content.slice(0, insertAt) +
                    "\n\n" +
                    taskContextBlock +
                    "\n\n" +
                    firstMsg.content.slice(insertAt).replace(/^\n+/, "");
                } else {
                  // No workspace_context -- prepend task_context to the message
                  firstMsg.content = `${taskContextBlock}\n\n${firstMsg.content}`;
                }
              }
            } else if (isResumed) {
              // Reopened/resumed conversation: append task_context as user message
              // This goes alongside <world_state> at the reopen boundary
              existingMessages.push({
                role: "user" as const,
                content: taskContextBlock,
              });
            }

            childLogger.info(
              {
                taskId: conv.task_id,
                hasHandoff: !!latestHandoff,
                handoffCount,
              },
              "Task context injected",
            );
          }
        } catch (taskErr) {
          // Non-fatal: log and continue without task context
          childLogger.error(
            { err: taskErr, taskId: conv.task_id },
            "Failed to inject task context (non-fatal)",
          );
        }
      }

      // 3c. Inject recovery context for resumed conversations (Phase 76)
      // Recovery context tells the agent about work completed after its last
      // persisted checkpoint but before the interruption. Ordering: task context
      // first, active delegations second (in signal section), recovery context last.
      if (isResumed) {
        try {
          const recoveryBlock = await buildRecoveryContext(
            conv,
            eventLog,
            childLogger,
          );
          if (recoveryBlock) {
            existingMessages.push({
              role: "user" as const,
              content: recoveryBlock,
            });
            childLogger.info("Recovery context injected into resume messages");
          }
        } catch (recoveryErr) {
          // Non-fatal: log and continue without recovery context
          childLogger.error(
            { err: recoveryErr },
            "Failed to build recovery context (non-fatal)",
          );
        }
      }

      // 4. Setup sandbox if agent uses codebase tools
      const needsSandbox = definition.tools.some((t) =>
        t.startsWith("codebase:"),
      );
      if (needsSandbox && sandboxManager) {
        await setupSandbox({
          manager: sandboxManager,
          sandboxId: conv.id,
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

      // 5b. Track current tool call ID for MCP event correlation
      // Updated by onToolCall callback before each tool execution.
      // Used by onMcpEvent closure to inject toolCallId into emitted events.
      let currentToolCallId: string | undefined;

      const toolContext: ToolContext = {
        agentId: conv.agent_definition_id,
        correlationId: conv.id,
        taskId: conv.task_id ?? undefined,
        logger: childLogger,
        onMcpEvent: (event) => {
          try {
            eventLog.append({
              conversationId: conv.id,
              agentDefinitionId: conv.agent_definition_id,
              agentDefinitionVersion: conv.agent_definition_version,
              agentInstanceId: instanceId,
              type: event.type as AgentEventType,
              payload: {
                ...event.payload,
                toolCallId: currentToolCallId,
              },
            });
          } catch (err) {
            childLogger.warn(
              { err, eventType: event.type },
              "Failed to emit MCP event (non-fatal)",
            );
          }
        },
        ...(needsSandbox &&
          sandboxManager && {
            containerManager: sandboxManager,
            sandboxId: conv.id,
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
        // Delegation deps: populated when agent has task:delegate or task:respond in its tools
        ...((definition.tools.includes("task:delegate") ||
          definition.tools.includes("task:respond")) &&
          taskService &&
          directoryService &&
          options.executor && {
            delegationDeps: {
              executor: options.executor,
              directoryService,
              taskService,
              db,
            },
          }),
      };
      const resolvedTools = toolRegistry.resolve(definition.tools, toolContext);

      // 5. Wire wait_for and wait_for_task interception
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
      const waitForTaskToolIndex = resolvedTools.findIndex(
        (t) => t.name === "wait_for_task",
      );
      if (waitForTaskToolIndex >= 0) {
        const realWaitForTaskTool = createWaitForTaskTool(waitForState);
        const existingTaskTool = resolvedTools[waitForTaskToolIndex];
        if (existingTaskTool) {
          resolvedTools[waitForTaskToolIndex] = {
            ...existingTaskTool,
            execute: realWaitForTaskTool.execute,
          };
        }
      }

      // 6. Check queued signals before running
      let currentMessages = [...existingMessages];
      const queuedSignals = (conv.queued_signals ?? []) as Array<{
        type: string;
        data?: Record<string, unknown>;
        message?: string;
        replyContext?: unknown;
      }>;
      const pendingWait = conv.pending_wait as Record<string, unknown> | null;
      // Track consumed signal for post-loop active_delegations cleanup
      let consumedSignalType: string | undefined;
      let consumedSignalData: Record<string, unknown> | undefined;

      if (queuedSignals.length > 0 && pendingWait) {
        const matchIndex = queuedSignals.findIndex((sig) =>
          signalMatchesPendingWait(sig, pendingWait),
        );
        const matchedSignal =
          matchIndex >= 0 ? queuedSignals[matchIndex] : undefined;
        if (matchedSignal) {
          const signalContent =
            matchedSignal.message ??
            `Signal received: ${matchedSignal.type}. Data: ${JSON.stringify(matchedSignal.data ?? {})}`;

          // Inject active_delegations context so agent knows what is in flight
          const activeDelegations = (conv.active_delegations ??
            []) as unknown[];
          const delegationContext = formatActiveDelegations(activeDelegations);
          const contentWithDelegations = delegationContext
            ? `${delegationContext}\n\n${signalContent}`
            : signalContent;

          const finalContent = appendReplyContextTag(
            contentWithDelegations,
            matchedSignal.replyContext as ReplyContext | undefined,
          );

          // Append signal as user message
          currentMessages = [
            ...currentMessages,
            { role: "user" as const, content: finalContent },
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

          // Track for post-loop active_delegations cleanup
          consumedSignalType = matchedSignal.type;
          consumedSignalData = matchedSignal.data;

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
        // Track current tool call ID for MCP event correlation
        currentToolCallId = call.id;
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

      const onResponse = (response: LLMResponse) => {
        childLogger.info(
          {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
            stopReason: response.stop_reason,
          },
          "LLM response received",
        );

        const textContent = hasTextContent(response.content)
          ? (response.content as unknown[])
          : undefined;

        eventLog.append({
          ...eventBase,
          type: "llm.response",
          payload: { stop_reason: response.stop_reason },
          tokenCountInput: response.usage.input_tokens,
          tokenCountOutput: response.usage.output_tokens,
          // Content is buffered alongside the event and flushed atomically
          ...(textContent && { content: textContent }),
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

      // 13b. Update active_delegations if a task lifecycle signal was consumed
      if (consumedSignalType) {
        try {
          // Re-read active_delegations from DB (may have been modified during loop)
          const [freshDelegations] = await db
            .select({
              active_delegations: conversations.active_delegations,
            })
            .from(conversations)
            .where(eq(conversations.id, conv.id))
            .limit(1);

          const currentDelegations = (freshDelegations?.active_delegations ??
            []) as unknown[];
          const activeDelegationsUpdate = computeUpdatedDelegations(
            currentDelegations,
            consumedSignalType,
            consumedSignalData,
          );

          if (activeDelegationsUpdate !== null) {
            await db
              .update(conversations)
              .set({
                active_delegations: activeDelegationsUpdate,
                updated_at: new Date(),
              })
              .where(eq(conversations.id, conv.id));

            childLogger.info(
              {
                signalType: consumedSignalType,
                delegationsRemaining: activeDelegationsUpdate.length,
              },
              "Updated active_delegations after processing signal",
            );
          }
        } catch (delegationCleanupError) {
          // Non-fatal: log and continue
          childLogger.warn(
            { err: delegationCleanupError },
            "Failed to update active_delegations after signal processing (non-fatal)",
          );
        }
      }

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
          replyContext?: unknown;
        }>;

        // Build a synthetic pendingWait from the current waitForState for matching
        const syntheticPendingWait: Record<string, unknown> = {
          types: waitForState.waitTypes,
          metadata: waitForState.metadata,
        };
        const matchIdx = freshSignals.findIndex((sig) =>
          signalMatchesPendingWait(sig, syntheticPendingWait),
        );
        const matchedQueuedSignal =
          matchIdx >= 0 ? freshSignals[matchIdx] : undefined;

        if (matchedQueuedSignal) {
          // Flush buffered events before re-enqueue so the next instance's
          // initSequence() reads the correct max sequence from the DB.
          await eventLog.flush();

          // Consume the queued signal and re-enqueue instead of pausing
          const postLoopSignalContent =
            matchedQueuedSignal.message ??
            `Signal received: ${matchedQueuedSignal.type}. Data: ${JSON.stringify(matchedQueuedSignal.data ?? {})}`;

          // Inject active_delegations context for the next agent loop run
          const postLoopDelegations = (conv.active_delegations ??
            []) as unknown[];
          const postLoopDelegationCtx =
            formatActiveDelegations(postLoopDelegations);
          const postLoopFullContent = postLoopDelegationCtx
            ? `${postLoopDelegationCtx}\n\n${postLoopSignalContent}`
            : postLoopSignalContent;

          const finalContent = appendReplyContextTag(
            postLoopFullContent,
            matchedQueuedSignal.replyContext as ReplyContext | undefined,
          );

          const updatedMessages = [
            ...(finalMessages as unknown[]),
            { role: "user", content: finalContent },
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
              last_persisted_sequence: eventLog.getSequence(conv.id),
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
                waitForState.timeoutSignalType ??
                  waitForState.waitTypes?.[0] ??
                  "unknown",
                waitForState.reason ?? "Agent paused",
                waitForState.metadata ?? undefined,
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
            types: waitForState.waitTypes,
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
              last_persisted_sequence: eventLog.getSequence(conv.id),
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
              waitTypes: waitForState.waitTypes,
              reason: waitForState.reason,
            },
          });
          await eventLog.flush();

          childLogger.info(
            { waitTypes: waitForState.waitTypes },
            "Conversation paused, waiting for signal",
          );
        }
      } else if (result.status === "completed") {
        // Emit completion activity to Linear (best-effort, transitions session to complete)
        await emitCompletionActivity(conv.reply_context, {
          logger: childLogger,
          agentId: conv.agent_definition_id,
          correlationId: conv.id,
        });

        // Completed successfully
        await db
          .update(conversations)
          .set({
            status: "completed",
            messages: finalMessages as unknown[],
            last_persisted_sequence: eventLog.getSequence(conv.id),
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
          // Classify failure reason for notification
          const failureReason = result.output.includes("Token budget exhausted")
            ? "Token budget exhausted"
            : result.output.includes("Agent aborted")
              ? "Agent aborted"
              : result.status === "max_iterations"
                ? "Maximum iterations reached"
                : result.status === "max_tokens"
                  ? "Maximum tokens reached"
                  : "Unrecoverable error";

          await db
            .update(conversations)
            .set({
              status: "failed",
              messages: finalMessages as unknown[],
              error_message: result.output.slice(0, 1000),
              last_persisted_sequence: eventLog.getSequence(conv.id),
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

          // Notify originating channel of failure
          await notifyFailure(conv, failureReason, {
            logger: childLogger,
            eventLog,
            instanceId,
          });

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
              last_persisted_sequence: eventLog.getSequence(conv.id),
              claimed_by: null,
              claimed_at: null,
              last_heartbeat_at: null,
              updated_at: new Date(),
            })
            .where(eq(conversations.id, conv.id));

          // Emit retry_scheduled event (non-fatal)
          try {
            eventLog.append({
              conversationId: conv.id,
              agentDefinitionId: conv.agent_definition_id,
              agentDefinitionVersion: conv.agent_definition_version,
              agentInstanceId: instanceId,
              type: "agent.retry_scheduled",
              payload: {
                retryCount: conv.retry_count + 1,
                maxRetries: conv.max_retries,
                errorContext: result.output.slice(0, 500),
                reason: result.status,
              },
            });
          } catch (eventErr) {
            childLogger.warn(
              { err: eventErr },
              "Failed to emit agent.retry_scheduled event (non-fatal)",
            );
          }

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
            last_persisted_sequence: eventLog.getSequence(conv.id),
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

        // Emit retry_scheduled event when re-enqueuing (non-fatal)
        if (isRetryable) {
          try {
            eventLog.append({
              conversationId: conv.id,
              agentDefinitionId: conv.agent_definition_id,
              agentDefinitionVersion: conv.agent_definition_version,
              agentInstanceId: instanceId,
              type: "agent.retry_scheduled",
              payload: {
                retryCount: conv.retry_count + 1,
                maxRetries: conv.max_retries,
                errorContext: errorMessage.slice(0, 500),
                reason: "unhandled_error",
              },
            });
          } catch (eventErr) {
            childLogger.warn(
              { err: eventErr },
              "Failed to emit agent.retry_scheduled event (non-fatal)",
            );
          }
        }

        // Notify originating channel on terminal failure
        if (!isRetryable) {
          await notifyFailure(conv, errorMessage, {
            logger: childLogger,
            eventLog,
            instanceId,
          });
        }
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

    lastPollAt = new Date();

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
      startedAt = new Date();

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

    async drain(timeoutMs?: number): Promise<void> {
      draining = true;

      // Clear the poll timer
      if (pollTimer !== null) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }

      logger.info(
        {
          runningCount: running.size,
          conversationIds: [...running.keys()],
          timeoutMs,
        },
        "Graceful shutdown initiated, draining",
      );

      // Wait for all running conversations to finish
      const waitForFinish = async () => {
        while (running.size > 0) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      };

      if (timeoutMs) {
        const deadline = new Promise<void>((resolve) => {
          setTimeout(() => {
            if (running.size > 0) {
              // Log abandoned conversations at warn level
              logger.warn(
                {
                  abandonedCount: running.size,
                  conversationIds: [...running.keys()],
                },
                "Drain timeout reached, abandoning in-flight conversations",
              );
              // Abort in-flight conversations so they stop cleanly
              for (const [, controller] of running) {
                controller.abort();
              }
            }
            resolve();
          }, timeoutMs);
        });
        await Promise.race([waitForFinish(), deadline]);
      } else {
        await waitForFinish();
      }

      logger.info("Worker loop drained");
    },

    async close(timeoutMs?: number): Promise<void> {
      await this.drain(timeoutMs);
      await eventLog.flush();

      started = false;
      logger.info("Worker loop closed");
    },

    isRunning(): boolean {
      return started && !draining;
    },

    isDraining(): boolean {
      return draining;
    },

    getRunningCount(): number {
      return running.size;
    },

    getStatus(): WorkerLoopStatus {
      return {
        activeClaims: running.size,
        maxConcurrent: concurrencyLimit,
        pollIntervalMs,
        lastPollAt,
        uptimeMs: startedAt ? Date.now() - startedAt.getTime() : 0,
        isRunning: started && !draining,
      };
    },
  };
}
