import { Skeleton } from "@/components/ui/skeleton";

const SKELETON_ROW_KEYS = [
  "r1",
  "r2",
  "r3",
  "r4",
  "r5",
  "r6",
  "r7",
  "r8",
  "r9",
  "r10",
];

export default function TasksLoading() {
  return (
    <main className="container mx-auto py-8 px-4">
      <div className="mb-6">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="mt-2 h-4 w-80" />
      </div>
      <div className="space-y-4">
        {/* Table skeleton */}
        <div className="rounded-md border">
          {/* Header */}
          <div className="flex items-center gap-4 border-b px-4 py-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-16" />
          </div>
          {/* Rows */}
          {SKELETON_ROW_KEYS.map((key) => (
            <div
              key={key}
              className="flex items-center gap-4 border-b px-4 py-3"
            >
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-4 w-8" />
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-4 w-14" />
            </div>
          ))}
        </div>
        {/* Pagination skeleton */}
        <div className="flex items-center justify-between px-2 py-4">
          <Skeleton className="h-4 w-40" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-20" />
            <div className="flex gap-1">
              <Skeleton className="h-6 w-6" />
              <Skeleton className="h-6 w-6" />
              <Skeleton className="h-6 w-6" />
              <Skeleton className="h-6 w-6" />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
