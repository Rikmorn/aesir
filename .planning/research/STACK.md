# Technology Stack: v2.6 Unified Agent Communication

**Project:** Aesir v2.6 -- Domain-language I/O (symmetric outbound normalization)
**Researched:** 2026-02-08
**Research mode:** Stack dimension for subsequent milestone
**Overall confidence:** HIGH (zero new runtime dependencies; extends existing patterns with pure TypeScript)

---

## Executive Summary

v2.6 requires **zero new npm dependencies**. The unified communication layer -- ReplyContext types, outbound denormalizer, communication tools, and MCP tool additions -- is implementable entirely within the existing stack: Zod for discriminated union validation, the existing ToolRegistry + ToolFactory pattern for new `communication:*` tools, the existing `callMcpTool` MCP client for outbound dispatch, and Octokit (already installed at `@octokit/rest@^22.0.1`) for the new `create_pr_comment` MCP tool.

This is a pure architecture layer, not a technology change. The spec describes:
1. **New Zod schemas** for `ReplyContext` discriminated union and `NotifyTarget`
2. **Schema extensions** to `IncomingEventSchema` and `SignalSchema` (optional `replyContext` field)
3. **Three new tool factories** (`communication:reply`, `communication:ask`, `communication:notify`) following the existing `ToolFactory` pattern
4. **An outbound denormalizer** -- a pure function that maps domain actions to `callMcpTool` calls via a `switch` on `replyContext.channel`
5. **Two MCP tool additions** -- expose existing `linear:create_comment`, add new `github:create_pr_comment`
6. **Adapter modifications** -- attach `replyContext` to outbound `IncomingEvent` objects
7. **Signal pipeline changes** -- propagate `replyContext` through signals into agent messages

No new libraries. No new infrastructure. No new database tables. The entire feature is TypeScript types, Zod schemas, tool factories, and function composition built on existing primitives.

---

## 1. ReplyContext Type System (Zod Discriminated Unions)

### Recommendation: Zod discriminated union on `channel` field

| Property | Value |
|----------|-------|
| Library | zod@3.25.67 (existing, pinned) |
| Pattern | `z.discriminatedUnion("channel", [...])` |
| Location | `packages/agents/src/shared/tools/communication/types.ts` (new file) |
| Confidence | HIGH -- Zod discriminated unions are well-established; pattern used implicitly in existing adapter code |

### Why Zod discriminated union (not plain TypeScript union)

The `ReplyContext` type flows through the entire signal pipeline: adapters produce it, signals carry it, agents pass it through, communication tools consume it. At multiple boundaries (adapter output, signal delivery, tool input), this data is validated from `unknown` input. Zod discriminated unions provide:

1. **Runtime validation with exhaustive matching** -- `z.discriminatedUnion("channel", [...])` validates the discriminant and applies the correct variant schema automatically
2. **Type inference** -- `z.infer<typeof ReplyContextSchema>` produces the correct TypeScript discriminated union type, avoiding manual type definition drift
3. **JSON Schema generation** -- `zod-to-json-schema` (already used in the agents package) can convert the schema for tool `inputSchema` definitions the LLM sees
4. **Parse-don't-validate** -- adapters call `ReplyContextSchema.parse(data)` once and the validated type flows through the rest of the pipeline

### Schema Design

```typescript
// Zod discriminated union -- validates the channel discriminant first,
// then applies the variant-specific schema
export const ReplyContextSchema = z.discriminatedUnion("channel", [
  z.object({
    channel: z.literal("slack"),
    teamId: z.string(),
    channelId: z.string(),
    threadTs: z.string(),
  }),
  z.object({
    channel: z.literal("linear"),
    issueId: z.string(),
  }),
  z.object({
    channel: z.literal("github"),
    owner: z.string(),
    repo: z.string(),
    prNumber: z.number(),
    commentId: z.number().optional(),
  }),
]);

export type ReplyContext = z.infer<typeof ReplyContextSchema>;
```

