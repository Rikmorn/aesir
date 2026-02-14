import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type AgentType = "orchestrator" | "sub-agent";

const typeConfig: Record<
  AgentType,
  { label: string; dotClassName: string; className: string }
> = {
  orchestrator: {
    label: "Orchestrator",
    dotClassName: "bg-indigo-500",
    className: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-400",
  },
  "sub-agent": {
    label: "Sub-agent",
    dotClassName: "bg-muted-foreground/50",
    className: "bg-muted text-muted-foreground",
  },
};

/**
 * Determine agent type from triggers and tools.
 *
 * An orchestrator is either:
 * - An agent with external event triggers (webhook-activated), OR
 * - An agent with task:respond (delegation-activated, e.g., qa-agent)
 *
 * Everything else is a sub-agent (spawned internally by orchestrators).
 */
export function getAgentType(
  triggers?: Array<{ event: string }>,
  tools?: string[],
): AgentType {
  if (triggers && triggers.length > 0) return "orchestrator";
  if (tools?.includes("task:respond")) return "orchestrator";
  return "sub-agent";
}

export function AgentTypeBadge({ type }: { type: AgentType }) {
  const config = typeConfig[type];

  return (
    <Badge
      variant="outline"
      className={cn("gap-1.5 border-transparent font-medium", config.className)}
    >
      <span
        className={cn("h-1.5 w-1.5 shrink-0 rounded-full", config.dotClassName)}
      />
      {config.label}
    </Badge>
  );
}
