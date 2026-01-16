# Phase 6: Observability - Research

**Researched:** 2026-01-16
**Domain:** Structured logging and LangGraph tracing for workflow observability
**Confidence:** HIGH

<research_summary>
## Summary

Researched observability patterns for LangGraph workflows with focus on debug-oriented tracing (query by task ID). The domain is well-understood — structured logging is commodity — but LangGraph-specific callback integration needed verification.

Key finding: We already have a solid Logger foundation from Phase 1 with taskId support and JSON output. The main work is creating a LangGraph callback handler that pipes events to our logger, plus a TraceStore for queryability.

**Primary recommendation:** Extend existing Logger with a TraceStore (in-memory + optional file persistence) and create a LangGraphTracer callback handler. Avoid external services (LangSmith, Langfuse) for MVP — they add complexity without matching the simple "query by task ID" requirement.

</research_summary>

<standard_stack>
## Standard Stack

### Core (Already Have)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Logger (internal) | Phase 1 | Structured JSON logging | Already built, has taskId support |
| @langchain/core | ^0.3.x | Provides BaseCallbackHandler | LangGraph dependency, already installed |

### Supporting (To Add)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| None required | - | - | MVP uses in-memory + file storage |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom TraceStore | LangSmith | LangSmith is hosted service, adds external dependency, overkill for "grep by task ID" |
| Custom TraceStore | Langfuse | Open source but requires deployment, more infrastructure |
| Custom TraceStore | SQLite | Good for persistence, but in-memory Map + JSON files is simpler for MVP |

**Decision:** Build minimal custom solution. Our Logger already outputs JSON — we just need to collect and index it by task ID.

</standard_stack>

<architecture_patterns>
## Architecture Patterns

### Recommended Structure
```
src/
├── logging/
│   ├── logger.ts          # Existing - structured JSON logger
│   ├── trace-store.ts     # NEW - stores traces by task ID
│   └── index.ts           # Export both
├── agents/
│   └── tracing/
│       ├── langgraph-tracer.ts  # NEW - callback handler for LangGraph
│       └── index.ts
```

### Pattern 1: Callback Handler → Logger → TraceStore
**What:** LangGraph events flow through callback handler to existing Logger, TraceStore indexes by taskId
**When to use:** Always — this is the core pattern
**Flow:**
```
LangGraph Event → LangGraphTracer.handleXxx() → Logger.info() → TraceStore.append()
                                                      ↓
                                                console (dev)
```

### Pattern 2: Child Logger with Task Context
**What:** Create child logger per workflow run with taskId baked in
**When to use:** At workflow start
**Example:**
```typescript
// Already supported by our Logger
const taskLogger = logger.child({ taskId: "TASK-123", workflowId: "run-456" });
// All subsequent logs automatically include taskId
taskLogger.info("node_start", { context: { node: "generate_code" } });
```

### Pattern 3: TraceStore with Query Interface
**What:** Simple Map-based store with getByTaskId, getByWorkflowId methods
**When to use:** For the "query by task ID" requirement
**Example:**
```typescript
interface TraceStore {
  append(entry: LogEntry): void;
  getByTaskId(taskId: string): LogEntry[];
  getByWorkflowId(workflowId: string): LogEntry[];
  exportToFile(taskId: string, path: string): void;
}
```

### Anti-Patterns to Avoid
- **Don't use LangSmith for MVP:** External dependency for a simple query use case
- **Don't log everything at debug level:** Use info for node transitions, debug for LLM details
- **Don't store raw prompts/responses in trace:** Store references or truncated versions for privacy

</architecture_patterns>

<dont_hand_roll>
## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| LangGraph event handling | Custom event listeners | BaseCallbackHandler | Standard interface, handles all event types |
| JSON structured logging | Custom JSON serialization | Existing Logger | Already built and tested in Phase 1 |
| Callback propagation | Manual threading | LangGraph's built-in callback passing | Callbacks automatically flow through invoke() |

**Key insight:** The infrastructure exists — BaseCallbackHandler provides the event interface, our Logger provides the output format. We're just connecting them with a thin adapter + storage layer.

</dont_hand_roll>

<common_pitfalls>
## Common Pitfalls

### Pitfall 1: Logging LLM Prompts/Responses Verbatim
**What goes wrong:** Traces become huge, contain sensitive data
**Why it happens:** Capturing "everything" without filtering
**How to avoid:** Log prompt/response lengths and hashes, not full content. Store full content only at debug level or in separate files.
**Warning signs:** Trace files > 1MB per task

### Pitfall 2: Missing Task ID Correlation
**What goes wrong:** Can't query logs for a specific task
**Why it happens:** Not passing taskId through callback config
**How to avoid:** Always create child logger with taskId before invoking workflow
**Warning signs:** Logs exist but taskId is undefined

### Pitfall 3: Callback Handler Exceptions Breaking Workflow
**What goes wrong:** Error in tracing crashes the workflow
**Why it happens:** Callback handlers throw unhandled exceptions
**How to avoid:** Wrap all callback handler methods in try/catch, log tracing errors but don't propagate
**Warning signs:** Workflow fails with tracing-related stack trace

