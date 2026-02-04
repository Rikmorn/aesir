import type { AgentSummary } from "@/lib/agent-service";
import type { PermissionCell } from "@/services/tools";

interface PermissionMatrixProps {
  cells: PermissionCell[];
  agents: AgentSummary[];
}

export function PermissionMatrix({ cells, agents }: PermissionMatrixProps) {
  return (
    <div>
      <p>
        Permission matrix placeholder ({cells.length} cells, {agents.length}{" "}
        agents)
      </p>
    </div>
  );
}
