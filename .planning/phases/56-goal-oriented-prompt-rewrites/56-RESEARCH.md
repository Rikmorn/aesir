# Phase 56: Goal-Oriented Prompt Rewrites - Research

**Researched:** 2026-02-06
**Domain:** LLM prompt engineering, constitutional constraints, few-shot reasoning patterns
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **Framework plumbing classification**: Three kinds of prompt content get different treatment: framework contracts (keep as hard MUST/NEVER), context-reading instructions (move to tools/context section), behavioral preferences (drop unless testing proves needed).
- **Domain knowledge sections**: Product-agent `<issue_quality>` and dev-agent `<sub_agent_delegation>` survive as standalone sections, renamed and placed between constraints and examples.
- **Prompt structure extension**: identity -> constraints -> domain knowledge -> examples -> tools -> context. Domain knowledge slot between constraints and examples.
- **Error recovery decomposition (dev-agent)**: Decompose `<error_recovery>` into 3 constraints + 1 few-shot example. Drop diagnostic categorization buckets entirely.
- **Dev-agent complexity classification**: Remove SIMPLE/MODERATE/COMPLEX entirely. Agent calibrates effort based on what it discovers.
- **Product-agent few-shot examples (5)**: Clear bug report, vague request, multi-concern message, duplicate found, constraint tension. All input -> reasoning -> action format.
- **Dev-agent few-shot examples (5)**: Simpler than it looks, harder than it looks, wrong approach not wrong execution, what the sub-agent needs vs what I know, when to escalate. All show agent discovering something that changes initial assessment.
- **Traceability approach**: Matrix of old if/then rule -> failure it prevented -> new constraint or example that covers it. Deliverable artifact alongside prompts.

### Claude's Discretion

