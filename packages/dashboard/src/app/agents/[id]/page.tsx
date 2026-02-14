import { notFound } from "next/navigation";

import { AgentConfigPanel } from "@/components/agents/agent-config-panel";
import { AgentDetailTabs } from "@/components/agents/agent-detail-tabs";
import { AgentPromptViewer } from "@/components/agents/agent-prompt-viewer";
import { AgentRecentConversations } from "@/components/agents/agent-recent-conversations";
import { AgentSubAgents } from "@/components/agents/agent-sub-agents";
import { AgentToolsList } from "@/components/agents/agent-tools-list";
import {
  AgentTypeBadge,
  getAgentType,
} from "@/components/agents/agent-type-badge";
import { BackToAgents } from "@/components/navigation/back-link";
import { Badge } from "@/components/ui/badge";
import {
  getAgentDetail,
  getRecentConversationsByAgent,
} from "@/services/agents";

// Force dynamic rendering -- queries database and agent-service on every request
export const dynamic = "force-dynamic";

// ─── Page ────────────────────────────────────────────────────────────────────

interface AgentDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function AgentDetailPage({
  params,
}: AgentDetailPageProps) {
  const { id } = await params;

  const [agent, conversations] = await Promise.all([
    getAgentDetail(id),
    getRecentConversationsByAgent(id),
  ]);

  if (!agent) {
    notFound();
  }

  const agentType = getAgentType(agent.triggers, agent.tools);

  return (
    <div className="px-6 py-6">
      <div className="mb-5">
        <BackToAgents />
        <div className="mt-2 flex items-center gap-3">
          <h1 className="text-lg font-semibold tracking-tight">{agent.name}</h1>
          <AgentTypeBadge type={agentType} />
          <Badge variant="outline" className="font-mono text-[11px]">
            v{agent.version}
          </Badge>
        </div>
        <p className="mt-1 font-mono text-xs text-muted-foreground">
          {agent.id}
        </p>
        {agent.description && (
          <p className="mt-1.5 text-[13px] text-muted-foreground">
            {agent.description}
          </p>
        )}
      </div>

      {/* Tabbed Content */}
      <AgentDetailTabs
        configurationContent={
          <>
            <AgentConfigPanel agent={agent} />
            <AgentToolsList tools={agent.tools} />
            <AgentSubAgents subAgents={agent.subAgents} />
          </>
        }
        systemPromptContent={
          <AgentPromptViewer systemPrompt={agent.systemPrompt} />
        }
        recentConversationsContent={
          <AgentRecentConversations
            conversations={conversations}
            agentDefinitionId={agent.id}
          />
        }
      />
    </div>
  );
}
