# Phase 87: Knowledge Retrieval Enhancement - Research

**Researched:** 2026-02-22
**Domain:** Knowledge retrieval pipeline abstraction + pre-compaction flush mechanism
**Confidence:** HIGH

## Summary

Phase 87 introduces two independent subsystems: (1) a pluggable retrieval pipeline with strategy abstraction, and (2) a pre-compaction knowledge flush mechanism. Both build on existing infrastructure -- the retrieval pipeline wraps the current `vectorSearch()` in `KnowledgeService.query()`, and the flush mechanism extends the Phase 86 lifecycle hook registry with a new `preCompaction` lifecycle point.

The codebase is well-structured for this work. The `KnowledgeService` factory in `packages/agents/src/shared/services/knowledge-service.ts` already encapsulates all vector search logic. The `LifecycleHookRegistry` in `packages/agents/src/framework/lifecycle-hooks.ts` supports named hooks with `injectTurn()` but currently only has a `runPreCompletion` method. The `AgentDefinitionYamlSchema` in `packages/agents/src/framework/types.ts` needs a new optional `retrieval` field. History compaction happens at step 7 in `worker-loop.ts:executeConversation()` -- the pre-compaction hook must fire just before this, which means the lifecycle hook registry needs a new `runPreCompaction` method and the worker loop needs to invoke it.

**Primary recommendation:** Split into 3 plans: (1) retrieval pipeline abstraction with strategy interface, factory, RRF fusion, and Zod schema; (2) pre-compaction flush hook mechanism with lifecycle registry extension and worker loop integration; (3) YAML schema extension with validation and backward compatibility.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Pre-compaction flush behavior
- Flush fires before every compaction, tightly coupled -- when history manager determines compaction is needed (token count crosses pruneThreshold), the sequence is: flush turn -> agent responds -> compaction runs
- KR-06's "flush count tracking" is a per-cycle re-entry guard (flushedBeforeCompaction flag reset after compaction), not a lifetime limit
- Uses Phase 86's lifecycle hook registry at a new `preCompaction` lifecycle point (separate from pre-completion)
- 3 iterations via runAgentLoop (same as Phase 86's identity review hook) -- parallel tool calls give capacity for 10+ knowledge entries
- `store_knowledge` only -- no other tools available during the flush turn. Prevents side effects and iteration waste
- No sentinel for empty flush -- agent responds naturally, hook moves on. Executor doesn't inspect agent output
- Flush skipped entirely for agents without knowledge tools (KR-06)

#### Retrieval pipeline config
- No agents get retrieval config initially -- ship the interface only, all agents continue vector-only (KR-07)
- YAML schema: nested strategy blocks with `resultLimit` as the only global knob
  ```yaml
  retrieval:
    strategies:
      - type: vector
        weight: 1.0
    resultLimit: 10
  ```
- Pipeline Zod schema uses `.passthrough()` on strategy objects -- validates `type` + `weight`, ignores strategy-specific fields
- Each strategy implementation validates its own config block at definition load time (KR-08)
- Weights are relative, normalized at query time -- `[0.7, 0.3]` and `[7, 3]` are equivalent
- Zero-overhead default path: no retrieval config in YAML -> call `vectorSearch()` directly, pipeline never instantiated. Same vector function reused as the strategy implementation when the pipeline IS active

#### Strategy design
- Strategy interface models retrieval (query -> scored results): vector and keyword. NOT temporal decay or diversity -- those are post-retrieval transforms (different pipeline stage, deferred to v3.0)
- Strategy interface: `search(query, scope, limit) -> ScoredResult[]`
- Registration: simple Map in the pipeline factory, not a dynamic registry. `strategies.set("vector", createVectorStrategy)`. Strategy types validated against Map keys at definition load time
- Strategy factory shape: `(db, config) -> RetrievalStrategy` -- each factory validates its own config block
- Score fusion: Reciprocal Rank Fusion (RRF) as a plain function, not pluggable. `k=60` constant. Configurable part is the weights, not the algorithm
- Pipeline runs strategies in parallel via `Promise.allSettled` -- log failures, fuse what succeeded, graceful degradation

#### Knowledge prioritization (flush prompt)
- Judgment criteria, not a checklist -- follows prompt guide principles
- Key criterion: "can't be re-derived easily" (decisions > code signatures, rationale > error messages)
- Selective: quality over quantity. Prompt should make 0 stores feel like a valid outcome ("if nothing warrants persisting, just say so")
- No extra context injection -- conversation is already in the agent's context window (that's why flush fires before compaction)
- No source tagging on flush entries -- knowledge is knowledge regardless of provenance. Provenance reconstructable from conversation_id + timestamp if needed

