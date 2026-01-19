# Roadmap: Aesir

## Overview

Aesir is an internal agentic development platform that automates software development workflows. The roadmap progresses from foundational agent infrastructure through tool integrations, culminating in a complete Product Agent + Dev Agent workflow with human-in-the-loop approval. Each phase builds on the previous, delivering incremental value while maintaining safety guardrails throughout.

## Domain Expertise

None

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Core Agent Framework** - Single agent with safety guardrails and code generation
- [x] **Phase 2: Execution Environment** - Sandboxed Docker execution for agent code
- [x] **Phase 3: Linear Integration** - Read/update tasks via webhooks
- [x] **Phase 4: GitHub Integration** - Branches, commits, and PRs
- [x] **Phase 5: Dev Agent** - Complete task-to-code workflow
- [x] **Phase 6: Observability** - Logging and queryable agent actions
- [x] **Phase 7: Slack Integration** - Notifications and status updates
- [x] **Phase 8: Human-in-the-Loop** - Approval gates before PR merge
- [x] **Phase 9: Product Agent** - Requirements gathering and task creation
- [x] **Phase 9.1: Infrastructure & Local Dev** - Linear OAuth, Docker Compose, README, Dev Agent entry point (INSERTED)
- [x] **Phase 9.2: Integration Gap Closure** - Fix integration issues blocking E2E flows (INSERTED)
- [ ] **Phase 9.3: Webhook API Exposure** - Cloudflare tunnel for local dev webhook access (INSERTED)

## Phase Details

### Phase 1: Core Agent Framework
**Goal**: Single agent can execute code generation with safety guardrails
**Depends on**: Nothing (first phase)
**Requirements**: CORE-01, CORE-02, CORE-03, CORE-04, CORE-05
**Success Criteria** (what must be TRUE):
  1. Agent can receive a task description and generate code
  2. Agent execution stops after N iterations (iteration limit works)
  3. Agent execution stops after X seconds (timeout works)
  4. Agent actions appear in logs with timestamps and context
  5. Agent configuration is defined in code/config file
**Research**: Complete (see 01-RESEARCH.md)
**Plans**: 5 plans

Plans:
- [x] 01-01: Project Scaffold & Logging Infrastructure
- [x] 01-02: Agent State Schema & Code Generation Tool
- [x] 01-03: Agent Definition & Configuration
- [x] 01-04: Safety Guardrails (Iteration Limits & Timeouts)
- [x] 01-05: Integration Test & Phase Validation

### Phase 2: Execution Environment
**Goal**: Agent code runs in sandboxed container with test execution
**Depends on**: Phase 1
**Requirements**: EXEC-01, EXEC-02, EXEC-03
**Success Criteria** (what must be TRUE):
  1. Agent code execution happens inside Docker container
  2. Agent can run tests inside the sandbox
  3. Test results are captured and returned to agent for feedback
**Research**: Complete (see 02-RESEARCH.md)
**Plans**: 2 plans

Plans:
- [x] 02-01: Sandbox Interface & Docker Core
- [x] 02-02: File Operations & Test Execution

### Phase 3: Linear Integration
**Goal**: Agent can read/update tasks in Linear via webhooks
**Depends on**: Phase 1
**Requirements**: LIN-01, LIN-02, LIN-03, LIN-04
**Success Criteria** (what must be TRUE):
  1. Agent can read task details from Linear
  2. Agent can update task status in Linear
  3. Webhooks trigger agent when Linear tasks change (no polling)
  4. Agent appears as team member in Linear activity
**Research**: Complete (see 03-RESEARCH.md)
**Plans**: 2 plans

Plans:
- [x] 03-01: Linear Client Foundation
- [x] 03-02: Webhooks & Agent Activities

### Phase 4: GitHub Integration
**Goal**: Agent can create branches, commit code, open PRs
**Depends on**: Phase 1
**Requirements**: GH-01, GH-02, GH-03, GH-04
**Success Criteria** (what must be TRUE):
  1. Agent can create feature branches from tasks
  2. Agent can commit code changes to branches
  3. Agent can open PRs with meaningful descriptions
  4. Agent can read PR comments and make follow-up changes
**Research**: Unlikely (GitHub integration patterns are ubiquitous)
**Plans**: 2 plans

