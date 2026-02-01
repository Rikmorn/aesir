# Phase 38: Agent and Tool Registries - Research

**Researched:** 2026-02-01
**Domain:** YAML-based agent definitions, registry pattern, tool factory resolution, file-based configuration loading
**Confidence:** HIGH

## Summary

Phase 38 transforms hardcoded agent configurations (system prompts as constants, tool selections as code, per-agent orchestrator functions) into declarative YAML definitions loaded by registries. The phase creates two registries (AgentRegistry, ToolRegistry) and five agent definition directories (dev-agent, product-agent, researcher, coder, tester) that produce identical runtime behavior to the current v2.2 code.

This is a well-understood refactoring domain. The codebase already has all the tool factories, system prompts, and agent configurations -- they just need to be extracted from TypeScript code into data files. The `AgentDefinition` schema is explicitly defined in the v2.3 spec (Section 1). The tool namespace convention (`integration:tool_name`) directly maps from the existing `displayName` field pattern (`integration_tool_name`). The registry pattern is standard: load files from disk, parse YAML, validate with Zod, cache in memory, invalidate on mtime change.

The only new dependency needed is the `yaml` npm package (v2.8.x) for YAML parsing. Everything else (Zod for validation, `node:fs/promises` for file I/O, `node:path` for path resolution) is already available. The definitions directory lives at `packages/agents/definitions/` (outside `src/`) as specified in the v2.3 spec, loaded at runtime via `node:fs`.

**Primary recommendation:** Follow the spec exactly. Extract existing prompts and configs into YAML+Markdown files. Build thin registries that validate with Zod and cache with mtime. Zero behavioral changes -- this is a mechanical extraction, not a rewrite.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| yaml | 2.8.x | Parse YAML definition files to JS objects | Built-in TypeScript types, zero deps, clean `parse()` API, most popular npm YAML parser |
| zod | 3.25.67 | Validate parsed YAML against AgentDefinition schema | Already used throughout codebase for all validation |
| node:fs/promises | built-in | Read definition files and prompt files from disk | Standard Node.js API, async, no deps |
| node:path | built-in | Resolve paths to definitions directory | Standard Node.js API |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @aesir/types | workspace:* | `createId` for any new ID types needed | If registries need IDs |
| @aesir/platform | workspace:* | `PinoLogger` for registry logging | Diagnostic logging in registries |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| yaml (npm) | js-yaml | js-yaml requires separate @types/js-yaml, less TypeScript-native. yaml has built-in types. |
| yaml (npm) | JSON config | YAML is more readable for humans editing agent definitions. Multi-line strings, comments, no trailing commas. Spec mandates YAML. |
| File-based definitions | Database-backed | File-based for v2.3 (spec decision). Interface supports DB backing later. Files are version-controlled and editable in IDEs. |
| mtime-based cache | File watcher (chokidar/fs.watch) | mtime is simpler, no event loop overhead, no platform-specific quirks. Spec explicitly says "mtime check -- no file watcher complexity." |

**Installation:**
```bash
pnpm --filter @aesir/agents add yaml
```

Note: Use `--legacy-peer-deps` if peer dep conflicts arise (per CLAUDE.md gotchas).

## Architecture Patterns

### Recommended Project Structure
```
packages/agents/
  definitions/                    # NEW: Agent definition data files (outside src/)
    dev-agent/
      definition.yaml             # Agent config (model, tools, limits, triggers)
      prompt.md                   # System prompt (full markdown content)
    product-agent/
      definition.yaml
      prompt.md
    researcher/
      definition.yaml
      prompt.md
    coder/
      definition.yaml
      prompt.md
    tester/
      definition.yaml
      prompt.md
  src/
    framework/                    # Existing from Phase 37
      agent-registry.ts           # NEW: AgentRegistry implementation
      agent-registry.test.ts      # NEW: Unit tests
      tool-registry.ts            # NEW: ToolRegistry implementation
      tool-registry.test.ts       # NEW: Unit tests
      types.ts                    # MODIFIED: Add AgentDefinition, ToolRegistry types
      index.ts                    # MODIFIED: Add new exports
```

