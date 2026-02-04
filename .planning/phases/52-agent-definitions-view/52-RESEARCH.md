# Phase 52: Agent Definitions View - Research

**Researched:** 2026-02-04
**Domain:** Next.js server components, agent-service HTTP API integration, Markdown rendering, shadcn/ui dashboard patterns
**Confidence:** HIGH

## Summary

Phase 52 builds two pages: an agent list page (`/agents`) and an agent detail page (`/agents/[id]`). The agent list pulls data from the agent-service registry API (`GET /api/agents/registry`), and the detail page pulls the full definition including system prompt (`GET /api/agents/registry/:id`). Recent conversations for the detail page come from the existing database via the conversations service layer.

This phase introduces a new data source pattern to the dashboard: HTTP fetching from the agent-service API. Previous phases (50, 51) only used direct Drizzle database queries. The agent registry data lives in-memory in the agent-service (loaded from YAML files at startup), not in the database, so HTTP fetching is the correct approach. The dashboard needs an agent-service client module (`lib/agent-service.ts`) that handles the HTTP request, error handling, and type definitions for the API responses.

The system prompt rendering requirement (AGNT-03) needs a Markdown library. The prompts use mixed content: plain text, XML-like tags (`<identity>`, `<constraints>`), Markdown formatting (headers, lists, code blocks, bold), and occasionally code fences. The `react-markdown` library (v10+) provides `Markdown` for synchronous rendering in server components -- it does not require `"use client"`, keeping the library out of the client bundle. Since the prompts are 2-10KB (not 2000+ lines as initially estimated), the collapsible behavior is still valuable but not critical for performance.

**Primary recommendation:** Create a server-side agent-service HTTP client (`lib/agent-service.ts`), use `react-markdown` for system prompt rendering in a server component, install shadcn/ui Card + Tabs components for the detail page layout, and reuse existing service layer patterns for the recent conversations query.

## Standard Stack

### Core (New dependencies for this phase)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| react-markdown | ^10.0.0 | Render system prompts as Markdown | RSC-compatible, 15.5k GitHub stars, synchronous `Markdown` component works in server components without `"use client"` |

### Already Available (from Phase 49-51)

| Library | Version | Purpose | Status |
|---------|---------|---------|--------|
| next | 15.5.9 | Framework with App Router | Installed |
| react / react-dom | ^19.0.3 | UI library | Installed |
| tailwindcss | ^4.0.0 | Styling | Configured |
| drizzle-orm | ^0.45.1 | Database queries (conversations) | Configured with local schema |
| lucide-react | ^0.400.0 | Icons | Installed |
| shadcn/ui collapsible | N/A | Expandable/collapsible sections | Installed (Phase 51) |
| shadcn/ui badge | N/A | Status badges | Installed (Phase 50) |
| shadcn/ui separator | N/A | Visual dividers | Installed (Phase 51) |
| shadcn/ui skeleton | N/A | Loading states | Installed (Phase 50) |
| shadcn/ui table | N/A | Table component | Installed (Phase 50) |

### shadcn/ui Components to Install

