# Phase 69: Entity Directory - Context

**Gathered:** 2026-02-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Agents discover each other by capability through a queryable directory seeded from YAML definitions, with semantic matching via pgvector. Enables dynamic delegation decisions in Phase 70 instead of hardcoded routing. Human entries are deferred (schema ready, seeding and delegation deferred). Agent-only for v2.7.

</domain>

<decisions>
## Implementation Decisions

### Capability Design
- Outcome-level capabilities, 3-7 statements per agent. Each describes what the agent delivers, not what tools it has
- Light convention: start with a verb, describe the deliverable, one sentence per capability. Not enforced by schema
- Single combined embedding per entity (concatenate all capabilities into one text block). Per-capability embedding deferred until scale justifies it (50+ entities with overlapping capabilities)
- Flat string list in definition.yaml — no structured entries (label/description). The capability string serves both embedding source and display
- Bad examples to avoid: verbose wrappers ("This agent is responsible for..."), terse fragments ("Code. PRs."), filler ("including but not limited to")

### Seed Lifecycle
- Manual CLI command: `pnpm --filter @aesir/agents seed:directory`. Matches established `seed:permissions` pattern
- Script location: `packages/agents/scripts/seed-directory.ts`
- Idempotent: `ON CONFLICT DO UPDATE` with `last_seeded_at` timestamp
- Removed agents: mark `status='inactive'` for agent entries not in the current YAML set (scoped to `type='agent'`). Reversible — re-add YAML and re-seed
- Skip embedding when capabilities haven't changed: compare stored capabilities array against YAML. Changed = full upsert with new embedding. Unchanged = metadata-only upsert (name, description, last_seeded_at)
- Optional startup staleness warning: log warning if YAML mtime > last_seeded_at (cheap check, no embedding needed)
- Deploy workflow: `pnpm db:migrate` → `pnpm seed:permissions` → `pnpm seed:directory`

### Search Result Shape
- `directory:find` input: just `query` (string). No type filter, limit, or tags
- Self-exclusion is automatic via `ctx.agentId` — agents never find themselves
- Status filtering is automatic: `WHERE status = 'active'`
- `directory:find` returns per result: `id`, `name`, `type`, `description`, `capabilities`. Ordered by relevance
- No raw similarity score — result ordering is the signal. Agents are bad at interpreting cosine distances
- Similarity threshold filtering (tunable, start around 0.3). All matches above threshold returned — no pagination at 5-10 agents
- `directory:get` returns: everything from `find` plus `reach_via` and `metadata`. Returns not-found for inactive entities

### Definition.yaml Changes
- Only orchestrators get directory entries (dev-agent, product-agent). Sub-agents (coder, researcher, tester) are excluded
- Presence of `capabilities` field in YAML is the opt-in signal. No separate `directory: true` flag needed
- Zod schema: `capabilities: z.array(z.string().min(1)).optional()` in AgentRegistry. Light validation — catches structural errors, not content quality

### Claude's Discretion
- Exact similarity threshold tuning for `directory:find`
- Entity directory table schema details (column types, indexes beyond HNSW)
- Error message format for not-found/inactive entities in `directory:get`
- Whether to add a startup staleness warning or defer it

</decisions>

<specifics>
## Specific Ideas

### Initial Capability Definitions

**dev-agent:**
```yaml
capabilities:
  - "implement features by writing code, creating branches, and opening pull requests"
  - "debug failures, investigate issues, and deliver fixes"
  - "research codebases to understand architecture, patterns, and dependencies"
  - "run test suites and validate code changes meet requirements"
  - "address pull request review feedback and iterate until approved"
```

**product-agent:**
```yaml
capabilities:
  - "turn feature requests and user feedback into well-structured Linear issues"
  - "clarify requirements and gather context through user conversation"
  - "prioritize and organize issues with labels, estimates, and descriptions"
```

These set the convention for future agents. QA agent (Phase 73) follows the same pattern.

### Key Design Principle
From a delegation perspective, the orchestrator owns the outcome. A delegating agent searching "run tests and verify changes" matches dev-agent — the caller doesn't know or care about the coder/researcher/tester sub-agent split.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 69-entity-directory*
*Context gathered: 2026-02-10*
