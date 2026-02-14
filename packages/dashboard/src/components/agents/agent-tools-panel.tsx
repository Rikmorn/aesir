import Link from "next/link";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AgentToolsPanelProps {
  tools: string[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function groupToolsByNamespace(
  tools: string[],
): Array<{ namespace: string; tools: string[] }> {
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

export function AgentToolsPanel({ tools }: AgentToolsPanelProps) {
  const toolGroups = groupToolsByNamespace(tools);

  if (tools.length === 0) {
    return (
      <div className="flex h-[120px] items-center justify-center">
        <p className="text-sm text-muted-foreground">No tools configured</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground">
        {tools.length} tools across {toolGroups.length} namespace
        {toolGroups.length !== 1 ? "s" : ""}
      </p>
      {toolGroups.map((group) => (
        <div key={group.namespace}>
          <h3 className="mb-2 text-sm font-medium">
            {group.namespace}
            <span className="ml-1.5 text-xs text-muted-foreground">
              ({group.tools.length})
            </span>
          </h3>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {group.tools.map((toolName) => (
              <Link
                key={toolName}
                href={`/tools?tool=${encodeURIComponent(`${group.namespace}:${toolName}`)}`}
                className="font-mono text-sm text-foreground/80 transition-colors hover:text-foreground hover:underline"
              >
                {toolName}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
