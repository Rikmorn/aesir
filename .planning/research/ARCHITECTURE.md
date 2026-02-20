# Architecture Patterns: v2.9 Platform Completion

**Domain:** 8 new capabilities for an existing agentic development platform
**Researched:** 2026-02-20
**Overall confidence:** HIGH (deep codebase analysis, all integration points verified against source code)

---

## Architectural Principle: v2.9 Completes the Platform

v2.9 adds the final platform capabilities before domain modeling (v3.0). Every feature integrates with existing infrastructure. The design constraint from the spec: "all capabilities must be additive -- v2.7's existing delegation, knowledge, and directory systems continue working unchanged."

The 8 features decompose into three integration patterns:

1. **Extend existing services/tools** (Phases 1, 2, 3, 4): Negotiation, parallel delegation, materialization, and tree budgets all extend the existing TaskService + DelegationDeps + signal infrastructure
2. **New infrastructure alongside existing** (Phases 5, 6, 7): Scheduled execution, sub-agent discovery, and persistent identity add new services bootstrapped in main.ts
3. **Refactor existing pipeline** (Phase 8): Knowledge retrieval enhancement restructures the existing KnowledgeService query path

---

## Feature-by-Feature Architecture

### Phase 1: Richer Negotiation

**Integration type:** Extend existing tools and signal types. No new tables. No new services.

**What changes:**

| Component | Change |
|-----------|--------|
| `task:respond` tool (`shared/tools/task/respond-task.ts`) | Add `counter_propose` response type alongside existing `accept`/`reject`. Counter-propose carries `modifiedScope` (free-text) and optional `modifiedEstimate` |
| `task:clarify` tool (NEW: `shared/tools/task/clarify-task.ts`) | New tool for target agents. Sends `task_clarification` signal to delegator's conversation with question and optional structured options |
| `DelegateTaskInputSchema` | No change -- delegation brief format stays the same |
| `WaitForState` / `signal-matching.ts` | No change -- `task_clarification` is just another signal type that matches via existing multi-type `wait_for` |
| Signal types (`framework/types.ts`) | Add `task_clarification` and `task_counter_propose` to `KNOWN_SIGNAL_TYPES` documentation (signals are already open strings, not enums) |
| Conversations table | No change -- `active_delegations` JSONB already carries delegation state; `handshakeStatus` field can hold `counter_proposed` |
| `computeUpdatedDelegations()` (worker-loop.ts) | Extend to handle `task_counter_propose` signal type -- update handshakeStatus to `counter_proposed` |
| Agent prompts | Guidance on when to counter-propose vs reject, when to ask for clarification vs proceed |

**Data flow -- Counter-propose:**

```
Target agent calls task:respond({ response: "counter_propose", modifiedScope: "..." })
  -> TaskService.update(taskId, { status: "created" })  // stays created, not accepted
  -> Signal to delegator: { type: "task_handshake", data: { response: "counter_proposed", modifiedScope } }
  -> Delegator resumes, sees modification, decides: accept modified, reject, or try someone else
  -> If accepted: delegator signals target with type: "task_counter_accepted"
  -> Target's wait_for resumes, task transitions to active
```

**Data flow -- Clarification:**

```
Target agent (mid-work) calls task:clarify({ taskId, question: "Which API version?" })
  -> Finds delegator's active conversation via task.parent_id -> executor.findActiveForTask()
  -> Signal to delegator: { type: "task_clarification", data: { taskId, question } }
  -> Delegator resumes, reads question, formulates answer
  -> Delegator signals target: { type: "task_clarification_response", data: { taskId, answer } }
  -> Target's wait_for resumes with the answer
```

**New components:**
- `shared/tools/task/clarify-task.ts` -- new tool factory (~80 lines, mirrors respond-task.ts pattern)

**Modified components:**
- `shared/tools/task/respond-task.ts` -- extend `RespondTaskInputSchema` with `counter_propose` option
- `worker-loop.ts` -- extend `computeUpdatedDelegations()` for new signal types
- `framework/types.ts` -- add signal type documentation
- `tool-factories.ts` -- register `task:clarify`
- Agent definition YAMLs -- add `task:clarify` to tool lists for delegatable agents
- Agent prompts -- negotiation guidance

**No schema migrations required.**

---

### Phase 2: Parallel Delegation

**Integration type:** New table for task groups, new tools, extends TaskService. Extends signal aggregation logic.

**What changes:**

| Component | Change |
|-----------|--------|
| New table: `agents.task_groups` | Groups of delegated tasks with completion policy |
| `task:delegate_group` tool (NEW) | Creates multiple delegations as a named group |
| `task:group_status` tool (NEW) | Returns aggregated group state |
| `task:cancel_group` tool (NEW) | Cancels remaining tasks in a group |
| `TaskService` | Add group CRUD methods: `createGroup()`, `getGroup()`, `updateGroupMember()` |
| `TaskSignalDispatcher` | Extend to evaluate group completion policies when member tasks complete. Only signal delegator when policy is satisfied |
| `conversations.active_delegations` | Group tasks appear as individual entries but with a shared `groupId` |

