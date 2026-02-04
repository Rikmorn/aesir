# Phase 51: Conversation Detail - Research

**Researched:** 2026-02-04
**Domain:** Next.js dynamic routes, agent event timeline rendering, message history display, JSON payload visualization
**Confidence:** HIGH

## Summary

Phase 51 builds a conversation detail page at `/conversations/[id]` that renders three panels: an event timeline (from `agent_events`), message history (from `conversations.messages`), and metadata sidebar (from `conversations` + `agent_sessions`). The page uses Next.js App Router dynamic routes with async params, shadcn/ui Collapsible for expandable events, and follows the existing dashboard service layer pattern.

The event timeline displays all `agent_events` rows chronologically with expand/collapse controls, with failed tool calls auto-expanded for debugging. The message history renders the Anthropic Messages API format stored in `conversations.messages` as a chat-style view with tool use blocks highlighted. The metadata sidebar shows conversation metadata and is collapsible to save horizontal space.

The existing dashboard infrastructure (Phase 49/50) provides the foundation: Next.js 15.5.9, Tailwind CSS 4, shadcn/ui components, Drizzle service layer, and local schema definitions. This phase adds new service functions (`getConversationById`, `getConversationEvents`, `getConversationMessages`) and new UI components for timeline and message rendering.

**Primary recommendation:** Use Next.js dynamic route with `app/conversations/[id]/page.tsx`, fetch data via async service functions in server components, render with shadcn/ui Collapsible for events, custom MessageBlock components for chat history, and JSON.stringify with `<pre>` tags for payload display. Follow the functional-over-polished design direction with Linear/Vercel-inspired visual treatment.

## Standard Stack

### Core (Already Installed from Phase 49)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| next | 15.5.9 | App Router dynamic routes | Already used in dashboard, supports async params |
| react | ^19.0.3 | Component rendering | Required by Next.js |
| drizzle-orm | ^0.45.1 | Database queries | Already used for service layer |
| tailwindcss | ^4.0.0 | Styling | Already configured |

### Supporting (Already Installed)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| lucide-react | latest | Icons for event types | Timeline event icons, collapsible triggers |
| class-variance-authority | latest | Component variants | Badge variants for event types |
| shadcn/ui components | N/A | UI primitives | Collapsible (timeline), Badge (status), Separator |

### Additional Components Needed

| Component | Installation | Purpose | When to Use |
|-----------|--------------|---------|-------------|
| Collapsible | `pnpm dlx shadcn@latest add collapsible` | Expandable event rows | Event timeline with collapse controls |
| Separator | `pnpm dlx shadcn@latest add separator` | Visual dividers | Between timeline sections |
| ScrollArea | `pnpm dlx shadcn@latest add scroll-area` | Scrollable containers | Large JSON payloads |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| shadcn/ui Collapsible | Custom accordion | Collapsible is lightweight, accessible, and sufficient for expand/collapse |
| JSON.stringify + `<pre>` | react-json-view library | External library adds bundle size; `<pre>` is sufficient for functional MVP |
| Custom message components | Markdown renderer | Messages are structured JSON, not markdown; custom components give precise control |
| Side-by-side layout | Tabbed layout | Side-by-side allows comparing timeline and messages simultaneously (better for debugging) |

**Installation (only new shadcn components):**
```bash
pnpm dlx shadcn@latest add collapsible separator scroll-area
```

## Architecture Patterns

### Recommended Project Structure

```
packages/dashboard/src/
  app/
    conversations/
      [id]/
        page.tsx                  # Dynamic route: conversation detail page
        loading.tsx               # Loading skeleton (optional, good practice)
  components/
    conversation-detail/
      event-timeline.tsx          # Timeline panel with Collapsible events
      event-item.tsx              # Single event row (tool.called, llm.response, etc.)
      message-panel.tsx           # Chat-style message history
      message-block.tsx           # Single message (user or assistant)
      tool-use-block.tsx          # Tool use/result display within messages
      metadata-sidebar.tsx        # Collapsible metadata panel
      json-payload.tsx            # Expandable JSON viewer (simple <pre> wrapper)
    ui/
      collapsible.tsx             # shadcn component (add via CLI)
      separator.tsx               # shadcn component (add via CLI)
      scroll-area.tsx             # shadcn component (add via CLI)
  services/
    conversations.ts              # EXTEND with new functions:
                                  #   - getConversationById()
                                  #   - getConversationEvents()
                                  #   - getConversationMessages()
  lib/
    schema.ts                     # Already has conversations, agentEvents, agentSessions
    format.ts                     # EXTEND with formatEventType(), formatDuration()
```

