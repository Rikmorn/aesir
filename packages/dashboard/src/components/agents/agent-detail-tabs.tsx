"use client";

import { parseAsString, useQueryState } from "nuqs";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AgentDetailTabsProps {
  configurationContent: React.ReactNode;
  systemPromptContent: React.ReactNode;
  recentConversationsContent: React.ReactNode;
}

// ─── Component ───────────────────────────────────────────────────────────────

const TAB_VALUES = ["configuration", "system-prompt", "recent-conversations"];
const DEFAULT_TAB = "configuration";

export function AgentDetailTabs({
  configurationContent,
  systemPromptContent,
  recentConversationsContent,
}: AgentDetailTabsProps) {
  const [tab, setTab] = useQueryState(
    "tab",
    parseAsString.withDefault(DEFAULT_TAB).withOptions({ shallow: false }),
  );

  // Validate tab value, fallback to default if invalid
  const activeTab = TAB_VALUES.includes(tab) ? tab : DEFAULT_TAB;

  return (
    <Tabs value={activeTab} onValueChange={setTab}>
      <TabsList>
        <TabsTrigger value="configuration">Configuration</TabsTrigger>
        <TabsTrigger value="system-prompt">System Prompt</TabsTrigger>
        <TabsTrigger value="recent-conversations">
          Recent Conversations
        </TabsTrigger>
      </TabsList>

      <TabsContent value="configuration" className="mt-6 space-y-6">
        {configurationContent}
      </TabsContent>

      <TabsContent value="system-prompt" className="mt-6">
        {systemPromptContent}
      </TabsContent>

      <TabsContent value="recent-conversations" className="mt-6">
        {recentConversationsContent}
      </TabsContent>
    </Tabs>
  );
}
