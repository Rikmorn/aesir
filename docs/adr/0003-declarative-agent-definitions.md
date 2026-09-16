# ADR-0003: Agents are declarative definitions: YAML plus a prompt file

**Status:** accepted (v2.3, 2026-02-04)
**Supersedes / superseded by:** —

## Context

Before v2.3, an agent's identity, tools, and limits lived in TypeScript — constants like `ORCHESTRATOR_SYSTEM_PROMPT`, factories like `createOrchestratorToolkit()`, and inline values such as `maxIterations ?? 100`. Changing what an agent was meant editing code and redeploying. The design question was whether definitions should be code objects, following the OpenAI Agents SDK style, or declarative data, following Claude Code's Markdown-file style; persistence settled it — data can be version-controlled, managed externally, and created at runtime without a redeploy, where code objects can't. Separately, by v2.5 the product-agent and dev-agent prompts still encoded 79 or more imperative if/then statements as procedural state machines, which proved unreliable and inflexible against novel input.

## Decision

Every agent is a directory under `packages/agents/definitions/` containing a `definition.yaml` (identity, model, tool references, sub-agent map, guardrails, history configuration, triggers) and a `prompt.md` (the raw, unescaped system prompt text). Tool implementations stay in code, because they carry runtime dependencies (MCP clients, containers, loggers); tool *selection* is data — the YAML's `tools:` list of string references, resolved by the `ToolRegistry` to factory functions. Prompt files follow the constitutional-plus-few-shot style set out in `packages/agents/definitions/PROMPT_GUIDE.md`: a goal-oriented identity, constraints stated as negatives rather than procedures, few-shot examples that carry their reasoning, and minimal directive density — not if/then branches encoding a state machine in natural language.

## Consequences

- Adding a new agent is a new directory with zero code changes; five agents were defined declaratively at v2.3's ship.
- A definition's `version` is an explicit commit, so a running conversation stays pinned to the version it started with, and rollback is a deliberate redeploy of version N-1, not an undo of the last few field edits.
- The v2.5 prompt rewrite removed 79 or more imperative statements from product-agent and dev-agent, replacing them with constitutional constraints and reasoning examples.
- `PROMPT_GUIDE.md` gives human and LLM contributors one shared ruleset for prompt authoring, so consistency doesn't depend on any single author's judgment.
- Committed the project to keeping runtime dependencies out of definitions entirely: the framework infers what a definition needs — a container, say — from its tool references, never from a field on the definition itself.

## Sources

- `git show 39c7015c:.planning/PROJECT.md`, `## Key Decisions`: rows "Declarative YAML + prompt.md agents", "Constitutional + few-shot prompt style".
- `docs/history/specs/design-vision.md`, `## Design Decisions Log`: rows "Agent definitions as YAML + Markdown data", "Prompt rewrites use constitutional + few-shot approach", "Prompt guide as formal ruleset".
- `docs/history/specs/2.3-spec-raw.md`, `### 1. Agent Definition`; Appendix `### A.3 Agent Definition: Key Design Debates`.
- `packages/agents/definitions/PROMPT_GUIDE.md` — current prompt structure and authoring rules.
