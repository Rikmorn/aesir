# Requirements: Aesir v2.4 Operations Dashboard

**Defined:** 2026-02-04
**Core Value:** Real-time visibility into agent execution through a developer-focused web dashboard -- the force multiplier for all future agent work.

## v2.4 Requirements

### Dashboard Infrastructure

- [ ] **INFRA-01**: `packages/dashboard/` exists as a pnpm workspace package (`@aesir/dashboard`)
- [ ] **INFRA-02**: Next.js 15 App Router with Tailwind CSS and shadcn/ui configured
- [ ] **INFRA-03**: Drizzle ORM connected to existing Postgres (read-only, shared schema imports)
- [ ] **INFRA-04**: Service layer (`src/services/`) abstracts all database queries
- [ ] **INFRA-05**: Auth-ready middleware.ts in place (passthrough)
- [ ] **INFRA-06**: Dockerfile builds and runs in Docker Compose on port 3005
- [ ] **INFRA-07**: Nginx routes `/dashboard/*` to the dashboard service
- [ ] **INFRA-08**: Health check endpoint (`/api/health`) returns 200
- [ ] **INFRA-09**: `pnpm run typecheck` passes for the dashboard package
- [ ] **INFRA-10**: `pnpm run lint` passes for the dashboard package

### Conversations View

- [ ] **CONV-01**: Conversations list page shows all conversations with status, agent, duration, token usage, last activity
- [ ] **CONV-02**: Filters work: status, agent type, time range, has errors
- [ ] **CONV-03**: Conversation detail page shows event timeline with all event types rendered appropriately
- [ ] **CONV-04**: Tool call events show input parameters (expandable) and results (expandable)
- [ ] **CONV-05**: Failed tool calls are visually distinct (red/error styling)
- [ ] **CONV-06**: LLM response events show token counts and latency
- [ ] **CONV-07**: Sub-agent events render as nested/indented sections in the parent timeline
- [ ] **CONV-08**: Conversation messages panel shows the LLM message history as a chat view
- [ ] **CONV-09**: Conversation metadata sidebar shows all relevant fields including artifacts and parent/child links
- [ ] **CONV-10**: Clicking a child conversation navigates to its detail page

### Agent Definitions View

- [ ] **AGNT-01**: Agent list page shows all loaded agent definitions with key metadata
- [ ] **AGNT-02**: Agent detail page shows full configuration: model, tools, sub-agents, triggers, history settings
- [ ] **AGNT-03**: System prompt content is rendered with Markdown formatting
- [ ] **AGNT-04**: Tools list on agent detail links to the tool dashboard
- [ ] **AGNT-05**: Sub-agent references link to the sub-agent's detail page
- [ ] **AGNT-06**: Recent conversations for the agent are shown with links

### Tool Dashboard

