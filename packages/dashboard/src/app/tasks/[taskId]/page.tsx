import { notFound } from "next/navigation";
import { BackToTasks } from "@/components/navigation/back-link";
import { LiveTaskGraph } from "@/components/tasks/live-task-graph";
import {
  computeTreeHealth,
  getTaskTimeline,
  getTaskTree,
} from "@/services/tasks";

// Force dynamic rendering -- queries database on every request
export const dynamic = "force-dynamic";

// ─── Page ───────────────────────────────────────────────────────────────────

interface TaskDetailPageProps {
  params: Promise<{ taskId: string }>;
}

export default async function TaskDetailPage({ params }: TaskDetailPageProps) {
  const { taskId } = await params;

  const nodes = await getTaskTree(taskId);

  if (nodes.length === 0) {
    notFound();
  }

  const rootNode = nodes[0];

  const taskIds = nodes.map((n) => n.id);
  const events = await getTaskTimeline(taskIds);
  const health = computeTreeHealth(nodes, events);

  return (
    <main className="container mx-auto flex flex-col h-[calc(100vh-4rem)] px-4 py-6">
      {/* Header */}
      <div className="mb-4 shrink-0">
        <BackToTasks />
        <h1 className="mt-2 text-2xl font-bold tracking-tight">
          {rootNode?.title ?? "Task Graph"}
        </h1>
        <p className="font-mono text-sm text-muted-foreground">{taskId}</p>
      </div>

      {/* Graph area -- takes remaining vertical space */}
      <div className="flex-1 min-h-0">
        <LiveTaskGraph
          taskId={taskId}
          initialNodes={nodes}
          initialEvents={events}
          initialHealth={health}
        />
      </div>
    </main>
  );
}
