# Requirements — v1 to v2.9

<!-- Generated on 2026-09-15 by concatenating the per-milestone REQUIREMENTS records under docs/history/milestones/ and the v2.9 REQUIREMENTS.md. Do not edit by hand; the source files are the record. -->

Each milestone's requirements as written when the milestone was planned, in order. Satisfied/deferred outcomes are in the matching `*-MILESTONE-AUDIT.md` (§Requirements Coverage) for v1–v2.8; the v2.9 traceability table is at the end of its section.

## v1

_Source: `docs/history/milestones/v1-REQUIREMENTS.md`_


**Archived:** 2026-01-19
**Status:** SHIPPED

This is the archived requirements specification for v1.
For current requirements, see `.planning/REQUIREMENTS.md` (created for next milestone).

---

# Requirements: Aesir

**Defined:** 2026-01-16
**Core Value:** End-to-end automated development workflow where agents handle routine development tasks while humans focus on high-value decisions and reviews.

### v1 Requirements

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

### v2 Requirements

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

### Out of Scope

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

### Traceability

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
- Completed: 31
- Unmapped: 0

---

### Milestone Summary

**Shipped:** 31 of 31 v1 requirements
**Adjusted:** None
**Dropped:** None

All v1 requirements were shipped as originally defined. No scope changes during implementation.

---
*Archived: 2026-01-19 as part of v1 milestone completion*

## v2.0

_Source: `docs/history/milestones/v2.0-REQUIREMENTS.md`_


**Archived:** 2026-01-25
**Status:** SHIPPED

This is the archived requirements specification for v2.0 Foundation.
For current requirements, see `.planning/REQUIREMENTS.md` (created for next milestone).

---

### v2.0 Requirements

**Defined:** 2026-01-19
**Core Value:** Maintainable, scalable foundation for end-to-end automated development workflows

Requirements for Foundation milestone. Full restructure from "prove it works" to "maintainable and scalable."

### Tooling & DX

- [x] **TOOL-01**: Biome configured for linting and formatting (replaces ESLint/Prettier)
- [x] **TOOL-02**: npm standardized as package manager (yarn.lock removed)
- [x] **TOOL-03**: Pre-commit hooks enforce code quality before commits
- [x] **TOOL-04**: dotenv-flow configured for environment hierarchy (.env.development, .env.test, .env.production)
- [x] **TOOL-05**: Type-safe configuration with Zod validation at startup (fail fast on missing/invalid env vars)

### Code Quality

- [x] **QUAL-01**: Consistent error handling pattern at service boundaries (neverthrow Result types)
- [x] **QUAL-02**: Input validation at all external boundaries using Zod schemas
- [x] **QUAL-03**: Module index files for public APIs (each module exports via index.ts)
- [x] **QUAL-04**: Branded types for cross-service IDs — *Descoped: named params instead*
- [x] **QUAL-05**: Typed error hierarchy with error codes (AppError base class, domain-specific errors)
- [x] **QUAL-06**: Dead code removed and duplicates consolidated

### Architecture

- [x] **ARCH-01**: Platform layer implemented (config, secrets, observability, state management)
- [x] **ARCH-02**: Integrations layer with Linear, GitHub, Slack as independent packages
- [x] **ARCH-03**: Agents layer using Platform and Integrations through normalized protocols
- [x] **ARCH-04**: pnpm workspace monorepo structure with clear package boundaries
- [x] **ARCH-05**: MCP servers in each integration for agent tool calls
- [x] **ARCH-06**: Factory functions for dependency injection (no global singletons)
- [x] **ARCH-07**: Layer dependency rules enforced (Agents -> Integrations -> Platform)

### Data Layer

- [x] **DATA-01**: PostgreSQL schema structure (platform, integrations, observability schemas)
- [x] **DATA-02**: Credential storage with encryption (migrate from .tokens/ files to database)
- [x] **DATA-03**: Webhook idempotency tracking (integrations.webhook_deliveries table)
- [x] **DATA-04**: Agent execution records for observability (observability.agent_executions table)
- [x] **DATA-05**: Sync cursor management for integrations (integrations.sync_cursors table)
- [x] **DATA-06**: LangGraph checkpoint cleanup policy implemented

### Testing

- [ ] **TEST-01**: Test coverage reporting configured with targets (70%+ for core modules) — *Blocked by 4 pre-existing test failures*
- [x] **TEST-02**: testcontainers for PostgreSQL integration tests
- [x] **TEST-03**: Test fixtures and factories for domain objects
- [x] **TEST-04**: Fast local test mode (skip slow Docker tests for rapid iteration)
- [x] **TEST-05**: Test isolation via transaction-per-test or testcontainers
- [ ] **TEST-06**: CI test execution as quality gate — *Deferred to v3.0 (Phase 21)*

### CI/CD Pipeline (Deferred to v3.0)

- [ ] **CICD-01**: GitHub Actions workflow (lint -> typecheck -> test -> integration)
- [ ] **CICD-02**: Quality gates blocking PRs until quality bar met
- [ ] **CICD-03**: Branch protection rules enforced
- [ ] **CICD-04**: Dependency caching for faster CI runs
- [ ] **CICD-05**: Parallel job execution where possible
- [ ] **CICD-06**: GitHub Actions pinned to SHA (supply chain security)

### Observability

- [x] **OBSV-01**: pino logger replacing custom hand-rolled logging
- [x] **OBSV-02**: Request correlation IDs linking logs across service boundaries
- [x] **OBSV-03**: Structured JSON logging with sensitive data redaction

### Local Development

- [x] **LDEV-01**: One-command local dev environment (Docker Compose)
- [x] **LDEV-02**: Health check endpoints for all services
- [x] **LDEV-03**: Graceful shutdown handling (SIGTERM, drain connections)
- [x] **LDEV-04**: Docker hot reload for fast iteration
- [x] **LDEV-05**: .claude files updated to reflect new architecture
- [x] **LDEV-06**: cursor files for AI tool understanding

### Deferred (Post v2.0)

### Observability (Future)
- **OBSV-F01**: OpenTelemetry integration for distributed tracing
- **OBSV-F02**: Service metrics (latency, throughput, error rates)

### CI/CD (Future)
- **CICD-F01**: Staged deployment to staging on merge to main
- **CICD-F02**: Deployment automation to production

### Data (Future)
- **DATA-F01**: TimescaleDB extension for metrics if retention/query latency becomes bottleneck
- **DATA-F02**: pgvector for codebase indexing (feature milestone)
- **DATA-F03**: Multi-tenant isolation if platform supports multiple teams

### Features (Future Milestones)
- **FEAT-F01**: Multi-LLM flexibility (architecture supports, implementation deferred)
- **FEAT-F02**: Agent-to-agent review loop (architecture supports multi-agent)
- **FEAT-F03**: Real-time status visibility while agent runs
- **FEAT-F04**: Cost controls with token budgets

### Out of Scope

| Feature | Reason |
|---------|--------|
| Full codebase indexing | HIGH complexity; defer to feature milestone |
| Production environment | Local + staging only for v2.0 |
| Multi-agent coordination implementation | Architecture supports it; dedicated milestone later |
| UI for agent creation | Code/config first |
| Event sourcing | Current state-based approach is sufficient |
| GraphQL for internal communication | REST with typed clients is simpler |
| Effect.ts | Too much paradigm shift; neverthrow gives 80% of benefit |
| InversifyJS/TSyringe everywhere | Constructor injection sufficient at current scale |
| 100% code coverage target | Leads to meaningless tests; target 70% on core logic |
| E2E tests for everything | Testing pyramid: many unit, some integration, few E2E |

### Traceability

Final status for all requirements mapped to phases.

| Requirement | Phase | Status |
|-------------|-------|--------|
| TOOL-01 | Phase 10 | Complete |
| TOOL-02 | Phase 10 | Complete |
| TOOL-03 | Phase 10 | Complete |
| TOOL-04 | Phase 10 | Complete |
| TOOL-05 | Phase 10 | Complete |
| ARCH-04 | Phase 11 | Complete |
| OBSV-01 | Phase 12 | Complete |
| OBSV-02 | Phase 12 | Complete |
| OBSV-03 | Phase 12 | Complete |
| DATA-01 | Phase 13 | Complete |
| DATA-02 | Phase 13 | Complete |
| DATA-03 | Phase 14 | Complete |
| DATA-04 | Phase 14 | Complete |
| DATA-05 | Phase 14 | Complete |
| DATA-06 | Phase 14 | Complete |
| ARCH-01 | Phase 14 | Complete |
| ARCH-06 | Phase 14 | Complete |
| ARCH-07 | Phase 14 | Complete |
| QUAL-01 | Phase 15 | Complete |
| QUAL-02 | Phase 15 | Complete |
| QUAL-03 | Phase 15 | Complete |
| QUAL-04 | Phase 15 | Descoped (named params) |
| QUAL-05 | Phase 15 | Complete |
| QUAL-06 | Phase 15 | Complete |
| ARCH-02 | Phase 16, 17, 18 | Complete |
| ARCH-03 | Phase 16, 17, 18, 22.2 | Complete |
| ARCH-05 | Phase 19, 22.2 | Complete |
| TEST-01 | Phase 20 | Blocked (4 pre-existing failures) |
| TEST-02 | Phase 20 | Complete |
| TEST-03 | Phase 20 | Complete |
| TEST-04 | Phase 20 | Complete |
| TEST-05 | Phase 20 | Complete |
| TEST-06 | Phase 21 | Deferred to v3.0 |
| CICD-01-06 | Phase 21 | Deferred to v3.0 |
| LDEV-01 | Phase 22 | Complete |
| LDEV-02 | Phase 22 | Complete |
| LDEV-03 | Phase 22 | Complete |
| LDEV-04 | Phase 22 | Complete |
| LDEV-05 | Phase 10, 22.2 | Complete |
| LDEV-06 | Phase 10, 22.2 | Complete |

**Coverage:**
- v2.0 requirements: 40 total
- Complete: 37
- Blocked: 1 (TEST-01)
- Deferred: 7 (CI/CD)

---

### Milestone Summary

**Shipped:** 37 of 40 v2.0 requirements
**Adjusted:** QUAL-04 descoped (named params instead of branded types)
**Blocked:** TEST-01 (4 pre-existing test failures block coverage verification)
**Deferred:** Phase 21 CI/CD requirements (7) moved to v3.0

---
*Archived: 2026-01-25 as part of v2.0 milestone completion*

## v2.1

_Source: `docs/history/milestones/v2.1-REQUIREMENTS.md`_


**Archived:** 2026-01-28
**Status:** ✅ SHIPPED

This is the archived requirements specification for v2.1.
For current requirements, see `.planning/REQUIREMENTS.md` (created for next milestone).

---

# Requirements: Aesir v2.1 Agents That Ship

**Defined:** 2026-01-25
**Core Value:** End-to-end automated development workflow where agents handle routine tasks while humans focus on reviews

### v2.1 Requirements

Requirements for v2.1 milestone. Each maps to roadmap phases. E2E verification requirements ensure complete wiring (v2.0 lesson: "Infrastructure phases must include consumer migration").

### Infrastructure

- [x] **INFRA-01**: nginx gateway routes `/linear/*` to linear-integration:3001
- [x] **INFRA-02**: nginx gateway routes `/github/*` to github-integration:3002
- [x] **INFRA-03**: nginx gateway routes `/slack/*` to slack-integration:3003
- [x] **INFRA-04**: nginx gateway routes `/agent/*` to dev-agent:3004
- [x] **INFRA-05**: Cloudflare tunnel routes external traffic to nginx:80
- [x] **INFRA-06**: Event dispatcher with config-based routing rules
- [x] **INFRA-07**: Normalized event schema (id, type, source, timestamp, correlationId, payload)
- [x] **INFRA-08**: Linear integration normalizes webhooks and dispatches to dispatcher
- [x] **INFRA-09**: GitHub integration normalizes webhooks and dispatches to dispatcher
- [x] **INFRA-10**: Slack integration normalizes events and dispatches to dispatcher
- [x] **INFRA-11**: E2E verified - Linear webhook → integration → dispatcher → dev-agent /events

### Dev Container

- [x] **CONT-01**: Container image with Node.js, pnpm, git, ripgrep, fd, GitHub CLI
- [x] **CONT-02**: Spawn container with unique name per task (dev-container-{taskId})
- [x] **CONT-03**: Clone repository into /workspace/repo in container
- [x] **CONT-04**: Create feature branch (feature/{issueId}) in container
- [x] **CONT-05**: Execute arbitrary shell commands via Docker exec
- [x] **CONT-06**: Capture stdout/stderr from shell commands
- [x] **CONT-07**: Container persists across workflow phases (not destroyed between steps)
- [x] **CONT-08**: Resume existing container for feedback loop (PR review → more changes)
- [x] **CONT-09**: Cleanup container on task completion
- [x] **CONT-10**: Cleanup container on 24h inactivity timeout
- [x] **CONT-11**: E2E verified - spawn container, exec command, get output, cleanup

### Product Agent

- [x] **PROD-01**: Product-agent HTTP service on port 3005 with /events endpoint
- [x] **PROD-02**: Receive Slack message events from dispatcher
- [x] **PROD-03**: Interpret message to determine if actionable feature request
- [x] **PROD-04**: Ask clarifying questions via Slack thread reply
- [x] **PROD-05**: Wait for user response (Temporal signal on Slack reply)
- [x] **PROD-06**: Synthesize requirements from conversation
- [x] **PROD-07**: Create well-structured Linear issue with acceptance criteria
- [x] **PROD-08**: Notify in Slack with link to created issue
- [x] **PROD-09**: Add "agent-ready" label to issue for dev-agent routing
- [x] **PROD-10**: Workflow preserves conversation history across multiple Slack interactions
- [x] **PROD-11**: E2E verified - Slack message → clarification → Linear issue with correct content

