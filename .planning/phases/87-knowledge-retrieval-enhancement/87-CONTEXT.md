# Phase 87: Knowledge Retrieval Enhancement - Context

**Gathered:** 2026-02-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Make the knowledge retrieval pipeline pluggable for future strategies (vector + keyword initially, more in v3.0), and give agents a pre-compaction window to persist important knowledge before history compaction discards it. Ships the abstraction layer, the config schema, and the flush mechanism — no agents get non-default retrieval config yet.

</domain>

<decisions>
## Implementation Decisions

### Pre-compaction flush behavior
- Flush fires before every compaction, tightly coupled — when history manager determines compaction is needed (token count crosses pruneThreshold), the sequence is: flush turn → agent responds → compaction runs
- KR-06's "flush count tracking" is a per-cycle re-entry guard (flushedBeforeCompaction flag reset after compaction), not a lifetime limit
- Uses Phase 86's lifecycle hook registry at a new `preCompaction` lifecycle point (separate from pre-completion)
- 3 iterations via runAgentLoop (same as Phase 86's identity review hook) — parallel tool calls give capacity for 10+ knowledge entries
- `store_knowledge` only — no other tools available during the flush turn. Prevents side effects and iteration waste
- No sentinel for empty flush — agent responds naturally, hook moves on. Executor doesn't inspect agent output
- Flush skipped entirely for agents without knowledge tools (KR-06)

### Retrieval pipeline config
- No agents get retrieval config initially — ship the interface only, all agents continue vector-only (KR-07)
- YAML schema: nested strategy blocks with `resultLimit` as the only global knob
  ```yaml
  retrieval:
    strategies:
      - type: vector
        weight: 1.0
    resultLimit: 10
  ```
- Pipeline Zod schema uses `.passthrough()` on strategy objects — validates `type` + `weight`, ignores strategy-specific fields
- Each strategy implementation validates its own config block at definition load time (KR-08)
- Weights are relative, normalized at query time — `[0.7, 0.3]` and `[7, 3]` are equivalent
- Zero-overhead default path: no retrieval config in YAML → call `vectorSearch()` directly, pipeline never instantiated. Same vector function reused as the strategy implementation when the pipeline IS active

### Strategy design
- Strategy interface models retrieval (query → scored results): vector and keyword. NOT temporal decay or diversity — those are post-retrieval transforms (different pipeline stage, deferred to v3.0)
- Strategy interface: `search(query, scope, limit) → ScoredResult[]`
- Registration: simple Map in the pipeline factory, not a dynamic registry. `strategies.set("vector", createVectorStrategy)`. Strategy types validated against Map keys at definition load time
- Strategy factory shape: `(db, config) → RetrievalStrategy` — each factory validates its own config block
- Score fusion: Reciprocal Rank Fusion (RRF) as a plain function, not pluggable. `k=60` constant. Configurable part is the weights, not the algorithm
- Pipeline runs strategies in parallel via `Promise.allSettled` — log failures, fuse what succeeded, graceful degradation

### Knowledge prioritization (flush prompt)
- Judgment criteria, not a checklist — follows prompt guide principles
- Key criterion: "can't be re-derived easily" (decisions > code signatures, rationale > error messages)
- Selective: quality over quantity. Prompt should make 0 stores feel like a valid outcome ("if nothing warrants persisting, just say so")
- No extra context injection — conversation is already in the agent's context window (that's why flush fires before compaction)
- No source tagging on flush entries — knowledge is knowledge regardless of provenance. Provenance reconstructable from conversation_id + timestamp if needed

</decisions>

<specifics>
## Specific Ideas

- Flush prompt draft direction: "Review this conversation for knowledge that would be valuable in future conversations but will be lost when context is compacted. Focus on discoveries, decisions, and context that can't be re-derived easily. Use store_knowledge for anything worth preserving. If nothing warrants persisting, just say so."
- RRF formula: `fusionScore = sum(weight_i / (k + rank_i))` per unique document across all strategy results
- The pipeline's vector strategy wraps the existing `vectorSearch()` function — no duplication of search logic
- Second compaction in a long conversation: agent has summary from round 1 + new messages; same flush prompt works, best-effort preservation

</specifics>

<deferred>
## Deferred Ideas

- Temporal decay and diversity/MMR as post-retrieval pipeline transforms — v3.0 when retrieval needs mature
- Per-agent retrieval config in production definition.yaml files — v3.0 when role analysis reveals strategy needs
- Vector strategy config knobs (similarity threshold, candidate count) — when someone needs different values per agent
- Knowledge scope/filtering config — query-time concern via tool parameters, not definition-level config

</deferred>

---

*Phase: 87-knowledge-retrieval-enhancement*
*Context gathered: 2026-02-22*