**New table schema:**

```sql
CREATE TABLE agents.task_groups (
  id TEXT PRIMARY KEY,
  name TEXT,
  policy TEXT NOT NULL,  -- 'all_required' | 'any_sufficient' | 'majority'
  majority_count INTEGER,  -- only for 'majority' policy
  delegator_task_id TEXT REFERENCES agents.tasks(id),
  delegator_conversation_id TEXT REFERENCES agents.conversations(id),
  status TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'completed' | 'cancelled'
  -- Budget fields for Phase 4 retrofit
  tree_budget_tokens INTEGER,
  budget_allocated_tokens INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Junction: group membership
ALTER TABLE agents.tasks ADD COLUMN group_id TEXT REFERENCES agents.task_groups(id);
CREATE INDEX idx_tasks_group ON agents.tasks(group_id);
```

**Data flow -- Fan-out delegation:**

```
Orchestrator calls task:delegate_group({
  name: "parallel-research",
  policy: "any_sufficient",
  delegations: [
    { targetEntityId: "agent-a", description: "Research approach 1" },
    { targetEntityId: "agent-b", description: "Research approach 2" },
    { targetEntityId: "agent-c", description: "Research approach 3" },
  ]
})
  -> Creates task_group row with policy
  -> Creates 3 tasks (each with group_id)
  -> Starts 3 conversations via executor.start()
  -> Writes 3 entries to delegator's active_delegations
  -> Returns groupId
  -> Agent calls wait_for with types: ["task_completion", "task_failure", "task_timeout"]

Each target goes through individual handshake (accept/reject)

When agent-b completes first:
  -> TaskSignalDispatcher checks: is task in a group?
  -> YES: evaluate policy. any_sufficient + 1 complete = SATISFIED
  -> Signal delegator: { type: "task_group_completed", data: { groupId, satisfiedBy: taskId } }
  -> Delegator resumes, can call task:cancel_group to stop remaining
```

**Signal aggregation logic in TaskSignalDispatcher:**

```typescript
// In onTaskUpdate():
if (task.group_id) {
  const group = await taskService.getGroup(task.group_id);
  const members = await taskService.getGroupMembers(task.group_id);

  const completed = members.filter(m => m.status === 'completed');
  const failed = members.filter(m => m.status === 'cancelled' || m.status === 'failed');

  let satisfied = false;
  switch (group.policy) {
    case 'any_sufficient': satisfied = completed.length >= 1; break;
    case 'all_required': satisfied = completed.length === members.length; break;
    case 'majority': satisfied = completed.length >= (group.majority_count ?? Math.ceil(members.length / 2)); break;
  }

  if (satisfied) {
    // Signal delegator with group completion
  } else if (group.policy === 'all_required' && failed.length > 0) {
    // Immediate notification to delegator about failure
  }
}
```

**New components:**
- `shared/tools/task/delegate-group.ts` -- composite tool (~150 lines)
- `shared/tools/task/group-status.ts` -- read-only query tool (~60 lines)
- `shared/tools/task/cancel-group.ts` -- cancellation tool (~80 lines)
- `shared/services/task-service.ts` -- add group methods

**Modified components:**
- `shared/db/schema.ts` -- add `task_groups` table, add `group_id` to tasks
- `shared/services/task-signal-dispatcher.ts` -- group policy evaluation
- `tool-factories.ts` -- register 3 new tools
- `worker-loop.ts` -- extend `computeUpdatedDelegations()` for group signals
- `service/main.ts` -- no change (TaskService already bootstrapped)

---

### Phase 3: Transparent Materialization

**Integration type:** New materialization dispatch module, extends `task:delegate` tool, adds bidirectional Linear sync.

**What changes:**

| Component | Change |
|-----------|--------|
| `task:delegate` tool | Add optional `materialization` parameter: `"internal"` (default) or `"transparent"` |
| New module: `MaterializationDispatcher` | Dispatches transparent materialization to integration-specific handlers |
| New: Linear materialization handler | Creates Linear issue via MCP, registers work correlation |
| `TaskSignalDispatcher` | On task completion, if materialized, update the external artifact |
| `CorrelationService` | Already exists (Phase 78) -- used to link materialized artifact back to task |
| EventRouter / webhook handling | Correlation-based routing already handles incoming webhooks for materialized artifacts |

**Materialization dispatcher architecture:**

```typescript
// shared/services/materialization-dispatcher.ts
interface MaterializationHandler {
  materialize(task: Task, entity: DirectoryEntry, brief: string): Promise<MaterializationResult>;
  syncCompletion(task: Task, result: Record<string, unknown>): Promise<void>;
}

interface MaterializationResult {
  artifactType: string;  // "linear_issue" | "github_issue" | ...
  artifactId: string;    // External ID
  artifactUrl?: string;  // Human-accessible URL
}

// Registry pattern: handlers registered by integration name
const handlers = new Map<string, MaterializationHandler>();
handlers.set("linear", createLinearMaterializationHandler({ ... }));
```

**Data flow -- Transparent materialization:**

