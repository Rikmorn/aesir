"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import Markdown from "react-markdown";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AgentPromptViewerProps {
  systemPrompt: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function AgentPromptViewer({ systemPrompt }: AgentPromptViewerProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Card>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CardHeader>
          <CollapsibleTrigger className="flex w-full items-center justify-between text-left">
            <CardTitle className="flex items-center gap-2">
              System Prompt
              <span className="text-sm font-normal text-muted-foreground">
                ({systemPrompt.length.toLocaleString()} chars)
              </span>
            </CardTitle>
            {isOpen ? (
              <ChevronDown className="size-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="size-4 text-muted-foreground" />
            )}
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent>
          <CardContent>
            <div className="max-h-[600px] overflow-auto rounded-md border bg-muted/30 p-4">
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <Markdown>{systemPrompt}</Markdown>
              </div>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
