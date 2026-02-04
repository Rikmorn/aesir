# Roadmap: Aesir v2.4 Operations Dashboard

## Overview

Real-time visibility into agent execution through a developer-focused web dashboard. The roadmap delivers agent-service API extensions first (runtime state that doesn't live in the database), then the Next.js dashboard infrastructure, followed by four independently verifiable view pages (conversations list, conversation detail, agents, tools), the system overview landing page, and finally real-time SSE wiring across all views. Each view phase produces a visually inspectable page.

## Milestones

- v1.0 MVP -- Phases 1-9 (shipped 2026-01-19)
- v2.0 Foundation -- Phases 10-22 (shipped 2026-01-25)
- v2.1 Agents That Ship -- Phases 23-27 (shipped 2026-01-28)
- v2.2 Agentic Architecture -- Phases 28-36 (shipped 2026-01-31)
- v2.3 Unified Agent Framework -- Phases 37-47.1 (shipped 2026-02-04)
- v2.4 Operations Dashboard -- Phases 48-55 (in progress)

## Phases

**Phase Numbering:**
- Integer phases (48, 49, ...): Planned milestone work
- Decimal phases (48.1, 48.2): Urgent insertions (marked with INSERTED)

- [x] **Phase 48: Agent Service API Extensions** - New /api/ endpoints on the agent service for runtime state and SSE streaming
- [ ] **Phase 49: Dashboard Infrastructure** - Next.js 15 package with Tailwind, shadcn/ui, Drizzle, Docker, service layer
- [ ] **Phase 50: Conversations List** - Filterable list of all conversations with status, tokens, and activity
- [ ] **Phase 51: Conversation Detail** - Event timeline, message history, and metadata panels for a single conversation
- [ ] **Phase 52: Agent Definitions View** - Agent list and detail pages sourced from agent-service runtime registry
- [ ] **Phase 53: Tool Dashboard** - Tool registry, permission matrix, performance metrics, failures, and integration health
- [ ] **Phase 54: System Overview** - Landing page with conversation summary, active conversations, worker status, errors, and token usage
- [ ] **Phase 55: Real-Time Updates** - SSE client hook wired into conversations list, conversation detail, and system overview

## Phase Details

### Phase 48: Agent Service API Extensions
**Goal**: The agent service exposes runtime state (tool registry, agent definitions, worker status, live events) via read-only HTTP endpoints that the dashboard and future consumers can query
**Depends on**: Nothing (extends existing agent-service)
**Requirements**: API-01, API-02, API-03, API-04, API-05, API-06, API-07, SSE-01, SSE-02
**Success Criteria** (what must be TRUE):
  1. `curl http://localhost:3004/api/tools/registry` returns a JSON array of all registered tools with name, namespace, description, and input schema
  2. `curl http://localhost:3004/api/agents/registry` returns agent definitions without prompts, and `/api/agents/registry/dev-agent` returns the full definition including system prompt content
  3. `curl http://localhost:3004/api/worker/status` returns the worker loop's active claims, max concurrent, poll interval, and uptime
  4. `curl http://localhost:3004/api/tools/health` returns Linear, GitHub, and Slack endpoint status with latency (cached 30s)
  5. Connecting to `GET /api/sse/events` opens an SSE stream that emits agent events in real-time, with support for `?conversationId` and `?types` query parameter filters
**Plans:** 2 plans
Plans:
- [x] 48-01-PLAN.md -- Shared API foundation, interface extensions, and four REST endpoints (tools/registry, tools/health, agents/registry, worker/status)
- [x] 48-02-PLAN.md -- SSE event stream endpoint with connection management, filtering, replay, and shutdown cleanup

### Phase 49: Dashboard Infrastructure
**Goal**: A working Next.js 15 application exists in the monorepo, builds in Docker, serves on port 3005 via Compose, passes typecheck and lint, and has the service layer pattern established for all future views
**Depends on**: Nothing (parallel to Phase 48, but views will need Phase 48 complete)
**Requirements**: INFRA-01, INFRA-02, INFRA-03, INFRA-04, INFRA-05, INFRA-06, INFRA-07, INFRA-08, INFRA-09, INFRA-10
**Success Criteria** (what must be TRUE):
  1. `packages/dashboard/` is a pnpm workspace package and `pnpm install` resolves it as `@aesir/dashboard`
  2. `docker compose up dashboard` starts the service on port 3005, and `curl http://localhost:3005/api/health` returns 200
  3. Nginx routes requests to `/dashboard/*` to the dashboard service
  4. `pnpm run typecheck` and `pnpm run lint` pass for the dashboard package with zero errors
  5. A service layer exists in `src/services/` with at least one query function using Drizzle ORM against existing Postgres schemas, and middleware.ts exists as an auth-ready passthrough
**Plans:** 3 plans
Plans:
- [ ] 49-01-PLAN.md -- Next.js package scaffold with Tailwind, shadcn/ui, health endpoint, middleware, typecheck, lint
- [ ] 49-02-PLAN.md -- Drizzle ORM database connectivity and service layer pattern
- [ ] 49-03-PLAN.md -- Docker multi-stage build, Compose service, Nginx routing

### Phase 50: Conversations List
**Goal**: Users can see all agent conversations at a glance with filtering, answering "what have agents been doing?" without SQL
**Depends on**: Phase 49 (dashboard infrastructure)
**Requirements**: CONV-01, CONV-02
**Success Criteria** (what must be TRUE):
  1. Navigating to `/conversations` shows a table of all conversations with columns for agent name, status badge, duration, token usage (input + output), and last activity timestamp
  2. Filtering by status (multi-select), agent type (multi-select), time range (last hour / 24h / 7d / custom), and has-errors (boolean) narrows the list correctly
  3. The page loads within a reasonable time and the table is visually clean (proper alignment, status badges with color coding, empty state when no conversations match filters)
**Plans**: TBD

### Phase 51: Conversation Detail
**Goal**: Users can inspect any conversation's full execution history -- every tool call, LLM response, pause, signal, and sub-agent -- from a single page, making agent debugging visual instead of SQL-based
**Depends on**: Phase 50 (conversations list, for navigation)
**Requirements**: CONV-03, CONV-04, CONV-05, CONV-06, CONV-07, CONV-08, CONV-09, CONV-10
**Success Criteria** (what must be TRUE):
  1. The conversation detail page (`/conversations/[id]`) renders an event timeline showing all event types (started, tool.called, tool.succeeded, tool.failed, llm.response, paused, signal.received, resumed, completed) in chronological order with expandable payloads
  2. Tool call events show input parameters and results in expandable sections, failed tool calls are visually distinct with red/error styling, and LLM responses show token counts and latency
  3. Sub-agent events render as nested/indented sections within the parent timeline, and clicking a child conversation navigates to its own detail page
  4. A messages panel shows the LLM conversation history as a chat view (system prompt, user messages, assistant messages, tool use/result blocks)
  5. A metadata sidebar shows conversation ID, agent definition, status, retry count, parent/child links, session artifacts, and timestamps
**Plans**: TBD

### Phase 52: Agent Definitions View
**Goal**: Users can see what agents exist, how they're configured, and what they've been doing recently -- without reading YAML files or grepping code
**Depends on**: Phase 48 (agent-service API for registry data), Phase 49 (dashboard infrastructure)
**Requirements**: AGNT-01, AGNT-02, AGNT-03, AGNT-04, AGNT-05, AGNT-06
**Success Criteria** (what must be TRUE):
  1. The agents list page (`/agents`) shows all loaded agent definitions with name, description, model, tool count, sub-agents, trigger events, and version
  2. The agent detail page (`/agents/[id]`) shows full configuration (model, temperature, iterations, token budget, history settings), tools with namespace grouping linking to the tool dashboard, and sub-agent references linking to their detail pages
  3. System prompt content is rendered with Markdown formatting (collapsible for long prompts)
  4. Recent conversations for the agent are listed with status and duration, linking to the conversation detail page
**Plans**: TBD

### Phase 53: Tool Dashboard
**Goal**: Users can see all registered tools, who can use them, whether permissions are correctly configured, how tools are performing, and whether integrations are healthy -- the unified tool visibility layer
**Depends on**: Phase 48 (agent-service API for tool registry and health), Phase 49 (dashboard infrastructure)
**Requirements**: TOOL-01, TOOL-02, TOOL-03, TOOL-04, TOOL-05, TOOL-06, TOOL-07
**Success Criteria** (what must be TRUE):
  1. The tools page (`/tools`) shows all registered tools organized by namespace (codebase, coordination, linear, github, slack) with descriptions, agent access, and performance metrics (call volume, failure rate, latency)
  2. A permission matrix shows agent-to-tool access from both YAML definitions and MCP database permissions, and mismatches (agent references tool but MCP doesn't allow) are visually highlighted
  3. A recent failures section shows the last tool.failed events with timestamps, tool name, agent, conversation link, error payload, and duration
  4. An integration health section shows the status of Linear, GitHub, and Slack MCP endpoints with last successful call and latency
**Plans**: TBD

### Phase 54: System Overview
**Goal**: The dashboard landing page gives an instant pulse check -- conversation counts, active work, worker health, recent errors, and token consumption -- answering "is the system healthy right now?"
**Depends on**: Phase 48 (worker status API), Phase 49 (dashboard infrastructure), Phase 50 (conversations service layer)
**Requirements**: OVER-01, OVER-02, OVER-03, OVER-04, OVER-05
**Success Criteria** (what must be TRUE):
  1. The landing page (`/`) shows conversation status summary with counts by status (running, waiting, queued, completed in last 24h, failed in last 24h) with visual indicators
  2. Active conversations are listed with agent name, duration, last event, and links to detail pages
  3. Worker status section displays current active claims, max concurrent capacity, poll interval, last poll time, and uptime (from agent-service API)
  4. Recent errors section shows the last 10 failures with links, and token usage shows aggregate consumption by agent type over the last 24h
**Plans**: TBD

### Phase 55: Real-Time Updates
**Goal**: The dashboard reflects current system state without manual refresh -- conversation status changes appear in the list, new events append to timelines, and overview counts update live
**Depends on**: Phase 48 (SSE endpoint), Phase 50 (conversations list), Phase 51 (conversation detail), Phase 54 (system overview)
**Requirements**: SSE-03, SSE-04, SSE-05, SSE-06, SSE-07
**Success Criteria** (what must be TRUE):
  1. A `useEventStream` hook connects to the agent-service SSE endpoint, parses incoming events, and updates React component state
  2. The conversations list page auto-updates when a conversation's status changes (no page refresh needed)
  3. The conversation detail timeline appends new events in real-time as they occur during an active conversation
  4. The SSE client handles reconnection with exponential backoff on disconnect, and cleans up the connection on component unmount
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 48 -> 49 -> 50 -> 51 -> 52 -> 53 -> 54 -> 55
Note: Phases 48 and 49 could execute in parallel (no dependency between them), but subsequent phases depend on both.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 48. Agent Service API Extensions | 2/2 | Complete | 2026-02-04 |
| 49. Dashboard Infrastructure | 0/3 | Not started | - |
| 50. Conversations List | 0/TBD | Not started | - |
| 51. Conversation Detail | 0/TBD | Not started | - |
| 52. Agent Definitions View | 0/TBD | Not started | - |
| 53. Tool Dashboard | 0/TBD | Not started | - |
| 54. System Overview | 0/TBD | Not started | - |
| 55. Real-Time Updates | 0/TBD | Not started | - |

---
*Roadmap created: 2026-02-04*
*Milestone: v2.4 Operations Dashboard*