### Claude's Discretion

No discretion areas specified -- all decisions are locked.

### Deferred Ideas (OUT OF SCOPE)

- Temporal decay and diversity/MMR as post-retrieval pipeline transforms -- v3.0 when retrieval needs mature
- Per-agent retrieval config in production definition.yaml files -- v3.0 when role analysis reveals strategy needs
- Vector strategy config knobs (similarity threshold, candidate count) -- when someone needs different values per agent
- Knowledge scope/filtering config -- query-time concern via tool parameters, not definition-level config
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| KR-01 | Retrieval strategy abstraction -- pluggable pipeline interface with zero-overhead default path | Strategy interface pattern: `RetrievalStrategy` with `search(query, scope, limit)`, pipeline factory with `Map<string, StrategyFactory>`, zero-overhead via conditional instantiation (no config = direct `vectorSearch()` call) |
| KR-02 | Per-agent retrieval config in definition.yaml | New optional `retrieval` field in `AgentDefinitionYamlSchema` (Zod), nested strategy blocks with `.passthrough()`, loaded and validated in `AgentRegistry.loadDefinition()` |
| KR-03 | Strategy registry -- strategies registered by name, resolved at query time | Simple `Map<string, StrategyFactory>` in pipeline factory. Validated against registered names at definition load time in agent-registry. New strategies = `map.set("keyword", createKeywordStrategy)` |
| KR-04 | Score fusion interface -- weighted RRF when multiple strategies enabled | Plain function `reciprocalRankFusion(strategyResults, weights, k=60)`. Formula: `fusionScore = sum(weight_i / (k + rank_i))` per unique doc. Weights normalized before fusion |
| KR-05 | Pre-compaction knowledge flush | New `preCompaction` lifecycle point in `LifecycleHookRegistry`. Hook fires in worker loop step 7 before `historyManager.compact()`. Uses `injectTurn()` with `store_knowledge`-only tool set. 3 max iterations |
| KR-06 | Flush safeguards -- double-flush prevention, skip for agents without knowledge tools | `flushedBeforeCompaction` flag in worker loop's `executeConversation()` scope, reset after compaction completes. Agent's tool list checked for `knowledge:store` -- skip hook if absent |
| KR-07 | Backward compatibility -- agents without retrieval config use current behavior | Zero-overhead default path: `retrieval` field is optional in schema. When absent, `KnowledgeService.query()` calls `vectorSearch()` directly. No pipeline instantiation, no runtime dispatch |
| KR-08 | Config validation -- retrieval config validated at load time via Zod | Zod schema with `.passthrough()` on strategy objects. Strategy type names validated against registered strategy Map keys in pipeline factory. Each strategy factory validates its own config block |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| zod | 3.25.x | Schema validation for retrieval config | Already used throughout codebase for all validation |
| drizzle-orm | 0.31.x | Database queries for vector/keyword search | Already the ORM layer for all DB access |
| @anthropic-ai/sdk | Current | LLM calls for flush turn | Already used by runAgentLoop |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | 4.x | Unit tests for pipeline, RRF, hooks | All new code gets unit tests |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Simple Map for strategy registry | Dynamic plugin system | Over-engineering for 2 strategies; Map is sufficient and validated at load time |
| RRF for score fusion | CombMNZ, linear combination | RRF is the industry standard for hybrid retrieval, parameter-free except k, proven to work well with different score distributions |
| injectTurn for flush | Direct service call | injectTurn lets the agent decide what to store via reasoning; direct calls would bypass agent judgment |

## Architecture Patterns

