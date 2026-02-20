# Technology Stack

**Project:** Aesir v2.9 Platform Completion
**Researched:** 2026-02-20

## Key Finding: No New Dependencies Needed

The existing stack covers all 8 capability areas. v2.9 is primarily about **new Postgres tables, new tools, new YAML fields, and new service logic** -- not new libraries. This is the correct outcome for a "platform completion" milestone: the platform is mature enough that adding features means using the platform, not extending its foundations.

The one exception is cron expression validation (Phase 5), where a lightweight library adds value over hand-rolling validation.

---

## Recommended Stack Changes

### New Dependency: Cron Expression Validation (Phase 5)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `cron-parser` | ^5.x | Validate and compute next occurrence for cron expressions | pg-boss handles cron scheduling internally, but we need client-side validation at YAML load time (fail-fast at startup) and "next run" computation for dashboard display. `cron-parser` is the most established library (15M+ weekly downloads), supports timezone, DST handling, and iterator for next occurrences. |

**Confidence:** HIGH -- verified on npm, widely used, maintained, TypeScript types included since v5.

**Alternatives considered:**

| Library | Why Not |
|---------|---------|
| `croner` | Zero-dependency alternative with TypeScript-first design. Lighter, but also a full scheduler -- we only need parsing/validation. `cron-parser` is more focused on parsing. |
| `cron-validate` | Validation-only, but no next-occurrence computation. Dashboard needs "Next run: Mon 9:00 AM" display. |
| Hand-rolled regex | Cron syntax has edge cases (month names, day-of-week ranges, step values). Not worth maintaining when a battle-tested library exists. |

**Install in:** `@aesir/agents` (validation at YAML load time + schedule registration)

```bash
pnpm --filter @aesir/agents add cron-parser
```

---

## Existing Stack: What Each Capability Area Uses

### Phase 1: Richer Negotiation (Counter-Propose + Clarification)

| Existing Technology | How It's Used |
|---------------------|---------------|
| `task:respond` tool + Zod schemas | Extend response enum from `["accept", "reject"]` to `["accept", "reject", "counter_propose"]` |
| Signal system (`SignalSchema`, `executor.signal()`) | New signal type `task_clarification` for mid-task questions |
| `wait_for` tool + signal matching | Target agent pauses for clarification response, delegator pauses for counter-proposal response |
| Postgres `tasks` table | Add `counter_proposal` JSONB column for proposed modifications |
| Drizzle ORM migrations | Schema migration for new columns |

**No new dependencies.** This is signal types + tool parameter extensions + a DB column.

### Phase 2: Parallel Delegation (Task Groups + Completion Policies)

| Existing Technology | How It's Used |
|---------------------|---------------|
| Postgres + Drizzle | New `task_groups` table: `id`, `name`, `policy` (enum), `creator_conversation_id`, `status`, `created_at` |
| Postgres + Drizzle | New `task_group_members` table: many-to-many linking tasks to groups |
| `task:delegate` tool | Extended with optional `groupId` parameter for group membership |
| Signal aggregation (new logic) | Collect completion signals, evaluate policy, signal delegator when policy satisfied |
| Zod | Validation for completion policy enum: `all_required`, `any_sufficient`, `majority` |

**No new dependencies.** Parallel delegation is coordination logic over existing primitives (tasks, signals, conversations). The completion policy evaluator is pure TypeScript logic (~50 lines: count completed/failed/total, check against policy).

### Phase 3: Transparent Materialization (Linear Tickets)

| Existing Technology | How It's Used |
|---------------------|---------------|
| `callMcpTool()` (MCP HTTP client) | Agent calls `linear:create_issue` via existing MCP wrapper to materialize task |
| `CorrelationService` (work_correlations table) | Track bidirectional link between task and materialized Linear issue |
| `task:delegate` tool | Add optional `materialization` parameter (`"internal"` or `"transparent"`) |
| EventRouter + signal matching | Incoming Linear webhooks route to the task's conversation via correlation |
| Zod schemas | Materialization config validation |

**No new dependencies.** The Linear integration already has `create_issue` and `update_issue_status` MCP tools. Materialization is orchestration: create the issue via existing MCP, store the correlation via existing CorrelationService, and route webhooks via existing EventRouter. The materialization interface (strategy pattern for future GitHub/Slack targets) is a TypeScript interface + factory, not a library.

### Phase 4: Tree-Level Token Budgets

| Existing Technology | How It's Used |
|---------------------|---------------|
| `TokenBudget` class (`shared/agent-loop/token-budget.js`) | Extend with tree-aware tracking: shared budget reference passed through delegation chain |
| Postgres `tasks` table | Add `tree_budget_total` and `tree_budget_consumed` columns for persistent tracking |
| Signal system | New `budget_warning` signal type for approaching-exhaustion notifications |
| Drizzle ORM | Migration for new columns + query for aggregating tree consumption |

