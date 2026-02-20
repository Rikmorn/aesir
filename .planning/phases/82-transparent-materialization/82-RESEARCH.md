# Phase 82: Transparent Materialization - Research

**Researched:** 2026-02-20
**Domain:** Task delegation projection to Linear, bidirectional sync, webhook correlation
**Confidence:** HIGH

## Summary

Phase 82 adds optional materialization of delegated tasks as Linear issues, giving human operators visibility into agent-to-agent work through their existing tools. The implementation touches four layers: (1) the `delegate_task` / `delegate_group` tool parameters, (2) a new `MaterializationAdapter` that creates Linear issues via existing MCP, (3) bidirectional status sync using the existing `TaskSignalDispatcher` and new webhook handling for reverse sync, and (4) correlation records connecting Linear issue IDs to task IDs for webhook routing.

The codebase already has all the building blocks: the Linear MCP integration supports `create_issue`, `update_issue_status`, `create_comment`, and `list_labels`; the `linear.task_correlations` table provides task-to-Linear-resource mapping; the webhook filter handles dedup and echo suppression; and the adapter/router pipeline can be extended for `linear.issue.updated` events from materialized issues. The primary new code is the materialization adapter itself, the `delegate_task` schema extension, and the reverse-sync webhook handling.

**Primary recommendation:** Build a `LinearMaterializationAdapter` in `packages/agents/src/shared/services/` that wraps existing MCP tools. Wire it into `delegate_task` and `delegate_group` tools, extend the Linear MCP `create_issue` to support `parentId` for sub-issues, and add new `linear.issue.updated` handling for materialized issue status changes.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Description contains: task objective + delegator attribution + dashboard link. Keep OUT: negotiation history, delegation chain, token budgets, conversation IDs as prose, group membership details
- Internal correlation data (task_id, conversation_id) stored in Linear labels or custom fields -- machine-readable, not in description
- Priority is a target-specific property in the materialization config, set by the delegating agent
- Materialization config shape: `{ type: "transparent", target: "linear", properties: { priority: "high", labels: ["agent-delegated"] } }`
- Team placement resolution chain: explicit teamId > parent issue's team > LINEAR_TEAM_ID
- Parent Linear issue exists -> create as sub-issue; no parent -> standalone in resolved team
- Auto-apply `agent-work` Linear label on every materialized issue
- Status sync maps to Linear state types (unstarted, started, completed, canceled), not state names
- Only 3 key transitions synced: active->started, completed->completed, cancelled->canceled
- Initial creation state: unstarted type
- Reverse sync: human cancels -> task_cancelled signal; human marks Done -> informational signal; human reassigns -> cancellation with reason
- Internal task state is authoritative; Linear updates fire asynchronously
- No new dedup mechanism needed -- three-layer defense from existing infrastructure
- Human comments on materialized issues become user_reply signals
- Agent completion summary posted via prompt guidance, not infrastructure enforcement
- Per-delegation opt-in via tool parameter: `delegate_task({ materialization: { type: "transparent", target: "linear" } })`
- Default is internal (no materialization)
- Group delegation: individual issues per task, group-level materialization parameter
- All tasks in group share a label (e.g., `group-{short-id}`) for filtering
- Delegation proceeds even if materialization fails -- graceful degradation
- Build LinearMaterializationAdapter, then extract MaterializationAdapter interface from its actual public surface
- Dispatch is a simple switch on the `target` field
- No adapter registry, config-driven dispatch, or abstract base class until second target arrives

### Claude's Discretion
- Correlation record schema design (what fields, where stored)
- Linear API call batching strategy for group materializations
- Exact label naming and setup/seed implementation
- Dashboard representation of materialized tasks (if in scope)

