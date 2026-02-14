"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { StatusBadge } from "@/components/conversations/status-badge";
import { Button } from "@/components/ui/button";
import { formatDuration, formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  ChildConversation,
  ConversationDetail,
} from "@/services/conversations";

// ─── MetadataBar ──────────────────────────────────────────────────────────────

interface MetadataBarProps {
  conversation: ConversationDetail;
  childConversations?: ChildConversation[];
}

export function MetadataBar({
  conversation,
  childConversations,
}: MetadataBarProps) {
  const [expanded, setExpanded] = useState(false);

  const hasError =
    conversation.status === "failed" && !!conversation.errorMessage;
  const hasChildren = childConversations && childConversations.length > 0;
  const hasParent = !!conversation.parentConversationId;
  const hasArtifacts =
    conversation.artifacts && Object.keys(conversation.artifacts).length > 0;
  const hasExpandableContent =
    hasError || hasChildren || hasParent || hasArtifacts;

  return (
    <div className="rounded-lg border bg-card">
      {/* Always-visible metrics row */}
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <div className="flex flex-wrap items-start gap-x-6 gap-y-2">
          <MetadataField label="Agent">
            <Link
              href={`/agents/${conversation.agentDefinitionId}`}
              className="text-sm text-primary underline-offset-4 hover:underline"
            >
              {conversation.agentDefinitionId}
            </Link>
          </MetadataField>

          <MetadataField label="Created">
            <TimestampValue date={conversation.createdAt} />
          </MetadataField>

          <MetadataField label="Updated">
            <TimestampValue date={conversation.updatedAt} />
          </MetadataField>

          <MetadataField label="Last Event">
            <TimestampValue date={conversation.lastEventAt} />
          </MetadataField>

          <MetadataField label="Retries">
            <span className="font-mono text-sm tabular-nums">
              {conversation.retryCount}
            </span>
          </MetadataField>

          <MetadataField label="Reopens">
            <span className="font-mono text-sm tabular-nums">
              {conversation.reopenCount}
            </span>
          </MetadataField>
        </div>

        {hasExpandableContent && (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => setExpanded((prev) => !prev)}
            aria-label={expanded ? "Collapse details" : "Expand details"}
          >
            <ChevronDown
              className={cn(
                "h-4 w-4 transition-transform",
                expanded && "rotate-180",
              )}
            />
          </Button>
        )}
      </div>

      {/* Collapsed hints */}
      {!expanded && hasExpandableContent && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-4 py-2 text-xs text-muted-foreground">
          {hasError && (
            <span className="min-w-0 truncate text-red-700 dark:text-red-400">
              {conversation.errorMessage}
            </span>
          )}
          {hasParent && (
            <span>
              Parent:{" "}
              <Link
                href={`/conversations/${conversation.parentConversationId}`}
                className="font-mono text-primary hover:underline"
              >
                {truncateId(conversation.parentConversationId ?? "")}
              </Link>
            </span>
          )}
          {hasChildren && (
            <span>
              {childConversations.length} child
              {childConversations.length > 1 ? "ren" : ""}
            </span>
          )}
          {hasArtifacts && (
            <span>
              {Object.keys(conversation.artifacts).length} artifact
              {Object.keys(conversation.artifacts).length > 1 ? "s" : ""}
            </span>
          )}
        </div>
      )}

      {/* Expanded detail sections */}
      {expanded && (
        <div className="space-y-3 border-t px-4 py-3">
          {/* Error */}
          {hasError && (
            <div>
              <div className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Error
              </div>
              <div className="max-h-[200px] overflow-auto rounded-md border border-red-500/20 bg-red-500/5 px-3 py-2">
                <p className="whitespace-pre-wrap text-sm text-red-700 dark:text-red-400">
                  {conversation.errorMessage}
                </p>
              </div>
            </div>
          )}

          {/* Parent */}
          {hasParent && (
            <div>
              <div className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Parent
              </div>
              <Link
                href={`/conversations/${conversation.parentConversationId}`}
                className="font-mono text-xs text-primary underline-offset-4 hover:underline"
              >
                {truncateId(conversation.parentConversationId ?? "")}
              </Link>
            </div>
          )}

          {/* Children */}
          {hasChildren && (
            <div>
              <div className="mb-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Children
              </div>
              <div className="space-y-1">
                {childConversations.map((child) => {
                  const isTerminal =
                    child.status === "completed" || child.status === "failed";
                  return (
                    <div
                      key={child.id}
                      className="flex items-center justify-between gap-2 rounded border px-2 py-1.5"
                    >
                      <Link
                        href={`/conversations/${child.id}`}
                        className="min-w-0 truncate text-xs text-primary underline-offset-4 hover:underline"
                      >
                        {child.agentDefinitionId}
                      </Link>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {isTerminal && (
                          <span className="font-mono text-xs tabular-nums text-muted-foreground">
                            {formatDuration(child.createdAt, child.updatedAt)}
                          </span>
                        )}
                        <StatusBadge status={child.status} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Artifacts */}
          {hasArtifacts && (
            <div>
              <div className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Artifacts
              </div>
              <div className="space-y-1.5">
                {Object.entries(conversation.artifacts).map(([key, value]) => (
                  <div key={key}>
                    <span className="text-xs text-muted-foreground">{key}</span>
                    {isUrl(value) ? (
                      <a
                        href={value}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block break-all text-xs text-primary underline-offset-4 hover:underline"
                      >
                        {value}
                      </a>
                    ) : (
                      <span className="block break-all text-xs">{value}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── MetadataField ──────────────────────────────────────────────────────────

function MetadataField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

// ─── TimestampValue ─────────────────────────────────────────────────────────

function TimestampValue({ date }: { date: Date | null }) {
  if (!date) {
    return <span className="text-sm text-muted-foreground">-</span>;
  }
  return (
    <span className="cursor-help text-sm" title={date.toISOString()}>
      {formatRelativeTime(date)}
    </span>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function truncateId(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 8)}...${id.slice(-4)}`;
}

function isUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://");
}