### Recommended Project Structure
```
packages/agents/src/
├── shared/
│   ├── services/
│   │   ├── knowledge-service.ts          # Existing -- no changes to query() signature
│   │   └── retrieval/                    # NEW: retrieval pipeline
│   │       ├── types.ts                  # RetrievalStrategy interface, ScoredResult, PipelineConfig
│   │       ├── pipeline.ts              # createRetrievalPipeline factory, strategy registry Map
│   │       ├── strategies/
│   │       │   ├── vector-strategy.ts   # Wraps existing vectorSearch from KnowledgeService
│   │       │   └── keyword-strategy.ts  # PostgreSQL full-text search on knowledge_entries
│   │       ├── fusion.ts               # reciprocalRankFusion() pure function
│   │       └── index.ts                # Barrel export
│   └── tools/
│       └── knowledge/
│           └── query.ts                 # Modified: accept optional pipeline, fallback to direct search
├── framework/
│   ├── types.ts                         # AgentDefinitionYamlSchema: add optional `retrieval` field
│   ├── lifecycle-hooks.ts               # Add runPreCompaction method
│   ├── worker-loop.ts                   # Invoke preCompaction before step 7, restrict tools
│   └── agent-registry.ts               # Validate retrieval config strategy names at load time
└── service/
    └── main.ts                          # Register knowledge-flush hook, create pipeline factory
```

### Pattern 1: Strategy Interface
**What:** Type contract for retrieval strategies with factory-based creation
**When to use:** Any new retrieval approach (keyword, future strategies)
**Example:**
```typescript
// packages/agents/src/shared/services/retrieval/types.ts

export interface ScoredResult {
  id: string;
  score: number;        // Strategy-specific score (will be fused)
  content: string;
  topic: string;
  type: string;
  author: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface RetrievalStrategy {
  /** Strategy type name (e.g., "vector", "keyword") */
  readonly type: string;
  /** Execute search and return scored results */
  search(query: string, scope: RetrievalScope, limit: number): Promise<ScoredResult[]>;
}

export interface RetrievalScope {
  agentId: string;
  // Scope visibility: shared entries + own private entries
}

export type StrategyFactory = (
  db: NodePgDatabase<typeof agentsSchemaModule>,
  config: Record<string, unknown>,
) => RetrievalStrategy;
```

### Pattern 2: Zero-Overhead Default Path
**What:** Conditional pipeline instantiation -- skip pipeline entirely for default vector-only behavior
**When to use:** When agent definitions don't specify retrieval config
**Example:**
```typescript
// In knowledge query tool or service layer
async function queryKnowledge(params, retrievalConfig?) {
  if (!retrievalConfig) {
    // Zero-overhead: call vectorSearch directly (existing path)
    return knowledgeService.query(params);
  }
  // Pipeline path: run strategies, fuse results
  return pipeline.search(params.query, scope, retrievalConfig.resultLimit);
}
```

### Pattern 3: Pre-Compaction Hook with Tool Restriction
**What:** Lifecycle hook that fires before compaction with restricted tool set
**When to use:** Knowledge flush before history compaction
**Example:**
```typescript
// In worker-loop.ts, before step 7 (compaction)
if (needsCompaction && hasKnowledgeTools && !flushedBeforeCompaction) {
  flushedBeforeCompaction = true;
  // Resolve ONLY store_knowledge tool for the flush turn
  const flushTools = [resolvedTools.find(t => t.name === "knowledge_store")].filter(Boolean);
  const hookCtx = {
    ...baseHookCtx,
    tools: flushTools,
    injectTurn: async (msg) => {
      return runAgentLoop({
        systemPrompt,
        tools: flushTools,  // Only store_knowledge
        initialMessage: msg,
        context: JSON.stringify(messagesBeforeCompaction),
        model: definition.model,
        maxIterations: 3,
        // ... callbacks
      });
    },
  };
  await lifecycleHooks.runPreCompaction(hookCtx);
}
// Then proceed with compaction
```

### Pattern 4: Reciprocal Rank Fusion
**What:** Score fusion across multiple retrieval strategies
**When to use:** When multiple strategies return results that need merging
**Example:**
```typescript
// packages/agents/src/shared/services/retrieval/fusion.ts
const RRF_K = 60;

export function reciprocalRankFusion(
  strategyResults: { results: ScoredResult[]; weight: number }[],
): ScoredResult[] {
  // Normalize weights
  const totalWeight = strategyResults.reduce((sum, s) => sum + s.weight, 0);

  const fusionScores = new Map<string, { score: number; result: ScoredResult }>();

  for (const { results, weight } of strategyResults) {
    const normalizedWeight = weight / totalWeight;
    for (let rank = 0; rank < results.length; rank++) {
      const result = results[rank];
      const contribution = normalizedWeight / (RRF_K + rank + 1);
      const existing = fusionScores.get(result.id);
      if (existing) {
        existing.score += contribution;
      } else {
        fusionScores.set(result.id, { score: contribution, result });
      }
    }
  }

  return Array.from(fusionScores.values())
    .sort((a, b) => b.score - a.score)
    .map(({ score, result }) => ({ ...result, score }));
}
```

