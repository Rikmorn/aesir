# Requirements: Aesir

**Defined:** 2026-01-16
**Core Value:** End-to-end automated development workflow where agents handle routine development tasks while humans focus on high-value decisions and reviews.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Core Agent Framework

- [x] **CORE-01**: Agent can generate code from natural language task descriptions
- [x] **CORE-02**: Agent execution loop has iteration limits to prevent infinite loops
- [x] **CORE-03**: Agent execution loop has wall-clock timeout to prevent runaway execution
- [x] **CORE-04**: Agent activity is logged (what action, when, why, outcome)
- [x] **CORE-05**: Agents are defined via code/config files (not UI)

### Product Agent

- [x] **PROD-01**: Product Agent can gather requirements through conversation
- [x] **PROD-02**: Product Agent creates structured Linear tasks from requirements
- [x] **PROD-03**: Product Agent tracks and organizes tasks into workable units

### Dev Agent

- [x] **DEV-01**: Dev Agent can pick up assigned tasks from Linear
- [x] **DEV-02**: Dev Agent writes code to implement task requirements
- [x] **DEV-03**: Dev Agent can edit multiple files in a single task
- [x] **DEV-04**: Dev Agent runs tests and interprets results
- [x] **DEV-05**: Dev Agent iterates on code based on test feedback

### Linear Integration

- [x] **LIN-01**: Agent can read tasks from Linear
- [x] **LIN-02**: Agent can update task status in Linear (in-progress, done, etc.)
- [x] **LIN-03**: Webhooks trigger agent when tasks are created/updated (not polling)
- [x] **LIN-04**: Agent appears as a coworker/team member in Linear

### GitHub Integration

- [x] **GH-01**: Agent can create feature branches
- [x] **GH-02**: Agent can commit code changes
- [x] **GH-03**: Agent can open pull requests with description/context
- [x] **GH-04**: Agent can respond to PR feedback (read comments, make changes)

### Slack Integration

- [x] **SLACK-01**: Agent sends notifications when human approval is needed
- [x] **SLACK-02**: Humans can see agent status updates in Slack

### Human-in-the-Loop

- [x] **HITL-01**: Workflow pauses for human approval before PR merge
- [x] **HITL-02**: Human can approve or reject agent work

### Execution Environment

- [x] **EXEC-01**: Agent code runs in Docker container (sandboxed)
- [x] **EXEC-02**: Agent can execute tests within sandbox
- [x] **EXEC-03**: Test results are captured and returned to agent

### Observability

- [x] **OBS-01**: All agent actions are logged with timestamp and context
- [x] **OBS-02**: Logs indicate which workflow/task each action belongs to
- [x] **OBS-03**: Logs are queryable (can find actions for specific task)

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Advanced Observability

- **OBS-04**: Real-time status visibility while agent is running
- **OBS-05**: Full workflow progress view (which step, what's pending)
- **OBS-06**: Distributed tracing across agent calls (OpenTelemetry)

### Multi-LLM Support

- **LLM-01**: Support multiple LLM providers (Claude, GPT-4, etc.)
- **LLM-02**: Route to different models based on task type

### Advanced Human-in-the-Loop

- **HITL-03**: Interactive approval buttons in Slack
- **HITL-04**: Async handoff with full context preservation
- **HITL-05**: Risk-based routing (auto-approve low-risk, require approval for high-risk)

### Security Hardening

- **SEC-01**: Environment separation (dev/staging/prod)
- **SEC-02**: Security scanning on AI-generated code
- **SEC-03**: Branch protection (never push to main directly)
- **SEC-04**: Cost controls with token budgets and attribution

### Advanced Multi-Agent

- **MULTI-01**: Agent-to-agent review loop
- **MULTI-02**: Autonomous PR feedback response (no human trigger)
- **MULTI-03**: Multi-agent coordination protocols

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Agentic QA (full test generation) | CI/CD via GitHub Actions is sufficient for MVP |
| UI for agent creation | Code/config first; UI is a future enhancement |
| Multi-workflow concurrency | Single workflow at a time for MVP; prove the loop first |
| Full codebase indexing | HIGH complexity; context management is hard |
| Agents for other business units | Prove the dev workflow first, then expand |
| Custom tool integrations | Focus on Linear, GitHub, Slack only |
| Real-time updates everywhere | Webhook-driven where latency matters; no polling tax |

## Traceability

Which phases cover which requirements. Updated by create-roadmap.

| Requirement | Phase | Status |
|-------------|-------|--------|
| CORE-01 | Phase 1 | Complete |
| CORE-02 | Phase 1 | Complete |
| CORE-03 | Phase 1 | Complete |
| CORE-04 | Phase 1 | Complete |
| CORE-05 | Phase 1 | Complete |
| EXEC-01 | Phase 2 | Complete |
| EXEC-02 | Phase 2 | Complete |
| EXEC-03 | Phase 2 | Complete |
| LIN-01 | Phase 3 | Complete |
| LIN-02 | Phase 3 | Complete |
| LIN-03 | Phase 3 | Complete |
| LIN-04 | Phase 3 | Complete |
| GH-01 | Phase 4 | Complete |
| GH-02 | Phase 4 | Complete |
| GH-03 | Phase 4 | Complete |
| GH-04 | Phase 4 | Complete |
| DEV-01 | Phase 5 | Complete |
| DEV-02 | Phase 5 | Complete |
| DEV-03 | Phase 5 | Complete |
| DEV-04 | Phase 5 | Complete |
| DEV-05 | Phase 5 | Complete |
| OBS-01 | Phase 6 | Complete |
| OBS-02 | Phase 6 | Complete |
| OBS-03 | Phase 6 | Complete |
| SLACK-01 | Phase 7 | Complete |
| SLACK-02 | Phase 7 | Complete |
| HITL-01 | Phase 8 | Complete |
| HITL-02 | Phase 8 | Complete |
| PROD-01 | Phase 9 | Complete |
| PROD-02 | Phase 9 | Complete |
| PROD-03 | Phase 9 | Complete |

**Coverage:**
- v1 requirements: 31 total
- Mapped to phases: 31
- Unmapped: 0 ✓

---
*Requirements defined: 2026-01-16*
*Last updated: 2026-01-18 after Phase 9 completion*
