/**
 * Tools Service
 *
 * Abstracts all tool-related data access behind typed functions.
 * Combines agent-service HTTP API data (tool registry, integration health)
 * with database queries (MCP permissions, tool metrics, failures).
 *
 * This service layer runs server-side only (Next.js server components / API routes).
 * Pattern matches services/conversations.ts and services/agents.ts.
 */

import { and, count, desc, eq, gte, inArray, type SQL, sql } from "drizzle-orm";

import type { AgentSummary } from "@/lib/agent-service";
import {
  fetchToolRegistry,
  fetchToolsHealth,
  type IntegrationHealth,
  type ToolRegistryEntry,
} from "@/lib/agent-service";
import { db } from "@/lib/db";
import {
  agentEvents,
  githubMcpPermissions,
  linearMcpPermissions,
  slackMcpPermissions,
} from "@/lib/schema";

// ─── Re-exports ─────────────────────────────────────────────────────────────

export type { IntegrationHealth, ToolRegistryEntry };

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ToolRegistryItem {
  /** Tool name (e.g., "get_issue") */
  name: string;
  /** Tool namespace (e.g., "linear") */
  namespace: string;
  /** Human-readable description */
  description: string;
  /** JSON Schema of the tool's input parameters */
  inputSchema: Record<string, unknown>;
  /** Agent IDs that reference this tool in their YAML definitions */
  agents: string[];
  /** Total calls in the time range */
  callCount: number;
  /** Total failures in the time range */
  failureCount: number;
  /** Failure rate (failures / calls), 0-1 */
  failureRate: number;
  /** Average latency in milliseconds */
  avgLatencyMs: number;
}

export interface McpPermission {
  /** The agent this permission applies to */
  agentId: string;
  /** The tool name (e.g., "get_issue") */
  toolName: string;
  /** Integration namespace: "linear" | "github" | "slack" */
  namespace: string;
  /** Whether this agent is allowed to use this tool */
  allowed: boolean;
}

export interface PermissionCell {
  /** Agent ID */
  agentId: string;
  /** Full tool reference (e.g., "linear:get_issue") */
  toolRef: string;
  /** Whether the agent YAML references this tool */
  inYaml: boolean;
  /** Whether the MCP permission table allows this tool */
  inMcp: boolean;
  /** Mismatch type: "yaml-only" (in YAML but not MCP), "mcp-only" (in MCP but not YAML), "none" */
  mismatch: "yaml-only" | "mcp-only" | "none";
}

export interface ToolMetrics {
  /** Tool name (e.g., "get_issue") */
  toolName: string;
  /** Total calls */
  callCount: number;
  /** Total failures */
  failureCount: number;
  /** Failure rate (failures / calls), 0-1 */
  failureRate: number;
  /** Average latency in milliseconds */
  avgLatencyMs: number;
  /** Median (50th percentile) latency in milliseconds */
  p50LatencyMs: number;
  /** 95th percentile latency in milliseconds */
  p95LatencyMs: number;
}

export interface ToolMetricTimeSeries {
  /** ISO timestamp for the time bucket */
  bucket: string;
  /** Number of tool calls in this bucket */
  calls: number;
  /** Number of tool failures in this bucket */
  failures: number;
  /** Average latency in milliseconds for this bucket */
  avgLatencyMs: number;
}

export interface ToolFailure {
  /** Event ID */
  id: string;
  /** Conversation that generated this failure */
  conversationId: string;
  /** Agent that was running */
  agentDefinitionId: string;
  /** Tool that failed */
  toolName: string;
  /** Error output from the tool */
  errorOutput: string;
  /** When the failure occurred */
  timestamp: Date;
  /** How long the tool ran before failing (ms) */
  durationMs: number | null;
}

// ─── Tool Registry ──────────────────────────────────────────────────────────

/**
 * Get the full tool registry enriched with agent assignments and usage metrics.
 *
 * Combines three data sources:
 * 1. Tool definitions from the agent-service HTTP API
 * 2. Agent definitions (passed in) to determine which agents use each tool
 * 3. Usage metrics from agent_events for the specified time range
 *
 * @param since - Start of the time range for metrics aggregation (null to skip metrics)
 * @param agents - Agent definitions to cross-reference tool assignments
 * @returns Array of ToolRegistryItem sorted by namespace then name
 */
