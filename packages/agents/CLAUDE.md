# packages/agents

The agent runtime: executor, worker loop, event log, registries, router, tools, and the declarative definitions under `definitions/`. The checklist below governs every change here; `definitions/PROMPT_GUIDE.md` governs prompts. Project-wide rules are in the root `AGENTS.md`.

## MANDATORY: Agent-First Decision Checklist

Before modifying ANY file in `packages/agents/definitions/` or `packages/agents/src/framework/`, apply these checks:

1. **Is this agent behavior or infrastructure?**
   - Agent behavior (HOW to communicate, WHAT to decide, WHEN to act) --> Fix via **prompt or tool changes**, NOT framework code
   - Infrastructure (timeouts, retries, signal handling, conversation lifecycle) --> OK as framework code

2. **Am I pattern-matching on agent output to add behavior?**
   - If your code inspects agent results to decide what to do next (e.g., `if (result.field)` --> call Slack/Linear/GitHub), that's an anti-pattern. The AGENT should make that decision via its tools during its loop.

3. **Could this logic live in the system prompt instead?**
   - If the agent has the tools to do it and just isn't doing it, the fix is a prompt change, not a code change. Prompt fixes are cheaper, more flexible, and let the agent adapt to context.

Violations create brittle systems where the wrapper code fights the agent for control.

### Agent-First Problem Solving

When an agent makes a wrong decision, fix the agent -- don't add deterministic overrides.

**The principle:** Agents reason about their environment through tools and context. When something goes wrong, the fix should be:
1. **Better prompts** -- give the agent clearer instructions for the scenario
2. **Better tools** -- give the agent the ability to detect and handle the situation
3. **Better context** -- give the agent more information to make good decisions

**Anti-patterns to avoid:**
- Adding `if/else` logic in framework code that overrides the agent's decision
- Hardcoding error recovery paths that the agent should handle via reasoning
- Pattern-matching on agent output to "correct" it in executor code
- Moving classification logic out of the LLM into deterministic rules (unless the event is genuinely unambiguous -- see fast-path criteria below)

**When deterministic logic IS appropriate:**
- **Fast-path routing**: Events that are genuinely unambiguous (e.g., `linear.agent_session.created` always starts dev-agent). The test: "would every reasonable person route this the same way?"
- **Infrastructure concerns**: Timeouts, max iteration limits, heartbeat management, conversation lifecycle -- these are executor domain, not the agent's
- **Data validation**: Schema validation at system boundaries (Zod), not semantic validation of agent decisions

### Writing Agent Prompts

**Full guide: `packages/agents/definitions/PROMPT_GUIDE.md`** — read it before writing or reviewing any prompt.

Prompts are the primary control surface for agent behavior. These rules apply when writing or modifying any `prompt.md` file:

**Goal-oriented, not procedure-oriented:**
- Describe WHAT the agent should achieve and the JUDGMENT CRITERIA for decisions -- not step-by-step procedures
- Bad: "IF clear request THEN 1. search issues 2. draft issue 3. call wait_for 4. emit phase tag"
- Good: "Your goal is to turn user requests into well-structured Linear issues. Search for duplicates when relevant. Confirm with the user before creating. Use your judgment on how much clarification is needed."
- The agent decides the tool sequence based on reasoning, not because the prompt prescribed it

**No state machines in natural language:**
- Never encode if/then/else branching trees that classify input and prescribe different tool sequences per branch
- If behavior genuinely must be deterministic (e.g., always search before creating), put it in executor code where it's testable -- not in a prompt where it'll be followed inconsistently
- State machines in Markdown are the worst of both worlds: unreliable like an LLM, inflexible like code

**Judgment criteria over rigid rules:**
- Instead of "SIMPLE TASKS: skip research" / "COMPLEX TASKS: get approval", describe what makes something risky and let the agent calibrate
- Bad: "MUST always call wait_for after drafting" -- this removes agent judgment about when confirmation is needed
- Good: "Confirm with the user before creating issues, especially when requirements are ambiguous or the scope is large"

**Minimize directive density:**
- Every MUST/ALWAYS/NEVER/IMPORTANT is a place where you're overriding the agent's reasoning. Each one should earn its place.
- Reserve strong directives for genuine safety boundaries (don't delete production data, don't merge without tests)
- For behavioral guidance, prefer "prefer X" or "tend toward X" over "MUST do X" -- this lets the agent adapt to edge cases

**Trust the model:**
- LLMs are good at reasoning about intent, context, and appropriate responses. Encoding "if user says 'yes'/'looks good'/'go ahead' then proceed" is doing work the model already does natively.
- Give the agent context about why something matters rather than rules about what to do. An agent that understands why will handle novel situations; an agent following rules will break on the first edge case.

## Gotchas specific to this package

### Agent Definitions

- Agent definitions use YAML + prompt.md, NOT TypeScript code
- The `id` field in definition.yaml MUST match the directory name
- The `version` field must be a string (YAML coerces unquoted numbers like `1.0` to floats)
- prompt.md contains raw LLM-visible text -- no escaping, no TypeScript encoding
- Sub-agent `tokenBudget` in YAML is the standalone value; the executor overrides it with the parent's shared budget when spawning

### ConversationExecutor

- `start()` is idempotent: same correlationKey deterministically produces the same conversation ID
- Conversations are claimed with `FOR UPDATE SKIP LOCKED` -- no two workers process the same conversation
- Ownership is verified after the agent loop before persisting results -- prevents split-brain writes
- Non-retryable errors (TokenBudgetExhaustedError, AgentAbortedError) skip the retry loop

### EventLog

- `append()` is synchronous (buffered) -- call `flush()` at lifecycle boundaries (pause, complete, fail)
- `initSequence()` MUST be called before the first `append()` for a conversation
- Gapless per-conversation sequences are safe because only one loop runs per conversation at a time
- Subscriber notifications happen in-memory before persistence (fire-and-forget)

### History Manager

- Compacts messages when token count exceeds `pruneThreshold` (default 80,000 tokens)
- Old tool results beyond `protectedMessages` are truncated to summaries
- Summarization uses a cheaper model (Haiku) via `summaryModel` config
- Summaries are wrapped in `<summary></summary>` tags for detection
- Single-summary-block-with-merge strategy prevents summaries-of-summaries degradation
- Falls back to pruned result if summarization fails

### WaitForState and Signals

- `wait_for` tool creates a pending wait that the executor intercepts
- Uses mutable flag pattern (not exceptions) so the LLM sees confirmation and generates clean end_turn
- Signals use domain-language types: `approval`, `pr_review`, `pr_merged`, `pr_closed`
- Signal deduplication via optional `deduplicationId` stored in `delivered_signal_ids` JSONB array
- Worker loop re-reads queued_signals after wait_for triggers and auto-resumes if a matching signal exists

### Tool Separation

- **Router tools** (`router/tools/`): Used by the event routing LLM -- `query_conversations`, `reopen_conversation`, `send_message`, `signal_conversation`, `start_conversation`
- **Agent tools** (`shared/tools/`): Used by agents -- `codebase:*`, `communication:*`, `coordination:*`, `directory:*`, `integration:*`, `knowledge:*`, `task:*`
- These are separate sets registered in different contexts
