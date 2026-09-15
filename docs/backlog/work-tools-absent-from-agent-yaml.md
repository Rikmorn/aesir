---
issue: 11
kind: tech-debt
summary: work:register and work:query are registered in the tool registry but no production agent YAML lists them, so no agent can call them directly.
---

# work:register and work:query are missing from the production agent definitions

## Context
v2.8's Work Correlation phase shipped the work-correlation tools (`work:register`, `work:query`) into the tool registry, but dev-agent and product-agent YAML never list them. Auto-registration at `executor.start()` covers the common case, which is why the gap went unnoticed. `git show v2.9:.planning/MILESTONES.md`'s v2.8 entry records it as low-severity debt, second under "Tech debt tracked."

## Trigger to revisit
Pick this up when an agent needs to call `work:register` or `work:query` directly rather than relying on auto-registration, or when the retarget makes the tools moot and they should be removed instead.

## Reference
- Rikmorn/aesir#11 (status lives there)
- `git show v2.9:.planning/MILESTONES.md` (v2.8 entry, "Tech debt tracked")