### Anti-Patterns to Avoid
- **Modifying KnowledgeService.query() signature:** The existing query method works fine for the default path. The pipeline wraps it, not replaces it.
- **Making the pipeline a singleton:** Each agent could theoretically have different config. Pipeline instances should be per-query or per-agent-definition, not global.
- **Inspecting flush agent output:** The CONTEXT.md explicitly says no sentinel detection. The hook fires, the agent responds, we move on.
- **Nesting lifecycle hooks inside the history manager:** The history manager is a pure compaction function. Pre-compaction logic belongs in the worker loop orchestration, not inside compact().

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Score normalization | Custom min-max normalization across strategies | RRF (rank-based) | RRF is score-distribution-agnostic -- doesn't need normalization |
| JSON Schema from Zod | Manual JSON Schema construction | zod-to-json-schema | Already used in the codebase for tool schemas |
| Full-text search index | Custom tokenization/stemming | PostgreSQL tsvector/tsquery | Built into Postgres, well-optimized, requires only a migration for GIN index |
| Async parallel execution | Manual Promise race/coordination | Promise.allSettled | Standard JS, handles partial failures gracefully |

**Key insight:** The retrieval pipeline is fundamentally about composition (strategies) and fusion (RRF). Both are simple algorithmic patterns -- no external libraries needed. The complexity is in the integration (lifecycle hooks, config validation, worker loop wiring).

## Common Pitfalls

### Pitfall 1: Pre-Compaction vs Pre-Completion Lifecycle Point Confusion
**What goes wrong:** Registering the flush hook as a pre-completion hook (like identity review) instead of creating a new pre-compaction lifecycle point. Pre-completion fires AFTER the agent loop completes -- at that point, the conversation already has compacted messages. The flush needs to fire BEFORE compaction.
**Why it happens:** The existing lifecycle hook registry only has `runPreCompletion`. It's tempting to reuse it.
**How to avoid:** Add `runPreCompaction(ctx)` to `LifecycleHookRegistry` interface with separate hook storage. The pre-compaction context needs the same `injectTurn` capability but with restricted tools.
**Warning signs:** Flush hook fires but the conversation has already been compacted -- knowledge entries contain summarized content instead of raw discoveries.

### Pitfall 2: Tool Restriction in injectTurn
**What goes wrong:** The flush turn runs with ALL resolved tools instead of only `store_knowledge`. The agent wastes iterations calling Linear/GitHub/Slack instead of persisting knowledge.
**Why it happens:** The current `injectTurn` implementation in worker-loop.ts passes `tools: resolvedTools` (all tools). The flush hook needs a custom `injectTurn` that passes only `[storeKnowledgeTool]`.
**How to avoid:** The flush hook must construct its own `injectTurn` closure that calls `runAgentLoop` with `tools: [storeKnowledgeTool]`. The hook has access to the store_knowledge tool via the registry.
**Warning signs:** Flush turn makes non-knowledge tool calls (visible in event log as tool.called events for non-knowledge tools during the flush).

### Pitfall 3: Compaction Check Duplication
**What goes wrong:** The compaction threshold check is duplicated -- once to determine if flush should fire, and again in `historyManager.compact()`. If they diverge, flushes fire when compaction doesn't (wasting tokens) or compaction runs without flush (missing knowledge).
**Why it happens:** The current compaction check is inside `historyManager.compact()` (which returns `phase: "none"` if below threshold). The pre-compaction flush needs to know if compaction WILL happen before it actually runs.
**How to avoid:** Extract the threshold check into a separate function (e.g., `estimateMessageTokens(messages) >= config.pruneThreshold`) and use it in both places. The `estimateMessageTokens` function is already exported from `history-manager.ts`.
**Warning signs:** Flush fires but compaction result is `phase: "none"` -- tokens wasted on unnecessary flush.

### Pitfall 4: Keyword Search Without GIN Index
**What goes wrong:** Keyword strategy uses `ILIKE` or `tsvector` queries without proper indexes, causing full table scans on knowledge_entries.
**Why it happens:** The keyword strategy is "just" a new query, easy to forget the migration.
**How to avoid:** Create a migration adding a GIN index on a `tsvector` column or expression index. `CREATE INDEX idx_knowledge_fulltext ON agents.knowledge_entries USING GIN (to_tsvector('english', topic || ' ' || content));`
**Warning signs:** Slow keyword queries in production, visible in Postgres query plans.

