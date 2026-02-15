# Aesir — Design Vision

Master document capturing Aesir's architectural thinking, design philosophy, and expansion paths. Grounds the HOWs across milestones — individual milestone specs handle the WHATs.

## Milestone Specs

| Milestone | Spec | Focus |
|-----------|------|-------|
| v2.2 | [`2.2-spec-raw.md`](2.2-spec-raw.md) | Tool-use loop foundation, LangGraph → Anthropic SDK, orchestrator + sub-agent pattern |
| v2.3 | [`2.3-spec-raw.md`](2.3-spec-raw.md) | Unified agent framework, event log, declarative definitions, conversation executor |
| v2.4 | [`2.4-spec-raw.md`](2.4-spec-raw.md) | Operations dashboard, SSE real-time, service layer, auth-ready architecture |
| v2.5 | [`2.5-agentic-conversations.md`](2.5-agentic-conversations.md) | Task primitives, conversation continuity, handoffs, prompt rewrites |
| v2.6 | [`2.6-unified-agent-communication.md`](2.6-unified-agent-communication.md) | Symmetric normalization, outbound denormalizers, intent-based tools (reply/ask/notify) |
| v2.7 | [`2.7-agent-collaboration.md`](2.7-agent-collaboration.md) | Multi-agent collaboration — shared memory, entity directory, task delegation, completion signaling, Linear Agent SDK |
| v2.8 | [`2.8-agent-resilience.md`](2.8-agent-resilience.md) | Runtime resilience, dashboard observability, task tree unification — stabilize the platform |
| v2.9 | [`2.9-platform-completion.md`](2.9-platform-completion.md) | Complete collaboration capabilities — negotiation, parallel delegation, scheduling, persistent identity |
| v3.0 | [`3.0-domain-modeling.md`](3.0-domain-modeling.md) | Role-by-role domain analysis, agent architecture, specialized tools and sub-agents |
| v3.1 | [`3.1-human-collaboration.md`](3.1-human-collaboration.md) | Formal human-agent collaboration protocols, bidirectional delegation with humans |

## Foundational Principles

These principles emerged across milestones and underpin all architectural decisions. They are not specific to any version — they are how Aesir works.

### Control Flow Through Tool Calls

Agents determine their own control flow by choosing which tools to call and in what order. There is no external orchestration graph, no workflow engine, no state machine driving the agent. The LLM reasons about the situation, picks a tool, observes the result, and decides what to do next.

This was the foundational shift in v2.2 (migrating from LangGraph's explicit graph to Anthropic's native tool-use loop) and remains the core execution model. *Established in [`2.2-spec-raw.md`](2.2-spec-raw.md).*

### Agents Reason, Infrastructure Guarantees

There is a clear responsibility boundary between what agents decide and what the framework ensures:

**Agents decide:** complexity assessment, tool sequence, when to research vs. act, when to ask for help, what to communicate, when a task is done.

**Infrastructure guarantees:** timeouts, retries, heartbeats, conversation durability, signal delivery, sandbox isolation, token budget enforcement, history compaction.

If you find yourself adding `if/else` logic in framework code that inspects agent output to decide what happens next, you've crossed the boundary. The agent should make that decision through its tools and reasoning. *Established in [`2.2-spec-raw.md`](2.2-spec-raw.md), reinforced in CLAUDE.md's Agent-First Decision Checklist.*

### Framework Provides Mechanism, Agent Provides Intelligence

The framework offers capabilities (wait_for, spawn_agent, handoff_task, history compaction). The agent decides when and how to use them. This applies everywhere:

- **wait_for**: framework pauses and resumes; agent decides what to wait for and when
- **spawn_agent**: framework manages context isolation and token budgets; agent decides what to delegate
- **handoff_task**: framework stores and delivers; agent authors the content
- **history compaction**: framework truncates old tool results; agent decides when to summarize

The framework never interprets agent decisions. It stores them, delivers them, and enforces resource limits. *Established in [`2.3-spec-raw.md`](2.3-spec-raw.md).*

### Events as Ground Truth, Projections as Views

The event log is the source of truth. Everything else — agent_sessions, task status, dashboard state — is a derived projection that can be rebuilt from events. This event-sourcing principle means:

- New concerns (billing, compliance, ML training data) subscribe to existing events without modifying agent code
- Projections can be rebuilt if they drift or if the schema changes
- The event log is append-only — no data is lost when projections are updated

*Established in [`2.3-spec-raw.md`](2.3-spec-raw.md). SessionProjection is the first implementation of this pattern.*

### Declarative Configuration as Data

Agent definitions are YAML + Markdown, not TypeScript classes. This is deliberate: *if it configures behavior rather than implements behavior, it's data*. Data can be version-controlled, managed externally, created at runtime, and varied per tenant without redeployment.

