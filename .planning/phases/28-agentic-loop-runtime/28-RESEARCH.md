# Phase 28: Agentic Loop Runtime - Research

**Researched:** 2026-01-29
**Domain:** Anthropic SDK native tool-use loop with Zod schemas, tracing callbacks, and guardrails
**Confidence:** HIGH

## Summary

Researched the `@anthropic-ai/sdk` TypeScript SDK (v0.71.2) for building a custom `runAgentLoop()` function that replaces the existing LangGraph-based agent execution. The SDK provides native tool-use via `messages.create()` with a `tools` parameter, `betaZodTool()` for Zod-schema-based tool definitions, and a built-in `toolRunner()` for automatic loop execution. Per project decisions, we build a custom loop rather than using `toolRunner()` to maintain control over tracing callbacks, token budgets, and iteration limits.

Key findings: The SDK's tool-use API is straightforward -- send messages with tools, receive `tool_use` content blocks, execute tools, send results back as `tool_result` blocks, repeat. The `betaZodTool()` helper handles Zod-to-JSON-Schema conversion internally (using `zod-to-json-schema` for Zod 3.x). The project's pinned `zod@3.25.67` satisfies the SDK's peer dependency (`^3.25.0 || ^4.0.0`). AbortSignal support is available via the second argument to `messages.create()`. Token counts are available on every response via `response.usage.input_tokens` and `response.usage.output_tokens`. Six `stop_reason` values must be handled: `end_turn`, `tool_use`, `max_tokens`, `stop_sequence`, `refusal`, and `model_context_window_exceeded` (plus `pause_turn` for server tools, which we do not use).

**Primary recommendation:** Build `runAgentLoop()` as a pure function that takes options (system prompt, tools, initial message, limits, callbacks, AbortSignal) and returns a structured result. Use `betaZodTool()` for tool definitions but execute tool `run()` functions manually within the loop (do not use `toolRunner()`). Separate the tool definition interface into two parts: the Zod schema + description (sent to the LLM) and the execute function (called by our loop), since `betaZodTool`'s `run` function is designed for `toolRunner()` integration.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@anthropic-ai/sdk` | ^0.71.2 | Direct Anthropic API access with native tool-use | Official SDK, type-safe, purpose-built for tool-use loops |
| `zod` | 3.25.67 | Schema validation for tool inputs | Already pinned in project, satisfies SDK peer dep `^3.25.0` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@anthropic-ai/sdk/helpers/beta/zod` | (from SDK) | `betaZodTool()` for Zod-to-JSON-Schema conversion | Tool definition with Zod schemas |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom `runAgentLoop()` | SDK's `toolRunner()` | `toolRunner()` handles loop automatically but lacks hooks for per-iteration tracing, token budgets, and custom stop conditions. Project decision: custom loop. |
| `betaZodTool()` | Manual `zodToJsonSchema` | `betaZodTool()` bundles conversion + type inference. However, its `run` property couples execution to `toolRunner()`. Our loop needs separate definition and execution. |
| `zod-to-json-schema` manual | `betaZodTool()` internal conversion | Using `betaZodTool()` is simpler but we only need the JSON Schema output, not the `run` binding. See Architecture Patterns for recommended approach. |

### Installation
```bash
pnpm --filter @aesir/agents add @anthropic-ai/sdk
```

**Note:** `zod@3.25.67` is already installed. No version change needed.

## Architecture Patterns

### Recommended Project Structure
```
packages/agents/src/
  shared/
    agent-loop/
      run-agent-loop.ts        # Core runAgentLoop() function
      types.ts                 # AgentLoopOptions, AgentLoopResult, ToolDefinition, etc.
      token-budget.ts          # Mutable token budget counter
      errors.ts                # AgentLoopError, MaxIterationsError, etc.
      index.ts                 # Barrel export
    agent-loop.test.ts         # Tests for the loop runtime
```

### Pattern 1: Custom Agent Loop (Manual Tool Execution)
**What:** Build our own loop using `messages.create()` + manual tool dispatch instead of `toolRunner()`
**When to use:** Always -- this is the core runtime for all v2.2 agents
**Why not toolRunner():** We need per-iteration tracing callbacks (`onToolCall`, `onResponse`), mutable token budget tracking shared across orchestrator + sub-agents, configurable iteration limits, and AbortSignal-based cancellation with graceful status reporting.

```typescript
// Core loop pseudocode -- NOT using toolRunner()
import Anthropic from "@anthropic-ai/sdk";