Plans:
- [x] 04-01: GitHub Client & Branch Operations
- [x] 04-02: Commits & Pull Requests

### Phase 5: Dev Agent
**Goal**: Complete Dev Agent workflow picks tasks, writes code, runs tests
**Depends on**: Phase 2, Phase 3, Phase 4
**Requirements**: DEV-01, DEV-02, DEV-03, DEV-04, DEV-05
**Success Criteria** (what must be TRUE):
  1. Dev Agent picks up assigned tasks from Linear
  2. Dev Agent writes code implementing task requirements
  3. Dev Agent can modify multiple files in one task
  4. Dev Agent runs tests and interprets pass/fail
  5. Dev Agent iterates on code when tests fail
**Research**: Complete (see 05-RESEARCH.md)
**Plans**: 3 plans

Plans:
- [x] 05-01: State Schema & Code Generation
- [x] 05-02: Fix Code & Test Feedback
- [x] 05-03: Workflow Orchestration

### Phase 6: Observability
**Goal**: All agent actions are logged and queryable
**Depends on**: Phase 1
**Requirements**: OBS-01, OBS-02, OBS-03
**Success Criteria** (what must be TRUE):
  1. All agent actions logged with timestamp and context
  2. Logs identify which workflow/task each action belongs to
  3. Logs can be queried to find actions for a specific task
**Research**: Complete (see 06-RESEARCH.md)
**Plans**: 2 plans

Plans:
- [x] 06-01: TraceStore for Task ID Indexing
- [x] 06-02: LangGraphTracer Callback Handler

### Phase 7: Slack Integration
**Goal**: Agent sends notifications and status updates to Slack
**Depends on**: Phase 1
**Requirements**: SLACK-01, SLACK-02
**Success Criteria** (what must be TRUE):
  1. Agent sends Slack notification when human approval needed
  2. Agent status updates appear in Slack channel
**Research**: Complete (see 07-RESEARCH.md)
**Plans**: 1 plan

Plans:
- [x] 07-01: Slack Notification Client

### Phase 8: Human-in-the-Loop
**Goal**: Workflow pauses for human approval before PR merge
**Depends on**: Phase 4, Phase 7
**Requirements**: HITL-01, HITL-02
**Success Criteria** (what must be TRUE):
  1. Workflow pauses before PR merge until human approves
  2. Human can approve or reject agent work
**Research**: Complete (see 08-RESEARCH.md)
**Plans**: 4 plans

Plans:
- [x] 08-01: Temporal Foundation (types, signals, worker, client)
- [x] 08-02: GitHub Merge & Temporal Activities
- [x] 08-03: Approval Workflow with Signal Handling
- [x] 08-04: GitHub Webhook Handler for PR Reviews

### Phase 9: Product Agent
**Goal**: Product Agent gathers requirements and creates Linear tasks
**Depends on**: Phase 3, Phase 5
**Requirements**: PROD-01, PROD-02, PROD-03
**Success Criteria** (what must be TRUE):
  1. Product Agent gathers requirements through conversation
  2. Product Agent creates structured Linear tasks from requirements
  3. Product Agent organizes tasks into workable units
**Research**: Complete (see 09-RESEARCH.md)
**Plans**: 4 plans

Plans:
- [x] 09-01: Linear Issue Creation
- [x] 09-02: Bolt App Factory
- [x] 09-03: Conversation Graph
- [x] 09-04: Message Handlers

### Phase 9.1: Infrastructure & Local Dev (INSERTED)
**Goal**: Production-ready local development setup with proper OAuth and containerized services
**Depends on**: Phase 9
**Requirements**: Linear OAuth flow, Docker Compose, README completeness, Dev Agent entry point
**Success Criteria** (what must be TRUE):
  1. Linear OAuth flow works end-to-end (authorization, token exchange, refresh)
  2. Docker Compose starts all required services (Temporal, etc.) with one command
  3. README documents complete local setup including OAuth and Docker Compose
  4. Dev Agent has entry point script like Product Agent
  5. Full E2E test passes on real repository
**Research**: Complete (9.1-RESEARCH.md)
**Plans**: 3 plans

