# Phase 56: Goal-Oriented Prompt Rewrites - Context

**Gathered:** 2026-02-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Rewrite product-agent and dev-agent prompts from procedural state machines to constitutional + few-shot style, following PROMPT_GUIDE.md structure. Produce traceability matrices proving coverage of every removed rule. No framework code changes — this is purely prompt authoring.

Worker agent prompts (coder, researcher, tester) are explicitly out of scope — they just execute, they don't need the constitutional/few-shot overhaul.

</domain>

<decisions>
## Implementation Decisions

### Framework plumbing in prompts

The current prompts mix three kinds of content. Each gets different treatment:

**Framework contracts (keep as hard constraints):**
- "Communicate with the user only through slack_send_message — text output is internal only."
- "End every response with exactly one phase tag."
- "Call wait_for before emitting `<phase>clarifying</phase>` — without it the conversation ends permanently."

These are invariants the executor depends on. Getting them wrong breaks the system. They earn their MUST/NEVER.

**Context-reading instructions (move to tools/context section):**
- `<slack_context_usage>` — how to extract channel/thread/team IDs from the injected `<slack_context>` block. The agent can't function without this. Belongs near `<tools>` or as a preamble to `<context>`, not mixed with behavioral rules.

**Behavioral preferences (drop unless testing proves needed):**
- "Ask ONE question at a time" — the model does this natively (PROMPT_GUIDE Rule 7)
- "Keep Slack messages concise" — same
- "Reference what the user already told you" — same

If the rewritten prompt produces multi-question messages or verbose output during manual testing, add these back as soft constraints. Don't preemptively include them.

### Domain knowledge sections

Both agents have non-procedural domain knowledge that should survive the rewrite:

**Product-agent `<issue_quality>`**: Keep as standalone section (rename to `<quality_criteria>` or `<domain_knowledge>`). It's well-written criteria-based guidance — "clear actionable title starting with a verb", "3-7 acceptance criteria", "prefer vertical slices." Folding into examples would bloat them. Place between constraints and examples.

**Dev-agent `<sub_agent_delegation>`**: Keep as standalone section (rename to `<delegation>` or similar). The architectural fact ("sub-agents can't see your conversation history") and the brief checklist (objective, context, output format, boundaries) with good/bad examples are worth keeping nearly verbatim. Same placement — between constraints and examples.

### Prompt structure extension

PROMPT_GUIDE.md defines: identity → constraints → examples → tools → context. Both agents need a domain knowledge slot that doesn't fit cleanly into any of these. The natural position is between constraints and examples:

**identity → constraints → domain knowledge → examples → tools → context**

Domain knowledge is reference material the agent checks its work against. Constraints say what NOT to do. Examples teach reasoning patterns. Domain knowledge describes what GOOD output looks like.

### Error recovery decomposition (dev-agent)

Current `<error_recovery>` is procedural (numbered steps, classification buckets). Decompose into:

**Two constraints:**
1. "Never retry the same failed approach — if something fails, try a fundamentally different strategy"
2. "After 3 distinct failed approaches for the same problem, escalate to a human with: what you tried, why each failed, your best diagnosis, and a suggested path forward"
3. "Escalate infrastructure errors immediately (ECONNREFUSED, EACCES, ENOMEM, container issues) — these cannot be fixed by changing code"

**One few-shot example:** Agent receives sub-agent compile error, reasons through whether it's approach-wrong or execution-wrong, acts accordingly. (See example #3 in few-shot scenarios below.)

Drop the diagnostic categorization buckets (WRONG APPROACH / MISSING DEPENDENCY / CODE BUG / ENVIRONMENT ISSUE). This is a classification gate — the anti-pattern from PROMPT_GUIDE.md. The few-shot example teaches the same reasoning pattern without prescribing categories.

### Dev-agent complexity classification

Remove entirely. The current SIMPLE / MODERATE / COMPLEX classification with prescribed tool sequences per bucket is the exact anti-pattern the spec calls out. The agent should calibrate effort based on what it discovers, not classify into predefined buckets.

### Product-agent few-shot examples (3-5)

The current prompt has implicit examples buried in procedural rules. Extract and rewrite as input → reasoning → action:

1. **Clear bug report** — "The checkout page crashes when I click pay." Agent reasons it has enough detail, searches for duplicates, drafts issue, asks for confirmation.
2. **Vague request** — "Can you make a ticket for the login thing?" Agent reasons "the thing" is too vague, asks what specifically about login.
3. **Multi-concern message** — "We need SSO support and also the password reset is broken since Tuesday." Agent reasons these are two distinct issues, handles separately.
4. **Duplicate found** — Agent searches and finds an existing issue covering the same scope. Presents the existing issue and asks whether to update or create new.
5. **Constraint tension** — User provides a clear request but the agent's duplicate search reveals a related-but-different issue. Agent reasons about whether to mention it as context or treat it as a blocker, choosing to mention briefly without making it a separate question. (Demonstrates resolving the tension between "check for duplicates" and "don't overwhelm with questions.")