```
Agent calls task:delegate({ targetEntityId: "dev-agent", description: "...", materialization: "transparent" })
  -> Creates task (same as before)
  -> MaterializationDispatcher.materialize(task, entity, description)
     -> LinearMaterializationHandler:
        1. callMcpTool("linear", "create_issue", { title, description, assigneeId: entity.linearUserId })
        2. correlationService.register({ entityType: "linear_issue", entityId: issueId, conversationId })
        3. Returns { artifactType: "linear_issue", artifactId: issueId }
  -> Task metadata updated with materialization info
  -> Starts target conversation (same as before)
  -> Target agent has access to Linear issue context

On task completion:
  -> TaskSignalDispatcher calls MaterializationDispatcher.syncCompletion()
     -> LinearMaterializationHandler: callMcpTool("linear", "update_issue", { id: issueId, state: { name: "Done" } })

On incoming Linear webhook (issue updated by human):
  -> CorrelationService resolves issueId -> conversationId
  -> Signal routed to target agent's conversation (existing v2.8 correlation routing)
```

**Extensibility:** The `MaterializationHandler` interface supports future targets (GitHub issues, Slack threads) without changing the delegation tool. Only a new handler + registration needed.

**New components:**
- `shared/services/materialization-dispatcher.ts` -- dispatcher + handler interface (~120 lines)
- `shared/services/materialization/linear-handler.ts` -- Linear-specific handler (~100 lines)

**Modified components:**
- `shared/tools/task/delegate-task.ts` -- add `materialization` parameter, call dispatcher
- `shared/services/task-signal-dispatcher.ts` -- call `syncCompletion()` on terminal transitions
- `service/main.ts` -- bootstrap MaterializationDispatcher with handlers
- `tool-factories.ts` -- pass materialization dispatcher into delegation deps

**Schema changes:**
- `agents.tasks` -- add `materialization JSONB` column for tracking artifact info

---

### Phase 4: Tree-Level Token Budgets

**Integration type:** New budget tracking table, modifies ConversationExecutor start flow, extends worker loop budget management.

**What changes:**

| Component | Change |
|-----------|--------|
| New table: `agents.tree_budgets` | Tracks token allocation and usage across delegation trees |
| `task:delegate` tool | Accept optional `treeBudgetTokens` for root delegation; accept `budgetAllocation` for sub-delegations |
| `task:tree_budget` tool (NEW) | Returns current tree budget usage and remaining |
| `TokenBudget` (`shared/agent-loop/token-budget.ts`) | Extend to support tree-level tracking alongside per-conversation budgets |
| Worker loop | When conversation has a tree budget, create TokenBudget from tree allocation instead of definition default |
| `TaskSignalDispatcher` | On tree budget exhaustion, signal all active conversations in the tree |
| Conversations table | Add `tree_budget_id TEXT` column |
| Task groups (Phase 2) | Groups reference tree budget for shared allocation |

**New table schema:**

```sql
CREATE TABLE agents.tree_budgets (
  id TEXT PRIMARY KEY,
  root_task_id TEXT NOT NULL REFERENCES agents.tasks(id),
  total_tokens INTEGER NOT NULL,
  consumed_tokens INTEGER NOT NULL DEFAULT 0,
  warning_threshold_pct INTEGER NOT NULL DEFAULT 80,
  status TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'warning' | 'exhausted'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-conversation allocation within a tree
CREATE TABLE agents.tree_budget_allocations (
  tree_budget_id TEXT NOT NULL REFERENCES agents.tree_budgets(id),
  conversation_id TEXT NOT NULL REFERENCES agents.conversations(id),
  allocated_tokens INTEGER NOT NULL,
  consumed_tokens INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tree_budget_id, conversation_id)
);
```

**Budget propagation flow:**

```
Root delegation: task:delegate({ treeBudgetTokens: 200000, ... })
  -> Creates tree_budget row (total: 200000)
  -> Creates allocation for target conversation (allocated: 200000 or fraction)
  -> Worker loop reads allocation, creates TokenBudget from it

Sub-delegation within tree:
  -> Inherits tree_budget_id from parent task
  -> Agent specifies budgetAllocation or defaults to equal split of remaining
  -> New allocation row created for sub-conversation
  -> Consumed tokens tracked per-allocation AND aggregated on tree_budget

Token tracking:
  -> onResponse callback in worker loop reports input+output tokens
  -> Atomically increment tree_budget_allocations.consumed_tokens
  -> Atomically increment tree_budgets.consumed_tokens (parent aggregate)
  -> Check threshold: if consumed >= warning_threshold_pct * total -> status='warning', signal all
  -> If consumed >= total -> status='exhausted', signal all active conversations
```

**Key design decision:** Token tracking uses atomic `UPDATE ... SET consumed_tokens = consumed_tokens + $delta` to handle concurrent conversations in the same tree. No locks needed -- the aggregate is eventually consistent (acceptable for budget warnings).

**Backward compatibility:** Conversations without a `tree_budget_id` use per-conversation budgets from the agent definition (existing behavior). The worker loop checks for tree budget first; if absent, falls through to definition budget.