### Alternatives Considered

| Option | Why Not |
|--------|---------|
| Plain TypeScript union (no Zod) | ReplyContext arrives as `unknown` from JSON (signal payloads, tool inputs). Without Zod, every consumer needs manual validation. |
| Separate schema per channel | Fragmented validation; the discriminated union is the idiomatic Zod pattern for this exact case. |
| io-ts or valibot | Project already uses Zod everywhere. Adding a second validation library for one type is waste. |

---

## 2. Schema Extensions (IncomingEvent + Signal)

### Recommendation: Add optional `replyContext` field to existing Zod schemas

| Property | Value |
|----------|-------|
| Files modified | `packages/agents/src/adapters/types.ts` (IncomingEventSchema), `packages/agents/src/framework/types.ts` (SignalSchema) |
| Pattern | `.extend({ replyContext: ReplyContextSchema.optional() })` or direct addition to existing `z.object()` |
| Breaking changes | None -- field is optional, existing code that doesn't produce/consume replyContext is unaffected |
| Confidence | HIGH -- additive schema change, no migration needed |

### Why Extend Existing Schemas (Not New Types)

The spec explicitly requires `replyContext` to flow through the existing pipeline: adapters -> IncomingEvent -> router -> Signal -> executor -> agent message. Creating separate event types would require forking the entire routing pipeline. Adding an optional field to existing schemas is both simpler and backward-compatible.

### Implementation Pattern

```typescript
// In adapters/types.ts -- extend IncomingEventSchema
export const IncomingEventSchema = z.object({
  type: z.string().min(1),
  data: z.record(z.unknown()),
  source: z.string().min(1),
  correlationKey: z.string().optional(),
  deduplicationId: z.string().optional(),
  message: z.string().optional(),
  taskId: z.string().optional(),
  replyContext: ReplyContextSchema.optional(),  // NEW
});

// In framework/types.ts -- extend SignalSchema
export const SignalSchema = z.object({
  type: z.string().min(1),
  data: z.record(z.unknown()).optional(),
  message: z.string().optional(),
  source: z.string().optional(),
  deduplicationId: z.string().optional(),
  replyContext: ReplyContextSchema.optional(),  // NEW
});
```

---

## 3. Communication Tools (ToolFactory Pattern)

### Recommendation: New `communication` namespace with 3 tools following existing patterns

| Property | Value |
|----------|-------|
| Namespace | `communication` |
| Tools | `reply`, `ask`, `notify` |
| Location | `packages/agents/src/shared/tools/communication/` (new directory) |
| Registration | `packages/agents/src/framework/tool-factories.ts` |
| Adapter pattern | New `communicationAdapter()` following existing `mcpAdapter()` and `codebaseAdapter()` |
| Confidence | HIGH -- follows established ToolFactory -> ToolRegistry -> agent definition YAML pattern |

### Why Not Extend Existing MCP Tools

The communication tools are **not** MCP tools. They don't call a single integration endpoint -- they dispatch to different integration MCP endpoints based on `replyContext.channel`. The denormalizer logic (choosing which integration and tool to call) lives inside these tool factories, not in an external MCP server. This is infrastructure-layer routing, not integration-layer functionality.

### Tool Factory Dependencies

The communication tools need the same `McpToolDeps` that existing integration tools use (`agentId`, `correlationId`, `taskId`), plus a `logger`. The spec defines `CommunicationToolDeps`:

```typescript
export interface CommunicationToolDeps {
  agentId: string;
  correlationId: string;
  taskId?: string;
  logger: PinoLogger;
}
```

This is extracted from `ToolContext` by a `communicationAdapter()` function, mirroring the existing `mcpAdapter()` pattern:

```typescript
function communicationAdapter(
  factory: (deps: CommunicationToolDeps) => ToolDefinition,
): (ctx: ToolContext) => ToolDefinition {
  return (ctx: ToolContext) =>
    factory({
      agentId: ctx.agentId,
      correlationId: ctx.correlationId,
      taskId: ctx.taskId,
      logger: ctx.logger,
    });
}
```

