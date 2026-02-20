/**
 * LinearMaterializationAdapter
 *
 * Creates Linear issues from delegated tasks and syncs status changes.
 * Implements the MaterializationAdapter interface for the "linear" target.
 *
 * Key behaviors:
 * - create() builds an issue description, resolves priority/labels/team, creates via MCP, records correlation
 * - syncStatus() maps internal terminal statuses to Linear state types and updates via MCP
 * - handleWebhook() translates Linear events into domain signals for the owning conversation
 * - All operations are gracefully degradable (errors logged, never thrown to callers)
 *
 * Architecture boundary: all Linear API calls go through callMcpTool (MCP HTTP protocol).
 */

import type { PinoLogger } from "@aesir/platform";
import { eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as agentsSchemaModule from "../../db/schema.js";
import { materializationRecords } from "../../db/schema.js";
import { callMcpTool } from "../../mcp/index.js";
import type { CorrelationService } from "../correlation-service.js";
import type {
  MaterializationAdapter,
  MaterializationCreateParams,
  MaterializationCreateResult,
  MaterializationSyncStatusParams,
  MaterializationWebhookParams,
  MaterializationWebhookResult,
} from "./types.js";

// ─── Options ──────────────────────────────────────────────────────────────────

export interface LinearMaterializationAdapterOptions {
  db: NodePgDatabase<typeof agentsSchemaModule>;
  logger: PinoLogger;
  /** Default Linear team ID (fallback when no explicit teamId or parent issue) */
  linearTeamId: string;
  /** Dashboard base URL for issue description links */
  dashboardBaseUrl: string;
  /** CorrelationService for registering work correlations on materialized issues */
  correlationService: CorrelationService;
}

// ─── Priority Mapping ─────────────────────────────────────────────────────────

const PRIORITY_MAP: Record<string, number> = {
  urgent: 1,
  high: 2,
  medium: 3,
  low: 4,
  none: 0,
};

// ─── Internal Status to Linear State Type ─────────────────────────────────────

const STATUS_TO_STATE_TYPE: Record<string, string> = {
  active: "started",
  completed: "completed",
  cancelled: "canceled",
};

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createLinearMaterializationAdapter(
  options: LinearMaterializationAdapterOptions,
): MaterializationAdapter {
  const {
    db,
    logger: parentLogger,
    linearTeamId,
    dashboardBaseUrl,
    correlationService,
  } = options;

  if (!db) throw new Error("db is required for LinearMaterializationAdapter");
  if (!parentLogger)
    throw new Error("logger is required for LinearMaterializationAdapter");
  if (!linearTeamId)
    throw new Error(
      "linearTeamId is required for LinearMaterializationAdapter",
    );
  if (!dashboardBaseUrl)
    throw new Error(
      "dashboardBaseUrl is required for LinearMaterializationAdapter",
    );
  if (!correlationService)
    throw new Error(
      "correlationService is required for LinearMaterializationAdapter",
    );

  const logger = parentLogger.child({
    component: "linear-materialization-adapter",
  });

  // Cached agent-work label ID (resolved lazily on first create())
  let agentWorkLabelId: string | null = null;
  let labelResolved = false;

  /**
   * Resolve the "agent-work" label ID. Called once on first create().
   * Caches for the adapter's lifetime. Returns null if label not found.
   */
  async function resolveAgentWorkLabel(): Promise<string | null> {
    if (labelResolved) return agentWorkLabelId;

    try {
      const result = await callMcpTool<{
        labels?: Array<{ id: string; name: string }>;
      }>({
        integration: "linear",
        tool: "list_labels",
        params: { teamId: linearTeamId },
        agentId: "system",
        correlationId: "materialization-init",
      });

      const labels = result?.labels ?? [];
      const agentWorkLabel = labels.find(
        (l) => l.name.toLowerCase() === "agent-work",
      );

      if (agentWorkLabel) {
        agentWorkLabelId = agentWorkLabel.id;
        logger.info(
          { labelId: agentWorkLabelId },
          "Resolved agent-work label ID",
        );
      } else {
        logger.warn(
          "agent-work label not found in team labels; proceeding without it",
        );
      }
    } catch (err) {
      logger.warn(
        { err },
        "Failed to resolve agent-work label; proceeding without it",
      );
    }

    labelResolved = true;
    return agentWorkLabelId;
  }

  /**
   * Build a human-readable issue description from materialization params.
   */
  function buildDescription(params: MaterializationCreateParams): string {
    const lines: string[] = [];
    lines.push(params.description);
    lines.push("");
    lines.push(`Delegated by ${params.agentId}`);
    lines.push(
      `[View in Dashboard](${dashboardBaseUrl}/conversations/${params.conversationId})`,
    );
    return lines.join("\n");
  }

  /**
   * Resolve team ID using the resolution chain:
   * 1. Explicit teamId from properties
   * 2. Parent issue's team (if parentIssueId provided)
   * 3. Default linearTeamId fallback
   */
  async function resolveTeamId(
    params: MaterializationCreateParams,
  ): Promise<string> {
    // 1. Explicit override
    if (params.properties?.teamId) {
      logger.debug(
        { teamId: params.properties.teamId },
        "Using explicit teamId from properties",
      );
      return params.properties.teamId;
    }

    // 2. Parent issue's team
    if (params.parentIssueId) {
      try {
        const parentIssue = await callMcpTool<{
          team?: { id: string };
        }>({
          integration: "linear",
          tool: "get_issue",
          params: { issueId: params.parentIssueId },
          agentId: params.agentId,
          correlationId: params.correlationId,
        });

        if (parentIssue?.team?.id) {
          logger.debug(
            {
              teamId: parentIssue.team.id,
              parentIssueId: params.parentIssueId,
            },
            "Using parent issue team for materialization",
          );
          return parentIssue.team.id;
        }
      } catch (err) {
        logger.warn(
          { err, parentIssueId: params.parentIssueId },
          "Failed to resolve parent issue team; falling back to default",
        );
      }
    }

    // 3. Default fallback
    logger.debug(
      { teamId: linearTeamId },
      "Using default linearTeamId for materialization",
    );
    return linearTeamId;
  }

  return {
    async create(
      params: MaterializationCreateParams,
    ): Promise<MaterializationCreateResult | null> {
      try {
        // 1. Resolve agent-work label (lazy, cached)
        await resolveAgentWorkLabel();

        // 2. Build description
        const description = buildDescription(params);

        // 3. Map priority
        const priority =
          PRIORITY_MAP[params.properties?.priority ?? "none"] ?? 0;

        // 4. Build label IDs
        const labelIds: string[] = [];
        if (agentWorkLabelId) {
          labelIds.push(agentWorkLabelId);
        }
        if (params.properties?.labels) {
          labelIds.push(...params.properties.labels);
        }

        // 5. Resolve team ID
        const teamId = await resolveTeamId(params);

        // 6. Create issue via MCP
        const title = params.description.slice(0, 100);
        const createParams: Record<string, unknown> = {
          teamId,
          title,
          description,
          priority,
          labelIds,
        };
        if (params.parentIssueId) {
          createParams.parentId = params.parentIssueId;
        }

        const result = await callMcpTool<{
          id: string;
          identifier: string;
          url: string;
        }>({
          integration: "linear",
          tool: "create_issue",
          params: createParams,
          agentId: params.agentId,
          correlationId: params.correlationId,
        });

        const issueId = result.id;
        const issueUrl = result.url;

        logger.info(
          {
            taskId: params.taskId,
            issueId,
            identifier: result.identifier,
            teamId,
            parentIssueId: params.parentIssueId,
          },
          "Materialized Linear issue created",
        );

        // 7. Insert materialization record
        await db.insert(materializationRecords).values({
          task_id: params.taskId,
          target: "linear",
          external_id: issueId,
          external_url: issueUrl,
          conversation_id: params.conversationId,
          agent_id: params.agentId,
          config: params as unknown as Record<string, unknown>,
          sync_status: "active",
        });

        // 7b. Register work correlation (CRITICAL for comment routing)
        await correlationService.register({
          entityType: "linear_issue",
          entityId: issueId,
          conversationId: params.conversationId,
          agentId: params.agentId,
        });

        logger.info(
          {
            taskId: params.taskId,
            issueId,
            conversationId: params.conversationId,
          },
          "Work correlation registered for materialized issue",
        );

        // 8. Return result
        return { externalId: issueId, externalUrl: issueUrl };
      } catch (err) {
        logger.error(
          {
            err,
            taskId: params.taskId,
            conversationId: params.conversationId,
            agentId: params.agentId,
          },
          "Materialization create failed (graceful degradation)",
        );
        return null;
      }
    },

    async syncStatus(params: MaterializationSyncStatusParams): Promise<void> {
      try {
        // 1. Map internal status to Linear state type
        const stateType = STATUS_TO_STATE_TYPE[params.newStatus];
        if (!stateType) {
          logger.debug(
            { newStatus: params.newStatus, taskId: params.taskId },
            "Status not mapped to Linear state type; skipping sync",
          );
          return;
        }

        // 2. Update Linear issue via MCP
        await callMcpTool({
          integration: "linear",
          tool: "update_issue_status",
          params: {
            issueId: params.externalId,
            stateType,
          },
          agentId: "system",
          correlationId: `mat-sync-${params.taskId}`,
        });

        // 3. Update materialization record sync_status
        const isTerminal =
          params.newStatus === "completed" || params.newStatus === "cancelled";
        const newSyncStatus = isTerminal ? "completed" : "active";

        await db
          .update(materializationRecords)
          .set({
            sync_status: newSyncStatus,
            updated_at: sql`NOW()`,
          })
          .where(eq(materializationRecords.task_id, params.taskId));

        logger.info(
          {
            taskId: params.taskId,
            externalId: params.externalId,
            stateType,
            syncStatus: newSyncStatus,
          },
          "Materialization status synced to Linear",
        );
      } catch (err) {
        logger.error(
          {
            err,
            taskId: params.taskId,
            externalId: params.externalId,
            newStatus: params.newStatus,
          },
          "Materialization syncStatus failed (non-fatal)",
        );
      }
    },

    handleWebhook(
      params: MaterializationWebhookParams,
    ): MaterializationWebhookResult | null {
      try {
        // 1. Look up materialization record
        // Note: handleWebhook is synchronous per the interface, so we can't do async DB lookup here.
        // The caller is responsible for looking up the record and passing relevant context in eventData.
        // We expect eventData to contain: taskId, conversationId (resolved by caller from materialization_records)
        const taskId = params.eventData.taskId as string | undefined;
        const conversationId = params.eventData.conversationId as
          | string
          | undefined;

        if (!taskId || !conversationId) {
          logger.debug(
            { externalId: params.externalId, eventType: params.eventType },
            "Webhook missing taskId/conversationId context; ignoring",
          );
          return null;
        }

        // 2. Handle status changes
        if (params.eventType === "status_change") {
          const newStateType = params.eventData.stateType as string | undefined;

          // Canceled in Linear -> task_cancelled signal
          if (newStateType === "canceled" || newStateType === "cancelled") {
            return {
              signalType: "task_cancelled",
              signalData: {
                reason: "Cancelled in Linear by human",
                taskId,
              },
              conversationId,
              deduplicationId: `mat-cancel-${params.externalId}`,
            };
          }

          // Completed in Linear -> informational signal (agent decides)
          if (newStateType === "completed") {
            return {
              signalType: "materialization_status_update",
              signalData: {
                status: "completed",
                reason: "Marked done in Linear by human",
                taskId,
              },
              conversationId,
              deduplicationId: `mat-done-${params.externalId}`,
            };
          }

          // Other status changes -> logged but no signal
          logger.debug(
            { externalId: params.externalId, newStateType },
            "Linear status change not actionable; ignoring",
          );
          return null;
        }

        // 3. Handle assignee changes
        if (params.eventType === "assignee_change") {
          const newAssigneeName = params.eventData.assigneeName as
            | string
            | undefined;
          const isBot = params.eventData.isBot as boolean | undefined;

          // Only treat human reassignment as cancellation
          if (newAssigneeName && !isBot) {
            return {
              signalType: "task_cancelled",
              signalData: {
                reason: `Reassigned to ${newAssigneeName} in Linear`,
                taskId,
              },
              conversationId,
              deduplicationId: `mat-reassign-${params.externalId}`,
            };
          }

          return null;
        }

        // 4. Other events -> no signal
        logger.debug(
          { externalId: params.externalId, eventType: params.eventType },
          "Linear webhook event type not actionable; ignoring",
        );
        return null;
      } catch (err) {
        logger.error(
          {
            err,
            externalId: params.externalId,
            eventType: params.eventType,
          },
          "Materialization handleWebhook failed (non-fatal)",
        );
        return null;
      }
    },
  };
}
