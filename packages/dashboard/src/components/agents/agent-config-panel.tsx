import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { AgentDetail } from "@/services/agents";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AgentConfigPanelProps {
  agent: AgentDetail;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function AgentConfigPanel({ agent }: AgentConfigPanelProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Configuration</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Model */}
        <section>
          <h3 className="mb-3 text-sm font-medium text-muted-foreground">
            Model
          </h3>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
            <dt className="text-sm text-muted-foreground">Model</dt>
            <dd className="text-sm font-mono">{agent.model}</dd>
            <dt className="text-sm text-muted-foreground">Temperature</dt>
            <dd className="text-sm font-mono">
              {agent.temperature !== undefined ? agent.temperature : "default"}
            </dd>
          </dl>
        </section>

        <Separator />

        {/* Execution Limits */}
        <section>
          <h3 className="mb-3 text-sm font-medium text-muted-foreground">
            Execution Limits
          </h3>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
            <dt className="text-sm text-muted-foreground">Max Iterations</dt>
            <dd className="text-sm font-mono">
              {agent.maxIterations.toLocaleString()}
            </dd>
            <dt className="text-sm text-muted-foreground">Token Budget</dt>
            <dd className="text-sm font-mono">
              {agent.tokenBudget.toLocaleString()}
            </dd>
          </dl>
        </section>

        <Separator />

        {/* History Settings */}
        <section>
          <h3 className="mb-3 text-sm font-medium text-muted-foreground">
            History
          </h3>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
            <dt className="text-sm text-muted-foreground">Prune Threshold</dt>
            <dd className="text-sm font-mono">
              {agent.history.pruneThreshold.toLocaleString()}
            </dd>
            <dt className="text-sm text-muted-foreground">
              Protected Messages
            </dt>
            <dd className="text-sm font-mono">
              {agent.history.protectedMessages}
            </dd>
            <dt className="text-sm text-muted-foreground">Summary Threshold</dt>
            <dd className="text-sm font-mono">
              {agent.history.summaryThreshold.toLocaleString()}
            </dd>
            <dt className="text-sm text-muted-foreground">Summary Model</dt>
            <dd className="text-sm font-mono">{agent.history.summaryModel}</dd>
          </dl>
        </section>
      </CardContent>
    </Card>
  );
}