async function runAgentLoop(options: AgentLoopOptions): Promise<AgentLoopResult> {
  const client = new Anthropic();
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: options.initialMessage },
  ];

  let iterationCount = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const trace: TraceStep[] = [];

  while (iterationCount < options.maxIterations) {
    // Check abort signal
    if (options.abortSignal?.aborted) {
      return { status: "aborted", /* ... */ };
    }

    // Check token budget
    if (options.tokenBudget && options.tokenBudget.remaining <= 0) {
      return { status: "max_tokens", /* ... */ };
    }

    // Call LLM
    const response = await client.messages.create(
      {
        model: options.model ?? "claude-sonnet-4-20250514",
        max_tokens: 16384,
        system: options.systemPrompt,
        tools: options.tools.map(t => t.anthropicDefinition),
        messages,
      },
      { signal: options.abortSignal },
    );

    // Track tokens
    totalInputTokens += response.usage.input_tokens;
    totalOutputTokens += response.usage.output_tokens;
    if (options.tokenBudget) {
      options.tokenBudget.remaining -= (response.usage.input_tokens + response.usage.output_tokens);
    }

    // Fire onResponse callback
    options.onResponse?.(response);

    // Handle stop_reason
    if (response.stop_reason !== "tool_use") {
      // Agent is done (end_turn, max_tokens, stop_sequence, refusal, etc.)
      const textContent = response.content
        .filter(b => b.type === "text")
        .map(b => b.text)
        .join("");
      return {
        status: mapStopReasonToStatus(response.stop_reason),
        output: textContent,
        toolCallCount: iterationCount,
        tokenCount: { input: totalInputTokens, output: totalOutputTokens },
        trace,
      };
    }

    // Extract tool_use blocks
    const toolUseBlocks = response.content.filter(b => b.type === "tool_use");

    // Add assistant message to conversation
    messages.push({ role: "assistant", content: response.content });

    // Execute each tool and collect results
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const toolUse of toolUseBlocks) {
      if (toolUse.type !== "tool_use") continue;

      // Fire onToolCall callback
      options.onToolCall?.({ name: toolUse.name, input: toolUse.input, id: toolUse.id });

      // Find and execute the tool
      const tool = options.tools.find(t => t.name === toolUse.name);
      let result: ToolResult;
      try {
        result = tool ? await tool.execute(toolUse.input) : { content: `Unknown tool: ${toolUse.name}`, isError: true };
      } catch (error) {
        result = { content: `Tool error: ${error instanceof Error ? error.message : String(error)}`, isError: true };
      }

      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: result.content,
        is_error: result.isError,
      });
    }

    // Add tool results to conversation
    messages.push({ role: "user", content: toolResults });
    iterationCount++;
  }

  return { status: "max_iterations", /* ... */ };
}
```

### Pattern 2: Tool Definition with betaZodTool (Schema Only)
**What:** Use `betaZodTool()` to convert Zod schemas to Anthropic tool format, but execute tools ourselves
**When to use:** Defining tools that will be passed to `runAgentLoop()`

```typescript
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

// Define the Zod schema for tool input
const ReadFileInputSchema = z.object({
  path: z.string().describe("File path relative to repository root"),
});

// Create tool definition for our custom loop
const readFileTool: ToolDefinition = {
  name: "read_file",
  description: "Read the contents of a file in the repository",
  inputSchema: ReadFileInputSchema,
  // This is the Anthropic-format definition (used in messages.create tools array)
  get anthropicDefinition() {
    // Use betaZodTool to get the converted schema
    const betaTool = betaZodTool({
      name: this.name,
      description: this.description,
      inputSchema: this.inputSchema,
      // run is required by betaZodTool but we won't use it
      run: async () => "",
    });
    return {
      name: betaTool.name,
      description: betaTool.description,
      input_schema: betaTool.input_schema,
    };
  },
  // Our own execute function (called by runAgentLoop, not by toolRunner)
  execute: async (input: unknown): Promise<ToolResult> => {
    const parsed = ReadFileInputSchema.parse(input);
    try {
      const content = await containerManager.readFile(parsed.path);
      return { content };
    } catch (error) {
      return { content: `File not found: ${parsed.path}`, isError: true };
    }
  },
};
```

**IMPORTANT ALTERNATIVE:** If the `betaZodTool()` approach of providing a dummy `run` feels wrong, use `zodToJsonSchema` from Zod directly instead:

```typescript
import { zodToJsonSchema } from "zod-to-json-schema";

