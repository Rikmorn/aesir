import { LiveOverview } from "@/components/overview/live-overview";
import { fetchWorkerStatus } from "@/lib/agent-service";
import { getTimeRangeDate } from "@/lib/format";
import {
  getActiveConversations,
  getConversationStatusCounts,
  getRecentErrors,
  getTokenUsageByAgent,
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
  ] = await Promise.all([
    getConversationStatusCounts(),
    getActiveConversations(),
    fetchWorkerStatus(),
    getRecentErrors(),
    getTokenUsageByAgent(tokenSince),
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
    <div className="flex h-screen flex-col overflow-hidden px-6 pt-6 pb-3">
      <LiveOverview
        initialStatusCounts={statusCounts}
        initialActiveConversations={serializedConversations}
        workerStatus={workerStatus}
        recentErrors={serializedErrors}
        tokenUsage={tokenUsage}
        defaultTokenTimeRange={tokenTimeRange}
      />
    </div>
  );
}
