# v2.0 Foundation Research Summary

**Project:** Aesir - Agentic Development Platform
**Domain:** TypeScript Agentic Platform / Internal Tooling
**Researched:** 2026-01-19
**Confidence:** HIGH

## Executive Summary

The v2.0 Foundation milestone restructures Aesir from a "prove it works" prototype to a maintainable, scalable 3-layer platform: Platform, Integrations, and Agents. Research confirms this layered approach is the industry standard for agentic systems, with MCP (Model Context Protocol) emerging as the dominant pattern for agent-integration communication. The key architectural decision is **hybrid communication: MCP for LLM-initiated tool calls, direct TypeScript interfaces for non-LLM service communication**.

The recommended tooling stack prioritizes speed and simplicity: **Biome** (10-25x faster than ESLint+Prettier), **pino** (5x faster than Winston), and **dotenv-flow** for multi-environment configuration. Testing should follow a proper pyramid with **Vitest** (already in use) and **testcontainers** for integration tests. The biggest migration risk is attempting a big-bang restructure - research strongly recommends incremental migration with each PR being deployable.

Critical pitfalls to address early: (1) environment variable drift and missing validation causing runtime failures, (2) leaky abstractions between layers defeating the purpose of separation, (3) test isolation failures causing flaky CI, and (4) Temporal workflow non-determinism breaking replays. The v1 codebase already exhibits some of these issues, validating the need for this foundation work.

## Key Findings

### Recommended Stack

The stack builds on existing choices (TypeScript, Vitest, Temporal) while replacing hand-rolled utilities with production-grade alternatives.

| Category | Technology | Version | Why |
|----------|------------|---------|-----|
| Linting/Formatting | **Biome** | ^2.0.0 | 10-25x faster than ESLint+Prettier, single binary, 425 rules |
| Logging | **pino** | ^10.2.0 | 5-10x faster than alternatives, JSON-native, redaction, child loggers |
| Environment Config | **dotenv-flow** | ^4.1.0 | Multi-env support (.env.development, .env.test, .env.production) |
| Agent Communication | **MCP SDK** | ^1.x | Industry standard (OpenAI, Anthropic, Google), 97M+ monthly downloads |
| Dependency Injection | **tsyringe** | ^4.8.0 | Microsoft-maintained, lightweight, decorator-based |
| Integration Testing | **testcontainers** | ^11.11.0 | Isolated PostgreSQL/Docker containers per test |
| Runtime | **Node.js** | >=22.0.0 | LTS, better ESM support |

**Do NOT use:** ESLint+Prettier (slower), Winston (slower), plain dotenv (no multi-env), InversifyJS (too heavy), MCP v2 SDK (pre-alpha).

### Expected Features (Foundation Focus)

**Table stakes (must have):**
- Strict TypeScript configuration (already have, maintain)
- Consistent error handling pattern at service boundaries
- Input validation at all external boundaries (Zod)
- Linting and formatting (Biome)
- Centralized logging (pino replacing custom logger)
- Type-safe configuration with startup validation
- Module index files for public APIs
- CI test execution with quality gates

**Differentiators (should have):**
- Result types (neverthrow) at service boundaries for explicit error handling
- Branded types for cross-service IDs (LinearIssueId, GitHubPRId)
- OpenTelemetry integration for trace correlation
- Docker hot reload for fast local iteration
- Dependency caching in CI (50-70% faster)

**Defer to post-v2.0:**
- Full OpenTelemetry with metrics
- Contract testing (Pact)
- Production deployment automation
- Event-driven architecture research

### Architecture Approach

The architecture follows a 3-layer monorepo pattern with pnpm workspaces:

```
packages/
  platform/       # Event gateway, Temporal, PostgreSQL, config, observability
  integrations/
    linear/       # Independent package with MCP server + direct API
    github/       # Independent package with MCP server + direct API
    slack/        # Independent package with MCP server + direct API
    shared/       # Common integration utilities
  agents/         # Product Agent, Dev Agent, shared agent utilities
  sandbox/        # Code execution sandbox
apps/
  api/            # HTTP server entry point
  worker/         # Temporal worker entry point
```