// Convert Zod schema to JSON Schema manually
function zodToAnthropicTool(
  name: string,
  description: string,
  schema: z.ZodType,
): Anthropic.Tool {
  const jsonSchema = zodToJsonSchema(schema, { target: "openApi3" });
  return {
    name,
    description,
    input_schema: jsonSchema as Anthropic.Tool.InputSchema,
  };
}
```

This approach avoids importing `betaZodTool` entirely but requires adding `zod-to-json-schema` as a dependency. The SDK already depends on it internally, so it may be available. **Recommendation:** Use `betaZodTool()` as the primary approach since it handles conversion correctly and is maintained by Anthropic. The dummy `run` is a minor inelegance.

### Pattern 3: Mutable Token Budget (Shared Across Agents)
**What:** A mutable counter object passed by reference to orchestrator and all sub-agents
**When to use:** LOOP-05 requires token budget shared across orchestrator and sub-agents

```typescript
interface TokenBudget {
  /** Total budget for the task */
  total: number;
  /** Remaining tokens (mutated by each agent loop iteration) */
  remaining: number;
  /** Check if budget is exhausted */
  isExhausted(): boolean;
  /** Deduct tokens used */
  deduct(input: number, output: number): void;
}

function createTokenBudget(total: number): TokenBudget {
  return {
    total,
    remaining: total,
    isExhausted() { return this.remaining <= 0; },
    deduct(input: number, output: number) {
      this.remaining -= (input + output);
    },
  };
}

// Usage: orchestrator creates budget, passes to sub-agents
const budget = createTokenBudget(500_000);
const result = await runAgentLoop({
  // ... options
  tokenBudget: budget, // Mutated in-place by the loop
});
// budget.remaining now reflects tokens used by this loop
// Pass same budget to next sub-agent call
```

### Pattern 4: AbortSignal Integration
**What:** Pass AbortSignal to both the loop control and individual API calls
**When to use:** LOOP-06 for clean cancellation

```typescript
// The AbortSignal is passed to messages.create via the second options argument
const response = await client.messages.create(
  {
    model: "claude-sonnet-4-20250514",
    max_tokens: 16384,
    system: systemPrompt,
    tools: toolDefinitions,
    messages: conversationMessages,
  },
  { signal: abortSignal },  // Second argument = RequestOptions
);

