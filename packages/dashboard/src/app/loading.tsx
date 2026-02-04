import { Skeleton } from "@/components/ui/skeleton";

const STAT_CARD_KEYS = ["sc-1", "sc-2", "sc-3", "sc-4", "sc-5"];

export default function OverviewLoading() {
  return (
    <main className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-6">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="mt-2 h-4 w-96" />
      </div>

      <div className="space-y-6">
        {/* Stat cards */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
          {STAT_CARD_KEYS.map((key) => (
            <Skeleton key={key} className="h-24 w-full rounded-xl" />
          ))}
        </div>

        {/* Two-column sections */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-[350px] w-full rounded-xl" />
          <Skeleton className="h-[350px] w-full rounded-xl" />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-[350px] w-full rounded-xl" />
          <Skeleton className="h-[350px] w-full rounded-xl" />
        </div>
      </div>
    </main>
  );
}
