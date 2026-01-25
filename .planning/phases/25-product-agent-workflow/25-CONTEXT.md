# Phase 25: Product Agent Workflow - Context

**Gathered:** 2026-01-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Product-agent receives Slack messages, engages in clarifying conversation, and creates well-structured Linear issues. The workflow: Listen → Interpret → Discuss → Refine → Create → Notify. Output is Linear issues clear enough for dev-agent to execute without ambiguity.

Reference: `.planning/2.1-rob-context.md` contains full workflow diagrams and handoff contract.

</domain>

<decisions>
## Implementation Decisions

### Actionability Filter
- Trigger: @mention only (no passive monitoring)
- LLM classification determines message type: feature request, bug report, question, or not actionable
- Feature requests and bug reports → enter workflow, create issues
- Questions → polite decline ("I create issues. For questions, check Linear or ask the team.")
- Off-topic → polite decline ("I help with feature requests and bug reports.")
- When uncertain about classification → ask the user to clarify

### Conversation Style
- Thread is the conversation boundary — all replies go in thread
- No hard limit on questions — Claude determines appropriate depth per request
- User can short-circuit with "just create it" → agent summarizes assumptions and confirms before proceeding
- Timeout: 24h reminder ("Still want to create this feature?"), 72h archive with final message
- Cancel ("nevermind") → archive like timeout, no issue created
- Archive = Slack thread is the record, no special storage needed

### Issue Structure
- Descriptive context paragraphs + checkbox summary (both formats)
- Always link back to Slack conversation thread in issue description
- Always assign "agent-ready" label for dev-agent routing
- Auto-assign labels and priority based on content (feature vs bug, urgency words)
- Single Linear team (configured via LINEAR_TEAM_ID environment variable)

### Work Splitting
- Large requests split into workable chunks (shippable increments)
- Product-agent fetches recent issues/labels from Linear via MCP for project context
- LLM reasoning proposes sensible splits based on Linear context
- Linking strategy: Claude decides based on relationship
  - Decomposed work (parts of whole) → Parent with sub-issues
  - Related but independent → Separate with "relates to" links
  - Sequential dependencies → Blocking relationships
- Note: Single backend + multiple frontend repos is the project structure (future improvement area)

### Confirmation Flow
- Always show draft issue in Slack thread before creating
- Format: "I'll create this issue: [preview]. Confirm?"
- Create only after explicit user confirmation

### Channel/User Scope
- Channel allowlist — only responds to @mentions in configured channels
- Anyone in allowed channels can trigger the agent
- Mentions in non-allowed channels → polite decline with list of allowed channels
- DMs disabled for v2.1 — focus on channel workflow first

### Claude's Discretion
- Question depth per conversation (no hard limit)
- Error messaging when Linear API fails
- Handling concurrent conversations (independent threads)
- Workflow state storage (Temporal handles this)

</decisions>

<specifics>
## Specific Ideas

- "Agents work like junior coworkers — ask good questions, do thorough research, plan before acting, produce quality output"
- Product-agent asks "why" and "for whom" — key questions for good issue writing
- Issue output artifact: problem statement (what/why), scope (in/out), acceptance criteria (testable), context links
- Bar for quality: "competent junior developer" — reasonable and reviewable

</specifics>

<deferred>
## Deferred Ideas

- DM support — disabled for v2.1, add later if there's demand
- Simple question answering via Linear lookup — requires more infrastructure
- Channel-to-team mapping — stick with single team for v2.1
- Project documentation context — would help splitting decisions but requires maintenance
- Multi-repo awareness — agent currently assumes single team structure

</deferred>

---

*Phase: 25-product-agent-workflow*
*Context gathered: 2026-01-25*