### Pattern 1: Next.js Dynamic Route with Async Params

**What:** Dynamic route segment `[id]` with async params promise in Next.js 15 App Router.

**When to use:** All detail pages that render data for a specific ID from the URL.

**Example (`app/conversations/[id]/page.tsx`):**
```typescript
// Source: Official Next.js docs - dynamic routes
interface ConversationDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function ConversationDetailPage({
  params,
}: ConversationDetailPageProps) {
  const { id } = await params;

  // Fetch data server-side via service layer
  const conversation = await getConversationById(id);
  const events = await getConversationEvents(id);

  if (!conversation) {
    notFound(); // Built-in Next.js 404 handler
  }

  return (
    <main className="container mx-auto py-8 px-4">
      <ConversationDetailLayout
        conversation={conversation}
        events={events}
      />
    </main>
  );
}
```

**Key consideration:** The `params` prop is a Promise in Next.js 15+. Always `await params` before accessing properties. This is a breaking change from older Next.js versions where params was a plain object.

### Pattern 2: Service Layer Extension for Conversation Detail

**What:** Add typed query functions to the existing `services/conversations.ts` file for conversation detail data.

**When to use:** All database queries for the conversation detail page.

**Example additions to `services/conversations.ts`:**
```typescript
// New interfaces
export interface ConversationDetail {
  id: string;
  agentDefinitionId: string;
  agentDefinitionVersion: string;
  status: string;
  retryCount: number;
  errorMessage: string | null;
  parentConversationId: string | null;
  createdAt: Date;
  updatedAt: Date;
  // From agent_sessions join
  artifacts: Record<string, string>;
  lastEventAt: Date | null;
}

export interface ConversationEvent {
  id: string;
  conversationId: string;
  agentInstanceId: string;
  parentInstanceId: string | null;
  sequence: number;
  type: AgentEventType;
  payload: Record<string, unknown>;
  timestamp: Date;
  tokenCountInput: number | null;
  tokenCountOutput: number | null;
  durationMs: number | null;
}

// New query functions
export async function getConversationById(
  id: string
): Promise<ConversationDetail | null> {
  const rows = await db
    .select({
      id: conversations.id,
      agent_definition_id: conversations.agent_definition_id,
      agent_definition_version: conversations.agent_definition_version,
      status: conversations.status,
      retry_count: conversations.retry_count,
      error_message: conversations.error_message,
      parent_conversation_id: conversations.parent_conversation_id,
      created_at: conversations.created_at,
      updated_at: conversations.updated_at,
      artifacts: agentSessions.artifacts,
      last_event_at: agentSessions.last_event_at,
    })
    .from(conversations)
    .leftJoin(agentSessions, eq(agentSessions.conversation_id, conversations.id))
    .where(eq(conversations.id, id))
    .limit(1);

  if (rows.length === 0) return null;

  const row = rows[0];
  return {
    id: row.id,
    agentDefinitionId: row.agent_definition_id,
    agentDefinitionVersion: row.agent_definition_version,
    status: row.status,
    retryCount: row.retry_count,
    errorMessage: row.error_message,
    parentConversationId: row.parent_conversation_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    artifacts: row.artifacts ?? {},
    lastEventAt: row.last_event_at,
  };
}

export async function getConversationEvents(
  conversationId: string
): Promise<ConversationEvent[]> {
  const rows = await db
    .select()
    .from(agentEvents)
    .where(eq(agentEvents.conversation_id, conversationId))
    .orderBy(asc(agentEvents.sequence));

  return rows.map((row) => ({
    id: row.id,
    conversationId: row.conversation_id,
    agentInstanceId: row.agent_instance_id,
    parentInstanceId: row.parent_instance_id,
    sequence: row.sequence,
    type: row.type,
    payload: row.payload as Record<string, unknown>,
    timestamp: row.timestamp,
    tokenCountInput: row.token_count_input,
    tokenCountOutput: row.token_count_output,
    durationMs: row.duration_ms,
  }));
}

export async function getConversationMessages(
  conversationId: string
): Promise<unknown[]> {
  const rows = await db
    .select({ messages: conversations.messages })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);

  return rows.length > 0 ? (rows[0].messages as unknown[]) : [];
}
```

**Why service layer:** When the dashboard eventually migrates from direct DB access to REST API calls (future phase), only these service functions need to change -- all React components use the same typed interface.

### Pattern 3: Event Timeline with Collapsible Rows

**What:** A timeline of agent events using shadcn/ui Collapsible, with failed events auto-expanded and others collapsed by default.

**When to use:** For the event timeline panel.

