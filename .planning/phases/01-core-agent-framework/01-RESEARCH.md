# Phase 1: Core Agent Framework - Research

**Researched:** 2026-01-16
**Domain:** LangGraph.js Agent Orchestration with Safety Guardrails
**Confidence:** HIGH

<research_summary>
## Summary

Researched the LangGraph.js ecosystem for building a single code-generation agent with safety guardrails. LangGraph.js 1.1.0 (released January 2026) is a production-ready, low-level orchestration framework used by Replit, Uber, LinkedIn, and GitLab. It provides the foundational primitives for agent execution with built-in iteration limits, state persistence, and observability.

Key finding: LangGraph has built-in recursion limits (default: 25 super-steps) that serve as the primary loop guard mechanism. Timeouts are handled at the LLM/tool level rather than the graph level. For production use, combine recursion limits with explicit loop counters in state and LangSmith for observability.

**Primary recommendation:** Use LangGraph.js 1.1.0 with `createReactAgent` prebuilt, PostgresSaver checkpointer for production persistence, Zod for type-safe state schemas, and LangSmith for observability. Implement both recursion limits AND explicit loop counters in state for defense-in-depth.
</research_summary>

<standard_stack>
## Standard Stack

The established libraries/tools for agent development with LangGraph.js:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @langchain/langgraph | 1.1.0 | Agent orchestration framework | Production-proven at Uber, LinkedIn, GitLab; GA since Oct 2025 |
| @langchain/core | latest | LangChain primitives (tools, messages) | Required dependency for LangGraph.js |
| @langchain/anthropic | latest | Claude integration | Primary LLM provider (Claude 3.5 Sonnet recommended) |
| zod | 3.25.x | Schema validation and type inference | TypeScript type safety for state and tools |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @langchain/langgraph-checkpoint | 1.0.x | Base checkpointer interface | Always (included with langgraph) |
| @langchain/langgraph-checkpoint-postgres | latest | Production checkpointer | Production deployments |
| @langchain/langgraph-checkpoint-sqlite | latest | Local development checkpointer | Development/testing |
| @langchain/openai | latest | OpenAI integration | If using GPT-4 as alternative LLM |
| dotenv | latest | Environment configuration | API key management |

### Observability
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| langsmith | latest | Tracing and observability | Always in production |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| LangGraph.js | AWS Strands Agents | Strands is newer (Dec 2025), tighter Bedrock integration, less mature than LangGraph |
| LangGraph.js | CrewAI | CrewAI is Python-only, higher-level abstractions |
| PostgresSaver | MemorySaver | MemorySaver is in-memory only, loses state on restart |
| Zod schemas | Annotation API | Annotation is LangGraph-specific; Zod is standard TS validation |

**Installation:**
```bash
npm install @langchain/langgraph @langchain/core @langchain/anthropic zod dotenv
npm install @langchain/langgraph-checkpoint-postgres  # For production
npm install langsmith  # For observability
```
</standard_stack>

<architecture_patterns>
## Architecture Patterns

### Recommended Project Structure
```
src/
├── agents/
│   ├── dev-agent.ts         # Agent definition and graph
│   └── tools/               # Agent tools
│       ├── code-gen.ts
│       └── file-ops.ts
├── config/
│   └── agent-config.ts      # Agent configuration schema
├── state/
│   └── agent-state.ts       # State schema with Zod
├── checkpointers/
│   └── postgres.ts          # Production checkpointer setup
└── index.ts                 # Entry point
```

### Pattern 1: ReAct Agent with createReactAgent
**What:** Use prebuilt ReAct agent for straightforward tool-calling agents
**When to use:** Single agent with defined tools, standard ReAct loop
**Example:**
```typescript
// Source: LangGraph.js official docs
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatAnthropic } from "@langchain/anthropic";
import { MemorySaver } from "@langchain/langgraph";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

const llm = new ChatAnthropic({
  model: "claude-3-5-sonnet-20241022",
  temperature: 0
});

const codeGenTool = tool(
  async ({ description }) => {
    // Implementation
    return "generated code";
  },
  {
    name: "generate_code",
    description: "Generate code based on a task description",
    schema: z.object({
      description: z.string().describe("The task description"),
    }),
  }
);

const checkpointer = new MemorySaver(); // Use PostgresSaver in production

const agent = createReactAgent({
  llm,
  tools: [codeGenTool],
  checkpointSaver: checkpointer,
});
```