### Deferred Ideas (OUT OF SCOPE)
- Proper human handoff via task:handoff_task -- requires human directory entries (v3.1)
- Per-agent labels in Linear (dev-agent, qa-agent)
- "Re-materialize later" if Linear comes back after initial creation failure
- @mention parsing and threading in comments
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| MAT-01 | Materialization policy parameter -- `task:delegate` accepts optional `materialization` parameter | `DelegateTaskInputSchema` in `delegate-task.ts` needs Zod extension; same for `delegate-group.ts` `TaskInGroupSchema`. The `DelegationDeps` interface already carries all needed services. |
| MAT-02 | Linear materialization -- transparent mode creates a Linear issue with description, priority, assignee, and back-link | Existing `linear:create_issue` MCP tool + `create_comment` tool. Need to add `parentId` support to `create_issue` for sub-issues. The `agent-work` label requires a seed script. |
| MAT-03 | Bidirectional sync -- status changes sync between task and Linear issue | Forward: hook into `TaskSignalDispatcher.onTaskUpdate()` or add a parallel materialization listener. Reverse: extend Linear adapter to handle `linear.issue.updated` for materialized issues, routing via `linear.task_correlations`. |
| MAT-04 | Materialization as prompt guidance -- decision is agent judgment | Prompt additions to dev-agent and product-agent `prompt.md` files with materialization heuristics. |
| MAT-05 | Materialization interface -- extensible dispatch for future targets | Build `LinearMaterializationAdapter` first, extract `MaterializationAdapter` interface from its public surface. Dispatch via `target` field switch. |
| MAT-06 | Correlation tracking -- materialized artifacts tracked for webhook routing | Extend `linear.task_correlations` or add new `agents.materialization_records` table. The existing `recordTaskCorrelation` + `lookupTaskCorrelation` pattern is the template. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @linear/sdk | 70.0.0 | Linear API (issue creation, status updates, labels) | Already in use via integration package; supports `parentId` for sub-issues |
| drizzle-orm | existing | Database schema and queries | Project standard ORM |
| zod | existing | Input validation for materialization config | Project standard validation |
| callMcpTool | existing | Agent-to-Linear communication | MCP wrapper pattern used by all integration tools |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pg-boss | existing | Timeout scheduling for async retries | Already used by TimeoutScheduler; no new dependency needed |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| MCP callMcpTool for Linear calls from materialization adapter | Direct @linear/sdk import | Violates architecture: agents package must NOT import integration SDKs; MCP provides permission checks and rate limiting |
| New materialization_records table | Extend linear.task_correlations | task_correlations only has (external_type, external_ref, task_id); materialization needs conversation_id, agent_id, materialization config. Recommend a new table. |

## Architecture Patterns

### Recommended File Structure
```
packages/agents/src/shared/services/
  materialization/
    types.ts                   # MaterializationAdapter interface, MaterializationConfig schema
    linear-adapter.ts          # LinearMaterializationAdapter (creates issues, syncs status)
    index.ts                   # Barrel export + createMaterializationDispatcher factory
packages/agents/src/shared/tools/task/
  delegate-task.ts             # Extended with materialization parameter
  delegate-group.ts            # Extended with group-level materialization parameter
packages/agents/src/adapters/
  linear.ts                    # Extended to handle linear.issue.updated for materialized issues
packages/agents/src/shared/db/
  schema.ts                    # New materialization_records table
packages/integrations/linear/
  src/mcp/schemas.ts           # Extended CreateIssueInputSchema with parentId
  src/mcp/tools/issues.ts      # Extended handleCreateIssue with parentId support
  src/api/webhooks.ts          # Extended to handle Issue.update events for materialized issues
  scripts/seed-permissions.ts  # Extended with materialization-agent permission
```

### Pattern 1: MaterializationAdapter Interface
**What:** Interface extracted from LinearMaterializationAdapter's actual public surface
**When to use:** When dispatching materialization after delegation creation
**Example:**
```typescript
// Source: Derived from existing service patterns in codebase
interface MaterializationAdapter {
  /** Create the external artifact (Linear issue). Returns external ID or null on failure. */
  create(params: {
    taskId: string;
    conversationId: string;
    agentId: string;
    description: string;
    properties: Record<string, unknown>;
    parentIssueId?: string;
  }): Promise<{ externalId: string; externalUrl: string } | null>;

  /** Sync internal status change to external artifact. Fire-and-forget. */
  syncStatus(params: {
    externalId: string;
    newStatus: 'active' | 'completed' | 'cancelled';
  }): Promise<void>;

  /** Handle incoming webhook for a materialized artifact. Returns signal or null. */
  handleWebhook(params: {
    externalId: string;
    eventType: string;
    eventData: Record<string, unknown>;
  }): { signalType: string; signalData: Record<string, unknown> } | null;
}
```