export async function getToolRegistry(
  since: Date | null,
  agents: AgentSummary[],
): Promise<ToolRegistryItem[]> {
  // Fetch tool definitions and optionally metrics in parallel
  const [registryEntries, metricsRows] = await Promise.all([
    fetchToolRegistry(),
    since ? getToolCallMetrics(since) : Promise.resolve([]),
  ]);

  // Build a lookup from tool_name -> metrics
  const metricsMap = new Map<
    string,
    { calls: number; failures: number; avgLatency: number }
  >();
  for (const row of metricsRows) {
    metricsMap.set(row.toolName, {
      calls: row.callCount,
      failures: row.failureCount,
      avgLatency: row.avgLatencyMs,
    });
  }

  // Build a lookup from "namespace:name" -> agent IDs
  const toolAgentsMap = new Map<string, string[]>();
  for (const agent of agents) {
    for (const toolRef of agent.tools) {
      const existing = toolAgentsMap.get(toolRef) ?? [];
      existing.push(agent.id);
      toolAgentsMap.set(toolRef, existing);
    }
  }

  // Merge all data sources
  const items: ToolRegistryItem[] = registryEntries.map((entry) => {
    const toolRef = `${entry.namespace}:${entry.name}`;
    const metrics = metricsMap.get(entry.name);
    const agentIds = toolAgentsMap.get(toolRef) ?? [];
    const callCount = metrics?.calls ?? 0;
    const failureCount = metrics?.failures ?? 0;

    return {
      name: entry.name,
      namespace: entry.namespace,
      description: entry.description,
      inputSchema: entry.inputSchema,
      agents: agentIds,
      callCount,
      failureCount,
      failureRate: callCount > 0 ? failureCount / callCount : 0,
      avgLatencyMs: metrics?.avgLatency ?? 0,
    };
  });

  // Sort by namespace then name
  items.sort((a, b) => {
    const nsCmp = a.namespace.localeCompare(b.namespace);
    if (nsCmp !== 0) return nsCmp;
    return a.name.localeCompare(b.name);
  });

  return items;
}

// ─── Integration Health ─────────────────────────────────────────────────────

/**
 * Get the health status of all integrations.
 *
 * Delegates to fetchToolsHealth(). Returns empty array if agent-service is unreachable.
 */
export async function getToolsHealth(): Promise<IntegrationHealth[]> {
  return fetchToolsHealth();
}

// ─── MCP Permissions ────────────────────────────────────────────────────────

/**
 * Get all MCP permissions across all three integration schemas.
 *
 * Queries linear.mcp_tool_permissions, github.mcp_tool_permissions,
 * and slack.mcp_tool_permissions, tagging each with its namespace.
 *
 * @returns Combined array of McpPermission from all integrations
 */
export async function getMcpPermissions(): Promise<McpPermission[]> {
  const [linearPerms, githubPerms, slackPerms] = await Promise.all([
    db.select().from(linearMcpPermissions),
    db.select().from(githubMcpPermissions),
    db.select().from(slackMcpPermissions),
  ]);

  const result: McpPermission[] = [];

  for (const row of linearPerms) {
    result.push({
      agentId: row.agent_id,
      toolName: row.tool_name,
      namespace: "linear",
      allowed: row.allowed,
    });
  }

  for (const row of githubPerms) {
    result.push({
      agentId: row.agent_id,
      toolName: row.tool_name,
      namespace: "github",
      allowed: row.allowed,
    });
  }

  for (const row of slackPerms) {
    result.push({
      agentId: row.agent_id,
      toolName: row.tool_name,
      namespace: "slack",
      allowed: row.allowed,
    });
  }

  return result;
}

// ─── Permission Matrix ──────────────────────────────────────────────────────

const MCP_NAMESPACES = ["linear", "github", "slack"];

/**
 * Build a permission matrix cross-referencing agent YAML tools with MCP permissions.
 *
 * Pure function (no DB access). Only applies to MCP-routed namespaces
 * (linear, github, slack). Codebase and coordination tools are excluded.
 *
 * Detects three states per cell:
 * - "none": Tool is in both YAML and MCP (consistent)
 * - "yaml-only": Tool is in YAML but missing MCP permission (agent can't use it)
 * - "mcp-only": MCP permission exists but tool not in YAML (unused permission)
 *
 * @param agents - Agent definitions with tools arrays
 * @param mcpPermissions - All MCP permissions from getMcpPermissions()
 * @returns Array of PermissionCell for rendering the matrix
 */
