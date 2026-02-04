import Link from "next/link";
import { notFound } from "next/navigation";

import { LiveDetailPanels } from "@/components/conversation-detail/live-detail-panels";
import {
  getChildConversations,
  getConversationById,
  getConversationEvents,
  getConversationMessages,
} from "@/services/conversations";

// ─── Page ───────────────────────────────────────────────────────────────────

interface ConversationDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function ConversationDetailPage({
  params,
}: ConversationDetailPageProps) {
  const { id } = await params;

  const [conversation, events, messages, childConversations] =
    await Promise.all([
      getConversationById(id),
      getConversationEvents(id),
      getConversationMessages(id),
      getChildConversations(id),
    ]);

  if (!conversation) {
    notFound();
  }

  return (
    <main className="container mx-auto px-4 py-8">
      {/* Header with breadcrumb and title */}
      <div className="mb-6">
        <Link
          href="/conversations"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          &larr; Back to Conversations
        </Link>
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
        initialMessages={messages}
        childConversations={childConversations.map((c) => ({
          ...c,
          createdAt: c.createdAt.toISOString(),
        }))}
      />
    </main>
  );
}