### Pattern 2: Materialization Config in Delegate Tool
**What:** Extend DelegateTaskInputSchema with optional materialization config
**When to use:** When agent calls delegate_task
**Example:**
```typescript
// Source: Extension of existing DelegateTaskInputSchema
const MaterializationConfigSchema = z.object({
  type: z.literal("transparent"),
  target: z.enum(["linear"]),  // Extensible enum for future targets
  properties: z.object({
    priority: z.enum(["urgent", "high", "medium", "low", "none"]).optional(),
    labels: z.array(z.string()).optional(),
    teamId: z.string().optional(),
  }).optional(),
}).optional();

const DelegateTaskInputSchema = z.object({
  targetEntityId: z.string().min(1),
  description: z.string().min(1),
  parentTaskId: z.string().optional(),
  materialization: MaterializationConfigSchema,  // NEW
});
```

### Pattern 3: Materialization Record (Correlation)
**What:** Database record linking tasks to their materialized external artifacts
**When to use:** Created at materialization time, queried on webhook receipt
**Example:**
```typescript
// Source: Pattern from existing linear.task_correlations + agents.work_correlations
export const materializationRecords = agentsSchema.table(
  "materialization_records",
  {
    task_id: text("task_id").notNull().primaryKey(),
    target: text("target").notNull(),           // "linear"
    external_id: text("external_id").notNull(),  // Linear issue UUID
    external_url: text("external_url"),          // Linear issue URL
    conversation_id: text("conversation_id").notNull(),
    agent_id: text("agent_id").notNull(),
    config: jsonb("config").$type<Record<string, unknown>>().notNull(),
    sync_status: text("sync_status").notNull().default("active"),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_materialization_external").on(table.target, table.external_id),
    index("idx_materialization_conversation").on(table.conversation_id),
  ],
);
```

### Pattern 4: Async Fire-and-Forget Status Sync
**What:** Status sync to Linear happens asynchronously, never blocks internal state changes
**When to use:** Forward sync (task status change -> Linear update)
**Example:**
```typescript
// Source: Pattern from existing TaskSignalDispatcher fire-and-forget
async function syncStatusToLinear(
  taskId: string,
  newStatus: string,
  adapter: LinearMaterializationAdapter,
  logger: PinoLogger,
): Promise<void> {
  try {
    const record = await lookupMaterializationRecord(taskId);
    if (!record) return; // Not materialized

    await adapter.syncStatus({
      externalId: record.external_id,
      newStatus: mapInternalToLinearState(newStatus),
    });
  } catch (error) {
    logger.error(
      { err: error, taskId },
      "Materialization status sync failed (non-fatal)",
    );
  }
}
```

### Anti-Patterns to Avoid
- **Blocking on Linear API calls during delegation:** Materialization failures must NOT prevent the delegation from proceeding. The delegate_task tool should always create the internal task first, then attempt materialization asynchronously.
- **Storing materialization state in task.metadata:** Metadata is JSONB with a 10KB limit and is shared with other concerns. Use a dedicated table.
- **Pattern-matching on Linear webhook events to override agent decisions:** Reverse sync events should be translated to signals and delivered to the agent. The agent decides what to do.
- **Mixing materialization logic into the existing TaskSignalDispatcher:** The dispatcher handles completion/failure signals to delegating agents. Materialization status sync is a separate concern that should compose alongside it, not be mixed in.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Linear issue creation | Custom Linear API client | `callMcpTool({ integration: "linear", tool: "create_issue" })` | MCP layer provides permissions, rate limiting, retry, and observability |
| Linear status updates | Direct SDK calls from agents package | `callMcpTool({ integration: "linear", tool: "update_issue_status" })` | Same reasons + architecture boundary enforcement |
| Linear label lookup | Manual API calls | `callMcpTool({ integration: "linear", tool: "list_labels" })` then cache | Existing tool with permission checks |
| Webhook deduplication | New dedup layer | Existing `WebhookFilter` (Phase 75) + `deduplicationId` on signals | Three-layer defense already handles echo and dedup |
| Echo suppression | Custom bot-detection | Existing `actorInfo.isBot` check in webhook-filter.ts | Phase 75 already classifies OauthClient actors as bots |
| ID generation | Custom ID schemes | `createId.task()`, new `createId.materializationRecord()` if needed | Consistent prefixed IDs across the system |

**Key insight:** The existing MCP infrastructure, webhook filter, and correlation patterns do 80% of the work. The new code is primarily the materialization adapter that orchestrates existing tools and a few schema extensions.

## Common Pitfalls

