import Link from "next/link";

import type { AgentDetail } from "@/services/agents";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AgentConfigPanelProps {
  agent: AgentDetail;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function AgentConfigPanel({ agent }: AgentConfigPanelProps) {
  const subAgentEntries = agent.subAgents
    ? Object.entries(agent.subAgents)
    : [];

  return (
    <div className="space-y-6">
      {/* Core config — stacked for narrow sidebar */}
      <dl className="space-y-3">
        <div>
          <dt className="text-xs text-muted-foreground">Model</dt>
          <dd className="font-mono text-sm">{agent.model}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Temperature</dt>
          <dd className="font-mono text-sm">
            {agent.temperature !== undefined ? agent.temperature : "default"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Token Budget</dt>
          <dd className="font-mono text-sm tabular-nums">
            {agent.tokenBudget.toLocaleString()}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Max Iterations</dt>
          <dd className="font-mono text-sm tabular-nums">
            {agent.maxIterations.toLocaleString()}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Prune Threshold</dt>
          <dd className="font-mono text-sm tabular-nums">
            {agent.history.pruneThreshold.toLocaleString()}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Protected Messages</dt>
          <dd className="font-mono text-sm tabular-nums">
            {agent.history.protectedMessages}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Summary Threshold</dt>
          <dd className="font-mono text-sm tabular-nums">
            {agent.history.summaryThreshold.toLocaleString()}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Summary Model</dt>
          <dd className="font-mono text-sm">{agent.history.summaryModel}</dd>
        </div>
      </dl>

      {/* Sub-agents */}
      {subAgentEntries.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Sub-agents
          </h3>
          <div className="space-y-2">
            {subAgentEntries.map(([role, agentId]) => (
              <div key={role}>
                <span className="text-xs text-muted-foreground">{role}</span>
                <Link
                  href={`/agents/${encodeURIComponent(agentId)}`}
                  className="block font-mono text-sm text-foreground hover:text-primary"
                >
                  {agentId}
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
