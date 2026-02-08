# Architecture Patterns: Unified Agent Communication (v2.6)

**Domain:** Symmetric outbound normalization for an agentic development platform
**Researched:** 2026-02-08
**Confidence:** HIGH -- analysis based entirely on verified codebase inspection (no external sources needed; this is internal architecture extension)

## Executive Summary

The v2.6 unified agent communication milestone adds symmetric outbound normalization to Aesir's existing inbound normalization pipeline. Today, inbound events flow through adapters that normalize integration-specific webhooks into domain-language `IncomingEvent` objects. Outbound communication has no equivalent -- agents call channel-specific tools (`slack:send_message`, `slack:send_approval_request`) directly. This creates O(agents x integrations) complexity and means agents cannot "reply where the conversation is happening" because signal messages lose their origin context by the time they reach the agent.

The proposed architecture introduces three new components: (1) `ReplyContext` type threaded through the adapter-to-signal-to-agent pipeline, (2) unified `communication:reply/ask/notify` tools that accept domain-language intent, and (3) a denormalizer that dispatches to the correct integration MCP tool. These fit cleanly into the existing 3-layer architecture without violating any dependency rules.

## Current Architecture (Verified)

### Inbound Flow (What Exists)

```
Integration Webhook
  |
  v
NormalizedEvent (from @aesir/types)
  |
  v (POST /events to agent-service:3004)
  |
  v
Adapter Pipeline (adapters/slack.ts, linear.ts, github.ts, pass-through.ts)
  |
  v
IncomingEvent { type, data, source, correlationKey, message, taskId }
  |
  v
routeEvent() -> Task Router (if taskId) -> EventRouter.handle()
  |
  +-- start: executor.start() -> conversation row, queued
  +-- signal: executor.signal() -> resume/queue/reject
  +-- slow_path: routeViaAgentLoopV2() -> LLM classification -> signal/start/ignore
  +-- ignore: no-op
```

### Signal Delivery (Current Gap)

When a signal is delivered to a waiting conversation, the executor builds a plain text user message:

```typescript
// conversation-executor.ts line 388
const signalContent = signal.message ??
  `Signal received: ${signal.type}. Data: ${JSON.stringify(signal.data ?? {})}`;
```

The agent sees: `"Signal received: approval. Data: {"approved":true}"` -- no structured reply context. It has no way to know WHERE the signal came from (Slack thread, Linear comment, GitHub PR review) and therefore cannot reply back to the originating channel without hardcoded channel IDs.

### Outbound Flow (Current -- Channel-Specific)

```
Agent Loop
  |
  v
Tool call: slack:send_message({ channel: "C123", text: "..." })
  |
  v
mcpAdapter extracts McpToolDeps { agentId, correlationId, taskId }
  |
  v
callMcpTool({ integration: "slack", tool: "send_message", params, agentId, correlationId })
  |
  v
HTTP POST http://slack-integration:3003/mcp/tools/send_message
```

**The problem:** The agent must know the exact channel, thread timestamp, and integration to use. This is hardcoded in agent prompts (dev-agent always escalates to Slack). When a signal comes from Linear, the agent still tries to reply on Slack because it has no mechanism to know otherwise.

### Current Tool Assignments (Verified from definition.yaml)

**dev-agent (20 tools):**
- Codebase: `read_file`, `search_codebase`, `list_directory`
- Coordination: `spawn_agent`, `request_human_input`, `wait_for`
- Task: `create_task`, `complete_task`, `pause_task`, `handoff_task`, `list_tasks`, `get_task_context`
- Linear: `get_issue`, `update_issue_status`
- GitHub: `create_branch`, `create_commit`, `create_pull_request`, `get_pull_request`
- Slack: `send_message`, `send_approval_request` -- **these get replaced**

**product-agent (11 tools):**
- Coordination: `wait_for`
- Task: `create_task`, `complete_task`, `pause_task`, `handoff_task`, `list_tasks`, `get_task_context`
- Linear: `create_issue`, `get_issue`, `list_labels`, `search_issues`
- Slack: `send_message` -- **this gets replaced**

### Integration MCP Gaps (Verified)