### Pattern 1: AgentDefinition Zod Schema
**What:** A Zod schema that validates parsed YAML into a typed `AgentDefinition` object. This is the core data model.
**When to use:** Every time a definition file is loaded from disk.
**Example:**
```typescript
// Source: v2.3 spec Section 1 (AgentDefinition interface)
import { z } from "zod";

const AgentDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  version: z.string().min(1),

  model: z.string().min(1),
  temperature: z.number().min(0).max(2).optional(),

  tools: z.array(z.string().regex(/^[a-z]+:[a-z_]+$/)),

  subAgents: z.record(z.string()).optional(),

  maxIterations: z.number().int().positive(),
  tokenBudget: z.number().int().min(0),

  history: z.object({
    pruneThreshold: z.number().int().positive(),
    protectedMessages: z.number().int().positive(),
    summaryThreshold: z.number().int().positive(),
    summaryModel: z.string().min(1),
  }),

  triggers: z.array(z.object({
    event: z.string().min(1),
  })).optional(),
});

// systemPrompt loaded from prompt.md, NOT in YAML
export interface AgentDefinition extends z.infer<typeof AgentDefinitionSchema> {
  systemPrompt: string;
}
```

### Pattern 2: AgentRegistry with Lazy Loading and mtime Cache
**What:** Registry loads definitions on first `get()` call, caches in memory, checks file mtime to invalidate.
**When to use:** Every agent definition lookup.
**Example:**
```typescript
// Source: v2.3 spec Section 5 (Agent Registry)
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";

interface CacheEntry {
  definition: AgentDefinition;
  mtime: number;         // ms since epoch from fs.stat
}

export function createAgentRegistry(options: AgentRegistryOptions): AgentRegistry {
  const cache = new Map<string, CacheEntry>();

  async function loadDefinition(id: string): Promise<AgentDefinition | null> {
    const defDir = join(options.definitionsDir, id);
    const yamlPath = join(defDir, "definition.yaml");
    const promptPath = join(defDir, "prompt.md");

    // Check mtime
    const yamlStat = await stat(yamlPath);
    const promptStat = await stat(promptPath);
    const mtime = Math.max(yamlStat.mtimeMs, promptStat.mtimeMs);

    const cached = cache.get(id);
    if (cached && cached.mtime >= mtime) {
      return cached.definition;
    }

    // Load and validate
    const yamlContent = await readFile(yamlPath, "utf-8");
    const parsed = parse(yamlContent);
    const config = AgentDefinitionSchema.parse(parsed);
    const systemPrompt = await readFile(promptPath, "utf-8");

    const definition: AgentDefinition = { ...config, systemPrompt };
    cache.set(id, { definition, mtime });
    return definition;
  }

  return {
    async get(id, version?) {
      return loadDefinition(id);
    },
    async list() {
      // readdir definitions directory, load each
    },
  };
}
```

### Pattern 3: ToolRegistry with Factory Functions and Namespace Resolution
**What:** Resolves `namespace:tool_name` strings to `ToolDefinition[]` by calling factory functions with runtime context.
**When to use:** When the executor starts a conversation and needs to resolve tools for the agent.
**Example:**
```typescript
// Source: v2.3 spec Section 5 (Tool Registry)
import type { ToolDefinition } from "../shared/agent-loop/types.js";

type ToolFactory = (context: ToolContext) => ToolDefinition;

interface ToolContext {
  agentId: string;
  correlationId: string;
  containerManager?: DevContainerManager;
  taskId?: string;
  logger: PinoLogger;
}

export function createToolRegistry(): ToolRegistry {
  const factories = new Map<string, ToolFactory>();

  return {
    register(ref: string, factory: ToolFactory): void {
      if (factories.has(ref)) {
        throw new Error(`Tool already registered: ${ref}`);
      }
      factories.set(ref, factory);
    },

    resolve(toolRefs: string[], context: ToolContext): ToolDefinition[] {
      return toolRefs.map((ref) => {
        const factory = factories.get(ref);
        if (!factory) {
          throw new Error(`Unknown tool reference: ${ref}`);
        }
        return factory(context);
      });
    },
  };
}
```

### Pattern 4: Tool Name Mapping (v2.2 to v2.3)
**What:** Map existing `displayName` values to `namespace:tool_name` references.
**When to use:** Registering tool factories and writing definition YAML files.

Complete mapping from codebase:

