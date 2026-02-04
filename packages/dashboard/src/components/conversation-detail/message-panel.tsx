"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

import { JsonPayload } from "./json-payload";

// ─── Local types for Anthropic message format ───────────────────────────────
// Keep dashboard decoupled from @anthropic-ai/sdk.

interface ContentBlock {
  type: "text" | "tool_use" | "tool_result";
  text?: string;
  name?: string;
  id?: string;
  input?: Record<string, unknown>;
  content?: string | ContentBlock[];
  is_error?: boolean;
  tool_use_id?: string;
}

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

// ─── MessagePanel ───────────────────────────────────────────────────────────

interface MessagePanelProps {
  messages: unknown[];
}

export function MessagePanel({ messages }: MessagePanelProps) {
  const typedMessages = messages as AnthropicMessage[];

  if (typedMessages.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        No messages recorded
      </div>
    );
  }

  // Detect system prompt: first message is "user" with a single large text block
  const firstMessage = typedMessages[0];
  const isSystemPrompt =
    firstMessage &&
    firstMessage.role === "user" &&
    isLargeTextBlock(firstMessage.content);

  return (
    <div className="space-y-3">
      {isSystemPrompt && firstMessage && (
        <SystemPromptBlock content={firstMessage.content} />
      )}
      {typedMessages.slice(isSystemPrompt ? 1 : 0).map((message, index) => (
        <MessageBlock
          key={`msg-${
            // biome-ignore lint/suspicious/noArrayIndexKey: messages have no unique ID
            index
          }`}
          message={message}
        />
      ))}
    </div>
  );
}

// ─── SystemPromptBlock ──────────────────────────────────────────────────────

function SystemPromptBlock({ content }: { content: string | ContentBlock[] }) {
  const [isOpen, setIsOpen] = useState(false);
  const text = extractText(content);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="rounded-lg border border-dashed border-muted-foreground/30 bg-muted/20">
        <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left">
          {isOpen ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            System Prompt
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t border-dashed border-muted-foreground/30 px-3 pb-3 pt-2">
            <div className="whitespace-pre-wrap text-xs text-muted-foreground">
              {text}
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

// ─── MessageBlock ───────────────────────────────────────────────────────────

function MessageBlock({ message }: { message: AnthropicMessage }) {
  const isAssistant = message.role === "assistant";
  const blocks = normalizeContent(message.content);

  return (
    <div
      className={cn(
        "rounded-lg border px-4 py-3",
        isAssistant ? "bg-muted" : "bg-primary/5",
      )}
    >
      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {isAssistant ? "Assistant" : "User"}
      </div>
      <div className="space-y-2">
        {blocks.map((block, index) => (
          <ContentBlockRenderer
            key={`block-${
              // biome-ignore lint/suspicious/noArrayIndexKey: content blocks have no unique ID
              index
            }`}
            block={block}
          />
        ))}
      </div>
    </div>
  );
}

// ─── ContentBlockRenderer ───────────────────────────────────────────────────

function ContentBlockRenderer({ block }: { block: ContentBlock }) {
  if (block.type === "text") {
    return (
      <div className="whitespace-pre-wrap text-sm">{block.text ?? ""}</div>
    );
  }

  if (block.type === "tool_use") {
    return (
      <div className="rounded border-l-2 border-l-purple-500 bg-muted/30 p-3">
        <div className="mb-1 text-xs font-semibold text-purple-600 dark:text-purple-400">
          Tool: {block.name ?? "unknown"}
        </div>
        {block.input && <JsonPayload data={block.input} maxHeight="200px" />}
      </div>
    );
  }

  if (block.type === "tool_result") {
    const isError = block.is_error === true;
    const resultContent = formatToolResultContent(block.content);

    return (
      <div
        className={cn(
          "rounded border-l-2 p-3",
          isError
            ? "border-l-destructive bg-destructive/5"
            : "border-l-green-500 bg-green-500/5",
        )}
      >
        <div
          className={cn(
            "mb-1 text-xs font-semibold",
            isError ? "text-destructive" : "text-green-600 dark:text-green-400",
          )}
        >
          Result{isError ? " (Error)" : ""}
        </div>
        <JsonPayload data={resultContent} maxHeight="200px" />
      </div>
    );
  }

  // Fallback for unknown block types
  return <JsonPayload data={block} maxHeight="200px" />;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Check if content is a large text block (heuristic for system prompt detection).
 * Returns true if content is a string >500 chars or a single text block >500 chars.
 */
function isLargeTextBlock(content: string | ContentBlock[]): boolean {
  if (typeof content === "string") return content.length > 500;
  if (content.length === 1) {
    const block = content[0];
    return (
      block !== undefined &&
      block.type === "text" &&
      typeof block.text === "string" &&
      block.text.length > 500
    );
  }
  return false;
}

/**
 * Extract plain text from content (string or array of blocks).
 */
function extractText(content: string | ContentBlock[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("\n");
}

/**
 * Normalize content to an array of ContentBlock.
 * If content is a string, wrap it as a single text block.
 */
function normalizeContent(content: string | ContentBlock[]): ContentBlock[] {
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }
  return content;
}

/**
 * Format tool result content for display.
 * Content can be a string, an array of content blocks, or undefined.
 */
function formatToolResultContent(
  content: string | ContentBlock[] | undefined,
): unknown {
  if (content === undefined) return null;
  if (typeof content === "string") return content;
  // Array of content blocks -- extract text from text blocks
  const texts = content.filter((b) => b.type === "text").map((b) => b.text);
  if (texts.length === 1) return texts[0];
  if (texts.length > 1) return texts.join("\n");
  return content;
}
