/**
 * Schedule Registry
 *
 * Manages pg-boss cron jobs for agent schedule triggers.
 * Handles registration, reconciliation, overlap detection (skip policy),
 * schedule state persistence, and context injection for scheduled conversations.
 *
 * Uses the existing pg-boss instance from TimeoutScheduler (shared via getBoss()).
 * Schedule queues use the naming convention: schedule:{agentId}:{scheduleName}
 */

import type { PgBoss } from "pg-boss";
import type { IncomingEvent } from "../adapters/types.js";
import type {
  ScheduleRegistry,
  ScheduleRegistryOptions,
  ScheduleState,
} from "./types.js";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Queue name prefix for schedule cron jobs */
export const SCHEDULE_QUEUE_PREFIX = "schedule:";

/** Build a pg-boss queue name for a schedule */
export function buildScheduleQueueName(
  agentId: string,
  scheduleName: string,
): string {
  return `${SCHEDULE_QUEUE_PREFIX}${agentId}:${scheduleName}`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Format a duration between two dates as a human-readable string */
function formatTimeSince(from: Date, to: Date): string {
  const ms = to.getTime() - from.getTime();
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    const remainingHours = hours % 24;
    return `${days}d ${remainingHours}h`;
  }
  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  }
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create a ScheduleRegistry that manages pg-boss cron jobs for agent schedules.
 */
