import { GitBranch } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LiveDetailPanels } from "@/components/conversation-detail/live-detail-panels";
import { BackToConversations } from "@/components/navigation/back-link";
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

  return (
    <div className="px-6 py-6">
      <div className="mb-5">
        <BackToConversations />
        <h1 className="mt-2 text-lg font-semibold tracking-tight">
          {conversation.agentDefinitionId}
        </h1>
        <div className="flex items-center gap-3">
          <p className="font-mono text-xs text-muted-foreground">
            {conversation.id}
          </p>
          {rootTaskId && (
            <Link
              href={`/tasks/${rootTaskId}`}
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              <GitBranch className="h-3.5 w-3.5" />
              View task tree
            </Link>
          )}
        </div>
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
    </div>
  );
}