export function buildPermissionMatrix(
  agents: AgentSummary[],
  mcpPermissions: McpPermission[],
): PermissionCell[] {
  const cells: PermissionCell[] = [];

  // Build a set for fast MCP permission lookup: "namespace:agentId:toolName"
  const permSet = new Set(
    mcpPermissions
      .filter((p) => p.allowed)
      .map((p) => `${p.namespace}:${p.agentId}:${p.toolName}`),
  );

  // Check each agent's YAML tool references against MCP permissions
  for (const agent of agents) {
    for (const toolRef of agent.tools) {
      const colonIdx = toolRef.indexOf(":");
      if (colonIdx === -1) continue;

      const namespace = toolRef.substring(0, colonIdx);
      const toolName = toolRef.substring(colonIdx + 1);

      if (!MCP_NAMESPACES.includes(namespace)) continue;

      const mcpKey = `${namespace}:${agent.id}:${toolName}`;
      const inMcp = permSet.has(mcpKey);

      cells.push({
        agentId: agent.id,
        toolRef,
        inYaml: true,
        inMcp,
        mismatch: inMcp ? "none" : "yaml-only",
      });
    }
  }

  // Check MCP permissions that don't appear in any agent's YAML
  for (const perm of mcpPermissions) {
    if (!perm.allowed) continue;

    const toolRef = `${perm.namespace}:${perm.toolName}`;
    const agent = agents.find((a) => a.id === perm.agentId);

    if (!agent || !agent.tools.includes(toolRef)) {
      cells.push({
        agentId: perm.agentId,
        toolRef,
        inYaml: false,
        inMcp: true,
        mismatch: "mcp-only",
      });
    }
  }

  return cells;
}

// ─── Tool Metrics ───────────────────────────────────────────────────────────

/**
 * Get aggregated tool metrics with percentile latencies.
 *
 * Aggregates from agent_events where type IN ('tool.called', 'tool.succeeded', 'tool.failed')
 * within the specified time range. Uses PostgreSQL PERCENTILE_CONT for p50 and p95.
 *
 * @param since - Start of the time range for aggregation
 * @returns Array of ToolMetrics sorted by callCount DESC
 */
export async function getToolMetrics(since: Date): Promise<ToolMetrics[]> {
  const rows = await db
    .select({
      tool_name: sql<string>`${agentEvents.payload}->>'tool_name'`,
      calls: sql<number>`COUNT(*) FILTER (WHERE ${agentEvents.type} = 'tool.called')`,
      failures: sql<number>`COUNT(*) FILTER (WHERE ${agentEvents.type} = 'tool.failed')`,
      avg_latency: sql<number>`AVG(${agentEvents.duration_ms}) FILTER (WHERE ${agentEvents.type} IN ('tool.succeeded', 'tool.failed'))`,
      p50: sql<number>`PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${agentEvents.duration_ms}) FILTER (WHERE ${agentEvents.type} IN ('tool.succeeded', 'tool.failed'))`,
      p95: sql<number>`PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY ${agentEvents.duration_ms}) FILTER (WHERE ${agentEvents.type} IN ('tool.succeeded', 'tool.failed'))`,
    })
    .from(agentEvents)
    .where(
      and(
        inArray(agentEvents.type, [
          "tool.called",
          "tool.succeeded",
          "tool.failed",
        ]),
        gte(agentEvents.timestamp, since),
      ),
    )
    .groupBy(sql`${agentEvents.payload}->>'tool_name'`);

  return rows
    .map((row) => {
      const callCount = Number(row.calls);
      const failureCount = Number(row.failures);

      return {
        toolName: row.tool_name,
        callCount,
        failureCount,
        failureRate: callCount > 0 ? failureCount / callCount : 0,
        avgLatencyMs: Number(row.avg_latency ?? 0),
        p50LatencyMs: Number(row.p50 ?? 0),
        p95LatencyMs: Number(row.p95 ?? 0),
      };
    })
    .sort((a, b) => b.callCount - a.callCount);
}

// ─── Time Series ────────────────────────────────────────────────────────────

/**
 * Get time-bucketed tool metrics for chart rendering.
 *
 * Aggregates tool events into fixed-size time buckets.
 * Use getTimeBucketSeconds() to determine appropriate bucket size.
 *
 * @param since - Start of the time range
 * @param bucketSeconds - Bucket size in seconds (e.g., 60, 900, 3600)
 * @returns Array of ToolMetricTimeSeries sorted by bucket ASC
 */
export async function getToolMetricTimeSeries(
  since: Date,
  bucketSeconds: number,
): Promise<ToolMetricTimeSeries[]> {
  const rows = await db
    .select({
      bucket:
        sql<string>`to_timestamp(floor(extract(epoch from ${agentEvents.timestamp}) / ${bucketSeconds}) * ${bucketSeconds})`.as(
          "bucket",
        ),
      calls: sql<number>`COUNT(*) FILTER (WHERE ${agentEvents.type} = 'tool.called')`,
      failures: sql<number>`COUNT(*) FILTER (WHERE ${agentEvents.type} = 'tool.failed')`,
      avg_latency: sql<number>`AVG(${agentEvents.duration_ms}) FILTER (WHERE ${agentEvents.type} IN ('tool.succeeded', 'tool.failed'))`,
    })
    .from(agentEvents)
    .where(
      and(
        inArray(agentEvents.type, [
          "tool.called",
          "tool.succeeded",
          "tool.failed",
        ]),
        gte(agentEvents.timestamp, since),
      ),
    )
    .groupBy(sql`bucket`)
    .orderBy(sql`bucket`);

  return rows.map((row) => ({
    bucket: String(row.bucket),
    calls: Number(row.calls),
    failures: Number(row.failures),
    avgLatencyMs: Number(row.avg_latency ?? 0),
  }));
}

