---
issue: 23
kind: direction
summary: BM25-specific ranking, temporal decay and MMR diversity remain deferred — v2.9 already shipped both vector and keyword (tsvector/tsquery) retrieval, fused via Reciprocal Rank Fusion.
---

# Retrieval strategies: BM25 keyword, temporal decay, MMR diversity

## Context
v2.9's Knowledge Retrieval Enhancement phase (`KR-01` through `KR-08`) shipped the pluggable retrieval abstraction with two working strategies, not one: vector (pgvector cosine distance) and keyword (PostgreSQL `tsvector`/`tsquery` with `ts_rank` scoring and a GIN expression index), fused via Reciprocal Rank Fusion when both succeed — confirmed in `git show v2.9:.planning/phases/87-knowledge-retrieval-enhancement/87-VERIFICATION.md` against `packages/agents/src/shared/services/retrieval/strategies/keyword-strategy.ts` and migration `0021_add_knowledge_fulltext_index.sql`. What's actually deferred to v3.0 is narrower than "keyword retrieval": `docs/history/requirements.md` lists three concrete strategies under "Concrete Retrieval Strategies" — `KRS-01` BM25-specific ranking (distinct from the `ts_rank` scoring already shipped), `KRS-02` temporal decay, and `KRS-03` MMR diversity re-ranking. OpenClaw's hybrid memory (vector + BM25 with temporal decay and diversity re-ranking) is the reference point noted from competitive research.

## Trigger to revisit
Pick this up when an agent workload shows retrieval quality limiting results, or the retarget session prioritises memory.

## Reference
- Rikmorn/aesir#23 (status lives there)
- `docs/history/requirements.md` ("Concrete Retrieval Strategies (v3.0)")
- `packages/agents/src/shared/services/retrieval/strategies/keyword-strategy.ts` (what already shipped)
