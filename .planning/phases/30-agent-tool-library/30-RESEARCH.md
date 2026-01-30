# Phase 30: Agent Tool Library - Research

**Researched:** 2026-01-30
**Domain:** Typed tool definitions wrapping DevContainerManager, MCP integration calls, sub-agent spawning, and Temporal signal-based human input
**Confidence:** HIGH

## Summary

Researched how to build a complete library of typed `ToolDefinition` objects that agents invoke via the Phase 28 `runAgentLoop()` runtime. The codebase already provides every underlying service: `DevContainerManager` (container exec), `DevContainerGit` (git CLI in containers), `callMcpTool()` (HTTP calls to integration MCP servers), `runAgentLoop()` itself (for nested sub-agent invocation), and Temporal signal definitions (for human-in-the-loop waits). Phase 30 wraps each service in a `ToolDefinition` -- Zod input schema, description, async execute function returning `{ content: string, isError?: boolean }` -- and groups them into per-agent toolkits.

Key findings: (1) All five codebase tools (`read_file`, `write_file`, `search_codebase`, `list_directory`, `run_command`) delegate to `DevContainerManager.execute()` with different command arrays and timeouts. The taskId is not a tool parameter -- it's bound at toolkit construction time via closure. (2) All 19 MCP integration tools already have Zod input schemas defined in the integration packages (`packages/integrations/*/src/mcp/schemas.ts`). The agent-side `ToolDefinition` wrappers call `callMcpTool()` with the appropriate integration name, tool name, and validated params. (3) `spawn_agent` is a tool that calls `runAgentLoop()` recursively with a focused system prompt, restricted tool set, and shared `TokenBudget`. (4) `request_human_input` is NOT a standard Anthropic tool -- it needs to halt the agentic loop by throwing a structured signal that the Temporal activity catches and converts to a `wf.condition()` wait. Since `runAgentLoop()` catches all tool errors and returns them as `isError: true`, the tool must use a special escape mechanism (e.g., a sentinel `ToolResult` or a non-error throw that the loop propagates).

**Primary recommendation:** Build tool definitions as factory functions that close over runtime dependencies (taskId, DevContainerManager, agentId, correlationId, TokenBudget). Group into toolkit factory functions (`createResearcherToolkit`, `createCoderToolkit`, `createTesterToolkit`, `createOrchestratorToolkit`) that return `ToolDefinition[]`. Place all code under `packages/agents/src/shared/tools/`.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `zod` | 3.25.67 | Input schema for every tool | Already used, satisfies SDK peer dep |
| `@anthropic-ai/sdk` | ^0.72.0 | ToolDefinition consumed by runAgentLoop | Installed in Phase 28 |
| `@aesir/platform` | workspace | DevContainerManager, PinoLogger | Existing platform layer |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@aesir/types` | workspace | createId for agent instance IDs | spawn_agent needs unique IDs |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Factory functions with closures | Class-based tools | Factory functions match existing codebase pattern (DI factories); classes add unnecessary ceremony |
| Re-defining MCP schemas in agent package | Importing from integration packages | Importing creates coupling between agents and integrations; re-defining keeps agents independent per dependency rules. The schemas are small (5-15 lines each) |
| Stopping the loop for `request_human_input` | Returning a special string | Returning a string means the LLM sees "waiting for human" and continues reasoning. Must actually stop the loop. |

### Installation
```bash
# No new packages needed. All dependencies already installed.
```

## Architecture Patterns

### Recommended Project Structure
```
packages/agents/src/shared/tools/
  codebase/
    read-file.ts          # read_file ToolDefinition factory
    write-file.ts         # write_file ToolDefinition factory
    search-codebase.ts    # search_codebase ToolDefinition factory
    list-directory.ts     # list_directory ToolDefinition factory
    run-command.ts        # run_command ToolDefinition factory
    index.ts              # barrel export
  integration/
    linear-tools.ts       # 5 Linear MCP tool wrappers
    github-tools.ts       # 9 GitHub MCP tool wrappers
    slack-tools.ts        # 5 Slack MCP tool wrappers
    index.ts              # barrel export
  coordination/
    spawn-agent.ts        # spawn_agent ToolDefinition factory
    request-human-input.ts # request_human_input ToolDefinition factory
    index.ts              # barrel export
  toolkits.ts             # Per-agent toolkit factories
  types.ts                # Shared tool types (ToolContext, etc.)
  index.ts                # barrel export
```

### Pattern 1: Tool Factory with Closed-over Dependencies
**What:** Each tool is a factory function that takes runtime dependencies and returns a `ToolDefinition`.
**When to use:** Always -- tools need access to DevContainerManager, taskId, agentId, etc.
**Why:** Tools are constructed per-task (each task has its own container, its own correlationId). Closure over dependencies avoids passing context through every tool call.

```typescript
// Source: Pattern derived from existing codebase DevContainerManager + ToolDefinition interface
import { z } from "zod";
import type { DevContainerManager } from "@aesir/platform";
import type { ToolDefinition, ToolResult } from "../agent-loop/types.js";

export interface CodebaseToolDeps {
  /** DevContainerManager for command execution */
  containerManager: DevContainerManager;
  /** Task ID for container lookup */
  taskId: string;
  /** Logger for diagnostics */
  logger: PinoLogger;
}