### Registration

```typescript
// In tool-factories.ts
registry.register("communication:reply", communicationAdapter(createReplyTool));
registry.register("communication:ask", communicationAdapter(createAskTool));
registry.register("communication:notify", communicationAdapter(createNotifyTool));
```

This brings the total tool count from 34 to 37 (3 new communication tools).

### Alternatives Considered

| Option | Why Not |
|--------|---------|
| Add communication tools as MCP endpoints in a new service | Overengineered. The denormalizer calls existing MCP tools -- it doesn't need its own HTTP server. |
| Extend each integration MCP server with "smart routing" | Violates separation of concerns. Integrations are channel-specific by design; routing belongs in the agents layer. |
| Use existing Slack tools and add "if not Slack, use X" logic in prompts | Exactly the anti-pattern the spec eliminates. Agent should not reason about channels. |

---

## 4. Outbound Denormalizer (Pure Function Dispatch)

### Recommendation: `switch` dispatch on `replyContext.channel`, calling `callMcpTool` for each variant

| Property | Value |
|----------|-------|
| Location | `packages/agents/src/shared/tools/communication/denormalizer.ts` (new file) |
| Pattern | Pure function with discriminant-based dispatch |
| MCP client | Existing `callMcpTool` from `packages/agents/src/shared/mcp/client.ts` |
| Confidence | HIGH -- straightforward dispatch; no new libraries or patterns needed |

### Why Not a Library/Framework for Message Routing

I searched for existing TypeScript libraries or frameworks for outbound message routing / denormalization in agent systems. **None exist as standalone libraries.** The closest patterns are:

1. **Enterprise Integration Patterns** (Message Dispatcher, Content-Based Router) -- these are architectural patterns, not libraries. The denormalizer implements a Content-Based Router pattern where the routing key is `replyContext.channel`.
2. **Mastra framework** -- has model routing (LLM provider dispatch) but no outbound channel routing.
3. **Google ADK** -- has agent-to-agent routing but no multi-channel output abstraction.
4. **Spring Integration** (Java) -- has channel adapters and message dispatchers, but nothing equivalent exists in the TypeScript ecosystem.

The denormalizer is ~100 lines of straightforward TypeScript. A library would add dependency weight for no value. The `switch` pattern on a discriminated union is the idiomatic TypeScript solution.

### Implementation Structure

```typescript
export interface DenormalizeAction {
  action: "reply" | "ask" | "notify";
  replyContext: ReplyContext | NotifyTarget;
  content: MessageContent;
}

export async function denormalize(
  action: DenormalizeAction,
  deps: CommunicationToolDeps,
): Promise<DenormalizeResult> {
  switch (action.replyContext.channel) {
    case "slack":
      return denormalizeSlack(action, action.replyContext, deps);
    case "linear":
      return denormalizeLinear(action, action.replyContext, deps);
    case "github":
      return denormalizeGitHub(action, action.replyContext, deps);
    default: {
      const _exhaustive: never = action.replyContext;
      throw new Error(`Unknown channel: ${(action.replyContext as ReplyContext).channel}`);
    }
  }
}
```

Each channel denormalizer maps the domain action to the correct `callMcpTool` invocation:

| Channel | action=reply | action=ask (with options) | action=ask (no options) | action=notify |
|---------|-------------|--------------------------|------------------------|---------------|
| slack | `slack:reply_to_thread` | `slack:send_approval_request` | `slack:reply_to_thread` | `slack:send_message` |
| linear | `linear:create_comment` | `linear:create_comment` (options as text) | `linear:create_comment` | `linear:create_comment` |
| github | `github:create_pr_comment` | `github:create_pr_comment` (options as text) | `github:create_pr_comment` | `github:create_pr_comment` |

### Why Exhaustive Switch (Not If-Else Chain)

