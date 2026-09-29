# docs/ — what lives where

Modelled on sidekick's docs taxonomy (its own `docs/README.md`), using the folders aesir needs. Two are aesir's own: `reference/` holds the living docs that sidekick keeps at its `docs/` root, and `history/` holds the eleven milestones of record.

**The placement test** is sidekick's, from `sk-pm-conventions.md`: true now → `reference/` · happened → `adr/`, `learnings/`, `history/` · being designed → `designs/<topic>/` · to do or doing → an issue on `Rikmorn/aesir`, whose board is the status surface.

| Folder | Meaning | Lifecycle |
|---|---|---|
| `reference/` | How the project is today. Present tense, no history. | Living: corrected whenever the source moves. |
| `adr/` | Architecture decisions that still bind, one per file, MADR-lite. | Record: status transitions only (accepted → superseded), never rewritten. |
| `designs/` | Designs in progress, one folder per topic holding its `design.md`, written by sidekick's `sk-design`. Its supporting files sit beside it: research reports, and the source of any rendered pages, which `scripts/docs-builder/` builds into a gitignored `site/`. A planned design names the issues it became. | Ephemeral: the folder is deleted when its issues close, once any research that outlives it has moved to `research/<topic>/`. |
| `history/` | The frozen record of what was built, v1 → v2.9 (Jan–Feb 2026): milestones, phases, every recorded decision, requirements, the milestone specs, and the per-milestone archives for v1–v2.8, as written. | Record: immutable. Retrieval note in `history/README.md`. |
| `learnings/` | One record per closed issue or milestone worth keeping. `learnings/README.md` states the bar and the shape. | Record. |
| `research/` | Grounding reports, one topic per folder. Research done inside a design sits beside its `design.md` until it outlives the design. The v3.x direction documents, written before the retarget, sit at the top level until #98 decides them. | Record; superseded by edges (a later doc names what it replaces). |
| `backlog/` | Deferred directions and known debt with content worth keeping. Each note names its issue; the issue is the status. | Record: deleted when the issue closes as done or not planned. |
| `superpowers/` | Gitignored working space: plans and their run reports, surveys, scratch research, `sk-design`'s shape-scale notes, and the sidekick test-bench log. | Ephemeral: deleted when its work closes. Never cited from tracked docs. |

Machine artifacts (agent definitions, prompts, test scenarios) live under `packages/`, not here. Code that generates docs lives under `scripts/`. The one exception is `history/tools/`, which stays beside the frozen record it generated while #98 reviews `history/`.
