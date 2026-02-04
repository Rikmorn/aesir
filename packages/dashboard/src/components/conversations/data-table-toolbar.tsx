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

const STATUS_OPTIONS = [
  { value: "queued", label: "Queued" },
  { value: "running", label: "Running" },
  { value: "waiting", label: "Waiting" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
];

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

interface DataTableToolbarProps {
  agentDefinitions: string[];
}

export function DataTableToolbar({ agentDefinitions }: DataTableToolbarProps) {
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
    setFilters({ timeRange: value === "all" ? null : value, page: 1 });
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
      {/* Status filter */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="border-dashed">
            Status
            {statusValues.length > 0 && (
              <>
                <Separator orientation="vertical" className="mx-2 h-4" />
                <Badge
                  variant="secondary"
                  className="rounded-sm px-1 font-normal"
                >
                  {statusValues.length}
                </Badge>
              </>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-48 p-0" align="start">
          <Command>
            <CommandInput placeholder="Filter status..." />
            <CommandList>
              <CommandEmpty>No results.</CommandEmpty>
              <CommandGroup>
                {STATUS_OPTIONS.map((option) => {
                  const isSelected = statusValues.includes(option.value);
                  return (
                    <CommandItem
                      key={option.value}
                      onSelect={() => toggleStatus(option.value)}
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
                      {option.label}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

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
      <Select
        value={filters.timeRange ?? "all"}
        onValueChange={handleTimeRangeChange}
      >
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
