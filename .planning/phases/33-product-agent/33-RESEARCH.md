# Phase 33: Product Agent - Research

**Researched:** 2026-01-30
**Domain:** Agentic conversation loop replacing LangGraph state machine for requirement gathering
**Confidence:** HIGH

## Summary

This phase replaces the product agent's 6-node LangGraph graph (classify -> analyzeRequirements -> generateClarification -> confirm -> createTasks -> notify) with a single `runAgentLoop()` call that adapts its behavior based on input clarity. The research investigated the existing codebase thoroughly -- all patterns needed already exist from Phases 28-32 (dev-agent orchestrator).

The product agent is architecturally simpler than the dev-agent orchestrator because it has no sub-agents, no container management, and no approval gates. It is fundamentally a conversational agent with 4 tools (send_message, search_issues, create_issue, get_issue) that runs one turn per Temporal activity invocation. The Temporal workflow already handles multi-turn conversation state via `userReplySignal` and `cancelConversationSignal`.

**Primary recommendation:** Follow the dev-agent orchestrator pattern exactly. Create a `runProductAgent()` entry point (analogous to `runDevAgentOrchestrator()`), a system prompt with XML sections, a product-agent toolkit factory, and a new Temporal activity that wraps the agentic loop. The existing Temporal workflow (`productAgentConversationWorkflow`) needs modification to call the new activity but retains its signal handling and timeout logic.

## Standard Stack

### Core (already in codebase)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@anthropic-ai/sdk` | latest | Native tool-use API | Phase 28 established -- `runAgentLoop()` uses it |
| `@temporalio/workflow` | 1.14.1 | Durable conversation workflow | Already used by product-agent workflow |
| `@temporalio/worker` | 1.14.1 | Worker for product-agent task queue | Already configured |
| `drizzle-orm` | 0.45.1 | Database for context/traces | Phase 29 established |
| `zod` | latest | Tool input schemas | Phase 30 established |
| `pino` | latest | Structured logging | Platform standard |

### Supporting (already in codebase)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@linear/sdk` | latest | Linear API (inside MCP service) | Only in integration package, NOT in agents |
| `@slack/bolt` | latest | Slack events (inside integration) | Only in integration package |

### No New Dependencies Required

This phase adds zero new npm dependencies. Everything needed is already installed from Phases 28-32.

## Architecture Patterns

### Recommended Project Structure

```
packages/agents/src/product-agent/
  orchestrator/                    # NEW: Agentic loop entry point
    index.ts                       # Barrel export
    orchestrator.ts                # runProductAgent() entry point
    system-prompts.ts              # Product agent system prompt
  api/                             # KEEP: HTTP routes (events, webhooks)
    events.ts                      # Modified slightly (or deferred to Phase 34 smart router)
    index.ts
    routes.ts
  slack/                           # MODIFY: Remove LangGraph dependencies
    index.ts
    thread-handlers.ts             # Simplify -- may become thin or removed
  workflow/                        # REMOVE: All LangGraph files
    graph.ts                       # DELETE
    state.ts                       # DELETE
    prompts.ts                     # DELETE (content moves to system-prompts.ts)
    runner.ts                      # DELETE (replaced by orchestrator.ts)
    checkpointer.ts                # DELETE (no more PostgresSaver)
    nodes/                         # DELETE entire directory
      classify.ts
      analyze-requirements.ts
      confirm.ts
      create-tasks.ts
      generate-clarification.ts
      notify.ts
      index.ts
  index.ts                         # UPDATE: Barrel exports
  main.ts                          # KEEP (minimal changes)
  worker.ts                        # UPDATE: New activity registration

packages/agents/src/shared/
  tools/
    integration/
      linear-tools.ts              # ADD: linear_search_issues tool
  temporal/
    activities/
      product-agent-activity.ts    # REWRITE: Use runProductAgent() instead of LangGraph
    workflows/
      product-agent-workflow.ts    # MODIFY: Call new activity, same signal handling
```

### Pattern 1: One runAgentLoop() Per Conversation Turn

**What:** Each Temporal activity invocation runs one `runAgentLoop()` call that processes a single user message and produces a response. The loop terminates when the LLM has sent its Slack reply (stop_reason: "end_turn"). Multi-turn state is managed by the Temporal workflow via signals.

