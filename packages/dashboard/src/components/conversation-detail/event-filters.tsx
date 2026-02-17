"use client";

import { cn } from "@/lib/utils";

import { hashAgentId } from "./event-renderers/sub-agent-pill";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface FilterState {
  failures: boolean;
  lifecycle: boolean;
  toolCalls: boolean;
  llm: boolean;
  subAgents: Record<string, boolean>; // agentDefinitionId -> visible
}

export const DEFAULT_FILTER_STATE: FilterState = {
  failures: true,
  lifecycle: true,
  toolCalls: true,
  llm: true,
  subAgents: {},
};

// ─── Dot Colors ─────────────────────────────────────────────────────────────

/**
 * Solid background colors for filter chip dots, matching AGENT_PILL_COLORS order.
 * Defined statically so Tailwind can scan them at build time.
 */
const AGENT_DOT_COLORS = [
  "bg-violet-500",
  "bg-teal-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-sky-500",
  "bg-emerald-500",
] as const;

// ─── Props ──────────────────────────────────────────────────────────────────

interface EventFiltersProps {
  filters: FilterState;
  onFiltersChange: (filters: FilterState) => void;
  /** Unique sub-agent agentDefinitionIds found in events */
  subAgentIds: string[];
}

// ─── FilterChip ─────────────────────────────────────────────────────────────

interface FilterChipProps {
  label: string;
  active: boolean;
  onClick: () => void;
  /** Optional dot class for sub-agent chips */
  dotClassName?: string;
}

function FilterChip({ label, active, onClick, dotClassName }: FilterChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
        active
          ? "bg-accent text-accent-foreground border-border"
          : "bg-transparent text-muted-foreground border-border/50",
      )}
    >
      {dotClassName && (
        <span
          className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotClassName)}
        />
      )}
      {label}
    </button>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

export function EventFilters({
  filters,
  onFiltersChange,
  subAgentIds,
}: EventFiltersProps) {
  function toggle(key: keyof Omit<FilterState, "subAgents">) {
    onFiltersChange({ ...filters, [key]: !filters[key] });
  }

  function toggleSubAgent(id: string) {
    const current = filters.subAgents[id] !== false; // undefined = true
    onFiltersChange({
      ...filters,
      subAgents: { ...filters.subAgents, [id]: !current },
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <FilterChip
        label="Failures"
        active={filters.failures}
        onClick={() => toggle("failures")}
      />
      <FilterChip
        label="Lifecycle"
        active={filters.lifecycle}
        onClick={() => toggle("lifecycle")}
      />
      <FilterChip
        label="Tool calls"
        active={filters.toolCalls}
        onClick={() => toggle("toolCalls")}
      />
      <FilterChip
        label="LLM"
        active={filters.llm}
        onClick={() => toggle("llm")}
      />
      {subAgentIds.map((id) => {
        const colorIndex = hashAgentId(id);
        const dotColor = AGENT_DOT_COLORS[colorIndex] ?? AGENT_DOT_COLORS[0];
        return (
          <FilterChip
            key={id}
            label={id}
            active={filters.subAgents[id] !== false}
            onClick={() => toggleSubAgent(id)}
            dotClassName={dotColor}
          />
        );
      })}
    </div>
  );
}