**Example (`components/conversation-detail/event-timeline.tsx`):**
```typescript
// Source: shadcn/ui Collapsible documentation
"use client";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import type { ConversationEvent } from "@/services/conversations";

interface EventTimelineProps {
  events: ConversationEvent[];
}

export function EventTimeline({ events }: EventTimelineProps) {
  return (
    <div className="space-y-2">
      {events.map((event) => (
        <EventItem key={event.id} event={event} />
      ))}
    </div>
  );
}

function EventItem({ event }: { event: ConversationEvent }) {
  // Auto-expand failed events, collapse others by default
  const [isOpen, setIsOpen] = useState(event.type === "tool.failed");

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="border rounded-lg p-3">
        <CollapsibleTrigger className="flex items-center gap-2 w-full text-left hover:bg-accent/50 rounded px-2 py-1 -mx-2 -my-1">
          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <EventIcon type={event.type} />
          <span className="font-medium">{formatEventType(event.type)}</span>
          <span className="text-sm text-muted-foreground ml-auto">
            {formatTimestamp(event.timestamp)}
          </span>
        </CollapsibleTrigger>

        <CollapsibleContent className="mt-2 pt-2 border-t">
          <EventPayload payload={event.payload} />
          {event.durationMs && (
            <div className="text-sm text-muted-foreground mt-2">
              Duration: {event.durationMs}ms
            </div>
          )}
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
```

**Key insight:** The Collapsible component manages its own open/close state. For auto-expanding failed events, initialize the state with `useState(event.type === "tool.failed")`. This satisfies the requirement that failed events are immediately visible while keeping other events collapsed for a clean timeline.

### Pattern 4: Message History as Chat View

**What:** Render the Anthropic Messages API format (stored in `conversations.messages`) as a chat-style interface with user/assistant messages and tool use blocks.

**When to use:** For the message panel.

**Example (`components/conversation-detail/message-panel.tsx`):**
```typescript
// Source: Anthropic Messages API documentation
interface MessagePanelProps {
  messages: unknown[];
}

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

interface ContentBlock {
  type: "text" | "tool_use" | "tool_result";
  text?: string;
  name?: string;
  id?: string;
  input?: Record<string, unknown>;
  content?: string | unknown[];
  is_error?: boolean;
}

export function MessagePanel({ messages }: MessagePanelProps) {
  // Type assertion: messages from DB are Anthropic message format
  const typedMessages = messages as AnthropicMessage[];

  return (
    <div className="space-y-4">
      {typedMessages.map((message, idx) => (
        <MessageBlock key={idx} message={message} />
      ))}
    </div>
  );
}

function MessageBlock({ message }: { message: AnthropicMessage }) {
  const isUser = message.role === "user";
  const contentBlocks = typeof message.content === "string"
    ? [{ type: "text" as const, text: message.content }]
    : message.content;

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-3xl rounded-lg p-4 ${
        isUser ? "bg-primary text-primary-foreground" : "bg-muted"
      }`}>
        <div className="text-sm font-medium mb-2">
          {isUser ? "User" : "Assistant"}
        </div>
        {contentBlocks.map((block, idx) => (
          <ContentBlockRenderer key={idx} block={block} />
        ))}
      </div>
    </div>
  );
}

function ContentBlockRenderer({ block }: { block: ContentBlock }) {
  if (block.type === "text") {
    return <div className="whitespace-pre-wrap">{block.text}</div>;
  }

  if (block.type === "tool_use") {
    return (
      <div className="border rounded p-2 bg-background/50 my-2">
        <div className="text-sm font-medium mb-1">Tool: {block.name}</div>
        <JsonPayload data={block.input} />
      </div>
    );
  }

  if (block.type === "tool_result") {
    return (
      <div className={`border rounded p-2 my-2 ${
        block.is_error ? "border-destructive bg-destructive/10" : "bg-background/50"
      }`}>
        <div className="text-sm font-medium mb-1">
          Tool Result {block.is_error ? "(Error)" : ""}
        </div>
        <JsonPayload data={block.content} />
      </div>
    );
  }

  return null;
}
```

**Key consideration:** The `conversations.messages` field stores the Anthropic Messages API format directly. Each message has a `role` ("user" | "assistant") and `content` (string or array of content blocks). Content blocks can be text, tool_use (tool call), or tool_result (tool response). Tool use blocks should be visually distinct to aid debugging.

### Pattern 5: JSON Payload Display (Simple Approach)

**What:** Display JSON payloads with syntax highlighting using `<pre>` and `<code>` tags with Tailwind typography.

**When to use:** For event payloads and tool use/result blocks in Phase 51 MVP.

**Example (`components/conversation-detail/json-payload.tsx`):**
```typescript
interface JsonPayloadProps {
  data: unknown;
  maxHeight?: string;
}