### Dev-agent few-shot examples (5)

The dev-agent has no examples today. These 5 scenarios cover the core judgment space — every example shows the agent discovering something that changes its initial assessment:

1. **"Simpler than it looks"** — Issue: "Add CORS headers to the API." Agent reads the codebase, finds an existing Express middleware setup with a shared config file. Reasoning: "This is a config change in one file, not a new middleware implementation. I don't need a researcher — I can read the file directly, spawn a coder with a focused brief, and skip the planning phase." Teaches: don't over-invest.

2. **"Harder than it looks"** — Issue: "Fix the timezone bug in the dashboard." Agent reads the mentioned file, discovers date handling is spread across 4 files with inconsistent patterns (some UTC, some local, no shared utility). Reasoning: "This looked like a single fix but it's a systemic problem. Fixing one file without addressing the pattern will create more bugs. I need a researcher to map all date handling, then a plan that addresses the root cause." Teaches: escalate when you discover hidden complexity.

3. **"Wrong approach, not wrong execution"** — Sub-agent reports compile error on a missing module. Agent checks codebase, realizes the API changed in a recent refactor — the brief assumed an old interface. Reasoning: "The coder followed my brief correctly but my brief was based on stale information. This isn't a code bug — I need to re-read the current interface and revise the implementation approach, not just retry with a 'fix the import' correction." Teaches: diagnose approach vs execution failure before retrying.

4. **"What the sub-agent needs vs what I know"** — Agent has researched the auth pattern (decorator in middleware/auth.ts, user on request context). Reasoning: "The coder doesn't have my conversation history. If I just say 'add an auth check' they'll spend tokens re-discovering all of this. I need to include the specific file paths, the pattern to follow, and a code snippet of the existing decorator." Teaches: vague briefs cost sub-agent tokens.

5. **"When to escalate"** — Two migration approaches both hit data integrity issues (FK violation, then deadlock). Reasoning: "Two fundamentally different strategies, both hitting integrity issues. This suggests a constraint I don't understand — possibly production data that makes this unsafe. Rather than burning budget on a third guess, I should escalate with what I've learned so the human can tell me if there's a known constraint I'm missing." Teaches: escalation is a skill, not a failure. Quality of the escalation matters.

**Core pattern:** Product-agent judges human intent. Dev-agent judges technical reality. Every dev-agent example shows updating assessment based on new information.

### Traceability approach

Per spec: matrix of old if/then rule → failure it originally prevented → new constraint or example that covers it. Every removed procedural rule must have an identified replacement. Manual testing of 5-6 key scenarios per agent before and after. No automated eval tooling (deferred).

The matrix is a deliverable artifact, not just a mental exercise. It lives alongside the rewritten prompts (probably as a markdown table in the phase directory or committed alongside the prompt changes).

### Claude's Discretion

- Exact wording of constitutional constraints (as long as they're negative boundaries, not positive procedures)
- Whether domain knowledge sections use `<domain_knowledge>`, `<quality_criteria>`, `<delegation>`, or some other tag name
- How to adapt the product-agent examples to be abstract enough to not go stale when tools change
- Whether the dev-agent needs exactly 5 examples or if 4 covers the judgment space adequately
- Exact placement of `<slack_context_usage>` content (tools section preamble vs context section preamble)

</decisions>

<specifics>
## Specific Ideas

- Dev-agent examples should all follow the pattern: agent discovers something that changes its initial assessment. This is the core judgment loop.
- Product-agent's constraint tension example should show the duplicate-vs-related-issue judgment — a case where "never create without checking duplicates" and "don't overwhelm with questions" could conflict.
- The traceability matrix should be concrete enough that someone could look at any row and understand: "this old rule prevented [specific failure], and now [specific constraint/example] covers it."
- PROMPT_GUIDE.md structure should be acknowledged as extended: identity → constraints → domain knowledge → examples → tools → context. But this is a Phase 56 observation, not a PROMPT_GUIDE.md editing task — the guide can be updated if the pattern proves useful.

</specifics>

<deferred>
## Deferred Ideas

- Updating PROMPT_GUIDE.md to formally recognize the domain knowledge section — not Phase 56 scope (prompt rewrites only, not guide updates). Can be done after the pattern is validated.
- Worker agent (coder, researcher, tester) prompt improvements — explicitly out of scope per spec.
- Prompt evaluation tooling (promptfoo, shadow mode) — deferred to post-v2.5 per spec.

</deferred>

---

*Phase: 56-goal-oriented-prompt-rewrites*
*Context gathered: 2026-02-06*