| v2.2 displayName | v2.3 namespace:tool_name | Factory Function |
|---|---|---|
| `read_file` | `codebase:read_file` | `createReadFileTool` |
| `write_file` | `codebase:write_file` | `createWriteFileTool` |
| `search_codebase` | `codebase:search_codebase` | `createSearchCodebaseTool` |
| `list_directory` | `codebase:list_directory` | `createListDirectoryTool` |
| `run_command` | `codebase:run_command` | `createRunCommandTool` |
| `spawn_agent` | `coordination:spawn_agent` | `createSpawnAgentTool` |
| `request_human_input` | `coordination:request_human_input` | `createRequestHumanInputTool` |
| `linear_get_issue` | `linear:get_issue` | via `createLinearTools` |
| `linear_create_issue` | `linear:create_issue` | via `createLinearTools` |
| `linear_update_issue_status` | `linear:update_issue_status` | via `createLinearTools` |
| `linear_list_teams` | `linear:list_teams` | via `createLinearTools` |
| `linear_list_labels` | `linear:list_labels` | via `createLinearTools` |
| `linear_search_issues` | `linear:search_issues` | via `createLinearTools` |
| `github_get_repository` | `github:get_repository` | via `createGitHubTools` |
| `github_create_branch` | `github:create_branch` | via `createGitHubTools` |
| `github_create_commit` | `github:create_commit` | via `createGitHubTools` |
| `github_create_pull_request` | `github:create_pull_request` | via `createGitHubTools` |
| `github_get_pull_request` | `github:get_pull_request` | via `createGitHubTools` |
| `github_list_pull_requests` | `github:list_pull_requests` | via `createGitHubTools` |
| `github_merge_pull_request` | `github:merge_pull_request` | via `createGitHubTools` |
| `github_get_file_contents` | `github:get_file_contents` | via `createGitHubTools` |
| `github_list_files` | `github:list_files` | via `createGitHubTools` |
| `slack_send_message` | `slack:send_message` | via `createSlackTools` |
| `slack_send_approval_request` | `slack:send_approval_request` | via `createSlackTools` |
| `slack_get_message` | `slack:get_message` | via `createSlackTools` |
| `slack_reply_to_thread` | `slack:reply_to_thread` | via `createSlackTools` |
| `slack_list_channels` | `slack:list_channels` | via `createSlackTools` |

**Critical:** The `displayName` sent to the Anthropic API must remain unchanged (e.g., `linear_get_issue`). The namespace form (`linear:get_issue`) is only for definition YAML and registry resolution. The ToolRegistry resolves `linear:get_issue` to a ToolDefinition whose `.name` is still `linear_get_issue`. The colon is NOT sent to the LLM -- Anthropic tool names must match `^[a-zA-Z0-9_-]{1,64}$`.

### Pattern 5: Version Pinning for Running Conversations
**What:** When a conversation starts, it records `agentDefinitionVersion` in the conversations and agent_events tables. Subsequent operations for that conversation load that specific version.
**When to use:** All conversation lifecycle operations after the initial start.
**Example:**
```typescript
// At conversation start:
const definition = await agentRegistry.get("dev-agent"); // latest
// Record version in conversation record
await db.insert(conversations).values({
  id: convId,
  agentDefinitionId: definition.id,
  agentDefinitionVersion: definition.version,
  // ...
});

// On resume (Phase 40 concern, but registry must support it):
const conv = await db.select().from(conversations).where(eq(conversations.id, convId));
const definition = await agentRegistry.get(conv.agentDefinitionId, conv.agentDefinitionVersion);
// ^ Returns the pinned version, not latest
```

**Implementation note for version pinning:** Since definitions are file-based and version is a field in the YAML file, the simplest approach is: the registry caches by `id` (always latest from disk). For version pinning, the conversations table already stores `agentDefinitionVersion`. When a conversation resumes, the caller checks if the cached definition's version matches. If not, this is a version mismatch -- for file-based backing, the previous version is gone (overwritten on disk). The spec's intent is: during a conversation's lifetime, the definition object it started with is used. The registry should support this by allowing the caller to pass a version parameter, and if the cached version does not match, log a warning but return what is available. Full version history is a future concern (database-backed registry).

For Phase 38 specifically: the mtime-based cache stores the current definition. The `get(id, version?)` method checks if the cached version matches the requested version. If it matches, return it. If not, reload from disk. If the reloaded version still does not match (file was changed), log a warning. This is sufficient -- the conversation executor (Phase 40) is the component that actually needs version pinning, and it will hold the definition object in memory for the duration of a conversation.

### Pattern 6: Definitions Directory Outside src/
**What:** The `definitions/` directory is at `packages/agents/definitions/`, outside `src/`. The tsconfig `rootDir` is `./src`.
**When to use:** Agent definition data files are NOT TypeScript source -- they are YAML and Markdown. They must not be in `src/`.
**Why:** YAML and Markdown files are runtime data, not compiled TypeScript. Keeping them outside `src/` avoids TypeScript compilation issues and makes the distinction clear: code goes in `src/`, data goes in `definitions/`.
**Runtime path resolution:**
```typescript
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// From any file in src/framework/
const __dirname = dirname(fileURLToPath(import.meta.url));
// Navigate up from src/framework/ to packages/agents/, then into definitions/
const definitionsDir = join(__dirname, "..", "..", "..", "definitions");
// Or pass as a configuration option (better for testing):
const definitionsDir = options.definitionsDir;
```

