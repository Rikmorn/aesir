---
phase: 47-cleanup-documentation
plan: 04
subsystem: docs
tags: [documentation, claude-md, readme, v2.3, architecture]

# Dependency graph
requires:
  - phase: 47-02
    provides: dead files deleted, codebase reflects v2.3 reality
  - phase: 47-03
    provides: aesir credentials, dead dependencies removed
provides:
  - CLAUDE.md fully describes v2.3 architecture as current reality
  - README.md updated with v2.3 services, commands, and credentials
  - Zero references to Temporal, LangGraph, or per-agent services in docs
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns: []

# File tracking
key-files:
  modified:
    - .claude/CLAUDE.md
    - README.md

# Decisions
decisions:
  - id: CLAUDE-STRUCTURE
    description: "Merged v2.2 Design Principles into Agent-First Decision Checklist section -- removed version framing, kept the substance"
  - id: HISTORY-DELEGATION
    description: "Delegated all historical context (milestones, v1/v2.0/v2.1/v2.2 sections) to .planning/ rather than preserving abbreviated versions"
  - id: GOTCHAS-V23
    description: "Added 7 v2.3-specific gotchas sections covering agent definitions, executor, event log, history manager, wait_for/signals, tool separation, and schema.drizzle.ts"

# Metrics
metrics:
  duration: 6m17s
  completed: 2026-02-03
---

# Phase 47 Plan 04: CLAUDE.md + README.md Rewrite Summary

Full documentation rewrite: CLAUDE.md and README.md updated to describe v2.3 as current reality with zero legacy references.

## Accomplishments

### Task 1: Rewrite CLAUDE.md for v2.3 Architecture
- Full rewrite of CLAUDE.md (~878 lines, down from ~903)
- **Removed entirely:** v2.0 Foundation Work section (completed phases list, key achievements), v2.1 Codebase Cleanup section, v2.2 Design Principles as a separate section (content merged into Agent-First Decision Checklist)
- **Removed references:** All mentions of Temporal (workflows, activities, workers, signals, proxyActivities), LangGraph (state machines, checkpoints, nodes), per-agent services (dev-agent:3004, product-agent:3005, worker.ts entry points)
- **Updated:** Agent-First Decision Checklist references `definitions/` and `framework/` paths (was `shared/temporal/` and `*/orchestrator/`)
- **Added:** Architecture overview (ConversationExecutor, WorkerLoop, EventLog, HistoryManager, etc.), agent definitions pattern (YAML + prompt.md), ConversationExecutor flow diagram, event routing documentation, updated directory structure
- **Added:** 7 v2.3-specific gotchas (agent definitions, executor, event log, history manager, wait_for/signals, tool separation, schema.drizzle.ts)
- **Added:** Historical context note pointing to `.planning/` directory

### Task 2: Update README.md for v2.3
- Comprehensive update of README.md (~398 lines, down from ~503)
- **Features:** "Human-in-the-Loop" updated from "Temporal-orchestrated approval gates" to "Conversation-based approval gates via wait_for tool"; added "Declarative Agent Definitions" feature
- **Architecture diagram:** Replaced LangGraph/Temporal boxes with Executor/EventRouter/WorkerLoop
- **Service URLs:** Removed Temporal gRPC (7233) and Temporal UI (8080); shows agent-service:3004
- **Quick Start:** Infrastructure command is `docker compose up -d postgresql` (no temporal/temporal-ui)
- **Credentials:** Database examples use `aesir:aesir@localhost:5432/aesir`
- **Project structure:** Updated to show definitions/, framework/, router/, service/, shared/
- **Database schemas:** Added `agents` schema (conversations, agent_events, agent_sessions)
- **Troubleshooting:** Replaced "Failed to connect to Temporal server" with "Failed to connect to database" section
- **Docker Compose table:** Removed per-agent commands (docker:dev-agent, docker:product-agent, infra:up)

## Task Commits

| # | Task | Commit | Key Changes |
|---|------|--------|-------------|
| 1 | Rewrite CLAUDE.md | b281868 | Full v2.3 rewrite, zero legacy references |
| 2 | Update README.md | b076e65 | v2.3 architecture, aesir credentials, unified service |

## Files Modified

| File | Action | Lines |
|------|--------|-------|
| `.claude/CLAUDE.md` | Rewritten | 302 added, 326 removed |
| `README.md` | Updated | 86 added, 112 removed |

## Verification Results

All verification checks passed:
- `grep -i "temporal" .claude/CLAUDE.md README.md` -- ZERO results
- `grep -i "langgraph" .claude/CLAUDE.md README.md` -- ZERO results
- `grep -i "worker.ts" .claude/CLAUDE.md` -- ZERO results (entry point references)
- `grep "definitions/" .claude/CLAUDE.md` -- 6 matches
- `grep "ConversationExecutor" .claude/CLAUDE.md` -- 5 matches
- `grep "agent-service" README.md` -- 3 matches
- `grep "aesir" README.md` -- 26 matches

## Deviations from Plan

None -- plan executed exactly as written.

## Next Phase Readiness

This is the final plan in Phase 47 (Cleanup & Documentation). The project is now fully cleaned:
- Plan 01: Barrel exports severed (15 files refactored)
- Plan 02: Dead files deleted (86 files, 21,590 lines)
- Plan 03: Dead dependencies removed, credentials renamed to aesir
- Plan 04: Documentation rewritten for v2.3 (this plan)

All documentation accurately reflects the v2.3 codebase as-built.