Tool implementations live in code (they have dependencies — MCP clients, containers, loggers). Tool *selection* lives in data (the YAML `tools:` list). The ToolRegistry bridges the two: string references in definitions resolve to factory functions in code. *Established in [`2.3-spec-raw.md`](2.3-spec-raw.md).*

### Structured Data at Boundaries, Flexible Data Internally

External boundaries (webhook payloads, MCP tool inputs, API responses) use Zod schemas for strict validation. Internal agent data (handoff content, context snapshots, reasoning) stays as flexible JSONB/natural language. Agents need room to express nuance; system boundaries need guarantees. *Established in [`2.2-spec-raw.md`](2.2-spec-raw.md).*

### Sub-Agents as Context Boundaries

Spawning a sub-agent is not just delegation — it's a *context boundary*. Fresh context prevents contamination from the parent's long conversation history, reduces token usage, and allows different models per role (Haiku for research, Sonnet for coding, Opus for orchestration). The sub-agent returns a result; the parent integrates it into its own reasoning. *Established in [`2.2-spec-raw.md`](2.2-spec-raw.md).*

As the sub-agent pool grows (v3.0 will introduce many specialized sub-agents per role), hardcoded YAML references won't scale. Sub-agent discovery extends this principle: orchestrators describe the capability they need, and a registry resolves to the best-matching sub-agent. This parallels the entity directory pattern for orchestrator-to-orchestrator delegation but stays internal to the spawning context. Explicit agent IDs remain supported for backward compatibility. *Extended in v2.9 planning discussions.*

### Pause/Resume Without Context Loss

When a conversation pauses (wait_for), the full Anthropic message history is persisted — not a summary, not a snapshot, the actual messages. When it resumes, the agent has perfect memory of everything that happened. History compaction (pruning old tool results, summarizing long conversations) is a separate concern driven by token limits, not by the pause/resume mechanism. *Established in [`2.3-spec-raw.md`](2.3-spec-raw.md).*

### Observability as Infrastructure

Visibility into agent execution is not a nice-to-have dashboard — it's infrastructure on the same level as durability and retry logic. Without it, the feedback loop for improving agents becomes the bottleneck. You can't improve what you can't see.

Agents are production systems. Their tool usage should be monitored like service-to-service calls — latency, failure rate, call volume. *Established in [`2.4-spec-raw.md`](2.4-spec-raw.md).*

### Abstractions That Defer Infrastructure Decisions

EventLog, ConversationExecutor, ToolRegistry are all interfaces that abstract their backing stores. Today they use Postgres. Tomorrow they could use Kafka, SQS, DynamoDB — without touching agent code. Build the interface that makes sense for the domain; let the backing store evolve independently. *Established in [`2.3-spec-raw.md`](2.3-spec-raw.md).*

### Anticipate Known-Future Requirements

Some requirements have near-certain future probability (auth, multi-tenancy, API access). Making architecture "ready" for these costs near-zero upfront but is expensive to retrofit. v2.4's auth-ready middleware pipeline and service-layer abstractions are examples: structured for auth before auth was required, so adding it later is additive, not surgical. *Established in [`2.4-spec-raw.md`](2.4-spec-raw.md).*

### Orchestrators Collaborate, Sub-Agents Execute

There are two tiers of agents with fundamentally different collaboration models:

**Orchestrator agents** (dev-agent, product-agent, future monitoring/QA agents) are autonomous peers. They have their own conversations, token budgets, and lifecycles. They appear in the entity directory, can delegate tasks to each other and to humans, and participate in negotiation handshakes. They reason about *what* needs to happen and *who* should do it.

**Sub-agents** (coder, researcher, tester) are focused workers spawned within an orchestrator's conversation. They share the parent's token budget, run in the parent's context boundary, and return results directly. They don't appear in the directory, don't receive delegated tasks, and don't participate in handshakes. They're tools the orchestrator uses, not peers it collaborates with.

Cross-conversation delegation (orchestrator → orchestrator, orchestrator → human) is materially different from sub-agent spawning: separate budgets, separate lifecycles, callback signaling for completion. The collaboration system (directory, delegation, completion signaling) operates exclusively at the orchestrator tier. *Established in [`2.7-agent-collaboration.md`](2.7-agent-collaboration.md).*

### Task Materialization

When a task is delegated, it materializes differently based on the recipient and team policy:

- **Agent recipient, internal materialization**: Task starts a conversation directly via internal signal. No external artifact. Fast, cheap, visible only in the dashboard.
- **Agent recipient, transparent materialization**: Task creates a Linear ticket (or other external artifact) assigned to the agent. Webhook triggers the conversation. Humans see the work in their existing tools.
- **Human recipient**: Task materializes as a Slack message, Linear ticket, email, or other channel based on the human's reachability in the directory.

