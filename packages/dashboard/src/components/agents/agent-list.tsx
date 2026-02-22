"use client";

import { Clock, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import type { AgentSummary } from "@/lib/agent-service";
import { cn } from "@/lib/utils";

import { AgentTypeBadge, getAgentType } from "./agent-type-badge";

// ─── Types ───────────────────────────────────────────────────────────────────

type AgentTypeFilter = "all" | "orchestrator" | "sub-agent";

interface AgentListProps {
  agents: AgentSummary[];
}

// ─── Component ───────────────────────────────────────────────────────────────

export function AgentList({ agents }: AgentListProps) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<AgentTypeFilter>("all");

  const annotated = useMemo(
    () =>
      agents.map((a) => ({
        ...a,
        type: getAgentType(a.triggers, a.tools),
      })),
    [agents],
  );

  const filtered = useMemo(() => {
    let result = annotated;

    if (typeFilter !== "all") {
      result = result.filter((a) => a.type === typeFilter);
    }

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          a.description?.toLowerCase().includes(q) ||
          a.id.toLowerCase().includes(q),
      );
    }

    return [...result].sort((a, b) => {
      if (a.type !== b.type) return a.type === "orchestrator" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [annotated, search, typeFilter]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header */}
      <div className="mb-4 shrink-0">
        <h1 className="text-lg font-semibold tracking-tight">Agents</h1>
      </div>

      {/* Search + Type Filter */}
      <div className="mb-3 flex shrink-0 items-center gap-3">
        <div className="relative max-w-xs flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search agents..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-8"
          />
        </div>
        <div className="flex gap-1">
          {(["all", "orchestrator", "sub-agent"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setTypeFilter(f)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                typeFilter === f
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
              )}
            >
              {f === "all"
                ? "All"
                : f === "orchestrator"
                  ? "Orchestrators"
                  : "Sub-agents"}
            </button>
          ))}
        </div>
      </div>

      {/* Agent List */}
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
        {filtered.length === 0 ? (
          <div className="flex h-[120px] items-center justify-center">
            <p className="text-sm text-muted-foreground">
              {search ? "No agents match your search" : "No agents found"}
            </p>
          </div>
        ) : (
          <div className="divide-y">
            {filtered.map((agent) => {
              const isOrchestrator = agent.type === "orchestrator";
              const subAgentIds = agent.subAgents
                ? [...new Set(Object.values(agent.subAgents))]
                : [];

              return (
                <Link
                  key={agent.id}
                  href={`/agents/${agent.id}`}
                  className={cn(
                    "block transition-colors hover:bg-muted/50",
                    isOrchestrator ? "px-4 py-4" : "px-4 py-2.5",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "font-medium",
                          isOrchestrator ? "text-sm" : "text-[13px]",
                        )}
                      >
                        {agent.name}
                      </span>
                      <AgentTypeBadge type={agent.type} />
                    </div>
                    <div className="ml-6 flex shrink-0 items-center gap-4 text-xs text-muted-foreground">
                      <span className="font-mono text-foreground">
                        {agent.model}
                      </span>
                      <span className="font-mono tabular-nums">
                        {agent.tools.length} tools
                      </span>
                      {agent.schedules && agent.schedules.length > 0 && (
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          <span className="font-mono tabular-nums">
                            {agent.schedules.length} schedule
                            {agent.schedules.length !== 1 ? "s" : ""}
                          </span>
                        </span>
                      )}
                      <span className="font-mono">v{agent.version}</span>
                    </div>
                  </div>
                  {agent.description && (
                    <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
                      {agent.description}
                    </p>
                  )}
                  {isOrchestrator && subAgentIds.length > 0 && (
                    <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="text-border">&rarr;</span>
                      <span className="flex items-center gap-x-3 font-mono">
                        {subAgentIds.map((agentId) => (
                          <span key={agentId}>{agentId}</span>
                        ))}
                      </span>
                    </div>
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
