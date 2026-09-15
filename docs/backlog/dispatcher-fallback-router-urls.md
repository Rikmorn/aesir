---
issue: 15
kind: tech-debt
summary: 22 occurrences of the pre-v2.3 router:3006 fallback URL remain as dead defaults after the router folded into the single agent service.
---

# Dispatcher fallback URLs still reference router:3006

## Context
Before v2.3 folded the router into the single agent service, dispatcher code defaulted to `router:3006` when no explicit URL was configured. `git show v2.9:.planning/PROJECT.md`'s "Known Tech Debt" list, updated after v2.8, records 22 remaining occurrences of that fallback. They're dead defaults rather than live bugs — the runtime URL resolves correctly via `docker-compose.yml` — but the fallback still points at a service that no longer exists.

## Trigger to revisit
Pick this up alongside any change that touches dispatcher configuration: find the occurrences (`grep -rn "router:3006" packages`) and point them at the agent service, or remove the fallback entirely.

## Reference
- Rikmorn/aesir#15 (status lives there)
- `git show v2.9:.planning/PROJECT.md` (Known Tech Debt, updated after v2.8)
