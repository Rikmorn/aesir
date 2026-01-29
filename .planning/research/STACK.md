# Technology Stack: Agentic Tool-Use Loop Architecture

**Project:** Aesir v2.2 -- Replace LangGraph with agentic tool-use loops
**Researched:** 2026-01-29
**Research mode:** Stack dimension for subsequent milestone
**Overall confidence:** HIGH

---

## Executive Summary

The Anthropic TypeScript SDK (`@anthropic-ai/sdk`) provides everything needed for building agentic tool-use loops. The SDK's beta `toolRunner()` helper is specifically designed for the exact pattern Aesir needs: define tools (with Zod or JSON Schema), create a runner, iterate until the LLM stops calling tools. The SDK also provides server-side context management (clearing old tool results) and client-side compaction (summarizing conversation history) -- both critical for long-running agentic loops that accumulate token debt.

The project's existing Zod 3.25.67 is the exact version range the Anthropic SDK expects as a peer dependency (`^3.25.0`). No Zod upgrade is needed. The previously separate `zod-to-json-schema` library is deprecated; the Anthropic SDK handles Zod-to-JSON-Schema conversion internally through its `betaZodTool()` helper.

The stack change is surgical: remove four `@langchain/*` packages, add one `@anthropic-ai/sdk` package. No other new dependencies are needed.

---

## Recommended Stack Additions

### Primary: @anthropic-ai/sdk

| Property | Value |
|----------|-------|
| Package | `@anthropic-ai/sdk` |
| Version | `^0.71.0` (latest: 0.71.2, published ~Dec 2025) |
| Purpose | Direct Anthropic API access with native tool-use, tool runner, context management |
| Confidence | **HIGH** -- verified via npm, GitHub, official docs |
| Peer deps | `zod: ^3.25.0 \|\| ^4.0.0` (optional, for `betaZodTool()`) |
| Node.js | Compatible with >=18 (project uses >=20, no issue) |

**Why this and not alternatives:** The spec already mandates this. But independently, it is the correct choice because:
1. Direct access to Anthropic's Messages API with full TypeScript types
2. Built-in `betaZodTool()` helper converts Zod schemas to tool definitions -- eliminates need for separate JSON Schema conversion
3. Built-in `toolRunner()` handles the agentic loop pattern (iterate tool calls until done)
4. Built-in context management (compaction + server-side clearing)
5. Token counting via `messages.countTokens()` (stable API, not beta)
6. AbortController support for clean cancellation
7. Automatic retries with exponential backoff (configurable)
8. Removes the LangChain abstraction layer that adds no value for tool-use

**Installation:**
```bash
pnpm --filter @aesir/agents add @anthropic-ai/sdk@^0.71.0
```

### No Other New Dependencies Needed

The following are NOT needed (and why):

| Library | Why NOT needed |
|---------|----------------|
| `zod-to-json-schema` | **Deprecated** (Nov 2025). The Anthropic SDK's `betaZodTool()` handles Zod-to-JSON-Schema internally. No separate conversion library needed. |
| `zod` (upgrade) | Project already at 3.25.67, which is in the SDK's peer dep range (`^3.25.0`). No upgrade required. |
| `@ai-sdk/anthropic` (Vercel AI SDK) | Adds unnecessary abstraction. The spec calls for direct Anthropic SDK usage. Vercel AI SDK is optimized for Next.js/React streaming UIs, not backend agentic loops. |
| `mastra` | Full framework overkill. Aesir already has Temporal for workflows, its own MCP layer, and database persistence. Mastra would duplicate existing infrastructure. |
| `@anthropic-ai/claude-agent-sdk` | Higher-level agent SDK built for Claude Code-like agents. Too opinionated for Aesir's custom orchestrator/sub-agent architecture. Depends on file system access patterns that don't match Aesir's container-based execution model. |
| `tiktoken` | Anthropic provides `messages.countTokens()` as a stable API. No need for approximate local counting. |

---

## Dependencies Removed

These four LangChain packages are removed from `@aesir/agents`:

| Package | Current Version | Why Remove |
|---------|-----------------|------------|
| `@langchain/anthropic` | ^0.3.0 | Replaced by `@anthropic-ai/sdk` for direct API access |
| `@langchain/core` | ^0.3.0 | Transitive dependency of LangGraph, no longer needed |
| `@langchain/langgraph` | ^0.2.0 | State machine replaced by agentic tool-use loops |
| `@langchain/langgraph-checkpoint-postgres` | ^0.1.0 | Checkpoint persistence replaced by context snapshots in PostgreSQL |

**Removal command:**
```bash
pnpm --filter @aesir/agents remove @langchain/anthropic @langchain/core @langchain/langgraph @langchain/langgraph-checkpoint-postgres
```

**Note:** This also eliminates the `--legacy-peer-deps` requirement documented in CLAUDE.md, which existed specifically because of LangChain peer dependency conflicts.

---

## Anthropic SDK: Key Capabilities for Agentic Loops

### 1. Tool Definition with Zod (betaZodTool)

**Confidence: HIGH** -- verified via official docs and GitHub helpers.md

```typescript
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';

const readFileTool = betaZodTool({
  name: 'read_file',
  description: 'Read file contents from the codebase',
  inputSchema: z.object({
    path: z.string().describe('Relative file path from repo root'),
  }),
  run: async (input) => {
    // input is typed as { path: string }
    const content = await devContainer.readFile(input.path);
    return content; // String returned as text content block
  },
});
```

**Key details:**
- Requires Zod `^3.25.0` (project has 3.25.67 -- compatible)
- Import from `@anthropic-ai/sdk/helpers/beta/zod` (beta namespace, but stable API)
- `run` function receives typed input, returns string or content block array
- Errors thrown as `ToolError` are passed back to the LLM with `is_error: true`
- Alternative: `betaTool()` from `@anthropic-ai/sdk/helpers/beta/json-schema` for raw JSON Schema

### 2. Tool Runner (Agentic Loop)

**Confidence: HIGH** -- verified via official implementation docs

The `toolRunner()` is the SDK's built-in agentic loop. It handles the iterate-until-done pattern automatically:

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

// Non-streaming: iterate messages
const runner = client.beta.messages.toolRunner({
  model: 'claude-sonnet-4-5-20250929',
  max_tokens: 8192,
  system: systemPrompt,
  messages: [{ role: 'user', content: taskDescription }],
  tools: [readFileTool, writeFileTool, searchTool],
});

// Each iteration yields the LLM response (runner auto-executes tools)
for await (const message of runner) {
  // message is the assistant's response for this iteration
  // Tool calls are executed automatically, results fed back
  onResponse(message); // tracing callback
}

// Or just get the final result:
const finalMessage = await runner;
```

**Runner API surface (relevant to Aesir):**

| Method | Purpose | Aesir Use |
|--------|---------|-----------|
| `for await (const msg of runner)` | Iterate each LLM turn | Tracing every step |
| `await runner` | Get final message | Simple cases |
| `runner.abort()` | Cancel the loop | AbortSignal integration |
| `runner.setMessagesParams(fn)` | Modify next request params | Dynamic max_tokens adjustment |
| `runner.pushMessages(msg)` | Inject messages | Adding context mid-loop |
| `runner.generateToolResponse()` | Inspect tool results before auto-append | Error interception, logging |

**Streaming variant:**
```typescript
const runner = client.beta.messages.toolRunner({
  // ... same options ...
  stream: true,
});

