"use client";

/**
 * IdentityVersionList
 *
 * Paginated version history for a specific identity document type.
 * Fetches versions from the API route on mount, with a "Load more" button
 * for pagination. Each version entry is expandable to show full content.
 *
 * Char deltas are computed client-side by comparing adjacent versions.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { IdentityDocumentVersion } from "@/services/agents";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTimeAgo(isoDate: string): string {
  const now = new Date();
  const target = new Date(isoDate);
  const diffMs = now.getTime() - target.getTime();
  if (diffMs < 0) return "just now";
  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "just now";
}

function formatCharDelta(
  current: IdentityDocumentVersion,
  previous: IdentityDocumentVersion | undefined,
): { text: string; className: string } | null {
  if (!previous) return null;
  const delta = current.charCount - previous.charCount;
  if (delta === 0) return { text: "0", className: "text-muted-foreground" };
  if (delta > 0)
    return {
      text: `+${delta.toLocaleString()}`,
      className: "text-emerald-400",
    };
  return { text: delta.toLocaleString(), className: "text-red-400" };
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface IdentityVersionListProps {
  agentId: string;
  documentType: string;
}

const PAGE_SIZE = 20;

// ─── Component ───────────────────────────────────────────────────────────────

export function IdentityVersionList({
  agentId,
  documentType,
}: IdentityVersionListProps) {
  const [versions, setVersions] = useState<IdentityDocumentVersion[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [expandedVersion, setExpandedVersion] = useState<number | null>(null);

  const fetchVersions = useCallback(
    async (offset: number) => {
      const encodedType = encodeURIComponent(documentType);
      const res = await fetch(
        `/dashboard/api/agents/${agentId}/identity/${encodedType}?limit=${PAGE_SIZE}&offset=${offset}`,
      );
      if (!res.ok) return { versions: [], hasMore: false };
      return res.json() as Promise<{
        versions: IdentityDocumentVersion[];
        hasMore: boolean;
      }>;
    },
    [agentId, documentType],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchVersions(0).then((result) => {
      if (!cancelled) {
        setVersions(result.versions);
        setHasMore(result.hasMore);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [fetchVersions]);

  const handleLoadMore = async () => {
    setLoadingMore(true);
    const result = await fetchVersions(versions.length);
    setVersions((prev) => [...prev, ...result.versions]);
    setHasMore(result.hasMore);
    setLoadingMore(false);
  };

  if (loading) {
    return (
      <div className="py-2 text-xs text-muted-foreground">
        Loading history...
      </div>
    );
  }

  if (versions.length === 0) {
    return (
      <div className="py-2 text-xs text-muted-foreground">
        No version history.
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {versions.map((version, index) => {
        // The next version in the list is the previous chronologically (list is newest-first)
        const previousVersion = versions[index + 1];
        const delta = formatCharDelta(version, previousVersion);
        const isExpanded = expandedVersion === version.version;

        return (
          <div key={version.version} className="rounded-md border bg-card">
            <button
              type="button"
              onClick={() =>
                setExpandedVersion(isExpanded ? null : version.version)
              }
              className="flex w-full items-center gap-3 px-2.5 py-1.5 text-left text-xs"
            >
              {/* Version number */}
              {version.conversationId ? (
                <Link
                  href={`/conversations/${version.conversationId}`}
                  onClick={(e) => e.stopPropagation()}
                  className="font-mono font-medium text-primary hover:underline"
                >
                  v{version.version}
                </Link>
              ) : (
                <span className="font-mono font-medium text-foreground">
                  v{version.version}
                </span>
              )}

              {/* Timestamp */}
              <span className="text-muted-foreground">
                {formatTimeAgo(version.createdAt)}
              </span>

              {/* Char count */}
              <span className="font-mono tabular-nums text-muted-foreground">
                {version.charCount.toLocaleString()}
              </span>

              {/* Char delta */}
              {delta ? (
                <span className={cn("font-mono tabular-nums", delta.className)}>
                  {delta.text}
                </span>
              ) : (
                <span className="font-mono tabular-nums text-muted-foreground">
                  --
                </span>
              )}

              {/* Expand indicator */}
              <span
                className={cn(
                  "ml-auto text-muted-foreground transition-transform",
                  isExpanded && "rotate-180",
                )}
              >
                &#x25BE;
              </span>
            </button>

            {isExpanded && (
              <div className="border-t px-2.5 py-2">
                <pre className="whitespace-pre-wrap text-xs text-foreground/80">
                  {version.content}
                </pre>
              </div>
            )}
          </div>
        );
      })}

      {hasMore && (
        <button
          type="button"
          disabled={loadingMore}
          onClick={handleLoadMore}
          className={cn(
            "w-full rounded-md border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors",
            "hover:bg-muted/50 hover:text-foreground",
            loadingMore && "cursor-not-allowed opacity-50",
          )}
        >
          {loadingMore ? "Loading..." : "Load more"}
        </button>
      )}
    </div>
  );
}
