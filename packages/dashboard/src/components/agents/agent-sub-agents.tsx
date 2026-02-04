import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AgentSubAgentsProps {
  subAgents?: Record<string, string>;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function AgentSubAgents({ subAgents }: AgentSubAgentsProps) {
  if (!subAgents || Object.keys(subAgents).length === 0) {
    return null;
  }

  const entries = Object.entries(subAgents);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Sub-agents{" "}
          <span className="text-sm font-normal text-muted-foreground">
            ({entries.length})
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="space-y-3">
          {entries.map(([role, agentId]) => (
            <div key={role} className="flex items-baseline justify-between">
              <dt className="text-sm text-muted-foreground capitalize">
                {role}
              </dt>
              <dd>
                <Link
                  href={`/agents/${encodeURIComponent(agentId)}`}
                  className="text-sm font-mono text-foreground hover:text-primary hover:underline"
                >
                  {agentId}
                </Link>
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
