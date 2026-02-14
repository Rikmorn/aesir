import { AgentList } from "@/components/agents/agent-list";
import { getAgentList } from "@/services/agents";

// Force dynamic rendering -- agents list queries the agent-service on every request
export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const agents = await getAgentList();

  return (
    <div className="flex h-screen flex-col overflow-hidden px-6 pt-6 pb-3">
      <AgentList agents={agents} />
    </div>
  );
}