| Component | Command | Purpose |
|-----------|---------|---------|
| card | `pnpm dlx shadcn@latest add card` | Agent list cards, configuration sections on detail page |
| tabs | `pnpm dlx shadcn@latest add tabs` | Section tabs on detail page (Configuration, System Prompt, Recent Conversations) |
| tooltip | `pnpm dlx shadcn@latest add tooltip` | Tool name tooltips, truncated description hovers |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| react-markdown | markdown-to-jsx | markdown-to-jsx auto-detects RSC vs client but is less commonly used. react-markdown has stronger ecosystem (remark/rehype plugins) and wider adoption. |
| react-markdown | Raw `<pre>` with whitespace-pre-wrap | Loses Markdown formatting (headers, bold, lists, code blocks). Prompts use real Markdown syntax so rendering is valuable. |
| Card-based agent list | Table-based agent list | Cards better suit the agent list because each agent has varied metadata (some have sub-agents, some have triggers, some don't). Cards handle variable-height content naturally. Tables work better for uniform columnar data (conversations). |
| Tabs on detail page | Accordion/collapsible sections | Tabs are better for the detail page because the three sections (Config, Prompt, Conversations) are distinct concerns. Tabs hide inactive content entirely, keeping focus clean. |

**Installation:**
```bash
cd packages/dashboard
pnpm add react-markdown
pnpm dlx shadcn@latest add card tabs tooltip
```

## Architecture Patterns

### Recommended Project Structure

```
packages/dashboard/src/
  app/
    agents/
      page.tsx                    # Server component: agent list page
      loading.tsx                 # Skeleton loading state
      [id]/
        page.tsx                  # Server component: agent detail page
        loading.tsx               # Skeleton loading state
  components/
    agents/
      agent-card.tsx              # Single agent card for list view
      agent-config-panel.tsx      # Configuration display (model, iterations, budget, history)
      agent-tools-list.tsx        # Tools grouped by namespace with links
      agent-sub-agents.tsx        # Sub-agent references with links
      agent-prompt-viewer.tsx     # Markdown-rendered system prompt (collapsible)
      agent-recent-conversations.tsx  # Recent conversations table
      agent-type-badge.tsx        # Orchestrator vs sub-agent badge
    ui/
      card.tsx                    # shadcn component (add via CLI)
      tabs.tsx                    # shadcn component (add via CLI)
      tooltip.tsx                 # shadcn component (add via CLI)
  services/
    agents.ts                     # NEW: Agent-service HTTP client + recent conversations query
  lib/
    agent-service.ts              # NEW: HTTP client for agent-service API
```

### Pattern 1: Agent-Service HTTP Client (Server-Side Only)

**What:** A server-side module that fetches agent registry data from the agent-service API. This is new to the dashboard -- previous phases only used direct DB access.

**When to use:** Any data that lives in the agent-service runtime (registry, worker status) rather than the database.

**Example (`lib/agent-service.ts`):**
```typescript
// Server-side only -- never import in "use client" components
const AGENT_SERVICE_URL = process.env.AGENT_SERVICE_URL ?? "http://localhost:3004";

interface FetchOptions {
  /** Request timeout in milliseconds */
  timeout?: number;
}

/**
 * Fetch from agent-service API with error handling and timeout.
 * Returns null on 404, throws on other errors.
 */
async function fetchAgentService<T>(
  path: string,
  options: FetchOptions = {}
): Promise<T | null> {
  const { timeout = 5000 } = options;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(`${AGENT_SERVICE_URL}${path}`, {
      signal: controller.signal,
      headers: { "Accept": "application/json" },
      // Next.js fetch cache: revalidate every 60 seconds
      next: { revalidate: 60 },
    });

    if (response.status === 404) return null;

    if (!response.ok) {
      throw new Error(
        `Agent service error: ${response.status} ${response.statusText}`
      );
    }

    return response.json() as Promise<T>;
  } finally {
    clearTimeout(timeoutId);
  }
}

export { fetchAgentService, AGENT_SERVICE_URL };
```

**Key details:**
- The agent-service runs at `http://agent-service:3004` in Docker and `http://localhost:3004` locally
- Environment variable `AGENT_SERVICE_URL` configures the base URL
- Must be added to Docker Compose environment for the dashboard service
- Uses Next.js `fetch` with `next: { revalidate: 60 }` for ISR-style caching (agent definitions change rarely)
- `AbortController` prevents hanging requests if agent-service is down

### Pattern 2: Service Layer for Agent Registry Data

**What:** A service module (`services/agents.ts`) that combines agent-service API data with database queries for a typed interface.

**When to use:** All agent-related data access from pages and components.

**Example (`services/agents.ts`):**
```typescript
import { desc, eq, count } from "drizzle-orm";
import { db } from "@/lib/db";
import { conversations, agentEvents, agentSessions } from "@/lib/schema";
import { fetchAgentService } from "@/lib/agent-service";

// ─── Types (mirror API response types) ─────────────────────────────────────

export interface AgentSummary {
  id: string;
  name: string;
  description: string;
  version: string;
  model: string;
  temperature?: number;
  tools: string[];
  subAgents?: Record<string, string>;
  maxIterations: number;
  tokenBudget: number;
  history: {
    pruneThreshold: number;
    protectedMessages: number;
    summaryThreshold: number;
    summaryModel: string;
  };
  triggers?: Array<{ event: string }>;
}

export interface AgentDetail extends AgentSummary {
  systemPrompt: string;
}

export interface RecentConversation {
  id: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  lastActivity: Date | null;
  tokenInput: number;
  tokenOutput: number;
}

// ─── Agent Registry Queries ─────────────────────────────────────────────────

export async function listAgents(): Promise<AgentSummary[]> {
  const agents = await fetchAgentService<AgentSummary[]>("/api/agents/registry");
  return agents ?? [];
}

export async function getAgentById(id: string): Promise<AgentDetail | null> {
  return fetchAgentService<AgentDetail>(`/api/agents/registry/${id}`);
}

// ─── Recent Conversations Query (from DB) ───────────────────────────────────

export async function getRecentConversations(
  agentDefinitionId: string,
  limit = 10
): Promise<RecentConversation[]> {
  // Token aggregation subquery (same pattern as Phase 50)
  const tokenAgg = db
    .select({
      conversation_id: agentEvents.conversation_id,
      total_input: sql<number>`coalesce(sum(${agentEvents.token_count_input}), 0)`.as("total_input"),
      total_output: sql<number>`coalesce(sum(${agentEvents.token_count_output}), 0)`.as("total_output"),
    })
    .from(agentEvents)
    .where(eq(agentEvents.type, "llm.response"))
    .groupBy(agentEvents.conversation_id)
    .as("token_agg");

  const rows = await db
    .select({
      id: conversations.id,
      status: conversations.status,
      created_at: conversations.created_at,
      updated_at: conversations.updated_at,
      last_event_at: agentSessions.last_event_at,
      token_input: sql<number>`coalesce(${tokenAgg.total_input}, 0)`,
      token_output: sql<number>`coalesce(${tokenAgg.total_output}, 0)`,
    })
    .from(conversations)
    .leftJoin(agentSessions, eq(agentSessions.conversation_id, conversations.id))
    .leftJoin(tokenAgg, eq(tokenAgg.conversation_id, conversations.id))
    .where(eq(conversations.agent_definition_id, agentDefinitionId))
    .orderBy(desc(conversations.created_at))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastActivity: row.last_event_at,
    tokenInput: Number(row.token_input),
    tokenOutput: Number(row.token_output),
  }));
}
```

### Pattern 3: Server Component Page with HTTP API + DB Fetch

**What:** The agent detail page combines two data sources: agent-service API (definition) and database (conversations).

**When to use:** The agent detail page.

**Example (`app/agents/[id]/page.tsx`):**
```typescript
import { notFound } from "next/navigation";
import Link from "next/link";
import { getAgentById, getRecentConversations } from "@/services/agents";

interface AgentDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function AgentDetailPage({ params }: AgentDetailPageProps) {
  const { id } = await params;

  // Fetch from agent-service API and DB in parallel
  const [agent, recentConversations] = await Promise.all([
    getAgentById(id),
    getRecentConversations(id),
  ]);

  if (!agent) {
    notFound();
  }

  return (
    <main className="container mx-auto py-8 px-4">
      {/* Header */}
      <div className="mb-6">
        <Link href="/agents" className="text-sm text-muted-foreground hover:text-foreground">
          &larr; Back to Agents
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">{agent.name}</h1>
        <p className="text-muted-foreground">{agent.description}</p>
      </div>

      {/* Tabbed content: Configuration, System Prompt, Recent Conversations */}
      {/* ... */}
    </main>
  );
}
```

### Pattern 4: Distinguishing Orchestrator vs Sub-Agent

**What:** Agents with `triggers` are orchestrator agents (started by external events). Agents without `triggers` are sub-agents (spawned by orchestrators). This distinction should be visually clear in the UI.

**When to use:** Agent list cards and detail pages.

**Detection logic:**
```typescript
function isOrchestrator(agent: AgentSummary): boolean {
  return Boolean(agent.triggers && agent.triggers.length > 0);
}

function hasSubAgents(agent: AgentSummary): boolean {
  return Boolean(agent.subAgents && Object.keys(agent.subAgents).length > 0);
}
```

**Current agents in the system:**
| Agent | Type | Has Triggers | Has Sub-Agents |
|-------|------|-------------|----------------|
| dev-agent | Orchestrator | `linear.agent_session.created` | researcher, coder, tester |
| product-agent | Orchestrator | `slack.app_mention.created` | None |
| coder | Sub-agent | None | None |
| researcher | Sub-agent | None | None |
| tester | Sub-agent | None | None |

### Pattern 5: Tool Namespace Grouping

**What:** Group tools by namespace prefix for organized display. Tools follow `namespace:tool_name` format.

**When to use:** Agent detail page tools section.

**Example:**
```typescript
function groupToolsByNamespace(tools: string[]): Record<string, string[]> {
  const groups: Record<string, string[]> = {};
  for (const tool of tools) {
    const [namespace, name] = tool.split(":");
    if (!groups[namespace]) groups[namespace] = [];
    groups[namespace].push(name);
  }
  return groups;
}

// Result for dev-agent:
// {
//   codebase: ["read_file", "search_codebase", "list_directory"],
//   coordination: ["spawn_agent", "request_human_input", "wait_for"],
//   linear: ["get_issue", "update_issue_status"],
//   github: ["create_branch", "create_commit", "create_pull_request", "get_pull_request"],
//   slack: ["send_message", "send_approval_request"],
// }
```

### Pattern 6: System Prompt Rendering with react-markdown

**What:** Render the system prompt Markdown content using `react-markdown` in a server component, wrapped in a Collapsible for long prompts.

**When to use:** Agent detail page system prompt section.

**Example (`components/agents/agent-prompt-viewer.tsx`):**
```typescript
// Server component -- no "use client" needed
import Markdown from "react-markdown";

interface AgentPromptViewerProps {
  content: string;
}

export function AgentPromptViewer({ content }: AgentPromptViewerProps) {
  return (
    <div className="prose prose-sm max-w-none dark:prose-invert">
      <Markdown>{content}</Markdown>
    </div>
  );
}
```

**Note on XML tags in prompts:** The system prompts contain XML-like tags (`<identity>`, `<constraints>`, etc.) which react-markdown will ignore by default (it strips unknown HTML tags for security). This is acceptable -- the XML tags are structural markers for the LLM, not content that needs visual rendering. The plain text, Markdown headers, lists, code blocks, and formatting between the tags will render correctly.

**Collapsible wrapper** (client component for toggle state):
```typescript
"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";

interface CollapsiblePromptProps {
  children: React.ReactNode;
  defaultOpen?: boolean;
}

export function CollapsiblePrompt({ children, defaultOpen = false }: CollapsiblePromptProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {isOpen ? "Collapse" : "Expand"} system prompt
        </span>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm">
            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <div className="mt-2 max-h-[600px] overflow-auto rounded-lg border bg-muted/30 p-4">
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
```

### Anti-Patterns to Avoid

- **Fetching agent registry data from the database:** Agent definitions live in memory in the agent-service (loaded from YAML). There is no `agent_definitions` table. Always use the HTTP API.

- **Importing from @aesir/agents:** The dashboard must not import from the agents package. Types should be defined locally in the service/component files, mirroring the API response shape.

- **Using `"use client"` for the Markdown renderer:** The `Markdown` component from `react-markdown` works in server components. Wrapping it in a client component would ship the entire remark/rehype pipeline to the browser. Only the Collapsible toggle wrapper needs `"use client"`.

- **Hardcoding agent-service URL:** Use `process.env.AGENT_SERVICE_URL` with a sensible default. Docker uses `http://agent-service:3004`, local dev uses `http://localhost:3004`.

- **Fetching the full definition (with systemPrompt) for the list page:** The list endpoint deliberately excludes `systemPrompt` to keep responses lightweight. Only the detail endpoint includes it.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Markdown rendering | Custom regex-based parser | `react-markdown` | Handles edge cases (nested lists, code blocks, tables), RSC-compatible, well-maintained |
| Tool namespace grouping display | Flat comma-separated list | `groupToolsByNamespace()` utility + namespace section headers | Grouped display is far more readable for agents with 14+ tools |
| Agent type detection | Hardcoded agent ID checks | Check `triggers` presence: `agent.triggers?.length > 0` = orchestrator | Self-documenting, works for future agents without code changes |
| HTTP fetch with timeout | Raw `fetch` with no error handling | Centralized `fetchAgentService()` in `lib/agent-service.ts` | Consistent timeout, error handling, caching, and URL management |
| Recent conversations query | New query from scratch | Adapt existing `listConversations` pattern from Phase 50 service | Same token aggregation subquery, just filtered by `agent_definition_id` with smaller limit |
| Status badge rendering | New status badge component | Reuse existing `StatusBadge` from `components/conversations/status-badge.tsx` | Already implemented, tested, and styled consistently |

**Key insight:** Phase 52 primarily assembles existing patterns. The only genuinely new patterns are the agent-service HTTP client and the Markdown rendering. Everything else (service layer, server components, badges, tables, formatting) has been established in Phases 49-51.

## Common Pitfalls

### Pitfall 1: Agent-Service Unavailable

**What goes wrong:** The agents page crashes or shows a white screen when the agent-service is not running.
**Why it happens:** The HTTP fetch to `GET /api/agents/registry` fails with ECONNREFUSED or timeout.
**How to avoid:** The `fetchAgentService` function must handle network errors gracefully. The page should show a clear error state ("Agent service unavailable") with guidance, not crash.
**Warning signs:** Unhandled promise rejection in server component, Next.js error boundary triggered.

```typescript
// In the page component
try {
  const agents = await listAgents();
  // render agents
} catch (error) {
  // render error state with retry guidance
  return <AgentServiceError />;
}
```

### Pitfall 2: Docker Network vs Local Development URL

**What goes wrong:** Agent-service fetch works in Docker but fails locally, or vice versa.
**Why it happens:** In Docker, the agent-service hostname is `agent-service` (Docker network name). Locally, it's `localhost:3004`. The base URL must be configurable.
**How to avoid:** Use environment variable `AGENT_SERVICE_URL`:
- Docker Compose: `AGENT_SERVICE_URL=http://agent-service:3004`
- Local dev: defaults to `http://localhost:3004`
**Warning signs:** ENOTFOUND or ECONNREFUSED errors that only happen in one environment.

### Pitfall 3: react-markdown Stripping XML Tags

**What goes wrong:** System prompt appears to be missing sections or has incomplete content.
**Why it happens:** System prompts use XML-like tags (`<identity>`, `<constraints>`, etc.) which react-markdown strips by default as unrecognized HTML.
**How to avoid:** This is actually the correct behavior -- the XML tags are structural markers for the LLM, not visual content. The text between the tags renders correctly. However, document this so developers don't think content is missing.
**Warning signs:** Developer compares raw prompt text with rendered output and notices missing `<tag>` markers.

### Pitfall 4: Forgetting to Add AGENT_SERVICE_URL to Docker Compose

**What goes wrong:** Dashboard works locally but cannot reach agent-service in Docker.
**Why it happens:** The Docker Compose file for the dashboard service doesn't include `AGENT_SERVICE_URL=http://agent-service:3004`.
**How to avoid:** Add the environment variable to the dashboard service in `docker-compose.yml`.
**Warning signs:** Dashboard crashes with ECONNREFUSED in Docker but works fine with `pnpm dev`.

### Pitfall 5: Next.js Fetch Caching Serving Stale Registry Data

**What goes wrong:** Agent definition changes (after restarting agent-service with updated YAML) don't appear in the dashboard.
**Why it happens:** Next.js caches `fetch` results by default in server components. Without explicit revalidation, stale data persists.
**How to avoid:** Use `next: { revalidate: 60 }` in the fetch options. This gives a 60-second ISR window -- fresh enough for a config dashboard, but avoids hitting the agent-service on every page load.
**Warning signs:** Changes to agent definitions don't appear until the dashboard is restarted.

### Pitfall 6: Missing `await params` in Next.js 15

**What goes wrong:** TypeScript error when accessing `params.id` without awaiting.
**Why it happens:** Same as Phases 50/51 -- Next.js 15 changed `params` to a Promise.
**How to avoid:** Always `const { id } = await params;` at the top of the page component.
**Warning signs:** TypeScript error "Property 'id' does not exist on type 'Promise<...>'"

### Pitfall 7: Linking to Non-Existent Tool Dashboard

**What goes wrong:** Tool links on the agent detail page navigate to `/tools?tool=namespace:tool_name` which returns 404.
**Why it happens:** Phase 53 (tool dashboard) hasn't been built yet.
**How to avoid:** This is expected and acceptable per the context decisions. The links are future-ready -- they will work once Phase 53 ships. Implement the links now so the URLs are correct.
**Warning signs:** None -- this is by design.

## Code Examples

### Agent List Page

```typescript
// app/agents/page.tsx
import { listAgents } from "@/services/agents";
import { AgentCard } from "@/components/agents/agent-card";

export default async function AgentsPage() {
  let agents;
  try {
    agents = await listAgents();
  } catch {
    return (
      <main className="container mx-auto py-8 px-4">
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">Agents</h1>
          <p className="text-muted-foreground">Agent definitions loaded from the runtime registry</p>
        </div>
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-6 text-center">
          <p className="font-medium text-destructive">Unable to reach agent service</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Ensure the agent service is running at the configured URL.
          </p>
        </div>
      </main>
    );
  }

  // Separate orchestrators and sub-agents for visual grouping
  const orchestrators = agents.filter(a => a.triggers && a.triggers.length > 0);
  const subAgents = agents.filter(a => !a.triggers || a.triggers.length === 0);

  return (
    <main className="container mx-auto py-8 px-4">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Agents</h1>
        <p className="text-muted-foreground">
          {agents.length} agent definitions loaded from the runtime registry
        </p>
      </div>

      {orchestrators.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-4 text-lg font-semibold">Orchestrators</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {orchestrators.map(agent => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
          </div>
        </section>
      )}

      {subAgents.length > 0 && (
        <section>
          <h2 className="mb-4 text-lg font-semibold">Sub-Agents</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {subAgents.map(agent => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
```

### Agent Card Component

```typescript
// components/agents/agent-card.tsx
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AgentSummary } from "@/services/agents";

interface AgentCardProps {
  agent: AgentSummary;
}

export function AgentCard({ agent }: AgentCardProps) {
  const isOrchestrator = Boolean(agent.triggers && agent.triggers.length > 0);
  const subAgentCount = agent.subAgents ? Object.keys(agent.subAgents).length : 0;
  const toolCount = agent.tools.length;

  return (
    <Link href={`/agents/${agent.id}`}>
      <Card className="h-full transition-colors hover:border-foreground/20">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">{agent.name}</CardTitle>
            <Badge variant={isOrchestrator ? "default" : "secondary"}>
              {isOrchestrator ? "Orchestrator" : "Sub-agent"}
            </Badge>
          </div>
          <CardDescription className="line-clamp-2">{agent.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span>{agent.model}</span>
            <span>{toolCount} tools</span>
            {subAgentCount > 0 && <span>{subAgentCount} sub-agents</span>}
            {agent.triggers?.map(t => (
              <Badge key={t.event} variant="outline" className="text-xs">
                {t.event}
              </Badge>
            ))}
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            v{agent.version}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
```

### Tool Namespace Grouping Utility

```typescript
// In components/agents/agent-tools-list.tsx or lib/agent-utils.ts

const namespaceLabels: Record<string, string> = {
  codebase: "Codebase",
  coordination: "Coordination",
  linear: "Linear",
  github: "GitHub",
  slack: "Slack",
};

const namespaceColors: Record<string, string> = {
  codebase: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
  coordination: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  linear: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  github: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  slack: "bg-pink-100 text-pink-700 dark:bg-pink-900 dark:text-pink-300",
};

function groupToolsByNamespace(tools: string[]): Record<string, string[]> {
  const groups: Record<string, string[]> = {};
  for (const tool of tools) {
    const colonIndex = tool.indexOf(":");
    const namespace = tool.slice(0, colonIndex);
    const name = tool.slice(colonIndex + 1);
    if (!groups[namespace]) groups[namespace] = [];
    groups[namespace].push(name);
  }
  return groups;
}
```

### Recent Conversations Mini-Table

```typescript
// components/agents/agent-recent-conversations.tsx
import Link from "next/link";
import { StatusBadge } from "@/components/conversations/status-badge";
import { formatDuration, formatRelativeTime, formatTokenCount } from "@/lib/format";
import type { RecentConversation } from "@/services/agents";

interface AgentRecentConversationsProps {
  conversations: RecentConversation[];
  agentId: string;
}

export function AgentRecentConversations({
  conversations,
  agentId,
}: AgentRecentConversationsProps) {
  if (conversations.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        No conversations yet for this agent.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {conversations.map((conv) => (
        <Link
          key={conv.id}
          href={`/conversations/${conv.id}`}
          className="flex items-center justify-between rounded-lg border px-4 py-3 transition-colors hover:bg-muted/50"
        >
          <div className="flex items-center gap-3">
            <StatusBadge status={conv.status} />
            <span className="text-sm">
              {formatDuration(conv.createdAt, conv.updatedAt)}
            </span>
          </div>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span>{formatTokenCount(conv.tokenInput + conv.tokenOutput)} tokens</span>
            <span>{formatRelativeTime(conv.lastActivity)}</span>
          </div>
        </Link>
      ))}

      <Link
        href={`/conversations?agent=${agentId}`}
        className="block text-center text-sm text-primary hover:underline"
      >
        View all conversations
      </Link>
    </div>
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Client-side fetch for API data | Server component fetch with `next: { revalidate }` | Next.js 13+ (stable in 15) | API data fetched server-side, cached with ISR, no client JS needed |
| Import Markdown library in client bundle | Use `react-markdown` in server component | react-markdown v10 (2024-2025) | Markdown parsing stays server-side, zero client bundle impact |
| Custom Markdown regex parsers | react-markdown with remark/rehype ecosystem | Long-standing | Handles edge cases, extensible with plugins |
| Flat tool lists | Namespace-grouped display | Dashboard convention | Better readability for agents with many tools |

**Deprecated/outdated:**
- `getServerSideProps`: Replaced by server components with async data fetching in App Router
- react-markdown v8/v9 with `MarkdownHooks` for server: v10+ `Markdown` (default export) works directly in server components
- Client-side only API calls for config data: Server components handle this natively with caching

## Open Questions

1. **react-markdown Tailwind Typography Integration**
   - What we know: `react-markdown` renders standard HTML elements (`<h1>`, `<p>`, `<ul>`, etc.). Tailwind's `@tailwindcss/typography` plugin provides the `prose` class for styling these elements consistently.
   - What's unclear: Whether `@tailwindcss/typography` is already installed or needs to be added. Tailwind CSS 4 changed how plugins work.
   - Recommendation: Check if `prose` classes work with the current Tailwind 4 setup. If not, the `prose` classes can be approximated with custom CSS in `globals.css` for the specific elements react-markdown produces (`h1-h6`, `p`, `ul`, `ol`, `li`, `code`, `pre`, `blockquote`). Alternatively, use react-markdown's `components` prop to apply Tailwind classes directly to each element.

2. **Agent Service Fetch Caching Strategy**
   - What we know: Next.js `fetch` supports `revalidate` for ISR. Agent definitions change rarely (only when YAML files change and the service restarts).
   - What's unclear: The optimal revalidation interval. 60 seconds seems reasonable, but a "refresh" button on the page could also use `revalidatePath` or `revalidateTag`.
   - Recommendation: Start with `next: { revalidate: 60 }`. If users need immediate refresh after agent-service restart, add a "Refresh" button that calls a server action with `revalidatePath("/agents")`.

3. **XML Tag Visibility in Rendered Prompts**
   - What we know: Prompts use `<identity>`, `<constraints>`, `<workflow_guidance>` XML tags. react-markdown strips unknown HTML by default.
   - What's unclear: Whether users want to see the XML structural tags or if the rendered content between them is sufficient.
   - Recommendation: Default behavior (strip XML tags) is correct for reading the prompt as documentation. If users want the raw text, add a "Raw" toggle that shows the prompt in a `<pre>` block. This can be done with a simple client-side toggle.

## Sources

### Primary (HIGH confidence)
- Existing codebase analysis:
  - `/packages/dashboard/src/` -- all existing components, services, patterns
  - `/packages/agents/src/service/api/agents-registry.ts` -- API endpoint implementation
  - `/packages/agents/src/service/api/types.ts` -- `AgentRegistrySummary`, `AgentRegistryDetail` response types
  - `/packages/agents/src/framework/types.ts` -- `AgentDefinition`, `AgentRegistry` interfaces
  - `/packages/agents/definitions/*/definition.yaml` -- all 5 agent definition files
  - `/packages/agents/definitions/*/prompt.md` -- system prompt content (2-10KB each)
  - `docker-compose.yml` -- agent-service at port 3004, Docker network name `agent-service`
- Phase 49-51 research and implementation: established patterns for service layer, server components, shadcn/ui
- [react-markdown GitHub](https://github.com/remarkjs/react-markdown) -- v10 exports, RSC compatibility, `Markdown` vs `MarkdownAsync` vs `MarkdownHooks`

### Secondary (MEDIUM confidence)
- [Next.js Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components) -- RSC patterns for fetch and rendering
- [react-markdown RSC discussion](https://github.com/orgs/remarkjs/discussions/1228) -- confirmed RSC compatibility
- Web search results for react-markdown RSC compatibility in 2025-2026: multiple sources confirm `Markdown` default export works in server components

### Tertiary (LOW confidence)
- None -- all findings verified against primary sources (codebase + official docs)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- react-markdown RSC compatibility confirmed, all other libraries already installed
- Architecture: HIGH -- patterns derived from existing Phase 49-51 codebase and agent-service API types
- Service layer: HIGH -- extends established dashboard service pattern with HTTP client addition
- Agent-service HTTP client: HIGH -- API endpoints verified in source code, Docker networking confirmed
- Markdown rendering: MEDIUM -- react-markdown works in server components per docs, but XML tag handling in system prompts needs implementation-time validation
- Pitfalls: HIGH -- identified from real codebase analysis (Docker networking, fetch caching, environment variables)

**Research date:** 2026-02-04
**Valid until:** 2026-03-06 (30 days -- stack is stable, Next.js 15.5.x in maintenance mode)
