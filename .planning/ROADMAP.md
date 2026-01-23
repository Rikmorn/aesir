# Roadmap: Aesir v2.0 Foundation

## Milestones

- [x] **v1.0 MVP** - Phases 1-9 (shipped 2026-01-19) - See `.planning/MILESTONES.md`
- [ ] **v2.0 Foundation** - Phases 10-22 (in progress)

## Overview

The v2.0 Foundation milestone restructures Aesir from a working prototype to a maintainable, scalable 3-layer platform. Thirteen focused phases transform the codebase incrementally: foundation tooling, monorepo structure, observability, data layer, platform services, code quality patterns, integration extraction (one per service), MCP layer, testing pyramid, CI/CD pipeline, and local dev environment. Each phase is deliberately small to ensure completable, verifiable progress.

## Phases

**Phase Numbering:**
- Phases 1-9: v1.0 MVP (archived)
- Phases 10-22: v2.0 Foundation (current milestone)
- Decimal phases (10.1, 10.2): Urgent insertions if needed

- [x] **Phase 10: Foundation Setup** - Biome, npm, dotenv-flow, pre-commit hooks, .claude/.cursor files
- [x] **Phase 11: Monorepo Setup** - pnpm workspace structure with package boundaries
- [x] **Phase 12: Observability** - pino logging, correlation IDs, structured JSON logs
- [x] **Phase 13: Data Layer** - PostgreSQL schemas, credential migration from .tokens/
- [x] **Phase 14: Platform Services** - Webhook idempotency, execution tracking, cleanup, DI patterns
- [x] **Phase 15: Code Quality** - Error handling, validation, barrel exports, dead code removal
- [x] **Phase 16: Linear Extraction** - Extract Linear integration to independent package
- [x] **Phase 17: GitHub Extraction** - Extract GitHub integration to independent package
- [ ] **Phase 18: Slack Extraction** - Extract Slack integration to independent package
- [ ] **Phase 19: MCP Layer** - MCP servers in each integration for agent tool calls
- [ ] **Phase 20: Testing Pyramid** - Coverage, testcontainers, fixtures, isolation
- [ ] **Phase 21: CI/CD Pipeline** - GitHub Actions, quality gates, branch protection
- [ ] **Phase 22: Local Dev Environment** - Docker hot reload, health checks, graceful shutdown

## Phase Details

### Phase 10: Foundation Setup
**Goal:** Standardized development tooling and ML configuration enabling consistent code quality and AI-assisted development
**Depends on:** Nothing (first v2.0 phase)
**Requirements:** TOOL-01, TOOL-02, TOOL-03, TOOL-04, TOOL-05, LDEV-05, LDEV-06
**Success Criteria** (what must be TRUE):
  1. Running `npm run lint` uses Biome; all auto-fixable violations fixed, remaining documented
  2. Only package-lock.json exists (no yarn.lock), npm commands work throughout codebase
  3. Git commits are blocked if staged files fail lint/format checks
  4. Environment variables load correctly based on NODE_ENV (.env.development, .env.test)
  5. Application fails fast at startup with clear error messages when required env vars are missing
  6. .claude files document current architecture, tooling decisions, and coding patterns
  7. cursor files provide AI tools with codebase understanding
**Plans:** 4 plans

**ML Configuration Note:** All subsequent phases MUST update .claude and cursor files when making architectural changes. This ensures Claude Code and other AI tools always have current context.

Plans:
- [x] 10-01-PLAN.md - Migrate to npm, install and configure Biome
- [x] 10-02-PLAN.md - Configure dotenv-flow and Zod env validation
- [x] 10-03-PLAN.md - Set up pre-commit hooks and VS Code integration
- [x] 10-04-PLAN.md - Create .claude and .cursor AI context files

### Phase 11: Monorepo Setup
**Goal:** pnpm workspace structure with clear package boundaries enabling independent package development
**Depends on:** Phase 10
**Requirements:** ARCH-04
**Success Criteria** (what must be TRUE):
  1. Running `pnpm install` from root installs all workspace packages
  2. packages/ directory contains common/, platform/, integrations/, agents/ with their own package.json
  3. TypeScript project references enforce import boundaries between packages
  4. Each package can be built independently with `pnpm --filter <package> build`
**Plans:** 4 plans

Plans:
- [x] 11-01-PLAN.md — Install pnpm, create workspace config, set up TypeScript project reference structure
- [x] 11-02-PLAN.md — Create package scaffolding (common, platform, integrations, agents)
- [x] 11-03-PLAN.md — Move source files from src/ to packages, rename src to src_old
- [x] 11-04-PLAN.md — Fix imports, run pnpm install, verify builds, re-enable hooks

