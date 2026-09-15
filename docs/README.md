# docs/ — what lives where

Modelled on sidekick's docs taxonomy, with one addition: `history/`, because this repo arrived with eleven milestones of record that the taxonomy's other folders don't hold.

**The placement test:** true now → `reference/` · happened → `history/`, `learnings/`, `adr/` · deferred with content → `backlog/` (and a GitHub issue) · pre-decision material → `research/`. To do or doing → a GitHub issue on `Rikmorn/aesir`; the board is the status surface (`.claude/rules/sk-pm-conventions.md`).

| Folder | Meaning | Lifecycle |
|---|---|---|
| `reference/` | How the project is today. Present tense, no history. | Living: corrected whenever the source moves. |
| `adr/` | Architecture decisions that still bind, one per file, MADR-lite. | Record: status transitions only (accepted → superseded), never rewritten. |
| `history/` | The frozen record of what was built, v1 → v2.9 (Jan–Feb 2026): milestones, phases, every recorded decision, requirements, the milestone specs and per-milestone archives as written. | Record: immutable. Retrieval note in `history/README.md`. |
| `learnings/` | Post-mortems and lessons, dated filenames, content-immutable. | Record. |
| `research/` | Pre-decision material: the v3.x direction documents written before the retarget conversation. | Record; superseded by edges (a later doc names what it replaces). |
| `backlog/` | Deferred directions and known debt with content worth keeping. Each note names its issue; the issue is the status. | Record: deleted when the issue closes as done or not planned. |
| `superpowers/` | Gitignored scaffolding: specs, plans, the sidekick test-bench log. | Ephemeral. Never cited from tracked docs. |

Machine artifacts (agent definitions, prompts, test scenarios) live under `packages/`, not here.
