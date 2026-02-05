"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ContentBlock {
  type: string;
  text?: string;
  [key: string]: unknown;
}

interface EventContentDisplayProps {
  eventId: string;
  isExpanded: boolean;
}

type LoadState = "idle" | "loading" | "loaded" | "error";

// ─── EventContentDisplay ─────────────────────────────────────────────────────

/**
 * Lazy-loads and displays LLM response content for an event.
 *
 * Content is fetched on first expand and cached. Renders text blocks
 * with a styled blue left border, similar to the messages panel style.
 * Falls back gracefully for older events without stored content.
 */
export function EventContentDisplay({
  eventId,
  isExpanded,
}: EventContentDisplayProps) {
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [content, setContent] = useState<ContentBlock[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchContent = useCallback(async () => {
    if (loadState !== "idle") return;

    setLoadState("loading");
    try {
      const response = await fetch(`/dashboard/api/events/${eventId}/content`);
      if (!response.ok) {
        throw new Error(`Failed to fetch content: ${response.status}`);
      }
      const data = await response.json();
      setContent(data.content);
      setLoadState("loaded");
    } catch (err) {
      // biome-ignore lint/suspicious/noConsole: no pino logger in dashboard
      console.error("Failed to fetch event content:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
      setLoadState("error");
    }
  }, [eventId, loadState]);

  // Fetch content when expanded for the first time
  useEffect(() => {
    if (isExpanded && loadState === "idle") {
      void fetchContent();
    }
  }, [isExpanded, loadState, fetchContent]);

  // Don't render anything if not expanded
  if (!isExpanded) {
    return null;
  }

  // Loading state
  if (loadState === "loading") {
    return (
      <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Loading content...</span>
      </div>
    );
  }

  // Error state
  if (loadState === "error") {
    return (
      <div className="py-3 text-sm text-destructive">
        Failed to load content: {error}
      </div>
    );
  }

  // No content available (older events)
  if (content === null) {
    return (
      <div className="py-3 text-sm italic text-muted-foreground">
        No content available
      </div>
    );
  }

  // Empty content array
  if (content.length === 0) {
    return (
      <div className="py-3 text-sm italic text-muted-foreground">
        Empty response
      </div>
    );
  }

  // Render content blocks
  // Key uses index + type since content blocks have no stable ID
  return (
    <div className="space-y-3 py-3">
      {content.map((block, index) => (
        <ContentBlockRenderer key={`${index}-${block.type}`} block={block} />
      ))}
    </div>
  );
}

// ─── ContentBlockRenderer ────────────────────────────────────────────────────

interface ContentBlockRendererProps {
  block: ContentBlock;
}

function ContentBlockRenderer({ block }: ContentBlockRendererProps) {
  // Text blocks
  if (block.type === "text" && typeof block.text === "string") {
    return (
      <div
        className={cn(
          "border-l-2 border-l-blue-500 pl-3",
          "whitespace-pre-wrap break-words text-sm",
        )}
      >
        {block.text}
      </div>
    );
  }

  // Tool use blocks (already shown in tool.called events, but display summary)
  if (block.type === "tool_use") {
    return (
      <div className="rounded bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
        <span className="font-medium">Tool call:</span>{" "}
        {typeof block.name === "string" ? block.name : "unknown"}
      </div>
    );
  }

  // Other block types (fallback to JSON display)
  return (
    <pre className="overflow-auto rounded-md border bg-muted/50 p-3 font-mono text-xs">
      <code>{JSON.stringify(block, null, 2)}</code>
    </pre>
  );
}