export function JsonPayload({ data, maxHeight = "300px" }: JsonPayloadProps) {
  const jsonString = JSON.stringify(data, null, 2);

  return (
    <div className="relative">
      <pre
        className="text-xs bg-muted p-2 rounded overflow-auto font-mono"
        style={{ maxHeight }}
      >
        <code>{jsonString}</code>
      </pre>
    </div>
  );
}
```

**Why simple approach:** For the functional MVP (Phase 51), native `<pre>` tags with Tailwind styling are sufficient. External JSON viewer libraries (react-json-view, @uiw/react-json-view) add bundle size and complexity. The user explicitly chose "functional over polished" design direction. If richer JSON interaction is needed later (copying paths, editing, etc.), upgrade to a library in a future iteration phase.

**Alternative for future:** If enhanced JSON viewing is needed, `@uiw/react-json-view` is a lightweight option (no dependencies, TypeScript, 10KB gzipped) that provides collapsible nodes, copy-to-clipboard, and theme support. Install with `pnpm add @uiw/react-json-view` and replace the simple component.

### Pattern 6: Three-Panel Responsive Layout

**What:** Side-by-side layout with event timeline (left), message history (center), and collapsible metadata sidebar (right).

**When to use:** For the conversation detail page root layout.

**Example (`app/conversations/[id]/page.tsx` layout section):**
```typescript
export default async function ConversationDetailPage({ params }: Props) {
  const { id } = await params;
  const [conversation, events, messages] = await Promise.all([
    getConversationById(id),
    getConversationEvents(id),
    getConversationMessages(id),
  ]);

  if (!conversation) notFound();

  return (
    <main className="container mx-auto py-8 px-4">
      {/* Header with breadcrumb */}
      <div className="mb-6">
        <Link href="/conversations" className="text-sm text-muted-foreground hover:underline">
          ← Back to Conversations
        </Link>
        <h1 className="text-2xl font-bold mt-2">{conversation.agentDefinitionId}</h1>
        <p className="text-sm text-muted-foreground">{conversation.id}</p>
      </div>

      {/* Three-panel layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr,1fr,300px] gap-6">
        {/* Event Timeline (left) */}
        <div className="border rounded-lg p-4 overflow-auto" style={{ maxHeight: "80vh" }}>
          <h2 className="text-lg font-semibold mb-4">Event Timeline</h2>
          <EventTimeline events={events} />
        </div>

        {/* Message History (center) */}
        <div className="border rounded-lg p-4 overflow-auto" style={{ maxHeight: "80vh" }}>
          <h2 className="text-lg font-sememibold mb-4">Messages</h2>
          <MessagePanel messages={messages} />
        </div>

        {/* Metadata Sidebar (right) */}
        <div className="border rounded-lg p-4 overflow-auto" style={{ maxHeight: "80vh" }}>
          <MetadataSidebar conversation={conversation} />
        </div>
      </div>
    </main>
  );
}
```

**Responsive behavior:** On large screens (`lg:`), uses three-column grid. On smaller screens, stacks vertically. The metadata sidebar is fixed-width (300px) on desktop, full-width on mobile. Each panel has `maxHeight: 80vh` with `overflow-auto` for independent scrolling.

**Alternative considered:** Tabbed layout (timeline/messages as tabs) was considered but rejected because side-by-side allows comparing timeline events with message content simultaneously, which is better for debugging workflows (the primary use case per the spec).

### Anti-Patterns to Avoid

- **Client-side data fetching:** The detail page should fetch data server-side in the page component, not with `useEffect` in client components. Server-side fetching is faster (no network round trip from browser) and enables better SEO/initial load performance.

- **Importing Anthropic SDK types directly:** The messages array is stored as `unknown[]` in the database schema. Define local TypeScript interfaces (`AnthropicMessage`, `ContentBlock`) in the component files rather than importing from `@anthropic-ai/sdk`. This avoids coupling the dashboard to the agents package dependency tree.

- **Over-engineering JSON display:** Don't add a heavy JSON viewer library in Phase 51. Simple `<pre>` tags satisfy the "functional over polished" requirement. Iterate later if needed.

- **Inline database queries in components:** All queries must go through the service layer (`services/conversations.ts`). Never import `db` directly in React components.

- **Forgetting parent/child conversation links:** The metadata sidebar must show `parentConversationId` as a clickable link to navigate to parent conversations. Sub-agent conversations are a core feature.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Expandable sections | Custom accordion with state management | shadcn/ui Collapsible | Accessible, animated, minimal code |
| Dynamic route params | Manual URL parsing | Next.js [id] folder + await params | Built-in, type-safe, SEO-friendly |
| JSON formatting | Custom recursive renderer | JSON.stringify + `<pre>` | Simple, reliable, no dependencies |
| Timestamp formatting | Manual date calculations | Existing `formatRelativeTime` from Phase 50 | Already implemented in `lib/format.ts` |
| Icon library | Custom SVG components | lucide-react (already installed) | Consistent with Phase 50, 1000+ icons |

**Key insight:** Phase 51 is about assembling existing pieces (Next.js, Drizzle, shadcn/ui) into a new page layout. The dashboard infrastructure from Phase 49 provides 90% of what's needed. Focus on data fetching logic and component composition, not reinventing UI primitives.

## Common Pitfalls

### Pitfall 1: Forgetting to Await Params in Next.js 15

**What goes wrong:** Accessing `params.id` directly without `await params` causes TypeScript errors or runtime crashes because `params` is a Promise in Next.js 15+.

**Why it happens:** In older Next.js versions (pre-15), `params` was a plain object. The App Router changed this to a Promise to support streaming and async data fetching patterns.

**How to avoid:** Always destructure params after awaiting:
```typescript
// WRONG (Next.js 15+)
export default async function Page({ params }: Props) {
  const id = params.id; // Error: Property 'id' does not exist on type 'Promise<...>'
}

