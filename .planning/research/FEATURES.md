# Feature Landscape: TypeScript Agentic Platform Foundation

**Domain:** Internal agentic development platform (TypeScript/Node.js)
**Researched:** 2026-01-19
**Overall Confidence:** HIGH (established patterns, mature tooling)
**Context:** v2.0 Foundation milestone - platform architecture features, not product features

---

## Table Stakes

Features developers expect in a professional TypeScript codebase. Missing = codebase feels amateur or unmaintainable.

### Code Quality Features

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Strict TypeScript Configuration** | Catches bugs at compile time, modern standard | Low | Already have `strict: true`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` |
| **Consistent Error Handling Pattern** | Predictable behavior, debuggable failures | Medium | Current: mixed throw/return patterns. Need unified approach across codebase |
| **Input Validation at Boundaries** | Prevents invalid data from propagating | Low | Already using Zod, extend to all external boundaries (webhooks, env vars, API responses) |
| **Linting and Formatting** | Consistent code style, catch common mistakes | Low | Biome planned - correct choice for 2025+ (20x faster than ESLint+Prettier) |
| **Pre-commit Hooks** | Prevent bad code from entering repo | Low | Husky + lint-staged or Biome's native git hooks |
| **Centralized Logging** | Debuggable in production, trace correlation | Low | Have custom logger, plan to replace with pino - correct choice |
| **Type-safe Configuration** | No runtime crashes from missing env vars | Low | Use Zod schemas for all env vars, fail fast on startup |
| **Module Index Files** | Clean public APIs, encapsulation | Low | Inconsistent currently - each module should export from index.ts |

### Testing Features

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Unit Test Coverage** | Regression prevention, refactoring confidence | Medium | Have Vitest, need coverage targets (aim: 70%+ for core modules) |
| **Test Fixtures/Factories** | Reduce test boilerplate, consistent test data | Low | Have MockLLM, need factories for domain objects |
| **Mock/Stub Patterns** | Isolate units, test edge cases | Low | Using vi.mock, need consistent patterns across codebase |
| **Integration Test Suite** | Verify component interactions | Medium | Have some (phase-1.test.ts), need systematic coverage |
| **Test Organization** | Findable tests, clear naming | Low | Co-located .test.ts files - good pattern, maintain it |
| **CI Test Execution** | Tests run on every PR | Low | GitHub Actions required |

### Developer Experience Features

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **One-Command Local Dev** | Fast onboarding, reproducible environment | Medium | Docker Compose exists, needs simplification and hot reload |
| **Hot Reload in Development** | Fast iteration, don't restart on every change | Medium | tsx watch for non-containerized, volume mounts for Docker |
| **IDE Integration** | Autocomplete, go-to-definition, refactoring | Low | TypeScript handles this, ensure tsconfig is correct |
| **Clear Error Messages** | Developers understand what went wrong | Medium | Requires consistent error types with context |
| **Debug Configuration** | Attach debugger to running code | Low | VS Code launch.json, Docker debug port exposure |

### Infrastructure Features

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Environment Separation** | Don't run prod code against dev data | Medium | dotenv-flow for local/staging/production hierarchy |
| **Secrets Not in Code** | Security baseline | Low | .env files (gitignored), environment injection in Docker |
| **Health Check Endpoints** | Know if services are running | Low | HTTP /health endpoint per service |
| **Graceful Shutdown** | Don't lose work when stopping | Medium | Handle SIGTERM, drain connections, complete in-flight work |
| **Container Optimization** | Reasonable image sizes, fast builds | Medium | Multi-stage Dockerfile, .dockerignore |

---

## Differentiators

Features that make development significantly better. Not expected, but valued highly by the team.

### Error Handling Patterns

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Result Types (neverthrow)** | Compile-time error handling, explicit failure paths | Medium | Replaces throw/catch with explicit `Result<T, E>` returns. Forces handling errors at call site. Excellent for service boundaries. |
| **Typed Error Hierarchy** | Distinguish error categories (validation, network, domain) | Low | Custom error classes extending base AppError with error codes |
| **Error Context Preservation** | Stack traces + business context through call chain | Medium | Wrap errors with context as they propagate up |
| **eslint-plugin-neverthrow** | Enforce Result handling in CI | Low | Catches missed error handling at lint time |

**Recommendation:** Use neverthrow at service boundaries (integrations layer, agent-platform communication). Use traditional try/catch within tightly-scoped functions. Don't go full Effect.ts - too much paradigm shift for the benefit.

### Type Safety Improvements

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Branded Types for IDs** | Prevent mixing LinearIssueId with GitHubPRId | Low | Zod `.brand()` or manual branding. Type-level safety, zero runtime cost. |
| **Validation at Edges** | Guarantee data shape after boundary crossing | Low | Zod parse at API handlers, webhook receivers, config loading |
| **Strict Null Checks** | Already enabled | - | `strictNullChecks` included in `strict: true` |
| **Discriminated Unions for State** | Exhaustive handling of state machine transitions | Medium | Agent state, workflow status as tagged unions |

**Recommendation:** Implement branded types for all cross-service IDs (taskId, prId, threadId). Use Zod `.brand()` for seamless validation-to-branding.

### Module Boundary Patterns

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Dependency Injection** | Testability, swappable implementations | Medium | Constructor injection sufficient for this scale. TSyringe if needed later. |
| **Interface Segregation** | Modules depend on interfaces, not implementations | Medium | Define contracts in shared types, implement in modules |
| **Layer Enforcement** | Prevent accidental cross-layer imports | Medium | fresh-onion library or custom ESLint rule |
| **Public API Index Files** | Clear module boundaries | Low | Each module exports only what's intended via index.ts |

**Recommendation:** Start with manual discipline + code review. Add fresh-onion if violations become common. TSyringe is overkill for current codebase size.

### Local Development Excellence

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Docker Hot Reload** | Edit code, see changes in container immediately | Medium | Volume mounts + nodemon/tsx in container |
| **Selective Service Startup** | Don't start what you're not working on | Low | Docker Compose profiles already in use |
| **Local-First Development** | Most work doesn't need tunnels or external services | Medium | Mock modes for Linear/GitHub/Slack |
| **Database Seeding** | Consistent test data for local dev | Low | Seed scripts for PostgreSQL |
| **Service Health Dashboard** | See all services status at a glance | Low | Simple CLI script or web UI showing container states |

### Testing Excellence

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Contract Testing** | Verify integration contracts without full E2E | Medium | Pact or similar for agent-integration boundaries |
| **Fixture Generators** | Generate realistic test data programmatically | Low | Efate or custom factories |
| **Test Database Isolation** | Each test gets clean database state | Medium | Transaction rollback or database-per-test |
| **Parallel Test Execution** | Faster CI feedback | Low | Vitest supports parallel by default |
| **Visual Test Reports** | Easy to see what failed and why | Low | Vitest UI, coverage HTML reports |

### CI/CD Excellence

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Dependency Caching** | 50-70% faster CI runs | Low | GitHub Actions cache for node_modules |
| **Parallel Job Execution** | Faster CI feedback | Low | Matrix builds, separate lint/test/build jobs |
| **Quality Gates** | PRs blocked until quality bar met | Low | Required status checks in GitHub |
| **Staged Deployment** | Automatic staging deploy on merge to main | Medium | GitHub Actions + deployment target |
| **Rollback Capability** | Quick recovery from bad deploys | Medium | Keep previous container images tagged |

### Observability Excellence

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Structured Logging with pino** | Fast, queryable logs | Low | Planned - correct choice. 5x faster than alternatives. |
| **OpenTelemetry Integration** | Distributed tracing across services | Medium | @opentelemetry/instrumentation-pino for trace correlation |
| **Trace Context Propagation** | Follow requests across service boundaries | Medium | Propagate traceparent headers in webhooks/API calls |
| **Request Correlation IDs** | Link all logs for a single request | Low | Generate ID at entry point, pass through call chain |
| **Service Metrics** | Latency, throughput, error rates | Medium | OpenTelemetry metrics or simple counters |

---

## Anti-Features

Features to explicitly NOT build. Common mistakes in this domain that create problems.

### Over-Engineering Traps

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Full Effect.ts Adoption** | Massive paradigm shift, steep learning curve, overkill for team size | Use neverthrow for explicit error handling - 80% of benefit, 20% of complexity |
| **InversifyJS/TSyringe Everywhere** | Adds ceremony, hides dependencies, over-complicates small codebase | Constructor injection with defaults. DI container only if explicit need emerges. |
| **Microservices Decomposition** | Current code is already service-oriented via Docker. Further splitting adds operational complexity. | Keep logical services in single repo. Separate processes, shared codebase. |
| **GraphQL for Internal Communication** | Overkill for agent-integration calls. REST is simpler and sufficient. | REST with typed clients (generated from OpenAPI if needed) |
| **Event Sourcing** | Complex, rarely needed. Current state-based approach is fine. | Simple PostgreSQL state tables. Event sourcing only if audit requirements demand it. |

### Testing Anti-Patterns

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **100% Code Coverage Target** | Leads to meaningless tests, maintenance burden | Target 70-80% on core logic. 0% is fine for wiring code. |
| **E2E Tests for Everything** | Slow, flaky, expensive to maintain | Testing pyramid: many unit, some integration, few E2E |
| **Mocking Everything** | Tests become tautological, don't catch real bugs | Mock only slow/external things. Test real implementations where practical. |
| **Testing Private Methods** | Implementation coupling, fragile tests | Test through public interface. Refactor if private method is complex enough to need direct tests. |
| **Snapshot Testing for Logic** | Brittle, hard to review changes | Snapshots only for serialized output (API responses). Explicit assertions for logic. |

### Architecture Anti-Patterns

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Shared Mutable State** | Race conditions, unpredictable behavior | Pass state explicitly. Immutable data structures where practical. |
| **Circular Dependencies** | Build failures, confusing call graphs | Strict layer dependencies. Extract shared types to separate module. |
| **God Modules** | Hard to understand, hard to test | Single responsibility. Split when module exceeds ~500 lines. |
| **Premature Abstraction** | Abstractions that don't fit actual use cases | Wait until you have 3 concrete cases before abstracting. |
| **Configuration Scattered in Code** | Hard to change, inconsistent behavior | All config loaded at startup, validated, passed explicitly. |

### Observability Anti-Patterns

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Logging Everything** | Noise drowns signal, performance impact, storage cost | Log at boundaries: entry, exit, errors. Debug level for details. |
| **console.log in Production** | Unstructured, no correlation, blocks event loop | pino with structured JSON output |
| **Tracing Every Function** | Performance overhead, unreadable traces | Trace at service boundaries and key operations only |
| **Alerts on Every Error** | Alert fatigue, ignored alerts | Error budgets. Alert on sustained error rates, not individual errors. |

### Developer Experience Anti-Patterns

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Required Tunnel for All Dev** | Slow, fragile, unnecessary for most work | Local-first. Tunnel only for webhook testing. |
| **Manual Environment Setup** | Onboarding friction, "works on my machine" | Docker Compose for everything. Document the single command. |
| **Multiple Package Managers** | Dependency confusion, lock file conflicts | npm only (per PROJECT.md - remove yarn.lock) |
| **Untyped Configuration** | Runtime crashes from typos in env vars | Zod schema for all env vars, validated at startup |

---

## Feature Dependencies

```
                    Strict TypeScript Config
                            |
                            v
        +-------------------+-------------------+
        |                   |                   |
        v                   v                   v
   Branded Types      Result Types        Zod Validation
        |                   |                   |
        +-------------------+-------------------+
                            |
                            v
                    Module Boundaries
                            |
            +---------------+---------------+
            |               |               |
            v               v               v
      Platform Layer  Integrations    Agents Layer
            |               |               |
            +---------------+---------------+
                            |
                            v
                    Testing Pyramid
                            |
            +---------------+---------------+
            |               |               |
            v               v               v
       Unit Tests    Integration      E2E Tests
                       Tests
                            |
                            v
                      CI/CD Pipeline
                            |
            +---------------+---------------+
            |               |               |
            v               v               v
      Quality Gates     Caching      Deployment