The delegating agent doesn't choose the delivery mechanism directly — it creates a task with a target, and the materialization layer determines delivery. Whether a team wants full ticket transparency or invisible internal handoffs is a **prompt-level policy**, not an architectural choice. This extends the denormalizer pattern from communication (reply/ask/notify → channel-specific delivery) to delegation (delegate → recipient-appropriate delivery). *Established in [`2.7-agent-collaboration.md`](2.7-agent-collaboration.md).*

### Knowledge as Shared Infrastructure

Agent conversations are isolated by design (context boundaries). But the knowledge agents accumulate — codebase understanding, architecture decisions, discovered constraints — should persist and be accessible across conversations. Without shared memory, agents in a delegation chain repeatedly re-discover the same things.

Knowledge is classified by type (discovery, architecture decision, constraint, thought), scoped by visibility (private notepad vs shared), and governed by lifecycle policies (confidence, expiry, supersession). The classification determines storage, access, and curation — agents interact through a unified tool interface (`knowledge:store`, `knowledge:query`) regardless of backend.

Private memory (agent notepad) is working memory that persists across an agent's conversation turns but isn't shared. Shared knowledge is curated entries accessible by all agents. The distinction is important: agents need scratchpad space for unstructured thinking without polluting the shared pool. Scope and permissions are user-configurable — teams choose their preferred transparency level with documented tradeoffs. *Established in [`2.7-agent-collaboration.md`](2.7-agent-collaboration.md), extending the Agent-Managed Memory expansion path.*

### Persistent Agent Identity

Agents need more than scattered knowledge entries — they need a coherent, evolving understanding of their domain that persists across conversations. A product agent's understanding of the product isn't 50 individual facts; it's a structured mental model that grows and refines over time.

Identity documents (product briefs, architectural models, stakeholder maps) are maintained by the agent across conversations, injected at conversation start, and updated as understanding deepens. This is distinct from shared knowledge (facts for the swarm) and from conversation history (ephemeral per-conversation context). Identity is the agent's persistent self — what it knows about its domain, its accumulated judgment, its learned preferences.

Without persistent identity, agents rediscover context every conversation. They can query knowledge entries, but knowing 50 individual facts isn't the same as having a coherent mental model. The identity document is the difference between an experienced colleague and someone who read the wiki five minutes ago. *Established in v2.9 planning discussions.*

### Symmetric Normalization

Inbound adapters normalize integration-specific webhooks into domain-language signals. Outbound denormalizers translate domain-language actions into integration-specific API calls. Agents operate entirely in the domain layer — they reason about intent (reply, ask, notify) while infrastructure handles channel translation in both directions.

ReplyContext propagates through the pipeline as an opaque address: adapters attach it, signals carry it, the executor stores it, agents pass it through to communication tools, and the denormalizer dispatches based on it. Adding a new integration channel requires adapter + denormalizer changes — zero agent changes. *Established in [`2.6-unified-agent-communication.md`](2.6-unified-agent-communication.md).*

### Platform Then Domain Intelligence

Infrastructure and domain intelligence are built in distinct phases, not interleaved. Platform milestones (v2.2–v2.9) establish every mechanism agents could need: execution, communication, collaboration, observability, scheduling, identity. Domain milestones (v3.0+) build the actors: deep role analysis, specialized sub-agents, domain tools, and prompt engineering driven by real-world workflow understanding.

This sequencing is deliberate — mixing platform and domain work creates competing feedback loops where you can't distinguish infrastructure failures from intelligence failures. When an agent makes a bad decision, you need to know whether the platform lacked a capability (missing tool, broken signal, no context) or the agent lacked intelligence (bad prompt, wrong reasoning, missing domain knowledge). Completing the platform first eliminates the infrastructure variable. *Established in v2.8/v2.9/v3.0 planning discussions.*

## Anti-Patterns

The flip side of the foundational principles. If you're doing any of these, reconsider:

1. **Parsing agent output for sentinels** — if your code inspects LLM text to decide what happens next, that decision should be a tool call the agent makes
2. **Hardcoding phase transitions** — the agent decides when to move between phases through its reasoning, not framework code
3. **Pattern-matching on results to add behavior** — `if (result.field) → call Slack` is the framework fighting the agent for control
4. **Natural language state machines** — if/then branches in prompts are the worst of both worlds (unreliable + inflexible)
5. **Directive stacking** — every MUST/ALWAYS/NEVER is overriding agent reasoning; each one should earn its place
6. **Channel-specific logic in agents** — agents reason about intent, not channels (see v2.6 spec)

*Anti-patterns 1–3 from [`2.2-spec-raw.md`](2.2-spec-raw.md), 4–5 from prompt engineering philosophy, 6 from [`2.6-unified-agent-communication.md`](2.6-unified-agent-communication.md).*

## The Problem

Aesir's current model treats agents as reactive processors: event arrives → conversation starts → agent works → conversation ends. This creates three problems:

1. **No continuity.** When a conversation ends, the agent's understanding of the work dies with it. A new event (PR review, CI failure, user follow-up) starts a blank conversation with no memory of prior work.

