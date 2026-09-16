# ADR-0011: Knowledge and directory embeddings live in Postgres (pgvector)

**Status:** accepted (v2.7, 2026-02-13)
**Supersedes / superseded by:** —

## Context

Agent conversations are isolated context boundaries by design. Without a shared store, agents in a delegation chain (ADR-0010) repeatedly rediscover the same facts — codebase structure, prior architecture decisions, known constraints — spending token budget on exploration that a prior conversation already paid for.

## Decision

Knowledge lives in a single Postgres table (`agents.knowledge_entries`), dual-indexed: structured metadata columns (type, scope, author, expiry) for filtered queries, plus an HNSW index over pgvector embeddings for semantic search — not a dedicated vector database, on the basis that operational simplicity wins at the volume agents actually produce (hundreds to low thousands of entries). The embedding provider is swappable via `EMBEDDING_PROVIDER=ollama|voyage` (Ollama locally, Voyage AI in production), with the vector dimension set independently via `EMBEDDING_DIMENSIONS` and both validated at startup — no silent auto-detection. Entries are classified into a fixed taxonomy of six types — `discovery`, `constraint`, `architecture_decision`, `thought`, `preference`, `test_result` — chosen deliberately narrow: too few types collapses everything into "discovery," too many invites miscategorization, and the taxonomy is meant to grow from observed usage rather than speculation. Classification drives scope by hardcoded default (shared for discovery/constraint/architecture_decision/preference/test_result, private for thought) rather than a configurable policy engine, because no real override need had yet emerged to justify one. Agents interact through `knowledge:store`/`knowledge:query`/`knowledge:update`, under a `knowledge:` namespace deliberately distinct from a hypothetical `memory:` — shared, curated, cross-agent knowledge is a different mechanism from an agent's own private working notepad, and from conversation-history compaction entirely. Every entry carries a mandatory expiry by category (discoveries and thoughts: 24h; architecture decisions: 7d; constraints and preferences: 30d); storing a new entry on an existing topic supersedes rather than duplicates it, so passive decay plus supersession — not voting, not a confidence score — is the v1 mechanism for resolving conflicting facts.

## Consequences

- The same embedding pipeline backs the entity directory's semantic capability matching (ADR-0010): one matching approach across knowledge and directory, rather than a second bespoke one.
- Confidence scoring is explicitly out of scope for v1 on the finding that agents self-calibrate poorly at it — a deliberate omission, not an oversight to revisit casually.
- v2.9 (Phase 87) replaced the single hardcoded vector-search path with a pluggable retrieval-strategy abstraction — a type contract with a zero-overhead default path, where vector search remains the default implementation — so new strategies (keyword, temporal decay, diversity) register by name without changing pipeline code; agents opt in via a `retrieval` block in `definition.yaml`, validated at load time, and agents without one keep the original vector-only behavior. Concrete strategies beyond vector and an expression-index keyword match (BM25, temporal decay, MMR diversity) stay deferred to v3.0 role analysis.
- Phase 87 also added a pre-compaction knowledge flush: a lifecycle-hook-driven turn, restricted to the `knowledge_store` tool only, giving an agent one chance to persist findings before history compaction discards them, guarded per-cycle against double-flushing.

## Sources

- `docs/history/decisions-log.md`, `## B. Project Key Decisions`: rows "pgvector in PostgreSQL", "Knowledge classification taxonomy (6 types)"; `## A. Per-plan decisions, by phase`: `### Phase 87-knowledge-retrieval-enhancement`.
- `docs/history/specs/design-vision.md`, `### Knowledge as Shared Infrastructure`; `## Design Decisions Log`: rows "Knowledge classified by type, scoped by visibility", "`knowledge:` namespace, not `memory:`".
- `docs/history/specs/2.7-agent-collaboration.md`, `## Phase 71: Shared Memory` (Requirements MEM-01 through MEM-10, Open Design Questions 1–6); `## Phase 72: Entity Directory` (DIR-07).
- `docs/history/specs/2.9-platform-completion.md`, `## Deferred Work`: row KRS-01.
