# Phase 47: Cleanup + Documentation - Research

**Researched:** 2026-02-03
**Domain:** Codebase cleanup (dead code deletion, dependency removal, documentation rewrite)
**Confidence:** HIGH

## Summary

This research investigated the actual codebase state to answer 10 critical questions about what can safely be deleted, what survives cleanup, and what documentation changes are needed. All findings are verified against the actual source tree, import chains, and grep results.

The deletion scope extends beyond the Phase 46 manifest in several areas: orchestrator directories contain legacy code that imports dead modules (trace-recorder, toolkits), the `dev-agent/utils/` directory contains a `package-manager.ts` utility that is NOT imported by any live code, and the `shared/tools/` barrel exports toolkits.ts which must be cleaned. The migration clean-slate approach is viable because drizzle-kit tracks its own journal -- deleting migration 0000 and replacing it with a clean schema is safe for fresh clones. The credential rename affects 6 drizzle config files in addition to docker-compose.yml and .env.example.

**Primary recommendation:** Execute the three-phase deletion (A/B/C) from the manifest, extended with orchestrator directories, utils, and tools cleanup. Restructure migration 0000 to only create v2.3 tables. Rename credentials across all 6 drizzle configs. Rewrite CLAUDE.md and README as the final step.

## Standard Stack

This phase is a cleanup phase -- no new libraries are introduced. The relevant tools are already in the codebase.

### Core
| Tool | Purpose | Why Relevant |
|------|---------|--------------|
| pnpm | Package management | Remove @temporalio deps, clean lockfile |
| TypeScript (tsc) | Type checking | Gates between deletion phases |
| Biome | Linting | Gates between deletion phases |
| Vitest | Testing | Verify no regressions after cleanup |
| drizzle-kit | Migrations | Handle migration file cleanup |

### No New Dependencies
This phase only removes dependencies. No installations needed.

## Architecture Patterns

### v2.3 Directory Structure (Post-Cleanup Target)

```
packages/agents/
  definitions/                   # Agent YAML definitions + prompt.md files
    dev-agent/
    product-agent/
    coder/
    researcher/
    tester/
  src/
    adapters/                    # Event normalization (linear.ts, github.ts, slack.ts, pass-through.ts)
    framework/                   # v2.3 core (ConversationExecutor, WorkerLoop, EventLog, etc.)
    router/                      # Event routing (router.ts, slow-path.ts, system-prompt.ts, types.ts)
      tools/                     # Router-specific tools (v2.3 only: query-conversations, signal-conversation, start-conversation, send-message)
    service/                     # HTTP entry point (main.ts)
    shared/                      # Shared utilities
      agent-loop/                # Core agent loop runtime
      config/                    # Agent configuration
      db/                        # Database client, schema, migrations
      env/                       # Environment validation
      mcp/                       # MCP client for integration communication
      tools/                     # Reusable tool factories
        codebase/                # 5 codebase tools (read_file, write_file, etc.)
        coordination/            # request-human-input.ts (spawn-agent.ts deleted)
        integration/             # MCP-wrapped tools (linear, github, slack)
        types.ts                 # CodebaseToolDeps, constants
        index.ts                 # Barrel (cleaned of toolkits.ts)
```

### Pattern: Three-Phase Deletion with Gates

**What:** Refactor references (Phase A) -> Delete dead files (Phase B) -> Remove deps and config (Phase C), with `pnpm typecheck && pnpm lint` gates between each.

**Why it works:** Phase A isolates dead code by removing barrel exports and import references. Phase B deletes the isolated files without causing cascading failures. Phase C removes package-level artifacts.

### Pattern: Migration Clean-Slate

**What:** Instead of writing a DROP TABLE migration + keeping old CREATE migrations, replace migration 0000 with a consolidated schema that only creates v2.3 tables. Delete migration 0001 (it adds v2.3 tables which would now be in 0000). Keep migration 0002 (adds executor columns to conversations table).

