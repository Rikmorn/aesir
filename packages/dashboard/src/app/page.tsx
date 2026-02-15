import { LiveOverview } from "@/components/overview/live-overview";
import { fetchToolsHealth, fetchWorkerStatus } from "@/lib/agent-service";
import { getDefaultResolution, getTimeRangeDate } from "@/lib/format";
import {
  getActiveConversations,
  getConversationStatusCounts,
  getIntegrationErrorRates,
  getRecentErrors,
  getTokenUsageBuckets,
} from "@/services/overview";

// Force dynamic rendering -- overview queries the database and agent-service on every request
export const dynamic = "force-dynamic";

interface OverviewPageProps {
  searchParams: Promise<{ timeRange?: string; resolution?: string }>;
}

export default async function OverviewPage({
  searchParams,
}: OverviewPageProps) {
  const params = await searchParams;
  const timeRange = params.timeRange ?? "24h";
  const resolution = params.resolution ?? getDefaultResolution(timeRange);
  const since = getTimeRangeDate(timeRange);

  const [
    statusCounts,
    activeConversations,
    workerStatus,
    recentErrors,
    tokenUsageBuckets,
    integrationErrorRates,
    integrationHealth,
  ] = await Promise.all([
    getConversationStatusCounts(),
    getActiveConversations(),
    fetchWorkerStatus(),
    getRecentErrors(),
    getTokenUsageBuckets(since, resolution),
    getIntegrationErrorRates(since),
    fetchToolsHealth(),
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

  return (
    <div className="p-6">
      <LiveOverview
        initialStatusCounts={statusCounts}
        initialActiveConversations={serializedConversations}
        workerStatus={workerStatus}
        recentErrors={serializedErrors}
        tokenUsageBuckets={tokenUsageBuckets}
        integrationErrorRates={integrationErrorRates}
        integrationHealth={integrationHealth}
        defaultTimeRange={timeRange}
        defaultResolution={resolution}
      />
    </div>
  );
}
