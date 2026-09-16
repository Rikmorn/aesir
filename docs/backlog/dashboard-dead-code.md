---
issue: 16
kind: tech-debt
summary: knip flags 3 unused dashboard files, 41 unused exports and 13 unused types, mostly in services/tools.ts, services/overview.ts and the task-graph components.
---

# Dashboard dead code: 3 unused files, 41 unused exports, 13 unused types

## Context
A `knip` run recorded on the issue (2026-09-15) flags `components/overview/tool-activity.tsx`, `components/ui/card.tsx` and `components/ui/scroll-area.tsx` as unused files, plus 41 unused exports and 13 unused types concentrated in `services/tools.ts`, `services/overview.ts` and the task-graph components. The count is a point-in-time `knip` result, not a fixed inventory — rerun `npx knip` for the current list before acting on it.

## Trigger to revisit
Pick this up after the retarget session settles the dashboard's scope, and confirm nothing flagged is reached dynamically by Next.js (route handlers, dynamic imports) before deleting anything.

## Reference
- Rikmorn/aesir#16 (status lives there; carries the knip output)
- `packages/dashboard/src/services/tools.ts`, `packages/dashboard/src/services/overview.ts`
