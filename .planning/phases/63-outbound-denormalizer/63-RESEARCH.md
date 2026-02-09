# Phase 63: Outbound Denormalizer - Research

**Researched:** 2026-02-09
**Domain:** Outbound communication dispatch (denormalizer + communication tools + tool registration)
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Denormalizer interface
- Pure function signature: `denormalize({ replyContext, text }, deps)` -- no action field
- No `DenormalizeAction` type with action discriminator -- reply, ask, and notify all produce the same denormalizer call
- Return type matches callMcpTool's return type directly -- no wrapper type (DenormalizeResult is YAGNI)
- Denormalizer dispatches on `replyContext.channel` via exhaustive TypeScript switch
- Single info-level log per dispatch: `{ channel, tool, agentId }` -- the denormalizer is the only place that knows both

#### Slack dispatch
- threadTs present -> `reply_to_thread`, absent -> `send_message`
- No `send_approval_request` -- the communication layer is purely conversational
- `send_approval_request` stays in the Slack integration registry for router/legacy paths but is never called by the denormalizer

#### Linear dispatch
- All delivery -> `create_comment` with `{ issueId, body }`

#### GitHub dispatch
- All delivery -> `create_pr_comment` with `{ owner, repo, prNumber, body }`
- `commentId` -> `inReplyTo` param if present (for future inline review comment replies, deferred in v2.6)

#### Fallback behavior
- reply() requires replyContext in the Zod schema -- not optional, strict validation error if missing
- No conversation-level fallback, no defaultNotifyTarget fallback, no implicit recovery
- If agent calls reply() without replyContext, it gets a Zod validation error -- that's a prompt issue, not a denormalizer issue
- MCP errors propagate as-is to the tool result -- same as every other MCP tool in the codebase
- No denormalizer-level error wrapping, no guidance messages, no structured error types
- Unknown channel is unreachable: Zod discriminated union rejects it, TypeScript exhaustive switch catches it at compile time

#### Error handling
- No retry logic in denormalizer -- relies entirely on callMcpTool's existing exponential backoff (5xx/429)
- Adding retries would create retry amplification (MCP retries x denormalizer retries)
- MCP response passed through raw to the tool result -- agent sees whatever the integration returned
- Errors propagate naturally; the agent reasons about failures the same way it does for any MCP tool error

#### Ask rendering
- ask() renders options into text BEFORE calling the denormalizer -- denormalizer never sees an options array
- Format: `- **Label**: reply "value"` per option, appended to the question text
- Options rendering is uniform across all channels (including Slack) -- no interactive buttons
- MessageContent on the denormalizer interface simplifies to just `{ text: string }` (options field removed from denormalizer types)
- ask() without options degrades to plain text delivery, identical to reply() at the denormalizer level
- style field (primary/danger) removed from options -- meaningless in text rendering

#### Notify target resolution
- notify() requires explicit target ReplyContext in schema -- no implicit resolution
- defaultNotifyTarget is a Phase 65 concern (injected into agent context from definition YAML, agent passes it explicitly)
- Denormalizer respects whatever is in the replyContext -- if Slack target has threadTs, replies in thread; if not, posts to channel
- The denormalizer has no way to distinguish notify from reply (no action field), and doesn't need to

#### Tool layer design
- Three tools: communication:reply, communication:ask, communication:notify
- All three call the same denormalize() function after preparing their text
- communicationAdapter follows the mcpAdapter pattern: ToolContext -> CommunicationToolDeps extraction
- CommunicationToolDeps: `{ agentId, correlationId, taskId?, logger }`

### Claude's Discretion
- Exact text formatting for option lists (line breaks, markdown weight) -- as long as it's clear to humans
- Whether to define a shared renderOptions() helper or inline in the ask tool
- Internal type names and file organization within the communication module

### Deferred Ideas (OUT OF SCOPE)
- defaultNotifyTarget injection mechanism -- Phase 65 (agent migration)
- Per-channel option rendering (e.g., Slack buttons) -- explicitly removed, revisit only if text instructions prove inadequate
- Agent echo prevention (Linear comment filtering) -- noted in spec, not Phase 63 scope
- commentId inline review comment replies -- noted in ReplyContext type, deferred in v2.6
</user_constraints>

## Summary

Phase 63 builds the outbound denormalizer and three communication tools (reply, ask, notify) plus their registration in tool-factories.ts. The denormalizer is a pure dispatch function: it receives `{ replyContext, text }` and calls the correct integration MCP tool based on `replyContext.channel`. The communication tools provide the agent-facing interface, handling option rendering (ask) and parameter naming (reply vs notify) before delegating to the same denormalize() function.

