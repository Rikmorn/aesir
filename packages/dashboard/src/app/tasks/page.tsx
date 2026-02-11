import { TaskListTable } from "@/components/tasks/task-list-table";
import type { TreeHealth } from "@/services/tasks";
import { getTreeHealthForRoots, listRootTasks } from "@/services/tasks";

// Force dynamic rendering -- queries database on every request
export const dynamic = "force-dynamic";

interface TasksPageProps {
  searchParams: Promise<{
    page?: string;
    status?: string;
  }>;
}

export default async function TasksPage({ searchParams }: TasksPageProps) {
  const params = await searchParams;
  const page = Number(params.page) || 1;
  const pageSize = 25;
  const status = params.status?.split(",").filter(Boolean);

  const { items, total } = await listRootTasks({
    status,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });

  // Compute health for all root tasks on this page
  const healthMapRaw = await getTreeHealthForRoots(items.map((i) => i.id));

  // Serialize Map to plain object for client component
  const healthMap: Record<string, TreeHealth> = {};
  for (const [key, value] of healthMapRaw) {
    healthMap[key] = value;
  }

  return (
    <main className="container mx-auto py-8 px-4">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Tasks</h1>
        <p className="text-muted-foreground">
          Monitor delegation hierarchies and task workflows
        </p>
      </div>
      <TaskListTable
        items={items}
        total={total}
        page={page}
        pageSize={pageSize}
        healthMap={healthMap}
      />
    </main>
  );
}