for await (const messageStream of runner) {
  for await (const event of messageStream) {
    // SSE events: content_block_start, content_block_delta, etc.
  }
  const message = await messageStream.finalMessage();
}
```

### 3. Tool-Use Message Types

**Confidence: HIGH** -- verified via official docs

The Messages API uses these content block types for tool-use:

**Response (assistant message):**
```typescript
// stop_reason: "tool_use" when tool calls present
// stop_reason: "end_turn" when agent is done
interface ToolUseBlock {
  type: "tool_use";
  id: string;        // e.g., "toolu_01A09q90qw90lq917835lq9"
  name: string;      // Tool name
  input: object;     // Parsed input matching input_schema
}
```

**Feeding results back (user message):**
```typescript
interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;  // Must match the tool_use.id
  content: string | ContentBlock[];
  is_error?: boolean;   // If true, LLM treats as error to reason about
}
```

**Critical formatting rules:**
- Tool result blocks MUST come FIRST in the content array (before any text)
- All parallel tool results MUST be in a single user message
- Tool result messages must immediately follow their corresponding tool_use

**The `toolRunner()` handles all of this automatically.** Manual handling only needed if building a custom loop.

### 4. Token Counting

**Confidence: HIGH** -- verified via official API reference

**Post-request counting (always available):**
```typescript
const message = await client.messages.create({...});
console.log(message.usage);
// { input_tokens: 1523, output_tokens: 847 }
```

The `usage` field is present on every response, including tool-use responses. The `toolRunner()` returns messages with `usage` on each iteration, enabling cumulative tracking for budget enforcement.

**Pre-request counting (stable API):**
```typescript
const tokenCount = await client.messages.countTokens({
  model: 'claude-sonnet-4-5-20250929',
  system: systemPrompt,
  messages: conversationHistory,
  tools: toolDefinitions,
});
console.log(tokenCount.input_tokens); // Exact count including tools
```

**Use for Aesir:**
- Post-request `usage` on every `toolRunner()` iteration for budget tracking
- Pre-request `countTokens()` before spawning sub-agents to validate context fits
- Tool definitions add 20-50 tokens each (simple) or 100-200 tokens (complex nested objects)

### 5. AbortController / Cancellation

**Confidence: HIGH** -- verified via SDK docs and GitHub

```typescript
const abortController = new AbortController();

// Pass signal to SDK (via runner or direct call)
const runner = client.beta.messages.toolRunner({
  model: 'claude-sonnet-4-5-20250929',
  // ... other options
  tools: [myTool],
  messages: [{role: 'user', content: 'task'}],
});

// Cancel from outside (e.g., Temporal cancellation)
setTimeout(() => runner.abort(), 30_000); // 30s timeout