// CORRECT
export default async function Page({ params }: Props) {
  const { id } = await params;
}
```

**Warning signs:** TypeScript error "Property 'id' does not exist on type 'Promise<{ id: string }>'" or runtime error "Cannot read property of undefined."

### Pitfall 2: Event Timeline Without Auto-Expand for Errors

**What goes wrong:** All events are collapsed by default, hiding failed tool calls and making debugging harder.

**Why it happens:** Developer forgets the spec requirement: "Failed events (tool.failed) auto-expand so errors are immediately visible."

**How to avoid:** Initialize Collapsible state based on event type:
```typescript
const [isOpen, setIsOpen] = useState(event.type === "tool.failed");
```

**Warning signs:** User has to manually expand every failed event to see error messages. The timeline looks clean but defeats the debugging purpose.

### Pitfall 3: Messages JSONB Type Assertion

**What goes wrong:** Treating `conversations.messages` as a strongly-typed Anthropic message array without type guards causes runtime errors when the data doesn't match expected shape.

**Why it happens:** The database schema stores messages as `jsonb` typed as `unknown[]`. TypeScript can't verify the runtime structure.

**How to avoid:** Use type assertions carefully and add defensive checks:
```typescript
const typedMessages = messages as AnthropicMessage[];

// Defensive check for content format
const contentBlocks = typeof message.content === "string"
  ? [{ type: "text" as const, text: message.content }]
  : message.content;
```

**Warning signs:** Runtime errors like "Cannot read property 'type' of undefined" when rendering message content blocks.

### Pitfall 4: Forgetting Sequence Ordering

**What goes wrong:** Events appear in random order instead of chronological sequence, making the timeline confusing.

**Why it happens:** The query doesn't include `orderBy(asc(agentEvents.sequence))`.

**How to avoid:** Always order by sequence ASC in the service function:
```typescript
const rows = await db
  .select()
  .from(agentEvents)
  .where(eq(agentEvents.conversation_id, conversationId))
  .orderBy(asc(agentEvents.sequence)); // CRITICAL
```

**Warning signs:** Timeline events jump around in time, tool results appear before tool calls.

### Pitfall 5: Large Payload Performance

**What goes wrong:** Rendering very large JSON payloads (e.g., 100KB+ from `read_file` tool results) freezes the browser or causes slow page loads.

**Why it happens:** JSON.stringify and DOM rendering for huge objects is CPU-intensive.

**How to avoid:** Add `maxHeight` and `overflow-auto` to JSON payload containers:
```typescript
<pre className="text-xs bg-muted p-2 rounded overflow-auto" style={{ maxHeight: "300px" }}>
```

Optionally, truncate extremely large payloads with a "Show more" button:
```typescript
const jsonString = JSON.stringify(data, null, 2);
const truncated = jsonString.length > 5000 ? jsonString.slice(0, 5000) + "..." : jsonString;
```

**Warning signs:** Page becomes unresponsive when opening a conversation with large tool results. Browser dev tools show high CPU usage during rendering.

### Pitfall 6: Metadata Sidebar Not Collapsible

**What goes wrong:** The sidebar is always visible, wasting horizontal space when users want to focus on timeline or messages.

**Why it happens:** Developer implements the sidebar as a static div instead of a Collapsible component.

**How to avoid:** Wrap the entire sidebar content in a Collapsible with a trigger button:
```typescript
<Collapsible defaultOpen={true}>
  <div className="flex items-center justify-between mb-2">
    <h2 className="text-lg font-semibold">Metadata</h2>
    <CollapsibleTrigger asChild>
      <Button variant="ghost" size="sm">
        <ChevronDown className="h-4 w-4" />
      </Button>
    </CollapsibleTrigger>
  </div>
  <CollapsibleContent>
    {/* Metadata fields */}
  </CollapsibleContent>
