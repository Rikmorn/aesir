# Phase 9: Product Agent - Context

**Gathered:** 2026-01-18
**Status:** Ready for research

<vision>
## How This Should Work

The Product Agent lives in Slack — a conversational assistant that helps people articulate what needs to be built. When someone has an idea or requirement, they chat with the agent naturally. The agent asks clarifying questions, helps them think through the problem, and ultimately creates well-structured Linear tasks.

The conversation flow should feel natural like talking to Claude, but still guided — similar to the GSD discuss-phase workflow. The agent doesn't just passively listen; it actively helps crystallize vague ideas into actionable work. It's a thinking partner, not a form filler.

Once requirements are clear, the agent creates tasks in Linear that the Dev Agent can pick up. The whole flow is: conversation → understanding → Linear tasks → Dev Agent picks up → code.

</vision>

<essential>
## What Must Be Nailed

This is the most crucial phase of the entire build — it either works or falls apart here. Three things are equally critical:

- **Task quality** — Creating well-structured, actionable tasks that the Dev Agent can actually work on. Bad input = bad output.
- **Context gathering** — Asking the right questions to fully understand what needs to be built. The agent must be good at drawing out requirements.
- **Seamless handoff** — Smooth transition from conversation to tasks to Dev Agent picking them up. No friction, no manual intervention.

</essential>

<specifics>
## Specific Ideas

**Conversation style:**
- Natural flow like Claude/ChatGPT — conversational, clarifies when unclear, summarizes understanding
- But still guided like a PM interview — structured enough to capture who, what, why, acceptance criteria
- Reference: exactly like the GSD discuss-phase workflow we've been using

**Tool-native persistence:**
- All data lives in Linear, not a separate system
- Uses Linear properly: projects, milestones, task organization
- Agent should be a "professional user" of Linear — knows the tool deeply

**Generalization for future tools:**
- Abstract the tool integration layer
- Design so Jira (or other PM tools) can be added later without rewriting the agent
- Tool usage patterns should be generalizable

</specifics>

<notes>
## Additional Context

**Future multi-agent vision:**
This phase is the foundation for a larger vision — emulating the GSD workflow with distributed specialized agents:
- One agent for gathering requirements/context (like discuss-phase)
- One agent for research (like research-phase)
- One agent for planning/task creation (like plan-phase)
- Multi-agent orchestration to be explored in future versions

This means the Product Agent should be designed with composability in mind. It's not just a monolithic agent — it's the first step toward a distributed agentic platform that mirrors the human-Claude workflow we've been using.

**Why this matters:**
The user has explicitly called out this phase as make-or-break. If requirements gathering fails, everything downstream fails. The quality bar here is higher than other phases.

</notes>

---

*Phase: 09-product-agent*
*Context gathered: 2026-01-18*