### Pitfall 4: Blocking I/O in Callback Handlers
**What goes wrong:** Workflow slows down due to synchronous file writes
**Why it happens:** Writing to disk in each callback
**How to avoid:** Buffer in memory, write async on flush or workflow end
**Warning signs:** Workflow duration increases with tracing enabled

</common_pitfalls>

<code_examples>
## Code Examples

### Custom LangGraph Callback Handler
```typescript
// Source: Pattern from @langchain/core BaseCallbackHandler
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { Logger, LogEntry } from "../logging/logger.js";

export class LangGraphTracer extends BaseCallbackHandler {
  name = "LangGraphTracer";

  constructor(
    private logger: Logger,
    private store: TraceStore
  ) {
    super();
  }

  handleChainStart(chain: any, inputs: any, runId: string) {
    const entry = this.logger.info("chain_start", {
      context: { runId, chainType: chain.constructor.name },
      message: "Chain execution started"
    });
    this.store.append(entry);
  }

  handleChainEnd(outputs: any, runId: string) {
    this.logger.info("chain_end", {
      context: { runId },
      outcome: "success"
    });
  }

  handleToolStart(tool: any, input: string, runId: string) {
    this.logger.info("tool_start", {
      context: { runId, tool: tool.name, inputLength: input.length }
    });
  }

  handleLLMStart(llm: any, prompts: string[], runId: string) {
    this.logger.debug("llm_start", {
      context: { runId, model: llm.modelName, promptCount: prompts.length }
    });
  }

  handleLLMEnd(output: any, runId: string) {
    this.logger.debug("llm_end", {
      context: { runId, tokenUsage: output.llmOutput?.tokenUsage }
    });
  }
}
```

### TraceStore Interface
```typescript
// Simple in-memory store with task ID indexing
export class TraceStore {
  private byTaskId = new Map<string, LogEntry[]>();

  append(entry: LogEntry): void {
    const taskId = entry.context.taskId;
    if (!taskId) return;

    const entries = this.byTaskId.get(taskId) ?? [];
    entries.push(entry);
    this.byTaskId.set(taskId, entries);
  }

  getByTaskId(taskId: string): LogEntry[] {
    return this.byTaskId.get(taskId) ?? [];
  }

  clear(taskId: string): void {
    this.byTaskId.delete(taskId);
  }
}
```

### Wiring Into Workflow
```typescript
// At workflow invocation
const taskLogger = logger.child({ taskId: task.id });
const tracer = new LangGraphTracer(taskLogger, traceStore);

const result = await workflow.invoke(
  initialState,
  { callbacks: [tracer] }
);

// Later: query traces
const traces = traceStore.getByTaskId(task.id);
```

</code_examples>

<sota_updates>
## State of the Art (2025-2026)

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| LangChain Tracer | BaseCallbackHandler | Stable | Standard interface for all tracing |
| Custom event hooks | Callbacks propagate through invoke() | LangChain 0.1+ | Simpler wiring |

**New tools/patterns to consider:**
- **LangSmith Connect (July 2025):** Can now connect traces to server logs. Not needed for our MVP but shows direction.
- **OpenTelemetry integration:** Available via SigNoz, useful for production but overkill for debug tracing.

**Deprecated/outdated:**
- **LangChain v0.x callback patterns:** v1.0 (Oct 2025) has updated docs, but BaseCallbackHandler interface remains stable.

</sota_updates>

<open_questions>
## Open Questions

1. **File-based persistence format**
   - What we know: JSON Lines (one entry per line) is standard
   - What's unclear: Single file per task vs partitioned by date?
   - Recommendation: One file per task (matches query pattern), e.g., `.traces/{taskId}.jsonl`

2. **LLM content logging**
   - What we know: Full prompts/responses can be large and sensitive
   - What's unclear: How much detail is useful for debugging?
   - Recommendation: Log metadata (token counts, model) at info level, full content at debug level (off by default)

</open_questions>

<sources>
## Sources

### Primary (HIGH confidence)
- [LangChain.js BaseCallbackHandler API](https://v03.api.js.langchain.com/classes/_langchain_core.callbacks_base.BaseCallbackHandler.html) - callback interface
- Existing `src/logging/logger.ts` - our Logger implementation from Phase 1

### Secondary (MEDIUM confidence)
- [Langfuse LangChain Integration](https://langfuse.com/integrations/frameworks/langchain) - callback handler patterns
- [LangSmith Observability](https://www.langchain.com/langsmith/observability) - industry adoption stats (89% have observability)

### Tertiary (LOW confidence - needs validation)
- None - all findings verified against official docs

</sources>

<metadata>
## Metadata

**Research scope:**
- Core technology: LangGraph callback system
- Ecosystem: Logging libraries, tracing patterns
- Patterns: Callback handler → Logger → Store
- Pitfalls: Performance, correlation, error handling

**Confidence breakdown:**
- Standard stack: HIGH - using existing Logger, standard LangChain callbacks
- Architecture: HIGH - simple adapter pattern, verified with docs
- Pitfalls: HIGH - common issues documented in community
- Code examples: HIGH - based on official BaseCallbackHandler interface

**Research date:** 2026-01-16
**Valid until:** 2026-02-16 (30 days - logging patterns are stable)

</metadata>

---

*Phase: 06-observability*
*Research completed: 2026-01-16*
*Ready for planning: yes*