**When to use:** Always for the product agent. This matches the existing workflow pattern where each turn is a separate activity call.

**Why this over long-running loop:** The existing Temporal workflow already handles signal waits, timeouts, and cancellation between turns. A long-running loop that internally waits for signals would fight Temporal's design (activities can't receive signals -- workflows do). The one-loop-per-turn approach keeps the clean separation: Temporal manages durability and signal flow, the agentic loop manages LLM reasoning.

**Example:**
```typescript
// In product-agent-activity.ts (new version)
export async function runProductAgentActivity(
  input: ProductAgentActivityInput,
): Promise<ProductAgentActivityOutput> {
  const result = await runProductAgent({
    threadTs: input.threadTs,
    channelId: input.channelId,
    message: input.message,
    conversationHistory: input.conversationHistory,
    linearTeamId: input.teamId,
    agentId: "product-agent",
    correlationId: `product-${input.threadTs}`,
    db,
    logger,
  });

  return {
    response: result.output,
    phase: extractPhase(result),  // "complete", "clarifying", "declined", "cancelled"
    issueId: extractIssueId(result),
    issueIdentifier: extractIssueIdentifier(result),
  };
}
```

### Pattern 2: Conversation History Injection via System Prompt

**What:** Include the full Slack thread history in the system prompt's context section so the LLM has conversational memory. No database persistence of conversation state needed -- the Slack thread IS the source of truth.

**When to use:** Every turn. The workflow already fetches thread history from Slack (via `conversations.replies`).

**Why full history over summary:** Product agent conversations are short (typically 1-5 turns). Full thread history fits easily in context. Summary-based approaches introduce information loss that matters in conversations (e.g., user said "nevermind" but summary omits this). The dev-agent orchestrator uses context snapshots because it has long-running multi-phase work across separate activity invocations with approval gates. Product agent has no such complexity.

**Trade-off acknowledged:** If conversations become extremely long (20+ messages), full history injection could waste tokens. The `maxIterations = 20` cap on the Temporal workflow prevents this from becoming unbounded. This is acceptable.

**Example:**
```typescript
// Build initial message with conversation context
const conversationContext = conversationHistory
  .map(msg => `${msg.role === "user" ? "User" : "Agent"}: ${msg.content}`)
  .join("\n\n");

const initialMessage = conversationContext
  ? `<conversation_history>\n${conversationContext}\n</conversation_history>\n\nNew message from user:\n${message}`
  : message;
```

### Pattern 3: Phase Extraction from Agent Output