**Docker consideration:** When the agents package is built and run in Docker, the definitions directory must be included. The Dockerfile COPY step must include `definitions/` alongside `dist/`. This is a Phase 44 (Single Service) concern, not Phase 38, but worth noting.

### Anti-Patterns to Avoid
- **Don't put YAML files in src/:** They are data, not TypeScript. TypeScript compiler will ignore them but they clutter the source tree and confuse the build.
- **Don't use file watchers (chokidar, fs.watch):** The spec explicitly says mtime-based invalidation. File watchers add complexity, platform-specific behavior, and event loop overhead for no benefit in this use case.
- **Don't template the system prompt:** The spec says "static string." No template interpolation, no dynamic assembly. The prompt.md file is the prompt. The caller builds the initial message.
- **Don't change tool displayNames sent to the LLM:** The namespace form (e.g., `linear:get_issue`) is for definition files and registry resolution only. The actual ToolDefinition.name property (e.g., `linear_get_issue`) sent to the Anthropic API stays unchanged. Colons are not valid in Anthropic tool names.
- **Don't make the ToolRegistry load definitions from disk:** The ToolRegistry receives factory functions registered by code at startup. It resolves string references to ToolDefinition objects. It does NOT read files. File reading is the AgentRegistry's job.
- **Don't add a `wait_for` tool in Phase 38:** The spec mentions `coordination:wait_for` in the agent definitions, but this tool does not exist yet (it will be built in Phase 40 - Conversation Executor). Phase 38 should register a placeholder or simply note it as unresolvable until Phase 40. The safest approach: register all tools that currently exist, and let Phase 40 add `coordination:wait_for` when implementing the conversation executor.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| YAML parsing | Custom tokenizer/parser | `yaml` npm package (v2.8.x) | Edge cases in YAML spec (multi-line strings, anchors, type coercion) are numerous. Library handles all of them. |
| Schema validation | Manual `if` checks on parsed object | Zod schema with `.parse()` | Zod gives typed output, detailed error messages, and is the codebase standard |
| File modification detection | Custom hash comparison, file watchers | `fs.stat().mtimeMs` | Simple, built-in, sufficient for the use case. Spec mandates this approach. |
| Tool name to factory mapping | Switch statements or if/else chains | `Map<string, ToolFactory>` | O(1) lookup, easy to register, easy to test |
| Path resolution | Hardcoded paths | `node:path.join()` with configurable base | Testable, portable, no magic strings |

**Key insight:** The registries are thin wrappers. The hard work (tool implementations, system prompts, agent loop) already exists. Phase 38 is a data extraction and lookup layer, not new functionality.

## Common Pitfalls

### Pitfall 1: YAML Type Coercion Surprises
**What goes wrong:** YAML parsers coerce values: `true`/`false` become booleans, `1.0` becomes number, `null` stays null. An agent version `"1"` without quotes could become integer `1`.
**Why it happens:** YAML spec includes implicit type resolution. The `yaml` package respects YAML 1.2 which is stricter than 1.1, but numbers and booleans are still coerced.
**How to avoid:** Always quote version strings in YAML definitions. Zod schema should use `z.string()` for version (will reject numbers). Add a test that validates each shipped YAML file against the schema.
**Warning signs:** Zod validation fails on a definition that "looks correct" in the YAML file.

### Pitfall 2: Definitions Directory Not Found in Docker
**What goes wrong:** The registry cannot find definitions at runtime because the Docker build only copies `dist/` not `definitions/`.
**Why it happens:** The definitions directory is outside `src/` and outside the TypeScript compilation output. Docker COPY must include it explicitly.
**How to avoid:** This is Phase 44's concern (Single Service Dockerfile), but Phase 38 should make the definitions directory path configurable via options (not hardcoded). Use a default path for local development but allow override for Docker/testing.
**Warning signs:** "ENOENT: no such file or directory" errors at startup in Docker.

### Pitfall 3: exactOptionalPropertyTypes Violations
**What goes wrong:** TypeScript compilation fails because optional properties are assigned `undefined` directly (e.g., `temperature: parsed.temperature ?? undefined`).
**Why it happens:** The codebase has `exactOptionalPropertyTypes: true` in tsconfig. Optional properties cannot be explicitly set to `undefined` -- they must be conditionally set using mutable-then-conditional-set.
**How to avoid:** Follow the established codebase pattern:
```typescript
const definition: Partial<AgentDefinition> = { ...required };
if (parsed.temperature !== undefined) {
  definition.temperature = parsed.temperature;
}
```
**Warning signs:** TypeScript error: "Type 'undefined' is not assignable to type 'number'" on optional fields.

