---
name: design-pass
description: Use when a change would add a concept the code doesn't name, a second source or target of a kind that already exists, a branch on a discriminator (source, type, provider, channel), a contract change (event name, tool input schema, table key, a field's meaning), a change crossing the platform/integrations/agents layers, or a special-case bug fix; or when asked to evaluate a subsystem, propose a refactor, or judge how the code will absorb the next change.
disable-model-invocation: true
---

# Design pass

Adapted from odin's `design-pass` (2026-09-16) for aesir; the "In this repo" and "Handoff" sections are aesir's, the lenses were widened from pipeline design to platform and code organisation, the assessment shape was added for evaluations, and `references/patterns.md` indexes the recurring problem shapes. The skill stands alone: it needs no other tool. When sidekick is in play it is the step before `/sk-design` (sidekick #59).

## Overview

Think about the problem as a system before changing the code, so the change fits the problem rather than the code around it. The surrounding code is evidence of what exists, not of what is right. Matching it is a choice; make it consciously, say why, or say why not. A file that already has three special cases is an argument for a different shape, not a fourth case.

The pass ends in a decision, and the decision is the operator's. Aesir's architectural constraints already exist: `docs/reference/design-vision.md` (the principles and anti-patterns) and `AGENTS.md` §Architecture (the three layers and their dependency rules). Read them and cite the one that binds; do not restate them. `sk-working-standards.md` covers honesty and verification; `sk-clean-code.md` and `sk-typescript.md` cover the shape of code once written. This skill covers the step before all of those. Its outputs are a note, a decision, and whatever the decision registers (an issue, an ADR); nothing in it depends on another tool. When sidekick is in play, `/sk-design` starts from a change already in hand and writes the RFC, so this pass comes first and decides whether there is a change, what shape it takes, and what it costs; without sidekick, the same note feeds whatever planning follows.

## When to use

**Change mode**, before writing code when a change would:

- Add a concept the code doesn't name yet: a new entity, state, lifecycle, or agent role.
- Add a second source or target of a kind that already exists: a second issue tracker, a second embedding provider, a second delivery channel, a second tool namespace doing what one already does. The second is when you decide what the abstraction will be; the third is when building it becomes mandatory. This is `sk-clean-code.md`'s "tolerate duplication until the third occurrence", applied to design.
- Add a branch to an existing switch or if-chain on a discriminator: `source`, `channel`, `provider`, `entityType`, `signalType`.
- Change a contract: an event name or schema, a tool's input schema (the LLM-facing API), a table key, a field's meaning, an MCP endpoint.
- Cross a layer: platform, integrations, agents, or the dashboard reading another package's tables.
- Fix a bug by adding a special case. The special case is the symptom; find what the model can't express.

**Evaluation mode**, with no change in hand: asked to assess a subsystem, propose a refactor, judge whether something will scale, or explain a package to someone who will change it. The output is the assessment (below), and the decision becomes what to register and where.

Not for a fix within the existing shape, docs, tests, config, or renames. When unsure, write the five-line version.

## The note (change mode)

Write it before code, in chat or as a file. When the problem section runs past a screen, the note is a file from the start under `docs/superpowers/` and the chat carries the summary and the decision ask. In chat the sections are bold leads; in a file, headings. The order is deliberate, constraints before conclusion; do not reorder it to lead with the recommendation.

1. **Problem.** What is wrong, for whom, with evidence. Cite the file or the log line. A survey done by a subagent is evidence only once the lines the recommendation rests on have been re-read.
2. **Requirements and constraints.** Label each as verified (read the code, ran it) or assumed. A README claim is assumed until read in code. Name the design-vision principle or the layer rule that binds, by number or by quote. An assumption the design rests on gets called out again in the recommendation.
3. **System map.** The nouns and how they relate (one-to-many, owns, references, derives from), which package and layer each lives in, and where the extension point is today: a registry, a YAML definition, a switch, or nothing. When more than two concepts interact, draw it; ASCII is fine.
4. **Options.** Two or three, with tradeoffs. Each carries a pattern card (below). Check `references/patterns.md` for the problem shape and the question that picks between its candidate patterns; it is an index of what to weigh, not a menu to pick from, and "no pattern" is one of its rows. Look outside before writing them: a short search for a library, a platform feature (PostgreSQL, pg-boss, the Anthropic API), or a documented practice that handles the problem. Building by hand can be the right call, but only after the search, and the note says what was found and why it was or wasn't used.
5. **Recommendation.** Lead with it, then the assumptions it depends on. If an assumption is wrong, say what changes.
6. **Cost of the next change.** What the fifth similar change costs after this design: one registration and a YAML block, or edits in five packages. Say which, and whether the design moves the code toward "a new kind is a new registration".
7. **Blast radius.** Files, packages, contracts, tables, migrations, prompts, and who else is affected (the dashboard reads agents' tables; agent prompts name tools). Which steps can't be undone, what order they must go in, and what ships alone. Additive contract changes ship first and alone.
8. **Decision.** One of: do it now; do the seam now and register the rest; register it as debt for a dedicated session.

### Pattern card

Every option names what it follows, in four lines, so a reviewer can check it and a junior engineer can learn it:

- **Pattern:** the name (adapter, registry, discriminated union, strategy, state machine, saga, outbox, idempotency key, port and adapter) and the source when one exists.
- **Problem it solves and why it applies here:** one sentence each.
- **Where it already appears in aesir**, with a file, or "new here". The event adapters, the tool and agent registries, the factory-function DI convention, and the YAML definitions are the existing instances to check first.
- **What it costs and when not to use it:** the indirection, the second file to keep in sync, the case it cannot express.

"Refactor to be cleaner" is not an option. "Targets behind a port with capability descriptors, so the planner is the only reader of capabilities" is reviewable and teachable.

## The assessment (evaluation mode)

Same discipline, different shape, because there is no change to size:

1. **Scope and what was read.** Entry points, the data model, the boundaries, and the list of what was not read. An assessment that does not say what it skipped cannot be trusted on what it found.
2. **System map as-is.** Responsibilities per module, dependency direction against the layer rules, where state lives and who writes it, and the extension points: which kinds of change are a registration today and which are an edit across files.
3. **Forces.** What change is known to be coming (the design-vision "anticipate known-future" list, the board, the retarget), what is expensive today (measure it: a count of call sites, a count of switch arms, the number of packages a recent change touched), and what the operator has said matters.
4. **Findings.** Each with evidence (`file:line`), the principle or practice it works against, and the cost it imposes: on the next change, on operability, on testability. Ranked by blast radius, not by how easy the fix is.
5. **Proposals.** Each a pattern card plus blast radius plus sequence, shippable alone, with what it beats and what it costs. Two or three, not ten; the rest are findings with no proposal attached, and that is a valid outcome.
6. **Decision per proposal.** Do it now; do the seam now and register the rest; register it. Everything registered names its issue.

## Approval gates

Approve in three gates, not one and not seven.

1. **Problem and constraints first, on their own.** Everything rests on them and they are cheap to correct early. In evaluation mode: scope, map, and forces.
2. **Sub-problems one at a time**, when the operator pulls a thread. Each gets its own options and stance, nested inside the parent note.
3. **The integrated note once.** Options, recommendation, blast radius, and sequence together, because they are one choice, with a check that the sub-decisions compose.

Do not act on the recommendation until it is chosen, and do not treat silence as a choice. Ask a question when the answer would change the design; otherwise state the assumption and price both branches. With no operator to ask, take "register it as debt" and say so, never "do it now".

## Scale it to the stakes

A note can be five lines. Contract changes, anything the LLM sees (tool schemas, prompts, event names), anything crossing a layer, anything touching credentials or migrations, and anything hard to reverse get the full pass. A local change inside one module gets the short one. The test is whether a wrong choice is expensive to undo, not how many lines the change is.

## Lenses for aesir

Weigh each; say "not load-bearing here" when it is not, rather than skipping it.

- **Data model first.** State, identity, and lifecycle decide everything downstream. Who writes each field, what its terminal states are, whether two lifecycles share one record, and whether the event log or the projection is the truth (design-vision: events as ground truth).
- **Layer direction.** Agents reach integrations over MCP, never by import; platform imports nothing above it. A change that needs to break this is a design problem, not a lint exception.
- **Extension points.** A new kind should be a new registration (tool registry, agent registry, adapter list, YAML definition), not a new branch. Config is data. When the change is a fourth arm on a switch, the switch is the finding.
- **Contracts the LLM sees.** Tool input schemas, prompt text, event names, and signal types are public API. Additive over breaking; parse at the boundary (`sk-typescript.md`); a cast at the boundary hides exactly the property the other side rejects.
- **Concurrency and delivery.** Claims with `SKIP LOCKED`, heartbeats, the second delivery of the same webhook, a retry after the external call succeeded, a signal arriving before the conversation waits for it. Idempotency is a design property, not a fix.
- **Operability.** How a failure is seen: event log entry, dashboard state, log level, a stuck-conversation query. A bare `catch` is a design decision; make it on purpose.
- **Testability.** What the deterministic unit test looks like, and what seam it needs. LLM-judged scenarios cover behaviour, not plumbing; a design that can only be checked by a scenario run is a design that will not be checked.
- **Cost of the next change.** The fifth similar change: name its diff.
- **Reversibility.** Additive contract changes over breaking ones, flags over forks, data you can backfill over data you can't, a migration you can apply behind the running version.
- **Tradeoffs, stated.** Every design trades something. Say what.

## The design is itself a tradeoff

A better design with a large blast radius is not a reason to do it inside the current change. When the right shape means a contract migration, touches several packages, moves data, or costs more than a day or two: ship the narrow fix and say in the commit that it is narrow; take the seam if it is cheap; register the design as an issue with the options and tradeoffs already written.

Sometimes the hack is the right call. Make it a conscious one: say it is a hack, say what the operator accepted and why, register the debt with the next steps, and keep it to as few modules as possible. A hack with a note is a decision. A hack without one is an accident that will be mistaken for a design.

## Handoff

- **Do it now** → the note is the input to whatever plans the change. With sidekick: `/sk-design` (Roberto types it), whose RFC builds on the note's problem, constraints, system map, decision, and blast radius as settled and does not re-litigate them; re-asking a decided question is a defect in the handoff, not diligence. Without sidekick, or when it blocks: superpowers brainstorming then writing-plans, or a plain plan for a small change, with the same sections carried over; sidekick friction goes in the testbench log.
- **Seam now, register the rest** → the seam ships in the current change with the pattern card in the commit or PR; the rest becomes a GitHub issue with the options and tradeoffs already written, one `area:*` label, and the `backlog` label with its unblock condition if it is deferred on purpose.
- **Register it** → a GitHub issue as above. A decision that binds future work is an ADR under `docs/adr/` (or `.sidekick/decisions/` through `/sk-decide`); an exploration that outlives the session goes to `docs/backlog/` and names its issue. Working notes for the live session go under `docs/superpowers/`, which is gitignored. Nothing decided in the pass is lost when the spec narrows it.

## Red flags

| Thought | Reality |
|---|---|
| "The operator wants to start today, be decisive" | One plan is not a decision. Two or three options and a recommendation, then the gate. |
| "The seam is obviously right" | Say what it beats and what it costs, or it isn't reviewable. |
| "No time to look outside" | The search takes minutes. Building blind takes days. |
| "It's just one more case" | The fourth branch on a discriminator is a model that can't express the fourth thing. |
| "Match the file" | Consistency with a wrong shape spreads the wrong shape. |
| "Make it configurable, just in case" | Speculative generality. Take the seam, not the framework; wait for the shape. |
| "I generated the abstraction in a minute, so it's cheap" | Generation is cheap; the second file to keep in sync is not. Volume is not design. |
| "The subagent's survey said so" | Re-read the lines the recommendation rests on. A survey is a map, not evidence. |
| "We'll refactor later" | Later has no owner. Register it or it is forgotten. |
| "The fix satisfies the failing test" | Ask what else the same root cause breaks. |
| "Blast radius is implied by the file list" | That section is where "now or later" gets decided. Write it. |
| "The scenario suite will catch it" | It is LLM-judged and slow. Name the deterministic test, or the design is unchecked. |

## In this repo

- Architecture constraints: `docs/reference/design-vision.md` and `AGENTS.md` §Architecture; decisions that bind: `docs/adr/`. Read the package's `CLAUDE.md` before designing inside it, and treat what any README says as assumed until read in code.
- Work items are GitHub issues (`.claude/rules/sk-pm-conventions.md`); there is no tech-debt directory. `docs/backlog/` entries name their issue.
- Existing instances to point pattern cards at: event adapters under `packages/agents/src/adapters/`, the tool and agent registries under `packages/agents/src/framework/`, the tool namespaces under `packages/agents/src/shared/tools/`, the factory-function DI convention in `AGENTS.md` §Dependency Injection, and the YAML definitions under `packages/agents/definitions/`.