### Pattern 2: Custom StateGraph with Loop Counter
**What:** Extend state with explicit loop counter for defense-in-depth
**When to use:** When you need additional loop protection beyond recursion limits
**Example:**
```typescript
// Source: Community pattern verified against LangGraph docs
import { Annotation, StateGraph, END } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";

const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),
  loopCount: Annotation<number>({
    reducer: (_, y) => y,
    default: () => 0,
  }),
});

const MAX_ITERATIONS = 10;

function shouldContinue(state: typeof AgentState.State) {
  if (state.loopCount >= MAX_ITERATIONS) {
    console.log(`Loop limit reached: ${state.loopCount}`);
    return END;
  }
  // Check for tool calls...
  return "tools";
}
```

### Pattern 3: Recursion Limit Configuration
**What:** Set explicit recursion limits when invoking the graph
**When to use:** Always - provides hard stop for runaway agents
**Example:**
```typescript
// Source: LangGraph.js official docs
import { GraphRecursionError } from "@langchain/langgraph";

try {
  const result = await agent.invoke(
    { messages: [{ role: "user", content: taskDescription }] },
    {
      configurable: { thread_id: "unique-thread-id" },
      recursionLimit: 25  // NOT inside configurable - standalone key
    }
  );
} catch (error) {
  if (error instanceof GraphRecursionError) {
    console.log("Agent hit recursion limit - stopping execution");
    // Handle gracefully
  } else {
    throw error;
  }
}
```

### Pattern 4: Agent Configuration via langgraph.json
**What:** Define agent configuration in code/config files
**When to use:** For deployments and LangGraph Studio
**Example:**
```json
{
  "node_version": "18",
  "graphs": {
    "dev_agent": "./src/agents/dev-agent.ts:agent"
  },
  "env": ".env",
  "dependencies": ["."]
}
```

### Pattern 5: LangSmith Tracing Integration
**What:** Enable observability with minimal configuration
**When to use:** Always in production
**Example:**
```bash
# .env file
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=<your-api-key>
LANGSMITH_PROJECT=aesir-agents
```

### Anti-Patterns to Avoid
- **Using `.withConfig()` for recursionLimit:** Bug where recursionLimit is ignored when using `.withConfig()`. Always pass recursionLimit directly to `.invoke()` or `.stream()`.
- **In-memory checkpointer in production:** MemorySaver loses state on restart. Use PostgresSaver for production.
- **No explicit loop termination:** Relying only on recursion limits. Add explicit loop counters in state as defense-in-depth.
- **Zod 3.25.68+:** Known compatibility issues. Pin to `zod@3.25.67` or carefully test newer versions.
- **Try/catch around interrupt():** The interrupt function throws GraphInterrupt. Don't swallow it in try/catch blocks.
</architecture_patterns>

<dont_hand_roll>
## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Agent execution loop | Custom while loop with LLM calls | `createReactAgent` or `StateGraph` | Proper state management, checkpointing, streaming |
| State persistence | Custom database logic | LangGraph checkpointers | Handles threading, fault tolerance, resume |
| Iteration limits | Manual counters only | `recursionLimit` config + state counters | Built-in error handling, composable with checkpoints |
| Tool definition | Ad-hoc function calls | `@langchain/core/tools` with Zod | Type safety, schema validation, proper LLM binding |
| Observability | Custom logging | LangSmith integration | Automatic tracing, debugging, cost tracking |
| Thread management | Custom session IDs | LangGraph thread_id in configurable | Proper state isolation, checkpoint management |

**Key insight:** LangGraph.js provides the low-level primitives for agent orchestration. Building a custom execution loop loses checkpointing, streaming, human-in-the-loop support, and observability integration. Even for simple agents, the framework overhead is minimal and the benefits are substantial.
</dont_hand_roll>

<common_pitfalls>
## Common Pitfalls

### Pitfall 1: Recursion Limit Ignored with .withConfig()
**What goes wrong:** Setting recursionLimit via `.withConfig({ recursionLimit: 256 })` is silently ignored
**Why it happens:** Known bug in LangGraph.js - recursionLimit must be passed directly to invoke/stream
**How to avoid:** Always pass recursionLimit as a direct parameter to `.invoke()` or `.stream()`, not in configurable or withConfig
**Warning signs:** Agent runs longer than expected despite setting a limit

### Pitfall 2: Step Timeout Not Working
**What goes wrong:** Setting `stepTimeout` doesn't prevent long-running nodes from timing out at 300s
**Why it happens:** Platform-level timeouts override graph-level configuration
**How to avoid:** Handle timeouts at the LLM/tool level with `.with_retry()` and explicit timeout configuration on the model
**Warning signs:** Workflow aborted at exactly 300 seconds despite timeout configuration

### Pitfall 3: Zod Version Compatibility
**What goes wrong:** "Type instantiation is excessively deep" errors or Zod schema failures
**Why it happens:** LangGraph.js has specific Zod version compatibility requirements
**How to avoid:** Pin to `zod@3.25.67` or test carefully with newer versions. Don't use Zod 3.25.68+ without testing.
**Warning signs:** TypeScript compilation errors mentioning "excessively deep", runtime errors with schema validation