export function createReadFileTool(deps: CodebaseToolDeps): ToolDefinition {
  const { containerManager, taskId, logger } = deps;

  return {
    name: "read_file",
    description:
      "Read the contents of a file from the repository. " +
      "Returns the file content as text, or an error if the file does not exist. " +
      "Use this to understand existing code before making changes.",
    inputSchema: z.object({
      path: z.string().describe("File path relative to repository root (e.g., 'src/index.ts')"),
    }),
    async execute(input: unknown): Promise<ToolResult> {
      const parsed = z.object({ path: z.string() }).safeParse(input);
      if (!parsed.success) {
        return { content: `Invalid input: ${parsed.error.message}`, isError: true };
      }

      try {
        const result = await containerManager.execute(taskId, {
          command: ["cat", parsed.data.path],
          workdir: "/workspace/repo",
          timeoutMs: 30_000,
        });

        if (result.exitCode !== 0) {
          return {
            content: `Error reading file ${parsed.data.path}: ${result.stderr || "File not found"}`,
            isError: true,
          };
        }

        return { content: result.stdout };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: `Error reading file: ${msg}`, isError: true };
      }
    },
  };
}
```

### Pattern 2: MCP Tool Wrapper
**What:** Wraps `callMcpTool()` with a Zod input schema and ToolResult formatting.
**When to use:** For all 19 integration tools (Linear 5, GitHub 9, Slack 5).
**Why:** The MCP HTTP layer is unchanged. These wrappers make MCP tools available to the LLM via native tool-use.

```typescript
// Source: Pattern derived from existing callMcpTool + MCP schemas
import { z } from "zod";
import { callMcpTool, McpError } from "../mcp/index.js";
import type { ToolDefinition, ToolResult } from "../agent-loop/types.js";

export interface McpToolDeps {
  agentId: string;
  correlationId: string;
}

export function createGetIssueTool(deps: McpToolDeps): ToolDefinition {
  return {
    name: "get_issue",
    description:
      "Retrieve details about a Linear issue including title, description, status, and labels. " +
      "Use this to understand the task requirements.",
    inputSchema: z.object({
      issueId: z.string().describe("Issue ID or identifier (e.g., 'ABC-123')"),
    }),
    async execute(input: unknown): Promise<ToolResult> {
      const parsed = z.object({ issueId: z.string() }).safeParse(input);
      if (!parsed.success) {
        return { content: `Invalid input: ${parsed.error.message}`, isError: true };
      }

      try {
        const result = await callMcpTool({
          integration: "linear",
          tool: "get_issue",
          params: parsed.data,
          agentId: deps.agentId,
          correlationId: deps.correlationId,
        });

        return { content: JSON.stringify(result, null, 2) };
      } catch (error) {
        if (error instanceof McpError) {
          return { content: `MCP error: ${error.message}`, isError: true };
        }
        const msg = error instanceof Error ? error.message : String(error);
        return { content: `Error: ${msg}`, isError: true };
      }
    },
  };
}
```

### Pattern 3: spawn_agent as Recursive runAgentLoop
**What:** A tool that creates a nested `runAgentLoop()` call with focused context and restricted tools.
**When to use:** Orchestrator spawning researcher, coder, or tester sub-agents.
**Why:** In-process sub-agent spawning per v2.2 decisions. Shares TokenBudget with parent.

```typescript
// Source: Pattern derived from runAgentLoop types + v2.2 spec
import { z } from "zod";
import { runAgentLoop, type TokenBudget } from "../agent-loop/index.js";
import type { ToolDefinition, ToolResult } from "../agent-loop/types.js";

export interface SpawnAgentDeps {
  /** Available agent types and their toolkit factories */
  agentTypes: Record<string, AgentTypeConfig>;
  /** Shared token budget from orchestrator */
  tokenBudget: TokenBudget;
  /** AbortSignal propagated from parent */
  abortSignal?: AbortSignal;
  /** Trace recorder for recording spawn events */
  traceRecorder: TraceRecorderCallbacks;
  /** Logger */
  logger: PinoLogger;
}

export interface AgentTypeConfig {
  systemPrompt: string;
  tools: ToolDefinition[];
  maxIterations: number;
  model?: string;
}

