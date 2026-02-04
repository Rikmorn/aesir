import { Skeleton } from "@/components/ui/skeleton";

const SKELETON_CARD_KEYS = ["c1", "c2", "c3", "c4", "c5", "c6"];

export default function AgentsLoading() {
  return (
    <main className="container mx-auto py-8 px-4">
      <div className="mb-6">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="mt-2 h-4 w-64" />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {SKELETON_CARD_KEYS.map((key) => (
          <div key={key} className="flex flex-col gap-6 rounded-xl border py-6">
            {/* Header */}
            <div className="space-y-2 px-6">
              <div className="flex items-center gap-2">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-5 w-20 rounded-full" />
              </div>
              <Skeleton className="h-3 w-24" />
            </div>

            {/* Content */}
            <div className="space-y-4 px-6">
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-12" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