### Pitfall 1: Circular Webhook Loops
**What goes wrong:** Agent creates Linear issue -> Linear sends webhook -> agent processes webhook -> creates another issue
**Why it happens:** Materialized issue creation generates `linear.issue.created` webhooks that could trigger new agent conversations
**How to avoid:** Three layers already handle this: (1) `linear.issue.created` is in `IGNORE_EVENT_TYPES` set in the adapter, (2) echo suppression filters `actorInfo.isBot === true`, (3) `deduplicationId` on signals prevents duplicate delivery. For `linear.issue.updated`, the materialization adapter should set a `deduplicationId` using `mat-{issueId}-{webhookId}` format.
**Warning signs:** Conversations being created for agent-originated Linear issues

### Pitfall 2: Race Condition in Forward Sync
**What goes wrong:** Task completes -> status sync fires -> Linear API fails -> retry fires -> but task already has completion_result
**Why it happens:** Async fire-and-forget means retries and completions can overlap
**How to avoid:** Use idempotent operations. `update_issue_status` is naturally idempotent (setting status to "Done" twice is a no-op). Record sync attempts in the materialization_records table for debugging.
**Warning signs:** Duplicate Linear status transitions in logs

### Pitfall 3: Linear State Names vs State Types
**What goes wrong:** Mapping task status "completed" to Linear state "Done" fails because team uses "Closed" instead
**Why it happens:** Linear workflow states have customizable names but fixed types (unstarted, started, completed, canceled)
**How to avoid:** Resolve by state TYPE, not state NAME. The existing `update_issue_status` MCP tool resolves by name; the materialization adapter needs to resolve by type (fetch team states, find first state matching the target type).
**Warning signs:** Status sync failures with "state not found" errors

### Pitfall 4: Sub-Issue Parent Resolution
**What goes wrong:** Creating a sub-issue fails because parent issue ID is a conversation's entity reference, not a Linear issue UUID
**Why it happens:** The conversation's entityRef stores `{ entityType: "linear_issue", entityId: "issue-uuid" }` but the delegate_task call doesn't carry this
**How to avoid:** The materialization adapter needs to resolve parent Linear issue from the conversation context. Check the conversation's entityRef, work correlations, or task metadata for the parent issue ID.
**Warning signs:** Sub-issues created as standalone because parent resolution failed silently

### Pitfall 5: Group Materialization Partial Failure
**What goes wrong:** 3 of 5 tasks in a group get materialized, 2 fail -> inconsistent state
**Why it happens:** Sequential issue creation in a loop where middle items fail
**How to avoid:** Each task's materialization is independent. Per locked decision: "delegation proceeds even if materialization fails." Each task reports its materialization status individually. Failed materializations get logged but don't affect the group.
**Warning signs:** Some group tasks visible in Linear, others not

### Pitfall 6: MCP Permission Gaps
**What goes wrong:** Materialization adapter calls `create_issue` or `update_issue_status` but gets permission denied
**Why it happens:** The MCP permission system requires per-agent-per-tool entries in `linear.mcp_tool_permissions`. The materialization adapter calls MCP with the delegating agent's ID, which may not have all required permissions.
**How to avoid:** Ensure seed-permissions includes all agents that can delegate (product-agent, dev-agent) with access to `create_issue`, `update_issue_status`, `list_labels`, `list_teams`, and `create_comment`. These permissions already exist for both agents.
**Warning signs:** "Permission denied: create_issue not allowed" errors in materialization logs

## Code Examples

### Example 1: Extending DelegateTaskInputSchema
```typescript
// Source: packages/agents/src/shared/tools/task/delegate-task.ts
const MaterializationConfigSchema = z.object({
  type: z.literal("transparent"),
  target: z.enum(["linear"]),
  properties: z.object({
    priority: z.enum(["urgent", "high", "medium", "low", "none"]).optional(),
    labels: z.array(z.string()).optional(),
    teamId: z.string().optional(),
  }).optional(),
});

const DelegateTaskInputSchema = z.object({
  targetEntityId: z.string().min(1).describe("ID of the directory entity to delegate to"),
  description: z.string().min(1).describe("The delegation brief"),
  parentTaskId: z.string().optional(),
  materialization: MaterializationConfigSchema.optional()
    .describe("Optional materialization config. Use { type: 'transparent', target: 'linear' } to create a corresponding Linear issue."),
});
```