2. **Deterministic prompts fighting agent reasoning.** The orchestrator prompts (product-agent, dev-agent) encode full state machines in natural language — if/then branches, prescribed tool sequences, complexity classification gates. This is the worst of both worlds: unreliable like an LLM, inflexible like code.

3. **Unidirectional coordination.** Only humans can create work for agents. Agents can't delegate to humans (only "block and wait") or proactively identify work. This limits agents to reactive assistance rather than genuine collaboration.

## Core Insight: Tasks as Universal Coordination

The key realization: tasks are the universal coordination primitive. Everyone — agents and humans — has tasks. Coordinating those tasks to achieve value is the goal. The direction of assignment shouldn't matter:

- **Human → Agent**: "Implement this feature" (current model)
- **Agent → Agent**: "Research this codebase area for me" (partially exists via spawn_agent)
- **Agent → Human**: "I need you to verify this in staging" (doesn't exist — currently modeled as "blocking on input")

The current `request_human_input` is a poorly modeled version of "agent creates a task for a human." And `spawn_agent` is a poorly modeled version of "agent creates a task for another agent." They're the same operation with different assignees.

A task is the agent's (or human's) understanding of what needs to be done and why. It is NOT a wrapper around any external artifact. It may reference Linear issues, PRs, Slack threads — but it exists independently of them. Multiple tasks can reference the same issue. A task can exist with no external references at all.

## Agent Type Taxonomy

Different agent types use tasks differently. The task primitive must support all of these without type-specific framework code.

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

The differences between agent types are in prompt guidance (how the agent thinks about tasks), not framework code (how tasks work).

## Prompt Engineering Philosophy

### The Determinism Trap

Agents are often introduced to replace deterministic workflows, but end up with prompts that force them to be deterministic — extensive if/then branches, MUST/ALWAYS/NEVER directives, prescribed tool sequences. This is worse than either genuine determinism (code) or genuine agency (reasoning):

- **Natural language state machines** are followed inconsistently (~90% adherence), which is worse than code (100%) or agent reasoning (adapts to context)
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

When an agent finishes a conversation within a task, it writes a handoff — its summary of what matters for whoever picks up next. This is intentionally agent-authored rather than auto-generated because:

1. **The agent knows what's important.** An auto-summary of a 50-message conversation treats everything equally. The agent knows that the key insight was on message 37 and the rest was exploration.
2. **Different handoff types need different content.** A completion handoff ("here's what I built") is structurally different from a delegation handoff ("here's what I need you to do and why").
3. **It's agent-first.** The framework provides the mechanism; the agent provides the intelligence.

Handoff types are extensible. v2.5 implements: completion, pause, delegation, escalation. The framework doesn't pattern-match on types — it stores them and delivers them. New types can be added via prompt guidance alone.

The agent chooses the strategy. The framework could present available strategies as a tool parameter, letting the agent pick what fits the situation. This avoids hardcoding handoff types into the prompt while giving the agent structured options.

## Event Routing Evolution

### Current State

The EventRouter pattern-matches events to agent triggers. This works for "start new work" but not for "continue existing work." The slow_path (LLM classification) handles ambiguous events but is positioned as a fallback.

### The Shift

With tasks, the router's primary job inverts. Most events are follow-ups to existing work (PR review, CI result, user reply, approval). Novel "start new work" routing is the minority case.

The routing question changes from "which agent handles this?" to "which task does this belong to?" — and the task already knows its assignee.

### Integration Correlation Layer

Rather than the router doing fuzzy JSONB metadata matching, the integration layer resolves event-to-task correlation at the boundary where it has the most information:

- **Outgoing**: Agent creates PR via MCP → integration records PR #42 → task T123
- **Incoming**: PR review webhook → integration looks up PR #42 → attaches task T123 → forwards to agent service

Each integration maintains a correlation table. This is more reliable than router-side matching because the integration processes both sides of the artifact lifecycle.

### Routing Priority

```
1. Task reference attached by integration → route to task (fast, no LLM)
2. Unambiguous trigger match → fast-path start (deterministic, create task)
3. Ambiguous → reasoning path (LLM decides)
```

The reasoning path is effectively a lightweight orchestrator, but it only fires for genuinely novel events. Most traffic takes the fast paths.

### Outbound: Completing the Loop

The routing evolution above addresses the *inbound* question: how events find the right conversation. The *outbound* question — how agents reply to the right channel — is addressed by the v2.6 Unified Agent Communication spec (`2.6-unified-agent-communication.md`). The integration correlation layer enriches inbound events with `replyContext`, which propagates through the signal pipeline so agents can reply to the originating channel without knowing which channel it was.

### Future: Global Orchestrator?

An open question: should the reasoning path evolve into a persistent orchestrator agent that maintains awareness of all active tasks and can make sophisticated routing decisions? Arguments for: better coordination, proactive work identification. Arguments against: bottleneck, single point of failure, cost.

