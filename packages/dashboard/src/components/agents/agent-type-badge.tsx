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
 * Determine agent type from triggers field.
 *
 * An agent with non-empty triggers is an orchestrator (top-level agent that
 * responds to external events). An agent without triggers is a sub-agent
 * (spawned by orchestrators to handle specific tasks).
 */
export function getAgentType(triggers?: Array<{ event: string }>): AgentType {
  return triggers && triggers.length > 0 ? "orchestrator" : "sub-agent";
}

export function AgentTypeBadge({ type }: { type: AgentType }) {
  const config = typeConfig[type];

  return (
    <Badge variant="outline" className={cn("font-medium", config.className)}>
      {config.label}
    </Badge>
  );
}