- Exact wording of constitutional constraints (as long as they're negative boundaries, not positive procedures)
- Whether domain knowledge sections use `<domain_knowledge>`, `<quality_criteria>`, `<delegation>`, or some other tag name
- How to adapt the product-agent examples to be abstract enough to not go stale when tools change
- Whether the dev-agent needs exactly 5 examples or if 4 covers the judgment space adequately
- Exact placement of `<slack_context_usage>` content (tools section preamble vs context section preamble)

### Deferred Ideas (OUT OF SCOPE)

- Updating PROMPT_GUIDE.md to formally recognize the domain knowledge section -- not Phase 56 scope (prompt rewrites only, not guide updates). Can be done after the pattern is validated.
- Worker agent (coder, researcher, tester) prompt improvements -- explicitly out of scope per spec.
- Prompt evaluation tooling (promptfoo, shadow mode) -- deferred to post-v2.5 per spec.
</user_constraints>

## Summary

This phase rewrites two orchestrator agent prompts (product-agent and dev-agent) from procedural state machines to constitutional + few-shot style. The research domain is prompt engineering patterns for agentic systems, specifically the structure and content of the rewritten prompts, how to build traceability matrices proving coverage, and framework constraints that the prompts must satisfy.

The primary challenge is decomposition: the current prompts are dense with procedural logic that encodes both framework invariants (which must be preserved) and behavioral guidance (which should be replaced with reasoning patterns). The research identified exactly which framework contracts exist by reading the actual executor code, catalogued every procedural rule in both current prompts for traceability extraction, and established the concrete structure for the rewritten prompts.

A critical finding is that **phase tags (`<phase>clarifying</phase>` etc.) are NOT parsed by the framework code**. The worker loop determines conversation status entirely from `waitForState.triggered` and `result.status` (Anthropic stop_reason). Phase tags exist only in the agent's text output and are not consumed by any code. This means they can be simplified to an observability convention in the rewritten prompts, significantly reducing the directive density around them.

**Primary recommendation:** Structure the work as two parallel tracks (product-agent rewrite + dev-agent rewrite), each producing the prompt file, traceability matrix, and passing the verification scenarios. The traceability matrix should be built FIRST (extracting rules from the current prompt), then the new prompt written to cover every row.

## Standard Stack

This phase involves no new libraries or dependencies. The deliverables are purely `.md` files (prompt.md rewrites and traceability matrices). The "stack" is the prompt structure defined in PROMPT_GUIDE.md.

### Core
| Component | Location | Purpose | Why Standard |
|-----------|----------|---------|--------------|
| PROMPT_GUIDE.md | `packages/agents/definitions/PROMPT_GUIDE.md` | Structure template for prompts | Defines section order and rules for all agent prompts |
| product-agent/prompt.md | `packages/agents/definitions/product-agent/prompt.md` | Current product agent prompt | File to be rewritten in-place |
| dev-agent/prompt.md | `packages/agents/definitions/dev-agent/prompt.md` | Current dev agent prompt | File to be rewritten in-place |
| product-agent/definition.yaml | `packages/agents/definitions/product-agent/definition.yaml` | Agent config (tools, model, limits) | Defines available tools, not changed in this phase |
| dev-agent/definition.yaml | `packages/agents/definitions/dev-agent/definition.yaml` | Agent config (tools, model, limits) | Defines available tools, not changed in this phase |

### Supporting
| Artifact | Location | Purpose | When to Use |
|----------|----------|---------|-------------|
| Traceability matrix (product-agent) | `.planning/phases/56-*/traceability-product-agent.md` | Maps old rules to new coverage | Deliverable -- built before writing new prompt |
| Traceability matrix (dev-agent) | `.planning/phases/56-*/traceability-dev-agent.md` | Maps old rules to new coverage | Deliverable -- built before writing new prompt |

## Architecture Patterns

### Target Prompt Structure (Extended from PROMPT_GUIDE.md)

```
<identity>
  2-3 sentences: who, goal, operating model.
  Chain-of-thought guidance: <reasoning> blocks before significant decisions.
  Constraint priority ordering: safety > correctness > efficiency.
</identity>

<constraints>
  Constitutional negatives (5-7 max per agent).
  Framework contracts that break the system if violated.
  Each constraint earns its place -- no filler.
</constraints>

<domain_knowledge>   (NEW: between constraints and examples)
  Reference material the agent checks its work against.
  Product-agent: issue quality criteria (renamed from <issue_quality>).
  Dev-agent: sub-agent delegation guide (renamed from <sub_agent_delegation>).
</domain_knowledge>

<examples>
  3-5 few-shot scenarios: input -> reasoning -> action.
  At least one example resolving a constraint tension.
  Abstract reasoning, not literal tool call syntax.
</examples>

<tools>
  Available tools with purpose notes.
  Slack context usage instructions (moved from behavioral rules).
  Framework injected -- prompt states purpose, not tool lists.
</tools>

<context>
  Dynamic per-conversation context.
  Injected by framework at conversation start.
</context>
```

### Pattern 1: Constitutional Constraint Authoring

**What:** Write constraints as negative boundaries that define what the agent must NOT do, leaving the positive space for reasoning.

**When to use:** For every behavioral rule in the current prompt.

**Formula:**
```
Old: "FIRST, search for related/duplicate issues with linear_search_issues"
New: "Never create a Linear issue without first checking for duplicates"

Old: "Send it to the user for confirmation via slack_send_message"
New: "Never create an issue the user hasn't seen and confirmed"
```

The constraint defines the boundary. The agent decides HOW to satisfy it.

### Pattern 2: Few-Shot With Reasoning

**What:** Each example shows input, the agent's internal reasoning process, and the resulting action. The reasoning is the critical teaching element.

**When to use:** To replace every if/then branch in current prompts.

**Formula:**
```
User: [message]
Reasoning: [what the agent considers, what it notices, why it chooses this approach]
Action: [what the agent does -- described abstractly, not as tool calls]
```

Key properties:
- Reasoning explains the WHY, not just the WHAT
- Actions are described abstractly (not `call linear_search_issues`) so they don't go stale when tool names change
- Each example teaches a judgment pattern the agent can generalize

### Pattern 3: Selective Chain-of-Thought (PROMPT-04)

**What:** Orchestrator agents write `<reasoning>` blocks before significant decisions for observability.

**When to use:** Before delegating work, creating artifacts, asking for approval, choosing between strategies.

**Not needed for:** Routine tool calls, simple acknowledgments, following through on decisions already made.

**Placement:** In `<identity>` section as part of the agent's operating model. Not as a constraint (it's additive, not restrictive).