### Pitfall 4: MCP Tool Factories Require Different Deps Than Codebase Tools
**What goes wrong:** Registering all tools with the same factory signature fails because MCP tools need `McpToolDeps` (agentId, correlationId) while codebase tools need `CodebaseToolDeps` (containerManager, taskId, logger).
**Why it happens:** The spec's `ToolContext` is a superset: it has all fields. Each factory takes what it needs. But the existing factory functions have different signatures.
**How to avoid:** The `ToolContext` interface includes all possible fields. Some are optional (containerManager is only needed for codebase tools). Each factory function extracts what it needs from the full context. The ToolRegistry passes the full context; factories pick their fields. This requires adapter wrappers around existing factory functions:
```typescript
// Adapter for existing codebase tool factory
toolRegistry.register("codebase:read_file", (ctx) => {
  return createReadFileTool({
    containerManager: ctx.containerManager!,
    taskId: ctx.taskId!,
    logger: ctx.logger,
  });
});
// Adapter for existing MCP tool factory
toolRegistry.register("linear:get_issue", (ctx) => {
  const allLinear = createLinearTools({ agentId: ctx.agentId, correlationId: ctx.correlationId });
  return allLinear.find(t => t.name === "linear_get_issue")!;
});
```
**Better approach:** Register individual MCP tools directly instead of creating-and-filtering arrays:
```typescript
toolRegistry.register("linear:get_issue", (ctx) => {
  return createMcpToolWrapper(
    { integration: "linear", toolName: "get_issue", displayName: "linear_get_issue", description: "...", inputSchema: getIssueSchema },
    { agentId: ctx.agentId, correlationId: ctx.correlationId },
  );
});
```
This eliminates the create-all-then-filter pattern that wastes work. However, it duplicates tool config from the tool files. The pragmatic approach for Phase 38: use the create-and-find pattern with adapter wrappers. Refactoring the individual tool files to export single-tool factories can happen later.

**Warning signs:** TypeScript errors about missing required properties on ToolContext when some fields are undefined.

