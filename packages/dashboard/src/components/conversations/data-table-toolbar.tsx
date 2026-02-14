"use client";

import { CheckIcon, XIcon } from "lucide-react";
import {
  parseAsArrayOf,
  parseAsBoolean,
  parseAsInteger,
  parseAsString,
  useQueryStates,
} from "nuqs";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

// ─── Status pill config ─────────────────────────────────────────────────────

const STATUS_OPTIONS = [
  { value: "running", label: "Running" },
  { value: "waiting", label: "Waiting" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
  { value: "queued", label: "Queued" },
] as const;

const STATUS_PILL_STYLES: Record<string, { active: string; dot: string }> = {
  running: {
    active: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-400",
    dot: "bg-indigo-500",
  },
  waiting: {
    active: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    dot: "bg-amber-500",
  },
  completed: {
    active: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    dot: "bg-emerald-500",
  },
  failed: {
    active: "bg-red-500/15 text-red-700 dark:text-red-400",
    dot: "bg-red-500",
  },
  queued: {
    active: "bg-muted text-muted-foreground",
    dot: "bg-muted-foreground",
  },
};

const TIME_RANGE_OPTIONS = [
  { value: "1h", label: "Last hour" },
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "all", label: "All time" },
];

const parsers = {
  page: parseAsInteger.withDefault(1),
  status: parseAsArrayOf(parseAsString, ","),
  agent: parseAsArrayOf(parseAsString, ","),
  timeRange: parseAsString.withDefault("24h"),
  hasErrors: parseAsBoolean,
};

// ─── Component ──────────────────────────────────────────────────────────────

interface DataTableToolbarProps {
  agentDefinitions: string[];
  statusCounts: Record<string, number>;
}

export function DataTableToolbar({
  agentDefinitions,
  statusCounts,
}: DataTableToolbarProps) {
  const [filters, setFilters] = useQueryStates(parsers, { shallow: false });

  const statusValues = filters.status ?? [];
  const agentValues = filters.agent ?? [];
  const hasActiveFilters =
    statusValues.length > 0 ||
    agentValues.length > 0 ||
    filters.hasErrors === true ||
    filters.timeRange !== "24h";

  function toggleStatus(value: string) {
    const current = statusValues;
    const updated = current.includes(value)
      ? current.filter((s) => s !== value)
      : [...current, value];
    setFilters({ status: updated.length > 0 ? updated : null, page: 1 });
  }

  function toggleAgent(value: string) {
    const current = agentValues;
    const updated = current.includes(value)
      ? current.filter((a) => a !== value)
      : [...current, value];
    setFilters({ agent: updated.length > 0 ? updated : null, page: 1 });
  }

  function handleTimeRangeChange(value: string) {
    setFilters({ timeRange: value, page: 1 });
  }

  function toggleHasErrors() {
    setFilters({ hasErrors: filters.hasErrors ? null : true, page: 1 });
  }

  function clearFilters() {
    setFilters({
      status: null,
      agent: null,
      timeRange: "24h",
      hasErrors: null,
      page: 1,
    });
  }

  return (
    <div className="flex items-center gap-2">
      {/* Status toggle pills */}
      <div className="flex gap-1">
        {STATUS_OPTIONS.map((option) => {
          const isSelected = statusValues.includes(option.value);
          const count = statusCounts[option.value] ?? 0;
          const styles = STATUS_PILL_STYLES[option.value];

          return (
            <button
              key={option.value}
              type="button"
              onClick={() => toggleStatus(option.value)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                isSelected && styles
                  ? styles.active
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                count === 0 && !isSelected && "opacity-40",
              )}
            >
              {isSelected && styles && (
                <span
                  className={cn(
                    "h-1.5 w-1.5 shrink-0 rounded-full",
                    styles.dot,
                  )}
                />
              )}
              {option.label}
              {count > 0 && (
                <span className="font-mono tabular-nums">{count}</span>
              )}
            </button>
          );
        })}
      </div>

      <Separator orientation="vertical" className="mx-1 h-5" />

      {/* Agent filter */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="border-dashed">
            Agent
            {agentValues.length > 0 && (
              <>
                <Separator orientation="vertical" className="mx-2 h-4" />
                <Badge
                  variant="secondary"
                  className="rounded-sm px-1 font-normal"
                >
                  {agentValues.length}
                </Badge>
              </>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-48 p-0" align="start">
          <Command>
            <CommandInput placeholder="Filter agent..." />
            <CommandList>
              <CommandEmpty>No agents found.</CommandEmpty>
              <CommandGroup>
                {agentDefinitions.map((agentId) => {
                  const isSelected = agentValues.includes(agentId);
                  return (
                    <CommandItem
                      key={agentId}
                      onSelect={() => toggleAgent(agentId)}
                    >
                      <div
                        className={cn(
                          "mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
                          isSelected
                            ? "bg-primary text-primary-foreground"
                            : "opacity-50 [&_svg]:invisible",
                        )}
                      >
                        <CheckIcon className="h-3 w-3" />
                      </div>
                      {agentId}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/* Time range filter */}
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

      {/* Has errors toggle */}
      <Button
        variant="outline"
        size="sm"
        className={cn(
          "border-dashed",
          filters.hasErrors && "border-destructive text-destructive",
        )}
        onClick={toggleHasErrors}
      >
        Errors only
      </Button>

      {/* Clear filters */}
      {hasActiveFilters && (
        <Button variant="ghost" size="sm" onClick={clearFilters}>
          Clear filters
          <XIcon className="ml-1 h-3 w-3" />
        </Button>
      )}
    </div>
  );
}
