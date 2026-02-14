"use client";

import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ─── DetailLayout ───────────────────────────────────────────────────────────

interface DetailLayoutProps {
  /** Header content rendered outside the scroll area (title + event count) */
  timelineHeader: React.ReactNode;
  /** Scrollable timeline content */
  timelinePanel: React.ReactNode;
  /** Sidebar content */
  sidebarPanel: React.ReactNode;
}

export function DetailLayout({
  timelineHeader,
  timelinePanel,
  sidebarPanel,
}: DetailLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-4",
        sidebarOpen ? "lg:grid-cols-[1fr_280px]" : "lg:grid-cols-[1fr]",
      )}
    >
      {/* Timeline panel */}
      <div className="flex max-h-[80vh] flex-col rounded-lg border bg-card">
        {/* Header — pinned outside scroll */}
        <div className="flex shrink-0 items-center justify-between border-b px-4 py-3">
          <div>{timelineHeader}</div>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => setSidebarOpen((prev) => !prev)}
            aria-label="Toggle metadata sidebar"
          >
            {sidebarOpen ? (
              <PanelRightClose className="h-4 w-4" />
            ) : (
              <PanelRightOpen className="h-4 w-4" />
            )}
          </Button>
        </div>

        {/* Scrollable content area */}
        <div className="min-h-0 flex-1">{timelinePanel}</div>
      </div>

      {/* Sidebar panel */}
      {sidebarOpen && (
        <div className="max-h-[80vh] overflow-auto rounded-lg border bg-card p-4">
          {sidebarPanel}
        </div>
      )}
    </div>
  );
}
