"use client";

import { AlertTriangle, ChevronDown } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { PermissionCell } from "@/services/tools";

// ─── Types ──────────────────────────────────────────────────────────────────

interface PermissionBannerProps {
  cells: PermissionCell[];
}

// ─── Component ──────────────────────────────────────────────────────────────

export function PermissionBanner({ cells }: PermissionBannerProps) {
  const mismatches = cells.filter((c) => c.mismatch !== "none");
  const [isOpen, setIsOpen] = useState(false);

  if (mismatches.length === 0) return null;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-2.5 text-left transition-colors hover:bg-amber-500/10">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
        <span className="text-sm font-medium">
          {mismatches.length} permission mismatch
          {mismatches.length !== 1 ? "es" : ""}
        </span>
        <span className="text-xs text-muted-foreground">
          YAML definitions and MCP permissions are out of sync
        </span>
        <div className="flex-1" />
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            isOpen && "rotate-180",
          )}
        />
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="mt-2 divide-y rounded-lg border">
          {mismatches.map((cell) => (
            <div
              key={`${cell.toolRef}:${cell.agentId}`}
              className="flex items-center gap-3 px-4 py-2"
            >
              <span className="font-mono text-xs">{cell.toolRef}</span>
              <span className="text-xs text-muted-foreground">&rarr;</span>
              <span className="text-sm">{cell.agentId}</span>
              <div className="flex-1" />
              <Badge
                variant="outline"
                className="text-[10px] text-amber-700 dark:text-amber-400"
              >
                {cell.mismatch === "yaml-only"
                  ? "Missing MCP permission"
                  : "Unused MCP permission"}
              </Badge>
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
