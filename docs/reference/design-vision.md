# Aesir — Design Vision

This is the present-tense statement of how aesir is designed: the principles, taxonomy, and philosophy that govern the codebase today, independent of which milestone built them. The decisions behind these principles live in `docs/adr/`, and the milestone-by-milestone history that produced them lives in `docs/history/`.

## Foundational Principles

These principles are not specific to any one part of the system — they are how aesir works, end to end.

### Control Flow Through Tool Calls

Agents determine their own control flow by choosing which tools to call and in what order. There is no external orchestration graph, no workflow engine, no state machine driving the agent. The LLM reasons about the situation, picks a tool, observes the result, and decides what to do next.

### Agents Reason, Infrastructure Guarantees

There is a clear responsibility boundary between what agents decide and what the framework ensures.

**Agents decide:** complexity assessment, tool sequence, when to research vs. act, when to ask for help, what to communicate, when a task is done.

**Infrastructure guarantees:** timeouts, retries, heartbeats, conversation durability, signal delivery, sandbox isolation, token budget enforcement, history compaction.

If framework code inspects agent output with `if/else` logic to decide what happens next, that crosses the boundary — the agent makes that decision through its own tools and reasoning, not through code wrapped around it. `packages/agents/CLAUDE.md`'s Agent-First Decision Checklist exists to catch exactly this before it lands.

### Framework Provides Mechanism, Agent Provides Intelligence

The framework offers capabilities (`wait_for`, `spawn_agent`, `handoff_task`, history compaction). The agent decides when and how to use them. This applies everywhere:

- **`wait_for`**: framework pauses and resumes; agent decides what to wait for and when
- **`spawn_agent`**: framework manages context isolation and token budgets; agent decides what to delegate
- **`handoff_task`**: framework stores and delivers; agent authors the content
- **history compaction**: the exception in this list — the framework decides, on token thresholds, and the agent is not consulted. Pruning runs above `pruneThreshold`, summarisation above `summaryThreshold`. It belongs with the infrastructure guarantees; the agent-managed phase was designed and then deferred, never built (ADR-0006).

The framework never interprets agent decisions. It stores them, delivers them, and enforces resource limits.

### Events as Ground Truth, Projections as Views

The event log is the source of truth. Everything else — `agent_sessions`, task status, dashboard state — is a derived projection that can be rebuilt from events. This event-sourcing principle means:

- New concerns (billing, compliance, ML training data) subscribe to existing events without modifying agent code
- Projections can be rebuilt if they drift or if their schema changes
- The event log is append-only — no data is lost when a projection is rebuilt

`SessionProjection` is the reference implementation: it reactively updates `agent_sessions` from the event log rather than being written to directly.

### Declarative Configuration as Data

Agent definitions are YAML plus Markdown, not TypeScript classes. This is deliberate: if it configures behavior rather than implements behavior, it's data. Data can be version-controlled, managed externally, created at runtime, and varied per tenant without a redeploy.

Tool implementations live in code, because they carry dependencies — MCP clients, containers, loggers. Tool *selection* lives in data — the YAML `tools:` list. The `ToolRegistry` bridges the two: string references in a definition resolve to factory functions in code.

### Structured Data at Boundaries, Flexible Data Internally

External boundaries (webhook payloads, MCP tool inputs, API responses) use Zod schemas for strict validation. Internal agent data — task handoffs, reasoning, agent-authored context — stays flexible JSONB or natural language. Agents need room to express nuance; system boundaries need guarantees.

### Sub-Agents as Context Boundaries

Spawning a sub-agent is not just delegation — it's a context boundary. Fresh context prevents contamination from the parent's long conversation history, reduces token usage, and allows a different model per role (Haiku for research, Sonnet for coding, Opus for orchestration). The sub-agent returns a result; the parent integrates it into its own reasoning. Sub-agents are selected today by an explicit `agentType` on `spawn_agent`; ADR-0013 records a deferred proposal to let an orchestrator describe the capability it needs instead, held back pending a broader rethink of how sub-agents and orchestrators are discriminated at all.

### Pause/Resume Without Context Loss

