# The development harness

How guidance reaches whoever is building this repo, and why it is laid out this way. Present tense; the experiment behind the matrix is re-run when the layout or Claude Code changes.

## Layers

| Layer | Path | Loaded by | Holds |
|---|---|---|---|
| Project | `CLAUDE.md` → `AGENTS.md` | every session, every subagent, sidekick's executor (explicit read) | what applies everywhere: architecture, commands, code patterns, the package pointer block |
| Rules | `.claude/rules/*.md` | the main session (path-scoped by `paths:`); sidekick's executor (all files, explicit read); a Task subagent too, once it reads a file matching the rule's `paths:` (touch-triggered, not at dispatch) | domain rules: TypeScript, PostgreSQL, testing, sidekick's working standards, clean code, language, PM conventions, guidance authoring |
| Package | `packages/<pkg>/CLAUDE.md` | sessions started in that directory; the main session when it works on files there; a Task subagent too, once it reads a file inside that package (touch-triggered, not at dispatch) | what applies only to that package |
| Package skills | `packages/dashboard/.claude/skills/*` | sessions started in `packages/dashboard` | impeccable, shadcn, vercel-react-best-practices |
| Hooks | `.claude/settings.json` | every tool call, including subagents' | schema retention guard, `.env` staging guard, Biome on edit, context re-injection after compaction |
| Personal | `.claude/settings.local.json` (gitignored) | this machine | sidekick's config guard, personal permissions |

## Why the root file is a symlink

`CLAUDE.md` at the repo root is a symlink to `AGENTS.md`, not an `@`-import line. Two measured facts, from `docs/superpowers/harness-audit/import-experiment.md`, favour the symlink:

- An `@` import is not expanded for a session started inside a package (experiments E1, E2a). A nested `CLAUDE.md`'s upward `@../../AGENTS.md` reaches a Task subagent's context as the literal string, never as the file it names (experiment E2b).
- A symlink is read as content, from both the root and a package directory. Heading count comes back `1` from both cwds, which no import-based layout achieved from a package directory (experiment E3).

`sk-executor` reads `./CLAUDE.md` by a fixed path (`~/.claude/agents/sk-executor.md:40`), and `Read` does not expand `@`. A plain `@AGENTS.md` line at that path hands the executor ten characters, not the guidance; through the symlink, the same read returns `AGENTS.md`'s full content.

## What each kind of worker sees (measured 2026-09-16, Claude Code 2.1.273)

| Worker | `AGENTS.md` (via `CLAUDE.md` symlink) | `.claude/rules/sk-typescript.md` (path-scoped) | nested package `CLAUDE.md` | skills listed |
|---|---|---|---|---|
| headless, cwd = repo root | seen | not seen | not seen | seen |
| headless, cwd = `packages/dashboard` | seen | not seen | seen (dashboard) | seen (incl. dashboard skills) |
| headless, cwd = `packages/agents` | seen | not seen | seen (agents); not seen (dashboard) | seen (no dashboard skills) |
| Task subagent from root, before file access (A) | seen — stale, see note | not seen | not seen | seen |
| Task subagent from root, after reading a dashboard file (B) | seen — stale, unchanged from A | seen | seen (dashboard); not seen (agents) | seen — unchanged from A |
| Main session, cwd = repo root, after reading one `packages/agents/` file | not tested | not tested | seen (agents); not tested (dashboard) | not tested |

Full per-cell quotes, the `not seen` / `not tested` distinction, and a caveat on the two Task-subagent rows (their `AGENTS.md` content is a stale pre-restructure snapshot, not the file as it exists on disk) live in `docs/superpowers/harness-audit/after.md`.

## The Part 4 gate

The spec's gate (`docs/superpowers/specs/2026-09-15-project-reset-design.md`, Part 4 → Gates): "a worker spawned in `packages/dashboard` reports the UI skills and the design system; one in `packages/agents` reports the agent-first rules; a root worker reports neither package layer."

All three clauses pass, each against its own row in `after.md`:

- **`packages/dashboard` reports the UI skills and the design system — passed.** `headless-dashboard-after.txt` lists `impeccable, shadcn, vercel-react-best-practices` among its skills and reports `packages/dashboard/CLAUDE.md`'s `## Design system` heading.
- **`packages/agents` reports the agent-first rules — passed.** `headless-agents-after.txt` reports `packages/agents/CLAUDE.md`'s `## MANDATORY: Agent-First Decision Checklist` heading.
- **a root worker reports neither package layer — passed.** `headless-root-after.txt` states `packages/dashboard/CLAUDE.md` is "not visible in my context. The root CLAUDE.md only points at it," and lists no package `CLAUDE.md` — including `packages/agents/CLAUDE.md` — anywhere in its instruction-file enumeration.

## Consequences

- A task that sends a worker into a package names that package's `CLAUDE.md`; the pointer block in `AGENTS.md` is the backstop.
- Sidekick's executor reads `./CLAUDE.md`, `./.claude/rules/*.md`, and `./.sidekick/decisions/*.md`; anything it must know lives in one of those or is cited by the task.
- Rules are the expensive layer (every main-session turn). Add one only when reasoning alone can't get there (`.claude/rules/sk-guidance-authoring.md` §Admission).
- Third-party skills are never edited; scoping goes in the package `CLAUDE.md`.
- Hooks in `.claude/settings.json` take effect mid-session, not only at session start: a `PostToolUse` Biome hook added earlier in a session fired on a later `Edit` in that same session, without a restart (measured, Claude Code 2.1.273).
- A Task subagent's `AGENTS.md` is the parent session's copy from session start, not the file on disk. Measured: after the file was restructured, a subagent dispatched from a session predating the change still reported the old headings.
- A session that edits `AGENTS.md` or a package `CLAUDE.md` restarts before dispatching workers.
- `/sk-build` dispatching from a long-running session hands its executors stale guidance.

## Re-running the experiment

```bash
P='Do not use any tools. Reply with a bullet list and nothing else: (1) the H1 and H2 headings of every project instruction file currently in your context, (2) the first line of every rule file in your context, (3) the names of every skill listed to you, (4) the H1 of packages/dashboard/CLAUDE.md if you can see it, quoted exactly, (5) the first line of .claude/rules/sk-typescript.md if you can see it, quoted exactly.'
claude -p "$P" --no-session-persistence
(cd packages/dashboard && claude -p "$P" --no-session-persistence)
(cd packages/agents && claude -p "$P" --no-session-persistence)
```

Sources: `docs/superpowers/harness-audit/` (local), `~/.claude/agents/sk-executor.md` §execution_flow (installed copy of sidekick's executor).
