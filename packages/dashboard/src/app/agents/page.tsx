import { AlertCircle } from "lucide-react";

import { AgentCard } from "@/components/agents/agent-card";
import { getAgentType } from "@/components/agents/agent-type-badge";
import { getAgentList } from "@/services/agents";

// Force dynamic rendering -- agents list queries the agent-service on every request
export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const agents = await getAgentList();

  const sorted = [...agents].sort((a, b) => {
    const typeA = getAgentType(a.triggers, a.tools);
    const typeB = getAgentType(b.triggers, b.tools);

    if (typeA !== typeB) {
      return typeA === "orchestrator" ? -1 : 1;
    }

    return a.name.localeCompare(b.name);
  });

  return (
    <main className="container mx-auto py-8 px-4">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Agents</h1>
        <p className="text-muted-foreground">
          Agent definitions loaded in the runtime
        </p>
      </div>

      {sorted.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sorted.map((agent) => (
            <AgentCard key={agent.id} agent={agent} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
          <AlertCircle className="size-10 opacity-40" />
          <p className="text-sm">
            No agents found. The agent service may be unavailable.
          </p>
        </div>
      )}
    </main>
  );
}