### Phase 12: Observability
**Goal:** Production-ready logging infrastructure with correlation across service boundaries
**Depends on:** Phase 11
**Requirements:** OBSV-01, OBSV-02, OBSV-03
**Success Criteria** (what must be TRUE):
  1. All log output uses pino (no console.log, no custom logger)
  2. Every HTTP request generates a unique correlation ID visible in all resulting log entries
  3. Log output is valid JSON that can be parsed by standard log aggregation tools
  4. Sensitive fields (passwords, tokens, API keys) are automatically redacted from logs
**Plans:** 8 plans (6 original + 2 gap closure)

Plans:
- [x] 12-01-PLAN.md — Install pino dependencies, create correlation ID and redaction utilities
- [x] 12-02-PLAN.md — Create pino logger factory with dual timestamps, component naming, log levels
- [x] 12-03-PLAN.md — Create HTTP middleware (pino-http) and Temporal logger adapter
- [x] 12-04-PLAN.md — Migrate integrations and platform packages to pino
- [x] 12-05-PLAN.md — Migrate agents package to pino
- [x] 12-06-PLAN.md — Remove legacy logger, update test utilities, verify completion
- [x] 12-07-PLAN.md — [Gap closure] Wire correlation IDs to webhook handlers
- [x] 12-08-PLAN.md — [Gap closure] Wire Temporal logger adapter, clean stale dist artifacts

### Phase 13: Data Layer
**Goal:** PostgreSQL schema structure with encrypted credential storage replacing .tokens/ files
**Depends on:** Phase 12
**Requirements:** DATA-01, DATA-02
**Success Criteria** (what must be TRUE):
  1. PostgreSQL database has platform, integrations, observability schemas created by migrations
  2. OAuth tokens stored in integrations.credentials table with encryption at rest
  3. .tokens/ directory is deleted, all credential access goes through database
  4. Migration scripts can be run idempotently (re-running does not fail)
**Plans:** 6 plans

Plans:
- [x] 13-01-PLAN.md — Install Drizzle dependencies, configure database env vars, create prefixed ID generator
- [x] 13-02-PLAN.md — Create Drizzle schemas for platform and integrations with database clients
- [x] 13-03-PLAN.md — Generate and apply migrations, create updated_at triggers, seed default workspace
- [x] 13-04-PLAN.md — Create encryption utilities and database-backed credential store
- [x] 13-05-PLAN.md — Wire Linear integration to database credentials, update OAuth flow
- [x] 13-06-PLAN.md — Migrate existing token, delete .tokens/, remove legacy code

### Phase 14: Platform Services
**Goal:** Core platform services for webhook handling, execution tracking, and dependency injection
**Depends on:** Phase 13
**Requirements:** DATA-03, DATA-04, DATA-05, DATA-06, ARCH-01, ARCH-06, ARCH-07
**Success Criteria** (what must be TRUE):
  1. Duplicate webhooks (same delivery ID) are ignored without error
  2. Agent executions are recorded with start/end times and status in observability.agent_executions
  3. Integration sync cursors persist between runs (integrations.sync_cursors table)
  4. LangGraph checkpoints older than retention policy are automatically cleaned up
  5. All services created via factory functions, no global singletons
  6. Importing from agents/ into platform/ fails TypeScript compilation (layer rules enforced)
**Plans:** 8 plans

Plans:
- [x] 14-01-PLAN.md — Add agent_executions schema to observability, RETENTION_DAYS env var
- [x] 14-02-PLAN.md — Add Biome noRestrictedImports rules for layer boundary enforcement
- [x] 14-03-PLAN.md — Create webhook idempotency service with factory pattern
- [x] 14-04-PLAN.md — Create execution tracker service with factory pattern
- [x] 14-05-PLAN.md — Create cleanup service for retention-based deletion
- [x] 14-06-PLAN.md — Create sync cursor service for integration state persistence
- [x] 14-07-PLAN.md — Wire services to webhook handlers and entry points
- [x] 14-08-PLAN.md — Refactor credential store to factory pattern, update CLAUDE.md

### Phase 15: Code Quality
**Goal:** Consistent error handling, validation, and type safety patterns across the codebase
**Depends on:** Phase 14
**Requirements:** QUAL-01, QUAL-02, QUAL-03, QUAL-05, QUAL-06 (QUAL-04 descoped - named params instead)
**Success Criteria** (what must be TRUE):
  1. Service boundary functions return Result<T, E> types (neverthrow), not thrown exceptions
  2. All external API inputs (webhooks, HTTP endpoints) validated with Zod before processing
  3. Each package exports its public API via index.ts (no deep imports into internal modules)
  4. Error classes extend AppError base class with unique error codes
  5. Running dead code analysis reports no unreachable code or unused exports
**Plans:** 8 plans (6 original + 2 gap closure)