TypeScript's exhaustive check on discriminated unions (`const _exhaustive: never = ...`) catches missing channels at compile time. When a new channel is added (e.g., `"email"`), the compiler forces updating the denormalizer. This is critical because a silently unhandled channel means messages are lost.

---

## 5. New MCP Tools (Integration Layer)

### 5a. Expose `linear:create_comment`

| Property | Value |
|----------|-------|
| Status | **Handler already implemented** in `packages/integrations/linear/src/mcp/tools/issues.ts` (`handleCreateComment`) |
| Status | **Schema already defined** in `packages/integrations/linear/src/mcp/schemas.ts` (`CreateCommentInputSchema`) |
| Status | **Handler already exported** from `packages/integrations/linear/src/mcp/tools/index.ts` |
| Gap | NOT registered in MCP server's `ListToolsRequestSchema` handler |
| Gap | NOT registered in MCP server's `CallToolRequestSchema` handler |
| Gap | NOT registered in agent-side `linear-tools.ts` |
| Gap | NOT in MCP permission seed script |
| Work required | 4 additions (server tool list entry, server handler case, agent-side wrapper, seed script) |
| Confidence | HIGH -- implementation is complete, just needs wiring |

The `handleCreateComment` function follows the exact same pattern as all other Linear tools (permission check, input validation, Linear SDK call). The only work is registration:

1. Add `create_comment` to `ListToolsRequestSchema` handler in `linear/src/mcp/server.ts`
2. Add `case "create_comment"` to `CallToolRequestSchema` handler
3. Add `linear:create_comment` wrapper to `agents/src/shared/tools/integration/linear-tools.ts`
4. Add permission seed for `create_comment`
5. Register `linear:create_comment` in `tool-factories.ts`

### 5b. Add `github:create_pr_comment`

| Property | Value |
|----------|-------|
| Library | `@octokit/rest@^22.0.1` (existing in `@aesir/integration-github`) |
| API method | `octokit.rest.issues.createComment()` |
| Why issues API | GitHub's REST API treats PR comments as issue comments. PR-level comments (not inline review comments) use `issues.createComment({ owner, repo, issue_number: prNumber, body })`. This is well-documented and stable. |
| Location | `packages/integrations/github/src/mcp/tools/pullrequests.ts` (add `handleCreatePRComment`) |
| Schema | `packages/integrations/github/src/mcp/schemas.ts` (add `CreatePRCommentInputSchema`) |
| Confidence | HIGH -- `issues.createComment` is a stable Octokit API; already used widely in GitHub Actions |

### Octokit API Verification

The `@octokit/rest` package already installed in the GitHub integration provides `octokit.rest.issues.createComment()`. PR-level comments in GitHub's API are issue comments (since every PR is also an issue). The implementation:

```typescript
// GitHub API: PR comments are issue comments
const { data: comment } = await octokit.rest.issues.createComment({
  owner,
  repo,
  issue_number: prNumber,  // PR number works as issue number
  body,
});
```

For inline review comment replies (replying to a specific line comment), the API is `octokit.rest.pulls.createReplyForReviewComment()`. The spec marks this as optional -- implementing the PR-level comment first is sufficient for the denormalizer.

### Schema Addition

```typescript
// New schema in github/src/mcp/schemas.ts
export const CreatePRCommentInputSchema = z.object({
  owner: z.string().min(1, "Owner is required"),
  repo: z.string().min(1, "Repository name is required"),
  prNumber: z.number().int().positive("PR number must be positive"),
  body: z.string().min(1, "Comment body is required"),
});
```

### Alternatives Considered

| Option | Why Not |
|--------|---------|
| Use `pulls.createReview` instead of `issues.createComment` | `createReview` is for code review submissions (approve/request changes). PR-level discussion comments use the issues API. |
| Use `pulls.createReviewComment` | That's for inline code comments on specific diff lines, not general PR comments. |
| Use GraphQL API | Octokit REST is already the established pattern. No benefit to switching for one endpoint. |

