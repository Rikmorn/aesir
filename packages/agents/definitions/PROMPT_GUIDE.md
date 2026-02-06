# Agent Prompt Authoring Guide

Rules for writing and reviewing agent prompts in Aesir. Applies to all contributors — human and LLM.

## Prompt Structure

Every prompt.md follows this section order. Sections are separated by XML tags for clear boundaries between stable instructions and dynamic content.

```
<identity>
  Who the agent is and what it exists to achieve.
  2-3 sentences. Goal-oriented. No procedures.
</identity>

<constraints>
  What the agent must NOT do. Constitutional negatives.
  Each constraint earns its place — no filler.
</constraints>

<examples>
  Few-shot examples with reasoning.
  3-5 scenarios showing input → reasoning → action.
</examples>

<tools>
  Available tools and their purpose.
  Injected by framework — do not hardcode tool lists.
</tools>

<context>
  Dynamic per-conversation context.
  Task handoffs, prior work, external state.
  Injected by framework at conversation start.
</context>
```

**Instructions (identity, constraints, examples) are stable** — they don't change between conversations. **Context changes every time.** Never mix the two. The agent must be able to distinguish "this is how I always behave" from "this is what's happening right now."

## Rule 1: Goal-Oriented Identity

The identity section states what the agent exists to achieve, not how it should work.

**Do:**
```
You are the product agent for Aesir. You help users turn ideas, bug reports,
and feature requests into well-structured Linear issues through conversation.
```

**Don't:**
```
You are the product agent. When a user sends a message, first determine if
it's a clear request or vague request. If clear, search for duplicates then
draft an issue. If vague, ask one clarifying question.
```

The first gives purpose. The second gives a procedure that breaks on any input that doesn't fit the two categories.

## Rule 2: Constitutional Constraints

State what the agent must not do. Leave the positive space open for the agent to reason about.

**Do:**
```
<constraints>
- Never create a Linear issue without first checking for duplicates
- Never create an issue the user hasn't seen and confirmed
- Never ask more than one question at a time
- Never ignore a user's request to cancel or change direction
</constraints>
```

**Don't:**
```
<behavior>
1. FIRST, search for related/duplicate issues
2. If duplicates found, tell user what you found
3. If no duplicates, draft the FULL issue
4. Call wait_for with type "user_reply"
5. IMPORTANT: Steps 1-4 happen in ONE turn
</behavior>
```

The constraints define boundaries. The procedures define a state machine. Constraints are robust to novel situations; procedures break on anything unexpected.

**When to use a constraint vs leave it to judgment:**
- Constraint: the violation would cause real harm (duplicate issues, unseen changes, data loss)
- Judgment: reasonable people might disagree on the right action (how much detail to ask for, whether to search broadly or narrowly)

## Rule 3: Few-Shot Examples With Reasoning

Replace if/then branching with examples that teach the reasoning pattern. Always include the reasoning — without it, examples are just a lookup table.

**Do:**
```
<examples>

User: "The checkout page crashes when I click pay"
Reasoning: Clear bug report — I know what (checkout crash), when (clicking pay).
This is enough to search for duplicates and draft a well-scoped issue.
Action: Search for related issues, draft a bug report, confirm with user.

User: "Can you make a ticket for the login thing?"
Reasoning: Too vague to create a useful issue — "the thing" could be anything.
Creating now would produce something no one can act on.
Action: Ask what specifically about login needs attention.

User: "We need SSO support and also the password reset is broken since Tuesday"
Reasoning: Two distinct concerns — a feature request and a bug. Mixing them
into one issue would complicate triage and assignment.
Action: Handle each separately, confirm between them.

</examples>
```

**Don't:**
```
CLEAR REQUEST (what + why + enough detail):
→ search → draft → wait_for → <phase>clarifying</phase>

VAGUE REQUEST (missing what, why, or details):
→ ask ONE question → wait_for → <phase>clarifying</phase>

USER CONFIRMS ("yes", "looks good", "go ahead"):
→ create issue → <phase>complete</phase>
```

Examples teach pattern recognition. If/then branches teach rule following. The agent that learned from examples handles the message that's half-clear and half-vague. The agent following branches doesn't know which branch to take.

**How many examples:** 3-5 is the sweet spot. Cover the common case, an edge case, and a case that requires judgment. Don't try to cover every scenario — the point is teaching reasoning, not building a lookup table.

## Rule 4: Minimize Directive Density

Every MUST, ALWAYS, NEVER, IMPORTANT, and CRITICAL overrides the agent's reasoning. Each one should earn its place.

**Reserve strong directives for:**
- Safety boundaries (don't delete production data, don't merge without tests)
- Framework requirements (phase tags that the executor must parse)
- Invariants that are genuinely never wrong to enforce

**Use softer language for behavioral guidance:**
- "Prefer X over Y" instead of "ALWAYS do X"
- "When in doubt, lean toward X" instead of "MUST do X"
- "X tends to produce better outcomes because..." instead of "NEVER do Y"

**The test:** If you can imagine a reasonable scenario where the agent should violate the directive, it shouldn't be a MUST. If the directive would never be wrong in any context, it's a valid constraint.

**Audit regularly:** Count directives in each prompt. If an orchestrator agent has more than 10 strong directives, something is wrong — you're encoding a workflow, not guiding judgment.

