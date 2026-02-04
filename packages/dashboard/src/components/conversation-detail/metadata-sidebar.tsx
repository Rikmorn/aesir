import Link from "next/link";

import { StatusBadge } from "@/components/conversations/status-badge";
import { Separator } from "@/components/ui/separator";
import { formatRelativeTime } from "@/lib/format";
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

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Metadata</h2>

      <Separator />

      {/* Status */}
      <MetadataField label="Status">
        <StatusBadge status={conversation.status} />
      </MetadataField>

      {/* Conversation ID */}
      <MetadataField label="Conversation ID">
        <span className="break-all font-mono text-xs">{conversation.id}</span>
      </MetadataField>

      {/* Agent */}
      <MetadataField label="Agent">
        <span className="text-sm">
          {conversation.agentDefinitionId}{" "}
          <span className="text-muted-foreground">
            v{conversation.agentDefinitionVersion}
          </span>
        </span>
      </MetadataField>

      {/* Retries */}
      <MetadataField label="Retries">
        <span className="text-sm">{conversation.retryCount}</span>
      </MetadataField>

      {/* Error */}
      {conversation.errorMessage && (
        <MetadataField label="Error">
          <span className="text-sm text-destructive">
            {conversation.errorMessage}
          </span>
        </MetadataField>
      )}

      <Separator />

      {/* Parent Conversation */}
      {conversation.parentConversationId && (
        <MetadataField label="Parent Conversation">
          <Link
            href={`/conversations/${conversation.parentConversationId}`}
            className="font-mono text-xs text-primary underline-offset-4 hover:underline"
          >
            {truncateId(conversation.parentConversationId)}
          </Link>
        </MetadataField>
      )}

      {/* Child Conversations */}
      {hasChildren && (
        <div className="space-y-2">
          <span className="text-sm font-medium text-muted-foreground">
            Child Conversations
          </span>
          <div className="space-y-2">
            {childConversations.map((child) => (
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
                <StatusBadge status={child.status} />
              </div>
            ))}
          </div>
        </div>
      )}

      {(conversation.parentConversationId || hasChildren) && <Separator />}

      {/* Timestamps */}
      <MetadataField label="Created">
        <span className="text-sm">
          {formatRelativeTime(conversation.createdAt)}
        </span>
      </MetadataField>

      <MetadataField label="Updated">
        <span className="text-sm">
          {formatRelativeTime(conversation.updatedAt)}
        </span>
      </MetadataField>

      <MetadataField label="Last Event">
        <span className="text-sm">
          {formatRelativeTime(conversation.lastEventAt)}
        </span>
      </MetadataField>

      {/* Artifacts */}
      {hasArtifacts && (
        <>
          <Separator />
          <div className="space-y-2">
            <span className="text-sm font-medium text-muted-foreground">
              Artifacts
            </span>
            <div className="space-y-1.5">
              {Object.entries(conversation.artifacts).map(([key, value]) => (
                <div key={key} className="flex flex-col gap-0.5">
                  <span className="text-xs font-medium text-muted-foreground">
                    {key}
                  </span>
                  {isUrl(value) ? (
                    <a
                      href={value}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="break-all text-xs text-primary underline-offset-4 hover:underline"
                    >
                      {value}
                    </a>
                  ) : (
                    <span className="break-all text-xs">{value}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
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
    <div className="flex flex-col gap-1">
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Truncate a conversation ID for display.
 * Shows first 8 and last 4 characters with ellipsis.
 */
function truncateId(id: string): string {
  if (id.length <= 16) return id;
  return `${id.slice(0, 8)}...${id.slice(-4)}`;
}

/**
 * Check if a string looks like a URL.
 */
function isUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://");
}
