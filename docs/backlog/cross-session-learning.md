---
issue: 25
kind: direction
summary: Agents improving across conversations, not just within one — persistent identity documents and the pre-compaction knowledge flush are the substrate; nothing consumes them across sessions yet.
---

# Cross-session learning

## Context
`docs/research/3.0-domain-modeling.md`'s "Cross-Session Learning" section (`CSL-01`) describes recording task outcomes, surfacing patterns, and feeding them back into an agent's identity documents so it gets better at its job over time. The substrate shipped in v2.9 — persistent agent identity (phase 86) and the pre-compaction knowledge flush (phase 87) — but nothing reads that accumulated context back across sessions yet; the first iteration described is manual, via prompt guidance encouraging agents to update their `learned_preferences` identity document.

## Trigger to revisit
Pick this up at the retarget session — what "learning" should mean depends on the domain the retarget chooses.

## Reference
- Rikmorn/aesir#25 (status lives there)
- `docs/research/3.0-domain-modeling.md` ("Cross-Session Learning")
