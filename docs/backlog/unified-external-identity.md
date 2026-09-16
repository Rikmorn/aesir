---
issue: 24
kind: direction
summary: Open product question — should Aesir present as one external identity across Linear, Slack and GitHub instead of exposing dev-agent, product-agent and qa-agent separately?
---

# Unified external identity: one Aesir, or per-agent identities?

## Context
`docs/history/specs/design-vision.md`'s "Future: Unified External Identity" section asks whether Aesir should present as a single entity the way Claude, ChatGPT or Lovable do, with internal routing invisible, rather than exposing per-agent bot identities. It notes the architecture already converges toward this — the EventRouter's classify-and-route behaviour is functionally a unified entry point — and that the gap is only at the top level: separate bot identities per integration, separate trigger rules per agent. A constraint was recorded for v2.8/v2.9: don't deepen per-agent external identities (no new per-agent bot users, no agent-specific integration configs) while this stays undecided.

## Trigger to revisit
Pick this up at the retarget session — this is a product question about how the agent team presents to the outside world, not an engineering one.

## Reference
- Rikmorn/aesir#24 (status lives there)
- `docs/history/specs/design-vision.md` ("Future: Unified External Identity")
