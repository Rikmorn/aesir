---
phase: 25-product-agent-workflow
plan: 09
subsystem: agents
tags: [e2e, testing, verification, mcp, slack, linear]

# Dependency graph
requires:
  - phase: 25-06
    provides: createTasks node with Linear issue creation
  - phase: 25-08
    provides: notify node for Slack notification
provides:
  - E2E verification of complete product-agent workflow
  - Integration test structure
  - Manual verification procedure
  - MCP body parsing fixes for Linear/GitHub integrations
affects: [product-agent-production, dev-agent-integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - MCP routes mounted with express.json() separately from webhook routes with express.raw()
    - API key detection for lin_api_* tokens vs OAuth tokens
    - Text-based confirmation flow (vs button-based)

key-files:
  created:
    - packages/agents/src/product-agent/integration.test.ts
    - packages/agents/src/product-agent/E2E-VERIFICATION.md
  modified:
    - packages/integrations/linear/src/main.ts
    - packages/integrations/linear/src/api/mcp.ts
    - packages/integrations/linear/src/oauth/flow.ts
    - packages/integrations/github/src/main.ts
    - packages/integrations/github/src/api/mcp.ts

key-decisions:
  - "MCP routes use /mcp prefix with express.json(), webhooks use express.raw()"
  - "API keys (lin_api_*) handled differently from OAuth tokens - no Bearer prefix"
  - "agent-ready label warning only - doesn't block issue creation"
  - "Text-based confirmation kept (vs interactive buttons)"

patterns-established:
  - "Express middleware ordering: JSON for MCP, raw for webhooks"
  - "Router path convention: mount at /mcp, define routes as /tools"
  - "Graceful label resolution: warn on missing labels, continue without"

# Metrics
duration: multi-session
completed: 2026-01-26
---

# Phase 25 Plan 09: E2E Verification Summary

**Complete product-agent workflow verified end-to-end: Slack message to Linear issue creation**

## Performance

- **Duration:** Multi-session (verification + bug fixes)
- **Completed:** 2026-01-26
- **Tasks:** 3 (2 auto + 1 human checkpoint)
- **Files modified:** 7

## Accomplishments

- Integration test structure created with health checks and event handling tests
- Manual verification procedure documented in E2E-VERIFICATION.md
- Complete E2E flow verified:
  - PROD-01: Health checks working
  - PROD-02: Event handling working (Socket Mode + dispatch)
  - PROD-03: Classification working
  - PROD-04: Clarifying questions in thread working
  - PROD-06: Confirmation prompt working (text-based)
  - PROD-07: Issue creation working via MCP
  - PROD-08: Slack notification with issue link working
  - PROD-09: agent-ready label applied (warning if missing)
  - PROD-11: Complete E2E flow working

## Task Commits

1. **Task 1: Integration test structure** - `4d45efc` (test)
2. **Task 2: E2E verification docs** - `2e23156` (docs)
3. **Bug fixes during verification:**
   - `5559ec4` - Thread context, confirmation detection fixes
   - `3b4d6a8` - Confirmation detection (@mention stripping)
   - `0d020e4` - MCP body parsing, API key authentication

## Files Created/Modified

- `packages/agents/src/product-agent/integration.test.ts` - E2E test structure
- `packages/agents/src/product-agent/E2E-VERIFICATION.md` - Manual verification procedure
- `packages/integrations/linear/src/main.ts` - MCP routing fix
- `packages/integrations/linear/src/api/mcp.ts` - Route path fix
- `packages/integrations/linear/src/oauth/flow.ts` - API key detection
- `packages/integrations/github/src/main.ts` - MCP routing fix
- `packages/integrations/github/src/api/mcp.ts` - Route path fix

## Decisions Made

- **MCP body parsing:** Mount MCP routes at `/mcp` with `express.json()` before webhook routes use `express.raw()` for signature verification
- **API key detection:** `lin_api_*` tokens use direct client (no Bearer prefix, no refresh)
- **Label handling:** Missing agent-ready label logs warning but doesn't block issue creation
- **Confirmation UX:** Kept text-based ("confirm") vs interactive buttons - simpler, works

## Issues Encountered & Fixed

1. **MCP body parsing:** Routes were getting raw body instead of parsed JSON
   - Fix: Mounted MCP routes first with express.json() middleware

2. **Route path mismatch:** Routes defined as `/mcp/tools` but router mounted at `/mcp`
   - Fix: Changed routes to `/tools` (full path becomes `/mcp/tools`)

3. **API key auth:** Linear API keys (`lin_api_*`) failed with "Bearer must be JWT"
   - Fix: Detect API key format and use simple client

4. **Thread context:** threadTs field name mismatch between Slack event and state
   - Fix: Standardized field names

5. **Confirmation detection:** @mentions in reply text prevented "confirm" detection
   - Fix: Strip @mentions before checking confirmation

## User Setup Required

1. Create "agent-ready" label in Linear workspace (optional - warning only)
2. Ensure PRODUCT_AGENT_ALLOWED_CHANNELS configured correctly

## Phase 25 Complete

All product-agent workflow requirements verified:
- Slack event handling and thread conversations
- LangGraph state machine with clarifying questions
- Temporal workflow for durable execution
- Linear issue creation via MCP
- Slack notification with issue link

---
*Phase: 25-product-agent-workflow*
*Completed: 2026-01-26*