Current position: keep it as a stateless LLM call for ambiguous events. Revisit if the task graph becomes complex enough that stateless routing can't make good decisions.

## Bidirectional Task Assignment

### Current State

- Human → Agent: Fully implemented (event triggers conversation)
- Agent → Agent: Implemented in v2.7 (directory discovery, task delegation, negotiation handshake, completion signaling)
- Agent → Human: Deferred to v3.1 (currently modeled as "blocking on input" via request_human_input)

### Target State

All three directions use the same primitive: create a task with a creator and an assignee. The framework handles lifecycle regardless of who's on each end.

Task delivery adapts to the recipient through the materialization layer (see foundational principle: Task Materialization). The delegating agent doesn't need to know the delivery mechanism — it creates a task for an entity, and the infrastructure determines how to reach them.

### Entity Directory

For agents to delegate, they need to know who can help. The entity directory is service discovery for the agent swarm — a queryable registry of orchestrator agents and humans with declared capabilities and reachability information.

- **Agents**: Seeded from definition.yaml. Capabilities declared as natural language descriptions of what the agent can do at an intent level (not tool lists). Re-seeded on deploy.
- **Humans**: Configured via seed script or admin UI. Includes role, capabilities, and reachVia (channel type + target, e.g., Slack channel). *Deferred to v3.1.*

Agents query the directory by capability ("who can implement code changes?") and receive matching entities ranked by relevance. The directory returns both agents and humans — the delegating agent chooses based on capability match, not entity type.

### Negotiation Handshake

Work assignment starts with a handshake that gives the delegator agency (see also "Delegation vs Hand-Off" for when the delegator waits for a result vs moves on):

1. Delegator creates a task with expectations (priority, estimated effort, context)
2. Target responds: accept with estimate, reject with reason, or counter-propose
3. Delegator decides: proceed, cancel, or try someone else

This mirrors how humans collaborate — setting expectations, estimating honestly, and making informed decisions about whether to wait or pivot. The handshake protocol is a strategy that can be swapped: v1 is simple accept/reject with estimate. v2.9 adds counter-propose and bidirectional clarification. The interface supports richer strategies later as patterns emerge from real usage.

The handshake is critical for managing token budgets and context staleness. If Agent B estimates 2 hours, Agent A knows it needs to plan accordingly — pause and wait, delegate to someone faster, or accept the timeline and move on. No magic timeouts needed.

### Delegation vs Hand-Off

There are two patterns for giving work to another entity, and the distinction matters:

**Delegation** — the delegator retains ownership and expects a result. "Do this and tell me when you're done." The delegator calls `wait_for_task` after delegating and resumes when the completion signal arrives. Use this when the delegator can't continue without the result — dev-agent needs QA's verdict before merging, product-agent needs a cost estimate before confirming scope with the user.

**Hand-off** — the assigner transfers ownership with no expectation of a return signal. "This is yours now." The assigner completes its own work and moves on. Use this for the majority of work assignment — product-agent creates a Linear issue and confirms with the user, dev-agent picks it up independently via trigger. No completion signal needed.

Both patterns flow through the same infrastructure — `task:delegate` with a brief, directory lookup for discovery, handshake for acceptance. The only difference is whether the delegator calls `wait_for_task` afterward. This is a prompt-level decision, not a framework distinction. No framework code differentiates the two — the agent decides based on context whether it needs to wait for the result or can move on.

Hand-off is the natural pattern for human collaboration (assign a ticket, move on) and for most agent-to-agent work. Delegation is the special case — needed when the delegator's own workflow depends on the outcome.

### Completion Obligations

The distinction above is about the *assigner*. The *acceptor* also has different completion obligations depending on how they received the work:

**Triggered work** (event trigger, no delegator waiting): The agent decides how to signal completion — update a Linear issue, merge a PR, post to Slack, or simply end. No one is blocked on a `task:complete_task` call.

**Delegated work** (someone called `task:delegate` and is waiting): The agent MUST call `task:complete_task` to unblock the delegator. Without it, the delegator is stuck permanently.

**Delegated work with external side effects**: The agent needs to do both — update external tools (Linear, GitHub) AND signal completion to the delegator. The ordering matters: external updates should complete before `task:complete_task`, because completion resumes the delegator. If the delegator resumes and starts acting on the result (e.g., merging a PR, updating Linear status) while the delegatee is still performing its own external updates, you get race conditions on shared state.

This ordering is a prompt-level concern, not framework-enforced. The agent understands that `task:complete_task` is the last thing it does — finish your work, then report that you're done. The framework doesn't need to sequence this because the agent controls its own tool call order.