export function createSpawnAgentTool(deps: SpawnAgentDeps): ToolDefinition {
  return {
    name: "spawn_agent",
    description:
      "Spawn a focused sub-agent to perform a specific task. " +
      "Available agent types: researcher (read-only codebase exploration), " +
      "coder (read+write code changes), tester (run tests and diagnose failures). " +
      "The sub-agent runs with its own context window and returns a result.",
    inputSchema: z.object({
      agentType: z.enum(["researcher", "coder", "tester"])
        .describe("Type of sub-agent to spawn"),
      task: z.string()
        .describe("Clear description of what the sub-agent should accomplish"),
      context: z.string().optional()
        .describe("Additional context to provide (relevant files, findings, plan)"),
    }),
    async execute(input: unknown): Promise<ToolResult> {
      // validation, lookup config, call runAgentLoop, return result
      // See Code Examples section for full implementation
    },
  };
}
```

### Pattern 4: request_human_input as Loop-Terminating Signal
**What:** A tool that stops the agent loop to request human input via Temporal signals.
**When to use:** When the orchestrator needs approval or clarification.
**Why:** The agent loop must actually pause and return a result that the Temporal activity can interpret. The loop does NOT resume -- a new activity starts after the signal.

**Critical design decision:** `request_human_input` cannot simply return a ToolResult because the loop would continue. Two approaches:

**Approach A (Recommended): Sentinel return + loop status check**
The tool returns a special ToolResult that includes a structured marker. The orchestrator activity checks the loop result and interprets "needs_human_input" as a signal to return control to Temporal for `wf.condition()` waiting.

```typescript
// The tool returns a success result with structured data
return {
  content: JSON.stringify({
    type: "human_input_requested",
    channel: input.channel,
    message: input.message,
    requestType: input.requestType,
  }),
};
// The orchestrator's system prompt instructs it to stop (end_turn) after
// calling request_human_input. The activity wrapper checks the output
// for the "human_input_requested" marker.
```

**Approach B: Throw a non-Error signal**
`runAgentLoop()` catches errors from tool execution and returns `isError: true` to the LLM. But if we throw a specific class (e.g., `HumanInputRequested`) that the loop propagates without catching, the activity can handle it. However, this requires modifying `runAgentLoop()` from Phase 28 to selectively propagate certain errors.

**Recommendation: Approach A.** Do not modify Phase 28's `runAgentLoop()`. Instead, rely on the LLM's system prompt to stop after calling `request_human_input`, and have the Temporal activity wrapper parse the structured output. The LLM is instructed: "After calling request_human_input, you MUST immediately stop and return your current state. Do not call any other tools."

### Anti-Patterns to Avoid
- **Passing taskId as a tool parameter:** The LLM should not need to know the container's taskId. Bind it via closure at toolkit construction time.
- **Importing from integration packages:** Agents must not import from `@aesir/integration-*`. Re-define Zod schemas in the tools module. They are simple objects (5-15 lines each).
- **Throwing exceptions from tools:** All tool errors must be returned as `{ content: "error message", isError: true }`. The LLM reasons about errors. Only `request_human_input` has special semantics.
- **Making tools that are too granular:** Don't create separate `git_add`, `git_commit`, `git_push` tools. The spec defines `create_branch`, `create_commit`, `create_pull_request` which map to MCP tools.
- **Large output without truncation:** File contents and command output should be truncated to prevent exceeding context window limits. Cap at ~100KB text output per tool call.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Container command execution | Custom Docker exec | `DevContainerManager.execute()` | Handles demuxing, timeouts, activity tracking |
| Git operations in container | Manual `docker exec git` | `DevContainerGit` methods or GitHub MCP tools | Already handles credentials, error formatting |
| MCP HTTP calls | Custom fetch with retry | `callMcpTool()` from `shared/mcp/client.ts` | Has retry logic, error wrapping, URL resolution |
| Zod-to-JSON-Schema conversion | Manual JSON Schema writing | `betaZodTool()` via `toAnthropicTool()` in run-agent-loop.ts | Phase 28 already handles this conversion |
| Agent instance IDs | UUID generation | `createId` from `@aesir/types` | Consistent ID format across the system |
| Trace recording for sub-agents | Custom logging | `createTraceRecorder()` from Phase 29 | Buffered writes, parent/child correlation |
| Token budget sharing | Custom counter | `TokenBudget` from Phase 28 | Mutable, shared by reference |

**Key insight:** Phase 30 is a WRAPPER layer. Every underlying capability already exists. The value is in: (1) exposing those capabilities as `ToolDefinition` objects the LLM can invoke, (2) handling errors gracefully (isError: true), and (3) grouping tools into per-agent toolkits.

## Common Pitfalls

### Pitfall 1: Tool Output Too Large for Context Window
**What goes wrong:** `read_file` on a 500KB file or `run_command("pnpm test")` with verbose output floods the context window.
**Why it happens:** DevContainerManager returns raw stdout/stderr with no size limits.
**How to avoid:** Truncate tool output at a configurable max (e.g., 100KB). Append "[output truncated, showing first N bytes]" so the LLM knows it's partial. For `search_codebase`, limit results to N matches.
**Warning signs:** LLM responses mention "context window exceeded" or stop_reason is "max_tokens" / "model_context_window_exceeded".

### Pitfall 2: Zod Validation Errors Not Returned to LLM
**What goes wrong:** Zod `.parse()` throws on invalid input. If the tool's execute function doesn't catch this, `runAgentLoop()` catches it generically as "Tool execution error: [message]".
**Why it happens:** Forgetting to use `.safeParse()` or not wrapping the parse in try/catch.
**How to avoid:** Always use `.safeParse()` inside the execute function and return `{ content: "Invalid input: ...", isError: true }` for validation failures. Do NOT rely on `runAgentLoop()`'s catch -- it works but the error message is less specific.
**Warning signs:** LLM sees "Tool execution error" instead of specific validation failure.

### Pitfall 3: MCP callMcpTool Throws Instead of Returning Error
**What goes wrong:** `callMcpTool()` throws `McpError` on HTTP errors. If uncaught, `runAgentLoop()` wraps it generically.
**Why it happens:** The existing `callMcpTool()` was designed to throw, not return errors. Tool wrappers must catch and convert.
**How to avoid:** Wrap every `callMcpTool()` call in try/catch, converting `McpError` to `{ content: error.message, isError: true }`.
**Warning signs:** LLM sees generic "Tool execution error" for MCP failures.

### Pitfall 4: spawn_agent Exhausts Token Budget Silently
**What goes wrong:** Sub-agent consumes all remaining tokens. Parent agent can't do anything after spawn returns.
**Why it happens:** `TokenBudget` is shared by reference. Sub-agent's loop deducts from the same budget.
**How to avoid:** Two strategies: (1) Reserve a portion of the budget for post-spawn operations. (2) Set a lower `maxIterations` for sub-agents so they can't run indefinitely. The spec implies the orchestrator should set reasonable limits per sub-agent type.
**Warning signs:** Orchestrator returns "max_tokens" status immediately after a spawn.

### Pitfall 5: Container Not Found for Codebase Tools
**What goes wrong:** Tool tries to execute in a container that hasn't been spawned yet.
**Why it happens:** The dev container is spawned by the Temporal activity setup code, not by the tool itself. If spawning failed or the container was cleaned up, tools fail.
**How to avoid:** Each codebase tool should check container existence before executing. Return a clear error: "Container not found for task {taskId}. The dev container may not have been set up."
**Warning signs:** Tools return "Container not found" errors.

### Pitfall 6: request_human_input Loop Continuation
**What goes wrong:** LLM calls `request_human_input` but then continues making tool calls instead of stopping.
**Why it happens:** The tool returns a ToolResult, and the LLM decides to keep going.
**How to avoid:** The system prompt must strongly instruct the LLM to stop after `request_human_input`. Additionally, the Temporal activity wrapper should check the loop result for the human input marker, regardless of whether the LLM honored the instruction.
**Warning signs:** Extra tool calls appear after `request_human_input` in execution traces.

### Pitfall 7: exactOptionalPropertyTypes Compliance
**What goes wrong:** Build errors from assigning `undefined` to optional properties.
**Why it happens:** Project has `exactOptionalPropertyTypes: true` in tsconfig. Must conditionally set optional fields, not assign `undefined`.
**How to avoid:** Use the mutable-object-then-conditional-set pattern established in Phase 28 and 29. Example: build the result object, then `if (value !== undefined) { result.field = value; }`.
**Warning signs:** TypeScript compilation errors about `undefined` not being assignable.

## Code Examples

### Codebase Tool: write_file
```typescript
// Source: Derived from DevContainerManager.execute() + ToolDefinition interface

