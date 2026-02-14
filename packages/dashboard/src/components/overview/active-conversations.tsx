import { useRouter } from "next/navigation";

import { LiveDuration } from "@/components/conversations/live-duration";
import { StatusBadge } from "@/components/conversations/status-badge";
import { formatEventType } from "@/lib/format";
import type { ActiveConversation as ActiveConversationType } from "@/services/overview";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ActiveConversationsProps {
  conversations: ActiveConversationType[];
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ActiveConversations({
  conversations,
}: ActiveConversationsProps) {
  const router = useRouter();

  return (
    <div className="flex h-full flex-col rounded-lg border bg-card">
      <div className="flex shrink-0 items-center justify-between border-b px-4 py-2.5">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Active Conversations
        </span>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {conversations.length}
        </span>
      </div>

      {conversations.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted-foreground">All agents idle</p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto overscroll-y-contain">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="sticky top-0 z-10 bg-card px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Agent
                </th>
                <th className="sticky top-0 z-10 bg-card px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Status
                </th>
                <th className="sticky top-0 z-10 bg-card px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Duration
                </th>
                <th className="sticky top-0 z-10 bg-card px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Last Event
                </th>
              </tr>
            </thead>
            <tbody className="[&_tr:last-child]:border-0">
              {conversations.map((row) => (
                <tr
                  key={row.id}
                  className="cursor-pointer border-b transition-colors hover:bg-muted/50"
                  onClick={() => router.push(`/conversations/${row.id}`)}
                >
                  <td className="px-4 py-2 font-medium">
                    {row.agentDefinitionId}
                  </td>
                  <td className="px-4 py-2">
                    <StatusBadge status={row.status} />
                  </td>
                  <td className="px-4 py-2">
                    <LiveDuration createdAt={row.createdAt} />
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {row.lastEventType
                      ? formatEventType(row.lastEventType)
                      : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