### Pitfall 5: flushedBeforeCompaction Flag Scope
**What goes wrong:** The re-entry guard flag is scoped too broadly (conversation lifetime) or too narrowly (per-hook-call). It should be per-execution-cycle, reset after compaction completes.
**Why it happens:** The CONTEXT.md says "per-cycle re-entry guard reset after compaction" but it's easy to misplace the flag.
**How to avoid:** Declare `let flushedBeforeCompaction = false` in the `executeConversation` function scope. Set to `true` before flush fires. Reset is implicit -- the flag goes out of scope when the function returns. For multi-compaction scenarios (very long conversations), the flag resets naturally since the worker loop re-claims and re-enters `executeConversation`.
**Warning signs:** Agent gets multiple flush prompts in a single execution, or flush never fires on subsequent compactions.

### Pitfall 6: Retrieval Config Makes Default Path Slower
**What goes wrong:** Adding the retrieval config parsing adds overhead to every query even when no config is present (the common case).
**Why it happens:** The pipeline checks "do I have config?" on every query call.
**How to avoid:** The zero-overhead default path means: no config in YAML -> the pipeline is never instantiated. The knowledge query tool checks for a retrieval config reference at creation time (tool factory), not at query time. If the agent has no retrieval config, the tool factory produces the exact same tool as today.
**Warning signs:** Knowledge query latency increases for agents without retrieval config.

## Code Examples

### Existing vectorSearch in KnowledgeService (the function to wrap)
```typescript
// packages/agents/src/shared/services/knowledge-service.ts:412-434
// The semantic search path in query() method -- this becomes the vector strategy
const queryEmbedding = await generateEmbedding(validated.query);
if (queryEmbedding) {
  const similarity = sql<number>`1 - (${cosineDistance(knowledgeEntries.embedding, queryEmbedding)})`;
  const rows = await db
    .select({
      id: knowledgeEntries.id,
      type: knowledgeEntries.type,
      topic: knowledgeEntries.topic,
      content: knowledgeEntries.content,
      author: knowledgeEntries.author,
      created_at: knowledgeEntries.created_at,
      metadata: knowledgeEntries.metadata,
      similarity,
    })
    .from(knowledgeEntries)
    .where(and(...baseConditions, gt(similarity, SIMILARITY_THRESHOLD)))
    .orderBy(desc(similarity))
    .limit(limit);
  return rows.map(toResult);
}
```

### Existing lifecycle hook registration pattern (Phase 86 identity review)
```typescript
// packages/agents/src/service/main.ts:150-173
const lifecycleHooks = createLifecycleHookRegistry(logger);
lifecycleHooks.register("identity-review", async (ctx) => {
  const docs = await identityService.getCurrentDocuments(ctx.agentDefinitionId);
  if (docs.length === 0) return; // Skip when no docs
  const docList = docs.map(d =>
    `<document type="${d.documentType}" version="${d.version}">\n${d.content}\n</document>`
  ).join("\n");
  const reviewPrompt = `<identity_review>...\n${docList}\n...</identity_review>`;
  await ctx.injectTurn(reviewPrompt);
});
```

### Existing injectTurn implementation (worker-loop.ts:2018-2036)
```typescript
injectTurn: async (userMessage: string) => {
  const hookResult = await runAgentLoop({
    systemPrompt,
    tools: resolvedTools,     // <-- Phase 87 CHANGES this to [storeKnowledgeTool]
    initialMessage: userMessage,
    context: JSON.stringify(finalMessages),
    model: definition.model,
    maxIterations: 3,
    onToolCall,
    onToolResult,
    onResponse,
    abortSignal,
    logger: childLogger,
  });
  finalMessages.push(...hookResult.messages.slice(1));
  return hookResult;
},
```

### Compaction threshold check (reusable for pre-compaction decision)
```typescript
// packages/agents/src/framework/history-manager.ts:97-100 (already exported)
export function estimateMessageTokens(messages: Anthropic.MessageParam[]): number {
  // ... calculates token count
}

// Usage in worker loop for pre-compaction decision:
const estimatedTokens = estimateMessageTokens(currentMessages);
const needsCompaction = estimatedTokens >= definition.history.pruneThreshold;
```

