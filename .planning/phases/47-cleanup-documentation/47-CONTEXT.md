# Phase 47: Cleanup + Documentation - Context

**Gathered:** 2026-02-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Remove all Temporal code, old persistence stores, per-agent services, Docker containers, and dependencies. Update CLAUDE.md, README, and project documentation to reflect v2.3 architecture. Execute against the deletion manifest from Phase 46 (46-DELETION-MANIFEST.md) with additional scope for orchestrator directories, platform temporal cleanup, and comprehensive documentation rewrite.

</domain>

<decisions>
## Implementation Decisions

### Deletion scope — beyond the manifest
- Delete entire `dev-agent/orchestrator/` and `product-agent/orchestrator/` directories (system-prompts.ts content already lives in definitions/ prompt.md files, orchestrator.ts is dead after temporal removal)
- Delete legacy `shared/tools/coordination/spawn-agent.ts` IF only imported by dead code (toolkits.ts, orchestrators) — v2.3 spawn_agent lives in `framework/tool-factories.ts`
- Delete `shared/tools/toolkits.ts` and test (confirmed dead, only imported by legacy orchestrators)
- Delete entire `dev-agent/` and `product-agent/` directories IF empty/useless after cleanup — v2.3 uses `definitions/` and `framework/`, not agent-specific subdirectories. Verify nothing living remains before deleting.
- Full platform cleanup: delete `platform/src/temporal/` entirely, `temporal-logger.ts`, remove `@temporalio` deps from platform `package.json`, clean all barrel exports
- Verify every deletion — no point-blank directory kills. Check that nothing is imported by live code before removing.

### Database credentials
- Rename Postgres credentials from `temporal` to `aesir` (user, password, database name) in Docker Compose, `.env.example`, and all service environment configs
- Volume recreation required — document `docker compose down -v` in PR
- Ensure all migrations run cleanly on fresh database (someone cloning the project should be able to `pnpm db:migrate` and get a working system)
- Verify seeding functions work after credential rename

### Old migration files
- Delete old migration files that create dead tables (tasks, context_snapshots, execution_traces)
- Clean slate approach — only keep migrations that create the current schema
- Fresh clone should only see what exists today, not historical table evolution
- The DROP TABLE migration from manifest step C6 becomes unnecessary if old CREATE migrations are deleted — new clones never create those tables

### Docker Compose cleanup
- Remove Temporal server and Temporal UI services entirely
- Remove temporal volume definitions
- Remove all `TEMPORAL_*` environment variables from remaining services
- Clean break — no temporal references remain in Docker Compose

### CLAUDE.md rewrite
- Full rewrite focusing on v2.3 architecture as the current reality
- Keep general-purpose rules: agent-first problem solving, design principles, dependency injection pattern, error handling, logging, Zod validation, MCP layer documentation
- Remove all Temporal/LangGraph/per-agent-service references
- Remove v2.0/v2.1/v2.2 milestone history sections — `.planning/` folder holds all historical context, mention that in CLAUDE.md
- Show actual v2.3 directory structure: `definitions/`, `framework/`, `adapters/`, `service/`, `router/`, `shared/` (agent-loop, tools, mcp, db)
- Replace Temporal/LangGraph gotchas with v2.3-specific gotchas: agent definition conventions, conversation executor behavior, event log patterns, history compaction
- Keep unchanged sections: integration packages (Linear/GitHub/Slack), MCP layer, environment configuration, testing patterns, Docker networking, OAuth tokens, package imports (updated to remove dead refs)

### Claude's Discretion
- Exact ordering of deletions within the three-phase manifest structure (A/B/C) — follow manifest guidance but adapt as needed for clean typecheck gates
- Which v2.3 gotchas to include in CLAUDE.md — based on what's actually tricky about the current system
- Whether to consolidate remaining `shared/db/` barrel exports or leave them minimal
- README updates — scope and depth based on what's actually stale

</decisions>

<specifics>
## Specific Ideas

- "If DB ends up totally empty then running migrations and seeders should bring us back to where we are now. This is a good exercise for when others clone the project and want to get going"
- CLAUDE.md should mention that `.planning/` folder holds all historical project context — so there's no need to repeat milestone history in CLAUDE.md itself
- The v2.3 CLAUDE.md should reflect the "logical conclusion of v2.2" — the agent-first principles from v2.2 led directly to removing Temporal and the workflow state machine
- Keep the MANDATORY Agent-First Decision Checklist from CLAUDE.md but update file paths (the current checklist references `shared/temporal/` and `*/orchestrator/` which will be deleted)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 47-cleanup-documentation*
*Context gathered: 2026-02-03*
