# docs/ — what lives where

Aesir follows sidekick's docs layout, which the plugin ships as `skills/sidekick/references/docs-layout.md` and the `sidekick` skill points at. It says, for each folder, what goes in it, who writes and deletes its files, and how long they last. `sk-pm-conventions.md` §Placement test (tense) decides which folder a piece of writing belongs in. This file lists only what aesir adds to the layout or overrides; a `README.md` inside a folder does the same for that folder.

## What aesir adds

- **Rendered design pages.** A design that presents itself as a site keeps the page bodies in `designs/<topic>/spec/`, and `scripts/docs-builder/` builds them into the design's gitignored `site/` and `dist/`. The design's `design.md` gives the commands.
- **`superpowers/` is gitignored.** The layout leaves that choice to the repo.
- **Reference beside the code.** A package's `README.md` is its implementation guide, and a package with concerns of its own adds a `CLAUDE.md`. Both are reference docs whose home is the package, not `reference/`. `reference/` holds what spans packages.
- **Machine artifacts stay out of `docs/`.** Agent definitions, prompts and test scenarios live under `packages/`, and code that generates docs lives under `scripts/`.

## Retired folders

Two folders were retired in #98 (2026-09-30), and git keeps both at `1b6d6ce9`. `history/` held the GSD-era record of v1 to v2.9; `git show 1b6d6ce9:docs/history/README.md` is the way in. `backlog/` held notes on deferred work, now folded into their issues.