</Collapsible>
```

**Warning signs:** User explicitly asks "can I hide the sidebar?" or the spec requirement is missed.

### Pitfall 7: Missing Parent Conversation Link

**What goes wrong:** Sub-agent conversations don't link back to their parent, breaking navigation.

**Why it happens:** The metadata sidebar doesn't render `parentConversationId` as a clickable link.

**How to avoid:** Add conditional rendering for parent link:
```typescript
{conversation.parentConversationId && (
  <div className="mt-2">
    <span className="text-sm font-medium">Parent Conversation:</span>
    <Link
      href={`/conversations/${conversation.parentConversationId}`}
      className="text-sm text-primary hover:underline ml-2"
    >
      {conversation.parentConversationId}
    </Link>
  </div>
)}
```

**Warning signs:** Users can't navigate from child to parent conversations, breaking the sub-agent debugging workflow.

## Code Examples

### Dynamic Route Page Component

```typescript
// app/conversations/[id]/page.tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  getConversationById,
  getConversationEvents,
  getConversationMessages,
} from "@/services/conversations";
import { EventTimeline } from "@/components/conversation-detail/event-timeline";
import { MessagePanel } from "@/components/conversation-detail/message-panel";
import { MetadataSidebar } from "@/components/conversation-detail/metadata-sidebar";