Plans:
- [x] 15-01-PLAN.md — Install neverthrow/knip, create AppError hierarchy in common package
- [x] 15-02-PLAN.md — Create integration error classes, migrate CredentialStore to ResultAsync
- [x] 15-03-PLAN.md — Create platform/observability errors, migrate CleanupService and ExecutionTracker
- [x] 15-04-PLAN.md — Add Zod validation schemas to webhook handlers
- [x] 15-05-PLAN.md — Audit and reorganize barrel exports in all packages
- [x] 15-06-PLAN.md — Configure knip and remove dead code
- [x] 15-07-PLAN.md — [Gap closure] Migrate remaining services to ResultAsync
- [x] 15-08-PLAN.md — [Gap closure] Remove platform blanket re-export

### Phase 16: Linear Extraction
**Goal:** Linear integration extracted as independent package with its own lifecycle
**Depends on:** Phase 15
**Requirements:** ARCH-02 (partial), ARCH-03 (partial)
**Success Criteria** (what must be TRUE):
  1. packages/integrations/linear/ contains all Linear-specific code
  2. Linear package has its own package.json with only its required dependencies
  3. Linear OAuth, webhook handling, and API calls work through the extracted package
  4. Linear package can be versioned and published independently
**Plans:** 11 plans

Plans:
- [x] 16-01-PLAN.md — Create package scaffolding and workspace configuration
- [x] 16-02-PLAN.md — Create database layer with linear.* schema and credential store
- [x] 16-03-PLAN.md — Move webhook handling (signature, parser, types)
- [x] 16-04-PLAN.md — Move Linear client (factory, issues, activities)
- [x] 16-05-PLAN.md — Create OAuth flow module (token store, client from database)
- [x] 16-06-PLAN.md — Create HTTP API layer (routes, webhooks, OAuth, main.ts)
- [x] 16-07-PLAN.md — Create database migration and credential migration script
- [x] 16-08-PLAN.md — Create Dockerfile and README documentation
- [x] 16-09-PLAN.md — Move and adapt tests
- [x] 16-10-PLAN.md — Update consumers and create backward-compatible re-exports
- [x] 16-11-PLAN.md — Update AI context files, final verification checkpoint

### Phase 17: GitHub Extraction
**Goal:** GitHub integration extracted as independent package with its own lifecycle
**Depends on:** Phase 16
**Requirements:** ARCH-02 (partial), ARCH-03 (partial)
**Success Criteria** (what must be TRUE):
  1. packages/integrations/github/ contains all GitHub-specific code
  2. GitHub package has its own package.json with only its required dependencies
  3. GitHub OAuth, webhook handling, PR/branch operations work through the extracted package
  4. GitHub package can be versioned and published independently
**Plans:** 11 plans

Plans:
- [x] 17-01-PLAN.md — Create package scaffolding and workspace configuration
- [x] 17-02-PLAN.md — Create database layer with github.* schema and credential store
- [x] 17-03-PLAN.md — Move webhook handling (signature with @octokit/webhooks-methods, parser, types)
- [x] 17-04-PLAN.md — Move GitHub client (factory, types) and operations (branches, commits, PRs)
- [x] 17-05-PLAN.md — Create OAuth flow module (token store, client from database)
- [x] 17-06-PLAN.md — Create HTTP API layer (routes, webhooks, OAuth, main.ts)
- [x] 17-07-PLAN.md — Create database migration and credential migration script
- [x] 17-08-PLAN.md — Create Dockerfile and README documentation
- [x] 17-09-PLAN.md — Move and adapt tests
- [x] 17-10-PLAN.md — Update consumers and create backward-compatible re-exports
- [x] 17-11-PLAN.md — Update AI context files, final verification checkpoint

### Phase 18: Slack Extraction
**Goal:** Slack integration extracted as independent package with its own lifecycle
**Depends on:** Phase 17
**Requirements:** ARCH-02 (partial), ARCH-03 (partial)
**Success Criteria** (what must be TRUE):
  1. packages/integrations/slack/ contains all Slack-specific code
  2. Slack package has its own package.json with only its required dependencies
  3. Slack OAuth, event handling, and message posting work through the extracted package
  4. Slack package can be versioned and published independently
**Plans:** 12 plans

Plans:
- [ ] 18-01-PLAN.md — Create package scaffolding and workspace configuration
- [ ] 18-02-PLAN.md — Create database layer with slack.* schema, credential store, event delivery store
- [ ] 18-03-PLAN.md — Create event handling layer (types, parser, handler with deduplication)
- [ ] 18-04-PLAN.md — Create client layer (Bolt factory with installationStore, WebClient wrapper)
- [ ] 18-05-PLAN.md — Create message layer (Block Kit builders, thread-aware sender)
- [ ] 18-06-PLAN.md — Create OAuth module (installationStore adapter, token store, flow)
- [ ] 18-07-PLAN.md — Create HTTP API layer (events endpoint, OAuth routes, main.ts)
- [ ] 18-08-PLAN.md — Create database migration and credential migration script
- [ ] 18-09-PLAN.md — Create Dockerfile and README documentation
- [ ] 18-10-PLAN.md — Create tests (parser, handler, credential store, blocks)
- [ ] 18-11-PLAN.md — Update consumers and create backward-compatible re-exports
- [ ] 18-12-PLAN.md — Update AI context files, final verification checkpoint