**New components:**
- `shared/services/tree-budget-service.ts` -- CRUD + atomic token tracking (~200 lines)
- `shared/tools/task/tree-budget.ts` -- `task:tree_budget` read tool (~50 lines)

**Modified components:**
- `shared/db/schema.ts` -- add `tree_budgets`, `tree_budget_allocations` tables; add `tree_budget_id` to conversations
- `shared/tools/task/delegate-task.ts` -- propagate tree budget on delegation
- `worker-loop.ts` -- read tree budget allocation, create TokenBudget from it, report usage
- `shared/agent-loop/token-budget.ts` -- add tree-level reporting callback
- `service/main.ts` -- bootstrap TreeBudgetService
- Dashboard -- tree budget visualization in task tree view

---

### Phase 5: Scheduled Agent Execution

**Integration type:** New schedule registry using existing pg-boss, synthetic events through existing EventRouter.

**What changes:**

| Component | Change |
|-----------|--------|
| `AgentDefinitionYamlSchema` (types.ts) | Add optional `schedules` array field |
| `AgentRegistry` | Parse and validate schedules from YAML |
| New: `ScheduleRegistry` | Registers pg-boss scheduled jobs on startup for all agents with schedules |
| `TimeoutScheduler` / pg-boss | Reuse existing pg-boss instance for schedule jobs |
| EventRouter | No change -- synthetic `schedule.triggered` events route through existing `start` trigger matching |
| Conversations table | No change -- scheduled conversations are regular conversations |
| New table: `agents.schedule_runs` | Track schedule execution history |
| API endpoint | `POST /api/schedules/:name/trigger` for manual triggers |
| Dashboard | Schedule visibility page |

**Definition.yaml extension:**

```yaml
schedules:
  - name: weekly-grooming
    cron: "0 9 * * MON"
    overlap: skip          # 'skip' | 'queue'
    timezone: "UTC"        # Optional, defaults to UTC
```

**Zod schema addition to AgentDefinitionYamlSchema:**

```typescript
schedules: z.array(z.object({
  name: z.string().min(1),
  cron: z.string().min(1),  // Validated at registration time by pg-boss
  overlap: z.enum(["skip", "queue"]).default("skip"),
  timezone: z.string().default("UTC"),
})).optional(),
```

**Schedule registration flow (on startup):**

```
main.ts bootstrap:
  -> ScheduleRegistry.initialize(agentRegistry, boss)
     -> For each agent definition with schedules:
        -> For each schedule:
           -> boss.schedule(queueName, cron, { agentId, scheduleName })
           -> boss.work(queueName, handler)
              handler:
                1. Check overlap: query agents.schedule_runs for last run status
                2. If overlap=skip and last run still active -> log skip, return
                3. Create schedule_runs row (status: started)
                4. Build synthetic IncomingEvent:
                   { type: "schedule.triggered", source: "scheduler",
                     payload: { agentId, scheduleName, lastRunAt, lastRunOutcome } }
                5. Route through executor.start() directly (deterministic, no EventRouter LLM needed)
                6. Update schedule_runs on completion
```

**Why executor.start() directly instead of EventRouter:** Schedule triggers are deterministic -- we know exactly which agent to start. Routing through EventRouter would waste an LLM call on something that's always the same answer. The EventRouter is for ambiguous events.

**New table:**

```sql
CREATE TABLE agents.schedule_runs (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  schedule_name TEXT NOT NULL,
  conversation_id TEXT REFERENCES agents.conversations(id),
  status TEXT NOT NULL DEFAULT 'started',  -- 'started' | 'completed' | 'failed' | 'skipped'
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  outcome_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_schedule_runs_agent ON agents.schedule_runs(agent_id, schedule_name, started_at DESC);
```

**Context injection:** The scheduled conversation's initial message includes:

```xml
<schedule_context>
Schedule: weekly-grooming
Last run: 2026-02-13T09:00:00Z (completed, summary: "Groomed 3 items")
Time since last run: 7 days
</schedule_context>

Your scheduled task: Review and groom the product backlog.
```

**New components:**
- `framework/schedule-registry.ts` -- pg-boss schedule registration + overlap logic (~200 lines)
- `shared/db/schema.ts` -- add `schedule_runs` table
- API endpoint in `service/api/router.ts` -- manual trigger
- Dashboard schedule pages

**Modified components:**
- `framework/types.ts` -- extend `AgentDefinitionYamlSchema` with `schedules`
- `framework/agent-registry.ts` -- parse schedules (automatic via Zod)
- `service/main.ts` -- bootstrap ScheduleRegistry after pg-boss starts
- Agent definition YAMLs -- add schedule blocks where needed

---

### Phase 6: Sub-Agent Discovery

**Integration type:** New sub-agent registry (reuses pgvector), extends `coordination:spawn_agent` tool.

**What changes:**