1. **Linear `create_comment`**: Handler exists in `packages/integrations/linear/src/mcp/tools/issues.ts` (line 472, `handleCreateComment`), exported from tools barrel, but NOT registered in the MCP server's `ListToolsRequestSchema` handler or `CallToolRequestSchema` switch. The tool is implemented but invisible.

2. **GitHub `create_pr_comment`**: Does NOT exist anywhere. No handler, no schema, no registration. Needs to be built from scratch using Octokit's `issues.createComment` (PR-level comments are issue comments in GitHub's API) or `pulls.createReviewComment` (for inline review replies).

3. **Slack**: Complete. `send_message`, `reply_to_thread`, and `send_approval_request` cover all needed outbound patterns.

## Recommended Architecture

### Component Boundary Map

```
packages/agents/src/
  |
  +-- adapters/                        [MODIFY] Attach replyContext to IncomingEvent
  |     +-- types.ts                   [MODIFY] Add replyContext to IncomingEventSchema
  |     +-- slack.ts                   [MODIFY] Populate replyContext on thread_reply, block_actions, app_mention
  |     +-- linear.ts                  [MODIFY] Populate replyContext on comment_created, agent_session
  |     +-- github.ts                  [MODIFY] Populate replyContext on pr_review events
  |
  +-- shared/tools/
  |     +-- communication/             [NEW DIRECTORY]
  |     |     +-- types.ts             [NEW] ReplyContext, NotifyTarget, MessageContent, CommunicationToolDeps
  |     |     +-- denormalizer.ts      [NEW] dispatch(action, deps) -> callMcpTool
  |     |     +-- reply.ts            [NEW] communication:reply tool factory
  |     |     +-- ask.ts              [NEW] communication:ask tool factory
  |     |     +-- notify.ts           [NEW] communication:notify tool factory
  |     |     +-- index.ts            [NEW] barrel export
  |     |
  |     +-- integration/
  |           +-- linear-tools.ts      [MODIFY] Add linear:create_comment wrapper
  |
  +-- framework/
  |     +-- types.ts                   [MODIFY] Add replyContext to SignalSchema
  |     +-- tool-factories.ts          [MODIFY] Register communication:* tools + linear:create_comment
  |     +-- conversation-executor.ts   [MODIFY] Include replyContext in signal user message
  |
  +-- router/
        +-- tools/
        |     +-- signal-conversation.ts [MODIFY] Add optional replyContext field to input schema
        +-- system-prompt.ts           [MODIFY] Add replyContext propagation guidance, Linear comment routing

packages/integrations/
  +-- linear/src/mcp/
  |     +-- server.ts                  [MODIFY] Register create_comment in tool list + switch
  |
  +-- github/src/mcp/
        +-- tools/pullrequests.ts      [MODIFY] Add handleCreatePRComment handler
        +-- server.ts                  [MODIFY] Register create_pr_comment in tool list + switch
        +-- schemas.ts                 [MODIFY] Add CreatePRCommentInputSchema

packages/agents/definitions/
  +-- dev-agent/
  |     +-- definition.yaml            [MODIFY] Swap slack:* for communication:*
  |     +-- prompt.md                  [MODIFY] Domain-language communication guidance
  +-- product-agent/
        +-- definition.yaml            [MODIFY] Swap slack:send_message for communication:*
        +-- prompt.md                  [MODIFY] Domain-language communication guidance
```

### New Components Detail

#### 1. ReplyContext Type (`shared/tools/communication/types.ts`)

Discriminated union on `channel` field. Opaque to the agent -- it passes it through from signal to tool call without parsing.

```typescript
export type ReplyContext =
  | { channel: "slack"; teamId: string; channelId: string; threadTs: string }
  | { channel: "linear"; issueId: string }
  | { channel: "github"; owner: string; repo: string; prNumber: number; commentId?: number };

export type NotifyTarget =
  | { channel: "slack"; teamId: string; channelId: string; threadTs?: string }
  | { channel: "linear"; issueId: string };
```

**Design decision:** ReplyContext uses a discriminated union rather than a generic `Record<string, unknown>` because the denormalizer needs typed access to channel-specific fields (`channelId`, `threadTs`, `issueId`, `prNumber`). The discriminant `channel` makes the `switch` in the denormalizer exhaustive and type-safe.

#### 2. Denormalizer (`shared/tools/communication/denormalizer.ts`)