### Pitfall 4: Lost State on Restart (MemorySaver)
**What goes wrong:** Agent loses all conversation history and state after server restart
**Why it happens:** MemorySaver is in-memory only, not persisted to disk
**How to avoid:** Use PostgresSaver or SqliteSaver for any environment where state should survive restarts
**Warning signs:** Agents "forget" everything when server restarts, threads start fresh unexpectedly

### Pitfall 5: Infinite Loops Between Nodes
**What goes wrong:** Agent gets stuck cycling between nodes indefinitely
**Why it happens:** Conditional edges that don't route to END node under all termination conditions
**How to avoid:** Always include explicit termination conditions in conditional edges, use loop counters in state
**Warning signs:** Context/token costs spiraling, agent not completing, hitting recursion limits frequently

### Pitfall 6: Context Explosion
**What goes wrong:** Token costs spiral, agents slow down dramatically
**Why it happens:** Full message history passed without summarization or pruning
**How to avoid:** Implement message trimming, use state reducers that limit history, summarize at checkpoints
**Warning signs:** Increasing latency per step, growing token costs, eventual context limit errors
</common_pitfalls>

<code_examples>
## Code Examples

Verified patterns from official sources:

### Basic ReAct Agent Setup
```typescript
// Source: LangGraph.js README + official docs
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatAnthropic } from "@langchain/anthropic";
import { MemorySaver } from "@langchain/langgraph";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

// Define tools with Zod schemas
const generateCode = tool(
  async ({ taskDescription, language }) => {
    // Tool implementation here
    return `// Generated ${language} code for: ${taskDescription}`;
  },
  {
    name: "generate_code",
    description: "Generate code based on a task description",
    schema: z.object({
      taskDescription: z.string().describe("What the code should do"),
      language: z.string().describe("Programming language to use"),
    }),
  }
);

// Create the agent
const llm = new ChatAnthropic({
  model: "claude-3-5-sonnet-20241022",
  temperature: 0,
});

const checkpointer = new MemorySaver();

const agent = createReactAgent({
  llm,
  tools: [generateCode],
  checkpointSaver: checkpointer,
});

// Invoke with recursion limit
const result = await agent.invoke(
  {
    messages: [{ role: "user", content: "Generate a TypeScript function to calculate factorial" }],
  },
  {
    configurable: { thread_id: "task-123" },
    recursionLimit: 15, // Direct param, not inside configurable
  }
);
```

### State Schema with Loop Counter
```typescript
// Source: LangGraph.js concepts + community patterns
import { Annotation, StateGraph, END } from "@langchain/langgraph";
import { BaseMessage, HumanMessage, AIMessage } from "@langchain/core/messages";

// Define state with explicit loop tracking
const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),
  loopCount: Annotation<number>({
    reducer: (_, y) => y,
    default: () => 0,
  }),
  status: Annotation<"running" | "completed" | "error">({
    reducer: (_, y) => y,
    default: () => "running",
  }),
});

type AgentStateType = typeof AgentState.State;

const MAX_ITERATIONS = 10;

// Conditional edge with loop guard
function routeAgent(state: AgentStateType): "tools" | "end" {
  if (state.loopCount >= MAX_ITERATIONS) {
    console.log(`Iteration limit reached: ${state.loopCount}`);
    return "end";
  }

  const lastMessage = state.messages[state.messages.length - 1];
  if (lastMessage instanceof AIMessage && lastMessage.tool_calls?.length) {
    return "tools";
  }

  return "end";
}
```

### PostgresSaver for Production
```typescript
// Source: LangGraph.js checkpoint-postgres docs
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

const checkpointer = PostgresSaver.fromConnString(
  process.env.POSTGRES_CONNECTION_STRING!
);

// Use with agent
const agent = createReactAgent({
  llm,
  tools,
  checkpointSaver: checkpointer,
});
```

### Catching Recursion Errors
```typescript
// Source: LangGraph.js how-tos
import { GraphRecursionError } from "@langchain/langgraph";