// Also check at the top of each iteration
if (abortSignal?.aborted) {
  return { status: "aborted", output: lastOutput, /* ... */ };
}
```

### Anti-Patterns to Avoid
- **Using `toolRunner()` for production agents:** It handles the loop but provides no hooks for per-iteration tracing, token budget checks, or custom stop conditions. The project decision explicitly requires custom loop.
- **Adding text blocks after tool_result:** The Anthropic API expects tool_result blocks FIRST in the user message content array. Adding text before tool results causes 400 errors or empty responses.
- **Not handling all stop_reason values:** The loop MUST handle `end_turn`, `tool_use`, `max_tokens`, `stop_sequence`, `refusal`, and `model_context_window_exceeded`. Unknown future values should be treated as "completed" with a warning log.
- **Importing LangChain anywhere in the runtime:** The requirement explicitly states "no LangChain imports exist in the runtime."
- **Blocking on tool execution without timeout:** Individual tool calls should have their own timeout protection, separate from the loop's iteration limit.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Zod-to-JSON-Schema conversion | Custom schema walker | `betaZodTool()` from SDK | Handles edge cases (unions, optionals, descriptions, defaults), maintained by Anthropic |
| HTTP request retry/abort | Custom fetch wrapper | SDK's built-in retry + `AbortSignal` | SDK handles retries, rate limits, abort cleanup |
| Tool input validation | Manual JSON parsing | Zod `.parse()` on tool input | Type-safe, consistent error messages, already in the stack |
| Token counting | Manual estimation | `response.usage.input_tokens` / `output_tokens` | API returns exact counts on every response |
| Conversation message formatting | Manual message array building | Anthropic SDK types (`MessageParam`, `ContentBlock`, etc.) | Type-safe, prevents formatting errors that cause 400s |

**Key insight:** The Anthropic SDK provides the HTTP client, type definitions, and Zod conversion. We build the loop logic (iteration, tracing, budgets, abort) on top. We do NOT hand-roll the API communication or schema conversion.

## Common Pitfalls

### Pitfall 1: Empty Responses After Tool Results
**What goes wrong:** Claude returns an empty response with `stop_reason: "end_turn"` after receiving tool results
**Why it happens:** Adding text content blocks immediately after `tool_result` blocks in the user message "teaches" Claude to expect user input after every tool use, causing it to end its turn
**How to avoid:** Never add text blocks alongside or before `tool_result` blocks. Tool result messages should contain ONLY `tool_result` blocks.
**Warning signs:** Agent completes with no output after the first tool call

### Pitfall 2: Unbounded Conversation History Growth
**What goes wrong:** Token costs spiral, eventual context window exceeded errors
**Why it happens:** Every iteration appends assistant + user (tool_result) messages, growing the conversation linearly
**How to avoid:** Track total tokens via `response.usage`. For long-running agents, implement conversation compaction or summarization. For v2.2, the iteration limit (50 sub-agent, 100 orchestrator) provides a natural ceiling. Monitor and add compaction in hardening phase if needed.
**Warning signs:** `input_tokens` growing significantly each iteration, `model_context_window_exceeded` stop reason

### Pitfall 3: Tool Result Ordering in Parallel Tool Calls
**What goes wrong:** 400 API error or mismatched tool results
**Why it happens:** Claude may request multiple tools in a single response (parallel tool use). All tool results must be returned in a SINGLE user message, each with the correct `tool_use_id`.
**How to avoid:** Always collect ALL tool results from a response before sending them back. Never split parallel tool results across multiple user messages.
**Warning signs:** API 400 errors mentioning "tool_use ids were found without tool_result blocks"

### Pitfall 4: Not Handling `max_tokens` Stop Reason in Tool Use Context
**What goes wrong:** Truncated tool_use blocks that can't be parsed
**Why it happens:** If `max_tokens` is too low, Claude's response may be cut off mid-tool-call
**How to avoid:** Set `max_tokens` high enough (16384 recommended for tool-use agents). If `stop_reason === "max_tokens"` and the last content block is `tool_use`, the tool call is incomplete -- retry with higher `max_tokens` or treat as error.
**Warning signs:** JSON parse errors on tool input, incomplete tool_use blocks

### Pitfall 5: AbortSignal Not Checked Between Tool Executions
**What goes wrong:** Agent continues executing tools after cancellation
**Why it happens:** AbortSignal only cancels the in-flight `messages.create()` call. If cancellation happens during tool execution, the loop must check the signal before the next iteration.
**How to avoid:** Check `abortSignal.aborted` at the top of every iteration AND before each tool execution.
**Warning signs:** Agent runs extra tool calls after AbortController.abort() is called

### Pitfall 6: Zod `.describe()` Not Propagated
**What goes wrong:** Claude doesn't understand tool parameters well, makes poor tool calls
**Why it happens:** Zod schemas without `.describe()` produce JSON Schema without `description` fields
**How to avoid:** Always add `.describe()` to every field in tool input schemas. The description is critical for Claude to understand parameter semantics.
**Warning signs:** Claude passes wrong parameter types or values to tools

## Code Examples

### Complete ToolDefinition Interface
```typescript
// Source: Derived from @anthropic-ai/sdk types + project requirements
import type Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";

/**
 * Result returned by a tool execution
 */
export interface ToolResult {
  /** Text content fed back to the LLM */
  content: string;
  /** If true, LLM sees this as an error to reason about */
  isError?: boolean;
}

/**
 * Tool definition for the agent loop
 */
export interface ToolDefinition {
  /** Tool name (must match regex ^[a-zA-Z0-9_-]{1,64}$) */
  name: string;
  /** Detailed description of what the tool does, when to use it */
  description: string;
  /** Zod schema for input validation */
  inputSchema: z.ZodType;
  /** Execute the tool with validated input */
  execute: (input: unknown) => Promise<ToolResult>;
}
```

### AgentLoopOptions and Result Types
```typescript
// Source: Derived from project requirements LOOP-01 through LOOP-09
import type Anthropic from "@anthropic-ai/sdk";

export type AgentLoopStatus =
  | "completed"        // LLM responded with text only (end_turn)
  | "max_iterations"   // Hit iteration limit
  | "max_tokens"       // Token budget exhausted
  | "aborted"          // AbortSignal fired
  | "error";           // Unrecoverable error

