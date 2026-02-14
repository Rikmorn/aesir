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
    <div className="flex flex-col h-[calc(100vh-3rem)] px-6 py-5">
      <div className="mb-4 shrink-0">
        <BackToTasks />
        <h1 className="mt-2 text-lg font-semibold tracking-tight">
          {rootNode?.title ?? "Task Graph"}
        </h1>
        <p className="font-mono text-xs text-muted-foreground">{taskId}</p>
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
    </div>
  );
}
