---
phase: 52
plan: 01
subsystem: dashboard
tags: [dashboard, agent-service, http-client, shadcn, react-markdown, drizzle]
requires: [49-02]
provides: [agent-service-http-client, agents-service-layer, shadcn-card-tabs-tooltip]
affects: [52-02, 52-03]
tech-stack:
  added: [react-markdown]
  patterns: [server-side-http-client, service-layer-with-http-and-db]
key-files:
  created:
    - packages/dashboard/src/lib/agent-service.ts
    - packages/dashboard/src/services/agents.ts
    - packages/dashboard/src/components/ui/card.tsx
    - packages/dashboard/src/components/ui/tabs.tsx
    - packages/dashboard/src/components/ui/tooltip.tsx
  modified:
    - packages/dashboard/package.json
    - pnpm-lock.yaml
    - docker-compose.yml
key-decisions:
  - Local AgentSummary/AgentDetail interfaces mirror agent-service API types (no @aesir/agents import)
  - AbortSignal.timeout(5000) for agent-service HTTP requests
  - next revalidate 60s for fetch caching of agent definitions
  - biome-ignore for console.error in server-side HTTP client (dashboard lacks pino logger)
  - agent-service added to dashboard depends_on in Docker Compose
duration: ~4 minutes
completed: 2026-02-04
---

# Phase 52 Plan 01: Dependencies and Data Layer Summary

Server-side HTTP client for agent-service registry API with typed interfaces, agents service layer combining HTTP + DB queries, react-markdown and shadcn card/tabs/tooltip components.

## Performance

- Duration: ~4 minutes
- 2 tasks, 2 commits
- No blockers encountered

## Accomplishments

1. **Installed react-markdown and shadcn components** -- react-markdown ^10.1.0 for server-component markdown rendering (Plan 03 system prompt). shadcn card, tabs, tooltip components generated via CLI with Biome lint fixes applied.

2. **Created agent-service HTTP client** (`lib/agent-service.ts`) -- Introduces a new data source pattern for the dashboard. Previous phases only used direct Drizzle DB queries; this is the first HTTP fetch from the agent-service API. Includes typed interfaces mirroring the API response types, configurable base URL via `AGENT_SERVICE_URL`, 5-second timeout, 60-second Next.js fetch cache revalidation, and graceful error handling (returns empty array or null on failure).

3. **Created agents service layer** (`services/agents.ts`) -- Follows established service layer pattern from `services/conversations.ts`. Provides `getAgentList()` and `getAgentDetail()` delegating to HTTP client, plus `getRecentConversationsByAgent()` using Drizzle subquery join for token aggregation (same pattern as `listConversations`).

4. **Updated Docker Compose** -- Added `AGENT_SERVICE_URL=http://agent-service:3004` to dashboard environment and `agent-service` to `depends_on` with `condition: service_healthy` for correct startup ordering.

## Task Commits

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Install dependencies and shadcn components | c296207 | package.json, card.tsx, tabs.tsx, tooltip.tsx |
| 2 | Create agent-service HTTP client and agents service layer | 753e02c | agent-service.ts, agents.ts, docker-compose.yml |

## Files Created

- `packages/dashboard/src/lib/agent-service.ts` -- Server-side HTTP client with `fetchAgentList()`, `fetchAgentDetail()`, `AgentSummary`, `AgentDetail`
- `packages/dashboard/src/services/agents.ts` -- Service layer with `getAgentList()`, `getAgentDetail()`, `getRecentConversationsByAgent()`, `RecentConversation`
- `packages/dashboard/src/components/ui/card.tsx` -- shadcn Card component (server component)
- `packages/dashboard/src/components/ui/tabs.tsx` -- shadcn Tabs component ("use client")
- `packages/dashboard/src/components/ui/tooltip.tsx` -- shadcn Tooltip component ("use client")

## Files Modified

- `packages/dashboard/package.json` -- Added react-markdown ^10.1.0
- `pnpm-lock.yaml` -- Updated with react-markdown and its dependencies
- `docker-compose.yml` -- Added AGENT_SERVICE_URL env var and agent-service depends_on for dashboard

## Decisions Made

1. **Local interfaces over imports** -- Defined `AgentSummary` and `AgentDetail` locally in `lib/agent-service.ts` rather than importing from `@aesir/agents`, maintaining dashboard independence (consistent with `lib/schema.ts` pattern from 49-02).

2. **AbortSignal.timeout(5000)** -- 5-second timeout for agent-service HTTP requests, using the simpler `AbortSignal.timeout()` API rather than manual AbortController + setTimeout.

3. **Next.js fetch cache with 60s revalidation** -- Agent definitions change infrequently, so `next: { revalidate: 60 }` avoids hitting the agent-service on every page load while keeping data reasonably fresh.

4. **biome-ignore for console.error** -- Dashboard doesn't have a pino logger like other packages. Used `biome-ignore` suppression comments for `console.error` in the server-side HTTP client since error logging is essential for debugging agent-service connectivity issues.

5. **agent-service in depends_on** -- Added with `condition: service_healthy` to ensure correct Docker Compose startup ordering. The dashboard shows error states when agent-service is unavailable, but having the dependency ensures the service starts first.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Biome lint/format fixes on shadcn-generated components**
- **Found during:** Task 1
- **Issue:** shadcn CLI generates components without semicolons, with unsorted imports, and using `import * as React` where `import type` suffices -- all flagged by Biome
- **Fix:** Ran `pnpm run lint:fix` to auto-fix all shadcn-generated files
- **Files modified:** card.tsx, tabs.tsx, tooltip.tsx
- **Commit:** c296207

**2. [Rule 1 - Bug] Biome noConsole rule violations in HTTP client**
- **Found during:** Task 2
- **Issue:** `console.error` calls flagged by global `noConsole: "error"` rule
- **Fix:** Added `biome-ignore` suppression comments with justification (server-side HTTP client needs error logging)
- **Files modified:** lib/agent-service.ts
- **Commit:** 753e02c

## Issues Encountered

None.

## Next Phase Readiness

Plan 52-02 (Agent List Page) can proceed immediately -- it depends on `getAgentList()` from `services/agents.ts` and the Card component, both delivered by this plan.

Plan 52-03 (Agent Detail Page) can proceed immediately -- it depends on `getAgentDetail()`, `getRecentConversationsByAgent()`, Tabs, Tooltip, and react-markdown, all delivered by this plan.