### Pattern 4: Constraint Priority Ordering (PROMPT-05)

**What:** Explicit hierarchy when constraints conflict: safety > correctness > efficiency.

**Placement:** In `<identity>` section, after chain-of-thought guidance.

**Example:**
```
When constraints conflict, prioritize: safety first (never create unconfirmed
artifacts, never lose data), then correctness (get the right answer), then
efficiency (minimize token usage and tool calls).
```

### Anti-Patterns to Avoid

- **State machines in natural language:** Any "IF [condition] THEN [step 1, step 2, step 3]" construct. Replace with constraint + example.
- **Prescriptive tool sequences:** Any "FIRST call X, THEN call Y, THEN call Z". The agent has tools and decides when to use them.
- **Classification gates:** Any "SIMPLE TASKS: do X, MODERATE TASKS: do Y, COMPLEX TASKS: do Z". Let the agent calibrate based on discovery.
- **Directive stacking:** More than 7 MUST/NEVER/ALWAYS/CRITICAL in an orchestrator prompt signals you're encoding a workflow, not guiding judgment.
- **Intent detection encoding:** Listing phrases the user might say ("yes", "looks good", "go ahead") is work the model does natively.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Traceability matrix | Freeform narrative | Structured markdown table per agent | Rows are auditable; narrative loses individual rule coverage |
| Few-shot examples | Literal tool call sequences | Abstract reasoning patterns | Tool names change; reasoning patterns are stable |
| Phase tag guidance | Extensive procedural rules about when to emit each tag | Simple note that text output is for internal use | Framework doesn't parse phase tags -- they're observability only |
| Cancellation detection | Lists of cancel phrases | Trust the model + one constraint | Claude natively understands cancellation intent |

**Key insight:** The current prompts encode ~40 procedural rules across both agents. Every one needs a traceability row. The matrix is a mechanical extraction exercise, not a creative one. Build it by reading the current prompt line-by-line.

## Common Pitfalls

### Pitfall 1: Dropping Framework Contracts

**What goes wrong:** The rewrite removes a rule that looks like "behavioral guidance" but is actually a framework invariant that breaks the system.
**Why it happens:** Framework contracts are mixed into behavioral sections in the current prompts.
**How to avoid:** The traceability matrix explicitly categorizes each rule as "framework contract" (keep as hard constraint) or "behavioral guidance" (replace with example/remove). Framework contracts identified from code analysis:
- `wait_for` MUST be called before the conversation can pause (executor uses `waitForState.triggered`)
- Text output is internal only -- user communication MUST go through tools (Slack)
- Conversation ends when agent stops calling tools (Anthropic `end_turn` stop reason)
**Warning signs:** Any constraint removal where the "failure prevented" column says "executor breaks" or "conversation hangs."

### Pitfall 2: Phase Tags Are Not Framework Contracts

**What goes wrong:** Excessive prompt space dedicated to phase tag rules because PROMPT_GUIDE.md claims "executor parses these."
**Why it happens:** PROMPT_GUIDE.md line 137 and 179 states phase tags are parsed by the executor. But the actual executor code (`worker-loop.ts`) does NOT parse them. Conversation status is determined entirely by `waitForState.triggered` (from `wait_for` tool) and `result.status` (from Anthropic stop_reason `end_turn`).
**How to avoid:** Treat phase tags as an observability convention, not a framework contract. They can remain in the prompt as a lightweight way for the agent to signal its internal state in text output, but they do NOT need MUST/ALWAYS/CRITICAL directives. Reduce them to a single sentence: "End your text output with a `<phase>` tag indicating your current state (for observability)."
**Warning signs:** More than 2 sentences about phase tags in the rewritten prompt. The current prompt has 15+ references to phase tags.

### Pitfall 3: Examples That Go Stale