### Agents with knowledge tools (flush targets)
```
dev-agent:     knowledge:store, knowledge:query, knowledge:update  -- FLUSH
product-agent: knowledge:store, knowledge:query, knowledge:update  -- FLUSH
qa-agent:      knowledge:store, knowledge:query                    -- FLUSH
researcher:    (no knowledge tools)                                -- SKIP
coder:         (no knowledge tools)                                -- SKIP
tester:        (no knowledge tools)                                -- SKIP
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single vector search | Hybrid retrieval (vector + keyword + RRF) | 2024-2025 | Standard in production RAG systems; RRF specifically from Microsoft/Perplexity papers |
| BM25 for keyword | PostgreSQL full-text search (tsvector/tsquery) | Stable | Postgres built-in, no external dependency like Elasticsearch needed |
| Fixed retrieval | Per-agent configurable retrieval | This phase | Enables future per-agent optimization of retrieval strategies |

**RRF specifics:** RRF was introduced in "Reciprocal Rank Fusion outperforms Condorcet and individual Rank Learning Methods" (Cormack et al., 2009). The k=60 constant is the standard default used by Elasticsearch, Vespa, and most production systems. It provides good balance between emphasizing top-ranked results and considering deeper results.

## Open Questions

1. **Keyword strategy SQL implementation details**
   - What we know: PostgreSQL tsvector/tsquery with GIN index is the right approach. No tsvector/tsquery usage exists in the current schema.
   - What's unclear: Whether to use an expression index (no schema change) or add a generated tsvector column (requires migration + schema change). Expression index is simpler but slightly slower.
   - Recommendation: Use expression index in the migration for simplicity: `CREATE INDEX idx_knowledge_fulltext ON agents.knowledge_entries USING GIN (to_tsvector('english', topic || ' ' || content));`. No schema.ts change needed.

2. **Pre-compaction hook position in worker loop**
   - What we know: Must fire before step 7 (compaction). The flush appends messages to the conversation. Those messages then get compacted.
   - What's unclear: After the flush turn appends messages, should we update `currentMessages` before passing to compaction? Yes -- the flush messages should be part of what gets compacted.
   - Recommendation: Flush modifies `currentMessages` in place (push new messages), then compaction runs on the updated `currentMessages`. This is how pre-completion hooks work (they push to `finalMessages`).

3. **Pipeline instance lifecycle**
   - What we know: Pipeline should not be instantiated for agents without config. When instantiated, it wraps KnowledgeService internals.
   - What's unclear: Where to create the pipeline instance -- per query, per conversation, or per agent definition load?
   - Recommendation: Per agent definition load (cached in the knowledge query tool factory closure). The pipeline config doesn't change during a conversation. The tool factory already receives the definition context via ToolContext.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `packages/agents/src/shared/services/knowledge-service.ts` -- full vector search implementation
- Codebase analysis: `packages/agents/src/framework/lifecycle-hooks.ts` -- hook registry pattern
- Codebase analysis: `packages/agents/src/framework/worker-loop.ts` -- compaction integration point (step 7), pre-completion hook pattern (step 14a)
- Codebase analysis: `packages/agents/src/framework/types.ts` -- AgentDefinitionYamlSchema, ToolContext
- Codebase analysis: `packages/agents/src/framework/history-manager.ts` -- estimateMessageTokens (exported), compact() pipeline
- Codebase analysis: `packages/agents/src/service/main.ts` -- lifecycle hook registration pattern (identity-review)
- Codebase analysis: `packages/agents/src/framework/tool-factories.ts` -- tool factory registration pattern
- Codebase analysis: Agent definitions -- knowledge tool inventory (dev-agent, product-agent, qa-agent have knowledge:store)

### Secondary (MEDIUM confidence)
- RRF algorithm: Cormack et al., 2009 paper; widely documented k=60 default in Elasticsearch/Vespa documentation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already in use, no new dependencies needed
- Architecture: HIGH -- patterns directly derived from existing codebase (lifecycle hooks, tool factories, Zod schema)
- Pitfalls: HIGH -- identified from direct code analysis of compaction flow and hook mechanism
- Retrieval pipeline: HIGH -- strategy/factory pattern is straightforward, RRF is well-documented
- Pre-compaction flush: HIGH -- builds directly on Phase 86 pattern with well-understood modification points

**Research date:** 2026-02-22
**Valid until:** 2026-03-22 (stable codebase patterns, no external dependency changes expected)
