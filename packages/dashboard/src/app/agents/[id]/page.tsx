import Link from "next/link";
import { notFound } from "next/navigation";

import { AgentConfigPanel } from "@/components/agents/agent-config-panel";
import { AgentPromptViewer } from "@/components/agents/agent-prompt-viewer";
import { AgentRecentConversations } from "@/components/agents/agent-recent-conversations";
import { AgentSubAgents } from "@/components/agents/agent-sub-agents";
import { AgentToolsList } from "@/components/agents/agent-tools-list";
import {
  AgentTypeBadge,
  getAgentType,
} from "@/components/agents/agent-type-badge";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  getAgentDetail,
  getRecentConversationsByAgent,
} from "@/services/agents";

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

  const agentType = getAgentType(agent.triggers);

  return (
    <main className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-6">
        <Link
          href="/agents"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          &larr; Back to Agents
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">{agent.name}</h1>
          <AgentTypeBadge type={agentType} />
          <Badge variant="outline">v{agent.version}</Badge>
        </div>
        <p className="mt-1 font-mono text-sm text-muted-foreground">
          {agent.id}
        </p>
        {agent.description && (
          <p className="mt-2 text-sm text-muted-foreground">
            {agent.description}
          </p>
        )}
      </div>

      {/* Tabbed Content */}
      <Tabs defaultValue="configuration">
        <TabsList>
          <TabsTrigger value="configuration">Configuration</TabsTrigger>
          <TabsTrigger value="system-prompt">System Prompt</TabsTrigger>
          <TabsTrigger value="recent-conversations">
            Recent Conversations
          </TabsTrigger>
        </TabsList>

        <TabsContent value="configuration" className="mt-6 space-y-6">
          <AgentConfigPanel agent={agent} />
          <AgentToolsList tools={agent.tools} />
          <AgentSubAgents subAgents={agent.subAgents} />
        </TabsContent>

        <TabsContent value="system-prompt" className="mt-6">
          <AgentPromptViewer systemPrompt={agent.systemPrompt} />
        </TabsContent>

        <TabsContent value="recent-conversations" className="mt-6">
          <AgentRecentConversations
            conversations={conversations}
            agentDefinitionId={agent.id}
          />
        </TabsContent>
      </Tabs>
    </main>
  );
}
