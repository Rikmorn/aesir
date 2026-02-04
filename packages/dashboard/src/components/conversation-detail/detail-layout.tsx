"use client";

import { PanelRightClose, PanelRightOpen } from "lucide-react";
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

  return (
    <div className="space-y-4">
      {/* Toolbar row with sidebar toggle */}
      <div className="flex justify-end">
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

      {/* Three-panel / two-panel grid */}
      <div
        className={cn(
          "grid grid-cols-1 gap-6",
          sidebarOpen
            ? "lg:grid-cols-[1fr,1fr,300px]"
            : "lg:grid-cols-[1fr,1fr]",
        )}
      >
        {/* Timeline panel */}
        <div
          className="overflow-auto rounded-lg border p-4"
          style={{ maxHeight: "80vh" }}
        >
          {timelinePanel}
        </div>

        {/* Messages panel */}
        <div
          className="overflow-auto rounded-lg border p-4"
          style={{ maxHeight: "80vh" }}
        >
          {messagesPanel}
        </div>

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
