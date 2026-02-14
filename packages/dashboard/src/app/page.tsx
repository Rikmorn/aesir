import { LiveOverview } from "@/components/overview/live-overview";
import { fetchToolRegistry, fetchWorkerStatus } from "@/lib/agent-service";
import { getTimeRangeDate } from "@/lib/format";
import {
  getActiveConversations,
  getConversationStatusCounts,
  getRecentErrors,
  getTokenUsageByAgent,
  getToolActivity,
} from "@/services/overview";

// Force dynamic rendering -- overview queries the database and agent-service on every request
export const dynamic = "force-dynamic";

interface OverviewPageProps {
  searchParams: Promise<{ tokenTimeRange?: string }>;
}

export default async function OverviewPage({
  searchParams,
}: OverviewPageProps) {
  const params = await searchParams;
  const tokenTimeRange = params.tokenTimeRange ?? "24h";
  const tokenSince = getTimeRangeDate(tokenTimeRange);

  const [
    statusCounts,
    activeConversations,
    workerStatus,
    recentErrors,
    tokenUsage,
    toolActivity,
    toolRegistry,
  ] = await Promise.all([
    getConversationStatusCounts(),
    getActiveConversations(),
    fetchWorkerStatus(),
    getRecentErrors(),
    getTokenUsageByAgent(tokenSince),
    getToolActivity(),
    fetchToolRegistry(),
  ]);

  // Serialize Date fields for server/client boundary crossing
  const serializedConversations = activeConversations.map((c) => ({
    ...c,
    createdAt: c.createdAt.toISOString(),
  }));

  const serializedErrors = recentErrors.map((e) => ({
    ...e,
    timestamp: e.timestamp.toISOString(),
  }));

  // Build displayName → "namespace:name" map from the tool registry.
  // MCP tools use "{namespace}_{name}" as display name (e.g., "linear_get_issue").
  // Internal tools use just "{name}" (e.g., "create_task", "read_file").
  const toolRefMap = new Map<string, string>();
  for (const entry of toolRegistry) {
    const ref = `${entry.namespace}:${entry.name}`;
    toolRefMap.set(`${entry.namespace}_${entry.name}`, ref);
    if (!toolRefMap.has(entry.name)) {
      toolRefMap.set(entry.name, ref);
    }
  }

  const enrichedToolActivity = toolActivity.map((item) => ({
    ...item,
    toolRef: toolRefMap.get(item.toolName) ?? null,
  }));

  return (
    <div className="flex h-screen flex-col overflow-hidden px-6 pt-6 pb-3">
      <LiveOverview
        initialStatusCounts={statusCounts}
        initialActiveConversations={serializedConversations}
        workerStatus={workerStatus}
        recentErrors={serializedErrors}
        tokenUsage={tokenUsage}
        defaultTokenTimeRange={tokenTimeRange}
        toolActivity={enrichedToolActivity}
      />
    </div>
  );
}