On the delegator side, the reconnaissance sub-agent pattern provides a second layer of protection: when a delegator resumes after receiving a completion signal, it spawns a lightweight recon check to gather the current state of external resources (Linear issue status, GitHub PRs, shared memory) before acting. If the delegatee's external updates are incomplete or produced unexpected results, the recon brief surfaces that — the delegator makes an informed decision rather than assuming the world matches the completion result.

### What This Enables

- Product-agent notices a pattern in recent tickets and creates a task for a human to investigate
- Dev-agent realizes a dependency is unmaintained and tasks product-agent to evaluate alternatives
- QA agent finds a systemic quality issue and tasks product to prioritize tech debt
- Monitoring agent detects an anomaly and tasks dev-agent to investigate, then tasks a human to verify the fix in production

### Implementation Timeline

Bidirectional assignment was a design principle in v2.5 — the schema supports it (polymorphic creator/assignee), and prompt guidance encourages thinking about it. v2.7 delivered agent-to-agent collaboration: entity directory for discovery, task delegation for assignment, negotiation handshake for agency, completion signaling for feedback, and internal materialization. v2.9 completes the platform with richer negotiation (counter-propose, clarification), parallel delegation, transparent materialization, and tree-level budgets. v3.1 extends to human collaboration with formal protocols for agent-to-human delegation.

## Expansion Paths

These are not planned — they're possibilities the architecture should support. Items promoted to active milestones are noted.

### Cross-Agent Collaboration → Shipped in v2.7

Agents discover each other via the entity directory, delegate tasks with a negotiation handshake, and receive completion signals when work finishes. Collaboration happens through shared state that agents access via tools (directory, delegation, knowledge), not through a central orchestrator. *Delivered in [`2.7-agent-collaboration.md`](2.7-agent-collaboration.md).*

### Shared Memory → Shipped in v2.7

Agents store classified knowledge (`knowledge:store`) and query it (`knowledge:query`). Knowledge is typed (discovery, architecture decision, constraint), scoped (private notepad vs shared), and governed by lifecycle policies (confidence, expiry). *Delivered in [`2.7-agent-collaboration.md`](2.7-agent-collaboration.md).*

### Domain Modeling → v3.0 Planned

**Promoted from expansion path to active milestone.** Transform agents from generic task processors into domain-expert professionals. Deep role analysis drives agent architecture: what does a world-class Product Owner actually do? What sub-agents, tools, and domain knowledge does a senior developer need? Each agent role gets a full workflow analysis, specialized sub-agents, domain-specific tools, and prompt engineering driven by real-world understanding of the profession.

This is the shift from building infrastructure to building intelligence. *See [`3.0-domain-modeling.md`](3.0-domain-modeling.md).*

### Human Collaboration → v3.1 Planned

**Promoted from expansion path to active milestone.** Formal protocols for agent-to-human delegation, human response parsing, async handshake handling, escalation strategies, and mid-work signal handling. Deliberately sequenced after domain modeling — humans should interact with competent agents, not half-baked ones. The current semi-automatic workflow (human tweaks ticket, assigns to agent) works well as a bridge.

The hard problems are protocol design, not infrastructure: unstructured response parsing, no-response escalation, context staleness during long human waits, and channel interaction semantics (Slack threading, reactions, edits). *See [`3.1-human-collaboration.md`](3.1-human-collaboration.md).*

### Cross-Session Learning

Aggregating patterns across completed tasks to improve agent performance. "Dev-agent tasks in this area of the codebase tend to need more research." Requires: task analytics + feedback loop into prompt context.

Persistent agent identity (v2.9) provides the storage foundation — identity documents can accumulate learned preferences and strategies. The feedback loop itself (recording outcomes, surfacing patterns, updating identity) is a v3.0 concern that emerges naturally as agents handle real tasks. *See [`2.9-platform-completion.md`](2.9-platform-completion.md) Phase 7 and [`3.0-domain-modeling.md`](3.0-domain-modeling.md).*

### Event Log as Multi-Consumer Stream

The event log's subscriber pattern supports multiple consumers without modifying the event log itself. New concerns subscribe to existing events:

- **Billing**: token usage per conversation, tool call counts
- **Compliance**: audit trail of agent actions and decisions
- **ML training**: completed conversation → training data pipeline
- **External webhooks**: notify external systems of agent activity

Each consumer is a projection — derived from the same ground-truth events. *See [`2.3-spec-raw.md`](2.3-spec-raw.md) subscriber pattern.*

### Proactive Task Creation

Agents that identify work without being triggered by events. A monitoring agent that notices degrading performance and creates a task before anyone complains. A product-agent that synthesizes user feedback patterns into feature suggestions.

Scheduled agent execution (v2.9) provides the trigger mechanism — agents can run periodically to review their domain. The proactive behavior itself is prompt-level: the agent's schedule trigger starts a conversation where it reasons about whether action is needed. *See [`2.9-platform-completion.md`](2.9-platform-completion.md) Phase 5.*

### Agent Definition Marketplace