### Phase 19: MCP Layer
**Goal:** MCP servers in each integration enabling standardized agent tool calls
**Depends on:** Phase 18
**Requirements:** ARCH-05
**Success Criteria** (what must be TRUE):
  1. Each integration (Linear, GitHub, Slack) exposes an MCP server with tools for its operations
  2. Agents can discover and call integration tools via MCP protocol
  3. MCP tool calls are logged with correlation IDs for traceability
  4. MCP server configuration specifies available tools per agent (tool whitelisting)
**Plans:** TBD

Plans:
- [ ] 19-01: TBD

### Phase 20: Testing Pyramid
**Goal:** Comprehensive testing infrastructure with fast local tests and reliable integration tests
**Depends on:** Phase 19
**Requirements:** TEST-01, TEST-02, TEST-03, TEST-04, TEST-05
**Success Criteria** (what must be TRUE):
  1. Test coverage report shows 70%+ coverage on core platform and integration modules
  2. Integration tests use testcontainers for isolated PostgreSQL instances
  3. Test fixtures and factories exist for all major domain objects (agents, issues, PRs)
  4. Running `npm test:fast` skips slow Docker tests for rapid iteration (<5s)
  5. Tests are isolated via transaction rollback or testcontainers (no shared database state)
**Plans:** TBD

Plans:
- [ ] 20-01: TBD

### Phase 21: CI/CD Pipeline
**Goal:** Automated quality gates blocking PRs until quality bar is met
**Depends on:** Phase 20
**Requirements:** TEST-06, CICD-01, CICD-02, CICD-03, CICD-04, CICD-05, CICD-06
**Success Criteria** (what must be TRUE):
  1. GitHub Actions workflow runs lint -> typecheck -> test -> integration on every PR
  2. PRs cannot be merged until all CI checks pass (branch protection enforced)
  3. CI uses pnpm and TypeScript caching (subsequent runs significantly faster than cold runs)
  4. Independent jobs (lint, typecheck) run in parallel
  5. All GitHub Actions pinned to SHA, not tags (supply chain security)
**Plans:** TBD

Plans:
- [ ] 21-01: TBD

### Phase 22: Local Dev Environment
**Goal:** One-command local development with fast iteration and proper shutdown handling
**Depends on:** Phase 21
**Requirements:** LDEV-01, LDEV-02, LDEV-03, LDEV-04
**Success Criteria** (what must be TRUE):
  1. Running `docker compose up` starts all services (PostgreSQL, Temporal, agents) ready to use
  2. Each service exposes /health endpoint returning 200 when healthy
  3. Services handle SIGTERM gracefully (drain connections, complete in-flight work, exit cleanly)
  4. Code changes trigger automatic rebuild without manual restart (hot reload)
  5. .claude and cursor files reflect final v2.0 architecture (final update after all phases)
**Plans:** TBD

Plans:
- [ ] 22-01: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 10 -> 11 -> 12 -> ... -> 22
Decimal phases (if inserted) execute between integers: 10 -> 10.1 -> 11

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 10. Foundation Setup | v2.0 | 4/4 | Complete | 2026-01-20 |
| 11. Monorepo Setup | v2.0 | 4/4 | Complete | 2026-01-20 |
| 12. Observability | v2.0 | 8/8 | Complete | 2026-01-20 |
| 13. Data Layer | v2.0 | 6/6 | Complete | 2026-01-20 |
| 14. Platform Services | v2.0 | 8/8 | Complete | 2026-01-21 |
| 15. Code Quality | v2.0 | 8/8 | Complete | 2026-01-21 |
| 16. Linear Extraction | v2.0 | 11/11 | Complete | 2026-01-21 |
| 17. GitHub Extraction | v2.0 | 11/11 | Complete | 2026-01-21 |
| 18. Slack Extraction | v2.0 | 0/12 | Planned | - |
| 19. MCP Layer | v2.0 | 0/TBD | Not started | - |
| 20. Testing Pyramid | v2.0 | 0/TBD | Not started | - |
| 21. CI/CD Pipeline | v2.0 | 0/TBD | Not started | - |
| 22. Local Dev Environment | v2.0 | 0/TBD | Not started | - |

---
*Created: 2026-01-19*
*Updated: 2026-01-23 (Phase 18 planned)*
*Milestone: v2.0 Foundation*