/**
 * Get the appropriate time bucket size in seconds for a given time range.
 *
 * Keeps chart density reasonable regardless of range:
 * - 1h: 1-minute buckets (60 data points)
 * - 24h: 15-minute buckets (96 data points)
 * - 7d: 1-hour buckets (168 data points)
 *
 * @param timeRange - Time range string ("1h", "24h", "7d")
 * @returns Bucket size in seconds
 */
export function getTimeBucketSeconds(timeRange: string): number {
  switch (timeRange) {
    case "1h":
      return 60;
    case "24h":
      return 900;
    case "7d":
      return 3600;
    default:
      return 900;
  }
}

// ─── Recent Failures ────────────────────────────────────────────────────────

/**
 * Get recent tool failures with optional filtering and pagination.
 *
 * Queries agent_events where type = 'tool.failed', with optional filters
 * for agent ID and time range. Returns paginated results with total count.
 *
 * @param params - Filter and pagination parameters
 * @returns Paginated ToolFailure items with total count
 */
export async function getRecentToolFailures(params: {
  limit?: number;
  offset?: number;
  toolNames?: string[];
  agentId?: string;
  since?: Date;
}): Promise<{ items: ToolFailure[]; total: number }> {
  const limit = params.limit ?? 25;
  const offset = params.offset ?? 0;

  const conditions: SQL[] = [eq(agentEvents.type, "tool.failed")];

  if (params.since) {
    conditions.push(gte(agentEvents.timestamp, params.since));
  }

  if (params.agentId) {
    conditions.push(eq(agentEvents.agent_definition_id, params.agentId));
  }

  if (params.toolNames && params.toolNames.length > 0) {
    conditions.push(
      inArray(sql`${agentEvents.payload}->>'tool_name'`, params.toolNames),
    );
  }

  const whereClause = and(...conditions);

  // Main query for paginated results
  const rows = await db
    .select({
      id: agentEvents.id,
      conversation_id: agentEvents.conversation_id,
      agent_definition_id: agentEvents.agent_definition_id,
      payload: agentEvents.payload,
      timestamp: agentEvents.timestamp,
      duration_ms: agentEvents.duration_ms,
    })
    .from(agentEvents)
    .where(whereClause)
    .orderBy(desc(agentEvents.timestamp))
    .limit(limit)
    .offset(offset);

  // Separate count query for pagination
  const [countResult] = await db
    .select({ total: count() })
    .from(agentEvents)
    .where(whereClause);

  return {
    items: rows.map((row) => {
      const payload = row.payload as Record<string, unknown>;
      return {
        id: row.id,
        conversationId: row.conversation_id,
        agentDefinitionId: row.agent_definition_id,
        toolName: (payload.tool_name as string) ?? "unknown",
        errorOutput: (payload.output as string) ?? "",
        timestamp: row.timestamp,
        durationMs: row.duration_ms,
      };
    }),
    total: Number(countResult?.total ?? 0),
  };
}

// ─── Internal Helpers ───────────────────────────────────────────────────────

/**
 * Get basic call/failure/latency metrics grouped by tool name.
 * Used internally by getToolRegistry() for enrichment.
 */
async function getToolCallMetrics(since: Date): Promise<
  {
    toolName: string;
    callCount: number;
    failureCount: number;
    avgLatencyMs: number;
  }[]
> {
  const rows = await db
    .select({
      tool_name: sql<string>`${agentEvents.payload}->>'tool_name'`,
      calls: sql<number>`COUNT(*) FILTER (WHERE ${agentEvents.type} = 'tool.called')`,
      failures: sql<number>`COUNT(*) FILTER (WHERE ${agentEvents.type} = 'tool.failed')`,
      avg_latency: sql<number>`AVG(${agentEvents.duration_ms}) FILTER (WHERE ${agentEvents.type} IN ('tool.succeeded', 'tool.failed'))`,
    })
    .from(agentEvents)
    .where(
      and(
        inArray(agentEvents.type, [
          "tool.called",
          "tool.succeeded",
          "tool.failed",
        ]),
        gte(agentEvents.timestamp, since),
      ),
    )
    .groupBy(sql`${agentEvents.payload}->>'tool_name'`);

  return rows.map((row) => ({
    toolName: row.tool_name,
    callCount: Number(row.calls),
    failureCount: Number(row.failures),
    avgLatencyMs: Number(row.avg_latency ?? 0),
  }));
}
