# Roadmap: Aesir v2.1 Agents That Ship

## Milestones

- ✅ **v1.0 MVP** - Initial agent implementation (shipped 2026-01-19)
- ✅ **v2.0 Foundation** - Phases 10-22: Architecture restructure (shipped 2026-01-25)
- 🚧 **v2.1 Agents That Ship** - Phases 23-27 (in progress)

## Overview

v2.1 delivers end-to-end working agents where feature requests become shipped code. Product-agent receives Slack messages, asks clarifying questions, and creates well-structured Linear issues. Dev-agent receives Linear issues, works in dev containers, and produces mergeable PRs. Human-in-the-loop approvals keep humans in control.

## Phases

<details>
<summary>✅ v2.0 Foundation (Phases 10-22) - SHIPPED 2026-01-25</summary>

Completed foundation work:
- Phase 10: Foundation Setup (Biome, dotenv-flow, pre-commit hooks)
- Phase 11: Monorepo Setup (pnpm workspaces, TypeScript project references)
- Phase 12: Observability (pino logging, correlation IDs)
- Phase 13: Data Layer (Drizzle ORM, PostgreSQL schemas)
- Phase 14: Platform Services (ExecutionTracker, IdempotencyChecker)
- Phase 15: Code Quality (Result types, error handling)
- Phase 16: Linear Extraction (independent package)
- Phase 17: GitHub Extraction (independent package)
- Phase 18: Slack Extraction (independent package)
- Phase 19: MCP Layer (Model Context Protocol)
- Phase 20: Testing Pyramid (testcontainers, MSW)
- Phase 21: CI/CD Pipeline (deferred to v3.0)
- Phase 22: Local Dev Environment (Docker Compose)

</details>

### 🚧 v2.1 Agents That Ship (In Progress)

**Milestone Goal:** End-to-end workflow where Slack messages become mergeable PRs through automated agent collaboration.

