# ADR-0006: The event log is the ground truth; everything else is a projection

**Status:** accepted (v2.3, 2026-02-04)
**Supersedes / superseded by:** —

## Context

Before v2.3, execution state was split across three disconnected stores: `execution_traces` (buffered, flushed only after an activity completed, with no tool results), `tasks` (updated imperatively by Temporal activities), and `context_snapshots` (LLM summaries written at activity boundaries). Structured facts that mattered — a created PR's number, say — were inferred by parsing agent output (`parsePrInfoFromTrace(result)`) rather than recorded directly when they happened.

## Decision

A single append-only event log (`agent_events`) is the ground truth for everything that happens in a conversation. `agent_sessions` and every other derived view are projections, reactively updated by subscribing to that log, not separately maintained stores. Long conversations stay within token budgets through three-phase history compaction — tool-output pruning, then LLM summarization, then ground-truth artifact re-injection — rather than any single mechanism, with a fallback to the pruned result if summarization itself fails.

## Consequences

- New concerns — billing, compliance, ML training data — can subscribe to existing events without modifying agent code.
- Projections can be rebuilt if they drift or their schema changes, because they derive from the append-only log rather than being independently written.
- Three disconnected stores collapse into one, which the recorded outcome for this decision calls simpler and more reliable.
- Tool results that matter — a PR's number and URL — are captured directly from `tool.succeeded` events via each tool's own artifact declaration, not inferred by parsing agent output after the fact.
- The event log's subscriber pattern is the substrate the "observability as infrastructure" principle builds on — agent tool usage monitored like service-to-service calls — carried forward into v2.4's dashboard work.
- Committed the project to context overflow being handled by the three-phase compaction sequence specifically, not by any simpler single-pass truncation.

## Sources

- `git show v2.9:.planning/PROJECT.md`, `## Key Decisions`: rows "Unified event log (agent_events)", "Three-phase history compaction".
- `docs/history/specs/design-vision.md`, `## Design Decisions Log`: row "Event log as append-only ground truth"; row "Observability as infrastructure" (note: design-vision.md's own `### Observability as Infrastructure` principle text attributes that principle's formal establishment to `2.4-spec-raw.md`, one milestone after this ADR's decision — cited here for the connection between the event log and what it enabled, not as a v2.3-native decision).
- `docs/history/specs/2.3-spec-raw.md`, `### 2. Event Log`.
