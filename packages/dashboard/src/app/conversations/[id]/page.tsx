import { notFound } from "next/navigation";
import { LiveDetailPanels } from "@/components/conversation-detail/live-detail-panels";
import { BackToConversations } from "@/components/navigation/back-link";
import {
  getChildConversations,
  getConversationById,
  getConversationEvents,
} from "@/services/conversations";

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

  return (
    <main className="container mx-auto px-4 py-8">
      {/* Header with breadcrumb and title */}
      <div className="mb-6">
        <BackToConversations />
        <h1 className="mt-2 text-2xl font-bold tracking-tight">
          {conversation.agentDefinitionId}
        </h1>
        <p className="font-mono text-sm text-muted-foreground">
          {conversation.id}
        </p>
      </div>

      {/* Live detail panels with SSE real-time updates */}
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
        }))}
      />
    </main>
  );
}
