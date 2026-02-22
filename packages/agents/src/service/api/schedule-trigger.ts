/**
 * Schedule API
 *
 * GET  /api/schedules/states                              -- all schedule states with computed nextRunAt
 * GET  /api/schedules/states?agentId=<id>                 -- schedule states for a specific agent
 * POST /api/schedules/:agentId/:scheduleName/trigger      -- manual trigger
 *
 * The GET /states endpoint merges definition data (cron, timezone) with runtime
 * state (last run, run count) and computes nextRunAt via cron-parser.
 *
 * POST trigger manually fires a scheduled agent run. Supports a `force` flag
 * to bypass the skip overlap policy (creates a unique correlationKey with a
 * timestamp suffix). Without `force`, returns 409 if a previous run is active.
 */

import type { PinoLogger } from "@aesir/platform";
import { Router } from "express";
import type { Pool } from "pg";
import type {
  AgentRegistry,
  ConversationExecutor,
  EventRouter,
  ScheduleRegistry,
} from "../../framework/types.js";

// ---- Response Types ---------------------------------------------------------

/** Schedule state with computed fields for the dashboard */
export interface ScheduleStateResponse {
  agentId: string;
  agentName: string | null;
  scheduleName: string;
  cron: string;
  timezone: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastRunOutcome: string | null;
  lastRunConversationId: string | null;
  runCount: number;
  health: "healthy" | "failed" | "missed";
}

// ---- Router Options ---------------------------------------------------------

export interface ScheduleTriggerRouterOptions {
  agentRegistry: AgentRegistry;
  scheduleRegistry: ScheduleRegistry;
  eventRouter: EventRouter;
  executor: ConversationExecutor;
  pool: Pool;
  logger: PinoLogger;
}

// ---- Factory ----------------------------------------------------------------

export function createScheduleTriggerRouter(
  options: ScheduleTriggerRouterOptions,
): Router {
  const {
    agentRegistry,
    scheduleRegistry,
    eventRouter,
    executor,
    pool,
    logger,
  } = options;
  const router = Router();

  // GET /states -- all schedule states with computed nextRunAt
  // Accepts optional ?agentId= query param to filter by agent
  router.get("/states", async (req, res) => {
    try {
      const filterAgentId =
        typeof req.query.agentId === "string" ? req.query.agentId : undefined;

      const definitions = filterAgentId
        ? await agentRegistry.get(filterAgentId).then((d) => (d ? [d] : []))
        : await agentRegistry.list();

      const allStates = await scheduleRegistry.getAllScheduleStates();

      const result: ScheduleStateResponse[] = [];

      for (const agent of definitions) {
        if (!agent.schedules) continue;
        for (const schedule of agent.schedules) {
          const state = allStates.find(
            (s) => s.agentId === agent.id && s.scheduleName === schedule.name,
          );

          // Compute next run time using cron-parser
          let nextRunAt: string | null = null;
          try {
            const { CronExpressionParser } = await import("cron-parser");
            const interval = CronExpressionParser.parse(schedule.cron, {
              tz: schedule.timezone ?? "UTC",
            });
            nextRunAt = interval.next().toISOString();
          } catch {
            /* invalid cron -- skip */
          }

          // Derive health from last run outcome
          let health: "healthy" | "failed" | "missed" = "healthy";
          if (
            state?.lastRunOutcome === "failed" ||
            state?.lastRunOutcome === "cancelled"
          ) {
            health = "failed";
          }

          result.push({
            agentId: agent.id,
            agentName: agent.name,
            scheduleName: schedule.name,
            cron: schedule.cron,
            timezone: schedule.timezone ?? "UTC",
            nextRunAt,
            lastRunAt: state?.lastRunAt?.toISOString() ?? null,
            lastRunOutcome: state?.lastRunOutcome ?? null,
            lastRunConversationId: state?.lastRunConversationId ?? null,
            runCount: state?.runCount ?? 0,
            health,
          });
        }
      }

      res.json(result);
    } catch (error) {
      logger.error({ err: error }, "GET /api/schedules/states failed");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/:agentId/:scheduleName/trigger", async (req, res) => {
    const { agentId, scheduleName } = req.params;
    const { force } = (req.body as { force?: boolean }) ?? {};

    try {
      // 1. Validate agent exists and has this schedule
      const agent = await agentRegistry.get(agentId);
      if (!agent) {
        res.status(404).json({ error: `Agent not found: ${agentId}` });
        return;
      }

      const schedule = agent.schedules?.find((s) => s.name === scheduleName);
      if (!schedule) {
        res.status(404).json({
          error: `Schedule not found: ${scheduleName} on agent ${agentId}`,
        });
        return;
      }

      // 2. Check for overlap (skip policy) unless force is set
      if (!force) {
        const correlationKey = `${agentId}:${scheduleName}`;
        const result = await pool.query(
          `SELECT id, status FROM agents.conversations
           WHERE agent_definition_id = $1
             AND id LIKE $2
             AND status IN ('queued', 'running', 'waiting')
           LIMIT 1`,
          [agentId, `${agentId}-${correlationKey}%`],
        );
        if (result.rows.length > 0) {
          const activeConv = result.rows[0] as { id: string; status: string };
          res.status(409).json({
            skipped: true,
            reason: "Previous run still active",
            activeConversationId: activeConv.id,
            activeStatus: activeConv.status,
          });
          return;
        }
      }

      // 3. Build correlationKey -- force uses timestamp suffix to bypass idempotency
      const correlationKey = force
        ? `${agentId}:${scheduleName}:${Date.now()}`
        : `${agentId}:${scheduleName}`;

      // 4. Build schedule context
      const context = await scheduleRegistry.buildScheduleContext(
        agentId,
        scheduleName,
        "manual",
      );

      // 5. Create synthetic event and route through EventRouter
      const syntheticEvent = {
        type: "schedule.triggered" as const,
        source: "scheduler" as const,
        correlationKey,
        data: {
          agentId,
          scheduleName,
          cron: schedule.cron,
          trigger: "manual" as const,
        },
        message: `${context}\n\nManual trigger: ${scheduleName}`,
      };

      const decision = eventRouter.handle(syntheticEvent);
      if (decision.action === "start") {
        await executor.start({
          agentDefinitionId: decision.agentDefinitionId,
          correlationKey: decision.correlationKey,
          initialMessage: decision.message,
        });
      }

      logger.info(
        { agentId, scheduleName, force: !!force, correlationKey },
        "Manual schedule trigger fired",
      );

      res.json({
        triggered: true,
        correlationKey,
        force: !!force,
      });
    } catch (error) {
      logger.error(
        { err: error, agentId, scheduleName },
        "Manual schedule trigger failed",
      );
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}