export function createWriteFileTool(deps: CodebaseToolDeps): ToolDefinition {
  const { containerManager, taskId, logger } = deps;

  return {
    name: "write_file",
    description:
      "Write content to a file in the repository. Creates the file if it doesn't exist, " +
      "or overwrites it if it does. Creates parent directories automatically. " +
      "Use this to implement code changes.",
    inputSchema: z.object({
      path: z.string().describe("File path relative to repository root"),
      content: z.string().describe("Complete file content to write"),
    }),
    async execute(input: unknown): Promise<ToolResult> {
      const parsed = z.object({
        path: z.string(),
        content: z.string(),
      }).safeParse(input);

      if (!parsed.success) {
        return { content: `Invalid input: ${parsed.error.message}`, isError: true };
      }

      try {
        // Create parent directories
        const dir = parsed.data.path.includes("/")
          ? parsed.data.path.substring(0, parsed.data.path.lastIndexOf("/"))
          : null;

        if (dir) {
          await containerManager.execute(taskId, {
            command: ["mkdir", "-p", dir],
            workdir: "/workspace/repo",
            timeoutMs: 10_000,
          });
        }

        // Write file using heredoc to handle special characters
        // Base64 encode to safely transport content with arbitrary bytes
        const b64 = Buffer.from(parsed.data.content).toString("base64");
        const result = await containerManager.execute(taskId, {
          command: ["sh", "-c", `echo '${b64}' | base64 -d > '${parsed.data.path}'`],
          workdir: "/workspace/repo",
          timeoutMs: 30_000,
        });

        if (result.exitCode !== 0) {
          return {
            content: `Error writing file ${parsed.data.path}: ${result.stderr}`,
            isError: true,
          };
        }

        return { content: `Successfully wrote ${parsed.data.path}` };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: `Error writing file: ${msg}`, isError: true };
      }
    },
  };
}
```

### Codebase Tool: search_codebase
```typescript
export function createSearchCodebaseTool(deps: CodebaseToolDeps): ToolDefinition {
  const { containerManager, taskId } = deps;

  return {
    name: "search_codebase",
    description:
      "Search for a pattern in the codebase using ripgrep (rg). " +
      "Returns matching lines with file paths and line numbers. " +
      "Use glob to filter file types (e.g., '*.ts' for TypeScript files). " +
      "Limited to 50 matches to keep output manageable.",
    inputSchema: z.object({
      pattern: z.string().describe("Search pattern (regex supported)"),
      glob: z.string().optional().describe("File glob filter (e.g., '*.ts', '*.json')"),
      path: z.string().optional().describe("Subdirectory to search in (default: repo root)"),
    }),
    async execute(input: unknown): Promise<ToolResult> {
      const schema = z.object({
        pattern: z.string(),
        glob: z.string().optional(),
        path: z.string().optional(),
      });
      const parsed = schema.safeParse(input);
      if (!parsed.success) {
        return { content: `Invalid input: ${parsed.error.message}`, isError: true };
      }

      const args = ["rg", "--line-number", "--max-count", "50", "--no-heading"];
      if (parsed.data.glob) {
        args.push("--glob", parsed.data.glob);
      }
      args.push(parsed.data.pattern);
      if (parsed.data.path) {
        args.push(parsed.data.path);
      }

      try {
        const result = await containerManager.execute(taskId, {
          command: args,
          workdir: "/workspace/repo",
          timeoutMs: 30_000,
        });

        // rg returns exit code 1 for "no matches" (not an error)
        if (result.exitCode === 1 && !result.stderr) {
          return { content: "No matches found." };
        }

        if (result.exitCode !== 0 && result.exitCode !== 1) {
          return {
            content: `Search error: ${result.stderr}`,
            isError: true,
          };
        }

        const output = result.stdout.trim();
        if (!output) {
          return { content: "No matches found." };
        }

        // Truncate if too large
        const MAX_OUTPUT = 100_000;
        if (output.length > MAX_OUTPUT) {
          return {
            content: `${output.slice(0, MAX_OUTPUT)}\n\n[Output truncated. Showing first ${MAX_OUTPUT} bytes of ${output.length} total. Use a more specific pattern or glob to narrow results.]`,
          };
        }

        return { content: output };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: `Search error: ${msg}`, isError: true };
      }
    },
  };
}
```

### Codebase Tool: run_command
```typescript
export function createRunCommandTool(deps: CodebaseToolDeps): ToolDefinition {
  const { containerManager, taskId } = deps;

  return {
    name: "run_command",
    description:
      "Run a shell command inside the dev container. " +
      "Use this for running tests (pnpm test), installing dependencies (pnpm install), " +
      "building (pnpm build), or any other shell operations. " +
      "Returns stdout, stderr, and exit code.",
    inputSchema: z.object({
      command: z.string().describe("Shell command to execute (e.g., 'pnpm test')"),
      timeoutMs: z.number().optional().describe("Timeout in milliseconds (default: 180000 for tests)"),
    }),
    async execute(input: unknown): Promise<ToolResult> {
      const parsed = z.object({
        command: z.string(),
        timeoutMs: z.number().optional(),
      }).safeParse(input);
      if (!parsed.success) {
        return { content: `Invalid input: ${parsed.error.message}`, isError: true };
      }

      try {
        const result = await containerManager.execute(taskId, {
          command: ["sh", "-c", parsed.data.command],
          workdir: "/workspace/repo",
          timeoutMs: parsed.data.timeoutMs ?? 180_000,
        });

        // Format output for LLM consumption
        const parts: string[] = [];
        parts.push(`Exit code: ${result.exitCode}`);
        if (result.timedOut) {
          parts.push("[TIMED OUT]");
        }
        if (result.stdout) {
          const stdout = result.stdout.length > 100_000
            ? `${result.stdout.slice(0, 100_000)}\n[stdout truncated]`
            : result.stdout;
          parts.push(`\nSTDOUT:\n${stdout}`);
        }
        if (result.stderr) {
          const stderr = result.stderr.length > 50_000
            ? `${result.stderr.slice(0, 50_000)}\n[stderr truncated]`
            : result.stderr;
          parts.push(`\nSTDERR:\n${stderr}`);
        }

        return {
          content: parts.join("\n"),
          isError: result.exitCode !== 0,
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: `Command execution error: ${msg}`, isError: true };
      }
    },
  };
}
```

### MCP Integration Tool: Generic Wrapper Helper
```typescript
// Helper to reduce boilerplate for MCP tool wrappers
export function createMcpToolWrapper(config: {
  integration: "linear" | "github" | "slack";
  toolName: string;
  displayName: string;
  description: string;
  inputSchema: z.ZodType;
  deps: McpToolDeps;
}): ToolDefinition {
  return {
    name: config.displayName,
    description: config.description,
    inputSchema: config.inputSchema,
    async execute(input: unknown): Promise<ToolResult> {
      const parsed = config.inputSchema.safeParse(input);
      if (!parsed.success) {
        return { content: `Invalid input: ${parsed.error.message}`, isError: true };
      }

      try {
        const result = await callMcpTool({
          integration: config.integration,
          tool: config.toolName,
          params: parsed.data as Record<string, unknown>,
          agentId: config.deps.agentId,
          correlationId: config.deps.correlationId,
        });

        return { content: JSON.stringify(result, null, 2) };
      } catch (error) {
        if (error instanceof McpError) {
          return { content: `${config.displayName} error: ${error.message}`, isError: true };
        }
        const msg = error instanceof Error ? error.message : String(error);
        return { content: `${config.displayName} error: ${msg}`, isError: true };
      }
    },
  };
}
```

### Coordination Tool: spawn_agent (Full Implementation Pattern)
```typescript
export function createSpawnAgentTool(deps: SpawnAgentDeps): ToolDefinition {
  const { agentTypes, tokenBudget, abortSignal, traceRecorder, logger } = deps;

  return {
    name: "spawn_agent",
    description:
      "Spawn a focused sub-agent to perform a specific task. " +
      "Available types: 'researcher' (read-only codebase exploration), " +
      "'coder' (implement code changes per a plan), " +
      "'tester' (run tests and diagnose failures). " +
      "Each sub-agent has its own fresh context window and restricted tool set. " +
      "Returns the sub-agent's final output.",
    inputSchema: z.object({
      agentType: z.enum(["researcher", "coder", "tester"]),
      task: z.string().describe("What the sub-agent should accomplish"),
      context: z.string().optional().describe("Relevant context: files, findings, plan details"),
    }),
    async execute(input: unknown): Promise<ToolResult> {
      const parsed = z.object({
        agentType: z.enum(["researcher", "coder", "tester"]),
        task: z.string(),
        context: z.string().optional(),
      }).safeParse(input);

      if (!parsed.success) {
        return { content: `Invalid input: ${parsed.error.message}`, isError: true };
      }

      const { agentType, task, context } = parsed.data;
      const config = agentTypes[agentType];
      if (!config) {
        return { content: `Unknown agent type: ${agentType}`, isError: true };
      }

      const childInstanceId = createId.agentInstance();

      // Record spawn in trace
      traceRecorder.onAgentSpawn(childInstanceId, agentType, { task, context });

      logger.info(
        { agentType, childInstanceId, task: task.slice(0, 100) },
        "Spawning sub-agent",
      );

      try {
        const result = await runAgentLoop({
          systemPrompt: config.systemPrompt,
          tools: config.tools,
          initialMessage: task,
          context,
          maxIterations: config.maxIterations,
          model: config.model,
          tokenBudget,
          abortSignal,
          logger: logger.child({ agentType, agentInstanceId: childInstanceId }),
        });

        // Record completion in trace
        traceRecorder.onAgentComplete({
          agentType,
          childInstanceId,
          status: result.status,
          toolCallCount: result.toolCallCount,
          tokenCount: result.tokenCount,
        });

        logger.info(
          {
            agentType,
            childInstanceId,
            status: result.status,
            toolCallCount: result.toolCallCount,
          },
          "Sub-agent completed",
        );

        if (result.status === "error") {
          return { content: `Sub-agent error: ${result.output}`, isError: true };
        }

        return { content: result.output };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error({ err: error, agentType, childInstanceId }, "Sub-agent failed");
        return { content: `Sub-agent ${agentType} failed: ${msg}`, isError: true };
      }
    },
  };
}
```

### Toolkit Factory: Per-Agent Tool Sets
```typescript
export interface ToolkitDeps {
  containerManager: DevContainerManager;
  taskId: string;
  agentId: string;
  correlationId: string;
  logger: PinoLogger;
  tokenBudget: TokenBudget;
  abortSignal?: AbortSignal;
  traceRecorder: TraceRecorderCallbacks;
}