Pure function that maps (action + replyContext + content) to the correct MCP tool call. Lives in the agents package (not integrations) because it orchestrates MCP HTTP calls -- it does not import integration SDKs.

```
denormalize({ action: "reply", replyContext: { channel: "slack", ... }, content: { text } })
  |
  switch (replyContext.channel)
    case "slack":
      if action === "ask" && content.options -> callMcpTool("slack", "send_approval_request", ...)
      else -> callMcpTool("slack", "reply_to_thread", ...)
    case "linear":
      -> callMcpTool("linear", "create_comment", ...)
    case "github":
      -> callMcpTool("github", "create_pr_comment", ...)
```

**Placement rationale:** The denormalizer uses `callMcpTool` from `shared/mcp/client.ts` to call integration HTTP endpoints. This maintains the HTTP boundary between agents and integrations. The denormalizer is the outbound counterpart to adapters -- adapters normalize inbound, denormalizer denormalizes outbound.

#### 3. Communication Tools (`shared/tools/communication/reply.ts`, `ask.ts`, `notify.ts`)

Follow the exact same pattern as existing tool factories. Each creates a `ToolDefinition` with:
- `name`: e.g., `"reply"`
- `description`: describes intent, not channel
- `inputSchema`: Zod schema (replyContext + message/question/target)
- `execute`: validates input, calls `denormalize()`, returns result

**Tool naming:** Display names are `reply`, `ask`, `notify` (no namespace prefix) because tools registered as `communication:reply` already have a namespace. The `mcpAdapter` pattern uses display names with integration prefix (`slack_send_message`, `linear_get_issue`) because multiple integrations share the same tool name space. Communication tools are unique -- no prefix needed.

#### 4. communicationAdapter (`framework/tool-factories.ts`)

New adapter function following the existing `mcpAdapter` and `codebaseAdapter` patterns:

```typescript
function communicationAdapter(
  createFn: (deps: CommunicationToolDeps) => ToolDefinition,
): (ctx: ToolContext) => ToolDefinition {
  return (ctx: ToolContext) =>
    createFn({
      agentId: ctx.agentId,
      correlationId: ctx.correlationId,
      taskId: ctx.taskId,
      logger: ctx.logger,
    });
}
```

Extracts `CommunicationToolDeps` from `ToolContext`, same pattern as `mcpAdapter` extracts `McpToolDeps`. No new fields needed on `ToolContext`.

### Data Flow: Complete Round-Trip

```
INBOUND:
  Linear comment "looks good, ship it" on issue uuid-abc
    |
    v
  adaptLinearEvent() -> IncomingEvent {
    type: "issue_comment",
    data: { body: "looks good...", issueId: "uuid-abc" },
    source: "linear:webhook",
    correlationKey: "uuid-abc",
    message: "looks good, ship it",
    replyContext: { channel: "linear", issueId: "uuid-abc" }    <-- NEW
  }
    |
    v
  EventRouter -> slow_path
    |
    v
  Router LLM classifies -> approval
    |
    v
  signal_conversation({
    conversationId: "dev-agent-uuid-abc",
    signalType: "approval",
    payload: { approved: true },
    message: "looks good, ship it",
    replyContext: { channel: "linear", issueId: "uuid-abc" }    <-- NEW: propagated
  })
    |
    v
  ConversationExecutor.signal() builds user message:
    "Signal received: approval. Approved: yes.
     <reply_context>{"channel":"linear","issueId":"uuid-abc"}</reply_context>"
    |
    v
  Agent resumes, sees replyContext in message

OUTBOUND:
  Agent calls communication:reply({
    replyContext: { channel: "linear", issueId: "uuid-abc" },
    message: "Starting implementation now."
  })
    |
    v
  denormalize({ action: "reply", replyContext, content: { text: "Starting..." } })
    |
    v
  switch (replyContext.channel) -> "linear"
    |
    v
  callMcpTool({ integration: "linear", tool: "create_comment",
    params: { issueId: "uuid-abc", body: "Starting implementation now." },
    agentId: "dev-agent", correlationId: "dev-agent-uuid-abc" })
    |
    v
  HTTP POST http://linear-integration:3001/mcp/tools/create_comment
    |
    v
  Comment appears on Linear issue -- same channel the human used
```

### replyContext Propagation Chain

