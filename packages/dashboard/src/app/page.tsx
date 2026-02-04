import { ActiveConversations } from "@/components/overview/active-conversations";
import { RecentErrors } from "@/components/overview/recent-errors";
import { StatCards } from "@/components/overview/stat-cards";
import { TokenUsage } from "@/components/overview/token-usage";
import { WorkerStatus } from "@/components/overview/worker-status";
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

  return (
    <main className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">System Overview</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Real-time pulse check on agent activity, health, and resource usage
        </p>
      </div>

      {/* Content */}
      <div className="space-y-6">
        {/* Status summary cards */}
        <StatCards counts={statusCounts} />

        {/* Active conversations + Worker status */}
        <div className="grid gap-4 lg:grid-cols-2">
          <ActiveConversations conversations={activeConversations} />
          <WorkerStatus status={workerStatus} />
        </div>

        {/* Recent errors + Token usage */}
        <div className="grid gap-4 lg:grid-cols-2">
          <RecentErrors errors={recentErrors} />
          <TokenUsage data={tokenUsage} />
        </div>
      </div>
    </main>
  );
}
