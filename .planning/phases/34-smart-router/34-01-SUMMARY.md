---
phase: 34-smart-router
plan: 01
subsystem: routing
tags: [router, types, fast-path, deterministic-rules, system-prompt, intent-classification]

dependency_graph:
  requires: ["28-agent-loop-runtime", "30-tool-use-layer", "32-dev-agent-temporal"]
  provides: ["router-types", "fast-path-rules", "router-system-prompt"]
  affects: ["34-02", "34-03", "34-04", "34-05"]

tech_stack:
  added: []
  patterns: ["deterministic-rule-table", "discriminated-union-actions", "xml-tagged-prompt-sections"]

key_files:
  created:
    - packages/agents/src/router/types.ts
    - packages/agents/src/router/fast-path.ts
    - packages/agents/src/router/system-prompt.ts
  modified: []

decisions:
  - id: "ROUT-TYPES-01"
    decision: "FastPathAction as discriminated union with signal|start|ignore variants"
    rationale: "Enables exhaustive switch/case handling in executeFastPath and type narrowing"
  - id: "ROUT-TYPES-02"
    decision: "exactOptionalPropertyTypes-compatible optional fields use `| undefined` suffix"
    rationale: "Consistent with tsconfig.base.json strict settings and existing codebase pattern"
  - id: "ROUT-FP-01"
    decision: "9 deterministic rules covering 7 actionable + 2 ignore event types"
    rationale: "Matches all unambiguous events from existing dev-agent/product-agent event handlers"
  - id: "ROUT-FP-02"
    decision: "agent_session.created uses needsEnrichment flag for deferred MCP fetch"
    rationale: "Rule produces action declaratively; executeFastPath handles MCP enrichment at execution time"
  - id: "ROUT-FP-03"
    decision: "agentId 'router' for MCP calls instead of 'dev-agent'"
    rationale: "Router is its own identity; MCP permission seeding can target 'router' agent specifically"
  - id: "ROUT-PROMPT-01"
    decision: "System prompt absorbs all 6 intent types from APPROVAL_CLASSIFICATION_PROMPT"
    rationale: "Router replaces dedicated classifier; single classification point reduces latency and complexity"
  - id: "ROUT-PROMPT-02"
    decision: "Questions treated as soft rejections with question text as feedback"
    rationale: "Questions block progress like rejections; the workflow can handle appropriately"

metrics:
  duration: "~5 minutes"
  completed: "2026-01-30"
---

# Phase 34 Plan 01: Router Types, Fast-Path, and System Prompt Summary

**Router type system with 9-rule deterministic fast path and LLM system prompt absorbing approval classifier**

## What Was Built

### Router Types (`packages/agents/src/router/types.ts`)

Type definitions establishing the contract for the entire smart router:

- **RouterDeps**: Dependencies interface (Temporal Client, PinoLogger, optional alerts channel)
- **FastPathAction**: Discriminated union with three variants:
  - `SignalAction` (type: "signal") -- signal an existing workflow
  - `StartAction` (type: "start") -- start a new workflow, with optional enrichment
  - `IgnoreAction` (type: "ignore") -- no-op with reason
- **RouteResult**: Execution outcome (status: routed/ignored/failed, with optional action/workflowId/error)
- **RoutingRule**: Rule interface with name, match predicate, and action factory

### Fast-Path Rules (`packages/agents/src/router/fast-path.ts`)

Deterministic rule table with 9 rules covering all unambiguous events:

| Rule | Event Type | Action |
|------|-----------|--------|
| slack-approval-button | slack.block_actions.approved | signal planApproval (approved: true) |
| slack-rejection-button | slack.block_actions.rejected | signal planApproval (approved: false) |
| slack-escalation-retry | slack.block_actions.escalation_retry | signal escalationResolved (retry) |
| slack-escalation-abort | slack.block_actions.escalation_abort | signal escalationResolved (abort) |
| github-pr-merged | github.pull_request.merged | signal prCompletion (merged: true) |
| github-pr-closed | github.pull_request.closed | signal prCompletion (merged: false) |
| linear-agent-session-created | linear.agent_session.created | start devAgentWorkflow |
| linear-issue-created | linear.issue.created | ignore |
| linear-issue-updated | linear.issue.updated | ignore |

Key functions:
- `matchFastPath(event)` -- returns first matching rule's action or null
- `executeFastPath(action, deps)` -- executes action (signal/start/ignore) and returns RouteResult
- Enrichment: agent_session start actions fetch full issue details via MCP before workflow creation

### Router System Prompt (`packages/agents/src/router/system-prompt.ts`)

Comprehensive LLM guidance for the slow path with XML-tagged sections:

- `<identity>` -- Router is a classifier, not a content processor
- `<available_agents>` -- dev-agent and product-agent with workflow ID patterns
- `<routing_rules>` -- Signal/start/ignore actions with workflow ID derivation and signal payload shapes
- `<intent_classification>` -- All 6 intent types ported from APPROVAL_CLASSIFICATION_PROMPT (approve, reject, question, guidance, abort, unclear) with complete example phrases
- `<constraints>` -- Single decision per event, no content processing, prefer ignore over misroute
- `<tools>` -- route_event tool specification for structured output

## Deviations from Plan

None -- plan executed exactly as written.

## Verification Results

- TypeScript compiles cleanly (zero router-specific errors via `tsc --build --noEmit`)
- types.ts exports: RouterDeps, FastPathAction, RouteResult, RoutingRule (plus SignalAction, StartAction, IgnoreAction)
- fast-path.ts exports: matchFastPath, executeFastPath, DETERMINISTIC_RULES (9 rules)
- fast-path.ts imports: callMcpTool, planApprovalSignal, prCompletionSignal, escalationResolvedSignal
- system-prompt.ts exports: ROUTER_SYSTEM_PROMPT with all 6 intent types

## Commits

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Router types and fast-path rule table | c31c80e | router/types.ts, router/fast-path.ts |
| 2 | Router system prompt | b3d5af9 | router/system-prompt.ts |

## Next Phase Readiness

Plan 34-02 (slow-path LLM classifier) can proceed -- it depends on:
- `RouterDeps` and `RouteResult` from types.ts (available)
- `ROUTER_SYSTEM_PROMPT` from system-prompt.ts (available)
- Fast-path as fallback reference for signal names/payloads (available)

No blockers.
