/**
 * Loading skeleton for task detail / graph page.
 * Mirrors the page layout with placeholder blocks.
 */

export default function TaskDetailLoading() {
  return (
    <main className="container mx-auto flex flex-col h-[calc(100vh-4rem)] px-4 py-6">
      {/* Header skeleton */}
      <div className="mb-4 shrink-0">
        <div className="h-4 w-16 rounded bg-muted animate-pulse" />
        <div className="mt-2 h-7 w-72 rounded bg-muted animate-pulse" />
        <div className="mt-1 h-4 w-48 rounded bg-muted animate-pulse" />
      </div>

      {/* Graph area skeleton */}
      <div className="flex-1 min-h-0">
        <div className="h-full rounded-md border bg-muted/30 animate-pulse" />
      </div>
    </main>
  );
}