**Why it works:** Drizzle-kit tracks applied migrations in a `__drizzle_agents_migrations` table with a `_journal.json` meta file. For existing databases, old tables need manual cleanup (documented in PR). For fresh clones, they only see the current schema.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Finding dead imports | Manual grep | `pnpm typecheck` after deletion | TypeScript catches broken imports exhaustively |
| Migration rewrite validation | Manual SQL testing | `docker compose down -v && docker compose up -d && pnpm db:migrate` | End-to-end validation on fresh database |
| Finding all Temporal references | Reading files | `grep -r "@temporalio\|TEMPORAL" packages/` | Systematic search catches what eyes miss |
| Verifying test impact | Manual test counting | `pnpm test:fast` before and after | Test runner reports exactly what changed |

## Common Pitfalls

### Pitfall 1: tsconfig includes pattern catches "dead" files
**What goes wrong:** Files deleted from barrel exports are still typechecked because `tsconfig.json` uses `"include": ["src/**/*.ts"]`.
**Why it happens:** TypeScript compiles ALL matching files, not just those reachable from barrels.
**How to avoid:** When deleting a module's export from a barrel, also delete the source file in the same step OR delete the source file before running typecheck. The manifest's Phase B handles this.
**Warning signs:** Typecheck fails on files you thought were dead.

### Pitfall 2: send-message.ts imports RouterDeps (legacy type)
**What goes wrong:** After deleting `RouterDeps` from types.ts, `router/tools/send-message.ts` breaks.
**Why it happens:** The v2.3 conversation tools use `EventRouterDeps`, but `send-message.ts` was written before the v2.3 types and still uses `RouterDeps`. The manifest does NOT cover this -- it only plans to delete the legacy Temporal-based tools (start-workflow, query-workflows, signal-workflow).
**How to avoid:** Update `send-message.ts` to use `EventRouterDeps` instead of `RouterDeps` during Phase A refactoring.
**Warning signs:** Import error on `RouterDeps` after types.ts cleanup.

### Pitfall 3: Drizzle config credential defaults
**What goes wrong:** After renaming DB credentials from `temporal` to `aesir`, `drizzle-kit migrate` fails for local development without Docker.
**Why it happens:** All 6 drizzle configs (`packages/agents/`, `packages/platform/`, `packages/observability/`, `packages/integrations/{linear,github,slack}/`) have hardcoded `?? "temporal"` defaults.
**How to avoid:** Update ALL 6 drizzle config files to use `?? "aesir"` defaults.
**Warning signs:** `pnpm db:migrate` fails after credential rename.

### Pitfall 4: Coordination tools barrel still exports spawn-agent
**What goes wrong:** After deleting `spawn-agent.ts`, the `coordination/index.ts` barrel breaks.
**Why it happens:** `coordination/index.ts` exports from both `request-human-input.ts` and `spawn-agent.ts`. The v2.3 `framework/tool-factories.ts` imports `createRequestHumanInputTool` from `coordination/index.js`.
**How to avoid:** Clean `coordination/index.ts` to only export `request-human-input.ts` before or when deleting `spawn-agent.ts`.
**Warning signs:** Import error in `framework/tool-factories.ts`.

### Pitfall 5: Migration journal inconsistency
**What goes wrong:** Fresh clone runs cleanly, but existing developer gets migration errors.
**Why it happens:** Drizzle's `_journal.json` tracks migration tags. If you rename/replace migration 0000, existing databases have the old tag in their migration table but the new file has a different structure.
**How to avoid:** Two options: (A) Replace migration 0000 content but keep the same filename and tag, or (B) Keep migration 0000 as-is and add a new migration that drops old tables. Option A is cleaner for fresh clones but requires `docker compose down -v` for existing devs.
**Warning signs:** `drizzle-kit migrate` reports "already applied" for a migration with different content, or skips needed schema changes.

