"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

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
import {
  formatDuration,
  formatRelativeTime,
  formatTimestamp,
  formatTokenCount,
} from "@/lib/format";
import type { RecentConversation } from "@/services/agents";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AgentRecentConversationsProps {
  conversations: RecentConversation[];
  agentDefinitionId: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function AgentRecentConversations({
  conversations,
  agentDefinitionId,
}: AgentRecentConversationsProps) {
  const router = useRouter();

  if (conversations.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Recent Conversations</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No recent conversations
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Conversations</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Tokens</TableHead>
              <TableHead>Last Activity</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {conversations.map((conversation) => (
              <TableRow
                key={conversation.id}
                className="cursor-pointer hover:bg-muted/50"
                onClick={() => router.push(`/conversations/${conversation.id}`)}
              >
                <TableCell>
                  <StatusBadge status={conversation.status} />
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {formatTimestamp(conversation.createdAt)}
                </TableCell>
                <TableCell className="text-sm font-mono">
                  {formatDuration(
                    conversation.createdAt,
                    conversation.updatedAt,
                  )}
                </TableCell>
                <TableCell className="text-sm font-mono">
                  {formatTokenCount(
                    conversation.tokenInput + conversation.tokenOutput,
                  )}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {formatRelativeTime(conversation.lastActivity)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
      <CardFooter>
        <Link
          href={`/conversations?agent=${encodeURIComponent(agentDefinitionId)}`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          View all conversations &rarr;
        </Link>
      </CardFooter>
    </Card>
  );
}