### Dev Agent

- [x] **DEV-01**: Dev-agent receives Linear issue events from dispatcher
- [x] **DEV-02**: Filter for issues with "agent-ready" label
- [x] **DEV-03**: Spawn dev container for task (CONT-02)
- [x] **DEV-04**: Clone repo and create branch (CONT-03, CONT-04)
- [x] **DEV-05**: Research codebase via shell (grep, find, cat)
- [x] **DEV-06**: Build ResearchContext artifact from exploration
- [x] **DEV-07**: Create ExecutionPlan from requirements + research
- [x] **DEV-08**: Request plan approval via dual-channel (HITL-01, HITL-02)
- [x] **DEV-09**: Wait for approval signal (Temporal workflow)
- [x] **DEV-10**: Execute plan - write files via shell (cat > file << 'EOF')
- [x] **DEV-11**: Run tests incrementally as code is written
- [x] **DEV-12**: Commit changes atomically with clear messages
- [x] **DEV-13**: Run full test suite before push
- [x] **DEV-14**: Run lint check before push
- [x] **DEV-15**: Push branch to remote
- [x] **DEV-16**: Create PR via GitHub MCP (github.create_pull_request)
- [x] **DEV-17**: Update Linear issue status to "in_review"
- [x] **DEV-18**: Notify in Slack with PR link
- [x] **DEV-19**: Receive PR review feedback from dispatcher
- [x] **DEV-20**: Resume in existing container (CONT-08)
- [x] **DEV-21**: Address feedback, push additional commits
- [x] **DEV-22**: Notify Slack when dev-agent encounters error (asks for help)
- [x] **DEV-23**: E2E verified - Linear issue → dev container → working PR

### Human-in-the-Loop

- [x] **HITL-01**: Post plan as comment on Linear issue
- [x] **HITL-02**: Post plan summary to Slack with Approve/Reject buttons
- [x] **HITL-03**: Accept approval from Linear (comment "approved" or emoji)
- [x] **HITL-04**: Accept approval from Slack (button click)
- [x] **HITL-05**: Either approval signals Temporal workflow to continue
- [x] **HITL-06**: Rejection with feedback triggers re-plan
- [x] **HITL-07**: PR merge webhook triggers task completion
- [x] **HITL-08**: Task completion updates Linear status to "done"
- [x] **HITL-09**: Task completion notifies Slack
- [x] **HITL-10**: Task completion cleans up container (CONT-09)
- [x] **HITL-11**: Timeout on approval wait notifies Slack after 24 hours of no response
- [x] **HITL-12**: E2E verified - approval flow resumes workflow correctly

### MCP Tools

- [x] **MCP-01**: linear.create_comment - post comment on Linear issue
- [x] **MCP-02**: slack.update_message - update existing Slack message

### Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| INFRA-01 | Phase 23 | Complete |
| INFRA-02 | Phase 23 | Complete |
| INFRA-03 | Phase 23 | Complete |
| INFRA-04 | Phase 23 | Complete |
| INFRA-05 | Phase 23 | Complete |
| INFRA-06 | Phase 23 | Complete |
| INFRA-07 | Phase 23 | Complete |
| INFRA-08 | Phase 23 | Complete |
| INFRA-09 | Phase 23 | Complete |
| INFRA-10 | Phase 23 | Complete |
| INFRA-11 | Phase 23 | Complete |
| CONT-01 | Phase 24 | Complete |
| CONT-02 | Phase 24 | Complete |
| CONT-03 | Phase 24 | Complete |
| CONT-04 | Phase 24 | Complete |
| CONT-05 | Phase 24 | Complete |
| CONT-06 | Phase 24 | Complete |
| CONT-07 | Phase 24 | Complete |
| CONT-08 | Phase 24 | Complete |
| CONT-09 | Phase 24 | Complete |
| CONT-10 | Phase 24 | Complete |
| CONT-11 | Phase 24 | Complete |
| PROD-01 | Phase 25 | Complete |
| PROD-02 | Phase 25 | Complete |
| PROD-03 | Phase 25 | Complete |
| PROD-04 | Phase 25 | Complete |
| PROD-05 | Phase 25 | Complete |
| PROD-06 | Phase 25 | Complete |
| PROD-07 | Phase 25 | Complete |
| PROD-08 | Phase 25 | Complete |
| PROD-09 | Phase 25 | Complete |
| PROD-10 | Phase 25 | Complete |
| PROD-11 | Phase 25 | Complete |
| MCP-01 | Phase 25 | Complete |
| DEV-01 | Phase 26 | Complete |
| DEV-02 | Phase 26 | Complete |
| DEV-03 | Phase 26 | Complete |
| DEV-04 | Phase 26 | Complete |
| DEV-05 | Phase 26 | Complete |
| DEV-06 | Phase 26 | Complete |
| DEV-07 | Phase 26 | Complete |
| DEV-08 | Phase 26 | Complete |
| DEV-09 | Phase 26 | Complete |
| DEV-10 | Phase 26 | Complete |
| DEV-11 | Phase 26 | Complete |
| DEV-12 | Phase 26 | Complete |
| DEV-13 | Phase 26 | Complete |
| DEV-14 | Phase 26 | Complete |
| DEV-15 | Phase 26 | Complete |
| DEV-16 | Phase 26 | Complete |
| DEV-17 | Phase 26 | Complete |
| DEV-18 | Phase 26 | Complete |
| DEV-19 | Phase 26 | Complete |
| DEV-20 | Phase 26 | Complete |
| DEV-21 | Phase 26 | Complete |
| DEV-22 | Phase 26 | Complete |
| DEV-23 | Phase 26 | Complete |
| MCP-02 | Phase 26 | Complete |
| HITL-01 | Phase 27 | Complete |
| HITL-02 | Phase 27 | Complete |
| HITL-03 | Phase 27 | Complete |
| HITL-04 | Phase 27 | Complete |
| HITL-05 | Phase 27 | Complete |
| HITL-06 | Phase 27 | Complete |
| HITL-07 | Phase 27 | Complete |
| HITL-08 | Phase 27 | Complete |
| HITL-09 | Phase 27 | Complete |
| HITL-10 | Phase 27 | Complete |
| HITL-11 | Phase 27 | Complete |
| HITL-12 | Phase 27 | Complete |

**Coverage:**
- v2.1 requirements: 60 total
- Complete: 60 (100%)

---

### Milestone Summary

**Shipped:** 60 of 60 v2.1 requirements

**Adjusted:** None

**Dropped:** None

---
*Archived: 2026-01-28 as part of v2.1 milestone completion*

## v2.2

_Source: `docs/history/milestones/v2.2-REQUIREMENTS.md`_


**Archived:** 2026-02-01
**Status:** SHIPPED

This is the archived requirements specification for v2.2.
For current requirements, see `.planning/REQUIREMENTS.md` (created for next milestone).

---

# Requirements: Aesir v2.2 Agentic Architecture

**Defined:** 2026-01-29
**Core Value:** End-to-end automated development workflow where agents reason about what to do, use tools to act, observe results, and adapt -- instead of following predetermined graphs.

### v2.2 Requirements

### Agentic Loop Runtime

- [x] **LOOP-01**: Core `runAgentLoop()` function iterates: send to LLM -> receive tool calls -> execute tools -> feed results back -> repeat until LLM responds with text only or guardrail hit
- [x] **LOOP-02**: Uses `@anthropic-ai/sdk` native tool-use API (messages.create with tools parameter), replacing all `@langchain/anthropic` usage
- [x] **LOOP-03**: Tool definitions use Zod schemas converted to JSON Schema via SDK's `betaZodTool()` -- no separate conversion library
- [x] **LOOP-04**: Configurable iteration limit per agent invocation (default: 50 sub-agent, 100 orchestrator, 10 router)
- [x] **LOOP-05**: Configurable token budget per task, shared across orchestrator and all sub-agents via mutable counter
- [x] **LOOP-06**: AbortSignal support for clean cancellation of in-flight LLM calls
- [x] **LOOP-07**: Tracing callbacks (onToolCall, onResponse) called on every iteration for automatic trace recording
- [x] **LOOP-08**: Returns structured result: status (completed/max_iterations/max_tokens/aborted/error), output, structured output, tool call count, token counts, trace
- [x] **LOOP-09**: Handles all Anthropic `stop_reason` values (end_turn, tool_use, max_tokens, stop_sequence, and any new values) -- does not break on unexpected values

### Agent Tool Library

- [x] **TOOL-01**: Codebase tools execute inside dev container via DevContainerManager: `read_file`, `write_file`, `search_codebase`, `list_directory`, `run_command`
- [x] **TOOL-02**: MCP integration tools wrap existing `callMcpTool()` as ToolDefinitions -- Linear (5 tools), GitHub (9 tools), Slack (5 tools) -- all 19 existing MCP tools available
- [x] **TOOL-03**: Git tools wrap GitHub MCP operations: `create_branch`, `create_commit`, `create_pull_request`, `get_pull_request`, `merge_pull_request`
- [x] **TOOL-04**: `spawn_agent` coordinator tool creates a nested agentic loop with focused context and restricted tool set -- returns agent result to orchestrator
- [x] **TOOL-05**: `request_human_input` tool signals Temporal workflow to wait for human response, returns when signal received
- [x] **TOOL-06**: Each tool has Zod input schema, description string, and async execute function returning `{ content: string, isError?: boolean }`
- [x] **TOOL-07**: Tool errors returned to LLM with `isError: true` -- LLM reasons about errors instead of tool throwing exceptions that break the loop
- [x] **TOOL-08**: Per-agent tool sets (toolkits): orchestrator gets coordination + lightweight codebase tools, researcher gets read-only codebase tools, coder gets read+write codebase tools, tester gets read+run tools

### Dev Agent Orchestrator

- [x] **DEVO-01**: Orchestrator agentic loop replaces the 13-node LangGraph graph and `routeByPhase()` switch statement
- [x] **DEVO-02**: Orchestrator spawns focused sub-agents (researcher, coder, tester) with isolated context -- sub-agent gets task-relevant context only, not full history
- [x] **DEVO-03**: Researcher sub-agent explores codebase with read-only tools, returns structured findings (relevant files, patterns, conventions)
- [x] **DEVO-04**: Coder sub-agent implements changes with read+write tools, receives plan + relevant file contents + conventions as context
- [x] **DEVO-05**: Tester sub-agent runs and diagnoses tests with read+run tools, receives changed files and project info (package manager, test runner)
- [x] **DEVO-06**: New Temporal activity `runOrchestratorPreApproval` -- research + plan -> returns plan for approval
- [x] **DEVO-07**: New Temporal activity `runOrchestratorPostApproval` -- execute + test + PR -> returns PR details
- [x] **DEVO-08**: New Temporal activity `handleOrchestratorFeedback` -- address PR review comments -> returns updated files
- [x] **DEVO-09**: Orchestrator decides whether research is needed based on task complexity (README edit -> skip, feature -> research)
- [x] **DEVO-10**: Orchestrator decides plan granularity (trivial change -> brief plan, complex -> detailed breakdown)
- [x] **DEVO-11**: LLM-diagnosed error recovery -- when tests fail, agent reads error output, diagnoses cause, and fixes (not blind retry)
- [x] **DEVO-12**: Orchestrator decides test approach based on task (docs-only -> no tests, feature -> unit tests, API change -> integration tests)
- [x] **DEVO-13**: Escalation after 3 distinct approaches fail (LLM must try different approach each time, not identical retries)
- [x] **DEVO-14**: System prompt includes agent identity, issue details, project conventions, constraints, available tools, sub-agent guidance
- [x] **DEVO-15**: Simplified Temporal workflow: setup -> pre-approval loop -> approval wait -> post-approval loop -> PR wait -> feedback loop -> complete

### Product Agent

- [x] **PROD-01**: Single agentic loop replaces the 6-node LangGraph graph (classify->analyze->clarify->confirm->create->notify)
- [x] **PROD-02**: Adapts to input clarity -- clear request with all details creates issue immediately (1-2 tool calls), vague request asks focused clarifying questions
- [x] **PROD-03**: Multi-turn conversation via Temporal `userReplySignal` waits between turns
- [x] **PROD-04**: Cancellation intent recognition via LLM reasoning (no hardcoded phrase list like "nevermind", "cancel", "nvm")
- [x] **PROD-05**: Duplicate detection -- searches existing Linear issues before creating, suggests updating existing if similar found
- [x] **PROD-06**: System prompt includes agent identity, full thread history, issue quality guidelines, clarification guidelines
- [x] **PROD-07**: Same timeout handling as current (24h reminder, 72h total)

### Smart Router

- [x] **ROUT-01**: Hybrid routing -- deterministic rules for unambiguous events (PR merged, button clicked, etc.), LLM reasoning only for ambiguous events (Slack messages, Linear comments with unclear intent)
- [x] **ROUT-02**: Replaces hardcoded event switches in `dev-agent/api/events.ts` and `product-agent/api/events.ts`
- [x] **ROUT-03**: Absorbs approval intent classifier from `dev-agent/classification/approval.ts` into LLM reasoning path
- [x] **ROUT-04**: Router tools: `query_running_workflows`, `start_workflow`, `signal_workflow`, `send_message` (for clarification)
- [x] **ROUT-05**: All current event types route correctly: `slack.app_mention.created`, `linear.comment.created`, `slack.block_actions.*`, `github.pull_request.*`, `slack.message.created` in thread
- [x] **ROUT-06**: Fallback: if LLM routing fails or times out, log the event and alert -- do not silently drop events
- [x] **ROUT-07**: Router iteration limit: 10 (should decide quickly)