async function runAgentSafely(input: string, threadId: string) {
  try {
    const result = await agent.invoke(
      { messages: [{ role: "user", content: input }] },
      {
        configurable: { thread_id: threadId },
        recursionLimit: 25,
      }
    );
    return { success: true, result };
  } catch (error) {
    if (error instanceof GraphRecursionError) {
      return {
        success: false,
        error: "Agent exceeded iteration limit",
        partialResult: error.message,
      };
    }
    throw error;
  }
}
```
</code_examples>

<sota_updates>
## State of the Art (2025-2026)

What's changed recently:

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| langgraph.prebuilt module | langchain.agents module | LangGraph 1.0 (Oct 2025) | Update imports from prebuilt agents |
| Manual checkpointing | Built-in persistence layer | LangGraph 1.0 | Automatic state persistence |
| Custom streaming | First-class streaming support | LangGraph 1.0 | Token-level and step-level streaming built-in |
| Manual human-in-the-loop | `interrupt` function | Late 2025 | Simplified HITL with built-in interrupt primitive |

**New tools/patterns to consider:**
- **Command primitive (2025):** Allows nodes to dynamically decide which node to execute next, enabling edgeless agent flows
- **Node Caching (June 2025):** Skip redundant computation for faster runs
- **Deferred Nodes (June 2025):** Delay execution until all upstream paths complete - useful for map-reduce patterns
- **Pre/Post Model Hooks (June 2025):** Add custom logic before/after model calls
- **Built-in Provider Tools:** Web search and RemoteMCP support built into the framework

**Deprecated/outdated:**
- **langgraph.prebuilt:** Now deprecated, moved to langchain.agents
- **Manual state management:** Use Annotation API or Zod schemas instead of raw state objects
- **0.x API patterns:** Documentation for pre-1.0 patterns being removed
</sota_updates>

<open_questions>
## Open Questions

Things that couldn't be fully resolved:

1. **Step-level timeout configuration**
   - What we know: Platform has 300s default timeout, stepTimeout config doesn't always work
   - What's unclear: Reliable way to set per-node timeouts in LangGraph.js
   - Recommendation: Handle timeouts at LLM/tool level with `.with_retry()` and model-level timeout config. Monitor and adjust based on observed behavior.

2. **Zod 4.x compatibility**
   - What we know: Issues reported with Zod 3.25.68+, Zod 4.x has different patterns
   - What's unclear: Current recommended Zod version for LangGraph.js 1.1.0
   - Recommendation: Start with `zod@3.25.67`, test carefully before upgrading. Watch GitHub issues for official guidance.

3. **Token cost attribution per agent**
   - What we know: LangSmith tracks overall costs, traces are available
   - What's unclear: Per-agent or per-task cost rollups out of the box
   - Recommendation: Use LangSmith project segmentation and trace metadata to track costs by agent/task.
</open_questions>

<sources>
## Sources

### Primary (HIGH confidence)
- [LangGraph.js GitHub](https://github.com/langchain-ai/langgraphjs) - Version 1.1.0 confirmation, installation, features
- [LangGraph Overview Docs](https://docs.langchain.com/oss/javascript/langgraph/overview) - Architecture, concepts, capabilities
- [LangGraph.js How-to: Recursion Limit](https://langchain-ai.github.io/langgraphjs/how-tos/recursion-limit/) - Loop control patterns
- [LangGraph Persistence Docs](https://docs.langchain.com/oss/javascript/langgraph/persistence) - Checkpointing, threads, state
- [LangSmith Observability](https://www.langchain.com/langsmith/observability) - Tracing integration
- [LangGraph 1.0 Announcement](https://www.blog.langchain.com/langchain-langgraph-1dot0/) - GA release, key features

### Secondary (MEDIUM confidence)
- [LangGraph.js Recursion Limit Issue #1524](https://github.com/langchain-ai/langgraphjs/issues/1524) - withConfig bug confirmation
- [LangGraph.js Step Timeout Issue #1373](https://github.com/langchain-ai/langgraphjs/issues/1373) - Timeout behavior documentation
- [LangGraph.js Zod Issues](https://github.com/langchain-ai/langgraphjs/issues/1453) - Version compatibility
- [LangChain Changelog](https://changelog.langchain.com/) - Recent feature updates

### Tertiary (LOW confidence - needs validation)
- Community patterns for loop counters in state - verified against docs but not official
- Token cost attribution patterns - inferred from LangSmith docs, not explicitly documented
</sources>

<metadata>
## Metadata

**Research scope:**
- Core technology: LangGraph.js 1.1.0 (agent orchestration)
- Ecosystem: LangChain core, Anthropic/OpenAI integrations, Zod, LangSmith
- Patterns: ReAct agents, state management, checkpointing, loop guards
- Pitfalls: Recursion limit bugs, timeout issues, state persistence, Zod compatibility

**Confidence breakdown:**
- Standard stack: HIGH - verified with official docs, GitHub releases, npm
- Architecture: HIGH - from official examples and docs
- Pitfalls: HIGH - from GitHub issues, verified patterns
- Code examples: HIGH - from official sources, adapted for Aesir context

**Research date:** 2026-01-16
**Valid until:** 2026-02-16 (30 days - LangGraph ecosystem active but stable post-1.0)
</metadata>

---

*Phase: 01-core-agent-framework*
*Research completed: 2026-01-16*
*Ready for planning: yes*
