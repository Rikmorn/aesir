# Phase 11: Monorepo Setup - Context

**Gathered:** 2026-01-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Restructure codebase from single npm package to pnpm workspace with clear package boundaries. Four packages: `@aesir/common`, `@aesir/platform`, `@aesir/integrations`, `@aesir/agents`. Each deployable independently via Docker. TypeScript project references enforce layer dependencies.

</domain>

<decisions>
## Implementation Decisions

### Package Structure

- **Four packages:** common, platform, integrations, agents
- **common/** — shared contracts, config loading, utilities, validation helpers (library only, no entry point)
- **platform/** — deployable with its own lifecycle, no dependencies on other packages except common
- **integrations/** — single package for now with subdirectories (linear/, github/, slack/), extracted to separate packages in Phases 16-18
- **agents/** — single package with subdirectories (dev-agent/, product-agent/)
- **_legacy/** — temporary folder for orphan code that doesn't fit cleanly; clean up in later phases

### Import & Type Boundaries

- **TypeScript project references** enforce layer rules at compile time (no Biome/ESLint rules needed)
- **Integration-owned types** stay with their integration (Linear types in integrations/linear/), importable by agents
- **Common types** are contracts between layers that both sides must follow
- **Barrel exports preferred** via index.ts, but deep imports allowed when pragmatic

### Package Identity

- **Scope:** `@aesir/*` (e.g., @aesir/platform, @aesir/common)
- **Internal deps:** `workspace:*` protocol in package.json
- **Versions:** lockstep at 0.1.0, all packages marked private
- **Manual version bumps** — no changesets or tooling for now
- **No changelog** — git history sufficient

### Test Organization

- **Unit tests:** co-located with source (`*.test.ts` next to `*.ts`)
- **Integration tests:** per-package `tests/integration/` directory
- **E2E tests:** root-level `tests/e2e/` for cross-package flows

### Migration Approach

- **Big bang** — convert everything in one phase
- **Keep src_old/** as reference until Phase 12 completes
- **Manual import updates** — no automated tooling
- **Fresh pnpm install** — delete npm lockfile, start clean
- **Pre-commit hooks disabled** during migration, re-enable after
- **Minimal Docker updates** — just enough to run, polish in Phase 22

### Build & Dev Workflow

- **pnpm only** — no Turborepo yet, add if build times become painful
- **Root scripts for common commands** (build, test, lint)
- **Per-package scripts** via `pnpm --filter @aesir/X` for specialized operations
- **TypeScript composite project references** for incremental builds
- **Per-package dist/** output directories (standard monorepo pattern)
- **No watch mode** — editor provides feedback, typecheck on demand
- **Biome config at root** — single source of truth for linting/formatting

### Verification Bar

Phase complete when:
1. `pnpm install` succeeds
2. `pnpm build` compiles all packages
3. `pnpm typecheck` passes
4. `pnpm test` passes
5. Services start via Docker

### Claude's Discretion

- Handling peer dependency conflicts during pnpm install
- Exact folder structure within packages
- Which files go to _legacy/ vs proper placement
- tsconfig inheritance structure

</decisions>

<specifics>
## Specific Ideas

- Platform is a deployable with its own lifecycle, not a dumping ground for shared code
- common/ holds what's truly common — contracts, config, utilities that any layer needs
- Keep the philosophy: integration-owned types stay with integrations, cross-layer contracts in common

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 11-monorepo-setup*
*Context gathered: 2026-01-20*
