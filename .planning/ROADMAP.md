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
- [ ] **Phase 3: Linear Integration** - Read/update tasks via webhooks
- [ ] **Phase 4: GitHub Integration** - Branches, commits, and PRs
- [ ] **Phase 5: Dev Agent** - Complete task-to-code workflow
- [ ] **Phase 6: Observability** - Logging and queryable agent actions
- [ ] **Phase 7: Slack Integration** - Notifications and status updates
- [ ] **Phase 8: Human-in-the-Loop** - Approval gates before PR merge
- [ ] **Phase 9: Product Agent** - Requirements gathering and task creation

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
- [ ] 03-01: Linear Client Foundation
- [ ] 03-02: Webhooks & Agent Activities

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
**Plans**: TBD

Plans:
- [ ] 04-01: TBD

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
**Research**: Unlikely (builds on patterns from earlier phases)
**Plans**: TBD

Plans:
- [ ] 05-01: TBD

### Phase 6: Observability
**Goal**: All agent actions are logged and queryable
**Depends on**: Phase 1
**Requirements**: OBS-01, OBS-02, OBS-03
**Success Criteria** (what must be TRUE):
  1. All agent actions logged with timestamp and context
  2. Logs identify which workflow/task each action belongs to
  3. Logs can be queried to find actions for a specific task
**Research**: Unlikely (structured logging is standard)
**Plans**: TBD

Plans:
- [ ] 06-01: TBD

### Phase 7: Slack Integration
**Goal**: Agent sends notifications and status updates to Slack
**Depends on**: Phase 1
**Requirements**: SLACK-01, SLACK-02
**Success Criteria** (what must be TRUE):
  1. Agent sends Slack notification when human approval needed
  2. Agent status updates appear in Slack channel
**Research**: Unlikely (Slack API is mature)
**Plans**: TBD

Plans:
- [ ] 07-01: TBD

### Phase 8: Human-in-the-Loop
**Goal**: Workflow pauses for human approval before PR merge
**Depends on**: Phase 4, Phase 7
**Requirements**: HITL-01, HITL-02
**Success Criteria** (what must be TRUE):
  1. Workflow pauses before PR merge until human approves
  2. Human can approve or reject agent work
**Research**: Likely (async handoff patterns with Temporal)
**Research topics**: Temporal signal patterns, workflow suspension, approval state management, timeout handling for human responses
**Plans**: TBD

Plans:
- [ ] 08-01: TBD

### Phase 9: Product Agent
**Goal**: Product Agent gathers requirements and creates Linear tasks
**Depends on**: Phase 3, Phase 5
**Requirements**: PROD-01, PROD-02, PROD-03
**Success Criteria** (what must be TRUE):
  1. Product Agent gathers requirements through conversation
  2. Product Agent creates structured Linear tasks from requirements
  3. Product Agent organizes tasks into workable units
**Research**: Likely (multi-agent coordination patterns)
**Research topics**: Multi-agent handoff protocols, context preservation between agents, task decomposition patterns
**Plans**: TBD

Plans:
- [ ] 09-01: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Core Agent Framework | 5/5 | Complete | 2026-01-16 |
| 2. Execution Environment | 2/2 | Complete | 2026-01-16 |
| 3. Linear Integration | 0/TBD | Not started | - |
| 4. GitHub Integration | 0/TBD | Not started | - |
| 5. Dev Agent | 0/TBD | Not started | - |
| 6. Observability | 0/TBD | Not started | - |
| 7. Slack Integration | 0/TBD | Not started | - |
| 8. Human-in-the-Loop | 0/TBD | Not started | - |
| 9. Product Agent | 0/TBD | Not started | - |

---
*Roadmap created: 2026-01-16*
