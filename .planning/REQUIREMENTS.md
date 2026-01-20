# Requirements: Aesir v2.0 Foundation

**Defined:** 2026-01-19
**Core Value:** Maintainable, scalable foundation for end-to-end automated development workflows

## v2.0 Requirements

Requirements for Foundation milestone. Full restructure from "prove it works" to "maintainable and scalable."

### Tooling & DX

- [ ] **TOOL-01**: Biome configured for linting and formatting (replaces ESLint/Prettier)
- [ ] **TOOL-02**: npm standardized as package manager (yarn.lock removed)
- [ ] **TOOL-03**: Pre-commit hooks enforce code quality before commits
- [ ] **TOOL-04**: dotenv-flow configured for environment hierarchy (.env.development, .env.test, .env.production)
- [ ] **TOOL-05**: Type-safe configuration with Zod validation at startup (fail fast on missing/invalid env vars)

### Code Quality

- [ ] **QUAL-01**: Consistent error handling pattern at service boundaries (neverthrow Result types)
- [ ] **QUAL-02**: Input validation at all external boundaries using Zod schemas
- [ ] **QUAL-03**: Module index files for public APIs (each module exports via index.ts)
- [ ] **QUAL-04**: Branded types for cross-service IDs (LinearIssueId, GitHubPRId, SlackThreadId)
- [ ] **QUAL-05**: Typed error hierarchy with error codes (AppError base class, domain-specific errors)
- [ ] **QUAL-06**: Dead code removed and duplicates consolidated

### Architecture

- [ ] **ARCH-01**: Platform layer implemented (config, secrets, observability, state management)
- [ ] **ARCH-02**: Integrations layer with Linear, GitHub, Slack as independent packages
- [ ] **ARCH-03**: Agents layer using Platform and Integrations through normalized protocols
- [x] **ARCH-04**: pnpm workspace monorepo structure with clear package boundaries
- [ ] **ARCH-05**: MCP servers in each integration for agent tool calls
- [ ] **ARCH-06**: Factory functions for dependency injection (no global singletons)
- [ ] **ARCH-07**: Layer dependency rules enforced (Agents -> Integrations -> Platform)

### Data Layer

- [x] **DATA-01**: PostgreSQL schema structure (platform, integrations, observability schemas)
- [x] **DATA-02**: Credential storage with encryption (migrate from .tokens/ files to database)
- [ ] **DATA-03**: Webhook idempotency tracking (integrations.webhook_deliveries table)
- [ ] **DATA-04**: Agent execution records for observability (observability.agent_executions table)
- [ ] **DATA-05**: Sync cursor management for integrations (integrations.sync_cursors table)
- [ ] **DATA-06**: LangGraph checkpoint cleanup policy implemented

### Testing

- [ ] **TEST-01**: Test coverage reporting configured with targets (70%+ for core modules)
- [ ] **TEST-02**: testcontainers for PostgreSQL integration tests
- [ ] **TEST-03**: Test fixtures and factories for domain objects
- [ ] **TEST-04**: Fast local test mode (skip slow Docker tests for rapid iteration)
- [ ] **TEST-05**: Test isolation via transaction-per-test or testcontainers
- [ ] **TEST-06**: CI test execution as quality gate

### CI/CD Pipeline

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

- [ ] **LDEV-01**: One-command local dev environment (Docker Compose)
- [ ] **LDEV-02**: Health check endpoints for all services
- [ ] **LDEV-03**: Graceful shutdown handling (SIGTERM, drain connections)
- [ ] **LDEV-04**: Docker hot reload for fast iteration
- [ ] **LDEV-05**: .claude files updated to reflect new architecture
- [ ] **LDEV-06**: cursor files for AI tool understanding

## Deferred (Post v2.0)

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

## Out of Scope

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

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

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
| DATA-03 | Phase 14 | Pending |
| DATA-04 | Phase 14 | Pending |
| DATA-05 | Phase 14 | Pending |
| DATA-06 | Phase 14 | Pending |
| ARCH-01 | Phase 14 | Pending |
| ARCH-06 | Phase 14 | Pending |
| ARCH-07 | Phase 14 | Pending |
| QUAL-01 | Phase 15 | Pending |
| QUAL-02 | Phase 15 | Pending |
| QUAL-03 | Phase 15 | Pending |
| QUAL-04 | Phase 15 | Pending |
| QUAL-05 | Phase 15 | Pending |
| QUAL-06 | Phase 15 | Pending |
| ARCH-02 | Phase 16, 17, 18 | Pending |
| ARCH-03 | Phase 16, 17, 18 | Pending |
| ARCH-05 | Phase 19 | Pending |
| TEST-01 | Phase 20 | Pending |
| TEST-02 | Phase 20 | Pending |
| TEST-03 | Phase 20 | Pending |
| TEST-04 | Phase 20 | Pending |
| TEST-05 | Phase 20 | Pending |
| TEST-06 | Phase 21 | Pending |
| CICD-01 | Phase 21 | Pending |
| CICD-02 | Phase 21 | Pending |
| CICD-03 | Phase 21 | Pending |
| CICD-04 | Phase 21 | Pending |
| CICD-05 | Phase 21 | Pending |
| CICD-06 | Phase 21 | Pending |
| LDEV-01 | Phase 22 | Pending |
| LDEV-02 | Phase 22 | Pending |
| LDEV-03 | Phase 22 | Pending |
| LDEV-04 | Phase 22 | Pending |
| LDEV-05 | Phase 10 | Complete |
| LDEV-06 | Phase 10 | Complete |

**Coverage:**
- v2.0 requirements: 40 total
- Mapped to phases: 40
- Unmapped: 0

**Note:** ARCH-02 and ARCH-03 are split across phases 16-18 (one integration extraction per phase).

---
*Requirements defined: 2026-01-19*
*Last updated: 2026-01-20 after Phase 13 completion*