---

## 6. Signal Pipeline Modifications

### Recommendation: Propagate `replyContext` through XML tags in signal user messages

| Property | Value |
|----------|-------|
| Files modified | `packages/agents/src/framework/conversation-executor.ts`, `packages/agents/src/framework/worker-loop.ts` |
| Pattern | Append `<reply_context>` XML tag to signal message content |
| Parsing | Agent passes opaque JSON back through `communication:reply` tool input; Zod validates |
| Confidence | HIGH -- simple string concatenation; agents already process structured content in messages |

### Why XML Tags (Not Structured Tool Results)

The signal message is injected as a `user` role message in the conversation. There are three options for including `replyContext`:

| Option | Pros | Cons |
|--------|------|------|
| **XML tags in message text** | Simple to implement; LLM natively handles XML-like structured data in text; agent just passes the blob through to `reply()` | Agent could theoretically hallucinate or modify the context |
| Structured system message | Separates context from content | Anthropic API doesn't support structured metadata in user messages; would require a separate system message injection |
| Tool result content block | Type-safe | Signals aren't tool results; this would require an awkward tool call/result simulation |

XML tags are the pragmatic choice. The agent doesn't need to understand the content -- it just passes `replyContext` from the signal message into the `reply()` / `ask()` tool call. The Zod schema in the tool validates the JSON structure.

### Signal Message Format

```
Signal received: approval. Approved: yes, by Roberto.

<reply_context>{"channel":"linear","issueId":"uuid-abc"}</reply_context>
```

The `<reply_context>` tag is:
- Machine-parseable (JSON inside tags)
- LLM-transparent (agent can reference it without understanding internals)
- Safe to validate (Zod schema in communication tool validates before dispatch)

---

## 7. Adapter Modifications (Inbound ReplyContext Attachment)

### Recommendation: Add `replyContext` construction to each adapter's return path

| Property | Value |
|----------|-------|
| Files modified | `packages/agents/src/adapters/slack.ts`, `packages/agents/src/adapters/linear.ts`, `packages/agents/src/adapters/github.ts` |
| Pattern | Construct `ReplyContext` from existing webhook payload data |
| Breaking changes | None -- `replyContext` is optional on `IncomingEvent` |
| Confidence | HIGH -- all required data (channelId, threadTs, issueId, prNumber, owner, repo) is already present in webhook payloads |

### Data Availability by Adapter

| Adapter | ReplyContext channel | Required data | Source in payload |
|---------|---------------------|---------------|-------------------|
| Slack | `slack` | teamId, channelId, threadTs | `payload.teamId`, `payload.channel`, `payload.threadTs` -- all already extracted |
| Linear | `linear` | issueId | `payload.issueId` or derived from webhook data -- already available |
| GitHub | `github` | owner, repo, prNumber | `payload.repository.owner`, `payload.repository.name`, `payload.pull_request.number` -- already in webhook payloads |

No new API calls or data fetches are needed. The adapters already extract all the information required to construct `ReplyContext`.

---

## 8. Router Tool Extension

### Recommendation: Add optional `replyContext` field to `signal_conversation` tool input

| Property | Value |
|----------|-------|
| File modified | `packages/agents/src/router/tools/signal-conversation.ts` |
| Pattern | Add `replyContext: ReplyContextSchema.optional()` to input schema |
| Propagation | Include in `Signal` object passed to `executor.signal()` |
| Confidence | HIGH -- additive field, no breaking changes |

The router already receives `IncomingEvent` objects with `replyContext` (after adapter modifications). The slow-path LLM router needs to propagate this through to `signal_conversation` so it reaches the agent. Fast-path routing (e.g., block actions) constructs signals directly in the adapter -- those already have the data.

---

## 9. Agent Definition and Prompt Changes

### Recommendation: Swap channel-specific tools for `communication:*` tools in YAML definitions

