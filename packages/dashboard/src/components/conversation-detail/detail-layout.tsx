"use client";

import { MessageSquare, PanelRightClose, PanelRightOpen } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ─── DetailLayout ───────────────────────────────────────────────────────────

interface DetailLayoutProps {
  timelinePanel: React.ReactNode;
  messagesPanel: React.ReactNode;
  sidebarPanel: React.ReactNode;
}

export function DetailLayout({
  timelinePanel,
  messagesPanel,
  sidebarPanel,
}: DetailLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // Messages panel hidden by default since LLM content is now inline in timeline
  const [messagesOpen, setMessagesOpen] = useState(false);

  // Determine grid layout based on which panels are open
  const getGridCols = () => {
    if (sidebarOpen && messagesOpen) {
      return "lg:grid-cols-[1fr_1fr_300px]";
    }
    if (sidebarOpen) {
      return "lg:grid-cols-[1fr_300px]";
    }
    if (messagesOpen) {
      return "lg:grid-cols-[1fr_1fr]";
    }
    return "lg:grid-cols-[1fr]";
  };

  return (
    <div className="space-y-4">
      {/* Toolbar row with panel toggles */}
      <div className="flex justify-end gap-2">
        <Button
          variant={messagesOpen ? "secondary" : "ghost"}
          size="icon-sm"
          onClick={() => setMessagesOpen((prev) => !prev)}
          aria-label="Toggle messages panel"
          title="Toggle raw messages panel"
        >
          <MessageSquare className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
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

      {/* Dynamic grid layout */}
      <div className={cn("grid grid-cols-1 gap-6", getGridCols())}>
        {/* Timeline panel (always shown) */}
        <div
          className="overflow-auto rounded-lg border p-4"
          style={{ maxHeight: "80vh" }}
        >
          {timelinePanel}
        </div>

        {/* Messages panel (conditionally rendered) */}
        {messagesOpen && (
          <div
            className="overflow-auto rounded-lg border p-4"
            style={{ maxHeight: "80vh" }}
          >
            {messagesPanel}
          </div>
        )}

        {/* Sidebar panel (conditionally rendered) */}
        {sidebarOpen && (
          <div
            className="overflow-auto rounded-lg border p-4"
            style={{ maxHeight: "80vh" }}
          >
            {sidebarPanel}
          </div>
        )}
      </div>
    </div>
  );
}
