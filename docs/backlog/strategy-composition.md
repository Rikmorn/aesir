---
issue: 22
kind: direction
summary: Make platform behaviours (retrieval, compaction, delegation) pluggable per agent definition, the way agents themselves already are — enabling work for a second domain.
---

# Strategy composition: pluggable retrieval, compaction and delegation per agent (v3.2 direction)

## Context
Today every agent gets the same retrieval, compaction and delegation pipeline regardless of what it's doing. `docs/research/3.2-strategy-composition.md` identifies the seams where the "right behaviour" depends on the agent's domain — a long-running orchestrator needs aggressive knowledge persistence before compaction, a 30-second coder sub-agent doesn't — and proposes the same declarative pattern that already makes agent definitions pluggable: the definition declares the strategy, the platform provides the primitives. Phase 87 (v2.9) shipped the first seam, retrieval strategies (`KR-01` through `KR-08`).

## Trigger to revisit
Pick this up when the retarget session picks a second domain beyond software development — this is the enabling work for that, not a fix for the current one.

## Reference
- Rikmorn/aesir#22 (status lives there)
- `docs/research/3.2-strategy-composition.md`
