import { LiveOverview } from "@/components/overview/live-overview";
import { fetchWorkerStatus } from "@/lib/agent-service";
import {
  getActiveConversations,
  getConversationStatusCounts,
  getRecentErrors,
  getTokenUsageByAgent,
} from "@/services/overview";

// Force dynamic rendering -- overview queries the database and agent-service on every request
export const dynamic = "force-dynamic";

export default async function OverviewPage() {
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
    getTokenUsageByAgent(),
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
    <LiveOverview
      initialStatusCounts={statusCounts}
      initialActiveConversations={serializedConversations}
      workerStatus={workerStatus}
      recentErrors={serializedErrors}
      tokenUsage={tokenUsage}
    />
  );
}