### Context Management

- [x] **CTXM-01**: New database table `agents.context_snapshots` with semantic context (summary, completed_actions, pending_intent, known_issues, project_context, key_files, research_findings, plan)
- [x] **CTXM-02**: New database table `agents.tasks` with critical structured data (task_id, issue_id, workflow_id, status, container_id, branch_name, pr_number, approval_status, slack_channel)
- [x] **CTXM-03**: Context written at end of each Temporal activity via LLM self-summarization (one final LLM call) + programmatic extraction for structured fields
- [x] **CTXM-04**: Context read at start of activity resume -- post-approval activity receives summary of research and plan, post-crash resumes from latest snapshot
- [x] **CTXM-05**: Sub-agent context briefing -- orchestrator produces focused brief for each sub-agent (only relevant info, not full history) *(implemented in-memory per architectural decision)*
- [x] **CTXM-06**: Drizzle ORM schema definitions in `agents` PostgreSQL schema namespace
- [x] **CTXM-07**: Database migration for all new tables

### Execution Tracing

- [x] **TRAC-01**: New database table `agents.execution_traces` with parent/child agent correlation (agent_instance_id, parent_agent_instance_id)
- [x] **TRAC-02**: Every tool call, tool result, LLM response, agent spawn, and agent complete automatically logged via loop callbacks *(partial: tool_result deferred -- 4 of 5 types recorded)*
- [x] **TRAC-03**: Token count (input + output) and duration tracked per step
- [x] **TRAC-04**: Traces queryable by task_id, workflow_id, and agent_instance_id
- [x] **TRAC-05**: No manual instrumentation required -- tracing is a runtime responsibility built into `runAgentLoop()`

### Guardrails & Hardening

- [x] **GUAR-01**: All `run_command` tool calls execute inside DevContainerManager sandbox -- no host access
- [x] **GUAR-02**: Agents cannot call `merge_pull_request` -- human merges only
- [x] **GUAR-03**: Configurable guardrail values via AgentConfig (iteration limits, token budgets, model selection)
- [x] **GUAR-04**: Temporal activity retry config designed for agentic loops -- appropriate retry count and backoff for LLM-heavy activities
- [x] **GUAR-05**: Token budget enforcement -- loop checks remaining budget before each LLM call, terminates gracefully if exhausted
- [x] **GUAR-06**: Cost tracking per task -- total tokens (input + output) aggregated across orchestrator and all sub-agents
- [x] **GUAR-07**: All `@langchain/*` dependencies removed from `@aesir/agents`: `@langchain/anthropic`, `@langchain/core`, `@langchain/langgraph`, `@langchain/langgraph-checkpoint-postgres`
- [x] **GUAR-08**: LangGraph code deleted: graph definitions, node implementations, state schemas, phase enums, `routeByPhase()`, `code-workflow/` directory
- [x] **GUAR-09**: `PostgresSaver` checkpointer removed -- replaced by agents.context_snapshots

### End-to-End Validation

- [x] **E2EV-01**: Full flow works: Slack message -> product agent -> Linear issue -> dev agent -> approved PR
- [x] **E2EV-02**: README edit completes in under 10 tool calls, no test execution, no unnecessary research
- [x] **E2EV-03**: Simple feature: dev agent implements function, writes tests, runs with correct package manager (pnpm), creates PR
- [x] **E2EV-04**: Test failure recovery: agent reads error, diagnoses cause (wrong command, missing dependency, code bug), and fixes -- not blind retry
- [x] **E2EV-05**: Product agent adapts: clear request -> issue in 1-2 turns, vague request -> asks questions
- [x] **E2EV-06**: Smart router handles all current v2.1 event types correctly
- [x] **E2EV-07**: Context survives Temporal boundaries: agent resumes after approval wait with understanding of research and plan
- [x] **E2EV-08**: Sub-agents get focused context: coder gets plan + files (not research history), researcher gets task (not code changes)
- [x] **E2EV-09**: All tool calls queryable in `agents.execution_traces` with parent/child correlation
- [x] **E2EV-10**: Guardrails enforced: loops terminate at limits, commands sandbox-only, cost tracked
- [x] **E2EV-11**: No `@langchain/*` dependencies remain in agents package

### Future Requirements (Deferred)

- **XAGT-01**: Dev agent can ask product agent to clarify mid-task via Temporal signals
- **XAGT-02**: QA agent reviews PRs before human approval
- **MLLM-01**: Agent config supports different LLM providers (GPT-4, etc.)
- **MLLM-02**: Model selection per agent type
- **NAGT-01**: QA agent for automated code review
- **NAGT-02**: Docs agent for documentation updates
- **NAGT-03**: Reviewer agent for PR analysis
- **PRDY-01**: CI/CD pipeline for deployment
- **PRDY-02**: Monitoring and alerting for agent health
- **PRDY-03**: Multi-environment configuration (dev/staging/prod)

### Out of Scope

| Feature | Reason |
|---------|--------|
| Codebase indexing / RAG | Agents explore via read_file/search_codebase tools. No vector DB needed. |
| Web search / internet research tools | Can be added as tools later. Not needed for core workflow. |
| UI for observing agent execution | Traces stored in DB, queryable via SQL. UI is separate concern. |
| Multi-repo support | Agents work on single configured repo. Future enhancement. |
| Streaming LLM responses | Non-streaming recommended for backend agents in Temporal. No real-time UI. |
| Claude Agent SDK | Build on raw @anthropic-ai/sdk for full control over Temporal integration. |
| Parallel sub-agents | Dev workflow is sequential (research->plan->code->test). Parallel adds complexity without benefit. |

---

### Milestone Summary

**Shipped:** 78 of 78 v2.2 requirements
**Adjusted:** CTXM-05 (sub-agent context briefing implemented in-memory instead of DB-persisted per architectural decision), TRAC-02 (4 of 5 trace types -- tool_result deferred)
**Dropped:** None

---
*Archived: 2026-02-01 as part of v2.2 milestone completion*

## v2.3

_Source: `docs/history/milestones/v2.3-REQUIREMENTS.md`_


**Archived:** 2026-02-04
**Status:** SHIPPED

This is the archived requirements specification for v2.3.
For current requirements, see `.planning/REQUIREMENTS.md` (created for next milestone).

---

### v2.3 Requirements

Requirements for v2.3 milestone. Each maps to roadmap phases starting at Phase 37.

### Agent Definition

- [x] **DEF-01**: Agents defined via YAML config + prompt.md files (not hardcoded orchestrator code)
- [x] **DEF-02**: YAML schema validated with Zod on load (fail fast on invalid definitions)
- [x] **DEF-03**: System prompt loaded from separate Markdown file referenced in YAML
- [x] **DEF-04**: Agent definition includes model, tools, maxIterations, tokenBudget, history config
- [x] **DEF-05**: Agent definition includes trigger rules for event routing (which events start this agent)
- [x] **DEF-06**: Sub-agent definitions referenced by ID in parent agent config
- [x] **DEF-07**: dev-agent and product-agent converted from hardcoded code to declarative definitions
- [x] **DEF-08**: Sub-agents (researcher, coder, tester) converted to declarative definitions

### Event Log

- [x] **EVT-01**: Append-only agent_events table with conversation-scoped gapless sequences
- [x] **EVT-02**: Event types: tool.called, tool.succeeded, tool.failed, llm.response, agent.started, agent.completed, agent.paused, agent.resumed, signal.received
- [x] **EVT-03**: Buffered writes with configurable flush interval
- [x] **EVT-04**: Synchronous flush at lifecycle boundaries (pause, complete, fail)
- [x] **EVT-05**: agent_sessions projection table reactively updated from events
- [x] **EVT-06**: Session projection extracts ground-truth artifacts from tool.succeeded events
- [x] **EVT-07**: Replaces three disconnected stores: execution_traces, tasks, context_snapshots

### Conversation Executor

- [x] **EXEC-01**: ConversationExecutor with start(), signal(), get(), cancel(), list() API
- [x] **EXEC-02**: Worker loop claims queued conversations with concurrency-safe locking
- [x] **EXEC-03**: Conversation messages persisted by the executor
- [x] **EXEC-04**: Heartbeat mechanism detects running conversations
- [x] **EXEC-05**: Stale conversation detection and re-enqueue
- [x] **EXEC-06**: Concurrency invariant: exactly one agent loop per conversation
- [x] **EXEC-07**: wait_for tool that pauses conversation and registers expected signal type
- [x] **EXEC-08**: Signal queueing -- signals arriving while running are queued
- [x] **EXEC-09**: Deterministic conversation IDs from agent definition + correlation key
- [x] **EXEC-10**: Idempotent start -- duplicate start calls are no-ops
- [x] **EXEC-11**: At-least-once execution guarantee

### History Management

- [x] **HIST-01**: Phase 1 pruning: protect last N messages, replace old tool results
- [x] **HIST-02**: Phase 1 pruning: deduplication, head+tail preservation
- [x] **HIST-03**: Phase 2 structured summarization with anchored summary
- [x] **HIST-04**: Phase 2 summaries inject ground-truth artifacts from session projection
- [x] **HIST-05**: History config per agent definition
- [x] **HIST-06**: Framework-level compaction via config

### Registries

- [x] **REG-01**: AgentRegistry loads definitions from definitions/ directory
- [x] **REG-02**: mtime-based cache invalidation
- [x] **REG-03**: ToolRegistry with namespace:tool_name resolution
- [x] **REG-04**: Tool factories receive ToolContext
- [x] **REG-05**: Running conversations pinned to definition version
- [x] **REG-06**: New agent = new definition directory only

### Signal Handling

- [x] **SIG-01**: Event adapters normalize webhook payloads to IncomingEvent types
- [x] **SIG-02**: Three adapters: Slack, GitHub, Linear
- [x] **SIG-03**: EventRouter loads start rules from agent definitions
- [x] **SIG-04**: Correlation-based signal routing
- [x] **SIG-05**: Fast-path routing preserved for unambiguous events
- [x] **SIG-06**: Smart router adapted to ConversationExecutor
- [x] **SIG-07**: Signal deduplication

### Service Consolidation

- [x] **SVC-01**: Single HTTP service replacing three services
- [x] **SVC-02**: Unified /events endpoint
- [x] **SVC-03**: Management endpoints
- [x] **SVC-04**: Worker polling loop integrated
- [x] **SVC-05**: Graceful shutdown with conversation draining
- [x] **SVC-06**: Docker Compose updated

### Timeout Scheduling

- [x] **TMO-01**: Delayed signal delivery
- [x] **TMO-02**: Timeout cancellation on resume
- [x] **TMO-03**: Timeout signals via same pathway

### Migration

- [x] **MIG-01**: Feature flag routing to ConversationExecutor
- [x] **MIG-02**: Temporal drain period
- [x] **MIG-03**: Delete shared/temporal/
- [x] **MIG-04**: Remove @temporalio dependencies
- [x] **MIG-05**: Delete per-agent main.ts, worker.ts, api/
- [x] **MIG-06**: Drop old database tables
- [x] **MIG-07**: Update CLAUDE.md

### Deferred Requirements

### Future Agent Capabilities
- **FUT-01**: Agent-managed memory (MemGPT/Letta style)
- **FUT-02**: Cross-agent collaboration
- **FUT-03**: Cross-session learning
- **FUT-04**: Database-backed agent definitions with admin API

### Future Infrastructure
- **FUT-05**: Kafka/SQS/EventBridge event log backends
- **FUT-06**: OpenTelemetry integration
- **FUT-07**: Real-time streaming dashboard
- **FUT-08**: LISTEN/NOTIFY for event-driven worker wakeup

### Out of Scope

| Feature | Reason |
|---------|--------|
| Full event sourcing library | Append-only store with ~200 lines is sufficient |
| UI for agent definition management | Code/config first philosophy |
| Streaming LLM responses | Non-streaming appropriate for backend agents |
| Parallel sub-agents | Sequential execution sufficient |

### Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| EVT-01 | Phase 37 | Complete |
| EVT-02 | Phase 37 | Complete |
| EVT-03 | Phase 37 | Complete |
| EVT-04 | Phase 37 | Complete |
| EVT-05 | Phase 37 | Complete |
| EVT-06 | Phase 37 | Complete |
| EVT-07 | Phase 47 | Complete |
| DEF-01 | Phase 38 | Complete |
| DEF-02 | Phase 38 | Complete |
| DEF-03 | Phase 38 | Complete |
| DEF-04 | Phase 38 | Complete |
| DEF-05 | Phase 38 | Complete |
| DEF-06 | Phase 38 | Complete |
| DEF-07 | Phase 38 | Complete |
| DEF-08 | Phase 38 | Complete |
| REG-01 | Phase 38 | Complete |
| REG-02 | Phase 38 | Complete |
| REG-03 | Phase 38 | Complete |
| REG-04 | Phase 38 | Complete |
| REG-05 | Phase 38 | Complete |
| REG-06 | Phase 38 | Complete |
| HIST-01 | Phase 39 | Complete |
| HIST-02 | Phase 39 | Complete |
| HIST-03 | Phase 39 | Complete |
| HIST-04 | Phase 39 | Complete |
| HIST-05 | Phase 39 | Complete |
| HIST-06 | Phase 39 | Complete |
| EXEC-01 | Phase 40 | Complete |
| EXEC-02 | Phase 40 | Complete |
| EXEC-03 | Phase 40 | Complete |
| EXEC-04 | Phase 40 | Complete |
| EXEC-05 | Phase 40 | Complete |
| EXEC-06 | Phase 40 | Complete |
| EXEC-07 | Phase 40 | Complete |
| EXEC-08 | Phase 40 | Complete |
| EXEC-09 | Phase 40 | Complete |
| EXEC-10 | Phase 40 | Complete |
| EXEC-11 | Phase 40 | Complete |
| TMO-01 | Phase 41 | Complete |
| TMO-02 | Phase 41 | Complete |
| TMO-03 | Phase 41 | Complete |
| SIG-01 | Phase 42 | Complete |
| SIG-02 | Phase 42 | Complete |
| SIG-03 | Phase 42 | Complete |
| SIG-04 | Phase 42 | Complete |
| SIG-05 | Phase 43 | Complete |
| SIG-06 | Phase 43 | Complete |
| SIG-07 | Phase 40 | Complete |
| SVC-01 | Phase 44 | Complete |
| SVC-02 | Phase 44 | Complete |
| SVC-03 | Phase 44 | Complete |
| SVC-04 | Phase 44 | Complete |
| SVC-05 | Phase 44 | Complete |
| SVC-06 | Phase 47 | Complete |
| MIG-01 | Phase 46 | Complete |
| MIG-02 | Phase 46 | Complete |
| MIG-03 | Phase 47 | Complete |
| MIG-04 | Phase 47 | Complete |
| MIG-05 | Phase 47 | Complete |
| MIG-06 | Phase 47 | Complete |
| MIG-07 | Phase 47 | Complete |

**Coverage:**
- v2.3 requirements: 58 total
- Satisfied: 58
- Unsatisfied: 0

---

### Milestone Summary

**Shipped:** 58 of 58 v2.3 requirements
**Adjusted:** None -- all requirements delivered as specified
**Dropped:** None

---
*Archived: 2026-02-04 as part of v2.3 milestone completion*

## v2.4

_Source: `docs/history/milestones/v2.4-REQUIREMENTS.md`_


**Archived:** 2026-02-05
**Status:** SHIPPED

This is the archived requirements specification for v2.4.
For current requirements, see `.planning/REQUIREMENTS.md` (created for next milestone).

---

### v2.4 Requirements

### Dashboard Infrastructure

- [x] **INFRA-01**: `packages/dashboard/` exists as a pnpm workspace package (`@aesir/dashboard`)
- [x] **INFRA-02**: Next.js 15 App Router with Tailwind CSS and shadcn/ui configured
- [x] **INFRA-03**: Drizzle ORM connected to existing Postgres (read-only, shared schema imports)
- [x] **INFRA-04**: Service layer (`src/services/`) abstracts all database queries
- [x] **INFRA-05**: Auth-ready middleware.ts in place (passthrough)
- [x] **INFRA-06**: Dockerfile builds and runs in Docker Compose on port 3005
- [x] **INFRA-07**: Nginx routes `/dashboard/*` to the dashboard service
- [x] **INFRA-08**: Health check endpoint (`/api/health`) returns 200
- [x] **INFRA-09**: `pnpm run typecheck` passes for the dashboard package
- [x] **INFRA-10**: `pnpm run lint` passes for the dashboard package

### Conversations View

- [x] **CONV-01**: Conversations list page shows all conversations with status, agent, duration, token usage, last activity
- [x] **CONV-02**: Filters work: status, agent type, time range, has errors
- [x] **CONV-03**: Conversation detail page shows event timeline with all event types rendered appropriately
- [x] **CONV-04**: Tool call events show input parameters (expandable) and results (expandable)
- [x] **CONV-05**: Failed tool calls are visually distinct (red/error styling)
- [x] **CONV-06**: LLM response events show token counts and latency
- [x] **CONV-07**: Sub-agent events render as nested/indented sections in the parent timeline
- [x] **CONV-08**: Conversation messages panel shows the LLM message history as a chat view
- [x] **CONV-09**: Conversation metadata sidebar shows all relevant fields including artifacts and parent/child links
- [x] **CONV-10**: Clicking a child conversation navigates to its detail page

### Agent Definitions View

- [x] **AGNT-01**: Agent list page shows all loaded agent definitions with key metadata
- [x] **AGNT-02**: Agent detail page shows full configuration: model, tools, sub-agents, triggers, history settings
- [x] **AGNT-03**: System prompt content is rendered with Markdown formatting
- [x] **AGNT-04**: Tools list on agent detail links to the tool dashboard
- [x] **AGNT-05**: Sub-agent references link to the sub-agent's detail page
- [x] **AGNT-06**: Recent conversations for the agent are shown with links

### Tool Dashboard