### Pitfall 6: shared/tools/index.ts barrel exports toolkits.ts
**What goes wrong:** After deleting `toolkits.ts`, the `shared/tools/index.ts` barrel breaks, which breaks `shared/index.ts`, which breaks `agents/src/index.ts`.
**Why it happens:** `shared/tools/index.ts` line 16 has `export * from "./toolkits.js"`.
**How to avoid:** Clean `shared/tools/index.ts` to remove the toolkits re-export during Phase A.
**Warning signs:** Cascading import errors through barrel chain.

### Pitfall 7: Coordination test file tests both spawn-agent and request-human-input
**What goes wrong:** Cannot simply delete the entire `coordination-tools.test.ts` -- it tests `createRequestHumanInputTool` which is still live.
**Why it happens:** Both coordination tools share a single test file.
**How to avoid:** Split the test file: remove spawn-agent tests, keep request-human-input tests. OR verify if request-human-input has adequate test coverage elsewhere.
**Warning signs:** Deleting the test file removes coverage for a live function.

## Code Examples

### Cleaning a barrel export (Phase A pattern)
```typescript
// BEFORE: shared/tools/index.ts
export * from "./codebase/index.js";
export * from "./coordination/index.js";
export * from "./integration/index.js";
export * from "./toolkits.js";  // DEAD - only used by legacy orchestrators
export { type CodebaseToolDeps, MAX_OUTPUT_BYTES, MAX_STDERR_BYTES } from "./types.js";

// AFTER: shared/tools/index.ts
export * from "./codebase/index.js";
export * from "./coordination/index.js";
export * from "./integration/index.js";
export { type CodebaseToolDeps, MAX_OUTPUT_BYTES, MAX_STDERR_BYTES } from "./types.js";
```

### Cleaning coordination/index.ts after spawn-agent deletion
```typescript
// BEFORE: shared/tools/coordination/index.ts
export { createRequestHumanInputTool, HUMAN_INPUT_MARKER } from "./request-human-input.js";
export { type AgentTypeConfig, createSpawnAgentTool, type SpawnAgentDeps } from "./spawn-agent.js";

// AFTER: shared/tools/coordination/index.ts
export { createRequestHumanInputTool, HUMAN_INPUT_MARKER } from "./request-human-input.js";
```

### Fixing send-message.ts RouterDeps import
```typescript
// BEFORE: router/tools/send-message.ts
import type { RouterDeps } from "../types.js";
export function createSendMessageTool(_deps: RouterDeps): ToolDefinition {

// AFTER: router/tools/send-message.ts
import type { EventRouterDeps } from "../types.js";
export function createSendMessageTool(_deps: EventRouterDeps): ToolDefinition {
```

### Migration clean-slate approach
```sql
-- NEW 0000_create_agents_schema.sql (replaces old version)
CREATE SCHEMA IF NOT EXISTS "agents";

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION agents.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = CURRENT_TIMESTAMP; RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- Conversations table (v2.3)
CREATE TABLE IF NOT EXISTS "agents"."conversations" ( ... );
-- Agent events table (v2.3)
CREATE TABLE IF NOT EXISTS "agents"."agent_events" ( ... );
-- Agent sessions table (v2.3)
CREATE TABLE IF NOT EXISTS "agents"."agent_sessions" ( ... );
-- Triggers for updated_at ...
```

## Detailed Findings

### Finding 1: Orchestrator Directories (CONFIRMED DEAD)

