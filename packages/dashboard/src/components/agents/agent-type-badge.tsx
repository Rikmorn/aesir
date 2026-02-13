import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type AgentType = "orchestrator" | "sub-agent";

const typeConfig: Record<AgentType, { label: string; className: string }> = {
  orchestrator: {
    label: "Orchestrator",
    className:
      "bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300",
  },
  "sub-agent": {
    label: "Sub-agent",
    className:
      "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
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
    <Badge variant="outline" className={cn("font-medium", config.className)}>
      {config.label}
    </Badge>
  );
}