The implementation is straightforward. All prerequisite types (ReplyContext, MessageContent, CommunicationToolDeps) and MCP tools (linear:create_comment, github:create_pr_comment) were established in Phase 60. The codebase has well-established patterns for both MCP tool wrappers and custom tool factories that this phase follows directly. The main work is: (1) implement the denormalizer dispatch function, (2) implement three tool factories, (3) write the communicationAdapter bridge, (4) register tools in tool-factories.ts, (5) update the existing CommunicationToolDeps type, and (6) comprehensive unit tests.

**Primary recommendation:** Structure as 2 plans: Plan 1 for the denormalizer function + types, Plan 2 for the three communication tools + adapter + registration + tests. This separates the pure logic from the framework integration.

## CRITICAL: Requirements vs CONTEXT.md Reconciliation

Several REQUIREMENTS.md and ROADMAP.md items conflict with the locked CONTEXT.md decisions. The CONTEXT.md decisions override:

| Requirement | REQUIREMENTS.md Says | CONTEXT.md Decides | Resolution |
|-------------|---------------------|-------------------|------------|
| OUTB-04 | Slack uses `send_approval_request` for ask() with options | No `send_approval_request` -- purely conversational | **CONTEXT overrides.** All channels render options as text. OUTB-04 is effectively superseded. |
| OUTB-05 | Slack uses `reply_to_thread` for reply() and ask() without options | threadTs present -> reply_to_thread, absent -> send_message | **Aligned.** CONTEXT adds send_message fallback for channel-level posts. |
| OUTB-06/07 | Linear/GitHub render options as text | Options rendered into text BEFORE denormalizer | **Aligned.** CONTEXT shifts rendering to tool layer, denormalizer only sees text. |
| OUTB-08 | Denormalizer returns clear error with guidance | No denormalizer-level error wrapping, no guidance messages | **CONTEXT overrides.** MCP errors propagate as-is. Zod rejects malformed replyContext at tool layer. |
| Success #1 | ask with options invokes `send_approval_request` | No interactive buttons | **CONTEXT overrides.** |
| Success #4 | Slack renders interactive buttons | Options rendered as text on all channels | **CONTEXT overrides.** |

Additionally, the CONTEXT.md domain boundary states: "Phase 63 covers the denormalizer function and the three communication tools (reply, ask, notify) that call it. Tool registration in tool-factories.ts is also in scope." This means Phase 63 absorbs Phase 64's work (COMM-01 through COMM-05).

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| zod | (existing) | Input schema validation for all 3 tools | Already used for every tool in the codebase |
| callMcpTool | (existing) | HTTP dispatch to integration MCP servers | All MCP communication goes through this client |
| vitest | (existing) | Unit testing | Project standard test runner |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @aesir/platform PinoLogger | (existing) | Structured logging in denormalizer | Single info log per dispatch |

### Alternatives Considered
None. All infrastructure exists. No new dependencies needed.

**Installation:** No new packages required.

## Architecture Patterns

### Recommended Project Structure
```
packages/agents/src/shared/
├── communication/
│   ├── types.ts               # EXISTING: ReplyContext, MessageContent, CommunicationToolDeps (needs update)
│   ├── message-utils.ts       # EXISTING: appendReplyContextTag
│   ├── index.ts               # EXISTING: barrel exports (extend with new exports)
│   ├── denormalizer.ts        # NEW: denormalize() dispatch function
│   └── denormalizer.test.ts   # NEW: unit tests for denormalize()
├── tools/
│   └── communication/         # NEW: directory for communication tools
│       ├── reply.ts           # NEW: communication:reply tool factory
│       ├── ask.ts             # NEW: communication:ask tool factory
│       ├── notify.ts          # NEW: communication:notify tool factory
│       ├── adapter.ts         # NEW: communicationAdapter (ToolContext -> CommunicationToolDeps)
│       ├── index.ts           # NEW: barrel exports
│       └── communication-tools.test.ts  # NEW: tool-level unit tests
```

