# Phase 10: Foundation Setup - Context

**Gathered:** 2026-01-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Standardized development tooling and ML configuration enabling consistent code quality and AI-assisted development. Delivers: Biome linting/formatting, npm standardization, dotenv-flow configuration, pre-commit hooks, and .claude/.cursor files for AI-assisted development.

</domain>

<decisions>
## Implementation Decisions

### Biome Strictness

- **Existing code handling:** Claude's discretion — pick based on violation count and fix safety
- **Formatting:** Use Biome's opinionated defaults; user will add .editorconfig for 2 spaces, 80 char lines, final newline — if Biome can enforce these, skip .editorconfig
- **Import organization:** Enable auto-sort IF no issues arise; if problems, leave to VS Code
- **TypeScript strictness:** Practical strict — ban `any` but allow non-null assertions where safe
- **Complexity rules:** Warn only (don't block commits on function length/nesting depth)
- **console.log:** Error in production code, allow in test files
- **Naming conventions:** Enforce — camelCase for variables, PascalCase for classes/types, UPPER_CASE for constants
- **Package scope:** Same config everywhere (root config applies to all packages uniformly)
- **IDE integration:** Format on save via .vscode/settings.json
- **File types:** Include all Biome-supported types (JS, TS, JSX, JSON, CSS)
- **Version updates:** Claude's discretion on pinning vs semver

### Env Var Handling

- **Validation timing:** Startup only — fail fast before any work begins
- **Error display:** List all missing vars at once so developer can fix them all
- **Example file:** Yes, documented .env.example with all vars, descriptions, and example values
- **Required vs optional:** Schema-based (Zod) marking required/optional with types
- **Secrets validation:** Presence only — don't validate format patterns
- **Environment structure:** Standard trio — .env.development, .env.test, .env.production based on NODE_ENV
- **Config access:** Typed config object (e.g., config.github.token, config.database.url)

### Pre-commit Scope

- **Check scope:** Lint + format + TypeScript type check (~10-15 seconds)
- **File scope:** Staged files only
- **Auto-fix:** Auto-fix and stage — Biome fixes issues and adds fixed files to commit automatically
- **Bypass:** Allow --no-verify — trust developers to use wisely

### AI Context Depth

- **.claude content:** Both comprehensive — architecture overview + coding patterns + examples
- **Pattern documentation:** Both marked — document existing patterns with notes on planned improvements
- **.claude organization:** Claude's discretion based on content volume
- **.cursor files:** Mirror .claude — same content, compatible format, one source of truth

### Claude's Discretion

- Existing code migration strategy (fix all upfront vs gradual)
- Biome version pinning strategy
- .claude directory structure (single file vs split by topic)
- Exact Biome rule selection within the "practical strict" philosophy

</decisions>

<specifics>
## Specific Ideas

- Biome formatting should feel like Prettier defaults — familiar to most JS/TS developers
- If Biome import sorting causes issues (it has historically), fall back to VS Code's organize imports
- Error messages for missing env vars should be actionable — tell developer exactly what to add

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 10-foundation-setup*
*Context gathered: 2026-01-19*