| Component | Change |
|-----------|--------|
| `AgentDefinitionYamlSchema` | Already has `capabilities` field (added in v2.7). Sub-agents declare capabilities the same way |
| New: `SubAgentRegistry` service | Internal registry queryable by capability, separate from entity directory |
| `coordination:spawn_agent` tool | Accept optional `capability` parameter alongside existing `agentType` |
| `SpawnAgentDeps` (types.ts) | Add `subAgentRegistry` reference |
| Worker loop | Populate `subAgentRegistry` in `spawnDeps` |

**Design decision: Separate table vs entity_directory with tier discriminator.**

Use the entity_directory table with a `tier` column. Rationale: same embedding pipeline, same pgvector infrastructure, same seed pattern. The tier discriminator cleanly separates orchestrators (visible to each other via `directory:find`) from sub-agents (visible only via `spawn_agent` capability matching). Adding a separate table would duplicate the embedding generation, seed script, and query infrastructure.

**Schema change:**

```sql
ALTER TABLE agents.entity_directory ADD COLUMN tier TEXT NOT NULL DEFAULT 'orchestrator';
-- tier: 'orchestrator' (existing entries) | 'sub_agent' (new)
CREATE INDEX idx_directory_tier ON agents.entity_directory(tier, status);
```

**DirectoryService modification:** All existing queries add `WHERE tier = 'orchestrator'` to preserve backward compatibility. A new `findSubAgent(capability: string)` method queries `WHERE tier = 'sub_agent'`.

**Seed script modification:** The existing `seed-directory.ts` already reads capabilities from definition.yaml. Extend it to detect sub-agents (agents with no triggers and no directory entry type 'agent') and seed them with `tier = 'sub_agent'`.

**spawn_agent tool modification:**

```typescript
const SpawnAgentInputSchema = z.object({
  agentType: z.string().optional()   // Existing: role key from subAgents map
    .describe("Role of sub-agent (from subAgents mapping)"),
  capability: z.string().optional()  // NEW: semantic capability description
    .describe("Capability needed (e.g., 'write production-quality code')"),
  task: z.string().describe("Task for the sub-agent"),
  context: z.string().optional(),
}).refine(
  data => data.agentType || data.capability,
  "Either agentType or capability is required"
);

// Resolution logic:
// 1. If agentType provided: existing hardcoded lookup (backward compat)
// 2. If capability provided: query SubAgentRegistry for best match
// 3. If both: agentType takes precedence (explicit > discovery)
```

**New components:**
- `shared/services/sub-agent-registry.ts` -- thin wrapper over DirectoryService with tier filter (~60 lines)

**Modified components:**
- `shared/db/schema.ts` -- add `tier` column to entity_directory
- `shared/services/directory-service.ts` -- add `findSubAgent()` method, add tier filter to `find()`
- `shared/tools/coordination/spawn-agent.ts` -- add `capability` parameter, resolution logic
- `framework/types.ts` -- add `subAgentRegistry` to SpawnAgentDeps
- `worker-loop.ts` -- pass subAgentRegistry in spawnDeps
- `scripts/seed-directory.ts` -- seed sub-agents with tier discriminator
- `service/main.ts` -- no change (DirectoryService already bootstrapped)

---

### Phase 7: Persistent Agent Identity

**Integration type:** New table, new tools (`identity:*`), new lifecycle hook in worker loop for context injection.

**What changes:**

| Component | Change |
|-----------|--------|
| New table: `agents.identity_documents` | Versioned structured documents scoped to agent roles |
| New tools: `identity:update`, `identity:read` | Agent tools for managing identity documents |
| Worker loop -- conversation start | Inject identity documents into system prompt preamble |
| Worker loop -- conversation end | Lifecycle hook: prompt agent to update identity before completing |
| New: `IdentityService` | CRUD + version management for identity documents |

**New table schema:**

```sql
CREATE TABLE agents.identity_documents (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  document_type TEXT NOT NULL,  -- 'product_brief', 'architectural_model', etc.
  content TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  token_count INTEGER NOT NULL DEFAULT 0,
  max_tokens INTEGER NOT NULL DEFAULT 4000,  -- per-type configurable limit
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(agent_id, document_type, version)
);
CREATE INDEX idx_identity_agent ON agents.identity_documents(agent_id, document_type);
CREATE INDEX idx_identity_latest ON agents.identity_documents(agent_id, document_type, version DESC);
```

**Version strategy:** Each update creates a new version row (append-only). Queries use `ORDER BY version DESC LIMIT 1` for latest. Full history retained for audit and dashboard version comparison.

**Context injection at conversation start (worker loop):**

```
executeConversation():
  // After loading agent definition, before running agent loop
  if (identityService) {
    const docs = await identityService.getLatest(conv.agent_definition_id);
    if (docs.length > 0) {
      const identityBlock = buildIdentityBlock(docs);
      // Prepend to system prompt (not initial message -- identity is persistent context)
      definition.systemPrompt = `${identityBlock}\n\n${definition.systemPrompt}`;
    }
  }
```

**Identity block format:**

```xml
<agent_identity>
<document type="product_brief" updated="2026-02-20T10:00:00Z" version="5">
[content]
</document>
<document type="architectural_model" updated="2026-02-19T15:30:00Z" version="3">
[content]
</document>
</agent_identity>
```

