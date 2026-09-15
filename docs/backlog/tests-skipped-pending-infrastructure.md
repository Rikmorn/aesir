---
issue: 13
kind: tech-debt
summary: 11 tests are marked skipped because they need services the fast suite doesn't provide; each needs triage into the integration suite or deletion.
---

# 11 tests skipped pending infrastructure

## Context
`git show v2.9:.planning/PROJECT.md`'s "Known Tech Debt" list, updated after v2.8, records "4 pre-existing test failures, 11 tests skipped pending infrastructure" alongside the rest of that milestone's carried debt. This is distinct from the 16 worker-loop tests skipped after phases 83, 86 and 87 (Rikmorn/aesir#1) — that inventory was already scoped and excluded from this one.

## Trigger to revisit
Pick this up by inventorying the skips (`grep -rn "it.skip\|describe.skip" packages --include=*.test.ts`, excluding the #1 set) and deciding per test whether it belongs in the integration suite or should be deleted.

## Reference
- Rikmorn/aesir#13 (status lives there)
- `git show v2.9:.planning/PROJECT.md` (Known Tech Debt, updated after v2.8)