When a conversation pauses (`wait_for`), the full Anthropic message history is persisted — not a summary, not a snapshot, the actual messages. When it resumes, the agent has perfect memory of everything that happened. History compaction — pruning old tool results, summarizing long conversations — is a separate concern driven by token limits, not by the pause/resume mechanism itself.

### Observability as Infrastructure

Visibility into agent execution is not a nice-to-have dashboard — it's infrastructure on the same level as durability and retry logic. Without it, the feedback loop for improving agents becomes the bottleneck: you can't improve what you can't see. Agents are production systems, and their tool usage is monitored like service-to-service calls — latency, failure rate, call volume.

### Abstractions That Defer Infrastructure Decisions

`EventLog`, `ConversationExecutor`, and `ToolRegistry` are all interfaces that abstract their backing stores. Today they use Postgres. Tomorrow they could use Kafka, SQS, or DynamoDB without touching agent code. The interface is built for the domain; the backing store is left free to evolve independently of it.

### Anticipate Known-Future Requirements

Some requirements have near-certain future probability — auth, multi-tenancy, API access. Making the architecture "ready" for these costs near-zero upfront but is expensive to retrofit. The dashboard's auth-ready middleware pipeline and service-layer abstractions are the standing example: structured for auth before auth is required, so adding it later is additive, not surgical.

### Orchestrators Collaborate, Sub-Agents Execute

There are two tiers of agents with fundamentally different collaboration models.

**Orchestrator agents** (dev-agent, product-agent, the QA agent, future monitoring agents) are autonomous peers. They have their own conversations, token budgets, and lifecycles. They appear in the entity directory, can delegate tasks to each other and to humans, and participate in negotiation handshakes. They reason about *what* needs to happen and *who* should do it.

**Sub-agents** (coder, researcher, tester) are focused workers spawned within an orchestrator's conversation. They share the parent's token budget, run in the parent's context boundary, and return results directly. They don't appear in the directory, don't receive delegated tasks, and don't participate in handshakes — they're tools the orchestrator uses, not peers it collaborates with.

Cross-conversation delegation (orchestrator → orchestrator, orchestrator → human) is materially different from sub-agent spawning: separate budgets, separate lifecycles, callback signaling for completion. The collaboration system — directory, delegation, completion signaling — operates exclusively at the orchestrator tier. ADR-0013 records that a deferred v3.0 proposal — collapsing this two-tier split into one directory discriminated by activation pattern, not agent type — currently governs the intended direction, even though the split described above is still what ships today.

### Task Materialization

When a task is delegated, it materializes differently based on the recipient and team policy:

- **Agent recipient, internal materialization**: the task starts a conversation directly via an internal signal. No external artifact — fast, cheap, visible only in the dashboard.
- **Agent recipient, transparent materialization**: the task creates a Linear ticket (or other external artifact) assigned to the agent. A webhook triggers the conversation. Humans see the work in their existing tools.
- **Human recipient**: designed to materialize as a Slack message, Linear ticket, email, or other channel based on the human's reachability in the directory — not active yet, since human entities are not seeded into the directory.

The delegating agent doesn't choose the delivery mechanism directly — it creates a task with a target, and the materialization layer determines delivery. Whether a team wants full ticket transparency or invisible internal handoffs is a prompt-level policy, not an architectural choice. This extends the denormalizer pattern from communication (reply/ask/notify → channel-specific delivery) to delegation (delegate → recipient-appropriate delivery).

### Knowledge as Shared Infrastructure

Agent conversations are isolated by design (context boundaries), but the knowledge agents accumulate — codebase understanding, architecture decisions, discovered constraints — persists and stays accessible across conversations. Without shared memory, agents in a delegation chain repeatedly rediscover the same things.

Knowledge is classified by type (discovery, architecture decision, constraint, thought, preference, test result), scoped by visibility (private notepad vs. shared), and governed by lifecycle policies (expiry, supersession). Agents interact through a unified tool interface (`knowledge:store`, `knowledge:query`) regardless of what backs it. Private memory is working memory that persists across an agent's own conversation turns but isn't shared; shared knowledge is curated entries accessible by every agent. Scope defaults from the knowledge type (`thought` private, everything else shared), and an agent can override the default per call — there is no team-level or YAML-configurable policy yet.