### Pattern 1: Denormalizer as Pure Dispatch Function
**What:** A single async function that switches on `replyContext.channel` and calls the appropriate MCP tool.
**When to use:** When translating a domain abstraction to a specific integration endpoint.
**Example:**
```typescript
// Source: Codebase pattern from packages/agents/src/shared/mcp/client.ts
export interface DenormalizeParams {
  replyContext: ReplyContext;
  text: string;
}

export async function denormalize(
  params: DenormalizeParams,
  deps: CommunicationToolDeps,
): Promise<unknown> {
  const { replyContext, text } = params;

  deps.logger.info(
    { channel: replyContext.channel, agentId: deps.agentId },
    "Denormalizing outbound message",
  );

  switch (replyContext.channel) {
    case "slack":
      return denormalizeSlack(text, replyContext, deps);
    case "linear":
      return denormalizeLinear(text, replyContext, deps);
    case "github":
      return denormalizeGitHub(text, replyContext, deps);
  }
  // No default needed: TypeScript exhaustive check via discriminated union
}
```

**Key detail:** No `default` case. TypeScript exhaustive checking on `ReplyContextSchema` discriminated union means the compiler catches missing channels. If a hypothetical new channel is added to the type but not the switch, it fails at compile time. An explicit `default: throw` is unnecessary and would mask the compile-time safety.

### Pattern 2: Communication Tool Factory (follows task tool pattern)
**What:** Each tool is a factory function that takes `CommunicationToolDeps` and returns a `ToolDefinition`.
**When to use:** For tools that need injected deps but don't follow the MCP batch-create pattern.
**Example:**
```typescript
// Source: Codebase pattern from packages/agents/src/shared/tools/task/complete-task.ts
export function createReplyTool(deps: CommunicationToolDeps): ToolDefinition {
  return {
    name: "communication_reply",  // Underscore format for Anthropic API compatibility
    description: "...",
    inputSchema: ReplyInputSchema,
    async execute(input: unknown): Promise<ToolResult> {
      const parsed = ReplyInputSchema.safeParse(input);
      if (!parsed.success) {
        return { content: `Invalid input: ${parsed.error.message}`, isError: true };
      }
      try {
        const result = await denormalize(
          { replyContext: parsed.data.replyContext, text: parsed.data.message },
          deps,
        );
        return { content: JSON.stringify(result, null, 2) };
      } catch (error) {
        // Follow McpError pattern from mcp-wrapper.ts
        if (error instanceof McpError) {
          return { content: `communication_reply error: ${error.message}`, isError: true };
        }
        const msg = error instanceof Error ? error.message : String(error);
        return { content: `communication_reply error: ${msg}`, isError: true };
      }
    },
  };
}
```

### Pattern 3: communicationAdapter Bridge (follows mcpAdapter pattern)
**What:** A function that bridges ToolContext to CommunicationToolDeps for tool-factories.ts registration.
**When to use:** Registering communication tools in the ToolRegistry.
**Example:**
```typescript
// Source: Codebase pattern from packages/agents/src/framework/tool-factories.ts (mcpAdapter)
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

// Registration:
registry.register("communication:reply", communicationAdapter(createReplyTool));
registry.register("communication:ask", communicationAdapter(createAskTool));
registry.register("communication:notify", communicationAdapter(createNotifyTool));
```

### Anti-Patterns to Avoid
- **Action discriminator in denormalizer:** The CONTEXT.md explicitly removes the action field. Don't add `action: "reply" | "ask" | "notify"` to the denormalize params. The tool layer (reply/ask/notify) provides intent; the denormalizer only sees text.
- **Retry logic in denormalizer:** callMcpTool already has exponential backoff. Adding retries creates amplification.
- **Error wrapping:** Don't wrap MCP errors in a DenormalizerError. Propagate as-is. The error handling pattern matches mcp-wrapper.ts exactly (McpError catch, generic Error catch, non-Error catch).
- **Options in denormalizer types:** The denormalizer only sees `{ replyContext, text }`. Options are rendered to text by the ask tool before calling denormalize. Don't pass options through.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| MCP HTTP calls | Custom fetch logic | `callMcpTool` from `shared/mcp/client.ts` | Already handles retries, error parsing, header injection |
| Input validation | Manual type checks | Zod schemas with `safeParse` | Consistent with every tool in the codebase |
| Error formatting | Custom error result builder | Follow `mcp-wrapper.ts` catch pattern | `McpError` catch + generic `Error` catch + string fallback |
| Tool name format | Colon format (`communication:reply`) | Underscore format (`communication_reply`) | Anthropic API requires `^[a-zA-Z0-9_-]{1,64}$` |

**Key insight:** The denormalizer is "boring by design" (per CONTEXT.md). All complexity lives in existing infrastructure (callMcpTool, Zod, ReplyContextSchema). The denormalizer is a thin switch statement connecting them.

