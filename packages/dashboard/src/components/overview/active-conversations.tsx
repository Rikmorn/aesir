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
  Table,
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
          <div className="flex h-[200px] items-center justify-center rounded-lg border border-dashed">
            <p className="text-sm text-muted-foreground">
              No active conversations
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agent</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Last Event</TableHead>
                <TableHead />
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
                      className={`text-sm font-mono ${isLongRunning ? "text-amber-600 dark:text-amber-400" : ""}`}
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
                        className="text-sm text-muted-foreground hover:text-foreground"
                      >
                        View
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {conversations.length >= 10 && (
        <CardFooter>
          <Link
            href="/conversations?status=running,waiting"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            View all active conversations &rarr;
          </Link>
        </CardFooter>
      )}
    </Card>
  );
}
