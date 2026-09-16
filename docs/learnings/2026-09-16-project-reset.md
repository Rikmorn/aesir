# The September 2026 project reset

Aesir was dormant from 2026-02-23 (v2.9 executed, never closed) to 2026-09-15. The reset retargeted the process, not the product: runtime behaviour, prompts and agent definitions stayed frozen. Four parts ran on 2026-09-15 and 2026-09-16 on `feat/project-reset` (PR #28). The spec, plans, worker ledgers and raw transcripts were local working context under `docs/superpowers/` and `.superpowers/`, deleted once this record existed; the merged tree, `docs/reference/dev-harness.md` and the issues are the record now.

## What changed

- **GitHub became the status surface** (Part 1): labels (`area:*`, `pkg:*`, `backlog`, `change-request`), milestone `R1 — Project reset`, project board #3, the first 27 issues. GSD and its `.planning/` tree were retired.
- **Repo reset** (Part 2): dead config and seven unused dependencies out; bun replaces tsx for running TypeScript; dependencies current within range; 16 stale worker-loop tests skipped against #1; `test:fast`, `lint` and `typecheck` green from a cold start.
- **Docs consolidation** (Part 3): `.planning/` consolidated into `docs/` — `reference/` (living), `adr/`, `history/` (frozen, with reproducible extractors under `docs/history/tools/`), `learnings/`, `research/`, `backlog/` — then deleted; every file is retrievable with `git show 39c7015c:<path>`.
- **Harness audit** (Part 4): guidance laid out where each kind of worker reads it, verified by experiment. Root `CLAUDE.md` is a symlink to `AGENTS.md`; per-package `CLAUDE.md` files under `packages/{agents,dashboard,integrations}`; the dashboard vendors its UI skills; one path-scoped TypeScript rule; a Biome-on-edit hook and a permissions allowlist. `docs/reference/dev-harness.md` carries the measured visibility matrix and the commands that regenerate it.

## How it ran

One plan per part, executed with superpowers' subagent-driven development: a worker session ran each plan with a fresh implementer and reviewer subagent per task and reported per task to an orchestrator session, which verified reports against the tree, ruled on plan defects, and filed issues. Roberto decided every outward-facing step (push, merge, tags) directly with the acting session; relayed authorisation was refused by design. Part 4 alone recorded 23 rulings (A–W) — the working rule was that a wrong ruling costs a visible revert, while a session parked on a question costs the day.

Roberto's verdict at the close: the remaining setup work is handled one issue at a time, not as aggregate plans like these.

## Lessons that earned their place

1. **An expected value is measured or it is written "measure and report".** The plan defects that survived pre-audit were checks nobody had run: a `grep -c '<'` expecting `0` against a template that itself contained `<pkg>`; a merge script whose double `sed` emptied the file it was merging; a "698 files" figure that reproduced under no method (602, `git ls-files '*.ts' '*.tsx' | wc -l`). Every count in a plan, a commit message or a doc now carries the command or the date that produced it (`.claude/rules/sk-working-standards.md` §Numbers that go stale).
2. **State the scope before measuring, and ask what it omits.** Part 3's last defect survived three fix rounds because every round measured `.planning/phases/` and nobody asked about `.planning/milestones/v2.8-phases/`. Part 4's matrices name what they do not cover.
3. **Never generalise a mechanism across worker kinds.** The headless sessions used no tools, so only the subagent rows had tested touch-triggered loading; a reviewer caught the cells that had borrowed the subagent's mechanism. Each row's claim rests on that row's method.
4. **Measure the fix, not only the defect.** The planned fix for sk-executor's `./CLAUDE.md` read — a one-line `@AGENTS.md` import — would have handed it ten characters, because `Read` does not expand `@`. Measuring the proposed fix is what turned it into the symlink.
5. **When a premise moves, hunt the conclusions that rested on it.** Moving sections out of `AGENTS.md` left `README.md`, `docs/reference/design-vision.md` and two ADRs pointing at the old place. A `git grep` for the moved headings found them; the diff review did not, because the stale lines were outside the diff.
6. **Suspect stale build state before calling a regression.** `dist/` and `*.tsbuildinfo` explained a gate failure that read as one (#29).
7. **Keep an orchestrator-side record from the start.** Plan 3's ledger was deleted by the worker's own close-out step before a hold request reached it, and its rulings had to be reconstituted. Plan 4 kept a record outside the worker's workspace, and nothing was lost.

## Mechanism facts (Claude Code 2.1.273, measured 2026-09-16)

Canonical in `docs/reference/dev-harness.md`; listed here because they overturned assumptions the plans were written on.

- `@` imports expand only in the cwd-level `CLAUDE.md` — never in a parent-directory file loaded from a package cwd, never in an on-demand nested file. A symlink is read as content from every cwd, and an explicit `Read` follows it.
- Task subagents do receive `.claude/rules/`: unscoped files at dispatch, `paths:`-scoped ones and a package `CLAUDE.md` on their first read of a matching file. The February 2026 note saying otherwise is superseded.
- A Task subagent's `AGENTS.md` is its parent session's copy from session start. A session that edits guidance restarts before dispatching workers.
- Hooks added to `.claude/settings.json` take effect mid-session.

## Where the follow-ups went

Aesir: #29–#34 (Parts 2–3 findings) and #35–#39 (Part 4: a `definition.yaml` guard hook, a scaffold skill behind it, context7, a stale note in the router system prompt, the Biome hook's shell-write gap). Sidekick, from the test-bench log reviewed on 2026-09-16: Rikmorn/sidekick#64–#72 and a comment on #48. Two observations on superpowers' SDD skill were deliberately not filed — not this project's tool, and sidekick is its replacement here.

## Tags

The eleven GSD-era tags (`v1`, `v2.0`–`v2.9`) existed only locally and nothing was ever released. They were deleted on 2026-09-16 and every provenance pointer rewritten to the commit `39c7015c`; the tag-to-commit table is in `docs/history/README.md`. Whether the project tags releases is decided once the setup work is done.