// Or from inside the loop
for await (const message of runner) {
  if (shouldStop(message)) {
    runner.abort();
    break;
  }
}
```

**Integration with Temporal:** Temporal activities receive a `CancellationScope`. Map this to `runner.abort()` for clean cancellation when Temporal cancels a workflow.

**Known limitation:** Stream idle timeout is NOT built-in (GitHub Issue #867). Streams can hang indefinitely if the connection drops silently. Mitigation: implement a custom idle timeout wrapper or use Temporal's `startToCloseTimeout` as a backstop (already 30min for dev agent).

### 6. Context Management (Server-Side + Client-Side)

**Confidence: HIGH** -- verified via official context editing docs

Two complementary approaches for managing context growth in long-running loops:

**Server-side: Tool result clearing (beta)**
```typescript
const response = await client.beta.messages.create({
  model: 'claude-sonnet-4-5-20250929',
  betas: ['context-management-2025-06-27'],
  context_management: {
    edits: [{
      type: 'clear_tool_uses_20250919',
      trigger: { type: 'input_tokens', value: 50000 },
      keep: { type: 'tool_uses', value: 5 },
      clear_at_least: { type: 'input_tokens', value: 5000 },
    }]
  },
  // ... messages, tools
});
```

Automatically clears oldest tool results when token threshold is exceeded. Happens server-side -- client maintains full history, API applies edits before sending to Claude.

**Configuration options:**

| Option | Default | Description |
|--------|---------|-------------|
| `trigger` | 100K input tokens | When clearing activates |
| `keep` | 3 tool uses | How many recent tool-use pairs to preserve |
| `clear_at_least` | None | Minimum tokens to clear (worth cache invalidation cost) |
| `exclude_tools` | None | Tool names that should never be cleared |
| `clear_tool_inputs` | false | Also clear tool call parameters (not just results) |

**Client-side: SDK compaction (via toolRunner)**
```typescript
const runner = client.beta.messages.toolRunner({
  model: 'claude-sonnet-4-5-20250929',
  tools: [...],
  messages: [...],
  compactionControl: {
    enabled: true,
    contextTokenThreshold: 100000,
    model: 'claude-haiku-4-5',  // Use cheaper model for summaries
  },
});
```

When token usage exceeds threshold, the SDK asks Claude to summarize the conversation, then replaces the full history with the summary. The loop continues from the summary.

**Recommendation for Aesir:** Use BOTH approaches:
- Server-side `clear_tool_uses` as a safety net (clears at 80% of context window)
- Client-side compaction via custom implementation (not the built-in `toolRunner` compaction) because Aesir needs to persist summaries to PostgreSQL at Temporal boundaries, not just in-memory

**Important:** The spec's `context_snapshots` table design is complementary to (not replaced by) these SDK features. The SDK features manage within-loop context. The database snapshots manage across-boundary context (between Temporal activities).

### 7. Error Handling Patterns

**Confidence: HIGH** -- verified via SDK docs

**Automatic retries:**
```typescript
const client = new Anthropic({
  maxRetries: 3,  // Default: 2
  timeout: 60_000, // Default: 10 minutes
});
```

Retries automatically on: connection errors, 408, 409, 429, 5xx. Uses exponential backoff with jitter.

**Rate limit headers:**
```
anthropic-ratelimit-requests-remaining
anthropic-ratelimit-tokens-remaining
anthropic-ratelimit-requests-reset
```

Available on every response. Use to implement proactive backoff before hitting limits.

**Tool execution errors (via toolRunner):**
```typescript
import { ToolError } from '@anthropic-ai/sdk/lib/tools/BetaRunnableTool';

