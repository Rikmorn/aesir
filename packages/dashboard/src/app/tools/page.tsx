import { IntegrationHealth } from "@/components/tools/integration-health";
import { PermissionMatrix } from "@/components/tools/permission-matrix";
import { RecentFailures } from "@/components/tools/recent-failures";
import { ToolPerformance } from "@/components/tools/tool-performance";
import { ToolRegistry } from "@/components/tools/tool-registry";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fetchAgentList, fetchToolsHealth } from "@/lib/agent-service";
import { getTimeRangeDate } from "@/lib/format";
import {
  buildPermissionMatrix,
  getMcpPermissions,
  getToolRegistry,
} from "@/services/tools";

// ─── Page ────────────────────────────────────────────────────────────────────

interface ToolsPageProps {
  searchParams: Promise<{
    tab?: string;
    tool?: string;
    timeRange?: string;
  }>;
}

export default async function ToolsPage({ searchParams }: ToolsPageProps) {
  const params = await searchParams;

  // If ?tool= is present (from agent detail tool links), default to registry tab
  const defaultTab = params.tool ? "registry" : (params.tab ?? "registry");
  const timeRange = params.timeRange ?? "1h";
  const since = getTimeRangeDate(timeRange);

  // Load data in parallel
  const [agents, integrations, mcpPermissions] = await Promise.all([
    fetchAgentList(),
    fetchToolsHealth(),
    getMcpPermissions(),
  ]);

  // Build tool registry with metrics (depends on agents + since)
  const tools = await getToolRegistry(since, agents);

  // Build permission matrix (pure function, no DB)
  const permissionCells = buildPermissionMatrix(agents, mcpPermissions);
  const mismatchCount = permissionCells.filter(
    (cell) => cell.mismatch !== "none",
  ).length;

  return (
    <main className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Tools</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          All registered tools, permissions, performance, and health
        </p>
      </div>

      {/* Tabbed Content */}
      <Tabs defaultValue={defaultTab}>
        <TabsList>
          <TabsTrigger value="registry">Registry</TabsTrigger>
          <TabsTrigger value="permissions">
            Permissions
            {mismatchCount > 0 && (
              <Badge
                variant="destructive"
                className="ml-1.5 h-5 px-1.5 text-[10px]"
              >
                {mismatchCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="failures">Failures</TabsTrigger>
          <TabsTrigger value="health">Health</TabsTrigger>
        </TabsList>

        <TabsContent value="registry" className="mt-6">
          <ToolRegistry tools={tools} highlightTool={params.tool} />
        </TabsContent>

        <TabsContent value="permissions" className="mt-6">
          <PermissionMatrix cells={permissionCells} agents={agents} />
        </TabsContent>

        <TabsContent value="performance" className="mt-6">
          <ToolPerformance />
        </TabsContent>

        <TabsContent value="failures" className="mt-6">
          <RecentFailures />
        </TabsContent>

        <TabsContent value="health" className="mt-6">
          <IntegrationHealth integrations={integrations} />
        </TabsContent>
      </Tabs>
    </main>
  );
}
