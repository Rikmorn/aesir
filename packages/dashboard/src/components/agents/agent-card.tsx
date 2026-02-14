import { Brain, Tag, Users, Wrench, Zap } from "lucide-react";
import Link from "next/link";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { AgentSummary } from "@/lib/agent-service";

import { AgentTypeBadge, getAgentType } from "./agent-type-badge";

function MetadataItem({
  icon: Icon,
  label,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Icon className="size-3.5 shrink-0" />
      <span className="truncate">{label}</span>
    </div>
  );
}

export function AgentCard({ agent }: { agent: AgentSummary }) {
  const agentType = getAgentType(agent.triggers, agent.tools);
  const subAgentCount = agent.subAgents
    ? Object.keys(agent.subAgents).length
    : 0;

  return (
    <Link
      href={`/agents/${agent.id}`}
      className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card className="h-full transition-colors hover:border-foreground/25">
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle className="text-base">{agent.name}</CardTitle>
            <AgentTypeBadge type={agentType} />
          </div>
          <CardDescription className="font-mono text-xs">
            {agent.id}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {agent.description && (
            <p className="line-clamp-2 text-sm text-muted-foreground">
              {agent.description}
            </p>
          )}

          <div className="grid grid-cols-2 gap-2">
            <MetadataItem icon={Brain} label={agent.model} />
            <MetadataItem icon={Wrench} label={`${agent.tools.length} tools`} />
            {subAgentCount > 0 && (
              <MetadataItem
                icon={Users}
                label={`${subAgentCount} sub-agent${subAgentCount !== 1 ? "s" : ""}`}
              />
            )}
            {agent.triggers && agent.triggers.length > 0 && (
              <MetadataItem
                icon={Zap}
                label={agent.triggers.map((t) => t.event).join(", ")}
              />
            )}
            <MetadataItem icon={Tag} label={`v${agent.version}`} />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