export interface TraceStep {
  type: "tool_call" | "tool_result" | "llm_response";
  timestamp: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  tokenCount?: { input: number; output: number };
  durationMs?: number;
  stopReason?: string;
}

export interface TokenBudget {
  total: number;
  remaining: number;
  isExhausted(): boolean;
  deduct(input: number, output: number): void;
}

export interface AgentLoopOptions {
  /** System prompt defining agent behavior */
  systemPrompt: string;
  /** Available tools */
  tools: ToolDefinition[];
  /** The initial task/message */
  initialMessage: string;
  /** Additional context prepended to initial message */
  context?: string;
  /** Model to use (default: claude-sonnet-4-20250514) */
  model?: string;
  /** Maximum loop iterations (default: 50) */
  maxIterations?: number;
  /** Shared mutable token budget */
  tokenBudget?: TokenBudget;
  /** Called on every tool call */
  onToolCall?: (call: { name: string; input: unknown; id: string }) => void;
  /** Called on every LLM response */
  onResponse?: (response: Anthropic.Message) => void;
  /** AbortSignal for cancellation */
  abortSignal?: AbortSignal;
}

export interface AgentLoopResult {
  /** Why the loop stopped */
  status: AgentLoopStatus;
  /** Final text output from the LLM */
  output: string;
  /** Structured output if the final message includes JSON */
  structuredOutput?: unknown;
  /** Number of tool call iterations */
  toolCallCount: number;
  /** Cumulative token usage */
  tokenCount: { input: number; output: number };
  /** Full execution trace */
  trace: TraceStep[];
}
```

### Handling All stop_reason Values
```typescript
// Source: Anthropic API docs - handling stop reasons
// https://platform.claude.com/docs/en/api/handling-stop-reasons

function mapStopReasonToStatus(
  stopReason: string | null,
  logger?: PinoLogger,
): AgentLoopStatus {
  switch (stopReason) {
    case "end_turn":
      return "completed";
    case "tool_use":
      // This should not be called for tool_use -- the loop continues
      return "completed";
    case "max_tokens":
    case "model_context_window_exceeded":
      return "max_tokens";
    case "stop_sequence":
      return "completed";
    case "refusal":
      return "error";
    case "pause_turn":
      // Server-tool only, we don't use server tools
      return "completed";
    default:
      // LOOP-09: Handle unknown future values gracefully
      logger?.warn({ stopReason }, "Unknown stop_reason, treating as completed");
      return "completed";
  }
}
```

### Converting Tool Definitions to Anthropic Format
```typescript
// Source: @anthropic-ai/sdk betaZodTool + manual conversion
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import type Anthropic from "@anthropic-ai/sdk";

function toAnthropicTool(tool: ToolDefinition): Anthropic.Tool {
  // Use betaZodTool to handle Zod-to-JSON-Schema conversion
  const betaTool = betaZodTool({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    run: async () => "", // Required by betaZodTool, unused in our loop
  });
  return {
    name: betaTool.name,
    description: betaTool.description ?? "",
    input_schema: betaTool.input_schema,
  };
}

// Usage in runAgentLoop:
const anthropicTools = options.tools.map(toAnthropicTool);
```

### Token Budget Factory
```typescript
// Source: Project requirement LOOP-05