**Lifecycle hook -- identity update prompt:**

This is the first lifecycle hook. Per the spec: "Phases 7 and 8 both inject agent turns at lifecycle boundaries. Whichever is built first should establish the general lifecycle hook mechanism so the other plugs into it."

**Lifecycle hook mechanism (new concept):**

```typescript
// framework/lifecycle-hooks.ts
interface LifecycleHook {
  name: string;
  phase: 'pre_completion' | 'pre_compaction';
  shouldRun: (ctx: LifecycleContext) => boolean;
  prompt: string;  // Injected as user message
  toolRestriction?: string[];  // Only these tools available during hook turn
  sentinel?: string;  // Agent response indicating "nothing to do"
}

// Worker loop integrates hooks at lifecycle boundaries:
// pre_completion: after agent loop returns completed, before persisting
// pre_compaction: before history manager runs, before the agent loop
```

Phase 7 registers `pre_completion` hook:
- **shouldRun:** Agent has `identity:update` in its tools AND conversation is completing (not pausing)
- **prompt:** "Review this conversation for significant learnings. Update your identity documents if you discovered something important about your domain."
- **toolRestriction:** `["identity:update", "identity:read"]`
- **sentinel:** Agent responds "No identity updates needed" -- hook completes without action

Phase 8 registers `pre_compaction` hook (see below).

**Graceful degradation:** If identity document loading fails, conversation starts without them. Agent operates with higher context cost (may need to query knowledge more) but doesn't fail.

**New components:**
- `shared/services/identity-service.ts` -- CRUD + versioning (~150 lines)
- `shared/tools/identity/update.ts` -- identity:update tool factory
- `shared/tools/identity/read.ts` -- identity:read tool factory
- `shared/tools/identity/index.ts` -- barrel export
- `framework/lifecycle-hooks.ts` -- lifecycle hook mechanism (~100 lines)
- Dashboard: identity document viewer with version comparison

**Modified components:**
- `shared/db/schema.ts` -- add `identity_documents` table
- `worker-loop.ts` -- inject identity at conversation start, run lifecycle hooks at completion
- `tool-factories.ts` -- register `identity:update`, `identity:read`
- `service/main.ts` -- bootstrap IdentityService, register lifecycle hooks

---

### Phase 8: Knowledge Retrieval Enhancement

**Integration type:** Refactor KnowledgeService query pipeline, add retrieval config to agent definitions, add pre-compaction lifecycle hook.

**What changes:**

| Component | Change |
|-----------|--------|
| `KnowledgeService.query()` | Refactored into pluggable strategy pipeline |
| New: `RetrievalStrategy` interface | Pluggable strategy abstraction |
| New: `VectorRetrievalStrategy` | Default: current cosine similarity (refactored from KnowledgeService) |
| New: `StrategyRegistry` | Maps strategy names to implementations |
| New: `ScoreFusion` module | Combines scores from multiple strategies (designed for hybrid, only vector ships) |
| `AgentDefinitionYamlSchema` | Add optional `retrieval` config block |
| Worker loop | Pre-compaction lifecycle hook prompts agent to persist knowledge |
| History manager | No change -- lifecycle hook runs before compaction |

**Retrieval strategy interface:**

```typescript
interface RetrievalStrategy {
  name: string;
  search(query: string, options: RetrievalOptions): Promise<ScoredResult[]>;
}

interface ScoredResult {
  entry: KnowledgeEntry;
  score: number;  // 0-1 normalized
  strategy: string;  // which strategy produced this
}

interface RetrievalOptions {
  agentId: string;
  type?: string;
  limit: number;
  metadata?: Record<string, unknown>;
}
```

**Score fusion (designed for future hybrid):**

```typescript
interface ScoreFusionConfig {
  method: 'weighted_sum' | 'reciprocal_rank';  // rrf for future
  weights: Record<string, number>;  // strategy name -> weight
}

// v2.9 ships with single-strategy (vector only), but the fusion
// interface is in place for v3.0 to add keyword/temporal/diversity strategies
function fuseScores(results: Map<string, ScoredResult[]>, config: ScoreFusionConfig): ScoredResult[] {
  // Weighted sum of normalized scores across strategies
}
```

**Agent definition retrieval config:**

```yaml
# definition.yaml addition (optional, absent = vector-only default)
retrieval:
  strategies:
    - type: vector
      weight: 1.0
  # Future v3.0 additions:
  # - type: keyword
  #   weight: 0.3
  # - type: temporal_decay
  #   weight: 0.2
  #   halfLifeDays: 7
```

**Pre-compaction knowledge flush (lifecycle hook):**

Uses the lifecycle hook mechanism established by Phase 7.

- **Phase:** `pre_compaction`
- **shouldRun:** Agent has `knowledge:store` in its tools AND compaction is about to happen (estimatedTokens > pruneThreshold)
- **prompt:** "History compaction is about to compress your conversation. Review the conversation for discoveries, decisions, and context that should persist beyond this conversation. Store anything important via knowledge_store. Respond with 'FLUSH_COMPLETE' when done or 'NOTHING_TO_STORE' if nothing needs persisting."
- **toolRestriction:** `["knowledge_store"]`
- **sentinel:** `"NOTHING_TO_STORE"`
- **safeguard:** Track flush count per conversation to prevent double-flushing. Skip if agent has no knowledge tools.