- [x] **TOOL-01**: Tool registry view shows all registered tools organized by namespace
- [x] **TOOL-02**: Each tool shows description, which agents use it, and performance metrics
- [x] **TOOL-03**: Permission matrix shows agent-to-tool access from both definition and MCP perspectives
- [x] **TOOL-04**: Permission mismatches (definition references tool but MCP doesn't allow) are highlighted
- [x] **TOOL-05**: Tool performance section shows call volume, failure rate, and latency metrics
- [x] **TOOL-06**: Recent failures list shows tool.failed events with error payloads
- [x] **TOOL-07**: Integration health section shows status of Linear, GitHub, Slack MCP endpoints

### System Overview

- [x] **OVER-01**: Landing page shows conversation status summary (counts by status)
- [x] **OVER-02**: Active conversations list with real-time updates
- [x] **OVER-03**: Worker status displays current claims, capacity, poll interval
- [x] **OVER-04**: Recent errors section shows last 10 failures with links
- [x] **OVER-05**: Token usage shows aggregate consumption by agent type

### Real-Time Updates

- [x] **SSE-01**: Agent-service SSE endpoint (`GET /api/sse/events`) streams events
- [x] **SSE-02**: SSE supports filtering by conversationId and event types
- [x] **SSE-03**: Dashboard SSE client hook connects, parses, and updates component state
- [x] **SSE-04**: Conversations list auto-updates when conversation status changes
- [x] **SSE-05**: Conversation detail timeline appends new events in real-time
- [x] **SSE-06**: SSE client handles reconnection with backoff
- [x] **SSE-07**: SSE connection cleans up on component unmount

### Agent Service API

- [x] **API-01**: `GET /api/tools/registry` returns all registered tools with metadata
- [x] **API-02**: `GET /api/tools/health` returns integration endpoint status (cached 30s)
- [x] **API-03**: `GET /api/agents/registry` returns all agent definitions (without full prompts)
- [x] **API-04**: `GET /api/agents/registry/:id` returns full agent definition including prompt
- [x] **API-05**: `GET /api/worker/status` returns worker loop state
- [x] **API-06**: `GET /api/sse/events` streams real-time events via SSE
- [x] **API-07**: All new endpoints use `/api/` prefix, separate from operational endpoints

### Future Requirements (not in v2.4 scope)

### Dashboard Editing
- **EDIT-01**: Agent definition editing via dashboard UI
- **EDIT-02**: Tool permission management UI
- **EDIT-03**: Conversation actions from dashboard (cancel, retry, signal)

### Analytics & Monitoring
- **ANLY-01**: Historical time-series charts and trend analysis
- **ANLY-02**: Alerting and notifications for agent failures
- **ANLY-03**: Log viewer integrating pino logs with agent events

### Multi-User
- **AUTH-01**: Authentication via Auth.js
- **AUTH-02**: Multi-tenancy with workspace-scoped data access
- **AUTH-03**: Role-based permissions for dashboard features

### Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| API-01 through API-07 | Phase 48 | Complete |
| SSE-01, SSE-02 | Phase 48 | Complete |
| INFRA-01 through INFRA-10 | Phase 49 | Complete |
| CONV-01, CONV-02 | Phase 50 | Complete |
| CONV-03 through CONV-10 | Phase 51 | Complete |
| AGNT-01 through AGNT-06 | Phase 52 | Complete |
| TOOL-01 through TOOL-07 | Phase 53 | Complete |
| OVER-01 through OVER-05 | Phase 54 | Complete |
| SSE-03 through SSE-07 | Phase 55 | Complete |

**Coverage:**
- v2.4 requirements: 52 total
- Satisfied: 52
- Adjusted: 0
- Dropped: 0

---

### Milestone Summary

**Shipped:** 52 of 52 v2.4 requirements
**Adjusted:** None -- all requirements shipped as originally specified
**Dropped:** None

---
*Archived: 2026-02-05 as part of v2.4 milestone completion*

## v2.5

_Source: `docs/history/milestones/v2.5-REQUIREMENTS.md`_


**Archived:** 2026-02-08
**Status:** SHIPPED

This is the archived requirements specification for v2.5.
For current requirements, see `.planning/REQUIREMENTS.md` (created for next milestone).

---

### v2.5 Requirements

### Prompt Rewrites

- [x] **PROMPT-01**: Rewrite product-agent prompt to goal-oriented style (identity, constitutional constraints, few-shot examples, PROMPT_GUIDE.md structure)
- [x] **PROMPT-02**: Rewrite dev-agent prompt to goal-oriented style (identity, constitutional constraints, few-shot examples, PROMPT_GUIDE.md structure)
- [x] **PROMPT-03**: Traceability matrix created per agent (old if/then rule -> failure it prevented -> new constraint or example that covers it)
- [x] **PROMPT-04**: Orchestrator prompts include selective chain-of-thought (`<reasoning>` blocks before significant decisions)
- [x] **PROMPT-05**: Constraint priority ordering documented per agent (safety > correctness > efficiency)
- [x] **PROMPT-06**: One few-shot example per agent demonstrates resolving a constraint tension

### Conversation Reopening

- [x] **REOPEN-01**: Executor handles `reopen` signal on conversations in `completed` status
- [x] **REOPEN-02**: Executor handles `reopen` signal on conversations in `failed` status
- [x] **REOPEN-03**: Reopen signal transitions conversation back to `queued` with signal payload available
- [x] **REOPEN-04**: Reopened conversation receives full prior history plus signal context
- [x] **REOPEN-05**: World-state `<world_state>` context block injected when conversation is reopened (signal payload describes what changed)
- [x] **REOPEN-06**: Constitutional constraint added to reopened prompts: verify current state of artifacts before acting
- [x] **REOPEN-07**: Dashboard reopen/retry action available on conversation detail view
- [x] **REOPEN-08**: Agent service exposes POST /conversations/:id/reopen endpoint
- [x] **REOPEN-09**: `agent.reopened` event type added to event log
- [x] **REOPEN-10**: Other signal types on terminal conversations still ignored (only `reopen` triggers transition)
- [x] **REOPEN-11**: `delivered_signal_ids` capped at 100 entries to prevent unbounded growth

### Task Primitive

- [x] **TASK-01**: `agents.tasks` table created with id, parent_id, creator_type/id, assignee_type/id, status, title, objective, metadata, timestamps
- [x] **TASK-02**: `agents.task_handoffs` table created with id, task_id, conversation_id, handoff_type, context (JSONB), author_type/id, created_at
- [x] **TASK-03**: `task_id` nullable FK column added to `agents.conversations`
- [x] **TASK-04**: Task IDs use existing `createId` pattern (`task_<nanoid>`)
- [x] **TASK-05**: Handoff IDs use `createId` pattern (`ho_<nanoid>`)
- [x] **TASK-06**: Task status transitions enforced via tools (complete_task rejects cancelled tasks, etc.) with CHECK constraint for valid values
- [x] **TASK-07**: Handoff context enforced via Zod: `{ summary: string (required, max 2000 chars), key_decisions?, artifacts?, open_questions?, next_steps? }`, capped at ~4KB
- [x] **TASK-08**: `tasks.metadata` validated with Zod on write, 10KB size limit enforced at application layer
- [x] **TASK-09**: `create_task` agent tool implemented (with optional parent_id for subtasks)
- [x] **TASK-10**: `complete_task` agent tool implemented (marks task completed with structured completion handoff)
- [x] **TASK-11**: `pause_task` agent tool implemented (pauses task with structured pause handoff)
- [x] **TASK-12**: `handoff_task` agent tool implemented (writes delegation or escalation handoff)
- [x] **TASK-13**: `list_tasks` agent tool implemented (query by assignee, status, or metadata)
- [x] **TASK-14**: `get_task_context` agent tool implemented (retrieve handoffs and conversation history for a task)
- [x] **TASK-15**: 6 task tools registered in ToolRegistry under `task:` namespace
- [x] **TASK-16**: Task tools added to agent definition YAML files
- [x] **TASK-17**: Parent-child task hierarchy supported (parent_id FK)
- [x] **TASK-18**: Circular delegation prevented: `create_task` checks ancestry for same-assignee cycles
- [x] **TASK-19**: Max depth of 5 levels for parent_id chains enforced
- [x] **TASK-20**: Max 10 subtasks per parent task enforced
- [x] **TASK-21**: `ToolContext.taskId` renamed to `sandboxId` (existing sandbox container ID usage)
- [x] **TASK-22**: New `ToolContext.taskId` set from `conv.task_id` in worker loop
- [x] **TASK-23**: Task context auto-injected as `<task_context>` block in worker loop (most recent handoff, truncated at 4000 chars with pointer to `get_task_context`)
- [x] **TASK-24**: TaskService factory created with CRUD operations and validation
- [x] **TASK-25**: Backward compatibility: all code paths handle null task_id gracefully
- [x] **TASK-27**: Schema migration handles legacy `tasks` table in schema.drizzle.ts (check if empty, drop or rename)

### Integration Correlation

- [x] **CORR-01**: `linear.task_correlations` table created (external_type, external_ref, task_id, PK on type+ref)
- [x] **CORR-02**: `github.task_correlations` table created (external_type, external_ref, task_id, PK on type+ref)
- [x] **CORR-03**: `slack.task_correlations` table created (external_type, external_ref, task_id, PK on type+ref)
- [x] **CORR-04**: `X-Task-ID` header added to MCP calls when conversation has a task
- [x] **CORR-05**: Linear integration records correlation on outgoing MCP tool calls (fire-and-forget)
- [x] **CORR-06**: GitHub integration records correlation on outgoing MCP tool calls (fire-and-forget)
- [x] **CORR-07**: Slack integration records correlation on outgoing MCP tool calls (thread_ts as external_ref)
- [x] **CORR-08**: Linear integration performs correlation lookup on incoming webhooks, attaches task_id to event
- [x] **CORR-09**: GitHub integration performs correlation lookup on incoming webhooks, attaches task_id to event
- [x] **CORR-10**: Slack integration performs correlation lookup on incoming webhooks, attaches task_id to event
- [x] **CORR-11**: `IncomingEvent` schema extended with optional `taskId` field

### Event Routing

- [x] **ROUTE-01**: Task-based routing priority: task reference -> fast-path start -> reasoning path
- [x] **ROUTE-02**: When task has active/waiting conversation: deliver event as signal (serialized)
- [x] **ROUTE-03**: When task has no active conversation: create new conversation in task with most recent handoff as context
- [x] **ROUTE-04**: Task-scoped conversations use correlationKey including task ID + triggering event ID
- [x] **ROUTE-05**: Task-level event serialization via PostgreSQL advisory locks (`pg_advisory_xact_lock`)
- [x] **ROUTE-06**: Backward compatibility: events without task reference route through existing fast-path/slow-path unchanged

### Prompt Evolution

- [x] **EVOL-01**: Product-agent prompt updated to leverage task lifecycle (create tasks for meaningful work)
- [x] **EVOL-02**: Dev-agent prompt updated to leverage task lifecycle (create tasks, write handoffs)
- [x] **EVOL-03**: All agent prompts include handoff examples in few-shot sections (good vs bad handoff content)
- [x] **EVOL-04**: Agents guided to delegate subtasks to other agents via `create_task`
- [x] **EVOL-05**: Agents guided to query related tasks via `list_tasks` and incorporate context
- [x] **EVOL-06**: Prompt guidance: create a task when starting meaningful work, skip for quick single-turn interactions
- [x] **EVOL-07**: Prompt guidance: call `get_task_context` when latest handoff references prior work
- [x] **EVOL-08**: Prompts degrade gracefully when no task is available ("operate as before")

### Deferred Requirements

- **TASK-26**: Stale task cleanup: scheduled job flags inactive tasks via timeout signal. *Deferred: tasks won't go stale until system has been running for weeks. Operational polish, not core capability.*

### Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| PROMPT-01 | Phase 56 | Complete |
| PROMPT-02 | Phase 56 | Complete |
| PROMPT-03 | Phase 56 | Complete |
| PROMPT-04 | Phase 56 | Complete |
| PROMPT-05 | Phase 56 | Complete |
| PROMPT-06 | Phase 56 | Complete |
| REOPEN-01 | Phase 57 | Complete |
| REOPEN-02 | Phase 57 | Complete |
| REOPEN-03 | Phase 57 | Complete |
| REOPEN-04 | Phase 57 | Complete |
| REOPEN-05 | Phase 57 | Complete |
| REOPEN-06 | Phase 57 | Complete |
| REOPEN-07 | Phase 57 | Complete |
| REOPEN-08 | Phase 57 | Complete |
| REOPEN-09 | Phase 57 | Complete |
| REOPEN-10 | Phase 57 | Complete |
| REOPEN-11 | Phase 57 | Complete |
| TASK-01 | Phase 58.1 | Complete |
| TASK-02 | Phase 58.1 | Complete |
| TASK-03 | Phase 58.1 | Complete |
| TASK-04 | Phase 58.1 | Complete |
| TASK-05 | Phase 58.1 | Complete |
| TASK-06 | Phase 58.1 | Complete |
| TASK-07 | Phase 58.1 | Complete |
| TASK-08 | Phase 58.1 | Complete |
| TASK-09 | Phase 58.2 | Complete |
| TASK-10 | Phase 58.2 | Complete |
| TASK-11 | Phase 58.2 | Complete |
| TASK-12 | Phase 58.2 | Complete |
| TASK-13 | Phase 58.2 | Complete |
| TASK-14 | Phase 58.2 | Complete |
| TASK-15 | Phase 58.2 | Complete |
| TASK-16 | Phase 58.2 | Complete |
| TASK-17 | Phase 58.2 | Complete |
| TASK-18 | Phase 59 | Complete |
| TASK-19 | Phase 59 | Complete |
| TASK-20 | Phase 59 | Complete |
| TASK-21 | Phase 58.1 | Complete |
| TASK-22 | Phase 58.1 | Complete |
| TASK-23 | Phase 58.2 | Complete |
| TASK-24 | Phase 58.1 | Complete |
| TASK-25 | Phase 58.1 | Complete |
| TASK-27 | Phase 58.1 | Complete |
| CORR-01 | Phase 58.3 | Complete |
| CORR-02 | Phase 58.3 | Complete |
| CORR-03 | Phase 58.3 | Complete |
| CORR-04 | Phase 58.3 | Complete |
| CORR-05 | Phase 58.3 | Complete |
| CORR-06 | Phase 58.3 | Complete |
| CORR-07 | Phase 58.3 | Complete |
| CORR-08 | Phase 58.3 | Complete |
| CORR-09 | Phase 58.3 | Complete |
| CORR-10 | Phase 58.3 | Complete |
| CORR-11 | Phase 58.3 | Complete |
| ROUTE-01 | Phase 58.4 | Complete |
| ROUTE-02 | Phase 58.4 | Complete |
| ROUTE-03 | Phase 58.4 | Complete |
| ROUTE-04 | Phase 58.4 | Complete |
| ROUTE-05 | Phase 58.4 | Complete |
| ROUTE-06 | Phase 58.4 | Complete |
| EVOL-01 | Phase 59 | Complete |
| EVOL-02 | Phase 59 | Complete |
| EVOL-03 | Phase 59 | Complete |
| EVOL-04 | Phase 59 | Complete |
| EVOL-05 | Phase 59 | Complete |
| EVOL-06 | Phase 59 | Complete |
| EVOL-07 | Phase 59 | Complete |
| EVOL-08 | Phase 59 | Complete |

**Coverage:**
- v2.5 active requirements: 68 total
- Mapped to phases: 68
- Unmapped: 0
- Deferred: 1 (TASK-26)

---

### Milestone Summary

**Shipped:** 68 of 68 v2.5 requirements
**Adjusted:** None
**Dropped:** None
**Deferred:** TASK-26 (Stale task cleanup -- operational polish, deferred to post-v2.5)

---
*Archived: 2026-02-08 as part of v2.5 milestone completion*

## v2.6

_Source: `docs/history/milestones/v2.6-REQUIREMENTS.md`_


**Archived:** 2026-02-09
**Status:** SHIPPED

For current requirements, see `.planning/REQUIREMENTS.md`.

---

# Requirements: Aesir v2.6 Unified Agent Communication

**Defined:** 2026-02-08
**Core Value:** End-to-end automated development workflow where agents handle routine development tasks while humans focus on high-value decisions and reviews.

### v2.6 Requirements

Requirements for symmetric outbound normalization. Each maps to roadmap phases.

### Types & Foundation

- [ ] **TYPE-01**: ReplyContext Zod discriminated union defined with slack/linear/github channel variants
- [x] **TYPE-02**: ~~NotifyTarget Zod schema~~ — Dropped per discuss-phase decision: ReplyContext unifies both reply and notify addressing (Slack threadTs optional = post to channel)
- [ ] **TYPE-03**: MessageContent type defined with text and options fields (semantic hint dropped per discuss-phase decision)
- [ ] **TYPE-04**: Conversation row extended with reply_context JSONB column (nullable, no default). Executor wiring to populate it deferred to Phase 61
- [x] **TYPE-05**: ~~Communication tools accept explicit replyContext parameter~~ — Moved to Phase 64 (COMM-01..COMM-05 cover this)
- [x] **TYPE-06**: ~~Agent definitions support defaultNotifyTarget~~ — Moved to Phase 65 (MIGR-01..MIGR-06 cover this)

### MCP Prerequisites

- [ ] **MCP-01**: linear:create_comment registered in MCP server tool list and agent-side linear-tools.ts
- [ ] **MCP-02**: github:create_pr_comment MCP tool implemented using Octokit issues.createComment
- [ ] **MCP-03**: MCP permissions seeded for both new tools (dev-agent and product-agent access)

### Inbound Pipeline

- [ ] **INBD-01**: IncomingEventSchema extended with optional replyContext field
- [ ] **INBD-02**: SignalSchema extended with optional replyContext field
- [ ] **INBD-03**: Slack adapter attaches replyContext (teamId, channelId, threadTs) to IncomingEvent
- [ ] **INBD-04**: Linear adapter attaches replyContext (issueId) to IncomingEvent
- [ ] **INBD-05**: GitHub adapter attaches replyContext (owner, repo, prNumber) to IncomingEvent
- [ ] **INBD-06**: Signal delivery in ConversationExecutor stores replyContext on conversation row
- [ ] **INBD-07**: Signal delivery includes replyContext in user message via structured tag

### Outbound Denormalizer

- [ ] **OUTB-01**: Denormalizer dispatches to Slack MCP tools based on replyContext.channel
- [ ] **OUTB-02**: Denormalizer dispatches to Linear MCP tools based on replyContext.channel
- [ ] **OUTB-03**: Denormalizer dispatches to GitHub MCP tools based on replyContext.channel
- [ ] **OUTB-04**: Slack denormalizer uses send_approval_request for ask() with options (interactive buttons)
- [ ] **OUTB-05**: Slack denormalizer uses reply_to_thread for reply() and ask() without options
- [ ] **OUTB-06**: Linear denormalizer renders ask() options as text instructions in comment body
- [ ] **OUTB-07**: GitHub denormalizer renders ask() options as text instructions in PR comment body
- [ ] **OUTB-08**: Denormalizer returns clear error with guidance when replyContext is invalid or malformed
- [ ] **OUTB-09**: communication:reply and communication:ask require replyContext in their Zod schemas (validation error if missing). No fallback chain — agents without replyContext use communication:notify with an explicit target instead.

### Communication Tools

- [ ] **COMM-01**: communication:reply tool responds on originating channel via replyContext pass-through
- [ ] **COMM-02**: communication:ask tool requests input with structured options, channel-adaptive rendering
- [ ] **COMM-03**: communication:notify tool sends broadcast to explicit target channel
- [ ] **COMM-04**: communicationAdapter function extracts CommunicationToolDeps from ToolContext
- [ ] **COMM-05**: All three tools registered in tool-factories.ts under communication namespace

### Router Updates

- [ ] **ROUT-01**: signal_conversation tool accepts optional replyContext field in input schema
- [ ] **ROUT-02**: Router propagates replyContext from IncomingEvent through signal_conversation calls
- [ ] **ROUT-03**: Router system prompt includes guidance for Linear comment routing (query status, reopen if completed)
- [ ] **ROUT-04**: Router system prompt includes guidance for replyContext forwarding in all signal paths

### Agent Migration

- [ ] **MIGR-01**: dev-agent definition.yaml replaces slack:send_message and slack:send_approval_request with communication:reply, communication:ask, communication:notify
- [ ] **MIGR-02**: product-agent definition.yaml replaces slack:send_message with communication:reply, communication:ask, communication:notify
- [ ] **MIGR-03**: dev-agent prompt.md rewritten for domain-language communication following PROMPT_GUIDE.md
- [ ] **MIGR-04**: product-agent prompt.md rewritten for domain-language communication following PROMPT_GUIDE.md
- [ ] **MIGR-05**: Prompt changes use constitutional constraints and few-shot examples (no procedural tool sequences)
- [ ] **MIGR-06**: Prompt changes explain replyContext pass-through as opaque context, not channel-specific instructions
- [ ] **MIGR-07**: Agent echo filtering prevents agent-authored Linear comments from re-entering the inbound pipeline as new events (prerequisite for agents using communication:reply on Linear)

### Testing & Validation

- [x] **TEST-01**: Denormalizer unit tests verify correct MCP tool called per channel and action type
- [x] **TEST-02**: ReplyContext propagation test verifies signal carries replyContext from adapter through executor
- [x] **TEST-03**: Communication tool tests verify input validation and denormalizer delegation
- [x] **TEST-04**: ask() option rendering test verifies text-formatted options consistently across all channels (no interactive buttons)

### Future Requirements

Deferred to post-v2.6. Tracked but not in current roadmap.

### Format Translation

- **FMT-01**: Markdown-to-Slack-mrkdwn translation in Slack denormalizer path
- **FMT-02**: Semantic message formatting per channel (emoji on Slack, clean text on Linear)

### Convenience Features

- **CONV-01**: Multi-channel replyAll convenience tool
- **CONV-02**: Conversation-level default notify target from metadata
- **CONV-03**: Workspace-level default notification channel configuration

### Out of Scope

| Feature | Reason |
|---------|--------|
| Agent-visible channel awareness (A1) | Agents should NOT know which channel they're on -- defeats the abstraction |
| Block Kit construction by LLM (A2) | Complex, fragile, token-expensive -- denormalizer constructs from semantic intent |
| Channel preference selection by agents (A3) | Recreates hardcoded Slack problem at higher abstraction level |
| Real-time channel-switching (A4) | Omnichannel problem; each signal carries its own replyContext naturally |
| Universal rich content format (A5) | Consumer chat territory; text + options sufficient for developer workflow |
| Removing integration-specific tools (A6) | Data access tools (get_issue, create_branch) are not communication |
| Bidirectional format conversion (A7) | One-directional translation (outbound only) is sufficient |

### Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| TYPE-01 | Phase 60 | Pending |
| TYPE-02 | Phase 60 | Dropped (ReplyContext unifies both) |
| TYPE-03 | Phase 60 | Pending |
| TYPE-04 | Phase 60 | Pending |
| TYPE-05 | Phase 64 | Moved (covered by COMM-01..05) |
| TYPE-06 | Phase 65 | Moved (covered by MIGR-01..06) |
| MCP-01 | Phase 60 | Pending |
| MCP-02 | Phase 60 | Pending |
| MCP-03 | Phase 60 | Pending |
| INBD-01 | Phase 61 | Pending |
| INBD-02 | Phase 61 | Pending |
| INBD-03 | Phase 61 | Pending |
| INBD-04 | Phase 61 | Pending |
| INBD-05 | Phase 61 | Pending |
| INBD-06 | Phase 61 | Pending |
| INBD-07 | Phase 61 | Pending |
| ROUT-01 | Phase 62 | Pending |
| ROUT-02 | Phase 62 | Pending |
| ROUT-03 | Phase 62 | Pending |
| ROUT-04 | Phase 62 | Pending |
| OUTB-01 | Phase 63 | Pending |
| OUTB-02 | Phase 63 | Pending |
| OUTB-03 | Phase 63 | Pending |
| OUTB-04 | Phase 63 | Pending |
| OUTB-05 | Phase 63 | Pending |
| OUTB-06 | Phase 63 | Pending |
| OUTB-07 | Phase 63 | Pending |
| OUTB-08 | Phase 63 | Pending |
| OUTB-09 | Phase 63 | Pending |
| COMM-01 | Phase 64 | Pending |
| COMM-02 | Phase 64 | Pending |
| COMM-03 | Phase 64 | Pending |
| COMM-04 | Phase 64 | Pending |
| COMM-05 | Phase 64 | Pending |
| MIGR-01 | Phase 65 | Pending |
| MIGR-02 | Phase 65 | Pending |
| MIGR-03 | Phase 65 | Pending |
| MIGR-04 | Phase 65 | Pending |
| MIGR-05 | Phase 65 | Pending |
| MIGR-06 | Phase 65 | Pending |
| MIGR-07 | Phase 65 | Pending |
| TEST-01 | Phase 66 | Complete |
| TEST-02 | Phase 66 | Complete |
| TEST-03 | Phase 66 | Complete |
| TEST-04 | Phase 66 | Complete |

**Coverage:**
- v2.6 requirements: 45 total (1 dropped, 2 moved to later phases)
- Mapped to phases: 45
- Unmapped: 0

---
*Requirements defined: 2026-02-08*
*Last updated: 2026-02-08 -- synced with Phase 60 discuss-phase decisions (TYPE-02 dropped, TYPE-05/06 moved)*

## v2.7

_Source: `docs/history/milestones/v2.7-REQUIREMENTS.md`_


**Archived:** 2026-02-13
**Status:** SHIPPED

For current requirements, see `.planning/REQUIREMENTS.md`.

---

# Requirements: Aesir v2.7 Agent Collaboration

**Defined:** 2026-02-10
**Core Value:** End-to-end automated development workflow where agents handle routine development tasks while humans focus on high-value decisions and reviews.

### v2.7 Requirements

Requirements for v2.7 Agent Collaboration milestone. Each maps to roadmap phases.

### Linear Agent SDK

- [ ] **LSDK-01**: Agent authenticates with Linear using `actor=app` OAuth identity with `app:assignable` and `app:mentionable` scopes (own workspace entity, not impersonating user)
- [ ] **LSDK-02**: Token refresh middleware proactively refreshes Linear OAuth tokens before expiry (80% lifetime threshold) and retries on 401
- [ ] **LSDK-03**: Agent communication is delivered to Linear as typed activities (thought, elicitation, action, response, error) via `createAgentActivity`
- [ ] **LSDK-04**: Agent session ID (`agentSessionId`) flows from webhook through adapter, conversation, replyContext, and denormalizer
- [ ] **LSDK-05**: Communication tool intents map to Linear activity types (reply->response, ask->elicitation, reasoning->thought)
- [ ] **LSDK-06**: `agent_session.prompted` webhook event replaces `comment.created` for active Linear agent sessions
- [ ] **LSDK-07**: Echo filtering by `LINEAR_BOT_USER_ID` is removed (agent activities and user prompts are structurally distinct)
- [ ] **LSDK-08**: Agent Plans display checklist-style progress in Linear UI, mapped from task steps
- [ ] **LSDK-09**: Webhook handler emits `thought` activity synchronously within 10 seconds of session creation (before conversation is queued)

### Shared Memory

- [x] **MEM-01**: Agents can store knowledge entries via `knowledge:store` tool with classification (discovery, constraint, architecture_decision, thought, preference, test_result)
- [x] **MEM-02**: Agents can query shared knowledge via `knowledge:query` tool with semantic search (pgvector) and type/scope filtering
- [x] **MEM-03**: Agents can update existing knowledge entries via `knowledge:update` tool (supersede, invalidate). Extend deferred — agents should supersede with complete replacement rather than accumulate appended content.
- [x] **MEM-04**: Knowledge entries have mandatory expiry by category (discoveries 24h, architecture_decisions 7d, constraints 30d, thoughts 24h, preferences 30d, test_results 7d)
- [x] **MEM-05**: Private agent notepad stores per-agent knowledge with `scope=private` (not visible to other agents)
- [x] **MEM-06**: Shared knowledge defaults are sensible without configuration: shared (discovery, constraint, architecture_decision, preference, test_result) and private (thought). YAML-based scope overrides deferred — hardcoded defaults sufficient for v1.
- [x] **MEM-07**: Knowledge deduplication: before storing, query existing entries on same topic and supersede rather than duplicate
- [x] **MEM-08**: Knowledge store gracefully degrades: `knowledge:query` returns empty results on connection failure, never crashes agent loop

### Entity Directory

- [ ] **DIR-01**: Entity directory table stores agents with type, capabilities, status, and metadata (schema supports `type='human'` for future)
- [ ] **DIR-02**: Agents are seeded from YAML definitions at deploy time, extracting capabilities from a new `capabilities` field in `definition.yaml`
- [ ] **DIR-03**: `directory:find` tool queries entities by capability using semantic matching (pgvector embeddings, reusing Phase 68 embedding pipeline)
- [ ] **DIR-04**: `directory:get` tool retrieves full entity details by ID
- [ ] **DIR-05**: Seed script is idempotent (`ON CONFLICT DO UPDATE`) with `last_seeded_at` timestamp. Agents removed from YAML are marked `status='inactive'` (scoped to `type='agent'` only)
- [ ] **DIR-06**: Directory gracefully degrades: `directory:find` returns empty results on failure, agents fall back to self-execution

### Task Delegation

- [ ] **DEL-01**: `task:delegate` tool creates a task targeting a directory entity and starts a conversation for the target agent via `executor.start()`
- [ ] **DEL-02**: Delegated tasks carry focused brief (task description, expectations, relevant knowledge references) not full message history
- [ ] **DEL-03**: Negotiation handshake: target agent receives delegation, evaluates, and responds accept (with optional estimate) or reject (with reason) via `task:respond` tool
- [ ] **DEL-04**: Handshake has its own timeout (30s default, configurable) separate from task timeout; timeout treated as rejection
- [ ] **DEL-05**: Materialization abstraction layer exists as extensible interface, but v1 implementation is agent-only (single path: `executor.start()`)
- [ ] **DEL-06**: Delegation judgment guidance in agent prompts distinguishes sub-agent spawn (within conversation) from cross-conversation delegation (different agent capabilities)
- [ ] **DEL-07**: Maximum task delegation depth reduced to 3 for v1 (orchestrator -> orchestrator -> sub-agent is natural maximum)

### Completion Signaling

- [ ] **SIG-01**: TaskSignalDispatcher fires signal to callback conversation when delegated task reaches terminal state (completed or failed)
- [ ] **SIG-02**: `wait_for` accepts multiple signal types (`pending_wait.types` array); signal matching checks membership in array
- [ ] **SIG-03**: `wait_for_task` variant auto-registers for all task-lifecycle signal types (completion, failure, timeout) so agents cannot forget
- [ ] **SIG-04**: Orphan-aware signal handling: when callback conversation is terminal, store completion result on task (`completion_result` JSONB) and log `signal.orphaned` event
- [ ] **SIG-05**: Callback routing resolves through tasks (latest active conversation for parent task) not static conversation IDs (survives re-trigger)
- [ ] **SIG-06**: Expectation-based timeout: handshake estimate feeds pg-boss delayed signal for task timeout
- [ ] **SIG-07**: Delegation context preserved: `active_delegations` JSONB column on conversations survives history compaction; self-contained signal payloads include original task description and results

### Delegation Graph Observability

- [ ] **OBS-01**: Task tree API endpoint returns hierarchical task structure with status, entity assignments, and timestamps (recursive CTE with depth limit)
- [ ] **OBS-02**: Dashboard task tree view renders delegation graph with expandable nodes, status indicators, and lazy loading for deep trees
- [ ] **OBS-03**: Delegation timeline shows chronological event list (delegation, handshake, signals) filterable by task tree
- [ ] **OBS-04**: Cross-conversation trace view enables click-through from task node to conversation detail page
- [ ] **OBS-05**: Signal flow visualization shows edges between conversations with delivery timestamps and payloads
- [ ] **OBS-06**: Health indicators detect and surface orphaned completions, excessive delegation depth, rejection chains, and timeout patterns

### QA Agent + Validation Workflow

- [ ] **QA-01**: QA agent defined as YAML + prompt.md with capabilities registered in entity directory
- [ ] **QA-02**: QA agent has thin tool wrappers for running tests (sandbox) and reviewing PR diffs (GitHub MCP)
- [ ] **QA-03**: QA agent uses collaboration tools (directory:find, knowledge:store/query, communication tools) as a consumer of Phases 68-71 infrastructure
- [ ] **QA-04**: Triangular validation workflow: product delegates to dev, dev implements, dev delegates verification to QA, QA validates, failure triggers fix delegation back to dev
- [ ] **QA-05**: Feedback loop exercises 3-level delegation depth, completion signaling cascade, and shared memory across the delegation chain
- [ ] **QA-06**: One happy-path end-to-end integration test validates the full triangular workflow

### Future Requirements

Deferred to future milestone. Tracked but not in current roadmap.

### Human Collaboration

- **HUM-01**: Human entries seeded in entity directory from config (name, role, capabilities, reachVia)
- **HUM-02**: `task:delegate` materializes human-targeted tasks as Slack messages
- **HUM-03**: Human negotiation protocol handles async responses (minutes/hours vs seconds)
- **HUM-04**: Human responses parsed back into handshake protocol (accept/reject via Slack buttons)

### Advanced Signaling

- **ASIG-01**: Bidirectional clarification signal: target agent signals delegator for more info mid-task, delegator wakes and responds
- **ASIG-02**: Task groups with completion policies (all_required, any_sufficient, majority) for parallel delegation fan-out
- **ASIG-03**: Tree-level token budget enforcement across entire delegation tree (currently per-conversation)

### Advanced Delegation

- **ADEL-01**: Counter-propose in negotiation handshake (strategy abstraction enables future addition)
- **ADEL-02**: Materialization as configurable policy (prompt decides: internal conversation vs Linear ticket vs Slack thread)
- **ADEL-03**: Transparent delegation mode that creates Linear tickets for auditability

### Production QA

- **PQA-01**: Continuous test monitoring (automated regression detection)
- **PQA-02**: Test coverage analysis and gap identification
- **PQA-03**: Comprehensive E2E test suite covering failure modes and edge cases

### Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Central orchestrator agent | Anti-pattern: bottleneck with 200%+ token overhead. Peer-to-peer delegation with directory discovery instead. |
| Full message history on handoff | Anti-pattern: wastes context window, leaks irrelevant info. Task description + knowledge references instead. |
| Agent-to-agent chat channels | Anti-pattern: massive token waste, no clear ownership. Task-scoped communication only. |
| Consensus protocols between agents | Excessive complexity for marginal benefit. Single-authority delegation instead. |
| Real-time agent presence/availability | Infrastructure complexity for <10 agent types. Assume always-available for v1. |
| Cross-workspace collaboration | Authorization/isolation complexity not needed for single-team tool. Schema accommodates later. |
| Complex taxonomy (20+ knowledge types) | Over-classification leads to miscategorization. Start with 5 types, expand based on usage. |
| Automatic delegation without criteria | Causes over-delegation (CrewAI disabled by default). Prompt guidance provides judgment criteria. |
| Separate vector database | Operational complexity for moderate volume. pgvector in PostgreSQL is sufficient. |
| GitHub/Slack agent identity | Out of scope for v2.7. Linear Agent SDK only. GitHub Apps and Slack bot identity are separate concerns. |

### Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| LSDK-01 | Phase 67 | Pending |
| LSDK-02 | Phase 67 | Pending |
| LSDK-03 | Phase 67 | Pending |
| LSDK-04 | Phase 67 | Pending |
| LSDK-05 | Phase 67 | Pending |
| LSDK-06 | Phase 67 | Pending |
| LSDK-07 | Phase 67 | Pending |
| LSDK-08 | Phase 67 | Pending |
| LSDK-09 | Phase 67 | Pending |
| MEM-01 | Phase 68 | Pending |
| MEM-02 | Phase 68 | Pending |
| MEM-03 | Phase 68 | Pending |
| MEM-04 | Phase 68 | Pending |
| MEM-05 | Phase 68 | Pending |
| MEM-06 | Phase 68 | Pending |
| MEM-07 | Phase 68 | Pending |
| MEM-08 | Phase 68 | Pending |
| DIR-01 | Phase 69 | Pending |
| DIR-02 | Phase 69 | Pending |
| DIR-03 | Phase 69 | Pending |
| DIR-04 | Phase 69 | Pending |
| DIR-05 | Phase 69 | Pending |
| DIR-06 | Phase 69 | Pending |
| DEL-01 | Phase 70 | Pending |
| DEL-02 | Phase 70 | Pending |
| DEL-03 | Phase 70 | Pending |
| DEL-04 | Phase 70 | Pending |
| DEL-05 | Phase 70 | Pending |
| DEL-06 | Phase 70 | Pending |
| DEL-07 | Phase 70 | Pending |
| SIG-01 | Phase 71 | Pending |
| SIG-02 | Phase 71 | Pending |
| SIG-03 | Phase 71 | Pending |
| SIG-04 | Phase 71 | Pending |
| SIG-05 | Phase 71 | Pending |
| SIG-06 | Phase 71 | Pending |
| SIG-07 | Phase 71 | Pending |
| OBS-01 | Phase 72 | Pending |
| OBS-02 | Phase 72 | Pending |
| OBS-03 | Phase 72 | Pending |
| OBS-04 | Phase 72 | Pending |
| OBS-05 | Phase 72 | Pending |
| OBS-06 | Phase 72 | Pending |
| QA-01 | Phase 73 | Pending |
| QA-02 | Phase 73 | Pending |
| QA-03 | Phase 73 | Pending |
| QA-04 | Phase 73 | Pending |
| QA-05 | Phase 73 | Pending |
| QA-06 | Phase 73 | Pending |

**Coverage:**
- v2.7 requirements: 49 total
- Mapped to phases: 49
- Unmapped: 0

---
*Requirements defined: 2026-02-10*
*Last updated: 2026-02-10 after initial definition*

## v2.8

_Source: `docs/history/milestones/v2.8-REQUIREMENTS.md`_


**Archived:** 2026-02-18
**Status:** SHIPPED

For current requirements, see `.planning/REQUIREMENTS.md`.

---

# Requirements: Aesir v2.8 Resilience and Observability

**Defined:** 2026-02-16
**Core Value:** End-to-end automated development workflow where agents handle routine development tasks while humans focus on high-value decisions and reviews.

### v2.8 Requirements

Requirements for v2.8 milestone. Each maps to roadmap phases.

### Quick Fixes

- [x] **QF-01**: `get_task_context` returns null gracefully on reopened conversations without tasks (ISS-003)
- [x] **QF-02**: Dev-agent uses `ask` + `wait_for` for questions instead of `reply` (ISS-007)
- [x] **QF-03**: `spawn_agent` works for test agents -- fix validation mismatch vs production sub-agents (ISS-022)
- [x] **QF-04**: `communication:notify` works for test agents -- either remove tool from test agents or add default broadcast channel config (ISS-023)

### Echo Elimination

- [x] **ECHO-01**: Duplicate webhook deliveries rejected at adapter level via event ID dedup table (implementation note: 24h TTL cleanup via pg-boss scheduled job)
- [x] **ECHO-02**: Agent-caused webhooks suppressed via per-integration actor detection -- Linear (`actor.type`), GitHub (`sender.type`/`sender.login`), Slack (`bot_id`/`app_id`)
- [x] **ECHO-03**: Suppressed events logged for debugging transparency (not forwarded to router)

### Runtime Resilience

- [x] **RESIL-01**: All channels (Slack, Linear, GitHub) receive failure notification when a conversation reaches terminal `failed` status (ISS-001)
- [x] **RESIL-02**: All failure paths trigger notification -- retry-exhausted, non-retryable errors, max iterations (ISS-001)
- [x] **RESIL-03**: `notification.failed` event emitted when the failure notification itself fails -- dashboard is the visibility backstop (ISS-001)
- [x] **RESIL-04**: MCP errors classified as permanent (400, 401, 403, 404, 422) vs transient (429, 5xx) at the MCP client level (ISS-009)
- [x] **RESIL-05**: Permanent MCP errors return structured context to agent -- status code, error message, what was attempted (ISS-009)
- [x] **RESIL-06**: Transient MCP errors retried transparently with backoff; agent sees error only when retries are exhausted (ISS-009)
- [x] **RESIL-07**: MCP observability events emitted -- `mcp.error` (permanent), `mcp.rate_limited` (429), `mcp.retries_exhausted` (transient exhaustion) (ISS-009)
- [x] **RESIL-08**: Recovery context injected on crash resume -- query event log for work completed after last persistence point, format as `<recovery_context>` XML block (ISS-006)
- [x] **RESIL-09**: Retry count and recovery status included in recovery context for agent decision-making (ISS-006)
- [x] **RESIL-10**: Worker drains in-progress conversations on SIGTERM before exit -- stop claiming new work, let active conversations finish (with deadline), then exit cleanly

### Dashboard Observability

- [x] **DASH-01**: `agent.stale_recovered` event emitted on stale heartbeat recovery with worker ID, stale duration, and retry count
- [x] **DASH-02**: `agent.retry_scheduled` event emitted on retry decisions with error context and retry count
- [x] **DASH-03**: Lifecycle events (started, paused, resumed, reopened, stale recovery, retry) render with distinct icons and colors in timeline
- [x] **DASH-04**: Tool calls grouped by `toolCallId` as expandable cards showing tool name, duration, input (collapsed), output (collapsed)
- [x] **DASH-05**: Sub-agent work visually attributed with agent name labels and indented/nested blocks using existing `parent_instance_id`
- [x] **DASH-06**: MCP error events (`mcp.error`, `mcp.rate_limited`, `mcp.retries_exhausted`) rendered in timeline
- [x] **DASH-07**: `notification.failed` event rendered prominently in timeline
- [x] **DASH-08**: Conversation detail shows summary metrics -- total tokens, cost estimate, wall-clock duration, tool call count/success rate, retry count

### Work Correlation

- [x] **CORR-01**: Entity reference `{entity_type, entity_id}` standardized on IncomingEvent -- Linear `('linear_issue', issueId)`, GitHub `('github_pr', 'owner/repo#number')`, Slack `('slack_thread', 'channelId:threadTs')`
- [x] **CORR-02**: `work_correlations` table with composite key `(entity_type, entity_id, conversation_id)` linking external entities to active conversations
- [x] **CORR-03**: `work:register` tool allows agents to register that they are working on an external entity
- [x] **CORR-04**: `work:query` tool allows agents and router to check existing work for an entity before starting new work
- [x] **CORR-05**: Conversation status changes (completed, failed) propagate to correlation registry automatically
- [x] **CORR-06**: Router uses correlation lookup as fallback for events with no trigger match -- active work found signals that conversation
- [x] **CORR-07**: Disposition vocabulary (new, signal, retry, supersede, duplicate) formalized for routing and agent decision-making
- [x] **CORR-08**: Knowledge query supports metadata-based exact match mode alongside semantic search -- `mode: 'semantic' | 'exact' | 'combined'`

### Future Requirements

Deferred to future milestones. Tracked but not in current roadmap.

### Deferred to v2.9 (Platform Completion)

- **PCMP-01**: Counter-propose in delegation negotiation handshake (ADEL-01)
- **PCMP-02**: Bidirectional clarification signal for mid-task communication (ASIG-01)
- **PCMP-03**: Parallel delegation with task groups and completion policies (ASIG-02)
- **PCMP-04**: Tree-level token budget enforcement for delegation chains (ASIG-03)
- **PCMP-05**: Transparent materialization -- delegation creates Linear tickets (ADEL-02/03)
- **PCMP-06**: Scheduled agent execution -- periodic triggers (SCH-01)
- **PCMP-07**: Sub-agent discovery by capability -- dynamic selection (DISC-01)
- **PCMP-08**: Persistent agent identity documents -- memory across conversations (IDN-01)

### Deferred to v3.0 (Domain Modeling)

- **DMOD-01**: Domain-language action primitives (DAP-01)
- **DMOD-02**: Role-by-role agent deep dives (DOM-01)

### Deferred to v3.1 (Human Collaboration)

- **HCOL-01**: Human directory entries, materialization, async handshake, response parsing (HUM-01-04)

### Out of Scope

Explicitly excluded from v2.8. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Circuit breaker at MCP client level | Agents should reason about integration failures, not have calls silently blocked. With 3 integrations, operational benefit is minimal. |
| Secondary channel fallback for failure notifications | Combinatorial complexity (3 channels x failure modes). Dashboard is the single backstop. Revisit when workspace-level channel config exists. |
| Semantic dedup (Layer 3) as a filter | "Is this work already in progress?" is agent judgment, not a deterministic filter. Work correlation enriches context; agents decide relevance. |
| Real-time integration health dashboard | Over-engineered for 3 integrations. MCP error event aggregation provides sufficient visibility. |
| Automatic retry escalation | Agent is better positioned to decide alternatives than infrastructure. Fixed retry with agent-visible context. |
| Event replay for crash recovery | LLM calls are non-deterministic; replaying tool calls causes duplicate side effects. Recovery context injection instead. |
| Automatic work correlation registration | Platform should not guess correlations. Agent-initiated via `work:register` tool. |
| Dashboard entity-centric views | Correlation data enables these but UI work is v2.9 scope. Data queryable via tools and router. |
| Correlation-based dashboard filtering | "Show all conversations for LIN-456" requires UI work beyond timeline improvements. Defer to v2.9. |

### Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| QF-01 | Phase 74 | Satisfied |
| QF-02 | Phase 74 | Satisfied |
| QF-03 | Phase 74 | Satisfied |
| QF-04 | Phase 74 | Satisfied |
| ECHO-01 | Phase 75 | Satisfied |
| ECHO-02 | Phase 75 | Satisfied |
| ECHO-03 | Phase 75 | Satisfied |
| RESIL-01 | Phase 76 | Satisfied |
| RESIL-02 | Phase 76 | Satisfied |
| RESIL-03 | Phase 76 | Satisfied |
| RESIL-04 | Phase 76 | Satisfied |
| RESIL-05 | Phase 76 | Satisfied |
| RESIL-06 | Phase 76 | Satisfied |
| RESIL-07 | Phase 76 | Satisfied |
| RESIL-08 | Phase 76 | Satisfied |
| RESIL-09 | Phase 76 | Satisfied |
| RESIL-10 | Phase 76 | Satisfied |
| DASH-01 | Phase 77 | Satisfied |
| DASH-02 | Phase 77 | Satisfied |
| DASH-03 | Phase 77 | Satisfied |
| DASH-04 | Phase 77 | Satisfied |
| DASH-05 | Phase 77 | Satisfied |
| DASH-06 | Phase 77 | Satisfied |
| DASH-07 | Phase 77 | Satisfied |
| DASH-08 | Phase 77, 79 | Satisfied |
| CORR-01 | Phase 78 | Satisfied |
| CORR-02 | Phase 78 | Satisfied |
| CORR-03 | Phase 78 | Satisfied |
| CORR-04 | Phase 78 | Satisfied |
| CORR-05 | Phase 78 | Satisfied |
| CORR-06 | Phase 78 | Satisfied |
| CORR-07 | Phase 78 | Satisfied |
| CORR-08 | Phase 78 | Satisfied |

**Coverage:**
- v2.8 requirements: 33 total
- Satisfied: 33
- Pending: 0
- Unmapped: 0

---
*Requirements defined: 2026-02-16*
*Last updated: 2026-02-18 after v2.8 milestone audit (all 33 requirements satisfied)*

## v2.9

_Source: `.planning/REQUIREMENTS.md` at the time of the reset (retrievable with `git show v2.9:.planning/REQUIREMENTS.md`)_


**Defined:** 2026-02-20
**Core Value:** End-to-end automated development workflow where agents handle routine development tasks while humans focus on high-value decisions and reviews.

### v2.9 Requirements

Requirements for v2.9 Platform Completion. Each maps to roadmap phases.

### Negotiation

- [x] **NEG-01**: Counter-propose response type -- target responds with modified scope, timeline, or approach. Delegator sees the modification and decides: accept modified version, reject and cancel, or try someone else
- [x] **NEG-02**: Counter-propose as handshake strategy -- new strategy implementation alongside existing accept/reject. Same `task:respond` tool with additional response type
- [x] **NEG-03**: Clarification signal type -- `task_clarification` signal from target to delegator with question and optional structured options
- [x] **NEG-04**: `task:clarify` tool -- target agent sends a clarification request back to the delegating conversation
- [x] **NEG-05**: Clarification response -- delegator answers via signal back to target. Target's `wait_for` resumes with the answer
- [x] **NEG-06**: Multi-round support -- clarification can go back and forth within a single delegation, bounded by the task timeout
- [x] **NEG-07**: Prompt guidance -- agents understand when to counter-propose vs reject, when to ask for clarification vs proceed with assumptions

### Parallel Delegation

- [x] **PAR-01**: Task groups -- `task:delegate_group` creates multiple delegations as a named group with a shared completion policy
- [x] **PAR-02**: Completion policies -- `all_required` (wait for all), `any_sufficient` (first success unblocks delegator), `majority` (N of M). Defined at group creation
- [x] **PAR-03**: Partial completion handling -- when policy is `all_required` and one task fails, delegator receives immediate notification and decides: wait for others, cancel remaining, or accept partial results
- [x] **PAR-04**: Group status tool -- `task:group_status` returns aggregated group state (how many complete, pending, failed)
- [x] **PAR-05**: Signal aggregation -- completion signals from group members are collected. Delegator is signaled when the group's completion policy is satisfied
- [x] **PAR-06**: Group cancellation -- delegator can cancel all remaining tasks in a group (e.g., after `any_sufficient` is met, cancel the rest)
- [x] **PAR-07**: Budget-aware group design -- group data model accommodates future tree budget distribution (Phase 4). Phase 2 uses per-conversation budgets; Phase 4 retrofits tree-level allocation into groups

### Transparent Materialization

- [x] **MAT-01**: Materialization policy parameter -- `task:delegate` accepts an optional `materialization` parameter: `internal` (default, current behavior) or `transparent`
- [x] **MAT-02**: Linear materialization -- transparent mode creates a Linear issue with task description, priority, assignee (agent), and a link/reference back to the internal task
- [x] **MAT-03**: Bidirectional sync -- status changes on the materialized artifact (Linear issue updated) sync to task status. Task completion updates the Linear issue
- [x] **MAT-04**: Materialization as prompt guidance -- the decision to use internal vs transparent is agent judgment. Prompt guidance describes when transparency is valuable
- [x] **MAT-05**: Materialization interface -- extensible dispatch for future targets (Slack thread, GitHub issue) without changing the delegation tool
- [x] **MAT-06**: Correlation tracking -- materialized artifacts are tracked in the integration correlation layer so incoming webhooks route correctly back to the task

### Tree-Level Token Budgets

- [x] **BUD-01**: Tree budget allocation -- root task sets a total token budget for the entire delegation tree via `task:delegate` parameter
- [x] **BUD-02**: Budget propagation -- delegated tasks inherit a portion of the remaining tree budget, not an independent allocation. The delegating agent can specify allocation or accept default (equal split of remaining)
- [x] **BUD-03**: Budget tracking -- real-time token usage aggregated across all conversations in the tree, queryable via `task:tree_budget` tool
- [x] **BUD-04**: Budget exhaustion signal -- when tree budget is approaching exhaustion, active conversations receive a warning signal. Hard exhaustion stops all conversations in the tree
- [x] **BUD-05**: Budget visibility in dashboard -- token usage per tree level, per conversation, and total. Visual representation in the task tree view
- [x] **BUD-06**: Backward compatibility -- conversations without a tree budget continue using per-conversation budgets (existing behavior)

### Scheduled Execution

- [x] **SCH-01**: Schedule trigger type -- agents declare `schedule` triggers in definition.yaml alongside event triggers
- [x] **SCH-02**: Cron expression support -- standard cron syntax (e.g., `"0 9 * * MON"` for Monday 9am). Validated at definition load time
- [x] **SCH-03**: Schedule registration -- on startup, worker loop registers pg-boss scheduled jobs for all agents with schedule triggers
- [x] **SCH-04**: Synthetic event -- when a schedule fires, pg-boss job creates a synthetic `IncomingEvent` with type `schedule.triggered` and metadata (schedule name, last run time, last run outcome). EventRouter processes it like any other trigger
- [x] **SCH-05**: Overlap prevention -- configurable per-schedule: `skip` (drop if previous run still active) or `queue` (wait for completion then start). Default: `skip`
- [x] **SCH-06**: Schedule context injection -- scheduled conversations receive context about why they were triggered: schedule name, last run timestamp, last run outcome summary, time since last run
- [x] **SCH-07**: Manual trigger -- API endpoint and dashboard button to manually fire a scheduled agent (for testing and ad-hoc execution)
- [x] **SCH-08**: Schedule visibility in dashboard -- active schedules, next run time, last run status, run history

### Sub-Agent Discovery

- [ ] **DISC-01**: Sub-agent capabilities field -- sub-agent definitions include `capabilities` (same format as orchestrator capabilities in directory)
- [ ] **DISC-02**: Sub-agent registry -- internal registry of sub-agents queryable by capability, separate from the entity directory
- [ ] **DISC-03**: Capability-based spawn -- `coordination:spawn_agent` accepts either a hardcoded agent ID (backward compatible) or a `capability` parameter that resolves to the best-matching sub-agent
- [ ] **DISC-04**: Registry seeding -- sub-agent capabilities seeded from YAML at startup, alongside orchestrator directory seeding
- [ ] **DISC-05**: Semantic matching -- reuse pgvector embedding pipeline from knowledge/directory for capability matching
- [ ] **DISC-06**: Orchestrator prompt simplification -- orchestrators describe the capability they need ("I need code written" vs "spawn coder"). Prompt guidance teaches capability-based reasoning
- [ ] **DISC-07**: Fallback behavior -- if no sub-agent matches the capability query, return empty result. Agent decides: do the work itself, try a different capability description, or signal inability

### Persistent Agent Identity

- [x] **IDN-01**: Identity document table -- structured, versioned documents scoped to an agent role (not a conversation). Schema: agent_id, document_type, content (text), version, updated_at, token_count
- [x] **IDN-02**: Document types -- extensible set: `product_brief`, `architectural_model`, `stakeholder_map`, `domain_knowledge`, `working_context`, `learned_preferences`. New types addable without schema change
- [x] **IDN-03**: Context injection -- relevant identity documents injected into the system prompt at conversation start. The agent begins every conversation with its accumulated understanding
- [x] **IDN-04**: `identity:update` tool -- agents update their identity documents at conversation end (or mid-conversation for important discoveries). Appends a new version; old versions retained
- [x] **IDN-05**: `identity:read` tool -- agents can explicitly read their identity documents (beyond the auto-injected version at start) for refresh during long conversations
- [x] **IDN-06**: Document versioning -- every update creates a new version. Full history retained for audit and rollback
- [x] **IDN-07**: Size management -- identity documents have configurable token limits per type. When approaching the limit, the agent is prompted to summarize/compress before the next update
- [x] **IDN-08**: Dashboard visibility -- identity documents viewable and version-comparable in the dashboard. Operators can see how an agent's understanding evolved over time
- [x] **IDN-09**: Graceful degradation -- if identity documents fail to load, conversation starts without them (higher context cost, not a hard failure)

### Knowledge Retrieval Enhancement

- [x] **KR-01**: Retrieval strategy abstraction -- pluggable pipeline interface (type contract with zero-overhead default path) that accepts a query and agent config, returns ranked results. Current vector search refactored as the default strategy implementation. Must NOT add runtime dispatch overhead when using the default strategy.
- [x] **KR-02**: Per-agent retrieval config in definition.yaml -- agents declare retrieval preferences (strategy selection, weights, feature flags) in their definition. Schema designed against known strategy interfaces: vector, keyword, temporal decay, diversity
- [x] **KR-03**: Strategy registry -- strategies registered by name, resolved at query time from agent config. New strategies addable without changing the pipeline code
- [x] **KR-04**: Score fusion interface -- when multiple strategies are enabled, scores are combined via configurable weights. Designed for hybrid retrieval (e.g., vector + keyword) even though only vector ships initially
- [x] **KR-05**: Pre-compaction knowledge flush -- before history compaction, inject a turn prompting the agent to persist important knowledge via `store_knowledge`. Uses existing auto-supersede deduplication
- [x] **KR-06**: Flush safeguards -- flush count tracking prevents double-flushing. Flush is skipped if agent has no knowledge tools. Agent responds with a sentinel if nothing to store
- [x] **KR-07**: Backward compatibility -- agents without retrieval config in YAML use the current vector-only pipeline with existing behavior. No changes to existing agent definitions required
- [x] **KR-08**: Config validation -- retrieval config validated at definition load time via Zod. Invalid strategy references or weight configurations fail fast at startup

### Future Requirements

Deferred to v3.0+ milestones. Tracked but not in current roadmap.

### Concrete Retrieval Strategies (v3.0)

- **KRS-01**: BM25/keyword retrieval strategy implementation
- **KRS-02**: Temporal decay retrieval strategy
- **KRS-03**: MMR diversity retrieval strategy

### Domain Modeling (v3.0)

- **DOM-01**: Role-by-role agent deep dives (product, dev, QA, new roles)
- **DOM-02**: Domain-specific sub-agents and tools
- **DAP-01**: Domain-language action primitives (`work:create_item` vs `linear:create_issue`)

### Human Collaboration (v3.1)

- **HUM-01**: Human directory entries, seeding + delegation for human entities
- **HUM-02**: Slack materialization for human task delivery
- **HUM-03**: Async handshake for human response parsing
- **HUM-04**: Escalation strategies and reminder logic

### Cross-Session Learning

- **CSL-01**: Feedback loop from real task outcomes to agent improvement

### Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Concrete BM25/keyword/temporal-decay/MMR strategies | v3.0 role analysis reveals which agents need them. v2.9 ships the pipeline interface only. |
| Human directory entries | Agents must be competent (v3.0) before humans collaborate (v3.1). Schema ready from v2.7. |
| Per-agent bot users / integration identities | v2.9 spec constraint: "do not deepen per-agent external identities." v3.0 target. |
| GitHub/Slack materialization targets | Linear only for v2.9. Extensible interface accommodates future targets. |
| Dynamic schedule CRUD API | Schedules from YAML, not runtime config. Manual trigger provides ad-hoc execution. |
| Cross-tree budget sharing | Trees are independent budget units. Sharing creates unpredictable resource consumption. |
| Automatic identity document updates | Agent decides when to persist. Prompt guidance + optional executor reminder, not mandatory injection. |

### Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| NEG-01 | Phase 80 | Complete |
| NEG-02 | Phase 80 | Complete |
| NEG-03 | Phase 80 | Complete |
| NEG-04 | Phase 80 | Complete |
| NEG-05 | Phase 80 | Complete |
| NEG-06 | Phase 80 | Complete |
| NEG-07 | Phase 80 | Complete |
| PAR-01 | Phase 81 | Complete |
| PAR-02 | Phase 81 | Complete |
| PAR-03 | Phase 81 | Complete |
| PAR-04 | Phase 81 | Complete |
| PAR-05 | Phase 81 | Complete |
| PAR-06 | Phase 81 | Complete |
| PAR-07 | Phase 81 | Complete |
| MAT-01 | Phase 82 | Complete |
| MAT-02 | Phase 82 | Complete |
| MAT-03 | Phase 82 | Complete |
| MAT-04 | Phase 82 | Complete |
| MAT-05 | Phase 82 | Complete |
| MAT-06 | Phase 82 | Complete |
| BUD-01 | Phase 83 | Complete |
| BUD-02 | Phase 83 | Complete |
| BUD-03 | Phase 83 | Complete |
| BUD-04 | Phase 83 | Complete |
| BUD-05 | Phase 83 | Complete |
| BUD-06 | Phase 83 | Complete |
| SCH-01 | Phase 84 | Complete |
| SCH-02 | Phase 84 | Complete |
| SCH-03 | Phase 84 | Complete |
| SCH-04 | Phase 84 | Complete |
| SCH-05 | Phase 84 | Complete |
| SCH-06 | Phase 84 | Complete |
| SCH-07 | Phase 84 | Complete |
| SCH-08 | Phase 84 | Complete |
| DISC-01 | Phase 85 | Pending |
| DISC-02 | Phase 85 | Pending |
| DISC-03 | Phase 85 | Pending |
| DISC-04 | Phase 85 | Pending |
| DISC-05 | Phase 85 | Pending |
| DISC-06 | Phase 85 | Pending |
| DISC-07 | Phase 85 | Pending |
| IDN-01 | Phase 86 | Complete |
| IDN-02 | Phase 86 | Complete |
| IDN-03 | Phase 86 | Complete |
| IDN-04 | Phase 86 | Complete |
| IDN-05 | Phase 86 | Complete |
| IDN-06 | Phase 86 | Complete |
| IDN-07 | Phase 86 | Complete |
| IDN-08 | Phase 86 | Complete |
| IDN-09 | Phase 86 | Complete |
| KR-01 | Phase 87 | Complete |
| KR-02 | Phase 87 | Complete |
| KR-03 | Phase 87 | Complete |
| KR-04 | Phase 87 | Complete |
| KR-05 | Phase 87 | Complete |
| KR-06 | Phase 87 | Complete |
| KR-07 | Phase 87 | Complete |
| KR-08 | Phase 87 | Complete |

**Coverage:**
- v2.9 requirements: 58 total
- Mapped to phases: 58
- Unmapped: 0

---
*Requirements defined: 2026-02-20*
*Last updated: 2026-02-20 after roadmap creation*