export function createTokenBudget(total: number): TokenBudget {
  const budget: TokenBudget = {
    total,
    remaining: total,
    isExhausted() {
      return this.remaining <= 0;
    },
    deduct(input: number, output: number) {
      this.remaining -= (input + output);
    },
  };
  return budget;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `@langchain/anthropic` ChatAnthropic for text completion | `@anthropic-ai/sdk` native tool-use with `messages.create()` | v2.2 decision | Direct API access, no abstraction layer, full tool-use support |
| LangGraph state machine graphs | Custom agentic tool-use loops | v2.2 decision | LLM controls flow, not hardcoded graph topology |
| LangGraph `PostgresSaver` checkpoints | Semantic context snapshots (Phase 29) | v2.2 decision | LLM-generated summaries vs serialized graph state |
| `@langchain/core/tools` tool definitions | `betaZodTool()` from `@anthropic-ai/sdk` | v2.2 decision | No LangChain dependency, direct SDK integration |
| LangGraph callback handler for tracing | Custom `onToolCall`/`onResponse` callbacks | v2.2 decision | Simpler, purpose-built for our loop, no LangChain dependency |

**SDK Evolution (relevant):**
- `@anthropic-ai/sdk` v0.63.1: Fixed Zod 3 compatibility in betaZodTool, lowered peer dependency to `^3.25.0`
- `@anthropic-ai/sdk` v0.71.2: Latest stable (as of 2026-01-29)
- `stop_reason: "refusal"` added for safety filtering
- `stop_reason: "model_context_window_exceeded"` added (default in Sonnet 4.5+, beta header for older models)
- `stop_reason: "pause_turn"` added for server tools (web search)
- Tool use examples (`input_examples`) added as beta feature

**Deprecated/outdated:**
- `@langchain/anthropic`: Being replaced entirely in v2.2
- `@langchain/langgraph` + `@langchain/langgraph-checkpoint-postgres`: Being replaced
- `@langchain/core` callbacks for tracing: Replaced by custom callbacks
- `withStructuredOutput()` from LangChain: Replaced by Anthropic SDK structured output via `tool_choice`

## Open Questions

1. **betaZodTool `run` property requirement**
   - What we know: `betaZodTool()` requires a `run` function, but we only need the JSON Schema conversion for our manual loop
   - What's unclear: Whether there's a cleaner way to extract just the schema conversion without providing a dummy `run`
   - Recommendation: Use `betaZodTool()` with a dummy `run: async () => ""` for now. The SDK's internal `zod-to-json-schema` conversion handles edge cases correctly. If this feels wrong, add `zod-to-json-schema` as an explicit dependency and use it directly. Either approach works.

2. **Exact `betaZodTool` return type shape**
   - What we know: Returns an object with `name`, `description`, `input_schema`, and `run` properties
   - What's unclear: Whether the `input_schema` property exactly matches `Anthropic.Tool.InputSchema` type or needs casting
   - Recommendation: Verify at implementation time with TypeScript. May need a type assertion. LOW risk.

3. **Conversation compaction for long-running agents**
   - What we know: The SDK's `toolRunner()` supports automatic compaction. We're building a custom loop.
   - What's unclear: Whether we need compaction in Phase 28 or can defer
   - Recommendation: Defer to Phase 35 (guardrails/hardening). The iteration limits (50/100/10) provide a natural ceiling. Monitor token growth during testing.

4. **`max_tokens` value for tool-use responses**
   - What we know: Too low causes truncated tool_use blocks. The model's max output is 8192 for most Claude Sonnet models, 16384 for Claude 4 models.
   - What's unclear: Optimal `max_tokens` value for non-streaming backend tool use
   - Recommendation: Use 16384 as default. This provides ample room for tool calls with multiple parameters while staying well within context limits. The Anthropic API does not charge for unused `max_tokens`.

## Sources

### Primary (HIGH confidence)
- [Anthropic SDK TypeScript GitHub](https://github.com/anthropics/anthropic-sdk-typescript) - SDK source, README, helpers.md
- [Anthropic Tool Use Implementation Docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/implement-tool-use) - Official tool-use guide, betaZodTool, toolRunner, parallel tools
- [Anthropic Handling Stop Reasons](https://platform.claude.com/docs/en/api/handling-stop-reasons) - Complete stop_reason reference (6 values + streaming behavior)
- [@anthropic-ai/sdk npm](https://www.npmjs.com/package/@anthropic-ai/sdk) - Version 0.71.2 confirmed, peer dependencies

### Secondary (MEDIUM confidence)
- [Anthropic SDK TypeScript helpers.md](https://github.com/anthropics/anthropic-sdk-typescript/blob/main/helpers.md) - betaZodTool, betaTool, toolRunner detailed usage
- Existing codebase analysis (`packages/agents/src/`) - Current LangGraph usage patterns, state schemas, tracing

### Tertiary (LOW confidence)
- betaZodTool return type shape - Inferred from documentation and search results, needs TypeScript verification at implementation time

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - SDK version, peer deps, and APIs verified via npm and official docs
- Architecture: HIGH - Tool-use loop pattern is well-documented in official Anthropic docs; project decisions from STATE.md are clear
- Pitfalls: HIGH - All pitfalls sourced from official docs (empty responses, tool_result ordering, max_tokens truncation)
- Code examples: MEDIUM - Types and patterns derived from SDK docs but not compiled/tested; `betaZodTool` return type shape needs verification

**Research date:** 2026-01-29
**Valid until:** 2026-02-28 (30 days - SDK is actively maintained but tool-use API is stable)
