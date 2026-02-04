import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatDurationMs, formatPercentage } from "@/lib/format";
import type { ToolRegistryItem } from "@/services/tools";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ToolRegistryProps {
  tools: ToolRegistryItem[];
  highlightTool?: string;
}

interface ToolGroup {
  namespace: string;
  items: ToolRegistryItem[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function groupToolsByNamespace(tools: ToolRegistryItem[]): ToolGroup[] {
  const groups = new Map<string, ToolRegistryItem[]>();

  for (const tool of tools) {
    const existing = groups.get(tool.namespace);
    if (existing) {
      existing.push(tool);
    } else {
      groups.set(tool.namespace, [tool]);
    }
  }

  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([namespace, items]) => ({ namespace, items }));
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ToolRegistry({ tools, highlightTool }: ToolRegistryProps) {
  if (tools.length === 0) {
    return (
      <Card>
        <CardContent>
          <p className="text-sm text-muted-foreground">No tools registered</p>
        </CardContent>
      </Card>
    );
  }

  const groups = groupToolsByNamespace(tools);

  return (
    <div className="space-y-8">
      {groups.map((group) => (
        <div key={group.namespace}>
          {/* Namespace header */}
          <div className="mb-3 flex items-center gap-2">
            <Badge variant="secondary">{group.namespace}</Badge>
            <span className="text-sm text-muted-foreground">
              {group.items.length} tool{group.items.length !== 1 ? "s" : ""}
            </span>
          </div>

          {/* Tool cards */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {group.items.map((tool) => {
              const toolRef = `${tool.namespace}:${tool.name}`;
              const isHighlighted = highlightTool === toolRef;

              return (
                <Card
                  key={toolRef}
                  id={isHighlighted ? `tool-${toolRef}` : undefined}
                  className={isHighlighted ? "ring-2 ring-primary" : undefined}
                >
                  <CardContent className="space-y-3">
                    {/* Tool name and description */}
                    <div>
                      <p className="font-mono text-sm font-medium">
                        {tool.name}
                      </p>
                      {tool.description && (
                        <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                          {tool.description}
                        </p>
                      )}
                    </div>

                    {/* Agents using this tool */}
                    {tool.agents.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {tool.agents.map((agentId) => (
                          <Badge
                            key={agentId}
                            variant="outline"
                            className="text-[10px]"
                          >
                            {agentId}
                          </Badge>
                        ))}
                      </div>
                    )}

                    {/* Inline metrics */}
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span>{tool.callCount} calls</span>
                      <span
                        className={
                          tool.failureRate > 0.1
                            ? "text-red-600 dark:text-red-400"
                            : undefined
                        }
                      >
                        {formatPercentage(tool.failureRate)} failures
                      </span>
                      <span>avg {formatDurationMs(tool.avgLatencyMs)}</span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
