"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { estimateTokens, formatTokenCount } from "@/lib/format";
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AgentPromptViewerProps {
  systemPrompt: string;
}

interface PromptSection {
  name: string;
  content: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

type ViewMode = "formatted" | "raw";

export function AgentPromptViewer({ systemPrompt }: AgentPromptViewerProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("formatted");

  const sections = useMemo(
    () => parsePromptSections(systemPrompt),
    [systemPrompt],
  );
  const firstSection = sections[0];
  const hasSections =
    sections.length > 1 ||
    (firstSection !== undefined && firstSection.name !== "");

  const tokenCount = useMemo(
    () => estimateTokens(systemPrompt),
    [systemPrompt],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          System Prompt
          <span className="text-sm font-normal text-muted-foreground">
            ({systemPrompt.length.toLocaleString()} chars · ~
            {formatTokenCount(tokenCount)} tokens)
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* View mode toggle */}
        <div className="mb-3 flex gap-1">
          <Button
            variant={viewMode === "formatted" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setViewMode("formatted")}
          >
            Formatted
          </Button>
          <Button
            variant={viewMode === "raw" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setViewMode("raw")}
          >
            Raw
          </Button>
        </div>

        {viewMode === "raw" ? (
          <div className="max-h-[600px] overflow-auto rounded-md border bg-muted/30 p-4">
            <pre className="whitespace-pre-wrap break-words font-mono text-sm">
              {systemPrompt}
            </pre>
          </div>
        ) : hasSections ? (
          <div className="space-y-2">
            {sections.map((section, index) => (
              <PromptSectionCard
                key={section.name || index}
                section={section}
                defaultOpen={index === 0}
              />
            ))}
          </div>
        ) : (
          <div className="max-h-[600px] overflow-auto rounded-md border bg-muted/30 p-4">
            <pre className="whitespace-pre-wrap break-words font-mono text-sm">
              {systemPrompt}
            </pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── PromptSectionCard ───────────────────────────────────────────────────────

function PromptSectionCard({
  section,
  defaultOpen,
}: {
  section: PromptSection;
  defaultOpen: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  const title = section.name
    ? section.name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    : "Preamble";

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="rounded-md border">
        <CollapsibleTrigger
          className={cn(
            "flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium hover:bg-muted/50",
            isOpen && "border-b",
          )}
        >
          {isOpen ? (
            <ChevronDown className="size-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-4 text-muted-foreground" />
          )}
          {title}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="max-h-80 overflow-auto bg-muted/20 p-3">
            <pre className="whitespace-pre-wrap break-words font-mono text-sm">
              {section.content}
            </pre>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

// ─── Parser ──────────────────────────────────────────────────────────────────

/**
 * Parse a system prompt into sections based on XML-like tags.
 *
 * Handles patterns like:
 * - <section_name>content</section_name>
 * - Content before any tags becomes "preamble"
 */
function parsePromptSections(prompt: string): PromptSection[] {
  const sections: PromptSection[] = [];

  // Regex to match <tag>content</tag> patterns
  const tagRegex = /<(\w+)>([\s\S]*?)<\/\1>/g;
  const matches = Array.from(prompt.matchAll(tagRegex));

  // If no tags found, return the whole prompt as a single section
  if (matches.length === 0) {
    return [{ name: "", content: prompt }];
  }

  let lastIndex = 0;

  for (const match of matches) {
    // Capture any content before this tag as preamble
    const beforeTag = prompt.slice(lastIndex, match.index).trim();
    if (beforeTag && lastIndex === 0) {
      sections.push({ name: "", content: beforeTag });
    }

    const tagName = match[1] ?? "";
    const tagContent = match[2] ?? "";

    sections.push({
      name: tagName,
      content: tagContent.trim(),
    });

    lastIndex = (match.index ?? 0) + match[0].length;
  }

  // Capture any trailing content after the last tag
  const trailing = prompt.slice(lastIndex).trim();
  if (trailing) {
    sections.push({ name: "additional", content: trailing });
  }

  return sections;
}
