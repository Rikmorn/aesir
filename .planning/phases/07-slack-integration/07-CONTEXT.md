# Phase 7: Slack Integration - Context

**Gathered:** 2026-01-16
**Status:** Ready for planning

<vision>
## How This Should Work

The agent posts notifications to Slack like a CI bot — quiet, to the point, only when something actually needs human attention. When a PR is ready for review or there's a blocking decision, a message appears. That's it.

No activity streams. No "agent started working on X" noise. Just the moments where a human needs to know something or take action.

The destination (channel or DM) should be configurable — some teams will want a dedicated #dev-agent channel, others will want it in their existing dev channel, some might want DMs to the assignee.

</vision>

<essential>
## What Must Be Nailed

- **Minimal noise** — Only notify when human attention is truly needed. If you can ignore it, it shouldn't be a notification.
- **Approval gates focus** — The primary use case is "PR is ready for your review" or "I need a decision to continue"
- **Configurable destination** — Let users decide where notifications go (channel ID, DM to user, etc.)

</essential>

<specifics>
## Specific Ideas

- Notification bot pattern, not interactive assistant (for now)
- Keep messages concise and actionable
- Architecture should be abstraction-friendly for future generalization

</specifics>

<notes>
## Additional Context

**Future vision (v2+):** Full bidirectional chat capability where:
- Agent can ask clarifying questions in Slack
- Humans can query the agent, give commands, have conversations
- Generalizable to MS Teams and other internal comms platforms

This is explicitly out of scope for v1. The current phase focuses on one-way notifications only. The architecture should be clean enough to extend later, but no need to over-engineer for the future.

User priority: "Basic and to the point" — resist the urge to add features.

</notes>

---

*Phase: 07-slack-integration*
*Context gathered: 2026-01-16*
