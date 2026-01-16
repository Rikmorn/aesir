# Phase 6: Observability - Context

**Gathered:** 2026-01-16
**Status:** Ready for planning

<vision>
## How This Should Work

When a task fails or behaves unexpectedly, I should be able to query by task ID and see exactly what the agent did step by step. This is debug-focused observability — when something goes wrong, I can trace the entire execution flow.

The ideal is querying by task ID (more future-proof, easy to put in a DB later), but if that's too complicated for MVP, per-task log files would work as a stepping stone.

Dashboards and audit trails are important but belong in a future phase. For now, the focus is on being able to trace and debug agent behavior.

</vision>

<essential>
## What Must Be Nailed

- **Query by task ID** — Provide a task ID, get back everything that happened during that task's execution
- **Full execution trace** — Must capture:
  - Node transitions (pickup_task → generate_code → run_tests → ...)
  - External calls (Linear, GitHub, sandbox) with inputs and outputs
  - LLM interactions (prompts sent, model responses)

</essential>

<specifics>
## Specific Ideas

- If query-by-ID is too complex for MVP, fall back to per-task log files
- Structure should be DB-ready for future persistence layer
- Standard structured logs that can be grepped/filtered in terminal as fallback

</specifics>

<notes>
## Additional Context

This phase is about debugging capability, not operational dashboards or compliance. The user wants to understand what went wrong when tasks fail — a developer-focused trace rather than enterprise observability.

</notes>

---

*Phase: 06-observability*
*Context gathered: 2026-01-16*