```
Adapter          IncomingEvent.replyContext
  |                    |
  v                    v
Router           event.replyContext accessible to slow-path LLM
  |                    |
  v                    v
signal_conversation  signal.replyContext (new optional field)
  |                    |
  v                    v
executor.signal()    Injected as <reply_context> XML tag in user message
  |                    |
  v                    v
Agent sees it        Passes it back opaquely to communication:reply
  |                    |
  v                    v
denormalizer         Dispatches to correct integration MCP tool
```

**Key design decisions:**

1. **replyContext is a top-level field on IncomingEvent and Signal, not nested in data.** This makes it structurally visible at every pipeline stage. If it were buried in `data`, each pipeline stage would need to know to extract and re-attach it.

2. **XML tags in signal messages, not structured message content.** The `<reply_context>` tag approach is simple, LLM-friendly (Claude naturally parses XML tags), and requires no changes to the `Anthropic.MessageParam` shape. The agent doesn't need to understand the JSON -- it just extracts and passes it through.

3. **Denormalizer lives in agents package, calls MCP via HTTP.** This maintains the 3-layer boundary. The denormalizer is NOT part of integrations -- it's the outbound equivalent of adapters, which also live in the agents package.

## Patterns to Follow

### Pattern 1: Adapter Symmetry

**What:** Inbound adapters normalize integration-specific payloads into domain events. Outbound denormalizers do the reverse -- domain actions into integration-specific tool calls.

**When:** Any time the agent needs to communicate with a human through an integration.

**Architecture:**
```
Adapter (inbound):  Integration payload -> IncomingEvent { type, data, replyContext }
Denormalizer (out):  DenormalizeAction { action, replyContext, content } -> callMcpTool(...)
```

Both live in the agents package. Both use MCP HTTP as the transport. Neither imports integration SDKs.

### Pattern 2: Opaque Context Pass-Through

**What:** The agent receives `replyContext` as a JSON object inside an XML tag. It passes it back to `communication:reply` without parsing or modifying it. The denormalizer is the only component that inspects the `channel` discriminant.

**When:** Signal delivery and reply routing.

**Why:** Agents should reason about WHAT to communicate, not WHERE. The infrastructure handles channel routing. This decouples agent behavior from integration specifics and makes it trivial to add new channels -- only the adapters, denormalizer, and integration MCP tools need changes, not the agents.

### Pattern 3: Additive Tool Registration

**What:** New `communication:*` tools are registered alongside existing `slack:*`, `linear:*` tools. The old tools remain available in the registry for the router and for backward compatibility.

**When:** Any tool namespace addition.

**Why:** The router uses `slack:send_message` directly (in `send-message.ts`) for system alerts. Removing the Slack tools from the registry would break the router. Only agent definitions change -- the registry stays additive.

### Pattern 4: Channel-Specific Capability Adaptation

**What:** The denormalizer adapts to each channel's capabilities. `ask()` with options renders as Block Kit buttons on Slack, but as text instructions on Linear and GitHub (which don't support interactive UI).

**When:** The `ask` tool is called with `options` array.

**Example:**
```
Slack: send_approval_request with Block Kit buttons
Linear: create_comment with "- **Approve**: reply 'approve'\n- **Reject**: reply 'reject'"
GitHub: create_pr_comment with similar text fallback
```

## Anti-Patterns to Avoid

### Anti-Pattern 1: Embedding Channel Logic in Agents

**What:** Agents calling `slack:send_message` or `linear:create_comment` directly when they should use `communication:reply`.

**Why bad:** Creates O(agents x integrations) complexity. Every new channel means updating every agent's tools and prompts. The agent reasons about channels instead of intent.

**Instead:** Agents use domain-language tools (`communication:reply/ask/notify`) and let the denormalizer handle channel dispatch.

### Anti-Pattern 2: Stripping replyContext at Pipeline Boundaries

**What:** A pipeline stage receives replyContext but doesn't propagate it to the next stage. Most likely to happen at the router slow-path LLM -> `signal_conversation` boundary, or at the executor signal -> user message boundary.

**Why bad:** Breaks the round-trip. Agent cannot reply to the originating channel.

**Instead:** Every pipeline stage that handles events or signals must propagate replyContext. Test each boundary explicitly.