## Common Pitfalls

### Pitfall 1: Tool Name Format Mismatch
**What goes wrong:** Registry key uses colon format (`communication:reply`) but tool `name` field must use underscore format (`communication_reply`) for Anthropic API compatibility.
**Why it happens:** The registry namespace:tool_name convention differs from the Anthropic tool name format.
**How to avoid:** Registry key = `communication:reply`, ToolDefinition.name = `communication_reply`. Existing test `tool-factories.test.ts` validates all names match `^[a-zA-Z0-9_-]{1,64}$`.
**Warning signs:** Anthropic API rejecting tool definitions at runtime.

### Pitfall 2: exactOptionalPropertyTypes Compliance
**What goes wrong:** Assigning `undefined` directly to an optional field causes TypeScript error.
**Why it happens:** `tsconfig.base.json` has `"exactOptionalPropertyTypes": true`.
**How to avoid:** Use conditional spread: `...(ctx.threadTs && { threadTs: ctx.threadTs })` instead of `threadTs: ctx.threadTs` when threadTs might be undefined. Apply this to Slack dispatch (threadTs), GitHub dispatch (commentId/inReplyTo), and CommunicationToolDeps (taskId).
**Warning signs:** TypeScript errors like "Type 'undefined' is not assignable to type 'string'".