Agent definitions are data (YAML + Markdown), not code. This enables third-party agent types — organizations could publish agent definitions that others install, like plugins. The ToolRegistry resolves tool references at runtime, so definitions are portable across deployments as long as the required tools are registered.

Requires: definition packaging format, tool dependency declaration, permission model for third-party definitions. *See [`2.3-spec-raw.md`](2.3-spec-raw.md) declarative definitions discussion.*

### Task Marketplace

When an agent creates a task that could be handled by multiple assignees, a matching mechanism selects the best fit based on current workload, expertise, and task characteristics.

The entity directory (v2.7) provides the foundation: capability profiles and queryable entities. The marketplace layer adds workload awareness, preference learning, and sophisticated matching. Requires: capacity tracking, match scoring (could be LLM-driven), feedback loop from task outcomes to improve future matching.

### Dashboard to Management API

The dashboard's service layer (`packages/dashboard/`) and agent-service API endpoints were designed as the seed of a management API. The evolution path:

1. **Read-only dashboard** (v2.4, shipped) — observability via browser
2. **Write operations** — retry, cancel, reassign via dashboard
3. **External API** — programmatic access to the same operations
4. **Multi-source service layer** — unified interface over Postgres + agent-service + future stores

*See [`2.4-spec-raw.md`](2.4-spec-raw.md) service layer design.*

### Domain-Language Action Primitives

v2.6 abstracts outbound *communication* — agents use reply/ask/notify instead of channel-specific messaging tools. The same pattern could extend to *action* tools: agents reason about domain operations (create work item, submit code change) while infrastructure routes to the correct integration.

Today, agents use integration-specific action tools directly: `linear:create_issue`, `github:create_branch`, `github:create_pull_request`. This is intentional — action tools have richer, integration-specific interfaces that don't map cleanly to a single abstraction. But as the platform gains more integrations (Jira, GitLab, Bitbucket), the O(agents x integrations) scaling problem that motivated v2.6's communication abstraction will surface for actions too.

The denormalizer pattern (dispatch by context) could generalize: `work:create_item` dispatches to Linear or Jira based on workspace configuration, `code:create_pr` dispatches to GitHub or GitLab based on repository context. The question is which action interfaces are genuinely isomorphic across integrations versus which have semantic differences that make abstraction lossy. Communication worked because the interface is simple (text + address). Action tools may have richer interfaces where forced unification loses important capabilities.

This is deliberately deferred to v3.0 — let role analysis and real usage reveal which actions genuinely unify before building abstractions. *See [`3.0-domain-modeling.md`](3.0-domain-modeling.md).* Requires: analysis of integration-specific action tool interfaces, workspace-level integration configuration, and a dispatch mechanism analogous to the communication denormalizer.

## Design Decisions Log

