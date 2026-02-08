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

### Pause/Resume Without Context Loss

When a conversation pauses (wait_for), the full Anthropic message history is persisted — not a summary, not a snapshot, the actual messages. When it resumes, the agent has perfect memory of everything that happened. History compaction (pruning old tool results, summarizing long conversations) is a separate concern driven by token limits, not by the pause/resume mechanism. *Established in [`2.3-spec-raw.md`](2.3-spec-raw.md).*

### Observability as Infrastructure

Visibility into agent execution is not a nice-to-have dashboard — it's infrastructure on the same level as durability and retry logic. Without it, the feedback loop for improving agents becomes the bottleneck. You can't improve what you can't see.

Agents are production systems. Their tool usage should be monitored like service-to-service calls — latency, failure rate, call volume. *Established in [`2.4-spec-raw.md`](2.4-spec-raw.md).*

### Abstractions That Defer Infrastructure Decisions

EventLog, ConversationExecutor, ToolRegistry are all interfaces that abstract their backing stores. Today they use Postgres. Tomorrow they could use Kafka, SQS, DynamoDB — without touching agent code. Build the interface that makes sense for the domain; let the backing store evolve independently. *Established in [`2.3-spec-raw.md`](2.3-spec-raw.md).*

### Anticipate Known-Future Requirements

Some requirements have near-certain future probability (auth, multi-tenancy, API access). Making architecture "ready" for these costs near-zero upfront but is expensive to retrofit. v2.4's auth-ready middleware pipeline and service-layer abstractions are examples: structured for auth before auth was required, so adding it later is additive, not surgical. *Established in [`2.4-spec-raw.md`](2.4-spec-raw.md).*

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
- Agent → Agent: Partially implemented (spawn_agent, but no task continuity)
- Agent → Human: Poorly modeled (request_human_input blocks and waits)

### Target State

All three directions use the same primitive: create a task with a creator and an assignee. The framework handles lifecycle regardless of who's on each end.

Agent → Human tasks are delivered through integration channels (Slack message, Linear issue assigned to human). The agent doesn't need to know the delivery mechanism — it creates a task for a human, and the framework handles notification via the appropriate integration.

### What This Enables

- Product-agent notices a pattern in recent tickets and creates a task for a human to investigate
- Dev-agent realizes a dependency is unmaintained and tasks product-agent to evaluate alternatives
- QA agent finds a systemic quality issue and tasks product to prioritize tech debt
- Monitoring agent detects an anomaly and tasks dev-agent to investigate, then tasks a human to verify the fix in production

### Not In v2.5

Bidirectional assignment is a design principle, not a v2.5 deliverable. The schema supports it (polymorphic creator/assignee). The prompt guidance encourages thinking about it. But the actual agent → human flow (task notification, human completion tracking) is future work.

## Expansion Paths

These are not planned — they're possibilities the architecture should support.

### Cross-Agent Collaboration

Agents aware of each other's active tasks. Product-agent can check if dev-agent is already working on something before creating a new task. Dev-agent can ask product-agent for clarification mid-task without creating a separate conversation.

The mechanism is tools that query active work (task discovery, in v2.5), not framework-level orchestration. Collaboration happens through shared state that agents access via tools, not through an orchestrator that coordinates them. *See [`2.2-spec-raw.md`](2.2-spec-raw.md) cross-agent awareness discussion.*

### Agent-Managed Memory

Agents that learn from past task outcomes. "Last time I approached a similar issue, my first attempt failed because X — try Y instead." Requires a memory mechanism (separate from task handoffs) that persists across tasks.

The natural implementation is `memory:save` and `memory:search` tools — the agent decides what to remember and when to recall, consistent with "framework provides mechanism, agent provides intelligence." Aligns with MemGPT/Letta research on agent-managed context. *See [`2.3-spec-raw.md`](2.3-spec-raw.md) Phase 3 history management discussion.*

### Cross-Session Learning

Aggregating patterns across completed tasks to improve agent performance. "Dev-agent tasks in this area of the codebase tend to need more research." Requires: task analytics + feedback loop into prompt context.

### Event Log as Multi-Consumer Stream

The event log's subscriber pattern supports multiple consumers without modifying the event log itself. New concerns subscribe to existing events:

- **Billing**: token usage per conversation, tool call counts
- **Compliance**: audit trail of agent actions and decisions
- **ML training**: completed conversation → training data pipeline
- **External webhooks**: notify external systems of agent activity

Each consumer is a projection — derived from the same ground-truth events. *See [`2.3-spec-raw.md`](2.3-spec-raw.md) subscriber pattern.*

### Proactive Task Creation

Agents that identify work without being triggered by events. A monitoring agent that notices degrading performance and creates a task before anyone complains. A product-agent that synthesizes user feedback patterns into feature suggestions.

Requires: a scheduling mechanism for agents to periodically review their domain + prompt guidance for proactive behavior.

### Agent Definition Marketplace

Agent definitions are data (YAML + Markdown), not code. This enables third-party agent types — organizations could publish agent definitions that others install, like plugins. The ToolRegistry resolves tool references at runtime, so definitions are portable across deployments as long as the required tools are registered.

Requires: definition packaging format, tool dependency declaration, permission model for third-party definitions. *See [`2.3-spec-raw.md`](2.3-spec-raw.md) declarative definitions discussion.*

### Task Marketplace

When an agent creates a task that could be handled by multiple assignees, a matching mechanism selects the best fit based on current workload, expertise, and task characteristics.

Requires: agent capability profiles, workload tracking, matching logic (could be LLM-driven).

### Dashboard to Management API

The dashboard's service layer (`packages/dashboard/`) and agent-service API endpoints were designed as the seed of a management API. The evolution path:

1. **Read-only dashboard** (v2.4, shipped) — observability via browser
2. **Write operations** — retry, cancel, reassign via dashboard
3. **External API** — programmatic access to the same operations
4. **Multi-source service layer** — unified interface over Postgres + agent-service + future stores

*See [`2.4-spec-raw.md`](2.4-spec-raw.md) service layer design.*

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