**dev-agent/orchestrator/** contains 5 files:
- `orchestrator.ts` - imports `createTraceRecorder` (dead store) and `createOrchestratorToolkit` (dead toolkit)
- `orchestrator.test.ts` - tests for dead orchestrator
- `e2e-validation.test.ts` - tests for dead orchestrator
- `system-prompts.ts` - prompt content now lives in `definitions/dev-agent/prompt.md`
- `index.ts` - barrel for the above

**Imports from live code:** Only from `dev-agent/index.ts` (which re-exports to `agents/src/index.ts`). The manifest already plans to clean `dev-agent/index.ts` in step A8. After that, the orchestrator directory is fully isolated. No v2.3 framework code imports from orchestrator directories.

**product-agent/orchestrator/** contains 5 files with same pattern:
- `orchestrator.ts` - imports `createTraceRecorder` and `createProductAgentToolkit`
- `orchestrator.test.ts`, `e2e-validation.test.ts`, `system-prompts.ts`, `index.ts`

**Imports from live code:** Only from `product-agent/index.ts`. Same isolation pattern.

**Confidence: HIGH** -- verified via grep and file inspection.

### Finding 2: spawn-agent.ts Import Chain (CONFIRMED DEAD)

`shared/tools/coordination/spawn-agent.ts` is imported by:
1. `coordination/index.ts` barrel -- which is imported by:
   - `shared/tools/index.ts` barrel -- which is imported by:
     - `shared/index.ts` barrel -- which is imported by:
       - `agents/src/index.ts` barrel
   - `shared/tools/toolkits.ts` (dead)
2. `coordination-tools.test.ts` (test file)

The v2.3 `framework/tool-factories.ts` imports ONLY `createRequestHumanInputTool` from `coordination/index.js` -- NOT `createSpawnAgentTool`. The v2.3 `spawn_agent` is a placeholder inline in `tool-factories.ts` (lines 242-271).

**The barrel chain is the only reason spawn-agent.ts stays in the compilation.** After cleaning `coordination/index.ts` to not re-export it, spawn-agent.ts becomes fully isolated and deletable.

**Confidence: HIGH** -- verified via grep for all `createSpawnAgentTool` and `spawn-agent` references.

### Finding 3: dev-agent/ and product-agent/ After Cleanup

**dev-agent/ contents after deleting api/, classification/, orchestrator/, main.ts, worker.ts:**
- `index.ts` - barrel (will need rewrite or deletion)
- `README.md` - documentation file
- `utils/` - contains `package-manager.ts` and `index.ts`

**utils/package-manager.ts status:** `detectPackageManager`, `getLintCommand`, `getTestCommand` are NOT imported by any file outside `dev-agent/utils/index.ts` itself. Grep confirms: only the barrel and definition match. This is dead code -- v2.3 agent definitions in YAML don't reference these utilities.

**Recommendation:** Delete entire `dev-agent/` directory after cleanup. Everything in it is dead.

**product-agent/ contents after deleting api/, orchestrator/, main.ts, worker.ts:**
- `index.ts` - barrel (will need rewrite or deletion)
- `README.md` - documentation file
- No `slack/` directory (confirmed: does not exist)

**Recommendation:** Delete entire `product-agent/` directory after cleanup. Everything in it is dead.

**Confidence: HIGH** -- verified via grep and directory listing.

### Finding 4: Migration Files and Clean-Slate Approach

Current migration files:
```
0000_create_agents_schema.sql  -- Creates: agents schema, context_snapshots, tasks, execution_traces + triggers
0001_add_v23_tables.sql        -- Creates: conversations, agent_events, agent_sessions + triggers
0002_add_executor_columns.sql  -- Adds: retry_count, max_retries, error_message, delivered_signal_ids, parent_conversation_id, LZ4 compression
meta/_journal.json             -- Tracks migration history (3 entries)
meta/0000_snapshot.json        -- Schema snapshot
```

**Clean-slate approach:** Replace 0000 with a consolidated migration that creates the agents schema + v2.3 tables (conversations, agent_events, agent_sessions) + the trigger function. Merge 0001 content into the new 0000. Keep 0002 as-is (it ALTERs the conversations table).

**Drizzle journal handling:** The `_journal.json` must be updated to reflect the new migration structure. The meta snapshot should also be regenerated.

**Critical detail:** Drizzle-kit tracks which migrations have been applied via the `__drizzle_agents_migrations` table in the database. For existing developers, the old migrations are "already applied" -- the new consolidated 0000 will have the same tag name. Since it uses `CREATE TABLE IF NOT EXISTS`, re-running it on an existing database is harmless. But the old tables (context_snapshots, tasks, execution_traces) won't be dropped automatically.

**For existing devs:** `docker compose down -v` is the simplest path (user decision: already documented as required for credential rename).

**For fresh clones:** The consolidated 0000 + 0002 creates exactly the right schema.

**Confidence: HIGH** -- verified via migration file contents and journal structure.

### Finding 5: Docker Compose Temporal References

Current Docker Compose has these Temporal-related items to clean:
1. **PostgreSQL service:** `POSTGRES_USER: temporal`, `POSTGRES_PASSWORD: temporal`, `POSTGRES_DB: temporal`, healthcheck `pg_isready -U temporal`
2. **Volume:** `temporal-postgresql` (with `name: aesir-temporal-postgresql`)
3. **4 service environments:** `DB_USER=temporal`, `DB_PASSWORD=temporal`, `DB_NAME=temporal` (linear-integration, github-integration, slack-integration, agent-service)
4. **NO Temporal server or Temporal UI services** -- these have already been removed from docker-compose.yml
5. **NO TEMPORAL_* environment variables** -- these have already been removed

**The Docker Compose cleanup is purely a credential rename** (temporal -> aesir). No Temporal service definitions to remove.

**Confidence: HIGH** -- verified line-by-line in docker-compose.yml.

### Finding 6: v2.3 Framework Gotchas for CLAUDE.md

Based on reading the framework code, these are the v2.3-specific gotchas:

1. **Agent definitions live in YAML + prompt.md, not TypeScript** -- `definitions/{agent}/definition.yaml` declares tools, model, config. `prompt.md` is the system prompt. Changes to agent behavior should modify these files, not framework code.

2. **ConversationExecutor.start() is idempotent** -- Same correlationKey returns existing conversation ID. Re-triggers append `-r{N}` suffix. Code must not assume start() creates a new conversation every time.

3. **EventLog.append() is synchronous (void)** -- Events are buffered and flushed periodically. Always call `flush()` at lifecycle boundaries (conversation end, error). Missing flush = lost events.

4. **HistoryManager compacts messages** -- Long conversations get compacted (old messages summarized by Haiku). The full history is preserved in the database but the LLM only sees compacted form. This is the `compactConversationHistory` pattern from the product-agent orchestrator, now generalized.

5. **WaitForState enables pause/resume** -- The `wait_for` tool creates a pending wait on the conversation. The WorkerLoop detects this and stops execution. Signals resume by clearing the pending wait. Without proper signal handling, conversations can get stuck in "waiting" state forever.

6. **Router tools are NOT framework tools** -- `router/tools/` contains tools for the router LLM (query-conversations, signal-conversation, start-conversation, send-message). `shared/tools/` contains tools for agent LLMs (codebase, coordination, integration). `framework/tool-factories.ts` registers shared/tools for agents. These are separate tool sets.

7. **Agent-First Decision Checklist paths need updating** -- Current checklist references `packages/agents/src/shared/temporal/` and `*/orchestrator/` which will be deleted. Update to reference `packages/agents/definitions/` and `packages/agents/src/framework/`.

### Finding 7: Router System Prompt Naming

**ROUTER_SYSTEM_PROMPT** (legacy) -- References Temporal workflow tools (query_running_workflows, signal_workflow, start_workflow). This is the old prompt.

**ROUTER_SYSTEM_PROMPT_V2** (v2.3) -- References conversation tools (query_conversations, signal_conversation, start_conversation). This is the live prompt.

**After cleanup:** Delete `ROUTER_SYSTEM_PROMPT`, keep `ROUTER_SYSTEM_PROMPT_V2`. Consider renaming V2 to just `ROUTER_SYSTEM_PROMPT` for cleanliness, but this requires updating the import in `slow-path.ts`. This is cosmetic -- recommend doing it since the legacy version won't exist.

**Confidence: HIGH** -- verified in system-prompt.ts.

### Finding 8: shared/tools/ After Cleanup

After deleting `toolkits.ts`, `toolkits.test.ts`, `coordination/spawn-agent.ts`:

**Remaining structure:**
```
shared/tools/
  codebase/           # 5 tool files + index.ts + test (LIVE - used by framework)
  coordination/       # request-human-input.ts + index.ts (LIVE - used by framework)
                      # coordination-tools.test.ts (NEEDS EDITING - remove spawn-agent tests)
  integration/        # linear-tools.ts, github-tools.ts, slack-tools.ts, mcp-wrapper.ts + index.ts + test (LIVE)
  index.ts            # Barrel (NEEDS EDITING - remove toolkits export)
  types.ts            # CodebaseToolDeps, constants (LIVE)