**Key architecture decisions:**
1. **MCP for LLM tool calls** - Agents use MCP clients to invoke integration MCP servers
2. **Direct TypeScript imports for non-LLM calls** - Temporal activities use direct imports from integration packages
3. **Factory functions for clients** - No global singletons, dependency injection via factories
4. **Event-driven webhooks** - Gateway validates, deduplicates, routes to Temporal workflows
5. **LangGraph + Temporal hybrid** - LangGraph for agent reasoning, Temporal for durable orchestration

**Layer dependency rules:**
- Agents depend on Integrations (via MCP) and Platform
- Integrations depend only on Platform
- Platform depends on nothing internal (only external libs)

### Critical Pitfalls

**Top 7 pitfalls requiring early attention:**

| # | Pitfall | Prevention | Phase |
|---|---------|------------|-------|
| 1 | **Big Bang Migration** | Incremental migration, each PR deployable, parallel structure | Phase 1 |
| 2 | **Leaky Abstractions** | Domain types first, explicit mappers at boundaries, ESLint/TS project refs | Phase 2 |
| 3 | **Environment Variable Drift** | Single .env.example, Zod validation at startup, fail fast | Phase 1 |
| 4 | **Test Isolation Failures** | Transaction-per-test or testcontainers, no shared state | Phase 3 |
| 5 | **Temporal Non-Determinism** | All external calls through activities, use workflow.now() | Any Temporal phase |
| 6 | **CI That Doesn't Protect** | Branch protection enforced, fail fast, cache aggressively | Phase 4 |
| 7 | **Context Explosion in Agents** | Scoped context per agent, summarization between handoffs | Post-foundation |

**v1 lessons learned:**
- Linear auth shared with GitHub - need separate adapters per integration
- Painful E2E testing - need testcontainers + contract tests
- .env.local vs .env confusion - need Zod schema validation
- Hand-rolled utilities - need library audit before implementing

## Implications for Roadmap

Based on dependency analysis across all research files, suggested phase structure:

### Phase 1: Foundation Setup
**Rationale:** Everything else depends on tooling, config, and observability being solid.
**Delivers:** pnpm workspace structure, Biome, dotenv-flow, pino logger, base tsconfig
**Addresses:** Table stakes (linting, config, logging)
**Avoids:** Big Bang Migration (parallel structure), Environment Drift (config validation)
**Complexity:** Medium (new tooling, minimal code changes)

### Phase 2: Platform Layer
**Rationale:** Platform services (config, secrets, observability) are dependencies for all other layers.
**Delivers:** packages/platform with config loader, secrets provider, logger factory, tracing setup
**Implements:** Platform layer from architecture, observability cross-cutting concern
**Avoids:** Leaky Abstractions (define domain types here)
**Complexity:** Medium

### Phase 3: Integration Extraction
**Rationale:** Integrations must be independent packages before agents can use them properly.
**Delivers:** packages/integrations/{linear,github,slack} as independent packages
**Implements:** Integration layer, each with MCP server + direct API + activities
**Avoids:** Integration packages depending on each other
**Complexity:** High (most code movement)

### Phase 4: MCP Layer
**Rationale:** MCP servers build on extracted integrations; agents need MCP clients.
**Delivers:** MCP servers in each integration, shared MCP client utilities for agents
**Uses:** @modelcontextprotocol/server and client SDKs
**Avoids:** MCP for everything (use only for LLM tool calls)
**Complexity:** Medium

### Phase 5: Testing Pyramid
**Rationale:** Testing patterns must be established before CI can enforce quality gates.
**Delivers:** Unit test patterns, testcontainers for integration tests, coverage reporting
**Addresses:** Test isolation, coverage reporting, fixture factories
**Avoids:** Coverage Theater (behavior-focused tests), Test Isolation Failures
**Complexity:** Medium

### Phase 6: CI/CD Pipeline
**Rationale:** CI validates all previous work; must come after testing patterns established.
**Delivers:** GitHub Actions with lint -> typecheck -> test -> integration jobs, branch protection
**Implements:** Quality gates, dependency caching, parallel jobs
**Avoids:** CI That Doesn't Protect, Supply Chain attacks (pin actions to SHA)
**Complexity:** Low-Medium