**What goes wrong:** Few-shot examples reference specific tool names (`linear_search_issues`, `slack_send_message`) that may change when tools are renamed or the MCP layer evolves.
**Why it happens:** Copying current prompt patterns directly into examples.
**How to avoid:** Use abstract action descriptions: "search for duplicates," "message the user," "create the issue." The `<tools>` section tells the agent which tools exist. The examples teach reasoning patterns.
**Warning signs:** Tool names appearing in `<examples>` section.

### Pitfall 4: Over-Constraining the New Prompt

**What goes wrong:** Fear of behavioral regression leads to preemptively adding back behavioral preferences that the model handles natively (Rule 7 of PROMPT_GUIDE.md).
**Why it happens:** The old prompt has explicit rules for things like "ask one question at a time" and "keep messages concise." Removing them feels risky.
**How to avoid:** The CONTEXT.md decision is clear: drop behavioral preferences unless testing proves needed. Start with the minimal prompt, test scenarios, add back only what demonstrably regresses. The traceability matrix flags these as "model does natively -- test before re-adding."
**Warning signs:** More than 7 constraints in the `<constraints>` section. The target is 5-7.

### Pitfall 5: Incomplete Traceability Matrix

**What goes wrong:** Some procedural rules are dropped without identifying what covers the failure they prevented. This creates hidden regression risk.
**Why it happens:** It's tedious to trace every if/then rule to a specific failure mode and then to a specific new coverage mechanism.
**How to avoid:** Mechanical extraction: read the current prompt line by line. Every imperative statement (MUST, ALWAYS, NEVER, step 1/2/3) gets a row. No exceptions.
**Warning signs:** Matrix has fewer rows than the count of imperative statements in the original prompt.

### Pitfall 6: Losing the wait_for/end_turn Contract

**What goes wrong:** The agent stops calling `wait_for` before pausing, causing conversations to end permanently instead of pausing.
**Why it happens:** The procedural rules `"call wait_for with type 'user_reply' BEFORE emitting <phase>clarifying</phase>"` are removed, and the replacement constraint doesn't clearly convey that without `wait_for`, the conversation dies.
**How to avoid:** This is a genuine framework contract. The constraint should be: "When you need external input before continuing (user reply, approval, review), call wait_for to pause the conversation. Without wait_for, the conversation ends permanently when your turn finishes."
**Warning signs:** The traceability matrix row for this rule should be marked "framework contract -- keep as hard constraint."

## Code Examples

### Example: Product-Agent Identity Section

```markdown
<identity>
You are the product agent for Aesir. You turn ideas, bug reports, and feature
requests from Slack conversations into well-structured Linear issues.

Before significant decisions (creating an issue, asking for clarification vs
proceeding, handling a duplicate), write your reasoning in a <reasoning> block.
This is stored for observability.

When constraints conflict, prioritize: safety first (never create unconfirmed
artifacts), then correctness (accurate issue content), then efficiency (minimize
back-and-forth).
</identity>
```

### Example: Product-Agent Constraints Section

```markdown
<constraints>
- Never create a Linear issue without first searching for duplicates
- Never create an issue the user hasn't seen and confirmed
- Never ignore a user's intent to cancel or change direction
- Communicate with the user only through slack_send_message -- text output is
  internal reasoning only, never user-facing
- When you need the user to respond before continuing, call wait_for to pause
  the conversation. Without wait_for, the conversation ends permanently when
  your turn finishes.
- Never claim an issue was created if the tool call failed -- check the result
</constraints>
```

Note: 6 constraints. Each prevents a specific, real failure. No behavioral preferences (conciseness, formatting) -- those are model-native.

### Example: Few-Shot With Constraint Tension (PROMPT-06)

```markdown
User: "We need to add rate limiting to the API endpoints"

Reasoning: Clear enough to act on -- the user wants rate limiting. Let me search
for duplicates first. I found AES-89 "Add throttling to public endpoints" from
two weeks ago -- it's related but scoped differently (throttling vs rate limiting,
and only public endpoints). This is adjacent, not a true duplicate. I should
mention AES-89 for context when I draft the new issue, but not ask a separate
question about it -- the user came with a clear request and I don't want to
derail them with "did you know about this tangentially related ticket?"

Action: Search for duplicates, find the related-but-different issue, draft a new
issue for rate limiting across all API endpoints, mention AES-89 as related
context in the same message, and ask for confirmation on the draft.
```

