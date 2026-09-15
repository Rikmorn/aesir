---
issue: 21
kind: direction
summary: Formal agent-to-human delegation — humans as directory entries, materialized delegation, an async handshake with reminders and escalation, and mid-work signal handling.
---

# Human collaboration: humans in the entity directory, agent-to-human delegation (v3.1 direction)

## Context
v3.1 formalizes what today is ad hoc — an agent sending a Slack message and waiting. `docs/research/3.1-human-collaboration.md` specs humans as entity-directory entries with capabilities and reachability, delegation that materializes in their channel with response affordances, an async handshake with configurable reminders (gentle at 4h, informative at 24h, escalation at 48h), and handling for signals that arrive mid-work. It sequences deliberately after domain modeling (v3.0) — humans should collaborate with competent agents, not half-baked ones.

## Trigger to revisit
Pick this up when the retarget session decides the human-in-the-loop model.

## Reference
- Rikmorn/aesir#21 (status lives there)
- `docs/research/3.1-human-collaboration.md`