```

**coordination-tools.test.ts:** This single test file covers BOTH `createSpawnAgentTool` (dead) and `createRequestHumanInputTool` (live). Must split: remove spawn-agent tests, keep request-human-input tests. The file has clear `describe()` blocks for each, so surgical removal is straightforward.

**Confidence: HIGH** -- verified via directory listing and file inspection.

### Finding 9: Product Agent slack/ Directory

**Does NOT exist.** Confirmed: `ls` returns "NO SLACK DIRECTORY". The CLAUDE.md mentions it in the directory structure, but it was removed or never created. No action needed.

**Confidence: HIGH** -- verified via ls.

### Finding 10: README.md Status

**Exists at repo root.** 503 lines. Contains:
- References to Temporal: "Temporal-orchestrated approval gates" in Features section
- Instructions to start `temporal temporal-ui` infrastructure
- References to `docker compose up -d postgresql temporal temporal-ui`
- Mentions dev-agent and product-agent as separate services
- No mention of v2.3 architecture, ConversationExecutor, definitions/, framework/

**Needs comprehensive update** to match v2.3 reality. Key changes:
1. Remove all Temporal references
2. Update "Quick Start" to just `docker compose up -d postgresql` then `pnpm db:migrate`
3. Remove per-agent service references
4. Add agent-service as the unified service
5. Update architecture description to reflect definitions/ + framework/ pattern

**Confidence: HIGH** -- verified via file inspection.

### Finding 11: Drizzle Config Credential Defaults (ADDITIONAL)

All 6 drizzle configs across the monorepo default to `temporal` credentials:
- `packages/agents/drizzle.config.ts`
- `packages/platform/drizzle.config.ts`
- `packages/observability/drizzle.config.ts`
- `packages/integrations/linear/drizzle.config.ts`
- `packages/integrations/github/drizzle.config.ts`
- `packages/integrations/slack/drizzle.config.ts`

All have: `user: process.env.DB_USER ?? "temporal"`, `password: process.env.DB_PASSWORD ?? "temporal"`, `database: process.env.DB_NAME ?? "temporal"`.

**Must update all 6** to use `"aesir"` defaults when renaming credentials.

**Confidence: HIGH** -- verified via file inspection.

### Finding 12: Router Tools -- Legacy vs v2.3

**router/tools/ directory contents:**
| File | Type | Imports From |
|------|------|-------------|
| query-conversations.ts | v2.3 | `EventRouterDeps` |
| start-conversation.ts | v2.3 | `EventRouterDeps` |
| signal-conversation.ts | v2.3 | `EventRouterDeps` |
| send-message.ts | LEGACY TYPE | `RouterDeps` (needs fix) |
| query-workflows.ts | LEGACY | `RouterDeps` + Temporal signals |
| signal-workflow.ts | LEGACY | `RouterDeps` + Temporal signals |
| start-workflow.ts | LEGACY | `RouterDeps` + `@temporalio/client` |

**Delete:** query-workflows.ts, signal-workflow.ts, start-workflow.ts (manifest step B6)
**Fix:** send-message.ts to use `EventRouterDeps` instead of `RouterDeps`
**Keep:** query-conversations.ts, start-conversation.ts, signal-conversation.ts, send-message.ts (after fix)

### Finding 13: agents/src/index.ts Cleanup

Current `agents/src/index.ts` exports from:
1. `dev-agent/index.js` - will be deleted (entire directory goes)
2. `product-agent/index.js` - will be deleted (entire directory goes)
3. `shared/index.js` - survives but needs temporal export removal

**After cleanup:** This barrel becomes nearly empty. It should export only what external consumers need from the agents package. Currently, no external package imports from `@aesir/agents` barrel in production (confirmed in audit). The barrel is primarily for IDE convenience.

**Recommendation:** Either (A) gut it to just `export * from "./shared/index.js"` or (B) evaluate if the barrel is needed at all since v2.3 uses `service/main.ts` as the entry point.

### Finding 14: Root package.json Keywords

Root `package.json` has keywords: `"agent", "ai", "langchain", "langgraph", "automation"`. The `langchain` and `langgraph` keywords are stale -- v2.3 doesn't use LangGraph. These should be updated.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Temporal workflows for agent orchestration | ConversationExecutor + WorkerLoop | v2.3 (Phase 37-44) | Temporal server no longer needed |
| LangGraph state machines | Agentic tool-use loop (runAgentLoop) | v2.2 (Phase 31) | No LangGraph dependency for agents |
| Per-agent HTTP services (dev-agent, product-agent) | Unified agent-service (service/main.ts) | v2.3 (Phase 44) | Single container, single process |
| System prompts in TypeScript constants | Prompt.md files in definitions/ | v2.3 (Phase 38) | Prompts are data, not code |
| Agent tool configuration in code (toolkits.ts) | YAML definition + ToolRegistry | v2.3 (Phase 38) | Declarative agent definitions |

## Open Questions

1. **Migration journal strategy**
   - What we know: Drizzle tracks migrations by tag name in `_journal.json` and `__drizzle_agents_migrations` DB table
   - What's unclear: If we replace 0000 content but keep the tag, will drizzle-kit consider it "already applied" on existing DBs? (Yes -- it matches by tag name, not content hash)
   - Recommendation: Keep 0000 filename/tag, replace content with v2.3-only schema. Document `docker compose down -v` for existing devs. This is already required for the credential rename anyway.

2. **Volume name: keep or rename?**
   - What we know: Volume is named `aesir-temporal-postgresql` (explicit name in docker-compose)
   - What's unclear: Whether cosmetic rename is worth the churn
   - Recommendation: Rename to `aesir-postgresql`. Since `docker compose down -v` is required anyway for credential rename, volume recreation happens automatically.

3. **agents/src/index.ts future**
   - What we know: After deleting dev-agent/ and product-agent/, only shared/ exports remain
   - What's unclear: Whether any CI, test, or external tooling depends on `@aesir/agents` barrel exports
   - Recommendation: Keep the barrel but clean it. It costs nothing and might be used by future tooling.

4. **ROUTER_SYSTEM_PROMPT_V2 rename**
   - What we know: After deleting legacy prompt, V2 is the only version
   - What's unclear: Whether the `_V2` suffix causes confusion
   - Recommendation: Rename to `ROUTER_SYSTEM_PROMPT` for simplicity. This is a single-file refactor.

## Sources

### Primary (HIGH confidence)
- Actual codebase inspection via Read/Grep/Bash tools
- 46-DELETION-MANIFEST.md -- Phase 46 audit deliverable
- 46-AUDIT-REPORT.md -- Phase 46 audit deliverable
- All file contents verified against actual source tree

### Notes
- This phase is entirely internal (codebase cleanup + documentation). No external library research was needed.
- All findings are based on the actual state of the codebase at time of research (2026-02-03).

## Metadata

**Confidence breakdown:**
- Deletion scope: HIGH -- every file and import chain verified via grep and inspection
- Migration strategy: HIGH -- drizzle journal mechanism verified, migration contents read
- Docker Compose: HIGH -- line-by-line verified
- Documentation scope: HIGH -- CLAUDE.md, README.md, and v2.3 framework code all inspected
- Pitfalls: HIGH -- all based on actual observed code patterns, not speculation

**Research date:** 2026-02-03
**Valid until:** Until Phase 47 is executed (findings are point-in-time codebase snapshot)
