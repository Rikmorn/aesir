# ADR-0006: The event log is the ground truth; everything else is a projection

**Status:** accepted (v2.3, 2026-02-04)
**Supersedes / superseded by:** —

## Context

Before v2.3, execution state was split across three disconnected stores: `execution_traces` (buffered, flushed only after an activity completed, with no tool results), `tasks` (updated imperatively by Temporal activities), and `context_snapshots` (LLM summaries written at activity boundaries). Structured facts that mattered — a created PR's number, say — were inferred by parsing agent output (`parsePrInfoFromTrace(result)`) rather than recorded directly when they happened.

## Decision

A single append-only event log (`agent_events`) is the ground truth for everything that happens in a conversation. `agent_sessions` and every other derived view are projections, reactively updated by subscribing to that log, not separately maintained stores. Long conversations stay within token budgets through an escalating two-phase compaction strategy: Phase 1, tool-output pruning, is always active and protects the most recent messages while replacing older tool results with short descriptors; Phase 2, structured anchored summarization, escalates from there when pruning alone isn't enough, producing a summary that is anchored — updated incrementally rather than regenerated — with its artifacts section populated from the event-log projection, so file paths and PR numbers come from ground truth rather than the LLM's memory. Phase 1's pruned result is the fallback if Phase 2 summarization itself fails. A third phase, agent-managed memory, was designed into the architecture — the agent proactively saving and retrieving its own findings via `memory:save`/`memory:search` tools — but was explicitly deferred, not built for v2.3.

## Consequences

- New concerns — billing, compliance, ML training data — can subscribe to existing events without modifying agent code.
- Projections can be rebuilt if they drift or their schema changes, because they derive from the append-only log rather than being independently written.
- Three disconnected stores collapse into one, which the recorded outcome for this decision calls simpler and more reliable.
- Tool results that matter — a PR's number and URL — are captured directly from `tool.succeeded` events via each tool's own artifact declaration, not inferred by parsing agent output after the fact.
- The event log's subscriber pattern is the substrate the "observability as infrastructure" principle builds on — agent tool usage monitored like service-to-service calls — carried forward into v2.4's dashboard work.
- Committed the project to two escalating compaction phases specifically — always-active pruning, then event-log-anchored summarization — not to the third phase (agent-managed memory) the architecture was designed to support; that phase was explicitly deferred and was never built for v2.3.

## Sources

- `git show v2.9:.planning/PROJECT.md`, `## Key Decisions`: rows "Unified event log (agent_events)", "Three-phase history compaction" (this row's own shorthand rationale — "Tool pruning → LLM summary → artifact grounding with fallback" — names the decision, not the phase count or sequence; `2.3-spec-raw.md` §4 below is the mechanism source, and it defines two active phases plus one explicitly deferred, not three sequential ones).
- `docs/history/specs/design-vision.md`, `## Design Decisions Log`: row "Event log as append-only ground truth"; row "Observability as infrastructure" (note: design-vision.md's own `### Observability as Infrastructure` principle text attributes that principle's formal establishment to `2.4-spec-raw.md`, one milestone after this ADR's decision — cited here for the connection between the event log and what it enabled, not as a v2.3-native decision).
- `docs/history/specs/2.3-spec-raw.md`, `### 2. Event Log`; `### 4. History Management` (Phase 1 Tool Output Pruning, Phase 2 Structured Anchored Summarization, Phase 3 Agent-Managed Memory — verbatim: "Not for v2.3 implementation, but the architecture supports it").
