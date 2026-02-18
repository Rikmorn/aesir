import { notFound } from "next/navigation";
import { LiveDetailPanels } from "@/components/conversation-detail/live-detail-panels";
import { estimateCost } from "@/lib/pricing";
import {
  getChildConversations,
  getConversationById,
  getConversationEvents,
} from "@/services/conversations";
import { getRootTaskId } from "@/services/tasks";

// Force dynamic rendering -- queries database on every request
export const dynamic = "force-dynamic";

// ─── Page ───────────────────────────────────────────────────────────────────

interface ConversationDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function ConversationDetailPage({
  params,
}: ConversationDetailPageProps) {
  const { id } = await params;

  const [conversation, events, childConversations] = await Promise.all([
    getConversationById(id),
    getConversationEvents(id),
    getChildConversations(id),
  ]);

  if (!conversation) {
    notFound();
  }

  // Resolve root task ID for "View task tree" cross-link
  const rootTaskId = conversation.taskId
    ? await getRootTaskId(conversation.taskId)
    : null;

  // Compute initial token totals (input/output) from events
  const initialTokenInput = events.reduce(
    (sum, e) => sum + (e.tokenCountInput ?? 0),
    0,
  );
  const initialTokenOutput = events.reduce(
    (sum, e) => sum + (e.tokenCountOutput ?? 0),
    0,
  );

  // Compute initial cost estimate from llm.response events
  const initialCostEstimate = events.reduce((sum, e) => {
    if (e.type === "llm.response") {
      const model =
        typeof (e.payload as Record<string, unknown>).model === "string"
          ? ((e.payload as Record<string, unknown>).model as string)
          : undefined;
      return (
        sum +
        estimateCost(e.tokenCountInput ?? 0, e.tokenCountOutput ?? 0, model)
      );
    }
    return sum;
  }, 0);

  return (
    <div className="flex h-screen flex-col overflow-hidden px-6 pt-6 pb-3">
      <LiveDetailPanels
        conversation={{
          ...conversation,
          createdAt: conversation.createdAt.toISOString(),
          updatedAt: conversation.updatedAt.toISOString(),
          lastEventAt: conversation.lastEventAt?.toISOString() ?? null,
        }}
        initialEvents={events.map((e) => ({
          ...e,
          timestamp: e.timestamp.toISOString(),
        }))}
        childConversations={childConversations.map((c) => ({
          ...c,
          createdAt: c.createdAt.toISOString(),
          updatedAt: c.updatedAt.toISOString(),
        }))}
        rootTaskId={rootTaskId}
        initialTokenInput={initialTokenInput}
        initialTokenOutput={initialTokenOutput}
        initialCostEstimate={initialCostEstimate}
      />
    </div>
  );
}
