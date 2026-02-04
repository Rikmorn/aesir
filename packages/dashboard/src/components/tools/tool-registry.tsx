import type { ToolRegistryItem } from "@/services/tools";

interface ToolRegistryProps {
  tools: ToolRegistryItem[];
  highlightTool?: string;
}

export function ToolRegistry({ tools, highlightTool }: ToolRegistryProps) {
  return (
    <div>
      <p>
        Tool registry placeholder ({tools.length} tools, highlight:{" "}
        {highlightTool ?? "none"})
      </p>
    </div>
  );
}