### Anti-Pattern 3: Agent Parsing replyContext

**What:** Agent prompts instructing the agent to extract fields from replyContext (e.g., "check the channel field to decide if this is Slack or Linear").

**Why bad:** Defeats the purpose of channel abstraction. The agent should not reason about channels.

**Instead:** Agent treats replyContext as opaque. It receives it from signal messages and passes it back to communication tools unchanged. The denormalizer is the only component that inspects the structure.

### Anti-Pattern 4: Adding Communication Logic to the Executor

**What:** Having the conversation executor automatically reply to signals (e.g., "when signal is received, auto-reply with acknowledgment").

**Why bad:** Violates agent-first principles. The AGENT decides when and what to communicate. The executor manages conversation lifecycle, not communication behavior.

**Instead:** The executor's only new responsibility is injecting replyContext into the signal user message. The agent decides whether to call `reply()`.

## Scalability Considerations

| Concern | Current State | After v2.6 | At Scale |
|---------|--------------|------------|----------|
| Adding a new channel | N/A (hardcoded to Slack) | Add adapter replyContext + denormalizer case + MCP tool | Same -- O(1) per new channel |
| Adding a new agent | Copy/adapt channel tool list + prompt | Add communication:* tools (3 lines in YAML) | Same -- O(1) per new agent |
| MCP call overhead | 1 callMcpTool per outbound message | Same -- denormalizer calls 1 callMcpTool | Same |
| replyContext size | N/A | ~100-200 bytes per signal in user message | Negligible vs token budget |
| Tool count per agent | 20 (dev-agent), 11 (product-agent) | 21 (dev-agent), 13 (product-agent) | Net +1/+2 tools after swap |

## Inventory: Modified vs New Files

### New Files (7)

| File | Layer | Purpose |
|------|-------|---------|
| `shared/tools/communication/types.ts` | Agents | ReplyContext, NotifyTarget, MessageContent, CommunicationToolDeps types |
| `shared/tools/communication/denormalizer.ts` | Agents | Outbound dispatch: action + replyContext -> callMcpTool |
| `shared/tools/communication/reply.ts` | Agents | communication:reply tool factory |
| `shared/tools/communication/ask.ts` | Agents | communication:ask tool factory |
| `shared/tools/communication/notify.ts` | Agents | communication:notify tool factory |
| `shared/tools/communication/index.ts` | Agents | Barrel export |
| `integrations/github/src/mcp/tools/comments.ts` | Integration | handleCreatePRComment handler |

### Modified Files (16)

| File | Layer | Change |
|------|-------|--------|
| `adapters/types.ts` | Agents | Add `replyContext` to IncomingEventSchema |
| `adapters/slack.ts` | Agents | Attach replyContext on thread_reply, block_actions, app_mention |
| `adapters/linear.ts` | Agents | Attach replyContext on comment_created, agent_session |
| `adapters/github.ts` | Agents | Attach replyContext on pr_review, pr_merged, pr_closed |
| `framework/types.ts` | Agents | Add `replyContext` to SignalSchema |
| `framework/tool-factories.ts` | Agents | Register communication:* + linear:create_comment tools, add communicationAdapter |
| `framework/conversation-executor.ts` | Agents | Include replyContext XML tag in signal user messages |
| `shared/tools/integration/linear-tools.ts` | Agents | Add linear:create_comment wrapper |
| `router/tools/signal-conversation.ts` | Agents | Add optional replyContext to input schema |
| `router/system-prompt.ts` | Agents | replyContext propagation guidance, Linear comment routing |
| `integrations/linear/src/mcp/server.ts` | Integration | Register create_comment in ListTools + CallTool |
| `integrations/github/src/mcp/server.ts` | Integration | Register create_pr_comment in ListTools + CallTool |
| `integrations/github/src/mcp/schemas.ts` | Integration | Add CreatePRCommentInputSchema |
| `definitions/dev-agent/definition.yaml` | Agent Def | Swap slack:* for communication:* |
| `definitions/dev-agent/prompt.md` | Agent Def | Domain-language communication guidance |
| `definitions/product-agent/definition.yaml` | Agent Def | Swap slack:send_message for communication:* |
| `definitions/product-agent/prompt.md` | Agent Def | Domain-language communication guidance |

## Suggested Build Order