This example demonstrates resolving the tension between "always check for duplicates" and "don't overwhelm the user with questions."

### Example: Dev-Agent Constraint Section

```markdown
<constraints>
- Get human approval before creating a pull request for non-trivial changes
- Never retry the same failed approach -- if something fails, try a fundamentally
  different strategy
- After 3 distinct failed approaches for the same problem, escalate to a human
  with: what you tried, why each failed, your best diagnosis, and a suggested
  path forward
- Escalate infrastructure errors immediately (ECONNREFUSED, EACCES, ENOMEM,
  container issues) -- these cannot be fixed by changing code
- Share a token budget with sub-agents. Provide focused briefs -- each spawned
  agent costs tokens from the shared pool
- Never merge pull requests -- after creating a PR, report its URL and let a
  human reviewer handle merging
</constraints>
```

Note: 6 constraints. Error recovery is decomposed into constraints 2-4 instead of a procedural classification system. Complexity classification is removed entirely.

### Example: Traceability Matrix Row

```markdown
| Old Rule | Failure Prevented | New Coverage | Category |
|----------|-------------------|--------------|----------|
| "FIRST, search for related/duplicate issues with linear_search_issues using key terms" | Agent creates duplicate issue without checking | Constraint: "Never create a Linear issue without first searching for duplicates" + Example #1 (clear bug report -- agent searches before drafting) | Behavioral -> Constraint + Example |
| "Steps 1-5 happen in ONE turn" | Agent asks for confirmation before searching, creating a poor UX | Example #1 demonstrates doing search + draft + confirm in one turn. Agent learns the pattern from the example. | Behavioral -> Example |
| "Call wait_for with type 'user_reply' BEFORE emitting <phase>clarifying</phase>" | Conversation ends permanently instead of pausing | Constraint: "When you need the user to respond before continuing, call wait_for to pause. Without wait_for, the conversation ends permanently." | Framework contract -> Keep as constraint |
| "Do NOT call wait_for for terminal phases" | Agent calls wait_for when conversation should end, causing it to hang | Drop -- model understands when work is done. The constraint only mentions wait_for when you NEED input, implicitly covering this. | Behavioral -> Drop (model-native) |
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| If/then branching trees in prompts | Constitutional constraints + few-shot reasoning | Anthropic's January 2026 constitution update + Aesir PROMPT_GUIDE.md | Agents generalize to novel situations instead of breaking on unclassified inputs |
| Classification gates (SIMPLE/MODERATE/COMPLEX) | Calibrate-as-you-discover | PROMPT_GUIDE.md anti-pattern documentation | Agent adapts effort to actual complexity, not predicted categories |
| Prescriptive tool sequences | Tool-agnostic reasoning examples | PROMPT_GUIDE.md Rule 3 | Examples don't go stale when tools change |
| Heavy directive density (15+ MUST/NEVER) | 5-7 earned constraints | PROMPT_GUIDE.md Rule 4 | Fewer contradictions, model reasons in open space |

**Deprecated/outdated:**
- Phase tags as framework contracts: PROMPT_GUIDE.md claims executor parses them, but executor code does not. Treat as observability convention.
- Cancellation phrase lists: Model detects intent natively (PROMPT_GUIDE.md Rule 7).
- Intent classification ("USER CONFIRMS", "VAGUE REQUEST"): Model classifies intent natively.

## Critical Framework Contracts (From Code Analysis)

These are the actual framework contracts identified by reading the executor code. The rewritten prompts MUST preserve these:

| Contract | Source | Why It Matters |
|----------|--------|----------------|
| `wait_for` tool pauses conversation | `wait-for-tool.ts` -- sets `waitForState.triggered` | Without `wait_for`, the agent loop exits with `end_turn` and conversation goes to `completed`, not `waiting`. Conversation cannot resume. |
| Text output is internal | Worker loop stores `result.output` but doesn't parse it for user-facing content | All user communication must go through tools (slack_send_message). Text output is only stored in event log. |
| Conversation ends when agent stops calling tools | `run-agent-loop.ts` -- `end_turn` stop reason = `completed` | No explicit "end conversation" tool. The agent just stops. Framework interprets this as completion. |
| Agent loop is single-turn with history | Worker loop serializes messages for resumed conversations | Agent receives full prior history. No need for explicit state tracking in output. |
| Sub-agents have fresh context windows | `spawn_agent` creates new agent loop | Everything the sub-agent needs must be in the brief. Cannot reference parent conversation. |

## Procedural Rules Inventory (For Traceability)

Exhaustive count of imperative rules in current prompts that need traceability matrix rows:

### Product-Agent (Current Prompt)
1. `<identity>` -- 3 statements (mostly goal-oriented, minimal changes needed)
2. `<slack_context_usage>` -- 3 rules (MUST use channel/thread/team from context)
3. `<conversation_rules>` -- 8 rules (6 CRITICAL/MUST/ALWAYS, 2 behavioral)
4. `<behavior>` -- CLEAR REQUEST: 5 steps + 1 IMPORTANT
5. `<behavior>` -- VAGUE REQUEST: 4 steps
6. `<behavior>` -- USER CONFIRMS: 5 steps
7. `<behavior>` -- USER CANCELS: 2 steps
8. `<behavior>` -- NON-ACTIONABLE: 2 steps
9. `<behavior>` -- MULTI-ISSUE: 4 steps
10. `<issue_quality>` -- 8 criteria (keep as domain knowledge)
11. `<cancellation_detection>` -- 3 lists of phrases + reasoning note
12. `<duplicate_detection>` -- 5 procedural rules
13. `<tool_failure_handling>` -- 1 CRITICAL RULE + 4 steps + 3 error categories

**Total: ~50 imperative statements requiring traceability rows**

### Dev-Agent (Current Prompt)
1. `<identity>` -- 3 statements (mostly goal-oriented)
2. `<constraints>` -- 8 constraints (mix of framework and behavioral)
3. `<workflow_guidance>` -- 1 ALWAYS + SIMPLE (5 steps) + MODERATE (6 steps) + COMPLEX (9 steps)
4. `<sub_agent_delegation>` -- 4 numbered requirements + good/bad examples (keep as domain knowledge)
5. `<error_recovery>` -- 4 numbered steps + 4 categories + escalation rules
6. `<available_tools>` -- tool list with usage notes (keep/move to tools section)

**Total: ~35 imperative statements requiring traceability rows**

## Recommendations for Claude's Discretion Areas

### Domain Knowledge Tag Names

**Recommendation:** Use `<domain_knowledge>` as a generic tag for both agents, with a subtitle inside.

Rationale: Using the same tag name creates consistency. The content inside is what differs. Example:
- Product-agent: `<domain_knowledge>` containing "Issue Quality Criteria"
- Dev-agent: `<domain_knowledge>` containing "Sub-Agent Delegation"

### Slack Context Usage Placement

**Recommendation:** Place as a preamble to `<tools>` section, before the tool list.

Rationale: Slack context usage is about how to use tools correctly (extracting channel/thread IDs). It's operational "how to use your tools" guidance, not a behavioral constraint. Placing it in `<tools>` keeps it co-located with the tool information the agent needs.

### Product-Agent Example Abstraction

**Recommendation:** Use abstract action descriptions throughout. Example: "search for duplicates" not "call linear_search_issues." "Message the user" not "call slack_send_message."

Rationale: Tool names may change (e.g., `linear_search_issues` -> `linear:search_issues` or tools get renamed). The `<tools>` section already tells the agent what tools exist. Examples should teach reasoning, not tool usage.

### Dev-Agent Example Count

**Recommendation:** Keep all 5 examples. Each covers a distinct judgment dimension that the others don't:
1. Don't over-invest (efficiency judgment)
2. Escalate hidden complexity (complexity judgment)
3. Approach vs execution failure (diagnostic judgment)
4. Brief quality for sub-agents (delegation judgment)
5. When to escalate to humans (escalation judgment)

Dropping any one loses coverage of a distinct failure mode. 5 examples is within the PROMPT_GUIDE.md "3-5 sweet spot."

## Open Questions

1. **Phase tags: keep or remove?**
   - What we know: Framework doesn't parse them. They exist only in text output.
   - What's unclear: Are they consumed by any external observer (dashboard, logs analysis)? The event log stores `result.output` which contains them.
   - Recommendation: Keep as a lightweight observability convention (one sentence in identity). Don't dedicate constraints or multiple instructions to them. If the dashboard or any other system actually parses these from the output text, that should be surfaced before removing them entirely.

2. **Testing without eval tooling**
   - What we know: Automated eval tooling (promptfoo) is deferred. Manual testing of 5-6 scenarios per agent is the plan.
   - What's unclear: What constitutes a "pass" for manual testing? The traceability matrix shows coverage, but how do we verify the agent actually follows the new prompt correctly?
   - Recommendation: Define specific test scenarios in the plan with expected behaviors. Run each scenario with the new prompt and verify the agent: (a) doesn't violate any constraint, (b) produces reasonable output for the scenario, (c) calls wait_for when needed. Document results alongside the traceability matrix.

3. **Interaction with Phase 59 (Prompt Evolution)**
   - What we know: Phase 59 will add task lifecycle guidance to these same prompts.
   - What's unclear: Should Phase 56 prompts leave placeholder sections for task tools?
   - Recommendation: No placeholders. Phase 56 writes prompts for the current tool set. Phase 59 adds task-related content to the prompts it needs. Clean separation of concerns.

## Sources

### Primary (HIGH confidence)
- `packages/agents/definitions/PROMPT_GUIDE.md` -- Prompt structure, rules, anti-patterns
- `packages/agents/definitions/product-agent/prompt.md` -- Current product-agent prompt (source of procedural rules)
- `packages/agents/definitions/dev-agent/prompt.md` -- Current dev-agent prompt (source of procedural rules)
- `packages/agents/src/framework/worker-loop.ts` -- Executor code proving phase tags are not parsed
- `packages/agents/src/framework/wait-for-tool.ts` -- wait_for implementation proving framework contract
- `packages/agents/src/shared/agent-loop/run-agent-loop.ts` -- Agent loop proving end_turn = completed
- `.planning/specs/2.5-agentic-conversations.md` -- Phase 1 spec with deliverables and pitfall mitigations
- `.planning/specs/2.5-design-vision.md` -- Prompt engineering philosophy

### Secondary (MEDIUM confidence)
- [Anthropic's updated constitution (January 2026)](https://www.anthropic.com/news/claudes-constitution) -- Reason-based over rule-based alignment
- [PromptHub: Prompt Engineering for AI Agents](https://www.prompthub.us/blog/prompt-engineering-for-ai-agents) -- Agent prompt best practices
- [Agents At Work: The 2026 Playbook](https://promptengineering.org/agents-at-work-the-2026-playbook-for-building-reliable-agentic-workflows/) -- Agentic workflow patterns

### Tertiary (LOW confidence)
- [Claude Prompt Engineering Best Practices 2026](https://promptbuilder.cc/blog/claude-prompt-engineering-best-practices-2026) -- General prompt tips
- [Few-Shot Prompting Guide](https://www.promptingguide.ai/techniques/fewshot) -- Few-shot technique reference

## Metadata

**Confidence breakdown:**
- Prompt structure: HIGH -- Based on PROMPT_GUIDE.md (project-authoritative source) and actual codebase analysis
- Framework contracts: HIGH -- Based on reading actual executor/worker-loop/agent-loop source code
- Traceability approach: HIGH -- Based on exhaustive reading of current prompts with line-by-line rule counting
- Few-shot patterns: MEDIUM -- Based on PROMPT_GUIDE.md examples + Anthropic's constitutional AI principles; effectiveness is proven in testing, not in advance
- Phase tag finding: HIGH -- Verified by searching entire codebase for phase tag parsing; zero matches in framework code

**Research date:** 2026-02-06
**Valid until:** 2026-03-06 (stable domain -- prompt patterns don't change rapidly)
