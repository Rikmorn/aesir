"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { formatDurationMs } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { IntegrationHealth, ToolRegistryItem } from "@/services/tools";

// ─── Schema Helpers ─────────────────────────────────────────────────────────

interface SchemaParam {
  name: string;
  type: string;
  required: boolean;
  description?: string;
}

function extractParams(inputSchema: Record<string, unknown>): SchemaParam[] {
  const properties = inputSchema.properties as
    | Record<string, Record<string, unknown>>
    | undefined;
  if (!properties) return [];

  const required = new Set(
    Array.isArray(inputSchema.required)
      ? (inputSchema.required as string[])
      : [],
  );

  return Object.entries(properties).map(([name, prop]) => ({
    name,
    type: formatSchemaType(prop),
    required: required.has(name),
    description: prop.description as string | undefined,
  }));
}

function formatSchemaType(prop: Record<string, unknown>): string {
  if (prop.type === "array") {
    const items = prop.items as Record<string, unknown> | undefined;
    const itemType = items?.type ?? "unknown";
    return `${itemType}[]`;
  }
  if (Array.isArray(prop.type)) {
    return prop.type.filter((t: string) => t !== "null").join(" | ");
  }
  return (prop.type as string) ?? "unknown";
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface ToolTableProps {
  tools: ToolRegistryItem[];
  integrations: IntegrationHealth[];
  highlightTool?: string;
}

interface ToolGroup {
  namespace: string;
  commands: ToolRegistryItem[];
  agents: string[];
  health?: IntegrationHealth;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function ToolTable({
  tools,
  integrations,
  highlightTool,
}: ToolTableProps) {
  const groups = useMemo(
    () => buildGroups(tools, integrations),
    [tools, integrations],
  );

  const highlightNamespace = highlightTool?.split(":")[0];

  if (groups.length === 0) {
    return (
      <div className="flex h-[120px] items-center justify-center rounded-lg border text-sm text-muted-foreground">
        No tools registered
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card">
      <div className="divide-y divide-border/50">
        {groups.map((group) => (
          <ToolGroupRow
            key={group.namespace}
            group={group}
            defaultOpen={group.namespace === highlightNamespace}
            highlightCommand={
              highlightNamespace === group.namespace ? highlightTool : undefined
            }
          />
        ))}
      </div>
    </div>
  );
}

// ─── Group Row ──────────────────────────────────────────────────────────────

function ToolGroupRow({
  group,
  defaultOpen,
  highlightCommand,
}: {
  group: ToolGroup;
  defaultOpen: boolean;
  highlightCommand?: string;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/50">
        {isOpen ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}

        <span className="font-medium">{group.namespace}</span>

        {group.health && <HealthPill health={group.health} />}

        <span className="text-xs text-muted-foreground">
          {group.commands.length} command
          {group.commands.length !== 1 ? "s" : ""}
        </span>

        {group.agents.length > 0 && (
          <div className="hidden min-w-0 gap-1 overflow-hidden md:flex">
            {group.agents.slice(0, 3).map((agentId) => (
              <Badge
                key={agentId}
                variant="outline"
                className="shrink-0 text-[10px]"
              >
                {agentId}
              </Badge>
            ))}
            {group.agents.length > 3 && (
              <span className="shrink-0 text-[10px] text-muted-foreground">
                +{group.agents.length - 3}
              </span>
            )}
          </div>
        )}
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="divide-y divide-border/30 border-t border-border/50">
          {group.commands.map((cmd) => {
            const ref = `${cmd.namespace}:${cmd.name}`;
            return (
              <CommandRow
                key={cmd.name}
                command={cmd}
                isHighlighted={ref === highlightCommand}
              />
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ─── Command Row ────────────────────────────────────────────────────────────

function CommandRow({
  command,
  isHighlighted,
}: {
  command: ToolRegistryItem;
  isHighlighted: boolean;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const params = useMemo(
    () => extractParams(command.inputSchema),
    [command.inputSchema],
  );

  useEffect(() => {
    if (isHighlighted && rowRef.current) {
      rowRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [isHighlighted]);

  return (
    <div
      ref={isHighlighted ? rowRef : undefined}
      className={cn(
        "px-4 py-3 pl-11",
        isHighlighted && "bg-primary/5 ring-1 ring-inset ring-primary/20",
      )}
    >
      {/* Header: name + agent badges */}
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm">{command.name}</span>
        {command.agents.length > 0 && (
          <div className="flex items-center gap-1">
            {command.agents.slice(0, 2).map((agentId) => (
              <Badge
                key={agentId}
                variant="outline"
                className="shrink-0 text-[10px]"
              >
                {agentId}
              </Badge>
            ))}
            {command.agents.length > 2 && (
              <span className="text-[10px] text-muted-foreground">
                +{command.agents.length - 2}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Description */}
      {command.description && (
        <p className="mt-0.5 text-xs text-muted-foreground">
          {command.description}
        </p>
      )}

      {/* Parameters */}
      {params.length > 0 && (
        <div className="mt-2 rounded-md border bg-background/50 px-3 py-2">
          <div className="space-y-1">
            {params.map((param) => (
              <div key={param.name} className="flex items-baseline gap-2">
                <span className="font-mono text-xs">{param.name}</span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {param.type}
                </span>
                {param.required && (
                  <span className="text-[10px] font-medium text-primary/70">
                    required
                  </span>
                )}
                {param.description && (
                  <>
                    <span className="text-border">&mdash;</span>
                    <span className="text-xs text-muted-foreground">
                      {param.description}
                    </span>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Health Pill ────────────────────────────────────────────────────────────

function HealthPill({ health }: { health: IntegrationHealth }) {
  const isHealthy = health.status === "healthy";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium",
        isHealthy
          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
          : "bg-red-500/10 text-red-700 dark:text-red-400",
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          isHealthy ? "bg-emerald-500 animate-pulse-signal" : "bg-red-500",
        )}
      />
      {isHealthy ? "healthy" : "offline"}
      <span className="font-mono">{formatDurationMs(health.latencyMs)}</span>
    </span>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildGroups(
  tools: ToolRegistryItem[],
  integrations: IntegrationHealth[],
): ToolGroup[] {
  const groupMap = new Map<string, ToolRegistryItem[]>();

  for (const tool of tools) {
    const existing = groupMap.get(tool.namespace) ?? [];
    existing.push(tool);
    groupMap.set(tool.namespace, existing);
  }

  const healthMap = new Map<string, IntegrationHealth>();
  for (const h of integrations) {
    healthMap.set(h.name, h);
  }

  return Array.from(groupMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([namespace, commands]) => {
      const agents = Array.from(
        new Set(commands.flatMap((c) => c.agents)),
      ).sort();

      return {
        namespace,
        commands: commands.sort((a, b) => a.name.localeCompare(b.name)),
        agents,
        health: healthMap.get(namespace),
      };
    });
}
