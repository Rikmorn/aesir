"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";

import { LiveDuration } from "@/components/conversations/live-duration";
import { StatusBadge } from "@/components/conversations/status-badge";
import {
  formatDuration,
  formatRelativeTime,
  formatTimestamp,
  formatTokenCount,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import type { RecentConversation } from "@/services/agents";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AgentRecentConversationsProps {
  conversations: RecentConversation[];
  agentDefinitionId: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const ACTIVE_STATUSES = new Set(["running", "waiting"]);
const STATUS_DISPLAY_ORDER = ["running", "waiting", "completed", "failed"];

// ─── Component ───────────────────────────────────────────────────────────────

export function AgentRecentConversations({
  conversations,
  agentDefinitionId,
}: AgentRecentConversationsProps) {
  const router = useRouter();

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of conversations) {
      counts[c.status] = (counts[c.status] ?? 0) + 1;
    }
    return counts;
  }, [conversations]);

  return (
    <div className="flex h-full flex-col">
      {conversations.length === 0 ? (
        <div className="flex h-[120px] items-center justify-center">
          <p className="text-sm text-muted-foreground">
            No recent conversations
          </p>
        </div>
      ) : (
        <>
          <div className="mb-2 flex shrink-0 items-center justify-between">
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              {STATUS_DISPLAY_ORDER.filter((s) => statusCounts[s]).map(
                (status) => (
                  <span
                    key={status}
                    className={status === "failed" ? "text-red-400" : undefined}
                  >
                    {statusCounts[status]} {status}
                  </span>
                ),
              )}
            </div>
            <Link
              href={`/conversations?agent=${encodeURIComponent(agentDefinitionId)}`}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              View all conversations &rarr;
            </Link>
          </div>
          <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="sticky top-0 z-10 bg-card px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Status
                  </th>
                  <th className="sticky top-0 z-10 bg-card px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Created
                  </th>
                  <th className="sticky top-0 z-10 bg-card px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Duration
                  </th>
                  <th className="sticky top-0 z-10 bg-card px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Tokens
                  </th>
                  <th className="sticky top-0 z-10 bg-card px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Last Activity
                  </th>
                </tr>
              </thead>
              <tbody className="[&_tr:last-child]:border-0">
                {conversations.map((conversation) => (
                  <tr
                    key={conversation.id}
                    className={cn(
                      "cursor-pointer border-b transition-colors hover:bg-muted/50",
                      conversation.status === "failed" &&
                        "border-l-2 border-l-destructive",
                    )}
                    onClick={() =>
                      router.push(`/conversations/${conversation.id}`)
                    }
                  >
                    <td className="px-4 py-2">
                      <StatusBadge status={conversation.status} />
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {formatTimestamp(conversation.createdAt)}
                    </td>
                    <td className="px-4 py-2 font-mono">
                      {ACTIVE_STATUSES.has(conversation.status) ? (
                        <LiveDuration createdAt={conversation.createdAt} />
                      ) : (
                        formatDuration(
                          conversation.createdAt,
                          conversation.updatedAt,
                        )
                      )}
                    </td>
                    <td className="px-4 py-2 font-mono tabular-nums">
                      {formatTokenCount(
                        conversation.tokenInput + conversation.tokenOutput,
                      )}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {formatRelativeTime(conversation.lastActivity)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