The build order is driven by dependencies: types must exist before they can be used, integration MCP tools must exist before the denormalizer can call them, and the denormalizer must exist before communication tools can call it.

### Phase 1: Types and MCP Prerequisites

**Goal:** Define all types and expose missing integration MCP tools. No agent behavior changes yet.

1. **Communication types** (`shared/tools/communication/types.ts`)
   - ReplyContext, NotifyTarget, MessageContent, CommunicationToolDeps
   - ReplyContextSchema (Zod) for validation in tool input schemas
   - No dependencies on other new code

2. **Linear MCP: Expose create_comment** (`integrations/linear/src/mcp/server.ts`)
   - Add `create_comment` to ListToolsRequestSchema handler (tool definition JSON)
   - Add `case "create_comment"` to CallToolRequestSchema handler
   - Handler already exists and is tested (`handleCreateComment`)
   - Add `linear:create_comment` wrapper to `shared/tools/integration/linear-tools.ts`
   - Register in `tool-factories.ts`

3. **GitHub MCP: Add create_pr_comment** (`integrations/github/`)
   - Add `CreatePRCommentInputSchema` to `schemas.ts`
   - Create `handleCreatePRComment` in `tools/comments.ts` (new file)
   - Uses `octokit.rest.issues.createComment` (PR comments are issue comments in GitHub API)
   - Register in `server.ts` ListTools + CallTool handlers
   - Add `github:create_pr_comment` wrapper to `shared/tools/integration/github-tools.ts`
   - Register in `tool-factories.ts`

**Why this order:** Types have no deps. Linear create_comment is mostly wiring (handler exists). GitHub create_pr_comment is a new handler but follows established patterns exactly.

### Phase 2: Inbound Pipeline Extension

**Goal:** Thread replyContext through the entire inbound pipeline from adapters through signals to agent messages.

4. **Extend IncomingEvent** (`adapters/types.ts`)
   - Add `replyContext: ReplyContextSchema.optional()` to IncomingEventSchema
   - Import ReplyContextSchema from communication types

5. **Extend adapters** (`adapters/slack.ts`, `linear.ts`, `github.ts`)
   - Slack: attach replyContext on `thread_reply`, `block_actions.*`, `app_mention`
   - Linear: attach replyContext on `issue_comment`, `agent_session.created`
   - GitHub: attach replyContext on `pr_review`, `pr_merged`, `pr_closed`

6. **Extend Signal schema** (`framework/types.ts`)
   - Add `replyContext: ReplyContextSchema.optional()` to SignalSchema

7. **Extend signal delivery** (`framework/conversation-executor.ts`)
   - When building signal user message, append `<reply_context>` XML tag if signal has replyContext
   - Also update the worker-loop.ts signal consumption (line 672) for queued signal auto-resume

8. **Extend router signal tool** (`router/tools/signal-conversation.ts`)
   - Add optional `replyContext` field to `SignalConversationInputSchema`
   - Propagate to `signal` object passed to `executor.signal()`

9. **Update router system prompt** (`router/system-prompt.ts`)
   - Instruct LLM to propagate replyContext from event data to signal_conversation calls
   - Add Linear comment reopen flow (query status, reopen if completed)

**Why this order:** IncomingEvent schema first (adapters depend on it), then adapters (signal depends on adapter output), then Signal schema (executor depends on it), then executor (agents depend on signal messages), then router (wires adapters to signals).

### Phase 3: Outbound Denormalizer and Tools

**Goal:** Build the denormalizer and communication tools. Agents can now use them.

10. **Denormalizer** (`shared/tools/communication/denormalizer.ts`)
    - `denormalize(action, deps)` function
    - Switch on `replyContext.channel`: slack, linear, github handlers
    - Each handler calls `callMcpTool` with correct integration, tool, and params
    - Slack: `reply_to_thread` for reply, `send_approval_request` for ask+options, `send_message` for notify
    - Linear: `create_comment` for all actions
    - GitHub: `create_pr_comment` for all actions

11. **Communication tools** (`shared/tools/communication/reply.ts`, `ask.ts`, `notify.ts`)
    - Each creates a `ToolDefinition` with Zod input schema and execute function
    - Execute validates input, calls `denormalize()`, returns result
    - Barrel export from `index.ts`