const myTool = betaZodTool({
  // ...
  run: async (input) => {
    try {
      return await executeOperation(input);
    } catch (error) {
      // ToolError is caught by runner and sent to LLM as is_error: true
      throw new ToolError(`Operation failed: ${error.message}`);
    }
  },
});
```

The `toolRunner` catches `ToolError` and sends it back to Claude, which can then reason about the error and try a different approach. This is the exact behavior the spec requires for replacing the "3 blind retries" pattern.

**max_tokens truncation:**
If response is truncated (`stop_reason: "max_tokens"`) during a tool_use block, the tool call is incomplete. Handle by retrying with higher `max_tokens`. The `toolRunner` does NOT handle this automatically -- it needs to be handled in the custom loop wrapper or by setting `max_tokens` sufficiently high.

---

## Zod-to-JSON-Schema: No Separate Library Needed

**Confidence: HIGH** -- verified via official Anthropic docs and Zod docs

### The Anthropic SDK Handles It

The `betaZodTool()` helper accepts a Zod schema as `inputSchema` and converts it to JSON Schema internally. No external library needed:

```typescript
// This is ALL that's needed -- no zod-to-json-schema import
const tool = betaZodTool({
  name: 'my_tool',
  inputSchema: z.object({
    query: z.string().describe('Search query'),
    maxResults: z.number().optional().describe('Max results to return'),
  }),
  // ...
});
```

### zod-to-json-schema is Deprecated

The standalone `zod-to-json-schema` package announced end-of-maintenance in November 2025. Zod v4 ships with native `z.toJSONSchema()`, making the external library unnecessary.

### If Manual Conversion is Needed Later

For any case where you need raw JSON Schema (e.g., for the `betaTool()` helper which takes JSON Schema directly, or for non-Anthropic tooling):

**Option A (current Zod 3.25.x):** Use `betaTool()` with hand-written JSON Schema
**Option B (future Zod 4):** Use `z.toJSONSchema()` native method
**Option C (avoid):** `zod-to-json-schema` -- deprecated, no longer maintained

**Recommendation:** Use `betaZodTool()` for all tool definitions. It provides type safety, runtime validation, and JSON Schema conversion in one step.

---

## Existing Stack Compatibility

### Zod 3.25.67 (No Change Needed)

**Confidence: HIGH**

The project uses Zod 3.25.67 in both `@aesir/agents` and `@aesir/types`. The Anthropic SDK declares an optional peer dependency of `zod: ^3.25.0 || ^4.0.0`. Version 3.25.67 satisfies `^3.25.0`.

**Do NOT upgrade to Zod 4** at this time. Reasons:
1. Zod 4 is available but the ecosystem is still stabilizing (type instantiation depth issues reported with 3.25.68+ in some SDKs)
2. The Anthropic SDK works with 3.25.x
3. Zod 4 migration would be a separate effort (API changes, import path changes)
4. Zod 4's native `z.toJSONSchema()` is not needed because `betaZodTool()` handles conversion internally

### Temporal (No Change)

The Anthropic SDK has no interaction with Temporal. The integration point is simple:
- Temporal activities call `runAgentLoop()` (or use `toolRunner()`)
- Temporal provides the durability envelope (timeouts, retries, signals)
- The agent loop runs inside the activity, completely independent of Temporal

**Pattern:**
```typescript
// Temporal activity
async function runOrchestratorPreApproval(input: TaskInput): Promise<PlanResult> {
  const runner = anthropic.beta.messages.toolRunner({
    model: config.model,
    tools: orchestratorTools,
    messages: [{ role: 'user', content: buildTaskPrompt(input) }],
  });

  for await (const message of runner) {
    // trace each step
  }

  const final = await runner;
  return extractPlan(final);
}
```

### MCP Layer (No Change)

Existing `callMcpTool()` continues to work. Tool definitions wrap MCP calls:

```typescript
const getIssueTool = betaZodTool({
  name: 'get_issue',
  description: 'Get Linear issue details by ID',
  inputSchema: z.object({
    issueId: z.string().describe('Linear issue identifier, e.g. AES-42'),
  }),
  run: async (input) => {
    const result = await callMcpTool({
      integration: 'linear',
      tool: 'get_issue',
      params: { issueId: input.issueId },
      agentId: 'dev-agent',
      correlationId: currentCorrelationId,
    });
    return JSON.stringify(result);
  },
});
```

### pino Logging (No Change)

The Anthropic SDK logs internally (configurable via `ANTHROPIC_LOG=info|debug`). For Aesir's structured logging, use the `toolRunner` iteration loop to log with pino:

```typescript
for await (const message of runner) {
  logger.info({
    agentType,
    taskId,
    iteration: stepNumber++,
    toolCalls: message.content.filter(b => b.type === 'tool_use').length,
    stopReason: message.stop_reason,
    tokens: message.usage,
  }, 'agent loop iteration');
}
```

### Express HTTP Servers (No Change)

Entry points remain Express servers on ports 3004/3005. The Anthropic SDK is used inside Temporal activities, not in the HTTP layer.

---

## Architecture Decision: toolRunner vs. Custom Loop

**Recommendation: Start with toolRunner, extend where needed.**

The SDK's `toolRunner()` handles 90% of the agentic loop requirements:
- Automatic tool execution and result feeding
- Iteration until `end_turn`
- Streaming support
- Error forwarding to LLM
- Compaction support

**Where custom logic is needed (extend, don't replace):**
1. **Iteration limits** -- `toolRunner` loops until `end_turn`. Need to count iterations and break.
2. **Token budget** -- Accumulate `message.usage` each iteration, break when budget exceeded.
3. **Tracing callbacks** -- Use the `for await` loop to trace every step.
4. **Context snapshots** -- Write to PostgreSQL at Temporal boundaries (not handled by SDK).
5. **Sub-agent spawning** -- The `spawn_agent` tool runs a nested `toolRunner` inside a tool's `run` function.

**Approach:** Wrap `toolRunner` in a thin `runAgentLoop()` function that adds iteration counting, token budgets, tracing, and AbortSignal support on top of the SDK's built-in loop. Do NOT reimplement the tool execution and result feeding logic.

---

## Alternative Approaches Considered

### Vercel AI SDK (@ai-sdk/anthropic)

| Criterion | @anthropic-ai/sdk | @ai-sdk/anthropic |
|-----------|-------------------|-------------------|
| Abstraction level | Direct API access | Provider abstraction |
| Tool-use support | Native, full types | Via unified API |
| Context management | Server-side clearing + SDK compaction | Not built-in |
| Token counting | `messages.countTokens()` | Approximate |
| Streaming | SSE with event helpers | Unified streaming |
| Framework dependency | None | ai-sdk core |
| Use case | Backend agents | Full-stack AI apps |
| Weekly downloads | ~3M | ~2.8M |

**Verdict:** Vercel AI SDK is excellent for building AI-powered UIs (chat interfaces, streaming to React). For backend agentic loops running inside Temporal activities, the direct Anthropic SDK is simpler, more capable (context management, exact token counting), and avoids an unnecessary abstraction layer.

### Mastra

**What it is:** TypeScript-native AI agent framework (from the Gatsby team, YC-backed). Includes agents, workflows, memory, RAG, MCP support.

**Why not for Aesir:**
- Aesir already has Temporal for workflow orchestration (Mastra's workflow engine would conflict)
- Aesir already has MCP integration layer
- Aesir already has PostgreSQL persistence
- Mastra would be a framework-within-a-framework situation
- v1 releasing Jan 2026, still stabilizing

**When it would make sense:** Greenfield project without existing workflow infrastructure.

### Claude Agent SDK (@anthropic-ai/claude-agent-sdk)

**What it is:** Higher-level SDK for building agents with Claude Code's capabilities. Provides `query()` function for agentic loops with built-in tool execution.

**Why not for Aesir:**
- Designed for Claude Code-like agents with file system access
- Too opinionated about tool types and execution model
- Aesir needs custom tool definitions (MCP wrappers, container execution)
- Would fight against Aesir's existing architecture rather than complement it
- Relatively new (known issues with AbortController and session management)

### Building Custom Loop (No SDK Helper)

**What it means:** Use `messages.create()` directly, manually check `stop_reason === "tool_use"`, execute tools, format `tool_result` blocks, send next request.

**Why not recommended as primary approach:**
- The `toolRunner()` does this correctly and handles edge cases (parallel tool calls, error forwarding, streaming)
- Manual formatting is error-prone (tool_result ordering, parallel result grouping)
- BUT: understanding the manual approach is important for debugging and for cases where `toolRunner()` is insufficient

**Fallback:** If `toolRunner()` proves too constraining, the manual approach is straightforward. The spec's `runAgentLoop()` interface can wrap either approach without changing downstream code.

---

## Gotchas and Pitfalls for Long-Running Tool-Use Loops

### 1. Stream Idle Hang (CRITICAL)

**Issue:** Streams can hang indefinitely if the network connection drops silently. No idle timeout is built into the SDK (GitHub Issue #867).

**Impact:** A Temporal activity could hang for its full 30-minute timeout without making progress.

**Mitigation:**
- Rely on Temporal's `startToCloseTimeout` (30min) as the ultimate backstop
- Consider implementing a custom idle timeout wrapper around the stream
- Use non-streaming mode for the tool loop (streaming is useful for real-time UI, not for backend agents running in Temporal activities)
- Monitor via pino logging -- if no log entries for N minutes, something is wrong

### 2. Token Accumulation in Tool Loops

**Issue:** Each iteration sends the FULL conversation history (system prompt + all messages + all tool definitions + all tool results). Token usage grows quadratically, not linearly.

**Impact:** A 50-iteration loop with rich tool results can easily hit 200K+ tokens.

**Mitigation:**
- Enable server-side `clear_tool_uses_20250919` to auto-clear old tool results
- Set token budgets per agent type (researcher: 100K, coder: 200K, orchestrator: 150K)
- Use `countTokens()` before each iteration to check remaining budget
- Sub-agent spawning inherently limits context growth (fresh context per sub-agent)
- The spec's architecture (orchestrator spawns focused sub-agents) is specifically designed to avoid this

### 3. Tool Definition Token Cost

**Issue:** Each tool definition adds tokens to every request. With 20+ tools, this is 1000-4000 tokens of overhead per iteration.

**Impact:** 50 iterations x 2000 tokens overhead = 100K tokens just for tool definitions.

**Mitigation:**
- Give each agent type only the tools it needs (spec already does this)
- Researcher: 4 tools (~200 tokens)
- Coder: 5 tools (~300 tokens)
- Orchestrator: 8-10 tools (~600 tokens)
- Product agent: 4 tools (~200 tokens)
- Router: 4 tools (~200 tokens)

### 4. Rate Limits Apply Per-Model Family

**Issue:** Anthropic's rate limits are per-model family (Sonnet 4.x combined, Opus 4.x combined). Multiple agents running concurrently share the same rate limit pool.

**Impact:** If dev agent and product agent both use claude-sonnet-4, they share RPM/TPM limits.

**Mitigation:**
- The SDK auto-retries on 429 with exponential backoff (default 2 retries)
- Increase `maxRetries` for production (3-5)
- Read rate limit headers and implement proactive backoff
- Consider using Haiku for the smart router (separate rate limit pool, faster, cheaper)

### 5. betaZodTool is "Beta" in Name Only

**Issue:** The `betaZodTool` and `toolRunner` are under the `beta` namespace. This might suggest instability.

**Reality:** The "beta" namespace in the Anthropic SDK is used for features that may have API changes, not for features that are unstable. The tool runner is recommended by official docs for "most tool use implementations." It is production-ready.

**Mitigation:** Pin the SDK version (`^0.71.0` not `latest`). Test on upgrade. The beta API surface is stable within a major version range.

### 6. Parallel Tool Calls

**Issue:** Claude may call multiple tools in a single response. All results must be returned in a single user message.

**Impact:** If tools have side effects (write_file, create_branch), parallel execution order matters.

**Mitigation:**
- `toolRunner()` handles parallel result formatting automatically
- For side-effect tools, consider sequential execution even when parallel calls are requested
- The spec's tool design naturally separates read-only (researcher) from write (coder) agents

### 7. max_tokens Truncation During Tool Use

**Issue:** If `max_tokens` is too low and the response is truncated mid-tool-call, the tool call is incomplete and cannot be executed.

**Impact:** Lost iteration, wasted tokens.

**Mitigation:**
- Set `max_tokens` generously (8192-16384 for agents that need to produce plans/code)
- Monitor for `stop_reason: "max_tokens"` in tracing
- The `toolRunner` does NOT auto-retry on truncation -- handle in the wrapper

### 8. Failed Requests Still Count Against Rate Limits

**Issue:** A request rejected with 429 still consumes a request slot. Rapid retries can make the problem worse.

**Impact:** Aggressive retry loops can drain rate limit quota.

**Mitigation:**
- SDK's built-in exponential backoff handles this correctly
- Do not implement custom rapid retry on top of the SDK's retry logic
- Read `anthropic-ratelimit-requests-reset` header for precise backoff timing

---

## Version Compatibility Matrix

| Package | Current | v2.2 Target | Notes |
|---------|---------|-------------|-------|
| `@anthropic-ai/sdk` | (new) | ^0.71.0 | Add |
| `@langchain/anthropic` | ^0.3.0 | REMOVE | Replaced by above |
| `@langchain/core` | ^0.3.0 | REMOVE | No longer needed |
| `@langchain/langgraph` | ^0.2.0 | REMOVE | Replaced by agentic loops |
| `@langchain/langgraph-checkpoint-postgres` | ^0.1.0 | REMOVE | Replaced by context snapshots |
| `zod` | 3.25.67 | 3.25.67 (no change) | Compatible with SDK peer dep |
| `@temporalio/*` | ^1.14.1 | ^1.14.1 (no change) | Unaffected |
| `drizzle-orm` | ^0.45.1 | ^0.45.1 (no change) | New tables, same ORM |
| `express` | ^4.21.0 | ^4.21.0 (no change) | Unaffected |
| `pino` | (via platform) | (no change) | Unaffected |
| `typescript` | ^5.7.0 | ^5.7.0 (no change) | SDK fully typed |

---

## Integration Points Summary

| Aesir Component | How It Integrates with @anthropic-ai/sdk |
|-----------------|------------------------------------------|
| Temporal activities | Activities call `toolRunner()` or custom loop wrapper |
| MCP client (`callMcpTool`) | Tool `run` functions call MCP internally |
| DevContainerManager | Codebase tool `run` functions call container methods |
| PostgreSQL (Drizzle) | Context snapshots written at Temporal boundaries |
| pino logging | Log each `toolRunner` iteration with structured data |
| AbortSignal | Map Temporal cancellation to `runner.abort()` |
| Zod schemas | `betaZodTool()` accepts Zod schemas directly |

---

## Roadmap Implications for Stack

1. **Phase 1 (Agentic Loop Runtime):** Install `@anthropic-ai/sdk`, build `runAgentLoop()` wrapper around `toolRunner()`, verify Zod compatibility, implement tracing hooks. This is the foundation.

2. **Phase 2 (Tool Library):** Use `betaZodTool()` for all tool definitions. Each tool wraps existing infrastructure (MCP, DevContainer). No new dependencies needed.

3. **Phase 3-4 (Agent replacement):** Wire `runAgentLoop()` into Temporal activities. Remove LangGraph imports progressively. Context management becomes critical here -- enable `clear_tool_uses` for long-running agents.

4. **Phase 5+ (Hardening):** Add `countTokens()` pre-checks, rate limit monitoring, idle timeout wrapper, compaction for edge cases.

5. **Dependency cleanup:** Remove `@langchain/*` packages only after all agents are migrated (Phases 3-4 complete). Do not remove early to avoid blocking parallel work.

---

## Sources

### Official / HIGH Confidence
- [@anthropic-ai/sdk on npm](https://www.npmjs.com/package/@anthropic-ai/sdk) -- version 0.71.2
- [Anthropic SDK TypeScript GitHub](https://github.com/anthropics/anthropic-sdk-typescript) -- README, helpers.md
- [Tool Use Implementation Guide](https://platform.claude.com/docs/en/agents-and-tools/tool-use/implement-tool-use) -- toolRunner, betaZodTool, streaming, error handling
- [Context Editing Docs](https://platform.claude.com/docs/en/build-with-claude/context-editing) -- server-side clearing, SDK compaction
- [Token Counting API Reference](https://platform.claude.com/docs/en/api/typescript/messages/count_tokens) -- stable countTokens()
- [Rate Limits](https://docs.anthropic.com/en/api/rate-limits) -- tier structure, per-model limits
- [Zod JSON Schema](https://zod.dev/json-schema) -- v4 native support, zod-to-json-schema deprecation
- [Zod v4 Release Notes](https://zod.dev/v4) -- performance improvements, z.toJSONSchema()
- [zod-to-json-schema on npm](https://www.npmjs.com/package/zod-to-json-schema) -- deprecated notice

### Community / MEDIUM Confidence
- [Anthropic SDK Issue #867](https://github.com/anthropics/anthropic-sdk-typescript/issues/867) -- stream idle timeout proposal
- [Building an AI Agent with TypeScript](https://cianfrani.dev/posts/building-an-ai-agent-with-typescript/) -- manual loop patterns
- [Vercel AI SDK](https://ai-sdk.dev/docs/introduction) -- alternative framework analysis
- [Mastra Docs](https://mastra.ai/docs) -- alternative framework analysis
- [Claude Agent SDK GitHub](https://github.com/anthropics/claude-agent-sdk-typescript) -- higher-level SDK analysis
- [Anthropic Pricing Guide 2026](https://www.nops.io/blog/anthropic-api-pricing/) -- token cost context