### Phase 7: Local Dev Environment
**Rationale:** Developer experience improvements after core architecture is stable.
**Delivers:** Docker hot reload, health check endpoints, graceful shutdown, updated docs
**Addresses:** One-command local dev, Docker optimization
**Avoids:** Docker Image Bloat (multi-stage builds)
**Complexity:** Low-Medium

### Phase Ordering Rationale

1. **Tooling before code** - Biome/pino/dotenv-flow establish patterns used everywhere
2. **Platform before integrations** - Config/secrets/logging are dependencies
3. **Integrations before MCP** - MCP servers wrap existing integration logic
4. **Testing before CI** - CI enforces test patterns that must exist first
5. **CI before local dev polish** - Core quality gates more important than DX polish

### Research Flags

**Phases needing deeper research during planning:**
- **Phase 3 (Integration Extraction):** Complex code movement, need specific migration strategy per integration
- **Phase 4 (MCP Layer):** MCP transport for containers (stdio vs HTTP), security boundaries between agents

**Phases with standard patterns (skip research-phase):**
- **Phase 1 (Foundation Setup):** Biome, pino, dotenv-flow are well-documented
- **Phase 5 (Testing Pyramid):** testcontainers + Vitest patterns established
- **Phase 6 (CI/CD):** GitHub Actions patterns well-documented

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Official docs verified, 2025/2026 ecosystem data, clear recommendations |
| Features | HIGH | Established patterns, existing codebase context informs priorities |
| Architecture | HIGH | MCP is industry standard, LangGraph+Temporal pattern explicitly recommended by both teams |
| Pitfalls | HIGH | Real post-mortems (Replit), v1 project experience, official documentation |

**Overall confidence:** HIGH

### Gaps to Address

| Gap | How to Handle |
|-----|---------------|
| MCP transport for containers | Phase 4 planning: decide stdio (simple, single process) vs HTTP (container isolation) |
| Multi-tenant credentials | Defer to post-foundation; current single-tenant approach sufficient |
| Integration swapping mechanism | Defer; runtime registry vs build-time selection not needed for v2.0 |
| Agent tool subsets (security) | Defer; all tools available to all agents initially |

## Sources

### Primary (HIGH confidence)
- [Biome Official](https://biomejs.dev/) - v2.x, 425 rules, 35x faster than Prettier
- [Model Context Protocol](https://modelcontextprotocol.io/) - Spec v2025-11-25, TypeScript SDK
- [pino GitHub](https://github.com/pinojs/pino) - v10.2.1, 17.2k stars
- [Vitest](https://vitest.dev/) - v4.0.17
- [Temporal TypeScript Versioning](https://docs.temporal.io/develop/typescript/versioning)
- [testcontainers Node](https://node.testcontainers.org/) - v11.11.0
- [JavaScript Testing Best Practices](https://github.com/goldbergyoni/javascript-testing-best-practices)
- [Domain-Driven Hexagon](https://github.com/Sairyss/domain-driven-hexagon)

### Secondary (MEDIUM confidence)
- [Google Cloud Agentic AI Design Patterns](https://cloud.google.com/architecture/choose-design-pattern-agentic-ai-system)
- [Temporal for Agentic AI (Grid Dynamics)](https://temporal.io/blog/prototype-to-prod-ready-agentic-ai-grid-dynamics)
- [LangGraph 1.0 Announcement](https://www.blog.langchain.com/langchain-langgraph-1dot0/)
- [A Year of MCP: 2025 Review](https://www.pento.ai/blog/a-year-of-mcp-2025-review)
- [Veracode: AI Code Security Report](https://www.veracode.com/blog/genai-code-security-report/)
- [Galileo: Why Multi-Agent LLM Systems Fail](https://galileo.ai/blog/multi-agent-llm-systems-fail)

### Post-Mortems (HIGH confidence for pitfalls)
- [Replit AI Incident](https://codenotary.com/blog/when-ai-goes-rogue-the-replit-incident-and-its-lessons)
- [Cursor Issue #3327: Infinite Loop](https://github.com/cursor/cursor/issues/3327)
- [Compromised GitHub Action](https://www.infoq.com/news/2025/04/compromised-github-action/)

---
*Research completed: 2026-01-19*
*Ready for roadmap: yes*