interface ConversationDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function ConversationDetailPage({
  params,
}: ConversationDetailPageProps) {
  const { id } = await params;

  // Parallel data fetching for performance
  const [conversation, events, messages] = await Promise.all([
    getConversationById(id),
    getConversationEvents(id),
    getConversationMessages(id),
  ]);

  if (!conversation) {
    notFound(); // Built-in Next.js 404 handler
  }

  return (
    <main className="container mx-auto py-8 px-4">
      {/* Breadcrumb navigation */}
      <div className="mb-6">
        <Link
          href="/conversations"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Back to Conversations
        </Link>
        <h1 className="text-2xl font-bold mt-2">
          {conversation.agentDefinitionId}
        </h1>
        <p className="text-sm text-muted-foreground">{conversation.id}</p>
      </div>

      {/* Three-panel layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr,1fr,300px] gap-6">
        {/* Event Timeline */}
        <div className="border rounded-lg p-4 overflow-auto" style={{ maxHeight: "80vh" }}>
          <h2 className="text-lg font-semibold mb-4">Event Timeline</h2>
          <EventTimeline events={events} />
        </div>

        {/* Message History */}
        <div className="border rounded-lg p-4 overflow-auto" style={{ maxHeight: "80vh" }}>
          <h2 className="text-lg font-semibold mb-4">Messages</h2>
          <MessagePanel messages={messages} />
        </div>

        {/* Metadata Sidebar */}
        <div className="border rounded-lg p-4 overflow-auto" style={{ maxHeight: "80vh" }}>
          <MetadataSidebar conversation={conversation} />
        </div>
      </div>
    </main>
  );
}
```

### Event Icon Component

```typescript
// components/conversation-detail/event-icon.tsx
import {
  PlayCircle,
  CheckCircle,
  XCircle,
  MessageCircle,
  PauseCircle,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { AgentEventType } from "@/lib/schema";

const eventIcons: Record<AgentEventType, LucideIcon> = {
  "agent.started": PlayCircle,
  "agent.completed": CheckCircle,
  "agent.paused": PauseCircle,
  "agent.resumed": PlayCircle,
  "tool.called": Zap,
  "tool.succeeded": CheckCircle,
  "tool.failed": XCircle,
  "llm.response": MessageCircle,
  "signal.received": Zap,
};

const eventColors: Record<AgentEventType, string> = {
  "agent.started": "text-blue-500",
  "agent.completed": "text-green-500",
  "agent.paused": "text-yellow-500",
  "agent.resumed": "text-blue-500",
  "tool.called": "text-purple-500",
  "tool.succeeded": "text-green-500",
  "tool.failed": "text-red-500",
  "llm.response": "text-blue-500",
  "signal.received": "text-orange-500",
};

interface EventIconProps {
  type: AgentEventType;
}

export function EventIcon({ type }: EventIconProps) {
  const Icon = eventIcons[type];
  const colorClass = eventColors[type];

  return <Icon className={`h-4 w-4 ${colorClass}`} />;
}
```

### Format Event Type Utility

```typescript
// lib/format.ts (add to existing file)

/**
 * Format an agent event type for display.
 *
 * Converts database enum values to human-readable labels.
 * Examples:
 *   "tool.called" -> "Tool Called"
 *   "llm.response" -> "LLM Response"
 *   "agent.started" -> "Agent Started"
 */
export function formatEventType(type: string): string {
  return type
    .split(".")
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
```

### Metadata Sidebar Component

```typescript
// components/conversation-detail/metadata-sidebar.tsx
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { formatRelativeTime } from "@/lib/format";
import type { ConversationDetail } from "@/services/conversations";

interface MetadataSidebarProps {
  conversation: ConversationDetail;
}

export function MetadataSidebar({ conversation }: MetadataSidebarProps) {
  return (
    <div className="space-y-4">
      {/* Status */}
      <div>
        <div className="text-sm font-medium text-muted-foreground">Status</div>
        <Badge variant={conversation.status === "failed" ? "destructive" : "default"}>
          {conversation.status}
        </Badge>
      </div>

      <Separator />

      {/* Agent Definition */}
      <div>
        <div className="text-sm font-medium text-muted-foreground">Agent</div>
        <div className="text-sm">{conversation.agentDefinitionId}</div>
        <div className="text-xs text-muted-foreground">
          v{conversation.agentDefinitionVersion}
        </div>
      </div>

      {/* Parent Conversation (if sub-agent) */}
      {conversation.parentConversationId && (
        <>
          <Separator />
          <div>
            <div className="text-sm font-medium text-muted-foreground">
              Parent Conversation
            </div>
            <Link
              href={`/conversations/${conversation.parentConversationId}`}
              className="text-sm text-primary hover:underline"
            >
              {conversation.parentConversationId}
            </Link>
          </div>
        </>
      )}

      <Separator />

      {/* Retry Count */}
      <div>
        <div className="text-sm font-medium text-muted-foreground">Retries</div>
        <div className="text-sm">{conversation.retryCount}</div>
      </div>

      {/* Error Message (if failed) */}
      {conversation.errorMessage && (
        <>
          <Separator />
          <div>
            <div className="text-sm font-medium text-destructive">Error</div>
            <div className="text-sm text-destructive">
              {conversation.errorMessage}
            </div>
          </div>
        </>
      )}

      <Separator />

      {/* Timestamps */}
      <div>
        <div className="text-sm font-medium text-muted-foreground">Created</div>
        <div className="text-sm">
          {formatRelativeTime(conversation.createdAt)}
        </div>
      </div>

      <div>
        <div className="text-sm font-medium text-muted-foreground">Updated</div>
        <div className="text-sm">
          {formatRelativeTime(conversation.updatedAt)}
        </div>
      </div>

      {conversation.lastEventAt && (
        <div>
          <div className="text-sm font-medium text-muted-foreground">
            Last Event
          </div>
          <div className="text-sm">
            {formatRelativeTime(conversation.lastEventAt)}
          </div>
        </div>
      )}

      {/* Artifacts (session outputs) */}
      {Object.keys(conversation.artifacts).length > 0 && (
        <>
          <Separator />
          <div>
            <div className="text-sm font-medium text-muted-foreground mb-2">
              Artifacts
            </div>
            {Object.entries(conversation.artifacts).map(([key, value]) => (
              <div key={key} className="text-sm mb-1">
                <span className="font-medium">{key}:</span> {value}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Pages Router `getServerSideProps` | App Router async server components | Next.js 13+ (stable in 15) | Server components fetch data directly, no separate data fetching function |
| Plain `params` object | `params` as Promise | Next.js 15 | Must await params before accessing properties |
| Custom collapsible components | Radix UI primitives via shadcn/ui | 2024+ | Accessible, animated, zero custom logic |
| react-json-view (unmaintained) | @uiw/react-json-view or native `<pre>` | 2025+ | Original library archived, new forks or native approach |
| Separate timeline/messages pages | Side-by-side panels | Developer tool UX trend (Vercel, Linear) | Better debugging experience, compare events with messages |

**Deprecated/outdated:**
- `getServerSideProps` and `getStaticProps` - replaced by async server components
- `params` as plain object - now a Promise in Next.js 15+
- `react-json-view` (mac-s-g) - archived in 2023, use @uiw/react-json-view or native

## Open Questions

1. **Sub-Agent Event Display Strategy**
   - What we know: Sub-agents create child conversations with their own `agent_events` rows. The user has discretion over how to present these.
   - What's unclear: Whether to show child events inline (nested timeline), as links only, or one level deep with recursion warning.
   - Recommendation: Phase 51 MVP shows parent conversation only, with child conversations as links in the metadata sidebar. Inline nested events can be added in an iteration phase if needed. This keeps the implementation simple and avoids complexity around recursive sub-agent rendering.

2. **System Prompt Display in Messages**
   - What we know: The Anthropic Messages API includes a system prompt (separate from messages array). The user has discretion over how to display it.
   - What's unclear: Whether the system prompt is stored in `conversations.messages` or elsewhere in the conversation data.
   - Recommendation: Investigate the actual stored message structure. If system prompt is in the messages array, render it as a distinct message block (different color, "System" label, collapsed by default). If not stored, omit it from Phase 51.

3. **Tool Result Content Type Handling**
   - What we know: Tool result `content` can be string or unknown[] (multi-block responses).
   - What's unclear: How often multi-block tool results occur and whether special rendering is needed.
   - Recommendation: Handle both cases defensively: `typeof content === "string" ? content : JSON.stringify(content)`. If multi-block rendering becomes important, iterate in a follow-up phase.

4. **Syntax Highlighting for Code Blocks**
   - What we know: The user has discretion over syntax highlighting approach. Messages may contain code blocks.
   - What's unclear: Whether the Anthropic Messages API marks code blocks with language metadata, or if they're just text.
   - Recommendation: Phase 51 uses plain `<pre>` tags. If syntax highlighting is needed, add `@uiw/react-json-view` for JSON and consider `shiki` for code blocks in a future phase. Don't add it now without evidence it's needed.

5. **Real-Time Updates**
   - What we know: Phase 55 handles real-time event streaming. Phase 51 is static/server-fetched data.
   - What's unclear: Whether the page should show a "this conversation is running" indicator when status is "running" or "waiting".
   - Recommendation: Show status badge in metadata sidebar. Don't add polling or SSE in Phase 51 -- that's Phase 55's domain.

## Sources

### Primary (HIGH confidence)

- [Next.js Dynamic Routes Documentation](https://nextjs.org/docs/app/building-your-application/routing/dynamic-routes) - Official Next.js docs for [id] routes and async params
- [shadcn/ui Collapsible Component](https://ui.shadcn.com/docs/components/collapsible) - Official shadcn/ui component docs
- [Anthropic Messages API Documentation](https://platform.claude.com/docs/en/build-with-claude/working-with-messages) - Official Anthropic API message format
- Existing codebase analysis:
  - `/packages/dashboard/src/services/conversations.ts` - Service layer pattern
  - `/packages/dashboard/src/lib/schema.ts` - Local schema definitions
  - `/packages/dashboard/src/app/conversations/page.tsx` - Phase 50 conversations list
  - `/packages/agents/src/shared/db/schema.ts` - Canonical database schema

### Secondary (MEDIUM confidence)

- [Next.js Dynamic Route Segments Guide 2026](https://thelinuxcode.com/nextjs-dynamic-route-segments-in-the-app-router-2026-guide/) - Community guide for dynamic routes
- [Radix UI Collapsible API Reference](https://www.radix-ui.com/docs/primitives/components/collapsible) - Underlying primitive docs
- [7 Best React JSON Viewer Components](https://reactscript.com/best-json-viewer/) - React JSON viewer library comparison
- [react-json-view-lite on npm](https://www.npmjs.com/package/react-json-view-lite) - Lightweight JSON viewer
- [@uiw/react-json-view on npm](https://www.npmjs.com/package/@uiw/react-json-view) - Maintained JSON viewer (no dependencies)

### Tertiary (LOW confidence)

- WebSearch results for "three column layout responsive React dashboard" - General layout patterns, not specific to this phase

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all libraries already installed from Phase 49, shadcn components well-documented
- Architecture: HIGH - patterns derived from existing Phase 50 implementation and official Next.js/shadcn docs
- Service layer: HIGH - extends existing `conversations.ts` with same pattern
- Message format: HIGH - Anthropic Messages API is official and stable
- JSON display: MEDIUM - native `<pre>` approach is simple but may need iteration based on actual payload sizes
- Layout: MEDIUM - three-panel responsive pattern is common but exact proportions need testing

**Research date:** 2026-02-04
**Valid until:** 2026-03-06 (30 days - stack is stable, Next.js 15.5.x in maintenance)