| Property | Value |
|----------|-------|
| Files modified | `packages/agents/definitions/dev-agent/definition.yaml`, `packages/agents/definitions/product-agent/definition.yaml` |
| Pattern | Replace `slack:send_message`, `slack:send_approval_request` with `communication:reply`, `communication:ask`, `communication:notify` |
| Prompt files | `packages/agents/definitions/dev-agent/prompt.md`, `packages/agents/definitions/product-agent/prompt.md` |
| Confidence | HIGH -- declarative YAML changes; prompt updates follow existing PROMPT_GUIDE.md |

### Tool Assignment Changes

**dev-agent tools (21 -> 21, net zero change):**
- Remove: `slack:send_message`, `slack:send_approval_request` (-2)
- Add: `communication:reply`, `communication:ask`, `communication:notify` (+3)
- Net: +1 tool (was 21, becomes 22)

**product-agent tools (13 -> 15, +2 tools):**
- Remove: `slack:send_message` (-1)
- Add: `communication:reply`, `communication:ask`, `communication:notify` (+3)
- Net: +2 tools (was 13, becomes 15)

### Why Keep Integration-Specific Read Tools

Agents retain `linear:get_issue`, `github:get_pull_request`, etc. These are not communication tools -- they're information retrieval tools. The agent needs to read issue details, check PR status, etc. The unified communication layer replaces only *outbound message delivery*, not data queries.

---

## 10. What NOT to Add

### No New Runtime Dependencies

| Temptation | Why Not |
|------------|---------|
| Message queue (Redis, RabbitMQ) for outbound dispatch | The denormalizer is synchronous dispatch within a tool execution. No async fan-out needed. |
| Template engine (Handlebars, EJS) for channel-specific formatting | The denormalizer's per-channel functions handle formatting differences directly. Templates add complexity for minimal benefit. |
| Abstract messaging library | Nothing in the npm ecosystem fits this use case. The denormalizer is ~100 LOC of `callMcpTool` dispatch. |
| New MCP server for communication tools | Communication tools dispatch to existing MCP servers. Adding an intermediary server adds latency and complexity for no value. |
| Database tables for message history | Agent conversation history already captures tool calls and results. Duplicating this in a separate message store is waste. |
| WebSocket connections between agent and integrations | MCP HTTP is the established pattern. WebSockets add connection management complexity. |

### No New Database Schema

The unified communication layer is stateless. `ReplyContext` is ephemeral data carried through the signal pipeline -- it doesn't need persistence. The existing `agent_events` table already captures tool calls (including `communication:reply` calls with their parameters) for observability.

### No Changes to MCP Client

The existing `callMcpTool` function in `packages/agents/src/shared/mcp/client.ts` is sufficient. The denormalizer calls it with `integration: "slack" | "linear" | "github"` and the appropriate tool name. No client changes needed.

---

## Recommended Stack Summary

### New Files (to create)

| File | Purpose |
|------|---------|
| `packages/agents/src/shared/tools/communication/types.ts` | `ReplyContext`, `NotifyTarget`, `MessageContent`, `CommunicationToolDeps` Zod schemas and types |
| `packages/agents/src/shared/tools/communication/denormalizer.ts` | Outbound dispatch function (`denormalize`) |
| `packages/agents/src/shared/tools/communication/reply.ts` | `communication:reply` tool factory |
| `packages/agents/src/shared/tools/communication/ask.ts` | `communication:ask` tool factory |
| `packages/agents/src/shared/tools/communication/notify.ts` | `communication:notify` tool factory |
| `packages/agents/src/shared/tools/communication/index.ts` | Barrel export |
| `packages/integrations/github/src/mcp/tools/comments.ts` | `handleCreatePRComment` MCP handler |

### Existing Files (to modify)