### Persistent Agent Identity

Agents need more than scattered knowledge entries — they need a coherent, evolving understanding of their domain that persists across conversations. A product agent's understanding of the product isn't fifty individual facts; it's a structured mental model that grows and refines over time.

Identity documents (product briefs, architectural models, stakeholder maps) are maintained by the agent across conversations, injected at conversation start, and updated as understanding deepens. This is distinct from shared knowledge (facts for the swarm) and from conversation history (ephemeral, per-conversation context) — identity is the agent's persistent self: what it knows about its domain, its accumulated judgment, its learned preferences.

### Symmetric Normalization

Inbound adapters normalize integration-specific webhooks into domain-language signals. Outbound denormalizers translate domain-language actions into integration-specific API calls. Agents operate entirely in the domain layer — they reason about intent (reply, ask, notify) while infrastructure handles channel translation in both directions.

`ReplyContext` propagates through the pipeline as an opaque address: adapters attach it, signals carry it, the executor stores it, agents pass it through to communication tools untouched, and the denormalizer dispatches based on it. Adding a new integration channel requires adapter and denormalizer changes — zero agent changes.

### Platform Then Domain Intelligence

Infrastructure and domain intelligence are built in distinct phases, not interleaved. Platform work establishes every mechanism an agent could need: execution, communication, collaboration, observability, scheduling, identity. Domain work builds the actors: deep role analysis, specialized sub-agents, domain tools, and prompt engineering driven by real-world workflow understanding.

This sequencing is deliberate — mixing platform and domain work creates competing feedback loops where a bad agent decision can't be attributed to a missing capability versus missing intelligence. When an agent makes a bad decision, you need to know whether the platform lacked something (missing tool, broken signal, no context) or the agent lacked something (bad prompt, wrong reasoning, missing domain knowledge). Completing the platform first eliminates the infrastructure variable from that question.

## Anti-Patterns

The flip side of the foundational principles. If you're doing any of these, reconsider:

1. **Parsing agent output for sentinels** — if your code inspects LLM text to decide what happens next, that decision should be a tool call the agent makes
2. **Hardcoding phase transitions** — the agent decides when to move between phases through its reasoning, not framework code
3. **Pattern-matching on results to add behavior** — `if (result.field) → call Slack` is the framework fighting the agent for control
4. **Natural language state machines** — if/then branches in prompts are the worst of both worlds (unreliable *and* inflexible)
5. **Directive stacking** — every MUST/ALWAYS/NEVER is overriding agent reasoning; each one should earn its place
6. **Channel-specific logic in agents** — agents reason about intent, not channels

## Core Insight: Tasks as Universal Coordination

The key realization: tasks are the universal coordination primitive. Everyone — agents and humans — has tasks. Coordinating those tasks to achieve value is the goal. The direction of assignment shouldn't matter:

- **Human → Agent**: "Implement this feature"
- **Agent → Agent**: "Research this codebase area for me"
- **Agent → Human**: "I need you to verify this in staging"

`request_human_input` is a poorly modeled version of "agent creates a task for a human." `spawn_agent` is a poorly modeled version of "agent creates a task for another agent." They're the same operation with different assignees.

A task is the agent's (or human's) understanding of what needs to be done and why. It is NOT a wrapper around any external artifact. It may reference Linear issues, PRs, Slack threads — but it exists independently of them. Multiple tasks can reference the same issue. A task can exist with no external references at all.

## Agent Type Taxonomy

Different agent types use tasks differently. The task primitive supports all of these without type-specific framework code.

### Conversational Agents (product-agent, future: support, sales)

- **Scope**: Wide. A task starts from human interaction and might produce multiple artifacts (tickets, docs, designs).
- **Task lifetime**: Long. Lives as long as the human engagement does.
- **Handoff style**: "Here's what we discussed and decided."
- **Subtask pattern**: Creates subtasks for execution agents (e.g., product creates dev tasks for each ticket).
- **Reopening vs new conversation**: New conversations within the task are more common — each human follow-up is a distinct interaction but part of the same engagement.

### Execution Agents (dev-agent, future: QA, docs, deploy)

