# Lessons from building v1 to v2.9 (recorded 2026-02)

These are the working principles the GSD-era build wrote down for itself, one row per lesson, as they stood on 2026-02-20. They are lessons, not rules: `AGENTS.md` carries the rules that still bind; `docs/adr/` carries the decisions. Kept because each one was paid for.

| Principle | Context |
|-----------|---------|
| Infrastructure phases must include consumer migration | Phase 19 created MCP servers but didn't wire agents to use them. When building infrastructure, include at least one consumer migration to validate end-to-end. |
| Pure library pattern for shared packages | @aesir/types should never validate env vars at import time. Services own their config and pass dependencies to libraries. |
| Agent-first problem solving | When an agent makes a wrong decision, fix the agent (prompts, tools, context) -- don't add deterministic overrides in workflow/activity code. |
| Prompts are first-class code | System prompts are the primary control surface for agent behavior. Test prompt changes against real scenarios. |
| Three-phase deletion order | Refactor references -> delete files -> remove deps. Prevents build breakage during large cleanups. |
| Archive before delete | Always create archive files before updating/deleting originals. Milestone completion creates roadmap + requirements archives first. |
| Local schema mirrors over cross-package imports | Dashboard mirrors agent schema locally to avoid importing @aesir/agents and its heavy dependency tree. Keep UI packages decoupled from backend internals. |
| Serialize at RSC boundaries | Date objects must be serialized as ISO strings before passing from server to client components. Enforce typed serialized interfaces at the boundary. |
| Static verification is necessary but insufficient | v2.5 code path tracing caught structural wiring issues, but 6 runtime bugs (migration journals, race conditions, deduplication, routing logic) only surfaced during live testing. Always validate E2E flows against running services. |
| Soft language for agent guidance | Task lifecycle, handoff quality, and delegation patterns use "prefer"/"tend toward" instead of MUST/ALWAYS/NEVER. Strong directives reserved for safety boundaries (wait_for, merge protection). |
| Domain abstraction over channel specifics | Agents should reason about intent (reply, ask, notify), not channels (Slack, Linear, GitHub). Infrastructure handles translation. Adding a new channel should not require agent prompt changes. |
| E2E testing catches what static verification misses | v2.7 live validation found 5 critical/major issues (orphan signals, depth tracking, timeout metadata) that code review and unit tests did not catch. Budget time for live validation of multi-agent workflows. |
| Hard constraints for critical agent behaviors | QA agent ended without completing tasks until a hard MUST constraint was added. For safety-critical tool calls (task:complete_task before end), strong directives earn their place. |

Sources: `.planning/PROJECT.md` §Principles (retrievable with `git show 39c7015c:.planning/PROJECT.md`).
