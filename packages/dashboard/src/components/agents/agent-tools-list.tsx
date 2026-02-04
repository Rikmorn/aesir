import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AgentToolsListProps {
  tools: string[];
}

interface ToolGroup {
  namespace: string;
  tools: string[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function groupToolsByNamespace(tools: string[]): ToolGroup[] {
  const groups = new Map<string, string[]>();

  for (const tool of tools) {
    const separatorIndex = tool.indexOf(":");
    const namespace =
      separatorIndex !== -1 ? tool.slice(0, separatorIndex) : "other";
    const toolName =
      separatorIndex !== -1 ? tool.slice(separatorIndex + 1) : tool;

    const existing = groups.get(namespace);
    if (existing) {
      existing.push(toolName);
    } else {
      groups.set(namespace, [toolName]);
    }
  }

  return Array.from(groups.entries()).map(([namespace, namespaceTools]) => ({
    namespace,
    tools: namespaceTools,
  }));
}

// ─── Component ───────────────────────────────────────────────────────────────

export function AgentToolsList({ tools }: AgentToolsListProps) {
  const groups = groupToolsByNamespace(tools);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Tools{" "}
          <span className="text-sm font-normal text-muted-foreground">
            ({tools.length})
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {groups.map((group) => (
          <div key={group.namespace}>
            <div className="mb-2">
              <Badge variant="secondary">{group.namespace}</Badge>
            </div>
            <ul className="space-y-1">
              {group.tools.map((toolName) => (
                <li key={toolName}>
                  <Link
                    href={`/tools?tool=${encodeURIComponent(`${group.namespace}:${toolName}`)}`}
                    className="text-sm font-mono text-foreground hover:text-primary hover:underline"
                  >
                    {toolName}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {tools.length === 0 && (
          <p className="text-sm text-muted-foreground">No tools configured</p>
        )}
      </CardContent>
    </Card>
  );
}