## Rule 5: Chain of Thought for Orchestrators

Orchestrator agents (product-agent, dev-agent) externalize their reasoning before significant decisions. Worker agents (coder, researcher, tester) do not — they just execute.

**For orchestrators, include in identity:**
```
Before making significant decisions (delegating work, creating artifacts,
asking for approval), write your reasoning in a <reasoning> block. This
is stored for observability — explain what you're considering and why
you're choosing this approach.
```

**What counts as "significant":**
- Choosing to delegate vs handle directly
- Deciding how much research/planning is needed
- Determining whether to ask for clarification or proceed
- Choosing to escalate or retry after a failure

**What doesn't need explicit reasoning:**
- Routine tool calls (reading a file, searching)
- Following through on a decision already made
- Simple acknowledgments or status updates

The purpose is debuggability, not ceremony. If the reasoning would just be "I'm reading this file because I need to understand the code," skip it.

## Rule 6: Structured Output at Boundaries Only

Use structured output (XML tags, specific formats) only where the framework needs to parse agent output. Everything else stays natural language.

**Framework boundaries (structured):**
- Phase tags: `<phase>complete</phase>` — executor parses these
- Handoff blocks: `<handoff type="...">` — framework stores these
- Reasoning blocks: `<reasoning>` — event log captures these

**Agent communication (natural language):**
- Messages to users (Slack, comments)
- Handoff context content (inside the structured envelope)
- Agent-to-agent delegation briefs
- Error descriptions and status updates

Don't invent new structured formats unless the framework has code that parses them. Unused structure is noise that constrains the agent for no benefit.

## Rule 7: Trust the Model

LLMs are good at understanding intent, reading context, and choosing appropriate actions. Don't encode things the model does natively.

**Don't encode intent detection:**
```
# Bad — the model already understands confirmation
USER CONFIRMS (intent to proceed -- e.g., "yes", "looks good", "go ahead", "create it")
```

**Don't encode conversation management:**
```
# Bad — the model naturally manages conversation flow
Ask ONE question at a time. Wait for the answer before asking another.
IMPORTANT: Do NOT ask multiple questions in a single message.
```

If you find yourself listing examples of phrases the user might say, or writing rules about basic conversation etiquette, you're doing work the model already does. Write a constraint only if the model has demonstrably failed at this in testing — not preemptively.

**The exception:** When the agent's natural behavior conflicts with a product requirement. If the model tends to be verbose but the product needs terse responses, a constraint is warranted. But "the model might not do this" is not sufficient reason — test first, constrain only if needed.

## Anti-Patterns

### State machines in natural language

```
# Anti-pattern: encoding a flowchart in Markdown
IF clear request:
  1. Search for duplicates
  2. Draft issue
  3. Call wait_for
  4. Emit <phase>clarifying</phase>
IF vague request:
  1. Ask one question
  2. Call wait_for
  3. Emit <phase>clarifying</phase>
```

Natural language is the worst encoding for deterministic logic. It's followed inconsistently (worse than code) and can't adapt to novel situations (worse than reasoning). If behavior must be deterministic, put it in executor code. If it shouldn't be deterministic, don't encode it at all.

### Prescriptive tool sequences

```
# Anti-pattern: telling the agent which tools to call and in what order
1. FIRST call linear_search_issues to check for duplicates
2. THEN use slack_send_message to show the draft
3. THEN call wait_for with type "user_reply"
```

The agent has tools and knows what they do. It decides when to use them based on the situation. Prescribing sequences removes the agent's ability to adapt — what if search returns an error? What if the user already mentioned there are no duplicates?

### Directive stacking

```
# Anti-pattern: layering directives that fight for priority
IMPORTANT: Always search before creating.
CRITICAL: Never search more than once per turn.
MUST: Search results must be shared with the user.
IMPORTANT: Do NOT share search results if no duplicates found.
```

Contradictory directives force the agent to guess which one "wins." The more directives you add, the more conflicts emerge. If you need this many rules to control behavior, the prompt's approach is wrong.

### Complexity classification gates

```
# Anti-pattern: the agent classifies, then follows the corresponding recipe
SIMPLE TASKS (typo, config change): skip research, just fix it
MODERATE TASKS (add function, fix bug): research then implement
COMPLEX TASKS (new feature, refactor): research, plan, get approval, implement
```

The agent should calibrate its approach based on the situation, not classify into buckets. A "simple" typo fix that turns out to touch a critical path deserves more care. A "complex" feature that's well-specified might not need extensive research. Let the agent reason about risk and scope, not follow a lookup table.

## Reviewing Prompts

When reviewing a prompt (your own or another contributor's), check:

1. **Count directives.** More than 10 strong directives (MUST/ALWAYS/NEVER) in an orchestrator prompt is a red flag. More than 5 in a worker prompt is a red flag.
2. **Look for if/then branches.** Any "IF [condition] THEN [do steps]" is a state machine. Replace with examples.
3. **Check for prescribed tool sequences.** The agent should choose tools, not follow a script.
4. **Read the examples.** Do they include reasoning? Do they cover edge cases? Could the agent generalize from them?
5. **Test the constraint test.** For each MUST/NEVER, ask: "Is there a reasonable scenario where the agent should violate this?" If yes, soften it.
6. **Verify separation.** Are instructions mixed with context? Can you tell what's stable vs what changes per conversation?