export function createScheduleRegistry(
  options: ScheduleRegistryOptions,
): ScheduleRegistry {
  const { agentRegistry, pool, logger: parentLogger } = options;
  const logger = parentLogger.child({ component: "schedule-registry" });

  let eventHandler: ((event: IncomingEvent) => Promise<void>) | null = null;

  /**
   * Handle a cron fire from pg-boss.
   * Checks for overlap (skip policy), builds context, routes synthetic event.
   */
  async function handleScheduleFire(
    agentId: string,
    scheduleName: string,
    cron: string,
  ): Promise<void> {
    const correlationKey = `${agentId}:${scheduleName}`;

    // Check for overlap: query conversations where the ID matches the deterministic pattern
    // and status is active (queued, running, waiting)
    const overlapResult = await pool.query(
      `SELECT id, status FROM agents.conversations
       WHERE agent_definition_id = $1
         AND id LIKE $2
         AND status IN ('queued', 'running', 'waiting')
       LIMIT 1`,
      [agentId, `${agentId}-${correlationKey}%`],
    );

    if (overlapResult.rows.length > 0) {
      const activeConv = overlapResult.rows[0] as {
        id: string;
        status: string;
      };
      logger.info(
        {
          agentId,
          scheduleName,
          activeConversationId: activeConv.id,
          activeStatus: activeConv.status,
        },
        "Schedule skipped: active conversation exists (overlap policy: skip)",
      );

      // Log skip event to agent_events (non-fatal, same pattern as event.routed in router)
      try {
        await pool.query(
          `INSERT INTO agents.agent_events
           (id, conversation_id, agent_definition_id, agent_definition_version,
            agent_instance_id, sequence, type, payload)
           VALUES (
             'aevt_sched_' || substr(md5(random()::text), 1, 16),
             'scheduler', 'scheduler', '1.0', 'scheduler', 0,
             'event.routed',
             $1::jsonb
           )`,
          [
            JSON.stringify({
              disposition: "skipped",
              routingMethod: "schedule_overlap",
              agentId,
              scheduleName,
              activeConversationId: activeConv.id,
              reason: "Active conversation exists",
            }),
          ],
        );
      } catch (err) {
        logger.warn(
          { err },
          "Failed to emit schedule.skipped event (non-fatal)",
        );
      }

      return;
    }

    // No overlap -- route the synthetic event
    if (!eventHandler) {
      logger.error(
        { agentId, scheduleName },
        "Schedule fired but no event handler registered (call setEventHandler first)",
      );
      return;
    }

    const syntheticEvent: IncomingEvent = {
      type: "schedule.triggered",
      source: "scheduler",
      correlationKey,
      data: { agentId, scheduleName, cron, trigger: "scheduled" as const },
      message: `Scheduled run: ${scheduleName}`,
    };

    try {
      await eventHandler(syntheticEvent);
      logger.info({ agentId, scheduleName, cron }, "Schedule triggered");
    } catch (err) {
      logger.error(
        { err, agentId, scheduleName },
        "Failed to route scheduled event",
      );
    }
  }

  // ─── Registry Implementation ──────────────────────────────────────────────

  return {
    setEventHandler(handler: (event: IncomingEvent) => Promise<void>): void {
      eventHandler = handler;
    },

    async registerAll(boss: PgBoss): Promise<void> {
      const definitions = await agentRegistry.list();

      // Build set of expected schedule queue names
      const expectedQueues = new Map<
        string,
        { agentId: string; scheduleName: string; cron: string; tz: string }
      >();

      for (const def of definitions) {
        if (!def.schedules) continue;
        for (const schedule of def.schedules) {
          const queueName = buildScheduleQueueName(def.id, schedule.name);
          expectedQueues.set(queueName, {
            agentId: def.id,
            scheduleName: schedule.name,
            cron: schedule.cron,
            tz: schedule.timezone ?? "UTC",
          });
        }
      }

      // Get existing pg-boss schedules and reconcile
      const existingSchedules = await boss.getSchedules();

      // Unschedule stale entries (only schedule: prefix -- avoid touching dedup cleanup or other jobs)
      let unscheduledCount = 0;
      for (const existing of existingSchedules) {
        if (
          existing.name.startsWith(SCHEDULE_QUEUE_PREFIX) &&
          !expectedQueues.has(existing.name)
        ) {
          await boss.unschedule(existing.name);
          unscheduledCount++;
          logger.debug(
            { queueName: existing.name },
            "Unscheduled stale cron job",
          );
        }
      }

      // Register expected schedules
      let registeredCount = 0;
      for (const [queueName, config] of expectedQueues) {
        await boss.createQueue(queueName);
        await boss.schedule(
          queueName,
          config.cron,
          {
            agentId: config.agentId,
            scheduleName: config.scheduleName,
            cron: config.cron,
          },
          { tz: config.tz },
        );
        await boss.work(queueName, async () => {
          await handleScheduleFire(
            config.agentId,
            config.scheduleName,
            config.cron,
          );
        });
        registeredCount++;
      }

      logger.info(
        { registeredCount, unscheduledCount },
        "Schedule registration complete",
      );
    },

    async getScheduleStates(agentId: string): Promise<ScheduleState[]> {
      const result = await pool.query(
        `SELECT agent_id, schedule_name, last_run_at, last_run_outcome,
                last_run_conversation_id, last_run_summary, run_count
         FROM agents.schedule_state
         WHERE agent_id = $1`,
        [agentId],
      );

      return result.rows.map(mapRowToScheduleState);
    },

    async getAllScheduleStates(): Promise<ScheduleState[]> {
      const result = await pool.query(
        `SELECT agent_id, schedule_name, last_run_at, last_run_outcome,
                last_run_conversation_id, last_run_summary, run_count
         FROM agents.schedule_state`,
      );

      return result.rows.map(mapRowToScheduleState);
    },

    async updateScheduleState(
      agentId: string,
      scheduleName: string,
      outcome: string,
      conversationId: string,
      summary: string | null,
    ): Promise<void> {
      await pool.query(
        `INSERT INTO agents.schedule_state
         (agent_id, schedule_name, last_run_at, last_run_outcome,
          last_run_conversation_id, last_run_summary, run_count)
         VALUES ($1, $2, now(), $3, $4, $5, 1)
         ON CONFLICT (agent_id, schedule_name) DO UPDATE SET
           last_run_at = now(),
           last_run_outcome = EXCLUDED.last_run_outcome,
           last_run_conversation_id = EXCLUDED.last_run_conversation_id,
           last_run_summary = EXCLUDED.last_run_summary,
           run_count = agents.schedule_state.run_count + 1`,
        [agentId, scheduleName, outcome, conversationId, summary],
      );
    },

    async buildScheduleContext(
      agentId: string,
      scheduleName: string,
      trigger: "scheduled" | "manual",
    ): Promise<string> {
      // Query schedule state
      const stateResult = await pool.query(
        `SELECT last_run_at, last_run_outcome, last_run_conversation_id,
                last_run_summary, run_count
         FROM agents.schedule_state
         WHERE agent_id = $1 AND schedule_name = $2`,
        [agentId, scheduleName],
      );

      const state = stateResult.rows[0] as
        | {
            last_run_at: Date | null;
            last_run_outcome: string | null;
            last_run_conversation_id: string | null;
            last_run_summary: string | null;
            run_count: number;
          }
        | undefined;

      const lastRunAt = state?.last_run_at
        ? state.last_run_at.toISOString()
        : "Never";
      const timeSinceLastRun = state?.last_run_at
        ? formatTimeSince(state.last_run_at, new Date())
        : "First run";
      const lastRunOutcome = state?.last_run_outcome ?? "N/A";
      const runCount = state?.run_count ?? 0;

      // Try to get last run summary from state, or fall back to conversation messages
      let summary = state?.last_run_summary ?? null;
      if (!summary && state?.last_run_conversation_id) {
        try {
          const convResult = await pool.query(
            `SELECT messages FROM agents.conversations WHERE id = $1`,
            [state.last_run_conversation_id],
          );
          if (convResult.rows.length > 0) {
            const messages = (convResult.rows[0] as { messages: unknown[] })
              .messages;
            // Find last assistant message
            for (let i = messages.length - 1; i >= 0; i--) {
              const msg = messages[i] as { role?: string; content?: unknown };
              if (msg.role === "assistant" && msg.content) {
                const text =
                  typeof msg.content === "string"
                    ? msg.content
                    : JSON.stringify(msg.content);
                summary = text.length > 500 ? `${text.slice(0, 497)}...` : text;
                break;
              }
            }
          }
        } catch {
          // Non-fatal: use "No previous run" as fallback
        }
      }

      const lines: string[] = [
        "<schedule_context>",
        `Schedule: ${scheduleName}`,
        `Last run: ${lastRunAt}`,
        `Time since last run: ${timeSinceLastRun}`,
        `Last run outcome: ${lastRunOutcome}`,
        `Last run summary: ${summary ?? "No previous run"}`,
        `Run count: ${runCount}`,
        `Trigger: ${trigger}`,
        "</schedule_context>",
      ];

      return lines.join("\n");
    },
  };
}

// ─── Row Mapper ──────────────────────────────────────────────────────────────

function mapRowToScheduleState(row: Record<string, unknown>): ScheduleState {
  return {
    agentId: row.agent_id as string,
    scheduleName: row.schedule_name as string,
    lastRunAt: row.last_run_at ? new Date(row.last_run_at as string) : null,
    lastRunOutcome: (row.last_run_outcome as string) ?? null,
    lastRunConversationId: (row.last_run_conversation_id as string) ?? null,
    lastRunSummary: (row.last_run_summary as string) ?? null,
    runCount: (row.run_count as number) ?? 0,
  };
}
