import { PermissionBanner } from "@/components/tools/permission-banner";
import { ToolTable } from "@/components/tools/tool-table";
import { fetchAgentList, fetchToolsHealth } from "@/lib/agent-service";
import {
  buildPermissionMatrix,
  getMcpPermissions,
  getToolRegistry,
} from "@/services/tools";

// Force dynamic rendering -- queries database and agent-service on every request
export const dynamic = "force-dynamic";

// ─── Page ────────────────────────────────────────────────────────────────────

interface ToolsPageProps {
  searchParams: Promise<{
    tool?: string;
  }>;
}

export default async function ToolsPage({ searchParams }: ToolsPageProps) {
  const params = await searchParams;

  // Load data in parallel
  const [agents, integrations, mcpPermissions] = await Promise.all([
    fetchAgentList(),
    fetchToolsHealth(),
    getMcpPermissions(),
  ]);

  // Build tool registry (no metrics — those live on the overview page)
  const tools = await getToolRegistry(null, agents);

  // Build permission matrix (pure function, no DB)
  const permissionCells = buildPermissionMatrix(agents, mcpPermissions);

  return (
    <div className="px-6 py-6">
      <div className="mb-5">
        <h1 className="text-lg font-semibold tracking-tight">Tools</h1>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          Tool registry, permissions, and integration health
        </p>
      </div>

      <div className="space-y-5">
        <PermissionBanner cells={permissionCells} />

        <ToolTable
          tools={tools}
          integrations={integrations}
          highlightTool={params.tool}
        />
      </div>
    </div>
  );
}