```

### Critical Path Dependencies

1. **Strict TypeScript** must be maintained first - it's the foundation
2. **Error handling pattern** must be decided before module boundaries
3. **Module boundaries** must be defined before testing strategy
4. **Testing patterns** must be established before CI/CD quality gates

---

## MVP Definition (v2.0 Foundation)

For v2.0 Foundation milestone, prioritize in this order:

### Phase 1: Tooling Baseline
1. **Biome setup** - Replace ESLint/Prettier (table stakes, low complexity)
2. **npm standardization** - Remove yarn.lock (table stakes, low complexity)
3. **Pre-commit hooks** - Prevent bad commits (table stakes, low complexity)
4. **dotenv-flow** - Environment hierarchy (table stakes, low complexity)

### Phase 2: Error Handling & Validation
5. **neverthrow adoption** - At service boundaries (differentiator, medium complexity)
6. **Branded types** - For cross-service IDs (differentiator, low complexity)
7. **Zod validation** - At all external boundaries (table stakes, low complexity)
8. **Typed error hierarchy** - Consistent error structure (differentiator, low complexity)

### Phase 3: Module Architecture
9. **Layer structure** - Platform/Integrations/Agents (table stakes, medium complexity)
10. **Index file discipline** - Public APIs only (table stakes, low complexity)
11. **Dependency direction** - Inner layers don't know outer (table stakes, medium complexity)

### Phase 4: Testing Foundation
12. **Test fixtures/factories** - For domain objects (differentiator, low complexity)
13. **Coverage reporting** - Know what's tested (table stakes, low complexity)
14. **Integration test patterns** - Systematic coverage (table stakes, medium complexity)

### Phase 5: CI/CD Pipeline
15. **GitHub Actions setup** - Run tests on PR (table stakes, low complexity)
16. **Dependency caching** - Fast CI (differentiator, low complexity)
17. **Quality gates** - Block bad PRs (table stakes, low complexity)

### Phase 6: Observability
18. **pino integration** - Replace custom logger (table stakes, low complexity)
19. **OpenTelemetry basics** - Trace correlation (differentiator, medium complexity)
20. **Request correlation IDs** - Link logs (differentiator, low complexity)

### Phase 7: Local Dev Excellence
21. **Docker hot reload** - Fast iteration (differentiator, medium complexity)
22. **Health check endpoints** - Service status (table stakes, low complexity)
23. **Documentation update** - .claude files reflect architecture (table stakes, low complexity)

### Defer to Post-v2.0
- Contract testing (wait for clear integration contracts)
- Full OpenTelemetry with metrics (wait for observability needs to clarify)
- Event-driven communication research (defer to architecture research)
- Production deployment automation (staging first)

---

## Sources

### Error Handling
- [neverthrow GitHub](https://github.com/supermacro/neverthrow) - Result type implementation
- [Neverthrow Composition Patterns](https://deepwiki.com/supermacro/neverthrow/4.2-composition-patterns)
- [Error Handling Comparison](https://devalade.me/blog/error-handling-in-typescript-neverthrow-try-catch-and-alternative-like-effec-ts.mdx)
- [TypeScript Error Handling 2025](https://www.thecandidstartup.org/2025/04/14/typescript-error-handling.html)

### Type Safety
- [Zod API Documentation](https://zod.dev/api)
- [Type Branding with Zod](https://stevekinney.com/courses/full-stack-typescript/type-branding-with-zod)
- [Branded Types Guide](https://medium.com/@jmytwenty8/stop-treating-all-ids-as-strings-a-guide-to-branded-types-with-zod-beddabd9a065)
- [Type Branding Techniques](https://dev.to/saleor/branded-types-in-typescript-techniques-340f)

### Module Boundaries & DI
- [TSyringe and InversifyJS Comparison](https://leapcell.io/blog/dependency-injection-beyond-nestjs-a-deep-dive-into-tsyringe-and-inversifyjs)
- [TSyringe GitHub](https://github.com/microsoft/tsyringe)
- [DI Best Practices](https://blog.logrocket.com/top-five-typescript-dependency-injection-containers/)

### Testing
- [Vitest Test Context](https://vitest.dev/guide/test-context)
- [Testing Pyramid Guide 2025](https://fullscale.io/blog/modern-test-pyramid-guide/)
- [E2E Testing Best Practices 2025](https://www.bunnyshell.com/blog/best-practices-for-end-to-end-testing-in-2025/)
- [Integration vs E2E Testing](https://dev.to/michael_burry_00/integration-vs-e2e-system-testing-a-practical-testing-pyramid-playbook-with-real-ci-pipelines-1del)

### CI/CD
- [GitHub Actions Cache](https://github.com/actions/cache)
- [CI/CD Quality Gates Guide](https://www.propelcode.ai/blog/continuous-integration-code-quality-gates-setup-guide)
- [CI Optimization Case Study](https://www.techbuddies.io/2025/12/17/case-study-how-we-optimized-ci-cd-pipelines-in-github-actions-and-gitlab-ci/)

### Observability
- [Pino + OpenTelemetry Integration](https://dzone.com/articles/observability-nodejs-opentelemetry-pino)
- [Pino Logger Guide 2026](https://signoz.io/guides/pino-logger/)
- [@opentelemetry/instrumentation-pino](https://www.npmjs.com/package/@opentelemetry/instrumentation-pino)
- [Production Logging with Pino](https://www.dash0.com/guides/logging-in-node-js-with-pino)

### Tooling
- [Biome vs ESLint 2025](https://medium.com/@harryespant/biome-vs-eslint-the-ultimate-2025-showdown-for-javascript-developers-speed-features-and-3e5130be4a3c)
- [Biome Migration Guide](https://biomejs.dev/guides/migrate-eslint-prettier/)
- [dotenv-flow GitHub](https://github.com/kerimdzhanov/dotenv-flow)

### Architecture
- [Clean Architecture with TypeScript](https://medium.com/@deivisonisidoro_94304/revolutionizing-software-development-unveiling-the-power-of-clean-architecture-with-typescript-5ee968357d35)
- [fresh-onion Layer Enforcement](https://dev.to/remojansen/enforce-clean-architecture-in-your-typescript-projects-with-fresh-onion-45pi)
- [LangGraph.js for Agents](https://medium.com/@iamanraghuvanshi/agentic-ai-3-top-ai-agent-frameworks-in-2025-langchain-autogen-crewai-beyond-2fc3388e7dec)

### Local Development
- [Docker + TypeScript Hot Reload](https://dev.to/dariansampare/setting-up-docker-typescript-node-hot-reloading-code-changes-in-a-running-container-2b2f)
- [Full Stack Live Reload](https://blog.logrocket.com/complete-guide-full-stack-live-reload/)

---

*Feature research for v2.0 Foundation - TypeScript Platform Architecture*
*Researched: 2026-01-19*
