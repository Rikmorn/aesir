# Phase 15: Code Quality - Context

**Gathered:** 2026-01-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Establish consistent error handling, validation, and type safety patterns across the codebase. Service boundaries return Result types, external inputs validated with Zod, packages export via index.ts, errors extend AppError base class, no dead code.

**Scope change:** Branded types removed from success criteria — named params + runtime checks achieve the same goal more simply.

</domain>

<decisions>
## Implementation Decisions

### Error Handling Style

- **Never throw from service boundaries** — use neverthrow Result types
- External libraries that throw: wrap with Result at integration points (research wrapping patterns)
- Error codes format: `LAYER_COMPONENT_ERROR` (e.g., `INT_LINEAR_RATE_LIMIT`, `PLT_DB_CONNECTION`)
- Errors carry cause chain + metadata context object (relevant IDs, values)
- HTTP mapping: error code → HTTP status (e.g., `*_RATE_LIMIT` → 429, `*_NOT_FOUND` → 404, `*_VALIDATION` → 400)

### Error Hierarchy

- `AppError` base class lives in `common` package
- Domain-specific subclasses in their packages (e.g., `LinearError` in integrations)
- `toAppError(err, code, context)` utility for wrapping unknown errors
- Validation errors aggregate all failures (return list, not fail-fast)

### Result Type Usage

- Use neverthrow library (`Result<T, E>`, `ResultAsync`)
- Async style: Claude's discretion (ResultAsync vs Promise<Result> — both acceptable)
- Boundaries only: public service functions return Result, internal helpers can throw
- Service boundary = external touchpoints (HTTP, webhooks, integration APIs) + cross-package calls
- Log at wrap point when converting external errors to AppError
- **Migration:** Establish patterns AND migrate existing boundaries in this phase

### ID Parameter Style

- **No branded types** — premature optimization for rare confusion
- Use named params (object destructuring) at service boundaries to prevent positional confusion
- Convention, not lint enforcement
- Suffix ID fields with `Id`: `linearIssueId`, `githubPrId`, `slackThreadId`
- **Migrate existing:** refactor functions with multiple ID positional params to named objects

### Barrel Export Strategy

- Public API only via index.ts — internal modules stay private
- Deep imports allowed but discouraged (no technical block via exports field)
- Separate `export type { }` from `export { }` for clarity
- `_internal/` directories for private modules (visual signal, never in index.ts)
- **Full audit:** review existing index.ts files, trim unnecessary exports, move internals

### Dead Code Removal

- Detection tool: ts-prune (TypeScript-aware unused export finder)
- Full cleanup: unreferenced exports + orphan files + unused npm dependencies
- @deprecated code: remove if unused, keep if still referenced
- Test code (*.test.ts, testing/) excluded from analysis
- _legacy/ directory handled as separate task (not this phase)
- Manual runs only — no CI gate
- Git history is recovery mechanism — no separate deletion tracking

### Claude's Discretion

- Recovery hints in error interface (isRecoverable flag + hint)
- ResultAsync vs Promise<Result> async style
- Specific wrapping patterns for external libraries (research during planning)

</decisions>

<specifics>
## Specific Ideas

- "Ideally never throw" — Result types at all boundaries, wrap libraries that throw
- Error logging: "Log at wrap point + rethrow" — capture full context when wrapping
- ResultAsync shown as cleaner for chaining, but "easy enough to wrap/unwrap" — flexibility over dogma

</specifics>

<deferred>
## Deferred Ideas

- **Rate limiting patterns** — how rate limit errors propagate and trigger retries (productionalization milestone)
- **Partial failure patterns** — batch operations with mixed success/failure (productionalization milestone)
- **_legacy/ directory review** — phase-1.test.ts and old index.ts (separate task, already tracked in STATE.md)
- **Dead code CI gate** — add ts-prune to CI pipeline (Phase 21: CI/CD Pipeline)

</deferred>

---

*Phase: 15-code-quality*
*Context gathered: 2026-01-21*