export function createResearcherToolkit(deps: ToolkitDeps): ToolDefinition[] {
  const codebaseDeps = {
    containerManager: deps.containerManager,
    taskId: deps.taskId,
    logger: deps.logger,
  };
  const mcpDeps = {
    agentId: deps.agentId,
    correlationId: deps.correlationId,
  };

  return [
    createReadFileTool(codebaseDeps),
    createSearchCodebaseTool(codebaseDeps),
    createListDirectoryTool(codebaseDeps),
    createRunCommandTool(codebaseDeps),  // Read-only intent but can run commands for research
  ];
}

export function createCoderToolkit(deps: ToolkitDeps): ToolDefinition[] {
  const codebaseDeps = { ... };
  return [
    createReadFileTool(codebaseDeps),
    createWriteFileTool(codebaseDeps),
    createSearchCodebaseTool(codebaseDeps),
    createRunCommandTool(codebaseDeps),
  ];
}

export function createTesterToolkit(deps: ToolkitDeps): ToolDefinition[] {
  const codebaseDeps = { ... };
  return [
    createReadFileTool(codebaseDeps),
    createSearchCodebaseTool(codebaseDeps),
    createRunCommandTool(codebaseDeps),
  ];
}

export function createOrchestratorToolkit(deps: ToolkitDeps): ToolDefinition[] {
  const codebaseDeps = { ... };
  const mcpDeps = { ... };

  return [
    // Lightweight codebase tools
    createReadFileTool(codebaseDeps),
    createSearchCodebaseTool(codebaseDeps),
    createListDirectoryTool(codebaseDeps),

    // Coordination
    createSpawnAgentTool({
      agentTypes: buildSubAgentConfigs(deps),
      tokenBudget: deps.tokenBudget,
      abortSignal: deps.abortSignal,
      traceRecorder: deps.traceRecorder,
      logger: deps.logger,
    }),
    createRequestHumanInputTool(),

    // Integration tools (selected subset for orchestrator)
    createGetIssueTool(mcpDeps),
    createUpdateIssueStatusTool(mcpDeps),
    createSendMessageTool(mcpDeps),
    createSendApprovalRequestTool(mcpDeps),

    // Git tools (via GitHub MCP)
    createCreateBranchTool(mcpDeps),
    createCreateCommitTool(mcpDeps),
    createCreatePullRequestTool(mcpDeps),
    createGetPullRequestTool(mcpDeps),
    createMergePullRequestTool(mcpDeps),
  ];
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| LangGraph nodes call integration SDKs directly | Tools wrap MCP HTTP calls | v2.0 Phase 19 | Agents only use MCP, no SDK imports |
| LangGraph graph defines fixed tool sequence | LLM decides which tools to call | v2.2 Phase 28 | Flexible agent behavior |
| Hardcoded phase enum controls workflow | Tool-use loop with LLM reasoning | v2.2 Phase 28 | Adaptive control flow |
| No sub-agent spawning | `spawn_agent` creates nested loops | v2.2 Phase 30 | Fresh context per sub-task |

**Deprecated/outdated:**
- LangGraph node-based tool invocation: Replaced by ToolDefinition + runAgentLoop
- `@langchain/anthropic` ChatAnthropic: Replaced by `@anthropic-ai/sdk` direct calls
- DevAgentPhaseSchema 16-value enum: Replaced by LLM-driven tool selection

## Open Questions

Things that couldn't be fully resolved:

1. **write_file Content Transport**
   - What we know: Container exec uses command arrays. Writing large file content via shell requires careful escaping.
   - What's unclear: Whether base64 encoding/decoding is available in all dev container images. Whether pipe approach handles binary files.
   - Recommendation: Use base64 transport by default. Add a validation step to check if `base64` command exists in container. For v2.2, limit to text files only.

2. **request_human_input Loop Termination Mechanism**
   - What we know: The tool must stop the agent loop. Approach A (system prompt instruction + sentinel output parsing) is recommended.
   - What's unclear: How reliably Claude follows "stop immediately after this tool" instructions. Edge case: what if the LLM ignores the instruction and continues?
   - Recommendation: Use Approach A as primary. Add a fallback: the Temporal activity wrapper should check for the marker in the loop result even if the LLM made additional tool calls after it. The marker presence (not the loop ending cleanly) is what triggers the Temporal signal wait.

3. **sub-agent MaxIterations Defaults**
   - What we know: The orchestrator has maxIterations=50 (Phase 28 default). Sub-agents should have lower limits.
   - What's unclear: Optimal iteration counts for researcher vs. coder vs. tester.
   - Recommendation: Start with researcher=30, coder=40, tester=20. These are configurable and can be tuned based on real usage in Phase 36 (E2E validation).

4. **Git Tools: Container-based vs. MCP**
   - What we know: The spec lists git tools (`create_branch`, `create_commit`, etc.) as GitHub MCP wrappers. But `DevContainerGit` also provides git operations inside the container.
   - What's unclear: Whether the orchestrator should use MCP git tools (GitHub API) or container git tools (CLI in container). The spec clearly says MCP for git tools.
   - Recommendation: Use GitHub MCP tools for branch, commit, and PR operations. Container git is only used for container setup (clone, configure credentials) -- not exposed as agent tools. This matches the spec's "Git tools (via existing GitHub MCP)" section.

5. **Tool Description Quality**
   - What we know: Tool descriptions are critical for LLM tool selection. Anthropic docs recommend detailed, specific descriptions.
   - What's unclear: Optimal description length. Too short = LLM misuses tool. Too long = wastes context tokens.
   - Recommendation: Each description should be 2-4 sentences. Include: what the tool does, when to use it, and any important constraints. Iterate based on E2E testing in Phase 36.

## Complete Tool Inventory

### Codebase Tools (5 tools) -- TOOL-01
| Tool | Input | Wraps | Timeout |
|------|-------|-------|---------|
| `read_file` | `{ path }` | `containerManager.execute(["cat", path])` | 30s |
| `write_file` | `{ path, content }` | `containerManager.execute(["sh", "-c", base64 write])` | 30s |
| `search_codebase` | `{ pattern, glob?, path? }` | `containerManager.execute(["rg", ...])` | 30s |
| `list_directory` | `{ path? }` | `containerManager.execute(["ls", "-la", path])` | 10s |
| `run_command` | `{ command, timeoutMs? }` | `containerManager.execute(["sh", "-c", cmd])` | 180s |

### Linear MCP Tools (5 tools) -- TOOL-02
| Tool | Input | MCP Tool |
|------|-------|----------|
| `get_issue` | `{ issueId }` | `linear/get_issue` |
| `create_issue` | `{ teamId, title, description?, priority?, labelIds? }` | `linear/create_issue` |
| `update_issue_status` | `{ issueId, statusName }` | `linear/update_issue_status` |
| `list_teams` | `{}` | `linear/list_teams` |
| `list_labels` | `{ teamId }` | `linear/list_labels` |

### GitHub MCP Tools (9 tools) -- TOOL-02, TOOL-03
| Tool | Input | MCP Tool |
|------|-------|----------|
| `get_repository` | `{ owner, repo }` | `github/get_repository` |
| `create_branch` | `{ owner, repo, branchName, baseBranch? }` | `github/create_branch` |
| `create_commit` | `{ owner, repo, branch, message, files }` | `github/create_commit` |
| `create_pull_request` | `{ owner, repo, title, body?, head, base }` | `github/create_pull_request` |
| `get_pull_request` | `{ owner, repo, pullNumber }` | `github/get_pull_request` |
| `list_pull_requests` | `{ owner, repo, state? }` | `github/list_pull_requests` |
| `merge_pull_request` | `{ owner, repo, pullNumber, mergeMethod?, commitTitle?, commitMessage? }` | `github/merge_pull_request` |
| `get_file_contents` | `{ owner, repo, path, ref? }` | `github/get_file_contents` |
| `list_files` | `{ owner, repo, path?, ref? }` | `github/list_files` |

### Slack MCP Tools (5 tools) -- TOOL-02
| Tool | Input | MCP Tool |
|------|-------|----------|
| `send_message` | `{ channel, text, blocks?, threadTs? }` | `slack/send_message` |
| `send_approval_request` | `{ channel, taskId, title, summary, prUrl?, actionPrefix? }` | `slack/send_approval_request` |
| `get_message` | `{ channel, ts }` | `slack/get_message` |
| `reply_to_thread` | `{ channel, threadTs, text, blocks? }` | `slack/reply_to_thread` |
| `list_channels` | `{ types?, limit?, excludeArchived? }` | `slack/list_channels` |

### Coordination Tools (2 tools) -- TOOL-04, TOOL-05
| Tool | Input | Mechanism |
|------|-------|-----------|
| `spawn_agent` | `{ agentType, task, context? }` | Nested `runAgentLoop()` call |
| `request_human_input` | `{ channel, message, requestType }` | Sentinel return + LLM stop instruction |

### Total: 26 tools (5 codebase + 19 MCP + 2 coordination)

## Per-Agent Toolkit Composition -- TOOL-08

| Agent | Codebase | Linear | GitHub | Slack | Coordination | Total |
|-------|----------|--------|--------|-------|-------------|-------|
| Orchestrator | read_file, search_codebase, list_directory (3) | get_issue, update_issue_status (2) | create_branch, create_commit, create_pull_request, get_pull_request, merge_pull_request (5) | send_message, send_approval_request (2) | spawn_agent, request_human_input (2) | **14** |
| Researcher | read_file, search_codebase, list_directory, run_command (4) | - | - | - | - | **4** |
| Coder | read_file, write_file, search_codebase, run_command (4) | - | - | - | - | **4** |
| Tester | read_file, search_codebase, run_command (3) | - | - | - | - | **3** |

**Notes:**
- Researcher has `run_command` for research commands (e.g., `find`, `wc`, `grep` variants).
- Coder has `write_file` + `run_command` (for building/testing during implementation).
- Tester has `run_command` for test execution, `read_file` and `search_codebase` for investigating failures.
- Orchestrator does NOT have `write_file` or `run_command` -- delegates implementation to sub-agents.
- Sub-agents do NOT have integration or coordination tools -- they only interact with the codebase.

## Sources

### Primary (HIGH confidence)
- Phase 28 source code: `packages/agents/src/shared/agent-loop/` -- ToolDefinition interface, runAgentLoop(), TokenBudget
- Phase 29 source code: `packages/agents/src/shared/db/` -- TraceRecorder, ContextManager, TaskStore
- Existing MCP client: `packages/agents/src/shared/mcp/` -- callMcpTool(), McpError, McpCallOptions
- DevContainerManager: `packages/platform/src/sandbox/dev-container.ts` -- execute(), spawn()
- DevContainerGit: `packages/platform/src/sandbox/dev-container-git.ts` -- git operations
- MCP schemas: `packages/integrations/*/src/mcp/schemas.ts` -- Zod input schemas for all 19 tools
- MCP servers: `packages/integrations/*/src/mcp/server.ts` -- Tool registrations confirming 5+9+5=19 tools
- Temporal signals: `packages/agents/src/shared/temporal/signals.ts` -- planApprovalSignal, userReplySignal
- v2.2 spec: `2.2-spec.md` sections on Agent Tool Library, Dev Agent Orchestrator, E2E flow

### Secondary (MEDIUM confidence)
- v2.2 spec orchestrator tool assignments (spec section 4)
- Phase 28 research on betaZodTool() and Zod-to-JSON-Schema conversion

### Tertiary (LOW confidence)
- Optimal sub-agent maxIterations values (no empirical data yet)
- write_file base64 transport reliability across container images (untested assumption)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- All libraries already installed and in use
- Architecture: HIGH -- Patterns directly derived from existing codebase (factory functions, closures, DI)
- Tool inventory: HIGH -- Complete inventory verified against MCP server registrations and spec
- Toolkit composition: HIGH -- Matches spec section 4 sub-agent table exactly
- Pitfalls: HIGH -- Derived from actual code reading (McpError throws, exactOptionalPropertyTypes, etc.)
- request_human_input mechanism: MEDIUM -- Approach A is sound but untested; may need Phase 31 refinement
- Output truncation limits: MEDIUM -- 100KB chosen as reasonable heuristic, needs real-world tuning

**Research date:** 2026-01-30
**Valid until:** 2026-03-01 (stable domain -- all underlying services are locked from Phases 28-29)
