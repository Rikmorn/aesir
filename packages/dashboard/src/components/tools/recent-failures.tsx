"use client";

import { ChevronDownIcon } from "lucide-react";
import Link from "next/link";
import { parseAsInteger, parseAsString, useQueryStates } from "nuqs";

import { JsonPayload } from "@/components/conversation-detail/json-payload";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { formatDurationMs, formatRelativeTime } from "@/lib/format";
import type { ToolFailure, ToolRegistryItem } from "@/services/tools";

// ─── Types ──────────────────────────────────────────────────────────────────

interface RecentFailuresProps {
  failures: ToolFailure[];
  total: number;
  toolRegistry: ToolRegistryItem[];
  agentIds: string[];
  defaultTimeRange: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const PAGE_SIZE = 25;
const ALL_VALUE = "__all__";

const TIME_RANGE_OPTIONS = [
  { value: "1h", label: "Last hour" },
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
];

// ─── Component ──────────────────────────────────────────────────────────────

export function RecentFailures({
  failures,
  total,
  toolRegistry,
  agentIds,
  defaultTimeRange,
}: RecentFailuresProps) {
  const [filters, setFilters] = useQueryStates(
    {
      failurePage: parseAsInteger.withDefault(1),
      failureNamespace: parseAsString,
      failureAgent: parseAsString,
      timeRange: parseAsString.withDefault(defaultTimeRange),
    },
    { shallow: false },
  );

  const page = filters.failurePage;
  const startItem = (page - 1) * PAGE_SIZE + 1;
  const endItem = Math.min(page * PAGE_SIZE, total);
  const totalPages = Math.ceil(total / PAGE_SIZE);

  // Derive unique namespaces from tool registry
  const namespaces = Array.from(
    new Set(toolRegistry.map((t) => t.namespace)),
  ).sort();

  function handleNamespaceChange(value: string) {
    setFilters({
      failureNamespace: value === ALL_VALUE ? null : value,
      failurePage: 1,
    });
  }

  function handleAgentChange(value: string) {
    setFilters({
      failureAgent: value === ALL_VALUE ? null : value,
      failurePage: 1,
    });
  }

  function handleTimeRangeChange(value: string) {
    setFilters({
      timeRange: value,
      failurePage: 1,
    });
  }

  function handlePreviousPage() {
    if (page > 1) {
      setFilters({ failurePage: page - 1 });
    }
  }

  function handleNextPage() {
    if (page < totalPages) {
      setFilters({ failurePage: page + 1 });
    }
  }

  // Empty state
  if (failures.length === 0 && total === 0) {
    return (
      <div className="flex h-[300px] items-center justify-center rounded-lg border border-dashed">
        <p className="text-sm text-muted-foreground">
          No tool failures recorded
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filter Bar */}
      <div className="flex items-center gap-2">
        {/* Namespace Filter */}
        <Select
          value={filters.failureNamespace ?? ALL_VALUE}
          onValueChange={handleNamespaceChange}
        >
          <SelectTrigger size="sm" className="w-auto">
            <SelectValue placeholder="Namespace" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_VALUE}>All namespaces</SelectItem>
            {namespaces.map((ns) => (
              <SelectItem key={ns} value={ns}>
                {ns}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Agent Filter */}
        <Select
          value={filters.failureAgent ?? ALL_VALUE}
          onValueChange={handleAgentChange}
        >
          <SelectTrigger size="sm" className="w-auto">
            <SelectValue placeholder="Agent" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_VALUE}>All agents</SelectItem>
            {agentIds.map((agentId) => (
              <SelectItem key={agentId} value={agentId}>
                {agentId}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex-1" />

        {/* Time Range Filter */}
        <Select value={filters.timeRange} onValueChange={handleTimeRangeChange}>
          <SelectTrigger size="sm" className="w-auto">
            <SelectValue placeholder="Time range" />
          </SelectTrigger>
          <SelectContent>
            {TIME_RANGE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Failure Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-20">Timestamp</TableHead>
              <TableHead className="w-44">Tool</TableHead>
              <TableHead className="w-24">Agent</TableHead>
              <TableHead className="w-20">Duration</TableHead>
              <TableHead>Error</TableHead>
              <TableHead className="w-52">Conversation</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {failures.map((failure) => (
              <FailureRow key={failure.id} failure={failure} />
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {total > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {startItem}-{endItem} of {total} failures
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePreviousPage}
              disabled={page <= 1}
            >
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={handleNextPage}
              disabled={page >= totalPages}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Failure Row ────────────────────────────────────────────────────────────

function FailureRow({ failure }: { failure: ToolFailure }) {
  // Derive namespace from tool name by looking at common patterns
  // Tool names like "get_issue" don't include namespace, but we show what we have
  const toolNameParts = failure.toolName.split(":");
  const hasNamespace = toolNameParts.length > 1;
  const namespace = hasNamespace ? toolNameParts[0] : undefined;
  const displayName = hasNamespace
    ? toolNameParts[toolNameParts.length - 1]
    : failure.toolName;

  // Try to parse error as JSON for JsonPayload display
  const isJsonError = isJsonString(failure.errorOutput);
  const truncatedError =
    failure.errorOutput.length > 100
      ? `${failure.errorOutput.slice(0, 100)}...`
      : failure.errorOutput;

  return (
    <TableRow>
      {/* Timestamp */}
      <TableCell>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-default text-sm">
                {formatRelativeTime(failure.timestamp)}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {failure.timestamp.toLocaleString()}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </TableCell>

      {/* Tool */}
      <TableCell>
        <div className="flex items-center gap-1.5">
          {namespace && (
            <Badge variant="outline" className="text-[10px]">
              {namespace}
            </Badge>
          )}
          <code className="text-xs">{displayName}</code>
        </div>
      </TableCell>

      {/* Agent */}
      <TableCell>
        <span className="text-sm">{failure.agentDefinitionId}</span>
      </TableCell>

      {/* Duration */}
      <TableCell>
        <span className="text-sm font-mono">
          {formatDurationMs(failure.durationMs)}
        </span>
      </TableCell>

      {/* Error */}
      <TableCell className="max-w-[200px] overflow-hidden">
        {failure.errorOutput.length > 100 ? (
          <Collapsible>
            <CollapsibleTrigger className="flex w-full items-center gap-1 text-left text-xs text-muted-foreground hover:text-foreground">
              <span className="min-w-0 flex-1 truncate">{truncatedError}</span>
              <ChevronDownIcon className="h-3 w-3 shrink-0" />
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2">
              {isJsonError ? (
                <JsonPayload
                  data={JSON.parse(failure.errorOutput)}
                  maxHeight="200px"
                />
              ) : (
                <pre
                  className="overflow-auto rounded-md border bg-muted/50 p-3 font-mono text-xs whitespace-pre-wrap"
                  style={{ maxHeight: "200px" }}
                >
                  {failure.errorOutput}
                </pre>
              )}
            </CollapsibleContent>
          </Collapsible>
        ) : (
          <span className="block truncate text-xs text-muted-foreground">
            {failure.errorOutput || "-"}
          </span>
        )}
      </TableCell>

      {/* Conversation Link */}
      <TableCell className="max-w-0">
        <Link
          href={`/conversations/${failure.conversationId}`}
          className="block truncate text-sm text-primary hover:underline"
        >
          {failure.conversationId}
        </Link>
      </TableCell>
    </TableRow>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function isJsonString(str: string): boolean {
  try {
    const parsed = JSON.parse(str);
    return typeof parsed === "object" && parsed !== null;
  } catch {
    return false;
  }
}