- **Scope**: Narrow. A task usually maps to a single artifact (ticket, PR, release).
- **Task lifetime**: Medium. Spans the artifact's lifecycle (created → implemented → reviewed → merged).
- **Handoff style**: "Here's the state of the work and what's left."
- **Subtask pattern**: Delegates specific work to worker agents (coder, researcher, tester).
- **Reopening vs new conversation**: Reopening is more common — PR feedback and CI failures are direct follow-ups to the existing work.

### Monitoring Agents (future: security, performance, SLA)

- **Scope**: Ongoing vigilance. A task is born from an anomaly and stays open until resolved.
- **Task lifetime**: Variable. Could be minutes (transient alert) or weeks (ongoing investigation).
- **Handoff style**: "Here's what I detected and what's been tried."
- **Subtask pattern**: Spawns execution tasks to other agents when remediation is needed.
- **Reopening vs new conversation**: Both — reopen for related alerts, new conversation when the investigation takes a different direction.

The differences between agent types live in prompt guidance (how the agent thinks about tasks), not framework code (how tasks work).

## Prompt Engineering Philosophy

### The Determinism Trap

Agents are often introduced to replace deterministic workflows, but end up with prompts that force them to be deterministic anyway — extensive if/then branches, MUST/ALWAYS/NEVER directives, prescribed tool sequences. This is worse than either genuine determinism (code) or genuine agency (reasoning):

- **Natural language state machines** are followed inconsistently, which is worse than code (reliable) or agent reasoning (adapts to context)
- **Directive stacking** creates contradictions that force the agent to guess which rule "wins"
- **Complexity classification gates** (SIMPLE/MODERATE/COMPLEX → different workflows) prevent the agent from calibrating its approach to the actual situation

### The Alternative

The Prompt Authoring Guide (`packages/agents/definitions/PROMPT_GUIDE.md`) codifies the approach:

1. **Goal-oriented identity** — what the agent exists to achieve, not how to work
2. **Constitutional constraints** — what NOT to do (boundaries), not what TO do (procedures)
3. **Few-shot examples with reasoning** — teach judgment patterns, not lookup tables
4. **Selective chain-of-thought** — orchestrators externalize reasoning for observability
5. **Structured output at boundaries only** — phase tags and handoffs, nothing more
6. **Minimal directive density** — every MUST earns its place
7. **Trust the model** — don't encode what the model does natively

### Why Few-Shot With Reasoning Works

If/then branches teach the agent to classify and follow rules. Few-shot examples with reasoning teach the agent to *think about the problem*. The difference matters for edge cases:

- If/then: "What branch does this input belong to?" → breaks when input doesn't fit any branch
- Few-shot: "How did the agent reason in similar situations?" → generalizes to novel inputs

The reasoning in examples is the critical part. Without it, examples are just a lookup table. With it, they teach a reasoning pattern the agent applies to situations the examples didn't cover.

## Handoff as Agent-Authored Context

When an agent finishes a conversation within a task, it writes a handoff — its own summary of what matters for whoever picks up next — rather than an auto-generated one. Three reasons: the agent knows what's important (an auto-summary of a fifty-message conversation treats everything equally, where the agent knows the key insight was on message 37 and the rest was exploration); different handoff types need different content (a completion handoff, "here's what I built," is structurally different from a delegation handoff, "here's what I need you to do and why"); and it's agent-first — the framework provides the mechanism, the agent provides the intelligence.

Handoff types are extensible: completion, pause, delegation, and escalation ship today. The agent selects completion or pause implicitly, by calling `complete_task` or `pause_task`; delegation or escalation explicitly, by calling `handoff_task` with a `handoffType` parameter. The framework never pattern-matches on handoff type — it stores what the agent writes and delivers it verbatim, so a new type is addable through prompt guidance alone, with no framework change. ADR-0009 records the decision and the schema (`agents.task_handoffs`) behind this.

---

Sources: `docs/history/specs/design-vision.md` — the milestone-annotated original this file is distilled from, with its Milestone Specs, Problem, Event Routing Evolution, Bidirectional Task Assignment, Expansion Paths, and Design Decisions Log sections kept there rather than repeated here.