**No new dependencies.** The existing `TokenBudget` is already a mutable shared object passed by reference to sub-agents. Tree budgets extend this pattern to cross-conversation delegation. The key change is making budget state persistent (DB column) rather than in-memory-only, since delegation spans separate worker loop executions.

### Phase 5: Scheduled Agent Execution

| Existing Technology | How It's Used |
|---------------------|---------------|
| pg-boss v12.8.0 `schedule()` | Built-in cron scheduling with timezone support (`tz` option). Already initialized with `schedule: true`. |
| `TimeoutScheduler` pattern | Extend to also register cron schedules alongside timeout jobs. Same pg-boss instance. |
| `AgentDefinitionYamlSchema` (Zod) | Add optional `schedules` array field to the YAML schema |
| `AgentRegistry` | Load schedule configs from YAML at startup |
| `ConversationExecutor.start()` | Scheduled job handler creates synthetic `IncomingEvent` and calls `start()` |
| Postgres `agent_events` table | New event type for schedule observability |

| New Technology | Version | Purpose | Why |
|----------------|---------|---------|-----|
| `cron-parser` | ^5.x | Validate cron at YAML load time, compute next occurrence for dashboard | See detailed rationale above |

**pg-boss schedule() API (verified from installed v12.8.0 types):**
```typescript
schedule(name: string, cron: string, data?: object | null, options?: ScheduleOptions): Promise<void>
// ScheduleOptions extends SendOptions & { tz?: string; key?: string }
unschedule(name: string, key?: string): Promise<void>
getSchedules(name?: string, key?: string): Promise<Schedule[]>
// Schedule = { name, key, cron, timezone, data?, options? }
```

This is already in the project's pg-boss instance with `schedule: true` enabled. The overlap prevention (`skip` vs `queue`) maps to pg-boss's `singletonKey` on the scheduled queue.

### Phase 6: Sub-Agent Discovery (Capability-Based)

| Existing Technology | How It's Used |
|---------------------|---------------|
| `entity_directory` table + pgvector | Reuse the same embedding + cosine similarity pattern. Add a `tier` discriminator column (`orchestrator` vs `sub-agent`). |
| `DirectoryService.find()` | Extend or create parallel service that queries with tier filter |
| `EmbeddingService` | Same Voyage/Ollama pipeline for capability embeddings |
| `AgentDefinitionYamlSchema` | Already has optional `capabilities` field |
| `coordination:spawn_agent` tool | Add optional `capability` parameter alongside existing `agentType` |
| `seed-directory.ts` script | Extend to seed sub-agents with `tier: 'sub-agent'` |

**No new dependencies.** Sub-agent discovery reuses the entity directory pattern exactly. Recommendation: same `entity_directory` table with a `tier` column rather than a separate table. Reasons: shared embedding pipeline, shared cleanup/deactivation logic, single source of truth for "who can do what." The only differentiation is query-time filtering by tier.

### Phase 7: Persistent Agent Identity (Versioned Documents)

| Existing Technology | How It's Used |
|---------------------|---------------|
| Postgres + Drizzle | New `identity_documents` table: `id`, `agent_id`, `document_type`, `content` (text), `version` (integer), `token_count`, `created_at` |
| `AgentDefinitionYamlSchema` | Optional `identity` config block for document types and token limits |
| ConversationExecutor / worker loop | Inject identity documents into system prompt at conversation start |
| Zod | Validation for document types, token limits |
| `react-markdown` (dashboard) | Already used -- renders identity document content in dashboard |

**No new dependencies.** Identity documents are text blobs versioned with an integer column. No diffing library needed -- the dashboard shows version history via simple DB queries, and "comparison" is side-by-side text display (already have React Markdown rendering in the dashboard).

### Phase 8: Knowledge Retrieval Enhancement (Pluggable Pipeline)

| Existing Technology | How It's Used |
|---------------------|---------------|
| `KnowledgeService.query()` | Refactor into strategy pattern: current vector search becomes the default strategy |
| `AgentDefinitionYamlSchema` | Add optional `retrieval` config block for strategy selection and weights |
| Zod | Validate retrieval config at startup |
| `HistoryManager.compact()` | Hook for pre-compaction flush: inject a turn before compaction triggers |
| `@anthropic-ai/sdk` | The flush turn is a regular LLM turn with restricted tools |

**No new dependencies.** The pluggable pipeline is a TypeScript interface (`RetrievalStrategy`) with a registry pattern (same as `ToolRegistry`). The current vector search is refactored into the first strategy implementation. Score fusion is a weighted average function. No new math/ML libraries needed -- pgvector handles the vector operations, and fusion is arithmetic.

---

## What NOT to Add

