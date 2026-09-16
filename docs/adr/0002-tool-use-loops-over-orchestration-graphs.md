# ADR-0002: Agentic tool-use loops instead of orchestration graphs

**Status:** accepted (v2.2, 2026-01-31)
**Supersedes / superseded by:** —

## Context

Through v2.1 the dev agent ran as a 13-node LangGraph graph and the product agent as a 6-node graph, with control flow driven by a `routeByPhase()` switch statement over a fixed phase enum, and LLM calls made through `@langchain/anthropic`'s text-completion wrapper rather than native tool-use. Event routing was a hardcoded event-type-to-handler mapping in each agent's `events.ts`. This meant the graph, not the LLM, decided what happened next at every step — whether research was needed, how much planning to do, when to escalate — regardless of what the actual task called for.

## Decision

Agents run as agentic tool-use loops on `@anthropic-ai/sdk`'s native tool-use API instead of as LangGraph state-machine graphs: each iteration, the LLM reasons about the situation, picks a tool, observes the result, and decides what to do next, with no external graph or `routeByPhase()` switch prescribing the sequence. The dev agent becomes an orchestrator that spawns focused sub-agents — researcher, coder, tester — each with isolated, fresh context for the work it's asked to do; the product agent becomes a single adaptive loop. Incoming events reach a hybrid smart router: deterministic fast-path rules handle unambiguous events, and an LLM classifies the ambiguous remainder, replacing the hardcoded event-type switch.

## Consequences

- Agents calibrate their approach to the actual task — whether to research, how much to plan, when to escalate — instead of following a graph node sequence built for the average case.
- Dropping the LangChain wrapper for the Anthropic SDK directly gives full control over tracing, budgets, and integration.
- Spawned sub-agents keep their own context small and focused, since each gets a fresh context boundary rather than sharing the orchestrator's full history.
- Common events resolve with zero LLM latency via the fast path, reserving LLM reasoning for the genuinely ambiguous cases.
- Every `@langchain/*` dependency was removed and 51 LangGraph files deleted.
- Committed the project to no external workflow engine driving agent control flow, at any tier — orchestrator or sub-agent.

## Sources

- `git show 39c7015c:.planning/PROJECT.md`, `## Key Decisions`: rows "Agentic loops over fixed graphs", "@anthropic-ai/sdk native tool-use", "Orchestrator + sub-agents pattern", "Hybrid smart router".
- `docs/history/specs/design-vision.md`, `## Design Decisions Log`: row "Control flow via tool calls, not orchestration graphs".
- `docs/history/specs/2.2-spec-raw.md`, `## What Changes vs. v2.1`; `### 3. Smart Router`; `### 4. Dev Agent Orchestrator`.
- `docs/history/milestones.md`, `## v2.2 Agentic Architecture` — "Every `@langchain/*` dependency removed, 51 LangGraph files deleted".