Plans:
- [x] 9.1-01: Linear OAuth Authorization Script (Wave 1)
- [x] 9.1-02: Docker Compose & Dev Agent Entry Point (Wave 1-2)
- [x] 9.1-03: README Documentation & E2E Verification (Wave 3)

**Details:**
Urgent insertion to address gaps discovered during milestone verification:
- Linear currently uses personal API key instead of OAuth app identity
- Temporal setup not documented in README
- No docker-compose.yml for local services
- Dev Agent lacks start script entry point

### Phase 9.2: Integration Gap Closure (INSERTED)
**Goal**: Close all integration gaps identified by milestone audit to enable E2E workflow execution
**Depends on**: Phase 9.1
**Requirements**: None (all requirements satisfied; integration broken)
**Gap Closure**: Audit gaps 1-4 from v1-MILESTONE-AUDIT.md
**Success Criteria** (what must be TRUE):
  1. prNumber is propagated from commit-pr node through to workflow result
  2. Temporal activities receive properly configured client instances via DI
  3. Linear webhook handler triggers Dev Agent workflow on task delegation
  4. LangGraph checkpointer uses PostgreSQL for state persistence
  5. Full E2E flow works: Linear task → Dev Agent → PR → Approval → Merge
**Research**: Not required (audit provides implementation details)
**Plans**: 3 plans

Plans:
- [x] 9.2-01: prNumber Propagation & Activity DI (Wave 1)
- [x] 9.2-02: Linear Webhook Handler (Wave 2)
- [x] 9.2-03: PostgreSQL Checkpointer Migration (Wave 1)

**Details:**
Urgent insertion to close integration gaps found by `/gsd:audit-milestone`:
- Gap 1: prNumber lost in commit-pr node (blocks approval workflow)
- Gap 2: Temporal activities receive empty objects (blocks all activities)
- Gap 3: No Linear webhook to trigger Dev Agent (blocks automation)
- Gap 4: SQLite in-memory loses state on restart (blocks persistence)

### Phase 9.3: Webhook API Exposure (INSERTED)
**Goal**: Expose webhook endpoints for Linear/GitHub external access via Cloudflare tunnel for local development
**Depends on**: Phase 9.2
**Requirements**: None (integration gap - webhooks exist but unreachable externally)
**Success Criteria** (what must be TRUE):
  1. Cloudflare tunnel exposes dev-agent webhook endpoint to internet
  2. Linear can reach /webhooks/linear to trigger Dev Agent workflows
  3. GitHub can reach /webhooks/github for PR review events
  4. Tunnel configuration documented in README
  5. Docker Compose includes cloudflared service for local dev
  6. Webhook URLs configurable via environment variables
**Research**: Complete (see 09.3-RESEARCH.md)
**Plans**: 1 plan

Plans:
- [ ] 9.3-01: Cloudflare Tunnel Integration (Wave 1)

**Details:**
Critical gap: webhook handlers exist but Linear/GitHub cannot reach them:
- `localhost:3001/webhooks/linear` - unreachable from Linear servers
- `localhost:3001/webhooks/github` - unreachable from GitHub servers
- Cloudflare tunnel provides secure, stable URLs for local development

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8 -> 9 -> 9.1 -> 9.2 -> 9.3

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Core Agent Framework | 5/5 | Complete | 2026-01-16 |
| 2. Execution Environment | 2/2 | Complete | 2026-01-16 |
| 3. Linear Integration | 2/2 | Complete | 2026-01-16 |
| 4. GitHub Integration | 2/2 | Complete | 2026-01-16 |
| 5. Dev Agent | 3/3 | Complete | 2026-01-16 |
| 6. Observability | 2/2 | Complete | 2026-01-16 |
| 7. Slack Integration | 1/1 | Complete | 2026-01-16 |
| 8. Human-in-the-Loop | 4/4 | Complete | 2026-01-16 |
| 9. Product Agent | 4/4 | Complete | 2026-01-18 |
| 9.1 Infrastructure & Local Dev | 3/3 | Complete | 2026-01-18 |
| 9.2 Integration Gap Closure | 3/3 | Complete | 2026-01-19 |
| 9.3 Webhook API Exposure | 0/1 | Pending | - |

---
*Roadmap created: 2026-01-16*
