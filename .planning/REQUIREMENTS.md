# Requirements: Aesir v2.1 Agents That Ship

**Defined:** 2026-01-25
**Core Value:** End-to-end automated development workflow where agents handle routine tasks while humans focus on reviews

## v2.1 Requirements

Requirements for v2.1 milestone. Each maps to roadmap phases. E2E verification requirements ensure complete wiring (v2.0 lesson: "Infrastructure phases must include consumer migration").

### Infrastructure

- [ ] **INFRA-01**: nginx gateway routes `/linear/*` to linear-integration:3001
- [ ] **INFRA-02**: nginx gateway routes `/github/*` to github-integration:3002
- [ ] **INFRA-03**: nginx gateway routes `/slack/*` to slack-integration:3003
- [ ] **INFRA-04**: nginx gateway routes `/agent/*` to dev-agent:3004
- [ ] **INFRA-05**: Cloudflare tunnel routes external traffic to nginx:80
- [ ] **INFRA-06**: Event dispatcher with config-based routing rules
- [ ] **INFRA-07**: Normalized event schema (id, type, source, timestamp, correlationId, payload)
- [ ] **INFRA-08**: Linear integration normalizes webhooks and dispatches to dispatcher
- [ ] **INFRA-09**: GitHub integration normalizes webhooks and dispatches to dispatcher
- [ ] **INFRA-10**: Slack integration normalizes events and dispatches to dispatcher
- [ ] **INFRA-11**: E2E verified - Linear webhook → integration → dispatcher → dev-agent /events

### Dev Container

- [ ] **CONT-01**: Container image with Node.js, pnpm, git, ripgrep, fd, GitHub CLI
- [ ] **CONT-02**: Spawn container with unique name per task (dev-container-{taskId})
- [ ] **CONT-03**: Clone repository into /workspace/repo in container
- [ ] **CONT-04**: Create feature branch (feature/{issueId}) in container
- [ ] **CONT-05**: Execute arbitrary shell commands via Docker exec
- [ ] **CONT-06**: Capture stdout/stderr from shell commands
- [ ] **CONT-07**: Container persists across workflow phases (not destroyed between steps)
- [ ] **CONT-08**: Resume existing container for feedback loop (PR review → more changes)
- [ ] **CONT-09**: Cleanup container on task completion
- [ ] **CONT-10**: Cleanup container on 24h inactivity timeout
- [ ] **CONT-11**: E2E verified - spawn container, exec command, get output, cleanup

### Product Agent

- [ ] **PROD-01**: Product-agent HTTP service on port 3005 with /events endpoint
- [ ] **PROD-02**: Receive Slack message events from dispatcher
- [ ] **PROD-03**: Interpret message to determine if actionable feature request
- [ ] **PROD-04**: Ask clarifying questions via Slack thread reply
- [ ] **PROD-05**: Wait for user response (Temporal signal on Slack reply)
- [ ] **PROD-06**: Synthesize requirements from conversation
- [ ] **PROD-07**: Create well-structured Linear issue with acceptance criteria
- [ ] **PROD-08**: Notify in Slack with link to created issue
- [ ] **PROD-09**: Add "agent-ready" label to issue for dev-agent routing
- [ ] **PROD-10**: Workflow preserves conversation history across multiple Slack interactions
- [ ] **PROD-11**: E2E verified - Slack message → clarification → Linear issue with correct content

### Dev Agent

- [ ] **DEV-01**: Dev-agent receives Linear issue events from dispatcher
- [ ] **DEV-02**: Filter for issues with "agent-ready" label
- [ ] **DEV-03**: Spawn dev container for task (CONT-02)
- [ ] **DEV-04**: Clone repo and create branch (CONT-03, CONT-04)
- [ ] **DEV-05**: Research codebase via shell (grep, find, cat)
- [ ] **DEV-06**: Build ResearchContext artifact from exploration
- [ ] **DEV-07**: Create ExecutionPlan from requirements + research
- [ ] **DEV-08**: Request plan approval via dual-channel (HITL-01, HITL-02)
- [ ] **DEV-09**: Wait for approval signal (Temporal workflow)
- [ ] **DEV-10**: Execute plan - write files via shell (cat > file << 'EOF')
- [ ] **DEV-11**: Run tests incrementally as code is written
- [ ] **DEV-12**: Commit changes atomically with clear messages
- [ ] **DEV-13**: Run full test suite before push
- [ ] **DEV-14**: Run lint check before push
- [ ] **DEV-15**: Push branch to remote
- [ ] **DEV-16**: Create PR via GitHub MCP (github.create_pull_request)
- [ ] **DEV-17**: Update Linear issue status to "in_review"
- [ ] **DEV-18**: Notify in Slack with PR link
- [ ] **DEV-19**: Receive PR review feedback from dispatcher
- [ ] **DEV-20**: Resume in existing container (CONT-08)
- [ ] **DEV-21**: Address feedback, push additional commits
- [ ] **DEV-22**: Notify Slack when dev-agent encounters error (asks for help)
- [ ] **DEV-23**: E2E verified - Linear issue → dev container → working PR

### Human-in-the-Loop

- [ ] **HITL-01**: Post plan as comment on Linear issue
- [ ] **HITL-02**: Post plan summary to Slack with Approve/Reject buttons
- [ ] **HITL-03**: Accept approval from Linear (comment "approved" or emoji)
- [ ] **HITL-04**: Accept approval from Slack (button click)
- [ ] **HITL-05**: Either approval signals Temporal workflow to continue
- [ ] **HITL-06**: Rejection with feedback triggers re-plan
- [ ] **HITL-07**: PR merge webhook triggers task completion
- [ ] **HITL-08**: Task completion updates Linear status to "done"
- [ ] **HITL-09**: Task completion notifies Slack
- [ ] **HITL-10**: Task completion cleans up container (CONT-09)
- [ ] **HITL-11**: Timeout on approval wait notifies Slack after 24 hours of no response
- [ ] **HITL-12**: E2E verified - approval flow resumes workflow correctly

### MCP Tools

- [ ] **MCP-01**: linear.create_comment - post comment on Linear issue
- [ ] **MCP-02**: slack.update_message - update existing Slack message

## Future Requirements

Deferred beyond v2.1. Tracked for reference.

### Agent Intelligence

- **INTEL-01**: Product-agent learns from past issues to improve questioning
- **INTEL-02**: Dev-agent learns from past PRs to improve code style
- **INTEL-03**: Context summarization between workflow steps

### Multi-Agent Coordination

- **COORD-01**: Dev-agent can request clarification from product-agent
- **COORD-02**: Multiple dev-agents work on related issues

### Production Readiness

- **PROD-01**: CI/CD pipeline for deployment
- **PROD-02**: Monitoring and alerting
- **PROD-03**: Rate limiting and cost controls

## Out of Scope

| Feature | Reason |
|---------|--------|
| Security sandboxing | Defer to v2.2 - complexity, focus on E2E first |
| Multi-repo support | Single repo sufficient for v2.1 validation |
| Mobile Slack app | Web/desktop Slack sufficient |
| OAuth flows for new workspaces | Use pre-configured credentials |
| Agent-to-agent review | Human review sufficient for v2.1 |
| Codebase indexing | Shell-based exploration sufficient |
| Cost tracking | Defer to production readiness |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| (To be filled by roadmapper) | | |

**Coverage:**
- v2.1 requirements: 60 total
- Mapped to phases: 0
- Unmapped: 60 (awaiting roadmap)

---
*Requirements defined: 2026-01-25*
*Last updated: 2026-01-25 after initial definition*