| Technology | Why Not |
|------------|---------|
| Redis/Valkey | Token budget aggregation across tree could seem like a cache use case, but Postgres is sufficient -- budget updates are infrequent (per-LLM-call, not per-request) and `FOR UPDATE` handles contention |
| Temporal/Inngest | Parallel delegation with completion policies looks like workflow orchestration, but our signal-based coordination handles it. Adding a workflow engine would duplicate the ConversationExecutor's job. |
| Full-text search (pg_trgm, ts_vector) | Phase 8 mentions keyword search as a future strategy. Defer to v3.0 when role analysis reveals which agents need it. The pluggable pipeline interface accommodates it without pre-building. |
| GraphQL | Dashboard additions (schedule visibility, identity documents, tree budgets) use the existing REST API + SSE pattern. No new query paradigm needed. |
| Event streaming (Kafka, NATS) | Signal aggregation for parallel groups is handled by Postgres queries, not streaming. The volume (tens of signals per minute, not thousands per second) doesn't warrant infrastructure complexity. |
| Diffing library (diff, jsdiff) | Identity document version comparison. Side-by-side text display in React is simpler and more useful than computed diffs for natural-language documents. |
| BM25/Elasticsearch | Phase 8 explicitly defers concrete retrieval strategies (keyword, temporal decay, MMR) to v3.0. The pipeline interface is what ships in v2.9. |

---

## Version Compatibility Matrix

All existing dependencies are compatible -- no upgrades required.

| Package | Current Version | Required For | Status |
|---------|----------------|--------------|--------|
| `pg-boss` | ^12.8.0 | Cron scheduling (Phase 5) | Already supports `schedule()` with `tz` option |
| `drizzle-orm` | ^0.45.1 | New tables (groups, identity docs) | Current, supports all needed features |
| `drizzle-kit` | ^0.31.8 | Migration generation for new tables | Current |
| `@anthropic-ai/sdk` | ^0.72.0 | Pre-compaction flush LLM turn (Phase 8) | Current, no new features needed |
| `voyageai` | ^0.1.0 | Sub-agent capability embeddings (Phase 6) | Current, same pipeline |
| `zod` | 3.25.67 | Extended YAML schemas (Phases 1-8) | Current |
| `next` | 15.5.9 | Dashboard additions (Phases 4,5,7,8) | Current |
| `@xyflow/react` | ^12.10.0 | Task tree budget visualization (Phase 4) | Already used for delegation graph |
| `recharts` | ^2.15.4 | Budget consumption charts (Phase 4) | Already used in dashboard |

---

## New Database Tables Summary

| Table | Phase | Purpose |
|-------|-------|---------|
| `agents.task_groups` | 2 | Parallel delegation groups with completion policies |
| `agents.task_group_members` | 2 | Many-to-many: tasks in groups |
| `agents.identity_documents` | 7 | Versioned agent identity documents |

## Schema Modifications Summary

| Table | Column/Change | Phase | Purpose |
|-------|--------------|-------|---------|
| `agents.tasks` | Add `counter_proposal` JSONB | 1 | Store counter-proposal content |
| `agents.tasks` | Add `group_id` FK to task_groups | 2 | Link task to parallel group |
| `agents.tasks` | Add `tree_budget_total` integer | 4 | Total tree token budget |
| `agents.tasks` | Add `tree_budget_consumed` integer | 4 | Running consumption counter |
| `agents.tasks` | Add `materialization_type` text | 3 | `internal` or `transparent` |
| `agents.tasks` | Add `materialized_entity_id` text | 3 | External artifact reference |
| `agents.entity_directory` | Add `tier` text | 6 | Discriminate `orchestrator` vs `sub-agent` |

## New YAML Schema Fields Summary

| YAML Field | Phase | Type | Default |
|------------|-------|------|---------|
| `schedules[]` | 5 | Array of `{ name, cron, overlap, timezone }` | None (optional) |
| `identity.documents[]` | 7 | Array of `{ type, tokenLimit }` | None (optional) |
| `retrieval` | 8 | Object `{ strategies[], weights }` | None (uses vector-only default) |

---

## Installation Summary

```bash
# Only new dependency
pnpm --filter @aesir/agents add cron-parser
```

Everything else is Drizzle migrations, TypeScript interfaces, Zod schema extensions, and service logic built on existing infrastructure.

---

## Sources

- pg-boss v12.8.0 types: Verified from installed `packages/agents/node_modules/pg-boss/dist/types.d.ts` and `dist/index.d.ts`
- pg-boss schedule API: `schedule(name, cron, data?, options?: { tz?, key? })` confirmed in type definitions
- pg-boss ScheduleOptions type: `SendOptions & { tz?: string; key?: string }` verified
- cron-parser: [npm](https://www.npmjs.com/package/cron-parser), [GitHub](https://github.com/harrisiirak/cron-parser)
- croner alternative: [npm](https://www.npmjs.com/package/croner), [GitHub](https://github.com/Hexagon/croner)
- Drizzle ORM column types: [PostgreSQL column types docs](https://orm.drizzle.team/docs/column-types/pg)
- Existing codebase: All integration points verified via source code reading of `packages/agents/src/`