### Example 2: Linear Issue Creation via MCP in Materialization Adapter
```typescript
// Source: Pattern from existing mcp-wrapper.ts callMcpTool usage
async function createLinearIssue(params: {
  agentId: string;
  correlationId: string;
  taskId: string;
  teamId: string;
  title: string;
  description: string;
  priority?: number;
  labelIds?: string[];
  parentId?: string;
}): Promise<{ id: string; identifier: string; url: string } | null> {
  try {
    const result = await callMcpTool({
      integration: "linear",
      tool: "create_issue",
      params: {
        teamId: params.teamId,
        title: params.title,
        description: params.description,
        ...(params.priority !== undefined && { priority: params.priority }),
        ...(params.labelIds && { labelIds: params.labelIds }),
        ...(params.parentId && { parentId: params.parentId }),
      },
      agentId: params.agentId,
      correlationId: params.correlationId,
      taskId: params.taskId,
    });

    // Parse the MCP result (JSON string from mcp-wrapper)
    const parsed = JSON.parse(result.content);
    return {
      id: parsed.structuredContent.id,
      identifier: parsed.structuredContent.identifier,
      url: parsed.structuredContent.url,
    };
  } catch (error) {
    return null; // Graceful degradation per locked decision
  }
}
```

### Example 3: Extending Linear MCP create_issue with parentId
```typescript
// Source: packages/integrations/linear/src/mcp/schemas.ts
export const CreateIssueInputSchema = z.object({
  teamId: z.string().min(1, "Team ID is required"),
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  priority: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
  labelIds: z.array(z.string()).optional(),
  parentId: z.string().optional(),  // NEW: for sub-issue creation
});

// In handleCreateIssue:
if (input.parentId !== undefined) {
  createParams.parentId = input.parentId;
}
```

### Example 4: Forward Status Sync (Task -> Linear)
```typescript
// Source: Pattern from TaskSignalDispatcher callback pattern
// Hook into TaskService.setDispatcher or add parallel listener

function mapTaskStatusToLinearStateType(status: string): string | null {
  switch (status) {
    case "active": return "started";
    case "completed": return "completed";
    case "cancelled": return "canceled";
    default: return null; // Don't sync intermediate states
  }
}

async function syncForwardStatus(
  taskId: string,
  newStatus: string,
  db: NodePgDatabase,
  logger: PinoLogger,
): Promise<void> {
  const stateType = mapTaskStatusToLinearStateType(newStatus);
  if (!stateType) return;

  // Look up materialization record
  const [record] = await db
    .select()
    .from(materializationRecords)
    .where(eq(materializationRecords.task_id, taskId))
    .limit(1);

  if (!record) return;

  // Resolve target Linear state by TYPE (not name)
  // Need to: get issue -> get team -> get states -> find by type
  // Then call update_issue_status with the resolved state name
}
```

