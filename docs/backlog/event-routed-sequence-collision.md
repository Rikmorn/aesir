---
issue: 10
kind: tech-debt
summary: event.routed is appended at sequence 0, so a conversation's second routing event collides on (conversation, sequence) and is silently dropped.
---

# event.routed sequence=0 collision drops the second routing event per conversation

## Context
v2.8's Work Correlation phase recorded `event.routed` sequence=0 collision as known debt: a second routing event for the same conversation collides on the `(conversation, sequence)` key and is silently dropped. Severity was recorded as moderate — observability only, routing itself still works. `git show 39c7015c:.planning/MILESTONES.md`'s v2.8 entry lists it first under "Tech debt tracked," and no later milestone summary records a fix.

## Trigger to revisit
Pick this up when routing-event fidelity in the dashboard timeline matters enough to justify a real sequence (or a separate key) plus a regression test covering two routings of one conversation.

## Reference
- Rikmorn/aesir#10 (status lives there)
- `git show 39c7015c:.planning/MILESTONES.md` (v2.8 entry, "Tech debt tracked")
