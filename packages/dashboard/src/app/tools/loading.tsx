import { Skeleton } from "@/components/ui/skeleton";

const SKELETON_ROW_KEYS = ["sk-1", "sk-2", "sk-3", "sk-4", "sk-5", "sk-6"];

export default function ToolsLoading() {
  return (
    <main className="container mx-auto px-4 py-8">
      {/* Header skeleton */}
      <div className="mb-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-2 h-4 w-96" />
      </div>
      {/* Tab bar skeleton */}
      <Skeleton className="h-10 w-full max-w-xl" />
      {/* Content skeleton */}
      <div className="mt-6 space-y-4">
        {SKELETON_ROW_KEYS.map((key) => (
          <Skeleton key={key} className="h-16 w-full" />
        ))}
      </div>
    </main>
  );
}