**Integration with history manager:**

```
Worker loop executeConversation():
  // Step 7 (history compaction) becomes:
  if (needsCompaction) {
    // Run pre_compaction hooks first
    await runLifecycleHooks('pre_compaction', hookContext);
    // Then run compaction
    const compactionResult = await historyManager.compact(...);
  }
```

**New components:**
- `shared/services/retrieval/strategy.ts` -- interface + registry (~80 lines)
- `shared/services/retrieval/vector-strategy.ts` -- refactored from KnowledgeService (~100 lines)
- `shared/services/retrieval/score-fusion.ts` -- fusion interface + weighted_sum impl (~60 lines)

**Modified components:**
- `shared/services/knowledge-service.ts` -- query() delegates to strategy pipeline
- `framework/types.ts` -- extend `AgentDefinitionYamlSchema` with `retrieval` block
- `framework/lifecycle-hooks.ts` -- register pre_compaction hook (established by Phase 7)
- `worker-loop.ts` -- run pre_compaction hooks before history compaction

---

## Component Boundaries Summary

| Component | Responsibility | Phase | New/Modified |
|-----------|---------------|-------|-------------|
| `task:clarify` tool | Clarification signal from target to delegator | 1 | NEW |
| `task:respond` (extended) | Accept/reject/counter-propose responses | 1 | MODIFIED |
| `task:delegate_group` tool | Fan-out delegation with policies | 2 | NEW |
| `task:group_status` tool | Group state aggregation | 2 | NEW |
| `task:cancel_group` tool | Cancel remaining group tasks | 2 | NEW |
| `TaskGroups` (in TaskService) | Group lifecycle management | 2 | MODIFIED |
| `TaskSignalDispatcher` (extended) | Group policy evaluation | 2 | MODIFIED |
| `MaterializationDispatcher` | External artifact creation dispatch | 3 | NEW |
| `LinearMaterializationHandler` | Linear issue creation/sync | 3 | NEW |
| `TreeBudgetService` | Tree-level token allocation/tracking | 4 | NEW |
| `task:tree_budget` tool | Budget visibility for agents | 4 | NEW |
| `ScheduleRegistry` | pg-boss schedule registration | 5 | NEW |
| `SubAgentRegistry` | Capability-based sub-agent discovery | 6 | NEW |
| `IdentityService` | Identity document CRUD + versioning | 7 | NEW |
| `identity:update` tool | Agent identity document updates | 7 | NEW |
| `identity:read` tool | Agent identity document reads | 7 | NEW |
| Lifecycle hook mechanism | General hook system for lifecycle boundaries | 7 | NEW |
| `RetrievalStrategy` interface | Pluggable retrieval pipeline | 8 | NEW |
| `VectorRetrievalStrategy` | Default vector search (refactored) | 8 | NEW |
| `ScoreFusion` | Multi-strategy score combination | 8 | NEW |

---

## Data Model Changes Summary

### New Tables

| Table | Phase | Purpose |
|-------|-------|---------|
| `agents.task_groups` | 2 | Parallel delegation groups with policies |
| `agents.tree_budgets` | 4 | Token budget tracking across delegation trees |
| `agents.tree_budget_allocations` | 4 | Per-conversation budget allocations within trees |
| `agents.schedule_runs` | 5 | Schedule execution history |
| `agents.identity_documents` | 7 | Versioned agent identity documents |

### Table Modifications

| Table | Column/Change | Phase |
|-------|--------------|-------|
| `agents.tasks` | Add `group_id TEXT` | 2 |
| `agents.tasks` | Add `materialization JSONB` | 3 |
| `agents.conversations` | Add `tree_budget_id TEXT` | 4 |
| `agents.entity_directory` | Add `tier TEXT DEFAULT 'orchestrator'` | 6 |

### No Schema Changes

| Phase | Reason |
|-------|--------|
| Phase 1 (Negotiation) | Uses existing signal types, existing conversations.active_delegations |
| Phase 8 (Knowledge Retrieval) | Query pipeline change only, existing knowledge_entries table unchanged |

---

## Build Order and Dependencies

```
             Phase 1: Richer Negotiation
                      |
                      v
             Phase 2: Parallel Delegation --------+
                      |                            |
                      v                            |
             Phase 4: Tree-Level Token Budgets     |
                                                   |
Independent (can run parallel to Phase 1-2-4 chain):
                                                   |
  Phase 3: Transparent Materialization (after v2.8)|
  Phase 5: Scheduled Agent Execution (after v2.8)  |
  Phase 6: Sub-Agent Discovery (after v2.8)        |
  Phase 7: Persistent Agent Identity (after v2.8) -+-- Phase 7 BEFORE Phase 8
  Phase 8: Knowledge Retrieval Enhancement --------+   (establishes lifecycle hooks)
```

### Suggested Build Order

