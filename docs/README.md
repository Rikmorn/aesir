# docs/ — what lives where

Modelled on sidekick's docs taxonomy (its own `docs/README.md`), using the folders aesir needs. One is aesir's own: `reference/` holds the living docs that sidekick keeps at its `docs/` root.

**The placement test** is sidekick's, from `sk-pm-conventions.md`: true now → `reference/` · happened → `adr/`, `learnings/` · being designed → `designs/<topic>/` · to do or doing → an issue on `Rikmorn/aesir`, whose board is the status surface. Deferred work lives in its issue alone.

| Folder | Meaning | Lifecycle |
|---|---|---|
| `reference/` | How the project is today. Present tense, no history. | Living: corrected whenever the source moves. |
| `adr/` | Architecture decisions that still bind, one per file, MADR-lite. | Record: status transitions only (accepted → superseded), never rewritten. |
| `designs/` | Designs in progress, one folder per topic holding its `design.md`, written by sidekick's `sk-design`. Its supporting files sit beside it: research reports, and the source of any rendered pages, which `scripts/docs-builder/` builds into a gitignored `site/`. A planned design names the issues it became. | Ephemeral: the folder is deleted when its issues close, once any research that outlives it has moved to `research/<topic>/`. |
| `learnings/` | One record per closed issue or milestone worth keeping. `learnings/README.md` states the bar and the shape. | Record. |
| `research/` | Grounding reports, one topic per folder. Research done inside a design sits beside its `design.md` until it outlives the design. | Record; superseded by edges (a later doc names what it replaces). |
| `superpowers/` | Gitignored working space: plans and their run reports, surveys, scratch research, `sk-design`'s shape-scale notes, and the sidekick test-bench log. | Ephemeral: deleted when its work closes. Never cited from tracked docs. |

Machine artifacts (agent definitions, prompts, test scenarios) live under `packages/`, not here. Code that generates docs lives under `scripts/`.

Two folders were retired in #98 (2026-09-30), and git keeps both at `1b6d6ce9`. `history/` held the GSD-era record of v1 → v2.9; `git show 1b6d6ce9:docs/history/README.md` is the way in. `backlog/` held notes on deferred work, now folded into their issues.
