# Phase 16: Linear Extraction - Context

**Gathered:** 2026-01-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Extract Linear integration from `packages/integrations/src/linear/` into an independent package `@aesir/integration-linear` at `packages/integrations/linear/`. The extracted package is a fully self-contained service with its own database schema, OAuth flow, webhook handlers, and HTTP entry point. Does NOT include MCP server (Phase 19) or abstraction interfaces (deferred).

</domain>

<decisions>
## Implementation Decisions

### Package structure
- Package name: `@aesir/integration-linear`
- Location: `packages/integrations/linear/` (nested under integrations directory)
- Internal organization: By function (`src/oauth/`, `src/webhooks/`, `src/api/`, `src/types/`, `src/db/`)
- Documentation: Full README.md with usage examples, API docs, configuration (treat as publishable)
- TypeScript: Extends root `tsconfig.base.json`
- Testing: Own `vitest.config.ts` that extends workspace config (matches current monorepo pattern)
- Linting: Uses root `biome.json` (no package-specific config)
- Entry point: `src/main.ts` that starts Express server (required for containerization)
- Dockerfile: Own Dockerfile in package directory for independent deployment
- Version: Start at `1.0.0` (independent versioning)
- No CHANGELOG.md (git history sufficient)
- No CLI bin entry (services run via Docker, not npx)
- Scripts: Standard npm scripts (build, test, lint, typecheck) for `pnpm --filter` usage
- Health endpoints: Defer to Phase 22

### Configuration
- Own env schema: Linear package defines and validates its own `LINEAR_*` env vars
- Self-contained for deployment (own `.env` requirements)

### Types approach
- Split approach: Linear SDK types stay in Linear package, shared domain types in common
- Linear-specific types (`LinearIssue`, `LinearWebhook`) defined in Linear package
- Zod schemas for webhooks/API responses move to Linear package

### Boundary decisions
- **Dependencies**: Only `@aesir/common` (no platform import in code)
- **Database**: Linear owns its schema entirely (`linear.credentials`, `linear.sync_cursors`)
  - Each integration will have separate credential tables (not shared `integrations.credentials`)
- **CredentialStore**: Interface stays in platform; Linear implements/uses it
- **Webhook validation**: Linear owns signature verification, payload parsing, route handling
- **Linear SDK wrapper**: Keep the wrapper (adds logging, error handling)
- **Errors**: `LinearError` moves to Linear package, extends `AppError` from common
- **Agent tools**: Linear API functions (issue lookup, comment posting) move to Linear package
  - MCP wrapping deferred to Phase 19
- **Temporal activities**: Stay in agents package (integrations stay simple/dumb)
  - Integrations provide internal API, agents/orchestrators wire to Temporal
- **OAuth**: Linear owns its full OAuth flow
  - Tiny shared utilities (state generation) can be in common
  - OAuth flow logic is per-integration (flows differ significantly across providers)
- **Token refresh**: Not needed (Linear tokens are ~10 years)
- **Abstraction**: Defer — extract Linear as-is, abstract when second provider is added
- **Tests**: Move with code to Linear package
- **Mock factories**: Include in package (can exclude from production builds if needed)
- **Logging**: Import `createPinoLogger` from `@aesir/common`
- **HTTP routes**: Move to Linear package (webhook handlers, OAuth callbacks)

### Export design
- Single barrel `index.ts` with explicit exports (matches Phase 15 pattern)
- Section headers with `=== SECTION ===` markers
- Own types only — don't re-export `@linear/sdk` types
- Internal utilities kept private
- Factories only — export `createLinearClient()`, not pre-configured instances
- ESM only (no dual CJS/ESM exports)
- Type exports bundled with main export

### HTTP framework
- Express (current codebase uses it)
- Research alternatives during planning (excluding Fastify)

### Migration path
- **Approach**: Gradual within Phase 16 (multiple plans with checkpoints)
- **Backward compat**: Clean break — update all imports in one go (dev project)
- **Data migration**: Include in Phase 16 — create `linear.*` schema, migrate existing data
- **Migration script**: Adapt existing `migrate-tokens.ts` to target new schema
- **AI docs**: Update CLAUDE.md and cursor files to reflect new structure
- **Verification**: End of phase verifies Linear service starts and handles a webhook
- **Cleanup**: Keep old `packages/integrations/src/linear/` as `_legacy/linear` for reference
- **Shared utils**: Move to common in separate plan BEFORE extraction
- **Workspace**: Add `packages/integrations/*` pattern to pnpm-workspace.yaml

### Claude's Discretion
- TypeScript declaration maps (dev experience vs build size tradeoff)
- Exact Express middleware setup
- Internal folder structure details beyond specified categories
- HTTP framework alternatives research and recommendation

</decisions>

<specifics>
## Specific Ideas

- Platform = shared infrastructure + any separate API services built to support layers above (important architectural clarification to note in PROJECT.md)
- Integrations are simple, dumb adapters with common contracts — agent wants "post comment", integration provides that regardless of backend (Linear, Jira, etc.)
- Each integration owns its data completely — enables simpler containerization and deployment
- Docker-first mindset: services should "just work" with `docker compose up`

</specifics>

<deferred>
## Deferred Ideas

- MCP server for Linear tools — Phase 19
- IssueTracker abstraction interface — When second provider added
- Health check endpoints — Phase 22
- Agent-to-agent coordination implementation — Future milestone
- Jira/alternative issue tracker support — Future milestone

</deferred>

---

*Phase: 16-linear-extraction*
*Context gathered: 2026-01-21*
