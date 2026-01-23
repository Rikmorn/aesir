# Phase 20: Testing Pyramid - Context

**Gathered:** 2026-01-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Comprehensive testing infrastructure with fast local tests and reliable integration tests. Covers coverage tooling, test organization, fixture factories, and testcontainers setup. Does not include CI/CD enforcement (Phase 21) or E2E browser tests.

</domain>

<decisions>
## Implementation Decisions

### Coverage Strategy
- **Targets:** 70% for core packages (common, platform, observability), 50% for integration packages (harder to test meaningfully due to API wrappers)
- **Exclusions:** Migration scripts (db/scripts/*), main entry points (main.ts), type-only files (types.ts, schemas.ts), legacy code (_legacy/*)
- **Tool:** Vitest built-in coverage with @vitest/coverage-v8
- **Metrics:** Lines, branches, and statements
- **Reports:** HTML reports generated in coverage/ directory
- **Trends:** Not tracking for now (CI/CD phase concern)
- **Enforcement:** Thresholds configured but not blocking (CI enforcement in Phase 21)

### Test Organization
- **File location:**
  - Unit tests: Colocated with source (foo.ts + foo.test.ts)
  - Integration tests: Package-level (packages/integration-linear/tests/)
  - E2E/System tests: Workspace-level (top-level tests/ or e2e/)
- **Naming convention:** Suffix pattern — *.test.ts (unit), *.integration.test.ts, *.e2e.test.ts
- **Test commands:**
  - `test:fast` — Excludes *.integration.test.ts, *.e2e.test.ts, and sandbox/Docker tests
  - `test:integration` — Runs integration tests with testcontainers
  - `test` — Runs all tests
- **Utilities:** New @aesir/test-utils package for shared test infrastructure
- **Structure:** Nested describe blocks by feature
- **File naming:** Flexible — just end in appropriate .test.ts suffix

### Fixture Design
- **Pattern:** Factory functions with default merging — createTestIssue({ title: 'X' })
- **IDs:** Deterministic by default (test_issue_1) for predictable assertions
- **Domain objects:** Credentials (Linear, GitHub, Slack) and Issues/PRs factories
- **Mocks:** Core mock implementations — MockLogger, MockCredentialStore
- **Location:** All in @aesir/test-utils package
- **Composition:** related() helper for nested objects — createTestIssue({ assignee: createTestUser() })
- **Seeding:** seedTestDatabase() utility for integration tests
- **Validation:** No schema validation — TypeScript catches type issues

### Integration Test Approach
- **Testcontainers:** PostgreSQL, Temporal, LocalStack
- **Isolation:** Transaction rollback for fast cleanup between tests
- **Container sharing:** Per test suite (describe block) — starts once, transactions isolate
- **Startup time:** Accept overhead — integration tests are slower by nature
- **Migrations:** Run automatically in beforeAll
- **Async utilities:** Use Vitest built-ins (vi.waitFor, expect().resolves), create helpers only if needed
- **HTTP mocking:** MSW (Mock Service Worker) for external API mocking
- **Environment:** Testcontainers only — no local service detection

### Claude's Discretion
- Exact testcontainer versions and configuration
- MSW handler organization
- Specific factory implementation details
- Test timeout values

</decisions>

<specifics>
## Specific Ideas

- Sandbox/Docker tests are the slowest — explicitly excluded from test:fast
- Integration tests should feel fast despite containers (transaction rollback key)
- Factory pattern like other codebases — simple defaults, easy overrides

</specifics>

<deferred>
## Deferred Ideas

- CI/CD coverage enforcement — Phase 21
- Coverage trend tracking (Codecov) — Phase 21
- E2E browser tests — separate phase if needed

</deferred>

---

*Phase: 20-testing-pyramid*
*Context gathered: 2026-01-23*