12. **Register communication tools** (`framework/tool-factories.ts`)
    - Add `communicationAdapter` function
    - Register `communication:reply`, `communication:ask`, `communication:notify`
    - Update tool count comment (34 -> 38: +3 communication, +1 linear:create_comment)

**Why this order:** Denormalizer is pure (no framework deps). Tools depend on denormalizer. Registration wires them in.

### Phase 4: Agent Migration

**Goal:** Switch agents from channel-specific to domain-language communication.

13. **Update agent definitions** (`definitions/*/definition.yaml`)
    - dev-agent: remove `slack:send_message`, `slack:send_approval_request`; add `communication:reply`, `communication:ask`, `communication:notify`
    - product-agent: remove `slack:send_message`; add `communication:reply`, `communication:ask`, `communication:notify`

14. **Update agent prompts** (`definitions/*/prompt.md`)
    - Replace channel-specific communication guidance with domain-language patterns
    - Explain replyContext pass-through: "use the replyContext from the signal message"
    - Explain notify for escalation: "when no replyContext is available, use notify with a target channel"

**Why this order:** YAML changes are safe to make last -- if anything in Phase 1-3 is wrong, the agents still work with old tools. Prompt changes should happen alongside YAML changes since they reference the same tools.

### Phase 5: Testing and Validation

15. **Unit tests**
    - Denormalizer dispatch: each channel routes to correct MCP tool
    - Format adaptation: ask+options renders differently per channel
    - replyContext propagation: adapter -> IncomingEvent -> Signal -> user message
    - Each communication tool validates input correctly

16. **Integration tests**
    - Full round-trip: Slack event -> signal with replyContext -> agent reply -> correct MCP call
    - Cross-channel: Linear comment signal -> agent reply -> linear:create_comment called
    - Missing replyContext: agent uses notify() gracefully

### Dependency Graph

```
Phase 1: Types + MCP Prerequisites          (no deps)
    |
    v
Phase 2: Inbound Pipeline Extension         (depends on Phase 1 types)
    |
    v
Phase 3: Outbound Denormalizer + Tools       (depends on Phase 1 MCP tools)
    |
    v
Phase 4: Agent Migration                     (depends on Phase 2 + 3)
    |
    v
Phase 5: Testing                             (depends on all)
```

**Parallelism opportunity:** Phase 2 (inbound) and Phase 3 (outbound) can be built in parallel after Phase 1 types are defined. They don't depend on each other -- Phase 2 threads replyContext through the pipeline, Phase 3 consumes it. They converge in Phase 4 when agents are updated to use both.

## Critical Integration Points

### 1. Adapter -> IncomingEvent (replyContext attachment)

Each adapter constructs replyContext from event payload fields that already exist:

- **Slack**: `channelId` and `threadTs` are already in the payload (verified in `adaptSlackEvent`, lines 130-141)
- **Linear**: `issueId` is already in the payload (verified in `adaptLinearEvent`, lines 66-77)
- **GitHub**: `prNumber` is already in the payload, but `owner` and `repo` are NOT currently in the payload. The GitHub adapter needs the router or enrichment step to inject owner/repo, or these must be added to the GitHub webhook NormalizedEvent payload.

**Flag:** GitHub adapter lacks `owner` and `repo` in the payload. These are available in the GitHub webhook payload (`repository.owner.login`, `repository.name`) but may not be propagated through the NormalizedEvent. This needs verification in `packages/integrations/github/src/webhooks/` to confirm what fields are available. Alternatively, the GitHub integration knows its configured owner from env config -- the agent-service could read it from env, or the GitHub webhook normalizer could include it.

### 2. Signal Schema -> Executor (replyContext in user message)

The signal delivery in `conversation-executor.ts` (line 388) needs to change from:

```typescript
const signalContent = signal.message ??
  `Signal received: ${signal.type}. Data: ${JSON.stringify(signal.data ?? {})}`;
```

To something like:

```typescript
let signalContent = signal.message ??
  `Signal received: ${signal.type}. Data: ${JSON.stringify(signal.data ?? {})}`;
if (signal.replyContext) {
  signalContent += `\n\n<reply_context>${JSON.stringify(signal.replyContext)}</reply_context>`;
}
```

