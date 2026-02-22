"use client";

/**
 * IdentityDocumentCard
 *
 * Collapsible card for a single identity document. Shows document type,
 * last updated timestamp, character count, and content preview when collapsed.
 * Expanding reveals the full document content and a "History" toggle that
 * renders the IdentityVersionList.
 *
 * Follows the card pattern from agent-schedule-panel.tsx.
 */

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { IdentityDocumentSummary } from "@/services/agents";
import { IdentityVersionList } from "./identity-version-list";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDocumentType(type: string): string {
  return type
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

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

function getContentPreview(content: string, maxLines = 3): string {
  const lines = content.split("\n").slice(0, maxLines);
  const preview = lines.join("\n");
  if (content.split("\n").length > maxLines || preview.length > 200) {
    return `${preview.slice(0, 200)}...`;
  }
  return preview;
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface IdentityDocumentCardProps {
  document: IdentityDocumentSummary;
  agentId: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function IdentityDocumentCard({
  document: doc,
  agentId,
}: IdentityDocumentCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  return (
    <div className="rounded-lg border bg-card">
      {/* Collapsed header -- always visible */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-start justify-between p-3 text-left"
      >
        <div className="min-w-0 flex-1 space-y-1">
          {/* Title row: document type + metadata */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">
              {formatDocumentType(doc.documentType)}
            </span>
            <span className="font-mono text-[10px] text-muted-foreground">
              v{doc.version}
            </span>
          </div>

          {/* Metadata: timestamp + char count */}
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <span>{formatTimeAgo(doc.updatedAt)}</span>
            <span className="text-border">&middot;</span>
            <span className="font-mono tabular-nums">
              {doc.charCount.toLocaleString()} chars
            </span>
          </div>

          {/* Content preview (collapsed only) */}
          {!expanded && (
            <p className="truncate text-xs text-muted-foreground/70">
              {getContentPreview(doc.content, 1)}
            </p>
          )}
        </div>

        {/* Chevron */}
        <span
          className={cn(
            "ml-2 mt-0.5 text-xs text-muted-foreground transition-transform",
            expanded && "rotate-180",
          )}
        >
          &#x25BE;
        </span>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="space-y-3 border-t px-3 pb-3 pt-2">
          {/* Full content */}
          <pre className="whitespace-pre-wrap text-xs leading-relaxed text-foreground/80">
            {doc.content}
          </pre>

          {/* History toggle */}
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setShowHistory(!showHistory)}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                "hover:bg-muted/50 hover:text-foreground",
                showHistory && "bg-muted/30 text-foreground",
              )}
            >
              {showHistory ? "Hide History" : "History"}
            </button>

            {showHistory && (
              <IdentityVersionList
                agentId={agentId}
                documentType={doc.documentType}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
