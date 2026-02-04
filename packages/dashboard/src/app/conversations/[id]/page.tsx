import Link from "next/link";
import { notFound } from "next/navigation";

import { DetailLayout } from "@/components/conversation-detail/detail-layout";
import { EventTimeline } from "@/components/conversation-detail/event-timeline";
import { MessagePanel } from "@/components/conversation-detail/message-panel";
import { MetadataSidebar } from "@/components/conversation-detail/metadata-sidebar";
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

      {/* Three-panel layout with sidebar toggle */}
      <DetailLayout
        timelinePanel={
          <>
            <h2 className="text-lg font-semibold">Event Timeline</h2>
            <p className="mb-4 text-sm text-muted-foreground">
              {events.length} events
            </p>
            <EventTimeline events={events} />
          </>
        }
        messagesPanel={
          <>
            <h2 className="text-lg font-semibold">Messages</h2>
            <p className="mb-4 text-sm text-muted-foreground">
              {messages.length} messages
            </p>
            <MessagePanel messages={messages} />
          </>
        }
        sidebarPanel={
          <MetadataSidebar
            conversation={conversation}
            childConversations={childConversations}
          />
        }
      />
    </main>
  );
}
