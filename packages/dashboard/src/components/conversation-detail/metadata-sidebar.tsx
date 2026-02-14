import Link from "next/link";

import { StatusBadge } from "@/components/conversations/status-badge";
import { formatDuration, formatRelativeTime } from "@/lib/format";
import type {
  ChildConversation,
  ConversationDetail,
} from "@/services/conversations";

// ─── MetadataSidebar ────────────────────────────────────────────────────────

interface MetadataSidebarProps {
  conversation: ConversationDetail;
  childConversations?: ChildConversation[];
}

export function MetadataSidebar({
  conversation,
  childConversations,
}: MetadataSidebarProps) {
  const hasArtifacts =
    conversation.artifacts && Object.keys(conversation.artifacts).length > 0;
  const hasChildren = childConversations && childConversations.length > 0;
  const hasRelationships = !!conversation.parentConversationId || hasChildren;

  return (
    <div>
      {/* Status section */}
      <MetadataSection title="Status">
        <MetadataField label="Status">
          <StatusBadge status={conversation.status} />
        </MetadataField>

        <MetadataField label="Agent">
          <Link
            href={`/agents/${conversation.agentDefinitionId}`}
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            {conversation.agentDefinitionId}
          </Link>
        </MetadataField>

        <div className="flex gap-4">
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

        {conversation.errorMessage && (
          <MetadataField label="Error">
            <span className="text-sm text-destructive">
              {conversation.errorMessage}
            </span>
          </MetadataField>
        )}
      </MetadataSection>

      {/* Relationships section */}
      {hasRelationships && (
        <MetadataSection title="Relationships">
          {conversation.parentConversationId && (
            <MetadataField label="Parent">
              <Link
                href={`/conversations/${conversation.parentConversationId}`}
                className="font-mono text-xs text-primary underline-offset-4 hover:underline"
              >
                {truncateId(conversation.parentConversationId)}
              </Link>
            </MetadataField>
          )}

          {hasChildren && (
            <div>
              <span className="text-xs font-medium text-muted-foreground">
                Children
              </span>
              <div className="mt-1.5 space-y-1">
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
        </MetadataSection>
      )}

      {/* Timing section */}
      <MetadataSection title="Timing">
        <MetadataField label="Created">
          <TimestampValue date={conversation.createdAt} />
        </MetadataField>

        <MetadataField label="Updated">
          <TimestampValue date={conversation.updatedAt} />
        </MetadataField>

        <MetadataField label="Last Event">
          <TimestampValue date={conversation.lastEventAt} />
        </MetadataField>
      </MetadataSection>

      {/* Artifacts section */}
      {hasArtifacts && (
        <MetadataSection title="Artifacts">
          {Object.entries(conversation.artifacts).map(([key, value]) => (
            <div key={key}>
              <span className="text-xs font-medium text-muted-foreground">
                {key}
              </span>
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
        </MetadataSection>
      )}
    </div>
  );
}

// ─── MetadataSection ────────────────────────────────────────────────────────

function MetadataSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-border/50 py-3 first:pt-0 last:border-b-0">
      <div className="mb-2.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      <div className="space-y-2">{children}</div>
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
  if (id.length <= 16) return id;
  return `${id.slice(0, 8)}...${id.slice(-4)}`;
}

function isUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://");
}
