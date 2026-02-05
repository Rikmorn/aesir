"use client";

import { parseAsString, useQueryState } from "nuqs";

import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ToolsTabsProps {
  registryContent: React.ReactNode;
  permissionsContent: React.ReactNode;
  performanceContent: React.ReactNode;
  failuresContent: React.ReactNode;
  healthContent: React.ReactNode;
  mismatchCount: number;
  defaultTab: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

const TAB_VALUES = [
  "registry",
  "permissions",
  "performance",
  "failures",
  "health",
];
const DEFAULT_TAB = "registry";

export function ToolsTabs({
  registryContent,
  permissionsContent,
  performanceContent,
  failuresContent,
  healthContent,
  mismatchCount,
  defaultTab,
}: ToolsTabsProps) {
  const [tab, setTab] = useQueryState(
    "tab",
    parseAsString.withDefault(defaultTab).withOptions({ shallow: false }),
  );

  // Validate tab value, fallback to default if invalid
  const activeTab = TAB_VALUES.includes(tab) ? tab : DEFAULT_TAB;

  return (
    <Tabs value={activeTab} onValueChange={setTab}>
      <TabsList>
        <TabsTrigger value="registry">Registry</TabsTrigger>
        <TabsTrigger value="permissions">
          Permissions
          {mismatchCount > 0 && (
            <Badge
              variant="destructive"
              className="ml-1.5 h-5 px-1.5 text-[10px]"
            >
              {mismatchCount}
            </Badge>
          )}
        </TabsTrigger>
        <TabsTrigger value="performance">Performance</TabsTrigger>
        <TabsTrigger value="failures">Failures</TabsTrigger>
        <TabsTrigger value="health">Health</TabsTrigger>
      </TabsList>

      <TabsContent value="registry" className="mt-6">
        {registryContent}
      </TabsContent>

      <TabsContent value="permissions" className="mt-6">
        {permissionsContent}
      </TabsContent>

      <TabsContent value="performance" className="mt-6">
        {performanceContent}
      </TabsContent>

      <TabsContent value="failures" className="mt-6">
        {failuresContent}
      </TabsContent>

      <TabsContent value="health" className="mt-6">
        {healthContent}
      </TabsContent>
    </Tabs>
  );
}