**Wave 1 (no inter-dependencies):**
- Phase 1: Richer Negotiation
- Phase 3: Transparent Materialization
- Phase 5: Scheduled Agent Execution
- Phase 6: Sub-Agent Discovery

**Wave 2 (depends on Wave 1 Phase 1):**
- Phase 2: Parallel Delegation
- Phase 7: Persistent Agent Identity (independent but establishes lifecycle hooks needed by Phase 8)

**Wave 3 (depends on Wave 2):**
- Phase 4: Tree-Level Token Budgets (depends on Phase 2)
- Phase 8: Knowledge Retrieval Enhancement (depends on Phase 7 lifecycle hooks)

### Build Order Rationale

1. **Phase 1 first in Wave 1** because Phase 2 builds on the richer negotiation primitives (counter-propose composing with group handshakes)

2. **Phases 3, 5, 6 are truly independent** -- they touch different parts of the system with no shared state. Running them in parallel with Phase 1 maximizes throughput

3. **Phase 7 before Phase 8** because the lifecycle hook mechanism is a shared infrastructure concern. Phase 7 establishes the `pre_completion` hook pattern; Phase 8 plugs into it with `pre_compaction`. Building them in opposite order would require Phase 8 to establish the mechanism AND use it, creating a larger PR

4. **Phase 4 after Phase 2** because tree budgets need the group data model (task_groups.tree_budget_tokens) and the fan-out patterns to apply budget distribution

5. **Phase 2 after Phase 1** because group delegations should support counter-propose in individual handshakes within the group

---

## Cross-Cutting Concerns

### Worker Loop Modifications (Aggregate)

The worker loop (`worker-loop.ts`) is the most modified component across all phases. Changes should be carefully sequenced to avoid conflicts:

| Area | Phase | Change |
|------|-------|--------|
| `computeUpdatedDelegations()` | 1, 2 | New signal types for counter-propose, group signals |
| Tool context creation | 4, 6 | Tree budget in TokenBudget creation; subAgentRegistry in spawnDeps |
| Conversation start | 7 | Identity document injection into system prompt |
| Pre-compaction | 8 | Lifecycle hook before history compaction |
| Post-loop / pre-completion | 7 | Lifecycle hook for identity update |
| Budget tracking | 4 | Token usage reporting to TreeBudgetService |

### ToolContext Extensions

```typescript
// Phase 4: tree budget reference
treeBudgetId?: string;

// Phase 6: sub-agent discovery
subAgentRegistry?: SubAgentRegistry;

// Phase 7: identity service
identityService?: IdentityService;
```

### Service Bootstrap Order in main.ts

```
Existing services (unchanged):
  1. Pool + Drizzle
  2. AgentRegistry
  3. ToolRegistry + registerAllTools()
  4. TaskService
  5. EmbeddingService
  6. KnowledgeService
  7. DirectoryService
  8. CorrelationService

New services (v2.9):
  9. IdentityService (Phase 7)
  10. TreeBudgetService (Phase 4)
  11. MaterializationDispatcher (Phase 3)
  12. SubAgentRegistry (Phase 6 -- thin wrapper on DirectoryService)

Existing services (extended registration):
  13. registerAllTools() -- add new tools from Phases 1-8

Existing infrastructure (unchanged):
  14. EventLog
  15. SessionProjection
  16. TimeoutScheduler

New infrastructure:
  17. ScheduleRegistry (Phase 5 -- needs pg-boss from TimeoutScheduler)
  18. Lifecycle hooks registration (Phases 7, 8)

Existing (extended):
  19. ConversationExecutor (gains tree budget + identity + lifecycle hooks)
  20. TaskSignalDispatcher (gains group policy + materialization sync)
```

### Dashboard Impact

| Feature | Dashboard Change | Scope |
|---------|-----------------|-------|
| Negotiation (1) | Counter-propose and clarification in conversation detail | Small |
| Parallel delegation (2) | Group status in task tree view | Medium |
| Transparent materialization (3) | Materialized artifact links in task detail | Small |
| Tree budgets (4) | Budget visualization in task tree | Medium |
| Scheduled execution (5) | New schedules page: list, history, manual trigger | Large |
| Sub-agent discovery (6) | Capability-based resolution in agent detail | Small |
| Persistent identity (7) | Identity document viewer with version diff | Large |
| Knowledge retrieval (8) | Retrieval strategy config in agent detail | Small |

Dashboard changes follow existing patterns: local schema mirrors in `lib/schema.ts`, server components with direct Postgres reads, no imports from `@aesir/agents`.

---

## Sources

- Existing codebase analysis: `packages/agents/src/framework/`, `packages/agents/src/shared/`, `packages/agents/definitions/`
- v2.9 spec: `.planning/specs/2.9-platform-completion.md`
- Design vision: `.planning/specs/design-vision.md`
- v2.7 architecture (predecessor): `.planning/research/ARCHITECTURE.md` (previous version)
- pg-boss documentation: pg-boss schedule API for Phase 5 cron support (verified pg-boss already used in TimeoutScheduler)
- pgvector: already in use for knowledge + directory embeddings, no new external deps
