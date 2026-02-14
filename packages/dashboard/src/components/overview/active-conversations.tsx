import Link from "next/link";

import { StatusBadge } from "@/components/conversations/status-badge";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDuration, formatEventType } from "@/lib/format";
import type { ActiveConversation as ActiveConversationType } from "@/services/overview";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ActiveConversationsProps {
  conversations: ActiveConversationType[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ONE_HOUR_MS = 3_600_000;

// ─── Component ───────────────────────────────────────────────────────────────

export function ActiveConversations({
  conversations,
}: ActiveConversationsProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Active Conversations</CardTitle>
      </CardHeader>
      <CardContent>
        {conversations.length === 0 ? (
          <div className="flex h-[120px] items-center justify-center">
            <p className="text-sm text-muted-foreground">All agents idle</p>
          </div>
        ) : (
          <div className="relative">
            <div className="max-h-[320px] overflow-auto overscroll-y-contain pb-6">
              <table className="w-full caption-bottom text-sm">
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky top-0 z-10 bg-card">
                      Agent
                    </TableHead>
                    <TableHead className="sticky top-0 z-10 bg-card">
                      Status
                    </TableHead>
                    <TableHead className="sticky top-0 z-10 bg-card">
                      Duration
                    </TableHead>
                    <TableHead className="sticky top-0 z-10 bg-card">
                      Last Event
                    </TableHead>
                    <TableHead className="sticky top-0 z-10 bg-card" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {conversations.map((row) => {
                    const now = new Date();
                    const duration = formatDuration(row.createdAt, now);
                    const isLongRunning =
                      now.getTime() - row.createdAt.getTime() > ONE_HOUR_MS;

                    return (
                      <TableRow key={row.id}>
                        <TableCell className="text-sm font-medium">
                          {row.agentDefinitionId}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={row.status} />
                        </TableCell>
                        <TableCell
                          className={`text-sm font-mono tabular-nums ${isLongRunning ? "text-amber-600 dark:text-amber-400" : ""}`}
                        >
                          {duration}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {row.lastEventType
                            ? formatEventType(row.lastEventType)
                            : "-"}
                        </TableCell>
                        <TableCell>
                          <Link
                            href={`/conversations/${row.id}`}
                            className="text-sm text-muted-foreground hover:text-foreground hover:underline"
                          >
                            View
                          </Link>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </table>
            </div>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-card to-transparent" />
          </div>
        )}
      </CardContent>
      {conversations.length >= 10 && (
        <CardFooter>
          <Link
            href="/conversations?status=running,waiting"
            className="text-sm text-muted-foreground hover:text-foreground hover:underline"
          >
            View all active conversations &rarr;
          </Link>
        </CardFooter>
      )}
    </Card>
  );
}
