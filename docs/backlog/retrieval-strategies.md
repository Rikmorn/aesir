---
issue: 23
kind: direction
summary: Three concrete retrieval strategies deferred from v2.9's pluggable pipeline — BM25 keyword, temporal decay and MMR diversity.
---

# Retrieval strategies: BM25 keyword, temporal decay, MMR diversity

## Context
v2.9's Knowledge Retrieval Enhancement phase (`KR-01` through `KR-08`) shipped the pluggable retrieval abstraction and score-fusion interface, but only the existing vector-search strategy. `docs/history/requirements.md` lists three concrete strategies deferred to v3.0 under "Concrete Retrieval Strategies": `KRS-01` BM25/keyword retrieval, `KRS-02` temporal decay, and `KRS-03` MMR diversity re-ranking. OpenClaw's hybrid memory (vector + BM25 with temporal decay and diversity re-ranking) is the reference point noted from competitive research.

## Trigger to revisit
Pick this up when an agent workload shows retrieval quality limiting results, or the retarget session prioritises memory.

## Reference
- Rikmorn/aesir#23 (status lives there)
- `docs/history/requirements.md` ("Concrete Retrieval Strategies (v3.0)")