### Pitfall 5: spawn_agent Tool Depends on Sub-Agent Definitions
**What goes wrong:** The `spawn_agent` tool currently takes `AgentTypeConfig` (systemPrompt, tools, maxIterations, model) directly. In v2.3, sub-agents are referenced by ID. The spawn_agent factory needs the AgentRegistry and ToolRegistry to resolve sub-agents.
**Why it happens:** The current `createSpawnAgentTool` receives pre-built sub-agent configs. In v2.3, it needs to load them from the registry at spawn time.
**How to avoid:** Phase 38 should NOT modify `createSpawnAgentTool` yet. The existing tool works with pre-built configs. The ToolRegistry adapter for `coordination:spawn_agent` can build the sub-agent configs from the registry at resolution time (when the parent agent's tools are being resolved), not at spawn time. This means the adapter calls `agentRegistry.get(subAgentId)` and `toolRegistry.resolve(subAgentDef.tools, ctx)` to build the `AgentTypeConfig`, then passes it to the existing `createSpawnAgentTool`. This approach avoids modifying the existing tool implementation.
**Warning signs:** Circular dependency between AgentRegistry and ToolRegistry if spawn_agent tries to load definitions during tool execution.

### Pitfall 6: Prompt File Loading as UTF-8
**What goes wrong:** System prompt files contain characters that get corrupted if not read as UTF-8.
**Why it happens:** `readFile` without encoding returns a Buffer. Must specify `"utf-8"`.
**How to avoid:** Always use `await readFile(path, "utf-8")`. The existing system prompt constants use template literals in TypeScript which are inherently UTF-8.
**Warning signs:** Garbled characters in LLM responses, especially in XML-tagged prompt sections.

## Code Examples

Verified patterns from the codebase and spec:

### YAML Definition File (from spec Appendix B.2)
```yaml
# packages/agents/definitions/dev-agent/definition.yaml
id: dev-agent
name: Development Agent
description: >
  Autonomous development agent that resolves Linear issues through
  codebase research, planning, implementation via sub-agents, testing,
  and pull request creation.
version: "1"

model: claude-sonnet-4-20250514
temperature: 0

tools:
  - codebase:read_file
  - codebase:search_codebase
  - codebase:list_directory
  - coordination:spawn_agent
  - coordination:request_human_input
  - coordination:wait_for
  - linear:get_issue
  - linear:update_issue_status
  - github:create_branch
  - github:create_commit
  - github:create_pull_request
  - github:get_pull_request
  - slack:send_message
  - slack:send_approval_request

subAgents:
  researcher: researcher
  coder: coder
  tester: tester

maxIterations: 100
tokenBudget: 500000

history:
  pruneThreshold: 80000
  protectedMessages: 20
  summaryThreshold: 120000
  summaryModel: claude-haiku-4-5-20251001

triggers:
  - event: linear.agent_session.created
```

### AgentDefinition Zod Schema
```typescript
// Source: v2.3 spec Section 1
import { z } from "zod";

// Tool reference format: namespace:tool_name (e.g., "linear:get_issue")
const toolRefSchema = z.string().regex(
  /^[a-z]+:[a-z_]+$/,
  "Tool reference must be namespace:tool_name (e.g., 'linear:get_issue')"
);

export const AgentDefinitionYamlSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  version: z.string().min(1),  // Must be string, not number

  model: z.string().min(1),
  temperature: z.number().min(0).max(2).optional(),

  tools: z.array(toolRefSchema).min(1),

  subAgents: z.record(z.string(), z.string()).optional(),

  maxIterations: z.number().int().positive(),
  tokenBudget: z.number().int().min(0),

  history: z.object({
    pruneThreshold: z.number().int().positive(),
    protectedMessages: z.number().int().positive(),
    summaryThreshold: z.number().int().positive(),
    summaryModel: z.string().min(1),
  }),

  triggers: z.array(z.object({
    event: z.string().min(1),
  })).optional(),
});

export type AgentDefinitionYaml = z.infer<typeof AgentDefinitionYamlSchema>;

/** Full agent definition with system prompt loaded from prompt.md */
export interface AgentDefinition extends AgentDefinitionYaml {
  /** System prompt loaded from prompt.md file */
  systemPrompt: string;
}
```

### ToolRegistry Factory Registration (all tools)
```typescript
// Source: Derived from existing tool factories in shared/tools/
import { createReadFileTool, createWriteFileTool, createSearchCodebaseTool,
  createListDirectoryTool, createRunCommandTool } from "../shared/tools/codebase/index.js";
import { createMcpToolWrapper } from "../shared/tools/integration/mcp-wrapper.js";
import { createSpawnAgentTool, createRequestHumanInputTool } from "../shared/tools/coordination/index.js";

export function registerAllTools(registry: ToolRegistry): void {
  // Codebase tools -- need containerManager, taskId, logger
  registry.register("codebase:read_file", (ctx) =>
    createReadFileTool({ containerManager: ctx.containerManager!, taskId: ctx.taskId!, logger: ctx.logger }));
  registry.register("codebase:write_file", (ctx) =>
    createWriteFileTool({ containerManager: ctx.containerManager!, taskId: ctx.taskId!, logger: ctx.logger }));
  registry.register("codebase:search_codebase", (ctx) =>
    createSearchCodebaseTool({ containerManager: ctx.containerManager!, taskId: ctx.taskId!, logger: ctx.logger }));
  registry.register("codebase:list_directory", (ctx) =>
    createListDirectoryTool({ containerManager: ctx.containerManager!, taskId: ctx.taskId!, logger: ctx.logger }));
  registry.register("codebase:run_command", (ctx) =>
    createRunCommandTool({ containerManager: ctx.containerManager!, taskId: ctx.taskId!, logger: ctx.logger }));

  // Linear MCP tools -- need agentId, correlationId
  // Register each individually via createMcpToolWrapper (avoids create-all-then-filter)
  registry.register("linear:get_issue", (ctx) =>
    createMcpToolWrapper(
      { integration: "linear", toolName: "get_issue", displayName: "linear_get_issue",
        description: "...", inputSchema: getIssueSchema },
      { agentId: ctx.agentId, correlationId: ctx.correlationId }));
  // ... same pattern for all linear, github, slack tools

  // Coordination tools -- special: spawn_agent needs sub-agent resolution
  registry.register("coordination:request_human_input", () =>
    createRequestHumanInputTool());
  // coordination:spawn_agent registered with adapter that resolves sub-agents
  // coordination:wait_for deferred to Phase 40
}
```

### Testing Pattern: AgentRegistry with Temp Directory
```typescript
// Source: Existing vitest patterns in codebase
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("AgentRegistry", () => {
  let defDir: string;

  beforeEach(async () => {
    defDir = await mkdtemp(join(tmpdir(), "agent-defs-"));
    // Create test definition
    await mkdir(join(defDir, "test-agent"));
    await writeFile(join(defDir, "test-agent", "definition.yaml"), `
id: test-agent
name: Test Agent
description: A test agent
version: "1"
model: claude-sonnet-4-20250514
tools:
  - codebase:read_file
maxIterations: 10
tokenBudget: 50000
history:
  pruneThreshold: 30000
  protectedMessages: 10
  summaryThreshold: 50000
  summaryModel: claude-haiku-4-5-20251001
`);
    await writeFile(join(defDir, "test-agent", "prompt.md"), "You are a test agent.");
  });

  afterEach(async () => {
    await rm(defDir, { recursive: true });
  });

  it("should load a definition from disk", async () => {
    const registry = createAgentRegistry({ definitionsDir: defDir, logger: mockLogger });
    const def = await registry.get("test-agent");
    expect(def).not.toBeNull();
    expect(def!.id).toBe("test-agent");
    expect(def!.systemPrompt).toBe("You are a test agent.");
    expect(def!.tools).toEqual(["codebase:read_file"]);
  });

  it("should return cached definition on second call", async () => {
    const registry = createAgentRegistry({ definitionsDir: defDir, logger: mockLogger });
    const def1 = await registry.get("test-agent");
    const def2 = await registry.get("test-agent");
    expect(def1).toBe(def2); // Same reference (cached)
  });

  it("should invalidate cache when file mtime changes", async () => {
    const registry = createAgentRegistry({ definitionsDir: defDir, logger: mockLogger });
    await registry.get("test-agent");

    // Modify file
    await writeFile(join(defDir, "test-agent", "definition.yaml"),
      /* ... updated yaml with version: "2" ... */);

    const def = await registry.get("test-agent");
    expect(def!.version).toBe("2");
  });
});
```

## State of the Art

| Old Approach (v2.2) | Current Approach (v2.3 Phase 38) | When Changed | Impact |
|---|---|---|---|
| `ORCHESTRATOR_SYSTEM_PROMPT` constant in system-prompts.ts | `prompt.md` file in definitions/ | v2.3 | Prompt editable without recompilation |
| `createOrchestratorToolkit()` with hardcoded tool selection | `tools: ["linear:get_issue", ...]` in definition.yaml | v2.3 | Tool selection is data, not code |
| `maxIterations ?? 100` in orchestrator.ts | `maxIterations: 100` in definition.yaml | v2.3 | All config in one place per agent |
| `subAgentConfigs` hardcoded in toolkits.ts | `subAgents: { researcher: "researcher" }` reference | v2.3 | Sub-agents reusable and independently versionable |
| Per-agent toolkit factory functions | `ToolRegistry.resolve(definition.tools, ctx)` | v2.3 | One generic resolver replaces N factory functions |
| `"linear_get_issue"` displayName convention | `linear:get_issue` namespace convention | v2.3 | Formalizes the implicit namespace in tool naming |

**Deprecated/outdated (replaced by this phase):**
- `createOrchestratorToolkit()` in toolkits.ts -- replaced by ToolRegistry.resolve()
- `createProductAgentToolkit()` in toolkits.ts -- replaced by ToolRegistry.resolve()
- `createResearcherToolkit()` in toolkits.ts -- replaced by ToolRegistry.resolve()
- `createCoderToolkit()` in toolkits.ts -- replaced by ToolRegistry.resolve()
- `createTesterToolkit()` in toolkits.ts -- replaced by ToolRegistry.resolve()
- `ORCHESTRATOR_SYSTEM_PROMPT` in system-prompts.ts -- moved to prompt.md
- `PRODUCT_AGENT_SYSTEM_PROMPT` in system-prompts.ts -- moved to prompt.md
- `RESEARCHER_SYSTEM_PROMPT`, `CODER_SYSTEM_PROMPT`, `TESTER_SYSTEM_PROMPT` -- moved to prompt.md files

**Important:** Do NOT delete the old code in Phase 38. The old orchestrator entry points (`runDevAgentOrchestrator`, `runProductAgent`) are still used by Temporal activities until Phase 44 (Single Service) consolidates everything. Phase 38 creates the NEW infrastructure alongside the old. Phase 47 (Cleanup) removes the old code.

## Open Questions

Things that couldn't be fully resolved:

1. **coordination:wait_for tool does not exist yet**
   - What we know: The spec's agent definitions reference `coordination:wait_for` in the tools list. This tool is built in Phase 40 (Conversation Executor).
   - What's unclear: Should Phase 38 register a placeholder factory that throws "not implemented yet"? Or should the tool references in definitions include it but the ToolRegistry skip unresolvable refs?
   - Recommendation: Include `coordination:wait_for` in the YAML definitions (to match the spec). Register a placeholder factory in the ToolRegistry that throws a clear error if called. Phase 40 will replace it with the real implementation. This keeps definitions accurate while preventing silent failures.

2. **How does spawn_agent get sub-agent definitions from the registry?**
   - What we know: The current `createSpawnAgentTool` takes `AgentTypeConfig` directly. In v2.3, sub-agents are `AgentDefinition` objects loaded from the registry.
   - What's unclear: The `coordination:spawn_agent` factory needs access to both the AgentRegistry and ToolRegistry to resolve sub-agents. This creates a question about the factory registration order.
   - Recommendation: The spawn_agent factory closure captures the AgentRegistry and ToolRegistry references. At registration time (startup), both registries exist. The factory resolves sub-agents lazily (at invocation time, when spawn_agent is called by the LLM), not at registration time. This avoids ordering issues.

3. **Should ArtifactExtractionConfig come from ToolRegistry in this phase?**
   - What we know: Phase 37's SessionProjection receives `ArtifactExtractionConfig` as a parameter (a `Map<string, ArtifactExtractor>`). The spec says "tool registry maps tools to artifact keys."
   - What's unclear: Should the ToolRegistry in Phase 38 manage artifact config, or is that deferred?
   - Recommendation: Phase 38 ToolRegistry should support an optional `artifactConfig` field per tool registration. When resolving tools, the registry can also return the artifact config. This is a natural extension. However, the existing `createMcpToolWrapper` and codebase tool factories do not have artifact config. Keep it optional -- tools that produce artifacts declare it at registration; others don't. SessionProjection can query the ToolRegistry for the aggregate artifact config.

4. **How are integration tool input schemas and descriptions co-located?**
   - What we know: Currently, each integration tool has its Zod schema and description defined inline in the tool factory file (e.g., `linear-tools.ts`). The ToolRegistry needs access to these at registration time.
   - What's unclear: Should we extract schemas to a shared location, or keep them in the existing files and import them?
   - Recommendation: Keep schemas in existing files. Import them from the tool factory modules. No structural changes needed -- the existing `createMcpToolWrapper` config objects can be extracted as constants and imported.

## Sources

### Primary (HIGH confidence)
- Existing codebase: `packages/agents/src/shared/tools/toolkits.ts` -- Current toolkit factory pattern, tool counts, and per-agent tool selection
- Existing codebase: `packages/agents/src/dev-agent/orchestrator/orchestrator.ts` -- Current dev-agent configuration (model, iterations, token budget)
- Existing codebase: `packages/agents/src/product-agent/orchestrator/orchestrator.ts` -- Current product-agent configuration
- Existing codebase: `packages/agents/src/dev-agent/orchestrator/system-prompts.ts` -- All 4 system prompts (orchestrator, researcher, coder, tester)
- Existing codebase: `packages/agents/src/product-agent/orchestrator/system-prompts.ts` -- Product agent system prompt
- Existing codebase: `packages/agents/src/shared/tools/integration/*.ts` -- All tool displayNames and MCP configs
- Existing codebase: `packages/agents/src/shared/tools/codebase/*.ts` -- All codebase tool factories
- Existing codebase: `packages/agents/src/shared/tools/coordination/*.ts` -- spawn_agent, request_human_input
- Existing codebase: `packages/agents/src/framework/types.ts` -- Phase 37 framework types including ArtifactExtractionConfig
- v2.3 spec: `2.3-spec.md` Section 1 (Agent Definition), Section 5 (Agent Registry + Single Service), Appendix B.2 (Concrete Agent Definition Example)

### Secondary (MEDIUM confidence)
- WebSearch: `yaml` npm package v2.8.2, built-in TypeScript types, zero dependencies -- verified via [GitHub repo](https://github.com/eemeli/yaml)
- v2.3 spec: `2.3-spec.md` Acceptance Criteria Topics 1 and 5

### Tertiary (LOW confidence)
- None -- all findings verified against existing codebase and spec

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- only new dependency is `yaml` npm package, everything else is existing codebase libraries
- Architecture: HIGH -- spec provides explicit interfaces, codebase provides all existing patterns, this is mechanical extraction
- Pitfalls: HIGH -- based on direct code analysis of existing tool factories, TypeScript config, and runtime constraints
- Tool mapping: HIGH -- complete mapping extracted from actual source code (displayName values in tool factory files)

**Research date:** 2026-02-01
**Valid until:** 60 days (stack is stable, spec is locked, only risk is yaml package major version bump)
