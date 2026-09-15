---
issue: 19
kind: direction
summary: Replace hardcoded spawn_agent agent-type references with capability-based sub-agent discovery — deferred because the orchestrator/sub-agent split itself is an open question.
---

# Sub-agent discovery: activation pattern over agent type (deferred phase 85)

## Context
v2.9's Phase 85 planned to extend the entity directory's capability-matching pattern inward, letting an orchestrator describe the capability it needs instead of hardcoding an `agentType` in `spawn_agent`. It was deferred to v3.0 rather than built: `docs/history/specs/2.9-platform-completion.md`'s "Sub-Agent Discovery" section notes only three sub-agents exist, so hardcoded `subAgents` YAML isn't yet a real pain point, and building discovery infrastructure ahead of v3.0's role analysis risks locking in the wrong abstraction. `docs/adr/0013-activation-pattern-over-agent-type.md` records the deferral's sharper reasoning: the orchestrator/sub-agent tier split itself may be an implementation artifact, with the real variation being activation pattern (spawn, delegate, trigger, schedule) rather than agent type — a position that directly contradicts design-vision's "Orchestrators Collaborate, Sub-Agents Execute" principle and is, per that ADR, the one that governs until the retarget resolves it.

## Trigger to revisit
Pick this up when the retarget session settles what agents exist and how they're activated. The design decisions banked in ADR-0013 (per-string capability arrays, activation-pattern discriminators, `description` vs. `capabilities`) are a starting position, not a commitment.

## Reference
- Rikmorn/aesir#19 (status lives there)
- `docs/adr/0013-activation-pattern-over-agent-type.md`
- `docs/history/specs/2.9-platform-completion.md` ("Sub-Agent Discovery" section)