**Phase Numbering:**
- Integer phases (23, 24, 25): Planned milestone work
- Decimal phases (23.1, 23.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 23: Event Infrastructure** - Webhook routing and event dispatch ✓
- [ ] **Phase 24: Dev Container** - Persistent container execution environment
- [ ] **Phase 25: Product Agent Workflow** - Slack conversation to Linear issue
- [ ] **Phase 26: Dev Agent Workflow** - Linear issue to GitHub PR
- [ ] **Phase 27: Human-in-the-Loop** - Approval flows and feedback loops

## Phase Details

### Phase 23: Event Infrastructure

**Goal**: External webhooks route through gateway to integrations, normalize to events, and dispatch to agents

**Depends on**: Phase 22 (Docker Compose environment)

**Requirements**: INFRA-01, INFRA-02, INFRA-03, INFRA-04, INFRA-05, INFRA-06, INFRA-07, INFRA-08, INFRA-09, INFRA-10, INFRA-11

**Success Criteria** (what must be TRUE):
  1. Linear webhook reaches linear-integration via nginx (Cloudflare tunnel → nginx:80 → linear-integration:3001)
  2. GitHub webhook reaches github-integration via nginx (Cloudflare tunnel → nginx:80 → github-integration:3002)
  3. Slack event reaches slack-integration via nginx (Cloudflare tunnel → nginx:80 → slack-integration:3003)
  4. Integration services normalize webhooks to common event schema (id, type, source, timestamp, correlationId, payload)
  5. Event dispatcher routes normalized events to correct agent /events endpoint based on config rules
  6. E2E verified: Linear webhook → linear-integration → dispatcher → dev-agent /events returns 200

**Plans:** 5 plans

Plans:
- [x] 23-01-PLAN.md — Common event schema, ID generator, nginx hardening
- [x] 23-02-PLAN.md — Linear dispatcher and event normalization
- [x] 23-03-PLAN.md — GitHub dispatcher and event normalization
- [x] 23-04-PLAN.md — Slack dispatcher and event normalization
- [x] 23-05-PLAN.md — Dev-agent /events endpoint and E2E verification

### Phase 24: Dev Container

**Goal**: Dev-agent can spawn persistent containers, execute shell commands, and manage container lifecycle

**Depends on**: Phase 23

**Requirements**: CONT-01, CONT-02, CONT-03, CONT-04, CONT-05, CONT-06, CONT-07, CONT-08, CONT-09, CONT-10, CONT-11

**Success Criteria** (what must be TRUE):
  1. Container image exists with Node.js, pnpm, git, ripgrep, fd, GitHub CLI pre-installed
  2. Dev-agent can spawn container with unique name (dev-container-{taskId})
  3. Dev-agent can clone repository into /workspace/repo inside container
  4. Dev-agent can create feature branch inside container
  5. Dev-agent can execute arbitrary shell commands and capture stdout/stderr
  6. Container persists across multiple operations (not destroyed between commands)
  7. Dev-agent can resume work in existing container (for feedback loops)
  8. Container cleanup works on task completion and 24h timeout
  9. E2E verified: spawn container → exec "echo test" → get output → cleanup succeeds

**Plans:** 6 plans

Plans:
- [ ] 24-01-PLAN.md — Dev environment Dockerfile (Node.js, pnpm, git, rg, fd, gh)
- [ ] 24-02-PLAN.md — Database schema for container state tracking
- [ ] 24-03-PLAN.md — DevContainerManager core (spawn, execute, resume)
- [ ] 24-04-PLAN.md — Git operations in container (clone, branch)
- [ ] 24-05-PLAN.md — Container cleanup service (task completion, 24h timeout)
- [ ] 24-06-PLAN.md — E2E integration test verification

### Phase 25: Product Agent Workflow

**Goal**: Product-agent receives Slack messages, asks clarifying questions, and creates well-structured Linear issues

**Depends on**: Phase 23

**Requirements**: PROD-01, PROD-02, PROD-03, PROD-04, PROD-05, PROD-06, PROD-07, PROD-08, PROD-09, PROD-10, PROD-11, MCP-01

**Success Criteria** (what must be TRUE):
  1. Product-agent HTTP service listening on port 3005 with /events endpoint
  2. Product-agent receives Slack message events from dispatcher
  3. Product-agent can determine if message is actionable feature request
  4. Product-agent can ask clarifying questions via Slack thread reply
  5. Temporal workflow pauses for user response and resumes on Slack reply signal
  6. Product-agent synthesizes requirements from multi-turn conversation
  7. Product-agent creates Linear issue with problem statement, scope, and acceptance criteria
  8. Linear issue includes "agent-ready" label for dev-agent routing
  9. Product-agent notifies in Slack with link to created Linear issue
  10. Conversation history persists across multiple Slack interactions
  11. E2E verified: Slack message → clarifying question → user reply → Linear issue with correct content

**Plans**: TBD

Plans:
- [ ] 25-01: [Plan description TBD during planning]

### Phase 26: Dev Agent Workflow

**Goal**: Dev-agent receives Linear issues, works in dev container, and produces mergeable PRs

**Depends on**: Phase 24, Phase 25

**Requirements**: DEV-01, DEV-02, DEV-03, DEV-04, DEV-05, DEV-06, DEV-07, DEV-08, DEV-09, DEV-10, DEV-11, DEV-12, DEV-13, DEV-14, DEV-15, DEV-16, DEV-17, DEV-18, DEV-19, DEV-20, DEV-21, DEV-22, DEV-23, MCP-02

**Success Criteria** (what must be TRUE):
  1. Dev-agent receives Linear issue events filtered for "agent-ready" label
  2. Dev-agent spawns dev container, clones repo, and creates feature branch
  3. Dev-agent researches codebase via shell commands (grep, find, cat)
  4. Dev-agent builds ResearchContext artifact from codebase exploration
  5. Dev-agent creates ExecutionPlan from requirements and research
  6. Dev-agent writes files in container via shell (cat > file << 'EOF')
  7. Dev-agent runs tests incrementally and commits atomically with clear messages
  8. Dev-agent runs full test suite and lint check before push
  9. Dev-agent pushes branch and creates PR via GitHub MCP
  10. Dev-agent updates Linear status to "in_review" and notifies Slack with PR link
  11. Dev-agent receives PR review feedback and resumes in existing container
  12. Dev-agent addresses feedback with additional commits
  13. Dev-agent notifies Slack when encountering errors (asks for help)
  14. E2E verified: Linear issue → dev container → research → plan → code → tests pass → PR created

**Plans**: TBD

Plans:
- [ ] 26-01: [Plan description TBD during planning]

### Phase 27: Human-in-the-Loop

**Goal**: Humans can approve plans and provide feedback through Linear and Slack, with either channel resuming workflows

**Depends on**: Phase 26

**Requirements**: HITL-01, HITL-02, HITL-03, HITL-04, HITL-05, HITL-06, HITL-07, HITL-08, HITL-09, HITL-10, HITL-11, HITL-12

**Success Criteria** (what must be TRUE):
  1. Dev-agent posts implementation plan as Linear comment before executing
  2. Dev-agent posts plan summary to Slack with Approve/Reject buttons
  3. Human can approve via Linear comment ("approved" or thumbs-up emoji)
  4. Human can approve via Slack button click
  5. Either approval method signals Temporal workflow to continue execution
  6. Rejection with feedback triggers plan revision (agent re-plans)
  7. PR merge webhook triggers task completion flow
  8. Task completion updates Linear status to "done"
  9. Task completion sends Slack notification
  10. Task completion cleans up dev container
  11. Timeout on approval wait (24h) notifies Slack
  12. E2E verified: plan posted → approval via Slack → workflow resumes → execution continues

**Plans**: TBD

Plans:
- [ ] 27-01: [Plan description TBD during planning]

## Progress

**Execution Order:**
Phases execute in numeric order: 23 → 23.1 → 23.2 → 24 → 24.1 → 25 → 26 → 27

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 23. Event Infrastructure | v2.1 | 5/5 | ✓ Complete | 2026-01-25 |
| 24. Dev Container | v2.1 | 0/TBD | Not started | - |
| 25. Product Agent Workflow | v2.1 | 0/TBD | Not started | - |
| 26. Dev Agent Workflow | v2.1 | 0/TBD | Not started | - |
| 27. Human-in-the-Loop | v2.1 | 0/TBD | Not started | - |

---
*Roadmap created: 2026-01-25*
*Last updated: 2026-01-25 — Phase 23 complete*