### Example 5: Reverse Sync (Linear -> Task) via Webhook
```typescript
// Source: Pattern from existing Linear adapter + webhook handler
// In the Linear adapter, handle linear.issue.updated for materialized issues:

case "linear.issue.updated": {
  const issueId = (payload.issueId ?? payload.id) as string | undefined;
  if (!issueId) return null;

  // Check if this is a materialized issue by looking up correlation
  // If it has a materialization record, convert to appropriate signal

  // Human cancelled -> task_cancelled signal
  // Human marked done -> informational signal
  // Human reassigned -> cancellation with reason
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Agents call Linear SDK directly | MCP HTTP wrapper (callMcpTool) | v2.3 (Phase 37) | Architecture boundary enforced; agents have no SDK deps |
| Manual webhook dedup | Three-layer filter (Phase 75) | v2.8 (2026-02-18) | Dedup + echo suppression built-in |
| No task correlation | linear.task_correlations table | Phase 58 | Reverse lookup for webhook routing exists |
| No work correlation | agents.work_correlations table | Phase 78 | Entity-to-conversation mapping exists |

## Key Codebase Findings

### Existing Infrastructure (HIGH confidence -- verified by reading source)

1. **delegate_task tool** (`packages/agents/src/shared/tools/task/delegate-task.ts`): Creates task via `taskService.create()`, builds delegation XML, starts conversation via `executor.start()`, tracks in `active_delegations`. Schema needs `materialization` field added.

2. **delegate_group tool** (`packages/agents/src/shared/tools/task/delegate-group.ts`): Same pattern but creates multiple tasks. Needs group-level materialization parameter.

3. **Linear MCP create_issue** (`packages/integrations/linear/src/mcp/tools/issues.ts`): Currently supports `teamId`, `title`, `description`, `priority`, `labelIds`. Does NOT support `parentId`. Linear SDK 70.0.0 DOES support `parentId` on `IssueCreateInput`. Needs to be extended.

4. **Linear MCP update_issue_status** (`packages/integrations/linear/src/mcp/tools/issues.ts`): Resolves by state NAME, not type. The materialization adapter needs to resolve by state TYPE (fetch team states, filter by `.type` field).

5. **Task correlations** (`packages/integrations/linear/src/db/task-correlations.ts`): Existing pattern for recording (external_type, external_ref, task_id) correlations. The MCP handler already calls `recordTaskCorrelation` after `create_issue`.

6. **Webhook filter** (`packages/agents/src/router/webhook-filter.ts`): Two-layer filter (dedup + echo). Echo suppression checks `actorInfo.isBot === true`. Linear adapter populates `actorInfo` from `actorType: "OauthClient"`.

7. **Linear adapter** (`packages/agents/src/adapters/linear.ts`): Currently handles `agent_session.created`, `issue.created` (IGNORED), `issue.updated` (IGNORED), `comment.created`, `agent_session.prompted`. The `issue.updated` case needs to be extended for materialized issues.

8. **IGNORE_EVENT_TYPES** (`packages/agents/src/adapters/types.ts`): Contains `linear.issue.created` and `linear.issue.updated`. These are currently ignored. For materialized issues, `linear.issue.updated` needs to be routed (but only for issues that have materialization records).

9. **TaskSignalDispatcher** (`packages/agents/src/shared/services/task-signal-dispatcher.ts`): Fires signals when tasks reach terminal state. Forward status sync should compose alongside this (parallel listener), not be mixed into it.

10. **Seed permissions** (`packages/integrations/linear/scripts/seed-permissions.ts`): Both dev-agent and product-agent already have `create_issue`, `update_issue_status`, `list_labels`, `create_comment` permissions. No new agent-specific permissions needed.

11. **Linear webhook handler** (`packages/integrations/linear/src/api/webhooks.ts`): Currently handles AgentSession and Comment events. Issue events are dispatched via the dispatcher routes (`linear.issue.created`, `linear.issue.updated`) but arrive at the router where they're IGNORED. Needs to handle Issue.update events for materialized issues.

### New Components Needed

1. **MaterializationAdapter interface + LinearMaterializationAdapter** -- core service
2. **agents.materialization_records table** -- correlation + state tracking
3. **DelegateTaskInputSchema extension** -- materialization config parameter
4. **Linear MCP create_issue extension** -- `parentId` field support
5. **Linear MCP "resolve state by type" capability** -- new helper or tool extension
6. **Linear adapter extension** -- `linear.issue.updated` routing for materialized issues
7. **Linear webhook handler extension** -- Issue.update event processing + normalization
8. **`agent-work` label seed script** -- Linear label setup
9. **Prompt guidance** -- materialization decision heuristics for dev-agent and product-agent

### Reverse Sync Webhook Flow (to be built)

```
Linear Issue Updated (by human)
  -> Linear sends webhook to integration
  -> Linear webhook handler parses Issue event
  -> Normalizes to NormalizedEvent (type: "linear.issue.updated")
  -> Dispatches to agent service POST /events
  -> Adapter pipeline adapts to IncomingEvent
  -> NEW: Check materialization_records for external_id match
  -> If materialized: generate appropriate signal (task_cancelled, informational)
  -> Route signal to owning conversation via taskId lookup
```

### Forward Sync Flow (to be built)

```
Task status changes (via complete_task, cancel, etc.)
  -> TaskService.transitionWithHandoff() / update()
  -> Dispatcher callback fires
  -> NEW: Materialization listener checks for materialization record
  -> If materialized: call update_issue_status via MCP (async, fire-and-forget)
  -> Log success/failure, never block internal state change