- [ ] **TOOL-01**: Tool registry view shows all registered tools organized by namespace
- [ ] **TOOL-02**: Each tool shows description, which agents use it, and performance metrics
- [ ] **TOOL-03**: Permission matrix shows agent-to-tool access from both definition and MCP perspectives
- [ ] **TOOL-04**: Permission mismatches (definition references tool but MCP doesn't allow) are highlighted
- [ ] **TOOL-05**: Tool performance section shows call volume, failure rate, and latency metrics
- [ ] **TOOL-06**: Recent failures list shows tool.failed events with error payloads
- [ ] **TOOL-07**: Integration health section shows status of Linear, GitHub, Slack MCP endpoints

### System Overview

- [ ] **OVER-01**: Landing page shows conversation status summary (counts by status)
- [ ] **OVER-02**: Active conversations list with real-time updates
- [ ] **OVER-03**: Worker status displays current claims, capacity, poll interval
- [ ] **OVER-04**: Recent errors section shows last 10 failures with links
- [ ] **OVER-05**: Token usage shows aggregate consumption by agent type

### Real-Time Updates

- [ ] **SSE-01**: Agent-service SSE endpoint (`GET /api/sse/events`) streams events
- [ ] **SSE-02**: SSE supports filtering by conversationId and event types
- [ ] **SSE-03**: Dashboard SSE client hook connects, parses, and updates component state
- [ ] **SSE-04**: Conversations list auto-updates when conversation status changes
- [ ] **SSE-05**: Conversation detail timeline appends new events in real-time
- [ ] **SSE-06**: SSE client handles reconnection with backoff
- [ ] **SSE-07**: SSE connection cleans up on component unmount

### Agent Service API

- [ ] **API-01**: `GET /api/tools/registry` returns all registered tools with metadata
- [ ] **API-02**: `GET /api/tools/health` returns integration endpoint status (cached 30s)
- [ ] **API-03**: `GET /api/agents/registry` returns all agent definitions (without full prompts)
- [ ] **API-04**: `GET /api/agents/registry/:id` returns full agent definition including prompt
- [ ] **API-05**: `GET /api/worker/status` returns worker loop state
- [ ] **API-06**: `GET /api/sse/events` streams real-time events via SSE
- [ ] **API-07**: All new endpoints use `/api/` prefix, separate from operational endpoints

## Future Requirements

Deferred to later milestones. Tracked but not in v2.4 roadmap.

### Dashboard Editing

- **EDIT-01**: Agent definition editing via dashboard UI (currently YAML files only)
- **EDIT-02**: Tool permission management UI (currently database seeds only)
- **EDIT-03**: Conversation actions from dashboard (cancel, retry, signal)

### Analytics & Monitoring

- **ANLY-01**: Historical time-series charts and trend analysis
- **ANLY-02**: Alerting and notifications for agent failures (email, Slack, push)
- **ANLY-03**: Log viewer integrating pino logs with agent events

### Multi-User

- **AUTH-01**: Authentication via Auth.js (architecture is ready, not enforced in v2.4)
- **AUTH-02**: Multi-tenancy with workspace-scoped data access
- **AUTH-03**: Role-based permissions for dashboard features

## Out of Scope

| Feature | Reason |
|---------|--------|
| Agent definition editing UI | Write paths require API design; YAML files work for single-dev workflow |
| Historical analytics / trends | Raw data and recent aggregates sufficient for v2.4 |
| Alerting / notifications | Dashboard is pull-based (you look at it); push is future |
| Multi-user authentication | Architecture supports it, not enforced in v2.4 |
| Mobile responsiveness | Desktop developer tool, no mobile optimization |
| Tool configuration editing | Requires write paths to integration databases |
| Conversation actions (cancel, retry) | Management endpoints exist but not exposed as UI actions yet |
| Log viewer | pino logs are separate from agent_events; no log aggregation |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| API-01 | Phase 48 | Pending |
| API-02 | Phase 48 | Pending |
| API-03 | Phase 48 | Pending |
| API-04 | Phase 48 | Pending |
| API-05 | Phase 48 | Pending |
| API-06 | Phase 48 | Pending |
| API-07 | Phase 48 | Pending |
| SSE-01 | Phase 48 | Pending |
| SSE-02 | Phase 48 | Pending |
| INFRA-01 | Phase 49 | Pending |
| INFRA-02 | Phase 49 | Pending |
| INFRA-03 | Phase 49 | Pending |
| INFRA-04 | Phase 49 | Pending |
| INFRA-05 | Phase 49 | Pending |
| INFRA-06 | Phase 49 | Pending |
| INFRA-07 | Phase 49 | Pending |
| INFRA-08 | Phase 49 | Pending |
| INFRA-09 | Phase 49 | Pending |
| INFRA-10 | Phase 49 | Pending |
| CONV-01 | Phase 50 | Pending |
| CONV-02 | Phase 50 | Pending |
| CONV-03 | Phase 51 | Pending |
| CONV-04 | Phase 51 | Pending |
| CONV-05 | Phase 51 | Pending |
| CONV-06 | Phase 51 | Pending |
| CONV-07 | Phase 51 | Pending |
| CONV-08 | Phase 51 | Pending |
| CONV-09 | Phase 51 | Pending |
| CONV-10 | Phase 51 | Pending |
| AGNT-01 | Phase 52 | Pending |
| AGNT-02 | Phase 52 | Pending |
| AGNT-03 | Phase 52 | Pending |
| AGNT-04 | Phase 52 | Pending |
| AGNT-05 | Phase 52 | Pending |
| AGNT-06 | Phase 52 | Pending |
| TOOL-01 | Phase 53 | Pending |
| TOOL-02 | Phase 53 | Pending |
| TOOL-03 | Phase 53 | Pending |
| TOOL-04 | Phase 53 | Pending |
| TOOL-05 | Phase 53 | Pending |
| TOOL-06 | Phase 53 | Pending |
| TOOL-07 | Phase 53 | Pending |
| OVER-01 | Phase 54 | Pending |
| OVER-02 | Phase 54 | Pending |
| OVER-03 | Phase 54 | Pending |
| OVER-04 | Phase 54 | Pending |
| OVER-05 | Phase 54 | Pending |
| SSE-03 | Phase 55 | Pending |
| SSE-04 | Phase 55 | Pending |
| SSE-05 | Phase 55 | Pending |
| SSE-06 | Phase 55 | Pending |
| SSE-07 | Phase 55 | Pending |

**Coverage:**
- v2.4 requirements: 52 total
- Mapped to phases: 52
- Unmapped: 0

---
*Requirements defined: 2026-02-04*
*Last updated: 2026-02-04 after roadmap creation*