### Pitfall 3: CommunicationToolDeps Type Mismatch
**What goes wrong:** Existing `CommunicationToolDeps` in `types.ts` has `conversationId?: string` but no `logger`. CONTEXT.md specifies `{ agentId, correlationId, taskId?, logger }`.
**Why it happens:** The type was created in Phase 60 with a placeholder shape before discuss-phase locked the design.
**How to avoid:** Update the existing type to match the locked decision: add `logger: PinoLogger`, remove `conversationId` (not needed -- denormalizer doesn't do DB lookups).
**Warning signs:** Build failures when importing logger from deps.

### Pitfall 4: McpError Import Path
**What goes wrong:** Importing McpError from the wrong path.
**Why it happens:** The agents package has both `shared/mcp/errors.ts` (client-side) and integration packages have their own.
**How to avoid:** Import `McpError` from `../../mcp/errors.js` (same as mcp-wrapper.ts does). Import `callMcpTool` from `../../mcp/client.js`.
**Warning signs:** Build failures or runtime type mismatches.

### Pitfall 5: Tool Count Updates in Tests
**What goes wrong:** Adding 3 new tools without updating the tool count assertion in `tool-factories.test.ts`.
**Why it happens:** The test explicitly asserts `expect(registry.listRegistered()).toHaveLength(36)`.
**How to avoid:** Update from 36 to 39. Also update the namespace assertion to include `"communication"`, the tool count comment in `tool-factories.ts`, and the logger assertion from `{ toolCount: 36 }` to `{ toolCount: 39 }`.
**Warning signs:** Failing test: "expected 39 to be 36".

### Pitfall 6: Exhaustive Switch Without Default
**What goes wrong:** Adding a `default: throw` case defeats TypeScript's exhaustive checking on discriminated unions.
**Why it happens:** Defensive programming instinct.
**How to avoid:** Use TypeScript's `never` type for exhaustive checking. After the switch block, TypeScript infers the remaining type as `never` if all cases are handled. If you must have a runtime guard, use: `const _exhaustive: never = replyContext; throw new Error(...)`.
**Warning signs:** TypeScript not flagging missing cases when a new channel variant is added.

### Pitfall 7: Slack send_message vs reply_to_thread Params
**What goes wrong:** Passing different param shapes to the two Slack tools.
**Why it happens:** `reply_to_thread` takes `{ channel, threadTs, text }` while `send_message` takes `{ channel, text, threadTs? }`.
**How to avoid:** When threadTs is present, call `reply_to_thread` with `{ channel, threadTs, text }`. When absent, call `send_message` with `{ channel, text }`. The param shapes are slightly different -- verify against `slack-tools.ts` schemas.
**Warning signs:** MCP validation errors at runtime.

## Code Examples

Verified patterns from the codebase:

### callMcpTool Usage (from mcp-wrapper.ts)
```typescript
// Source: packages/agents/src/shared/tools/integration/mcp-wrapper.ts
const result = await callMcpTool({
  integration: config.integration,
  tool: config.toolName,
  params: parsed.data as Record<string, unknown>,
  agentId: deps.agentId,
  correlationId: deps.correlationId,
  taskId: deps.taskId,
});
```

### Error Handling Pattern (from mcp-wrapper.ts)
```typescript
// Source: packages/agents/src/shared/tools/integration/mcp-wrapper.ts
try {
  const result = await callMcpTool({ ... });
  return { content: JSON.stringify(result, null, 2) };
} catch (error) {
  if (error instanceof McpError) {
    return { content: `${toolName} error: ${error.message}`, isError: true };
  }
  const msg = error instanceof Error ? error.message : String(error);
  return { content: `${toolName} error: ${msg}`, isError: true };
}
```

### Zod Input Validation Pattern (from complete-task.ts)
```typescript
// Source: packages/agents/src/shared/tools/task/complete-task.ts
const parsed = CompleteTaskInputSchema.safeParse(input);
if (!parsed.success) {
  return {
    content: `Invalid input: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
    isError: true,
  };
}
```

### Test Mock Pattern for callMcpTool (from integration-tools.test.ts)
```typescript
// Source: packages/agents/src/shared/tools/integration/integration-tools.test.ts
const mockCallMcpTool = vi.fn();
vi.mock("../../mcp/client.js", () => ({
  callMcpTool: (...args: unknown[]) => mockCallMcpTool(...args),
}));
```

### Conditional Spread for exactOptionalPropertyTypes (from Phase 61)
```typescript
// Source: Phase 61 pattern (adapters, router tools)
...(replyContext && { replyContext })
...(ctx.threadTs && { threadTs: ctx.threadTs })
```

### Existing ReplyContext Schemas (from communication/types.ts)
```typescript
// Source: packages/agents/src/shared/communication/types.ts
export const ReplyContextSchema = z.discriminatedUnion("channel", [
  SlackReplyContextSchema,
  LinearReplyContextSchema,
  GitHubReplyContextSchema,
]);
```

## Existing Types to Update

### CommunicationToolDeps (in communication/types.ts)

Current:
```typescript
export interface CommunicationToolDeps {
  agentId: string;
  correlationId: string;
  taskId?: string;
  conversationId?: string;
}
```

Required (per CONTEXT.md locked decision):
```typescript
export interface CommunicationToolDeps {
  agentId: string;
  correlationId: string;
  taskId?: string;
  logger: PinoLogger;
}
```

Changes: Add `logger: PinoLogger` (required for the denormalizer's info-level log). Remove `conversationId?: string` (denormalizer does no DB lookups). Import `PinoLogger` from `@aesir/platform`.

### MessageContent (in communication/types.ts)

The existing `MessageContentSchema` has an `options` field and `MessageOptionSchema` with a `style` field. Per the CONTEXT.md decision, the denormalizer only sees `{ text: string }`. The ask tool renders options into text before calling denormalize(). The existing types can remain for the ask tool's input schema (the options array is still useful for ask's input), but `style` is meaningless and can be removed from `MessageOptionSchema`.

However, since the denormalizer interface is just `{ replyContext, text }`, the denormalizer does NOT use MessageContent at all -- it uses its own `DenormalizeParams` interface. The existing MessageContent type is used only by the ask tool for its own input parsing.

## Testing Strategy

### Denormalizer Tests (denormalizer.test.ts)
1. **Slack dispatch with threadTs** -- calls `reply_to_thread` with correct params
2. **Slack dispatch without threadTs** -- calls `send_message` with correct params
3. **Linear dispatch** -- calls `create_comment` with `{ issueId, body }`
4. **GitHub dispatch** -- calls `create_pr_comment` with `{ owner, repo, prNumber, body }`
5. **GitHub dispatch with commentId** -- includes `inReplyTo` param (conditional spread)
6. **MCP error propagation** -- McpError from callMcpTool propagates unchanged
7. **Logging** -- info log contains `{ channel, tool, agentId }`
8. **Return value pass-through** -- callMcpTool result returned directly

### Communication Tool Tests (communication-tools.test.ts)
1. **reply tool** -- validates input, calls denormalize with correct params
2. **reply tool -- missing replyContext** -- Zod validation error
3. **ask tool with options** -- renders options as text before denormalize
4. **ask tool without options** -- passes question text directly (identical to reply)
5. **notify tool** -- validates input, calls denormalize with target as replyContext
6. **Error handling** -- McpError and generic Error caught, formatted as isError result

### Tool Registration Tests (update tool-factories.test.ts)
1. **Count** -- 39 tools (was 36)
2. **Namespace** -- "communication" in namespace set
3. **Tool presence** -- has("communication:reply"), has("communication:ask"), has("communication:notify")
4. **Resolution** -- resolves to ToolDefinition with underscore names
5. **Tool name format** -- Anthropic-compatible names (no colons)

## Scope Boundary Clarification

Per CONTEXT.md, Phase 63 absorbs Phase 64's scope. The full delivery is:

**In scope (Phase 63):**
- `denormalize()` function in `shared/communication/denormalizer.ts`
- `createReplyTool()` in `shared/tools/communication/reply.ts`
- `createAskTool()` in `shared/tools/communication/ask.ts`
- `createNotifyTool()` in `shared/tools/communication/notify.ts`
- `communicationAdapter()` in `shared/tools/communication/adapter.ts` (or inline in tool-factories.ts)
- Registration in `tool-factories.ts` (3 new tools, count 36->39)
- Update `CommunicationToolDeps` type (add logger, remove conversationId)
- Unit tests for denormalizer and all 3 tools
- Update tool-factories.test.ts (count, namespaces, tool list)

**Out of scope:**
- Agent definition.yaml changes (Phase 65)
- Agent prompt.md changes (Phase 65)
- defaultNotifyTarget injection (Phase 65)
- Agent echo prevention (not Phase 63)
- Per-channel option rendering / Slack buttons (explicitly removed)

## Open Questions

1. **Should communicationAdapter be defined in tool-factories.ts or a separate file?**
   - What we know: The mcpAdapter and codebaseAdapter are defined inline in tool-factories.ts. The communicationAdapter is structurally identical.
   - Recommendation: Define inline in tool-factories.ts for consistency. The adapter is 6 lines, not worth a separate file. If the tools directory has its own adapter.ts, it creates a circular concern (tool-factories imports from tools, tools define an adapter for tool-factories).

2. **Should renderOptions be a shared helper or inline in ask.ts?**
   - This is Claude's Discretion per CONTEXT.md.
   - Recommendation: Extract a `renderOptions()` helper function in ask.ts (not a separate file). It's ~3 lines, used once, but extracting it makes it independently testable. If format changes later, it's one function to update.

## Sources

### Primary (HIGH confidence)
- `packages/agents/src/shared/communication/types.ts` -- existing ReplyContext, MessageContent, CommunicationToolDeps
- `packages/agents/src/shared/communication/message-utils.ts` -- appendReplyContextTag helper
- `packages/agents/src/shared/tools/integration/mcp-wrapper.ts` -- McpToolDeps, createMcpToolWrapper pattern
- `packages/agents/src/shared/mcp/client.ts` -- callMcpTool interface and return type
- `packages/agents/src/shared/mcp/errors.ts` -- McpError class
- `packages/agents/src/shared/mcp/types.ts` -- McpIntegration, McpCallOptions
- `packages/agents/src/framework/tool-factories.ts` -- mcpAdapter, codebaseAdapter, registration patterns
- `packages/agents/src/framework/tool-factories.test.ts` -- registration test patterns (count, namespaces)
- `packages/agents/src/framework/types.ts` -- ToolContext, ToolFactory, ToolRegistry
- `packages/agents/src/shared/agent-loop/types.ts` -- ToolDefinition, ToolResult
- `packages/agents/src/shared/tools/integration/linear-tools.ts` -- Linear MCP tool schemas
- `packages/agents/src/shared/tools/integration/github-tools.ts` -- GitHub MCP tool schemas
- `packages/agents/src/shared/tools/integration/slack-tools.ts` -- Slack MCP tool schemas
- `packages/agents/src/shared/tools/integration/integration-tools.test.ts` -- MCP mock patterns
- `packages/agents/src/shared/tools/task/complete-task.ts` -- task tool factory pattern (non-MCP)

### Secondary (MEDIUM confidence)
- `.planning/specs/2.6-unified-agent-communication.md` -- spec (predates CONTEXT.md decisions, some items superseded)
- `.planning/REQUIREMENTS.md` -- requirements (some OUTB items superseded by CONTEXT.md)
- `.planning/ROADMAP.md` -- phase structure (Phase 64 absorbed into Phase 63 per CONTEXT.md)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new libraries, all patterns exist in codebase
- Architecture: HIGH -- follows existing adapter/tool/registry patterns exactly
- Pitfalls: HIGH -- identified from actual codebase constraints (exactOptionalPropertyTypes, tool name format, test counts)

**Research date:** 2026-02-09
**Valid until:** 2026-03-09 (stable -- internal codebase patterns, no external dependency risk)
