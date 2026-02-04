import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { AgentSummary } from "@/lib/agent-service";
import type { PermissionCell } from "@/services/tools";

// ─── Types ───────────────────────────────────────────────────────────────────

interface PermissionMatrixProps {
  cells: PermissionCell[];
  agents: AgentSummary[];
}

// ─── Component ───────────────────────────────────────────────────────────────

export function PermissionMatrix({ cells, agents }: PermissionMatrixProps) {
  if (cells.length === 0) {
    return (
      <Card>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No MCP tool permissions configured
          </p>
        </CardContent>
      </Card>
    );
  }

  // Extract unique tool refs sorted by namespace then name
  const toolRefs = Array.from(new Set(cells.map((c) => c.toolRef))).sort();

  // Use agent names as columns (ensures consistent ordering from agent definitions)
  const agentIds = agents.map((a) => a.id).sort();

  // Build lookup: "toolRef:agentId" -> PermissionCell
  const cellMap = new Map<string, PermissionCell>();
  for (const cell of cells) {
    cellMap.set(`${cell.toolRef}:${cell.agentId}`, cell);
  }

  // Count mismatches
  const mismatchCount = cells.filter((c) => c.mismatch !== "none").length;

  return (
    <div className="space-y-4">
      {/* Summary */}
      {mismatchCount > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950">
          <span className="text-sm font-medium text-amber-800 dark:text-amber-200">
            {mismatchCount} permission mismatch
            {mismatchCount !== 1 ? "es" : ""} detected
          </span>
          <span className="text-xs text-amber-600 dark:text-amber-400">
            YAML definitions and MCP permissions are out of sync
          </span>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Agent x Tool Permission Matrix</CardTitle>
        </CardHeader>
        <CardContent>
          <TooltipProvider>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[200px]">Tool</TableHead>
                  {agentIds.map((agentId) => (
                    <TableHead key={agentId} className="text-center text-xs">
                      {agentId}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {toolRefs.map((toolRef) => (
                  <TableRow key={toolRef}>
                    <TableCell className="font-mono text-xs">
                      {toolRef}
                    </TableCell>
                    {agentIds.map((agentId) => {
                      const cell = cellMap.get(`${toolRef}:${agentId}`);
                      return (
                        <TableCell
                          key={`${toolRef}:${agentId}`}
                          className="text-center"
                        >
                          <PermissionIndicator cell={cell} />
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TooltipProvider>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Permission Cell Indicator ───────────────────────────────────────────────

function PermissionIndicator({ cell }: { cell: PermissionCell | undefined }) {
  // No relationship
  if (!cell) {
    return <span className="text-muted-foreground">-</span>;
  }

  // Both match (no mismatch)
  if (cell.mismatch === "none") {
    return (
      <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
        <CheckIcon />
      </span>
    );
  }

  // Mismatch - show warning with tooltip
  const tooltipText =
    cell.mismatch === "yaml-only"
      ? "Defined in agent YAML but no MCP permission granted"
      : "MCP permission exists but tool not in agent YAML definition";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400">
          <WarningIcon />
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <p className="max-w-[200px]">
          <Badge
            variant="outline"
            className="mr-1.5 text-[10px] text-amber-700 dark:text-amber-400"
          >
            {cell.mismatch}
          </Badge>
          {tooltipText}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

// ─── Icons ───────────────────────────────────────────────────────────────────

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}
