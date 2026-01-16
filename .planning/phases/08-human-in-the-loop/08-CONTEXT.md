# Phase 8: Human-in-the-Loop - Context

**Gathered:** 2026-01-16
**Status:** Ready for research

<vision>
## How This Should Work

PR-based approval flow. When the Dev Agent finishes its work and opens a PR, the workflow pauses and waits for human review in GitHub — where developers already work.

When the human approves the PR, the agent automatically merges it and moves the Linear task to the appropriate status. The target status is configurable per project (not hardcoded to "Done") since different teams have different workflows.

When someone requests changes on the PR, the agent reads the feedback and attempts to fix it automatically. But the agent should be willing to ask for help rather than spinning on the wrong thing — value delivery over false autonomy.

</vision>

<essential>
## What Must Be Nailed

- **Never merge without approval** — The gate is sacred. No auto-merging unreviewed code. This is the core safety mechanism.
- **Smooth feedback loop** — Agent reads PR feedback and responds quickly and correctly. When changes are requested, it attempts fixes automatically.
- **Configurable completion** — Target Linear status after merge varies per project, not hardcoded.

</essential>

<specifics>
## Specific Ideas

- Approval happens in GitHub PR review (not Slack buttons)
- Slack is for notifications, GitHub is for approval
- Agent should iterate on feedback but know when to ask for help
- Design for iteration — this flow will evolve with real usage and feedback

</specifics>

<notes>
## Additional Context

User emphasized this phase will likely evolve frequently as they get usage and feedback. The implementation should be structured to make changes easy. Avoid over-engineering the first version, but keep the architecture flexible.

The philosophy: agents are trying to deliver as much value as possible and should work with people if it helps achieve that goal. Better to ask for help than churn on the wrong thing.

</notes>

---

*Phase: 08-human-in-the-loop*
*Context gathered: 2026-01-16*