**Same change needed in worker-loop.ts** at line 672 (queued signal consumption) and line 919 (queued signal consumption at pause point). These are three separate locations where signal content is built -- all three must include replyContext.

### 3. Router Slow-Path -> signal_conversation (replyContext forwarding)

The router LLM receives the IncomingEvent as context. The slow-path (`routeViaAgentLoopV2`) passes the full event to the LLM. The LLM then calls `signal_conversation` -- but currently the `signal_conversation` tool has no `replyContext` field in its input schema.

Two approaches:
- **Option A:** Add replyContext to signal_conversation input schema. The LLM extracts it from the event and passes it through. Risk: LLM might not consistently do this.
- **Option B:** The `routeViaAgentLoopV2` function extracts replyContext from the IncomingEvent and auto-attaches it to any signal_conversation call. Risk: requires intercepting tool outputs.

**Recommendation:** Option A is simpler and consistent with the agent-first principle. Add the field, update the router system prompt to explain it, and validate in testing. If the LLM inconsistently passes it, add deterministic extraction as a fallback in a subsequent iteration.

### 4. Task Router Path (replyContext bypass)

The task-aware routing path in `router.ts` (line 87-101) builds signals directly without going through the slow-path LLM:

```typescript
const signal = {
  type: event.type,
  data: event.data,
  message: event.message,
  source: event.source,
  deduplicationId: event.deduplicationId,
};
```

This must be updated to include:
```typescript
...(event.replyContext && { replyContext: event.replyContext }),
```

**This is a one-line change but critical** -- without it, task-routed events lose their replyContext even though the adapter attached it.

### 5. Fast-Path Signal Delivery (EventRouter)

The deterministic `EventRouter.handle()` produces routing decisions that include a `signal` field for signal routes. The EventRouter builds signals from IncomingEvent data. Currently, the `EventRouterRouteResult` for signal action includes the full Signal object -- this must include replyContext from the IncomingEvent.

Check `event-router.ts` to verify how signals are constructed in the fast-path. If the EventRouter copies fields from IncomingEvent to Signal, replyContext propagation is automatic once both schemas have the field. If not, explicit forwarding is needed.

## Sources

All findings are from direct codebase inspection. File paths and line numbers are verified against the current codebase as of 2026-02-08.

| File | What Was Verified |
|------|-------------------|
| `packages/agents/src/framework/tool-factories.ts` | All 34 tool registrations, adapter patterns |
| `packages/agents/src/framework/types.ts` | ToolContext, SignalSchema, ToolRegistry interfaces |
| `packages/agents/src/framework/conversation-executor.ts` | Signal delivery logic (line 388), message construction |
| `packages/agents/src/framework/worker-loop.ts` | Signal consumption at 3 locations (lines 672, 919) |
| `packages/agents/src/adapters/types.ts` | IncomingEventSchema fields, no replyContext |
| `packages/agents/src/adapters/slack.ts` | All event handlers, payload fields available |
| `packages/agents/src/adapters/linear.ts` | All event handlers, issueId availability |
| `packages/agents/src/adapters/github.ts` | PR events, payload fields (prNumber present, owner/repo absent) |
| `packages/agents/src/shared/tools/integration/mcp-wrapper.ts` | McpToolDeps pattern, createMcpToolWrapper |
| `packages/agents/src/shared/mcp/client.ts` | callMcpTool HTTP protocol, retry logic |
| `packages/agents/src/router/tools/signal-conversation.ts` | Signal schema (no replyContext) |
| `packages/agents/src/router/system-prompt.ts` | Full router prompt, no replyContext guidance |
| `packages/agents/src/router/router.ts` | Task routing signal construction (line 87-101) |
| `packages/integrations/linear/src/mcp/server.ts` | 6 tools registered, create_comment MISSING |
| `packages/integrations/linear/src/mcp/tools/issues.ts` | handleCreateComment EXISTS (line 472) |
| `packages/integrations/github/src/mcp/server.ts` | 9 tools registered, no comment tool |
| `packages/integrations/github/src/mcp/tools/pullrequests.ts` | PR handlers, no comment handler |
| `packages/agents/definitions/dev-agent/definition.yaml` | 20 tools, slack:send_message + send_approval_request |
| `packages/agents/definitions/product-agent/definition.yaml` | 11 tools, slack:send_message |