**What:** Instead of tracking phase in a state machine, the product agent returns its phase indicator in structured output (the LLM's final text response). The activity parses this to determine the Temporal workflow's next step.

**When to use:** At the end of each activity invocation.

**How it works:** The system prompt instructs the LLM to end every response with a phase tag: `<phase>clarifying</phase>`, `<phase>complete</phase>`, `<phase>declined</phase>`, or `<phase>cancelled</phase>`. The activity parses this tag to determine workflow flow (continue waiting for reply vs. terminate).

**Why this over structured output:** The agent needs to both perform actions (send_message, create_issue) AND communicate its phase assessment. Structured output would require a separate LLM call or a dedicated "report_phase" tool. A simple XML tag at the end of the response is the lightest approach and matches how the dev-agent orchestrator uses sentinel markers (HUMAN_INPUT_MARKER).

**Example:**
```typescript
function extractPhase(result: AgentLoopResult): ProductAgentWorkflowPhase {
  const phaseMatch = result.output.match(/<phase>(.*?)<\/phase>/);
  if (!phaseMatch) return "running"; // Default to continuing

  const phase = phaseMatch[1];
  switch (phase) {
    case "complete": return "complete";
    case "declined": return "declined";
    case "cancelled": return "cancelled";
    case "clarifying": return "awaiting_reply";
    default: return "running";
  }
}
```

### Pattern 4: Product Agent Toolkit (Lightweight)

**What:** A dedicated toolkit factory for the product agent with only 4-5 tools. Much simpler than the orchestrator's 14 tools because the product agent doesn't need codebase access, sub-agents, or git tools.

**Tools needed:**
1. `slack_send_message` -- Send response to Slack thread (via MCP)
2. `linear_search_issues` -- Search for duplicate issues (via MCP) **NEW TOOL NEEDED**
3. `linear_create_issue` -- Create a Linear issue (via MCP)
4. `linear_get_issue` -- Read issue details for context (via MCP)
5. `linear_list_labels` -- Resolve label names to IDs (via MCP)

**What is NOT a tool:**
- Confirmation is NOT a separate tool. It's natural conversation behavior -- the LLM sends a message asking "does this look right?" and then signals the end of its turn. The user replies, and the next turn processes the reply.
- Cancellation detection is NOT a tool. It's LLM reasoning about the user's message.

### Anti-Patterns to Avoid

- **Keeping LangGraph checkpointer for "backup":** Remove it completely. Two state persistence mechanisms will cause bugs.
- **Hardcoded phrase lists for cancellation:** The current `isConfirmationMessage()` with hardcoded phrases like "confirm", "yes", "lgtm" must be eliminated. The LLM reasons about intent.
- **Separate classification step:** The current 6-node graph starts with explicit classification. In the agentic loop, the LLM handles classification implicitly as part of reasoning about what to do.
- **Forced clarification pipeline:** The current graph always routes through analyze -> clarify even for clear requests. The agentic loop should create issues immediately when the request is clear.
- **Creating the toolkit in the workflow file:** Toolkit creation belongs in the activity (or the orchestrator entry point), not in the Temporal workflow file (which must be deterministic).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Agentic tool-use loop | Custom LLM loop | `runAgentLoop()` from `shared/agent-loop/` | Phase 28 built this, battle-tested |
| MCP tool wrappers | Direct HTTP calls | `createMcpToolWrapper()` from `shared/tools/integration/mcp-wrapper.ts` | Handles errors, Zod validation, JSON serialization |
| Trace recording | Manual logging | `createTraceRecorder()` from `shared/db/trace-recorder.ts` | Phase 29 built this, integrates with onToolCall/onResponse |
| Token budgeting | Manual counting | `createTokenBudget()` from `shared/agent-loop/token-budget.ts` | Phase 28 built this |
| Conversation threading | Manual thread management | Temporal workflow with `wf.condition()` for signal waits | Already working in current product-agent-workflow.ts |
| Cancellation detection | Phrase list matching | LLM reasoning in system prompt | Spec requirement PROD-04 |
| Issue search for duplicates | Custom search logic | Linear SDK `issueSearch` via new MCP tool | Need new `search_issues` MCP tool |

## Common Pitfalls

### Pitfall 1: Slack Message vs. Tool Call Confusion

**What goes wrong:** The product agent needs to both REASON about what to do AND send Slack messages as tool calls. If the system prompt isn't clear, the LLM might include its Slack message as plain text in the response instead of calling `slack_send_message`.

**Why it happens:** The LLM's natural tendency is to "respond" to the user by producing text. But in this architecture, responses go through Slack tools, not through the LLM's text output.

**How to avoid:** The system prompt must explicitly state: "You communicate with the user ONLY through the slack_send_message tool. Your text output is internal reasoning and phase reporting, not user-facing." The final text output contains the phase tag only.

**Warning signs:** Activity output contains user-facing text without a corresponding `slack_send_message` trace step.

### Pitfall 2: Temporal Activity Timeout for Product Agent

**What goes wrong:** Product agent activity has a 5-minute `startToCloseTimeout`. A single agentic loop turn should complete much faster (typically 1-3 LLM calls), but if the LLM makes many tool calls or Linear/Slack MCP calls are slow, it could timeout.

**Why it happens:** The 5-minute timeout was appropriate for the LangGraph graph which made 1-2 LLM calls per turn. The agentic loop might make 3-5 calls (reasoning + search_issues + send_message + create_issue).

**How to avoid:** Keep the 5-minute timeout -- it's generous enough for 3-5 tool calls. Set `maxIterations: 10` for the product agent (not 50 like the dev orchestrator). The product agent should never need more than 10 iterations per turn.

**Warning signs:** Temporal activity timeouts in the product-agent task queue.

### Pitfall 3: Missing search_issues MCP Tool

**What goes wrong:** The spec requires duplicate detection (PROD-05) via `search_issues`. This tool does not exist in the Linear MCP server. The current 5 tools are: get_issue, create_issue, update_issue_status, list_teams, list_labels.

**Why it happens:** The Linear MCP tools were designed for the dev-agent's needs (Phase 16/19). The product agent's duplicate detection feature requires a new tool.

**How to avoid:** Add `search_issues` to the Linear MCP server before or during this phase. The Linear SDK supports `client.issueSearch(query)` which returns matching issues. This needs a new MCP tool handler, a new tool definition in the agent tool library, and permission seeding.

**Warning signs:** Product agent cannot search for duplicates, falls back to creating duplicates.

### Pitfall 4: Phase Tag Parsing Reliability

**What goes wrong:** The LLM might not always include the `<phase>` tag exactly as instructed, or might include it in the wrong format.

**Why it happens:** LLM output is probabilistic. Despite clear instructions, the LLM might use `Phase: complete` or `{phase: "complete"}` or omit the tag entirely.

**How to avoid:** Make the phase tag requirement emphatic in the system prompt with examples. Add fallback parsing logic that handles common variations. Default to "awaiting_reply" (continue conversation) when the phase can't be parsed -- this is the safe default. Consider making the phase a dedicated lightweight tool call (`report_phase`) if parsing proves unreliable -- but start with the tag approach since the dev-agent's HUMAN_INPUT_MARKER sentinel works reliably.

**Warning signs:** Workflow gets stuck in "running" phase because phase tags aren't being emitted.

### Pitfall 5: Tool Result Content for send_message

**What goes wrong:** After calling `slack_send_message`, the tool result is the MCP response (success/ts). The LLM might try to call `slack_send_message` again thinking the message wasn't sent, or might include the MCP JSON in its reasoning.

**Why it happens:** The LLM sees tool results and can misinterpret JSON response as needing further action.

**How to avoid:** Make the `slack_send_message` tool result human-readable: "Message sent successfully to thread." rather than raw JSON. The `createMcpToolWrapper` already serializes results as JSON -- consider post-processing for product agent tools to simplify the output.

**Warning signs:** Agent sends duplicate messages or enters unnecessary iterations after successful tool calls.

### Pitfall 6: Conversation History Injection Ordering

**What goes wrong:** The conversation history from Slack thread is injected into the initial message, but the ordering might not match chronological order, or bot messages might be attributed to the wrong role.

**Why it happens:** Slack's `conversations.replies` returns messages in order, but the mapping from Slack messages to conversation history (bot_id -> "assistant", else -> "user") might misidentify messages.

**How to avoid:** The existing `getConversationHistory()` in `thread-handlers.ts` already handles this. Preserve this logic and inject the history into the system prompt's context section rather than as separate message turns. This avoids Anthropic API constraints about role alternation.

### Pitfall 7: Multi-Issue Creation in Single Turn

**What goes wrong:** If a user requests multiple features in one message, the LLM might try to create all issues in a single turn. This could hit the 5-minute timeout or create issues without proper confirmation.

**Why it happens:** The system prompt says "create issues when clear" but doesn't address multi-issue handling.

**How to avoid:** System prompt guidance: "For multi-issue requests, create issues one at a time with user confirmation between each. After creating the first issue, ask if you should proceed with the next." This naturally spaces creation across multiple turns, using the Temporal workflow's multi-turn capability.

## Code Examples

### Product Agent System Prompt (Draft)

```typescript
export const PRODUCT_AGENT_SYSTEM_PROMPT = `You are the product agent in the Aesir platform.

<identity>
You help teams capture feature requests and bug reports from Slack conversations
and turn them into well-structured Linear issues. You adapt your behavior to the
input: clear requests get issues immediately, vague requests get focused questions.
</identity>

<conversation_rules>
- You communicate with the user ONLY through the slack_send_message tool
- Your text output (outside tool calls) is for internal reasoning and phase reporting
- ALWAYS end your final response with a phase tag: <phase>clarifying|complete|declined|cancelled</phase>
- Ask ONE question at a time when clarifying
- Reference what the user already told you to show you're listening
</conversation_rules>

<behavior>
CLEAR REQUEST (has what, why, and enough detail to create an issue):
1. Search for duplicate issues with linear_search_issues
2. If duplicate found, tell user via slack_send_message and suggest updating existing
3. If no duplicate, draft the issue and send it to the user for confirmation
4. End turn with <phase>clarifying</phase> to wait for confirmation

VAGUE REQUEST (missing key details):
1. Identify the most important missing piece
2. Ask ONE focused question via slack_send_message
3. End turn with <phase>clarifying</phase>

USER CONFIRMS (e.g., "yes", "looks good", "go ahead", "create it"):
1. Create the issue with linear_create_issue (include labels via linear_list_labels)
2. Send confirmation to user via slack_send_message with issue identifier
3. End turn with <phase>complete</phase>

USER CANCELS (detects intent to stop, not hardcoded phrases):
1. Acknowledge cancellation via slack_send_message
2. End turn with <phase>cancelled</phase>

NON-ACTIONABLE MESSAGE (question, off-topic):
1. Politely explain you handle feature requests and bug reports
2. End turn with <phase>declined</phase>

MULTI-ISSUE REQUEST:
1. Create issues one at a time
2. After creating one, confirm with user before proceeding to the next
3. End with <phase>complete</phase> when all are created or user says stop
</behavior>

<issue_quality>
Good issues have:
- Clear, actionable title starting with a verb (Add, Implement, Fix, Update)
- Description explaining what and why
- Specific acceptance criteria (3-7 items, independently verifiable)
- Appropriate priority (urgent/high/medium/low)
- Relevant labels (feature, bug, frontend, backend, etc.)

Title under 80 characters. Vertical slices over horizontal layers. Include testing
as part of the issue, not separate.
</issue_quality>

<cancellation_detection>
Detect cancellation intent through reasoning about the user's message. Do NOT
rely on specific phrases. Consider:
- "nevermind", "forget it", "cancel" = clear cancellation
- "actually I changed my mind" = cancellation
- "not anymore", "don't need this" = cancellation
- "wait, let me rethink" = may be pause, ask to clarify
The key is intent, not exact words.
</cancellation_detection>`;
```

### Product Agent Orchestrator Entry Point

```typescript
// Follows runDevAgentOrchestrator() pattern exactly
export async function runProductAgent(
  options: ProductAgentOptions,
): Promise<AgentLoopResult> {
  const {
    threadTs, channelId, message, conversationHistory,
    linearTeamId, agentId, correlationId, db, logger,
  } = options;

  const tokenBudget = createTokenBudget(options.maxTokenBudget ?? 50_000);
  const agentInstanceId = createId.agentInstance();

  const traceRecorder = createTraceRecorder({
    db, logger, taskId: `product-${threadTs}`,
    workflowId: `product-agent-${threadTs}`,
    agentType: "product-agent",
    agentInstanceId,
  });

  const tools = createProductAgentToolkit({
    agentId, correlationId, linearTeamId,
  });

  // Build conversation context
  let initialMessage = message;
  if (conversationHistory && conversationHistory.length > 0) {
    const history = conversationHistory
      .map(m => `${m.role === "user" ? "User" : "Agent"}: ${m.content}`)
      .join("\n\n");
    initialMessage = `<conversation_history>\n${history}\n</conversation_history>\n\nNew message from user:\n${message}`;
  }

  // Inject channel/thread context
  const context = `<slack_context>\nChannel: ${channelId}\nThread: ${threadTs}\nTeam ID (Linear): ${linearTeamId}\n</slack_context>`;

  const loopOptions: AgentLoopOptions = {
    systemPrompt: PRODUCT_AGENT_SYSTEM_PROMPT,
    tools,
    initialMessage,
    context,
    maxIterations: 10,
    tokenBudget,
    onToolCall: traceRecorder.onToolCall,
    onResponse: traceRecorder.onResponse,
    logger: logger.child({ component: "product-agent", agentInstanceId }),
  };

  try {
    return await runAgentLoop(loopOptions);
  } finally {
    await traceRecorder.flush();
  }
}
```

### Product Agent Toolkit Factory

```typescript
export function createProductAgentToolkit(deps: {
  agentId: string;
  correlationId: string;
  linearTeamId: string;
}): ToolDefinition[] {
  const mcpDeps: McpToolDeps = {
    agentId: deps.agentId,
    correlationId: deps.correlationId,
  };

  // Get all available tools
  const allLinear = createLinearTools(mcpDeps);
  const allSlack = createSlackTools(mcpDeps);

  // Filter to product agent's subset
  const linearTools = allLinear.filter(t =>
    ["linear_create_issue", "linear_get_issue", "linear_list_labels", "linear_search_issues"].includes(t.name)
  );
  const slackTools = allSlack.filter(t =>
    ["slack_send_message"].includes(t.name)
  );

  return [...linearTools, ...slackTools];
}
```

### New Linear search_issues MCP Tool (Agent-Side Wrapper)

```typescript
// In packages/agents/src/shared/tools/integration/linear-tools.ts
// Add to the existing createLinearTools factory

const searchIssuesSchema = z.object({
  query: z.string().describe("Search query text to find matching issues"),
  teamId: z.string().optional().describe("Optional team ID to scope the search"),
  limit: z.number().optional().describe("Maximum results to return (default: 10)"),
});

// Add this tool to the returned array in createLinearTools():
createMcpToolWrapper({
  integration: "linear",
  toolName: "search_issues",
  displayName: "linear_search_issues",
  description:
    "Search Linear issues by text query. Returns matching issues with titles, identifiers, and status. Use this BEFORE creating a new issue to check for duplicates. If similar issues exist, suggest updating them instead of creating duplicates.",
  inputSchema: searchIssuesSchema,
}, deps),
```

### New Linear search_issues MCP Server Handler

```typescript
// In packages/integrations/linear/src/mcp/tools/issues.ts
// Add new handler

export async function handleSearchIssues(
  context: MCPToolContext,
  args: unknown,
  deps: IssueToolDeps,
): Promise<MCPToolResult<SearchIssuesOutput>> {
  // Permission check, input validation...
  const { query, teamId, limit } = parseResult.data;

  const client = await createLinearClientFromDatabase(deps.workspaceId);
  const results = await client.issueSearch(query, { limit: limit ?? 10 });

  // Filter by team if specified
  // Map to output format: { id, identifier, title, status, url }
  // Return results
}
```

## State of the Art

| Old Approach (Current) | New Approach (Phase 33) | When Changed | Impact |
|------------------------|------------------------|--------------|--------|
| 6-node LangGraph StateGraph | Single `runAgentLoop()` call | Phase 33 | Eliminates rigid pipeline, enables adaptive behavior |
| `PostgresSaver` checkpointer | Conversation history from Slack thread | Phase 33 | No more LangGraph checkpoint dependency |
| `@langchain/anthropic` for classification | `@anthropic-ai/sdk` native tool-use | Phase 28 | Direct API, no LangChain wrapper |
| `isConfirmationMessage()` hardcoded phrase list | LLM reasoning about intent | Phase 33 | Better coverage, handles natural language |
| `ProductAgentPhaseSchema` (6 phases) | Phase tag in LLM output | Phase 33 | No explicit state machine |
| `ProductAgentStateAnnotation` (8 fields, reducers) | Conversation history + tool state | Phase 33 | Eliminates complex state schema |
| `classifyNode` with `withStructuredOutput` | LLM reasoning in system prompt | Phase 33 | Classification is implicit, not a separate step |

**Deprecated/outdated (remove in this phase):**
- `packages/agents/src/product-agent/workflow/graph.ts` -- LangGraph state graph
- `packages/agents/src/product-agent/workflow/state.ts` -- ProductAgentState, annotations
- `packages/agents/src/product-agent/workflow/prompts.ts` -- Per-node prompts
- `packages/agents/src/product-agent/workflow/runner.ts` -- LangGraph runner
- `packages/agents/src/product-agent/workflow/checkpointer.ts` -- PostgresSaver factory
- `packages/agents/src/product-agent/workflow/nodes/*.ts` -- All 6 node implementations
- `packages/agents/src/product-agent/workflow/graph.test.ts` -- LangGraph graph tests
- `packages/agents/src/product-agent/workflow/state.test.ts` -- State schema tests

## Key Architecture Decisions (Claude's Discretion)

### Turn Boundary: One runAgentLoop() Per Turn

**Decision:** Each Temporal activity invocation runs one `runAgentLoop()` call per conversation turn.

**Rationale:** The existing Temporal workflow handles multi-turn orchestration with signal waits. Trying to make the agent loop itself wait for signals would require either (a) a "wait_for_reply" tool that blocks the activity (fragile, fights Temporal), or (b) running the loop as a long-lived process (breaks Temporal's activity model). One loop per turn cleanly separates concerns: Temporal handles durability/signals, the agentic loop handles reasoning.

### Conversation State: Full History Injection

**Decision:** Inject the full Slack thread history into the initial message on each turn.

**Rationale:** Product agent conversations are bounded (max 20 turns) and messages are short. Full history ensures the LLM has perfect context for intent detection (especially cancellation). The alternative (summary-based context via context snapshots) adds complexity for marginal token savings. Context snapshots are appropriate for the dev-agent's multi-hour workflows with approval boundaries -- not for 3-5 turn conversations.

**Implementation:** The existing `getConversationHistory()` function in `thread-handlers.ts` already fetches thread history. This logic moves to the activity (or remains in the event handler that signals the workflow).

### Tool Set: 5 Tools Maximum

**Decision:** Product agent gets exactly 5 tools:
1. `slack_send_message` -- Send messages to the Slack thread
2. `linear_search_issues` -- Search for duplicate issues (NEW)
3. `linear_create_issue` -- Create Linear issues
4. `linear_get_issue` -- Read issue details
5. `linear_list_labels` -- Resolve label names

**Rationale:** Fewer tools = faster LLM reasoning. The product agent doesn't need `slack_reply_to_thread` separately from `slack_send_message` (send_message with threadTs covers this). It doesn't need `linear_list_teams` because the team ID is injected via config. It doesn't need `linear_update_issue_status` because it only creates issues, doesn't manage them.

### Activity Structure: Minimal Changes to Temporal Workflow

**Decision:** Keep the existing `productAgentConversationWorkflow` structure with minimal changes. The workflow loop, signal handling, timeout logic, and phase tracking remain. Only the activity call changes (new activity implementation, same interface contract).

**Rationale:** The Temporal workflow is already correct for multi-turn conversations. It handles:
- `userReplySignal` for receiving replies
- `cancelConversationSignal` for explicit cancellation
- 24h/48h/72h timeout cascade
- `conversationStatusQuery` for monitoring
- Max iterations (20) to prevent infinite loops

All of this stays. The only change is what runs inside `runProductAgentActivity()` -- instead of creating a LangGraph graph and invoking it, it creates an agentic loop and runs it.

### Retry Configuration: 5-min timeout, 3 retries

**Decision:** Keep the existing 5-minute `startToCloseTimeout` and 3-retry configuration for the product agent activity.

**Rationale:** A single agentic turn with 5 tools and max 10 iterations should complete in under 30 seconds. The 5-minute timeout provides ample headroom for slow LLM responses or MCP call delays. Three retries with exponential backoff handle transient failures.

## New MCP Tool Required: search_issues

### Problem

The spec requires duplicate detection (PROD-05). The product agent must search existing Linear issues before creating new ones. No `search_issues` tool exists in the Linear MCP server.

### Solution

Add a `search_issues` tool to the Linear MCP server:

1. **Linear MCP server** (`packages/integrations/linear/src/mcp/server.ts`): Add tool registration
2. **Linear MCP handler** (`packages/integrations/linear/src/mcp/tools/issues.ts`): Add `handleSearchIssues` using `client.issueSearch(query)`
3. **Agent tool wrapper** (`packages/agents/src/shared/tools/integration/linear-tools.ts`): Add `linear_search_issues` tool definition
4. **MCP permissions** (`packages/integrations/linear/src/db/seed-permissions.ts`): Add `search_issues` permission for `product-agent`

### Linear SDK API

```typescript
// @linear/sdk provides issueSearch(query, options)
const results = await client.issueSearch(query);
// Returns IssueConnection with nodes: Issue[]
```

### Scope Decision

This new MCP tool is a Phase 33 prerequisite. It should be added as part of this phase's implementation, not deferred. It's a small addition (~50 lines of handler code + ~20 lines of tool wrapper) that follows established patterns exactly.

## Open Questions

1. **Slack thread history retrieval location**
   - What we know: Currently `getConversationHistory()` is called in `thread-handlers.ts` (Bolt event handler). In the new architecture, thread history needs to reach the Temporal activity.
   - What's unclear: Whether to fetch thread history in the event handler and pass it via the Temporal signal, or fetch it inside the activity. Both work.
   - Recommendation: Fetch in the activity. The activity already has MCP access to Slack. Use `slack_get_message` or add a dedicated `getThreadHistory` utility. This keeps the event handler thin and the activity self-sufficient (matches dev-agent pattern where activities read their own context).

2. **Whether to keep `thread-handlers.ts` and Bolt registration**
   - What we know: Currently the product agent registers Bolt event handlers that call the LangGraph runner directly. Phase 34 (Smart Router) will replace this with LLM-based event routing.
   - What's unclear: Whether this phase should modify thread-handlers.ts to use the new agentic loop, or leave it for Phase 34 to replace entirely.
   - Recommendation: Phase 33 should update `thread-handlers.ts` to start Temporal workflows (if not already) and update `worker.ts` to register the new activity. The Bolt handler's job is just to receive events and signal Temporal -- it doesn't need to call the agent directly. This is already how the Temporal workflow pattern works.

3. **Label resolution as part of issue creation**
   - What we know: The current `createTasksNode` resolves label names to IDs using `list_labels` before calling `create_issue`.
   - What's unclear: Whether the LLM should call `linear_list_labels` itself or whether label resolution should be automatic.
   - Recommendation: Let the LLM call `linear_list_labels` when it decides to create an issue. This keeps tools simple and lets the LLM reason about which labels are appropriate. The system prompt should guide: "Before creating an issue, use linear_list_labels to find appropriate label IDs for the team."

## Sources

### Primary (HIGH confidence)
- Codebase analysis: All files read directly from the repository
- `packages/agents/src/shared/agent-loop/run-agent-loop.ts` -- Core agent loop runtime (Phase 28)
- `packages/agents/src/dev-agent/orchestrator/orchestrator.ts` -- Reference pattern (Phase 31)
- `packages/agents/src/dev-agent/orchestrator/system-prompts.ts` -- XML-section prompt pattern
- `packages/agents/src/shared/temporal/workflows/product-agent-workflow.ts` -- Current workflow
- `packages/agents/src/shared/temporal/workflows/orchestrator-workflow.ts` -- Reference Temporal pattern
- `packages/agents/src/shared/temporal/activities/orchestrator-activities.ts` -- Reference activity pattern
- `packages/agents/src/product-agent/workflow/` -- Current LangGraph implementation (all files)
- `packages/agents/src/shared/tools/toolkits.ts` -- Toolkit factory pattern
- `packages/agents/src/shared/tools/integration/` -- MCP tool wrapper pattern
- `2.2-spec.md` Section 5 -- Product Agent specification

### Secondary (MEDIUM confidence)
- `packages/integrations/linear/src/mcp/server.ts` -- Linear MCP server (5 current tools)
- `packages/integrations/linear/src/mcp/tools/issues.ts` -- Linear MCP handlers
- `@linear/sdk` API for `issueSearch()` -- known from training data, matches SDK patterns

### Tertiary (LOW confidence)
- None -- all findings are from direct codebase analysis

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already in use, zero new dependencies
- Architecture: HIGH -- directly follows established dev-agent orchestrator pattern
- Pitfalls: HIGH -- identified from codebase analysis and spec requirements
- search_issues MCP tool: MEDIUM -- Linear SDK `issueSearch` API based on training data, needs verification

**Research date:** 2026-01-30
**Valid until:** 2026-03-01 (stable patterns, low churn risk)
