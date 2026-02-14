"use client";

import { parseAsString, useQueryState } from "nuqs";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AgentDetailTabsProps {
  promptContent: React.ReactNode;
  toolsContent: React.ReactNode;
  conversationsContent: React.ReactNode;
}

// ─── Component ───────────────────────────────────────────────────────────────

const TAB_VALUES = ["system-prompt", "tools", "recent-conversations"];
const DEFAULT_TAB = "system-prompt";

export function AgentDetailTabs({
  promptContent,
  toolsContent,
  conversationsContent,
}: AgentDetailTabsProps) {
  const [tab, setTab] = useQueryState(
    "tab",
    parseAsString.withDefault(DEFAULT_TAB).withOptions({ shallow: false }),
  );

  // Validate tab value, fallback to default if invalid
  const activeTab = TAB_VALUES.includes(tab) ? tab : DEFAULT_TAB;

  return (
    <Tabs value={activeTab} onValueChange={setTab} className="min-h-0 flex-1">
      <TabsList className="shrink-0 border-b" variant="line">
        <TabsTrigger value="system-prompt">System Prompt</TabsTrigger>
        <TabsTrigger value="tools">Tools</TabsTrigger>
        <TabsTrigger value="recent-conversations">
          Recent Conversations
        </TabsTrigger>
      </TabsList>

      <TabsContent value="system-prompt" className="min-h-0 overflow-auto">
        {promptContent}
      </TabsContent>

      <TabsContent value="tools" className="min-h-0 overflow-auto">
        {toolsContent}
      </TabsContent>

      <TabsContent
        value="recent-conversations"
        className="min-h-0 overflow-auto"
      >
        {conversationsContent}
      </TabsContent>
    </Tabs>
  );
}
