"use client";

import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ─── DetailLayout ───────────────────────────────────────────────────────────

interface DetailLayoutProps {
  timelinePanel: React.ReactNode;
  sidebarPanel: React.ReactNode;
}

export function DetailLayout({
  timelinePanel,
  sidebarPanel,
}: DetailLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div className="space-y-4">
      {/* Toolbar row with panel toggle */}
      <div className="flex justify-end gap-2">
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

      {/* Grid layout: Timeline + optional Sidebar */}
      <div
        className={cn(
          "grid grid-cols-1 gap-6",
          sidebarOpen ? "lg:grid-cols-[1fr_300px]" : "lg:grid-cols-[1fr]",
        )}
      >
        {/* Timeline panel (always shown) */}
        <div
          className="overflow-auto rounded-lg border p-4"
          style={{ maxHeight: "80vh" }}
        >
          {timelinePanel}
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
