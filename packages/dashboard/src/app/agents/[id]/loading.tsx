import { Skeleton } from "@/components/ui/skeleton";

const TAB_KEYS = ["tab-config", "tab-prompt", "tab-conversations"];

const CONFIG_SECTION_KEYS = [
  "section-model",
  "section-limits",
  "section-history",
];

const CONFIG_ROW_KEYS = [
  "cfg-1",
  "cfg-2",
  "cfg-3",
  "cfg-4",
  "cfg-5",
  "cfg-6",
  "cfg-7",
  "cfg-8",
];

export default function AgentDetailLoading() {
  return (
    <div className="px-6 py-6">
      {/* Breadcrumb */}
      <div className="mb-5">
        <Skeleton className="h-4 w-28" />

        {/* Header: name + badges + ID */}
        <div className="mt-2 flex items-center gap-3">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-5 w-24 rounded-full" />
          <Skeleton className="h-5 w-12 rounded-full" />
        </div>
        <Skeleton className="mt-1 h-4 w-36" />
        <Skeleton className="mt-2 h-4 w-64" />
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-2">
        {TAB_KEYS.map((key) => (
          <Skeleton key={key} className="h-9 w-32 rounded-md" />
        ))}
      </div>

      {/* Configuration tab content skeleton */}
      <div className="mt-6 space-y-6">
        {/* Config card */}
        <div className="rounded-lg border py-6">
          <div className="px-6 pb-4">
            <Skeleton className="h-5 w-28" />
          </div>
          <div className="space-y-6 px-6">
            {CONFIG_SECTION_KEYS.map((sectionKey) => (
              <div key={sectionKey} className="space-y-3">
                <Skeleton className="h-4 w-16" />
                <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                  {CONFIG_ROW_KEYS.slice(0, 2).map((rowKey) => (
                    <Skeleton
                      key={`${sectionKey}-${rowKey}`}
                      className="h-4 w-24"
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Tools card */}
        <div className="rounded-lg border py-6">
          <div className="px-6 pb-4">
            <Skeleton className="h-5 w-20" />
          </div>
          <div className="space-y-3 px-6">
            {CONFIG_ROW_KEYS.slice(0, 4).map((key) => (
              <Skeleton key={key} className="h-4 w-40" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
