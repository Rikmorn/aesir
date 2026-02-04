import { LiveConversationsTable } from "@/components/conversations/live-conversations-table";
import { getTimeRangeDate } from "@/lib/format";
import {
  getDistinctAgentDefinitions,
  listConversations,
} from "@/services/conversations";

interface ConversationsPageProps {
  searchParams: Promise<{
    page?: string;
    status?: string;
    agent?: string;
    timeRange?: string;
    hasErrors?: string;
  }>;
}

export default async function ConversationsPage({
  searchParams,
}: ConversationsPageProps) {
  const params = await searchParams;
  const page = Number(params.page) || 1;
  const pageSize = 25;
  const status = params.status?.split(",").filter(Boolean);
  const agent = params.agent?.split(",").filter(Boolean);
  const timeRange = params.timeRange || "24h";
  const hasErrors = params.hasErrors === "true";

  const timeRangeFilter =
    timeRange && timeRange !== "all"
      ? { from: getTimeRangeDate(timeRange) }
      : undefined;

  const [{ items, total }, agentDefinitions] = await Promise.all([
    listConversations({
      status,
      agentDefinitionId: agent,
      timeRange: timeRangeFilter,
      hasErrors,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    }),
    getDistinctAgentDefinitions(),
  ]);

  return (
    <main className="container mx-auto py-8 px-4">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Conversations</h1>
        <p className="text-muted-foreground">
          Monitor and browse agent conversation history
        </p>
      </div>
      <LiveConversationsTable
        initialData={items}
        total={total}
        page={page}
        pageSize={pageSize}
        agentDefinitions={agentDefinitions}
      />
    </main>
  );
}
