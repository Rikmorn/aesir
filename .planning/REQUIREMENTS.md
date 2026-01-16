# Requirements: Aesir

**Defined:** 2026-01-16
**Core Value:** End-to-end automated development workflow where agents handle routine development tasks while humans focus on high-value decisions and reviews.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Core Agent Framework

- [ ] **CORE-01**: Agent can generate code from natural language task descriptions
- [ ] **CORE-02**: Agent execution loop has iteration limits to prevent infinite loops
- [ ] **CORE-03**: Agent execution loop has wall-clock timeout to prevent runaway execution
- [ ] **CORE-04**: Agent activity is logged (what action, when, why, outcome)
- [ ] **CORE-05**: Agents are defined via code/config files (not UI)

### Product Agent

- [ ] **PROD-01**: Product Agent can gather requirements through conversation
- [ ] **PROD-02**: Product Agent creates structured Linear tasks from requirements
- [ ] **PROD-03**: Product Agent tracks and organizes tasks into workable units

### Dev Agent

- [ ] **DEV-01**: Dev Agent can pick up assigned tasks from Linear
- [ ] **DEV-02**: Dev Agent writes code to implement task requirements
- [ ] **DEV-03**: Dev Agent can edit multiple files in a single task
- [ ] **DEV-04**: Dev Agent runs tests and interprets results
- [ ] **DEV-05**: Dev Agent iterates on code based on test feedback

### Linear Integration

- [ ] **LIN-01**: Agent can read tasks from Linear
- [ ] **LIN-02**: Agent can update task status in Linear (in-progress, done, etc.)
- [ ] **LIN-03**: Webhooks trigger agent when tasks are created/updated (not polling)
- [ ] **LIN-04**: Agent appears as a coworker/team member in Linear

### GitHub Integration

- [ ] **GH-01**: Agent can create feature branches
- [ ] **GH-02**: Agent can commit code changes
- [ ] **GH-03**: Agent can open pull requests with description/context
- [ ] **GH-04**: Agent can respond to PR feedback (read comments, make changes)

### Slack Integration

- [ ] **SLACK-01**: Agent sends notifications when human approval is needed
- [ ] **SLACK-02**: Humans can see agent status updates in Slack

### Human-in-the-Loop

- [ ] **HITL-01**: Workflow pauses for human approval before PR merge
- [ ] **HITL-02**: Human can approve or reject agent work

### Execution Environment

- [ ] **EXEC-01**: Agent code runs in Docker container (sandboxed)
- [ ] **EXEC-02**: Agent can execute tests within sandbox
- [ ] **EXEC-03**: Test results are captured and returned to agent

### Observability

- [ ] **OBS-01**: All agent actions are logged with timestamp and context
- [ ] **OBS-02**: Logs indicate which workflow/task each action belongs to
- [ ] **OBS-03**: Logs are queryable (can find actions for specific task)

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
| CORE-01 | Phase 1 | Pending |
| CORE-02 | Phase 1 | Pending |
| CORE-03 | Phase 1 | Pending |
| CORE-04 | Phase 1 | Pending |
| CORE-05 | Phase 1 | Pending |
| EXEC-01 | Phase 2 | Pending |
| EXEC-02 | Phase 2 | Pending |
| EXEC-03 | Phase 2 | Pending |
| LIN-01 | Phase 3 | Pending |
| LIN-02 | Phase 3 | Pending |
| LIN-03 | Phase 3 | Pending |
| LIN-04 | Phase 3 | Pending |
| GH-01 | Phase 4 | Pending |
| GH-02 | Phase 4 | Pending |
| GH-03 | Phase 4 | Pending |
| GH-04 | Phase 4 | Pending |
| DEV-01 | Phase 5 | Pending |
| DEV-02 | Phase 5 | Pending |
| DEV-03 | Phase 5 | Pending |
| DEV-04 | Phase 5 | Pending |
| DEV-05 | Phase 5 | Pending |
| OBS-01 | Phase 6 | Pending |
| OBS-02 | Phase 6 | Pending |
| OBS-03 | Phase 6 | Pending |
| SLACK-01 | Phase 7 | Pending |
| SLACK-02 | Phase 7 | Pending |
| HITL-01 | Phase 8 | Pending |
| HITL-02 | Phase 8 | Pending |
| PROD-01 | Phase 9 | Pending |
| PROD-02 | Phase 9 | Pending |
| PROD-03 | Phase 9 | Pending |

**Coverage:**
- v1 requirements: 31 total
- Mapped to phases: 31
- Unmapped: 0 ✓

---
*Requirements defined: 2026-01-16*
*Last updated: 2026-01-16 after roadmap creation*
