# ADR-0013: Activation pattern over agent type (phase 85 deferred)

**Status:** accepted (v2.9, 2026-02-20) — a deferral, binding until the retarget decides
**Supersedes / superseded by:** —

## Context

ADR-0010 drew a hard line between two agent tiers: orchestrators, which are autonomous peers with entity-directory presence, delegation, and negotiation handshakes; and sub-agents (coder, researcher, tester), spawned internally by an orchestrator, sharing its budget, and categorically excluded from the directory. v2.9 planned Phase 85 ("Sub-Agent Discovery") to extend the directory's capability-matching pattern inward: let an orchestrator describe the capability it needs from a sub-agent instead of hardcoding an `agentType` in its `spawn_agent` call, mirroring how orchestrator-to-orchestrator delegation already works. The phase's original requirements assumed this would live as a separate `sub_agent` tier inside the same entity directory.

## Decision

Phase 85 is deferred to v3.0 and was not built in v2.9. The deferral's own reasoning goes further than "not now" — it challenges the premise the phase was scoped against. The roadmap's DEFERRED note for the phase concludes that the orchestrator/sub-agent split itself is "an implementation artifact": what actually varies between agents is the *activation pattern* they support (spawn, delegate, trigger, schedule), not some inherent type, and building a separate sub-agent registry now would create infrastructure that a later, more holistic rethink would just replace. `2.9-platform-completion.md`'s own stub for the phase gives a compatible second reason for the same deferral: with only three sub-agents in production, hardcoded `subAgents` YAML references aren't yet a real pain point, and building discovery infrastructure ahead of v3.0's role analysis risks locking in the wrong abstraction before the questions that matter are actually answered — whether the sub-agent/orchestrator distinction survives scaling at all, whether spawn and delegation should unify into one mechanism, and how capability scoping would interact with the permission model. A carried-forward planning todo sharpens this into a concrete direction for whenever the phase is revisited: unify all agents — orchestrators and sub-agents alike — in the entity directory, discriminated not by tier but by which activation patterns they support (spawnable, delegatable, triggerable, schedulable), with `description` staying human-facing and a separate `capabilities` array (each string embedded individually, not one blob) driving semantic matching.

This is a live contradiction with design-vision's "Orchestrators Collaborate, Sub-Agents Execute" principle, not a settled one. That principle states the two tiers have "fundamentally different collaboration models" and that sub-agents categorically "don't appear in the directory... aren't peers it collaborates with." Phase 85's deferred reasoning treats that same split as an artifact to be dissolved into one directory with per-agent activation-pattern flags. Both cannot be the final architecture. **The deferral governs**: it is the more recent and more specifically reasoned position, and it is what any future work on sub-agent discovery or the entity directory should treat as the live question — not the earlier principle's confident two-tier statement. Nothing changed in the running system as a direct result: sub-agents still don't appear in the directory today, precisely because Phase 85 was never built. What changed is which position is authoritative about whether that split is architecture or accident, and that question is now open until the retarget (or v3.0) resolves it.

## Consequences

- No code shipped from this decision — Phase 85 has zero plans and no verification status recorded, consistent with a phase that was deferred rather than executed.
- Future work touching sub-agent selection or the entity directory should treat design-vision's "Orchestrators Collaborate, Sub-Agents Execute" principle as provisional, not settled, and consult this ADR before assuming the two-tier split is architecture rather than a still-open question.
- The three concrete design decisions banked for v3.0 (per-string embedded capability arrays, activation-pattern discriminators replacing the `sub_agent` tier, `description` vs. `capabilities` split) are not commitments — they're the position of whoever last touched Phase 85 planning, recorded so the retarget doesn't have to re-derive them from scratch.
- `coordination:spawn_agent`'s `agentType` parameter remains the only sub-agent selection mechanism until this is revisited; capability-based spawn stays deferred work under v3.0's domain-modeling milestone.

## Sources

- `git show v2.9:.planning/ROADMAP.md`, `### Phase 85: Sub-Agent Discovery — DEFERRED` (Status, Reason, original Success Criteria).
- `docs/history/specs/2.9-platform-completion.md`, `## ~~Phase 6: Sub-Agent Discovery~~ (Deferred to v3.0)` (Status, Rationale, the unresolved questions named within it); `## Deferred Work`: row DISC-01.
- `git show v2.9:.planning/STATE.md`, Pending Todos, item 8: "Phase 85 design decisions for v3.0."
- `docs/history/specs/design-vision.md`, `### Orchestrators Collaborate, Sub-Agents Execute` — the principle this ADR contradicts.
- `docs/history/phases.md`, row 85 (0 plans, no verification status — consistent with deferral, not execution).