| File | Change |
|------|--------|
| `packages/agents/src/adapters/types.ts` | Add `replyContext` to `IncomingEventSchema` |
| `packages/agents/src/adapters/slack.ts` | Attach `replyContext` to outbound events |
| `packages/agents/src/adapters/linear.ts` | Attach `replyContext` to outbound events |
| `packages/agents/src/adapters/github.ts` | Attach `replyContext` to outbound events |
| `packages/agents/src/framework/types.ts` | Add `replyContext` to `SignalSchema` |
| `packages/agents/src/framework/conversation-executor.ts` | Include `replyContext` in signal user messages |
| `packages/agents/src/framework/worker-loop.ts` | Include `replyContext` in signal user messages (3 locations) |
| `packages/agents/src/framework/tool-factories.ts` | Register 3 `communication:*` tools |
| `packages/agents/src/shared/tools/integration/linear-tools.ts` | Add `linear_create_comment` wrapper |
| `packages/agents/src/router/tools/signal-conversation.ts` | Add `replyContext` to input schema |
| `packages/integrations/linear/src/mcp/server.ts` | Register `create_comment` in server |
| `packages/integrations/github/src/mcp/server.ts` | Register `create_pr_comment` in server |
| `packages/integrations/github/src/mcp/schemas.ts` | Add `CreatePRCommentInputSchema` |
| `packages/integrations/github/src/mcp/tools/index.ts` | Export new handler |
| `packages/agents/definitions/dev-agent/definition.yaml` | Swap tools |
| `packages/agents/definitions/dev-agent/prompt.md` | Domain-language communication guidance |
| `packages/agents/definitions/product-agent/definition.yaml` | Swap tools |
| `packages/agents/definitions/product-agent/prompt.md` | Domain-language communication guidance |

### No New Dependencies

```bash
# No installation commands needed
# All required packages are already in the monorepo:
# - zod@3.25.67 (agents, integrations)
# - @octokit/rest@^22.0.1 (github integration)
# - @linear/sdk@^70.0.0 (linear integration)
# - @slack/bolt@^4.3.0, @slack/web-api@^7.10.0 (slack integration)
```

---

## Confidence Assessment

| Area | Confidence | Reason |
|------|------------|--------|
| ReplyContext type design | HIGH | Zod discriminated unions are a well-established pattern; data is already available in webhooks |
| Denormalizer dispatch | HIGH | Pure function, exhaustive switch on 3 channels, calls existing MCP tools |
| Communication tool factories | HIGH | Follows exact ToolFactory pattern used by 34 existing tools |
| Linear create_comment exposure | HIGH | Handler already implemented and tested; just needs registration |
| GitHub create_pr_comment | HIGH | `octokit.rest.issues.createComment()` is stable and well-documented |
| Signal pipeline replyContext propagation | HIGH | Simple string concatenation in 3 existing code locations |
| Adapter replyContext attachment | HIGH | All required data already present in webhook payloads |
| Agent prompt changes | MEDIUM | Prompt effectiveness for domain-language communication needs E2E validation |

---

## Sources

- Octokit PR comment API: verified via `@octokit/rest` types and [community examples](https://gist.github.com/smarr/317e83149bb564e54dc2b662a312ae03)
- Existing codebase: `packages/agents/src/shared/tools/integration/mcp-wrapper.ts`, `packages/agents/src/framework/tool-factories.ts`, `packages/agents/src/adapters/types.ts`
- Linear create_comment: verified implemented in `packages/integrations/linear/src/mcp/tools/issues.ts` (lines 469-563)
- Zod discriminated unions: verified in Zod documentation and existing codebase patterns
- GitHub API PR comments: GitHub REST API treats PR comments as issue comments via `issues.createComment`
- Agent framework landscape: [Mastra](https://mastra.ai/), [VoltAgent](https://github.com/VoltAgent/voltagent), [Google ADK](https://developers.googleblog.com/introducing-agent-development-kit-for-typescript-build-ai-agents-with-the-power-of-a-code-first-approach/) -- none provide outbound channel routing abstractions; this is an application-layer concern, not a framework feature
