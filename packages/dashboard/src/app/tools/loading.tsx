import { Skeleton } from "@/components/ui/skeleton";

const GROUP_KEYS = ["sk-1", "sk-2", "sk-3", "sk-4", "sk-5", "sk-6"];

export default function ToolsLoading() {
  return (
    <div className="px-6 py-6">
      {/* Header */}
      <div className="mb-5">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="mt-1.5 h-4 w-80" />
      </div>

      <div className="space-y-6">
        {/* Registry section header */}
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-52" />
          <Skeleton className="h-8 w-32" />
        </div>

        {/* Tool table skeleton */}
        <div className="rounded-lg border bg-card">
          <div className="border-b px-4 py-2">
            <Skeleton className="h-4 w-full max-w-xs" />
          </div>
          <div className="divide-y divide-border/50">
            {GROUP_KEYS.map((key) => (
              <div key={key} className="flex items-center gap-3 px-4 py-3">
                <Skeleton className="h-3.5 w-3.5" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-5 w-16 rounded-full" />
                <Skeleton className="h-4 w-14" />
                <div className="flex-1" />
                <div className="flex gap-4">
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-14" />
                  <Skeleton className="h-4 w-16" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Failures section header */}
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-48 w-full rounded-md border" />
      </div>
    </div>
  );
}
