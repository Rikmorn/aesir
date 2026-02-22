import Link from "next/link";
import { notFound } from "next/navigation";

import { AgentConfigPanel } from "@/components/agents/agent-config-panel";
import { AgentDetailTabs } from "@/components/agents/agent-detail-tabs";
import { AgentIdentityPanel } from "@/components/agents/agent-identity-panel";
import { AgentPromptViewer } from "@/components/agents/agent-prompt-viewer";
import { AgentRecentConversations } from "@/components/agents/agent-recent-conversations";
import { AgentSchedulePanel } from "@/components/agents/agent-schedule-panel";
import { AgentToolsPanel } from "@/components/agents/agent-tools-panel";
import {
  AgentTypeBadge,
  getAgentType,
} from "@/components/agents/agent-type-badge";
import {
  getAgentDetail,
  getIdentityDocumentsForAgent,
  getRecentConversationsByAgent,
  getScheduleStatesForAgent,
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

  const [agent, conversations, scheduleStates, identityDocuments] =
    await Promise.all([
      getAgentDetail(id),
      getRecentConversationsByAgent(id),
      getScheduleStatesForAgent(id),
      getIdentityDocumentsForAgent(id),
    ]);

  if (!agent) {
    notFound();
  }

  const agentType = getAgentType(agent.triggers, agent.tools);
  const subAgentCount = agent.subAgents
    ? Object.keys(agent.subAgents).length
    : 0;

  return (
    <div className="flex h-screen flex-col overflow-hidden px-6 pt-6 pb-3">
      {/* Header */}
      <div className="mb-4 shrink-0">
        <div className="flex items-center gap-2 text-sm">
          <Link
            href="/agents"
            className="text-muted-foreground hover:text-foreground"
          >
            Agents
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className="font-medium">{agent.name}</span>
          <AgentTypeBadge type={agentType} />
        </div>
        {agent.description && (
          <p className="mt-1 text-[13px] text-muted-foreground">
            {agent.description}
          </p>
        )}
        <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="font-mono text-foreground">{agent.model}</span>
          <span className="text-border">&middot;</span>
          <span className="font-mono tabular-nums">
            {agent.tools.length} tools
          </span>
          {subAgentCount > 0 && (
            <>
              <span className="text-border">&middot;</span>
              <span className="font-mono tabular-nums">
                {subAgentCount} sub-agent{subAgentCount !== 1 ? "s" : ""}
              </span>
            </>
          )}
          <span className="text-border">&middot;</span>
          <span className="font-mono">v{agent.version}</span>
        </div>
      </div>

      {/* Two-column layout: sidebar + tabbed content */}
      <div className="flex min-h-0 flex-1">
        <aside className="w-[280px] shrink-0 overflow-auto border-r pr-6">
          <AgentConfigPanel agent={agent} />
          {agent.schedules && agent.schedules.length > 0 && (
            <div className="mt-6 border-t pt-6">
              <AgentSchedulePanel
                agentId={agent.id}
                schedules={agent.schedules}
                scheduleStates={scheduleStates}
              />
            </div>
          )}
          {identityDocuments.length > 0 && (
            <div className="mt-6 border-t pt-6">
              <AgentIdentityPanel
                agentId={agent.id}
                documents={identityDocuments}
              />
            </div>
          )}
        </aside>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col pl-6">
          <AgentDetailTabs
            promptContent={
              <AgentPromptViewer systemPrompt={agent.systemPrompt} />
            }
            toolsContent={<AgentToolsPanel tools={agent.tools} />}
            conversationsContent={
              <AgentRecentConversations
                conversations={conversations}
                agentDefinitionId={agent.id}
              />
            }
          />
        </div>
      </div>
    </div>
  );
}