| Decision | Rationale | Date |
|----------|-----------|------|
| Control flow via tool calls, not orchestration graphs | LLM reasons about what to do next; no external workflow engine. Migrated from LangGraph to Anthropic native tool-use. | 2026-01-15 |
| Event log as append-only ground truth | Everything else is a projection. Enables multi-consumer subscriptions, rebuilds, and audit. | 2026-01-22 |
| Agent definitions as YAML + Markdown data | Enables version control, runtime creation, external management, multi-tenancy. Implementations stay in code. | 2026-01-22 |
| Signal queueing, not retry backoff | Signals arriving before wait_for are stored and checked on next pause — structural fix for race conditions. | 2026-01-22 |
| Observability as infrastructure | Agent execution visibility is foundational, not optional. Tool usage monitored like service-to-service calls. | 2026-02-04 |
| Auth-ready architecture from day one | Middleware pipeline, context parameters, route patterns structured for auth before it was required. Near-zero cost upfront, expensive to retrofit. | 2026-02-04 |
| Service layer as future API boundary | Internal abstractions designed for external exposure. Start with the interface clients would need, implement locally first. | 2026-02-04 |
| Serialize concurrent task conversations | Correct > fast. One problem at a time. Matches human mental model. | 2026-02-05 |
| Integration layer owns correlation, not router | Integration processes both sides (outgoing MCP + incoming webhooks) — has the most information. | 2026-02-05 |
| Agent-authored handoffs, not auto-generated | Agent knows what's important. Auto-summary treats everything equally. | 2026-02-05 |
| Polymorphic creator/assignee from day one | Avoids schema migration when adding human assignment. Costs nothing now. | 2026-02-05 |
| Nullable task_id on conversations | Backward compatibility. Existing conversations don't need tasks. | 2026-02-05 |
| Handoff type as metadata, not framework behavior | Types will grow. Framework stores and delivers; agent interprets. | 2026-02-05 |
| Task != external artifact | Tasks reference artifacts but aren't defined by them. Keeps the model flexible. | 2026-02-05 |
| Stale task cleanup: hybrid approach | Framework flags (scheduled job), agent decides (follow up, discard, retry). Agent-first. | 2026-02-05 |
| Prompt rewrites use constitutional + few-shot approach | Replaces state machines with reasoning patterns. More robust to novel inputs. | 2026-02-05 |
| Prompt guide as formal ruleset | Ensures consistency across human and LLM contributors. Lives next to agent definitions. | 2026-02-05 |
| Symmetric normalization (inbound + outbound) | Inbound adapters already abstract channels into domain signals. Outbound denormalizers complete the symmetry — agents never touch channel-specific details. | 2026-02-08 |
| Classify by intent, reply by origin | Signal semantics (approval, feedback) are channel-independent. Reply routing follows the originating channel via replyContext. Agent reasons about what to say, not where to say it. | 2026-02-08 |
| Intent-based communication tools (reply/ask/notify) | Three tools replace O(agents x integrations) channel-specific tools. Adding a new integration requires zero agent changes. See `2.6-unified-agent-communication.md`. | 2026-02-08 |
| Echo filtering at integration layer only | Integrations know their own OAuth identity — filter agent-generated webhooks before they reach adapters or router. No adapter safety net (unreliable signal), no router involvement (wasteful LLM calls). | 2026-02-09 |
| Communication tools render, denormalizer dispatches | ask() renders options as text before calling the denormalizer. The denormalizer receives plain text and dispatches — it never formats. Clean separation: tools own content, denormalizer owns routing. | 2026-02-09 |
| defaultNotifyTarget from env config, not YAML | Agent definitions reference deployment-specific channel IDs. Env vars are the current reality; YAML-based config deferred to multi-account/multi-workspace milestone. | 2026-02-09 |
| Orchestrators collaborate, sub-agents execute | Two tiers with different collaboration models. Orchestrators are peers (directory, delegation, handshakes). Sub-agents are internal workers (shared budget, no directory presence). Collaboration system operates at orchestrator tier only. | 2026-02-09 |
| Task materialization as policy, not architecture | Same delegation mechanism regardless of delivery medium. Whether tasks create Linear tickets or internal signals is a prompt-level decision. Extends the denormalizer pattern from communication to delegation. | 2026-02-09 |
| Negotiation handshake for delegation | Delegation is a handshake (accept/reject/estimate), not fire-and-forget. Gives delegators agency over wait/pivot/escalate decisions. Mirrors human collaboration patterns. Strategy is swappable. | 2026-02-09 |
| Entity directory seeded from YAML, queryable in DB | Agent definitions remain YAML (source of truth). Directory table in DB enables capability-based queries at runtime. Humans configured alongside agents. Same seed pattern as MCP permissions. | 2026-02-09 |
| Knowledge classified by type, scoped by visibility | Private notepad for unstructured agent thinking. Shared knowledge for team-wide facts. Classification determines storage, access, and lifecycle. User-configurable scope policies. | 2026-02-09 |
| `knowledge:` namespace, not `memory:` | Distinguishes shared knowledge (persists across agents, classified, curated) from private working memory (agent notepad). Avoids confusion with conversation history or history compaction. | 2026-02-09 |
| Delegation vs hand-off as prompt-level decision | Both use the same infrastructure (task:delegate, directory, handshake). Delegation waits for a result (wait_for_task); hand-off moves on. The agent decides based on whether it needs the result to continue — no framework code distinguishes the two. | 2026-02-13 |
| Completion obligations differ by work source | Triggered work: external tool updates only. Delegated work: task:complete_task required. Delegated + external: external updates first, task:complete_task last (ordering prevents races on shared state when delegator resumes). All prompt-level, not framework-enforced. | 2026-02-13 |
| Platform then domain intelligence | Infrastructure and domain intelligence built in distinct phases. Completing the platform eliminates the infrastructure variable — when an agent fails, you know it's an intelligence problem. | 2026-02-15 |
| Human collaboration deferred to post-3.0 | Humans should interact with competent agents. Current semi-automatic workflow works well. Formal agent-to-human protocols after agents are worth collaborating with. | 2026-02-15 |
| Domain action primitives deferred to 3.0 discovery | Let role analysis reveal which actions are genuinely isomorphic. Communication unification worked (text + destination is universal). Action tools have richer, divergent interfaces — premature abstraction risks being lossy. | 2026-02-15 |
| Persistent agent identity as structured documents | Knowledge entries are atoms; agents need maintained mental models. Identity documents versioned, agent-scoped, injected at conversation start. Different primitive from knowledge store. | 2026-02-15 |
| Sub-agent discovery by capability | Hardcoded YAML sub-agent lists won't scale to 10+ types. Capability-based spawn parallels the directory pattern for orchestrators. Backward compatible with explicit IDs. | 2026-02-15 |
| Scheduled execution via synthetic events | Periodic agent work fires synthetic events through existing EventRouter. Same trigger mechanism, different source. pg-boss handles scheduling. | 2026-02-15 |