```

## Open Questions

1. **State type resolution strategy**
   - What we know: The existing `update_issue_status` resolves by state name, but Linear teams customize state names. The CONTEXT.md decision says map to state types.
   - What's unclear: Should we add a new MCP tool (`update_issue_by_state_type`) or extend the existing tool with a `stateType` parameter, or do the resolution in the materialization adapter itself?
   - Recommendation: Add an optional `stateType` parameter to the existing `update_issue_status` MCP tool. When provided, it takes precedence over `statusName`. This keeps the resolution logic in the integration layer where it belongs and is reusable by other consumers. Alternatively, the materialization adapter could fetch team states via `list_teams` + team states query, then call `update_issue_status` with the resolved name. The second approach requires no MCP schema changes but adds two extra API calls per sync.

2. **Where to hook forward sync**
   - What we know: `TaskService.setDispatcher()` currently supports only one callback (the TaskSignalDispatcher). Forward status sync is a separate concern.
   - What's unclear: Should we modify setDispatcher to support multiple callbacks, create a composite dispatcher, or have the materialization adapter directly subscribe to task status changes?
   - Recommendation: Create a composite dispatcher pattern: the existing `onTaskUpdate` callback wraps both the TaskSignalDispatcher and the materialization forward sync. Both fire in sequence. Failures in either are non-fatal and logged independently.

3. **Materialization record location**
   - What we know: `linear.task_correlations` exists for Linear-specific correlations. `agents.work_correlations` exists for entity-to-conversation mapping.
   - What's unclear: Should materialization records live in `agents.*` (since they're a task system concern) or `linear.*` (since they're Linear-specific for now)?
   - Recommendation: `agents.materialization_records` -- materialization is an agent framework concept that will extend to other targets. The Linear integration doesn't need to know about it. Webhook routing already uses `linear.task_correlations` for the reverse lookup; the materialization record is consulted by the agents layer when deciding how to route an issue.updated event.

4. **Dashboard representation**
   - What we know: Dashboard exists at `packages/dashboard/`, shows conversations, tasks, agents. CONTEXT.md lists dashboard representation as "Claude's Discretion".
   - Recommendation: Defer to a later plan within this phase or a follow-up phase. The materialization record in the DB provides the data; adding a "Materialized in Linear" badge to the task detail view is straightforward but not critical for the core functionality.

## Sources

### Primary (HIGH confidence)
- `packages/agents/src/shared/tools/task/delegate-task.ts` -- delegate_task tool implementation
- `packages/agents/src/shared/tools/task/delegate-group.ts` -- delegate_group tool implementation
- `packages/agents/src/shared/services/task-service.ts` -- TaskService interface and factory
- `packages/agents/src/shared/services/task-signal-dispatcher.ts` -- signal dispatch on task terminal state
- `packages/agents/src/framework/types.ts` -- ConversationExecutor, Signal, ToolContext interfaces
- `packages/agents/src/shared/db/schema.ts` -- tasks, conversations, work_correlations tables
- `packages/integrations/linear/src/mcp/tools/issues.ts` -- Linear MCP issue tools
- `packages/integrations/linear/src/mcp/schemas.ts` -- Linear MCP schemas (CreateIssueInputSchema)
- `packages/integrations/linear/src/db/task-correlations.ts` -- existing correlation pattern
- `packages/integrations/linear/src/api/webhooks.ts` -- Linear webhook handler
- `packages/integrations/linear/src/api/mcp.ts` -- MCP endpoint with task correlation recording
- `packages/agents/src/adapters/linear.ts` -- Linear event adapter
- `packages/agents/src/router/webhook-filter.ts` -- dedup + echo suppression
- `packages/agents/src/router/router.ts` -- event routing pipeline
- `packages/agents/src/adapters/types.ts` -- IGNORE_EVENT_TYPES, IncomingEvent schema
- `packages/agents/src/framework/tool-factories.ts` -- tool registration (55 tools)
- `packages/agents/src/service/main.ts` -- service bootstrap and wiring
- `@linear/sdk@70.0.0` type definitions -- IssueCreateInput supports parentId

### Secondary (MEDIUM confidence)
- Linear API documentation (state types: unstarted, started, completed, canceled) -- verified via SDK type definitions showing `type` field on WorkflowState

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already in use, no new dependencies needed
- Architecture: HIGH -- patterns directly derived from existing code (correlation service, task signal dispatcher, MCP wrapper, webhook filter)
- Pitfalls: HIGH -- identified through codebase analysis of existing webhook flow, state resolution, and concurrency patterns
- Open questions: MEDIUM -- state type resolution and forward sync hook strategy have clear recommendations but need validation during planning

**Research date:** 2026-02-20
**Valid until:** 2026-03-20 (stable domain, no fast-moving external dependencies)
