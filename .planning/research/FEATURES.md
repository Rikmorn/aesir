# Feature Landscape: v2.5 Agentic Conversations

**Domain:** Task primitives, conversation reopening, agent handoffs, integration event correlation, and goal-oriented prompt rewrites for an existing agentic development platform.
**Researched:** 2026-02-06
**Overall Confidence:** MEDIUM-HIGH (task primitives and handoff patterns well-established across frameworks; prompt rewrite evaluation is nascent; integration correlation is bespoke)
**Context:** v2.5 milestone -- adding continuity across conversations, task-based coordination, bidirectional event correlation, and replacing procedural prompts with goal-oriented reasoning patterns.

---

## Competitor/Framework Analysis

Before categorizing features, here is what production agent frameworks actually provide for the capabilities v2.5 targets.

### Task Primitives / Units of Work

| Framework | Task Model | Hierarchy | Delegation | Context Passing | Status |
|-----------|-----------|-----------|------------|-----------------|--------|
| **OpenAI Agents SDK** | No explicit task primitive. Work is modeled as "handoffs" between agents. The conversation IS the work unit. | Flat. No parent-child task model. Handoff chains are linear. | `transfer_to_agent()` tool call. One-way control transfer. Full conversation history passes by default, filterable via `input_filter`. | Full conversation history, optionally filtered. `on_handoff` callback for side effects. Structured input via `input_type` param. | Production (2025 GA). Provider-agnostic. |
| **CrewAI** | First-class `Task` objects with description, expected_output, agent assignment, and context dependencies. Tasks are the core orchestration unit. | Hierarchical process with manager agent. Manager allocates tasks based on agent capabilities. No explicit parent_id -- hierarchy via process structure. | `allow_delegation=True` enables agents to ask each other for help. A2A protocol for cross-crew delegation. | Task context passed as structured descriptions. Agent memory (short-term, long-term, entity) enables cross-task learning. | Production. 20K+ GitHub stars. |
| **LangGraph** | No explicit task primitive. State graph nodes are the work units. State is the coordination mechanism. | Graph-based. Nodes can branch, merge, loop. Not strictly hierarchical but supports hierarchical patterns. | Node transitions. State passed via shared `TypedDict` with reducer functions. | Explicit state schema with Annotated types. Full checkpoint persistence via PostgresSaver. Thread-based conversation continuity. | Production. Recommended over LangChain for agents. |
| **Google ADK** | No explicit task primitive. Agents form a tree via `sub_agents`. Work is delegated via `transfer_to_agent()` or `AgentTool` invocation. | Explicit parent-child tree structure. Single-parent rule enforced. Three workflow agents: Sequential, Parallel, Loop. | LLM-driven delegation (transfer_to_agent) or explicit invocation (AgentTool). | Shared `InvocationContext` with `context.state` dictionary. `output_key` auto-saves agent output to state. | Production (2025). |
| **Microsoft Agent Framework** | Multi-step workflow processes. "Task adherence" as governance feature. Converges AutoGen + Semantic Kernel. | Multi-level hierarchies supported. Manager-worker pattern in AutoGen. | Agent-to-agent delegation via conversation patterns. Manager allocates based on capabilities. | Shared session state. Message-passing between agents. | Public preview. GA targeted Q1 2026. |

**Key insight:** No major framework has an explicit "task" table as a first-class database entity the way Aesir v2.5 proposes. OpenAI and LangGraph treat conversations as the work unit. CrewAI has Task objects but they are in-memory orchestration primitives, not persisted coordination entities. Aesir's task primitive -- a persisted, polymorphic, hierarchical coordination entity that groups conversations -- is genuinely novel.

**Confidence: HIGH** -- Direct examination of official documentation for all five frameworks.

### Conversation Reopening / Continuity

| System | Model | Reopen Trigger | Context on Reopen | Reopen vs New | Status |
|--------|-------|----------------|-------------------|---------------|--------|
| **Zendesk** | Solved -> Open (customer reply). Closed is terminal -- creates follow-up ticket referencing original. 4-day solved-to-closed timer (configurable). | Customer reply on Solved ticket. | Full ticket history preserved. Reassigned to original solving agent. | Solved: reopen same ticket. Closed (after 4d): new follow-up ticket with original data. | Industry standard (millions of orgs). |
| **Intercom Fin AI** | Resolved conversations can be reopened by customer follow-up. Fin resumes responding if workflow routes back to it. Only billed once per conversation even across reopens. | Customer message on resolved conversation. 4-min inactivity follow-up. | Full conversation history preserved. Fin re-engages with full context. | Reopen within resolution window. New conversation after closure. | Production (2025). |
| **LangGraph** | Thread-based. Same `thread_id` = same conversation with accumulated state. Checkpoints enable fault recovery and continuation. | Same thread_id on new invocation. No explicit "reopen" -- threads are inherently persistent. | Full checkpoint state including conversation history, custom state, and pending operations. | Always continuation (no separate reopen concept). | Production. |
| **Temporal** | Continue-As-New for long-running workflows. Signals on active workflows. Entity workflow pattern = one workflow per entity lifecycle. | Signal delivery. Continue-As-New for history limits. | Carry-over state explicitly passed to new execution. Signal payloads. Must handle deduplication across Continue-As-New boundaries. | Continue-As-New: new execution, same workflow ID. Signals: same execution. | Production (battle-tested). |

**Key insight:** The Zendesk model is the closest analog to Aesir's proposed approach: a grace period (Solved) where the entity can be reopened in-place, and a terminal state (Closed) where follow-ups create new entities linked to the original. Aesir's `reopen` signal on terminal conversations maps to Zendesk's "customer reply on Solved ticket." The task primitive adds what Zendesk lacks: continuity across the follow-up boundary.

**Confidence: HIGH** -- Zendesk documentation is authoritative. LangGraph and Temporal patterns verified against official docs.

### Handoff Patterns

| Framework | Handoff Types | What Transfers | Agent-Authored? | Structured? | Status |
|-----------|---------------|---------------|-----------------|-------------|--------|
| **OpenAI Agents SDK** | Single type: `transfer_to_agent()`. Implicit completion handoff (agent returns result). | Full conversation history (default), filterable. Optional structured input via `input_type`. | No. History auto-transferred. Optional `on_handoff` callback for side effects. | Semi-structured. History is raw messages; optional structured input. | Production. |
| **CrewAI** | Delegation (ask for help), task completion (return result), A2A protocol (cross-crew). | Task description, expected output, agent context. Memory provides cross-task learning. | No. Framework manages context passing between tasks. | Structured task objects. | Production. |
| **Google ADK** | `transfer_to_agent()` (LLM-driven), `AgentTool` (explicit invocation). | Shared session state via `context.state` dictionary. `output_key` saves outputs. | No. State sharing is automatic. | Structured state dictionary. | Production. |
| **Zendesk** | Escalation (agent to supervisor), transfer (agent to specialist), follow-up (closed to new). | Ticket history, internal notes, customer context. | Partially. Agents write internal notes. But metadata transfer is automatic. | Structured (ticket fields) + unstructured (notes, history). | Industry standard. |
| **Intercom** | Handover (Fin to human), escalation (guided by rules), follow-up. | Full conversation history. Custom attributes. AI-generated summary. | No. Automated summaries. Escalation rules configured by admins. | Mixed. Structured routing rules, unstructured conversation. | Production. |

**Key insight:** Aesir's agent-authored handoffs are a genuine differentiator. No major framework gives agents explicit authorship of handoff context. They either auto-transfer full history (OpenAI) or auto-generate summaries (Intercom). The v2.5 design vision correctly identifies why this matters: "The agent knows what's important. An auto-summary of a 50-message conversation treats everything equally."

However, agent-authored handoffs have a risk: if the agent writes a poor handoff, the receiving agent starts with bad context. No framework has solved this quality problem because no framework has attempted agent-authored handoffs at this level.

**Confidence: HIGH** -- Official documentation reviewed for all frameworks.

### Integration Event Correlation

| System | Outgoing Correlation | Incoming Correlation | Bidirectional? | Status |
|--------|---------------------|---------------------|----------------|--------|
| **GitHub Apps (Probot)** | Create artifact -> receive artifact ID in response. Store mapping app-side. | Webhook payloads include PR number, issue number, sender, repo. Check run/suite IDs for CI. | Manual. App must maintain its own correlation store. GitHub provides no built-in "this PR belongs to this workflow" mapping. | Standard pattern. |
| **Linear Agent Sessions** | Agent session created automatically on mention/delegation. Session tracks lifecycle. | Webhook payloads include `actor.type: "application"` to identify agent-initiated changes. Issue ID stable across webhooks. | Semi-automatic. Linear's agent session model provides some correlation. Webhook `actor` field helps distinguish agent vs human changes. | Production (2025). |
| **Slack Apps** | Send message -> receive `ts` (timestamp ID). Use `ts` as `threadTs` for threading. | Events API delivers `message` events with `channel`, `ts`, `thread_ts`. | Manual. App must store `channel + thread_ts -> task` mapping. Slack provides no built-in correlation. | Standard pattern. |
| **Temporal** | Workflow ID used as correlation key across all activities and signals. WorkflowId + RunId injected into all logs/traces. | Child workflow IDs derived from parent. Signal routing by workflow ID. | Automatic within Temporal. External correlation requires custom implementation. | Production. |

**Key insight:** Aesir's integration correlation tables (one per integration) are the correct architecture. GitHub, Linear, and Slack all return artifact IDs on creation and include those IDs in webhook payloads. The integration layer is the right place to maintain the mapping because it processes both sides of the lifecycle. This is exactly the Temporal WorkflowId pattern but applied to external artifacts.

The risk is completeness: you must record every outgoing artifact creation and handle every incoming webhook variant. Missing a correlation means the event falls through to the slow path (LLM classification), which is expensive and potentially wrong.

**Confidence: HIGH** -- GitHub and Slack webhook docs are authoritative. Linear agent session model verified.

### Prompt Engineering Patterns

| Technique | What It Is | Evidence It Works | Applicable To | Confidence |
|-----------|-----------|-------------------|---------------|------------|
| **Constitutional constraints** (negative boundaries) | State what the agent must NOT do. Leave positive space for reasoning. Inspired by Constitutional AI (Anthropic 2022). | Anthropic's context engineering guide recommends "clear, direct language at the right altitude -- specific enough to guide behavior, flexible enough to provide strong heuristics." Avoids both brittle hardcoded logic and vague high-level guidance. | Product-agent, dev-agent prompt rewrites. | HIGH -- Anthropic's own recommendation. |
| **Few-shot with reasoning** | 3-5 examples showing input -> reasoning -> action. The reasoning IS the teaching, not the output format. | Standard few-shot is well-validated. Adding reasoning traces (chain-of-thought) improves performance on complex tasks. OpenAI prompt guide: pin to model snapshots, use evals. | Product-agent (conversation judgment), dev-agent (complexity calibration). | HIGH -- Extensively validated technique. |
| **Selective chain-of-thought** | Orchestrator agents externalize reasoning in `<reasoning>` blocks. Worker agents skip this overhead. | Anthropic recommends compaction and structured note-taking for long-running agents. Reasoning blocks serve dual purpose: better decisions + observability. Cost: extra output tokens. | Dev-agent, product-agent (orchestrators only). | MEDIUM -- Sound in principle, but impact on decision quality vs token cost is task-specific. |
| **Structured output at boundaries** | Use XML tags/structured formats only where framework code parses agent output. Everything else in natural language. | Anthropic: "Every tool must justify its existence." Same applies to structured outputs. Over-structuring constrains agent flexibility. | Phase tags, handoff blocks -- already in spec. | HIGH -- Aligns with Anthropic guidance. |
| **Prompt evals / LLM-as-judge** | Use a stronger model to grade agent outputs. A/B test prompt variants via shadow testing. Track metrics (task completion, hallucination rate, user satisfaction). | Industry consensus by 2025-2026: "evaluations are no longer optional for serious agent products." Braintrust, Maxim AI, Helicone, LangSmith provide tooling. | Validating prompt rewrites before and after. | HIGH -- Industry standard, multiple production tools. |

**Confidence: HIGH** -- Anthropic's own engineering blog and prompt documentation reviewed. Industry evaluation tooling well-established.

---

## Table Stakes

Features that MUST work correctly for v2.5 to be viable. Missing any of these makes the task primitive or conversation reopening fundamentally broken.

### 1. Task CRUD and Lifecycle Management

| Feature | Why Expected | Complexity | Dependencies | Notes |
|---------|--------------|------------|--------------|-------|
| **tasks table with status machine** | Every coordination system has a work unit with statuses. Zendesk: New/Open/Pending/Solved/Closed. Linear: custom workflows. Jira: To Do/In Progress/Done. The status set (created, active, paused, completed, cancelled) maps to standard patterns. | Low | Existing agents schema, existing migration infrastructure | The spec's status set is sound. Note: no "failed" status for tasks (unlike conversations). This is intentional -- task failure is modeled as a handoff (escalation), not a terminal state. This is a good design decision. |
| **Polymorphic creator/assignee** | The spec correctly uses `creator_type + creator_id` and `assignee_type + assignee_id` instead of direct foreign keys. This supports human-to-agent, agent-to-agent, and (future) agent-to-human assignment without schema changes. | Low | None | Good forward design. CrewAI and Google ADK both assume agent-only assignment. Aesir's polymorphic model is more flexible. No framework surveyed has this. |
| **Task-conversation linking** | Conversations must be associated with tasks. The `task_id` column on conversations is the minimum viable link. Multiple conversations per task is expected (different phases, retries, follow-ups). | Low | Existing conversations table | Nullable `task_id` is correct for backward compatibility. Must add index on task_id for efficient lookup. |
| **Agent tools for task management** | `create_task`, `complete_task`, `pause_task`, `handoff_task`, `list_tasks`, `get_task_context` -- these are the agent's interface to the task system. Without them, tasks are invisible to agents. | Medium | Tool registry, MCP client patterns | 6 new tools is significant but follows existing tool factory patterns. Each tool is a thin wrapper around database operations. The critical question: are tools self-contained enough that agents understand when to use each? Anthropic recommends "non-overlapping, purpose-specific" tools. `complete_task` vs `pause_task` vs `handoff_task` have clear boundaries. |
| **Task context delivery on conversation start** | When a new conversation starts for an existing task, the agent MUST receive the most recent handoff as context. Without this, the conversation starts cold despite having task history. | Medium | Handoff table, conversation start flow | The spec says "most recent handoff as context" with older ones available via `get_task_context`. This is correct -- avoids context bloat while preserving access. Aligns with Anthropic's "just-in-time retrieval" recommendation. |

**Confidence: HIGH** -- Standard CRUD patterns. Polymorphic assignment validated by examining framework limitations.

### 2. Conversation Reopening

| Feature | Why Expected | Complexity | Dependencies | Notes |
|---------|--------------|------------|--------------|-------|
| **Reopen signal on terminal conversations** | Zendesk and Intercom both allow reopening solved/resolved conversations via customer reply. The agent equivalent: a `reopen` signal transitions completed/failed conversations back to `queued`. | Medium | Existing signal infrastructure, existing status machine in executor | Currently, signals on terminal conversations are ignored. The change is surgical: check for `reopen` signal type, transition status to `queued`, deliver signal payload. But: full message history must be loaded, and history may be very long for completed conversations. |
| **Full prior history on reopen** | When Zendesk reopens a Solved ticket, the agent sees the entire conversation. When LangGraph resumes a thread, full checkpoint state is loaded. The agent MUST have its prior conversation context. | Medium | History manager, existing message persistence | This is where Aesir's existing full-history persistence pays off. Unlike Temporal (which loses history on Continue-As-New), Aesir stores the complete message array. The risk: token budget. A completed conversation + new signal may exceed the model's context window. History compaction must run on reopen. |
| **Dashboard retry/reopen action** | Operators need manual control. Every helpdesk system has a "reopen" button. The dashboard must expose this for both completed and failed conversations. | Low | Existing dashboard infrastructure, SSE for real-time updates | Low complexity because the dashboard already has conversation detail views. Add a button that calls the `signal` API with type `reopen`. |
| **Reopen scope boundary** | Only `reopen` signal type triggers this. Other signals on terminal conversations remain ignored. This prevents accidental resurrection of completed work. | Low | Signal routing logic | Important constraint. Without it, any stale webhook could resurrect long-dead conversations. The spec is explicit about this and it is correct. |

**Confidence: HIGH** -- Zendesk and Intercom patterns are well-documented. The executor already has signal infrastructure.

### 3. Task Handoffs

| Feature | Why Expected | Complexity | Dependencies | Notes |
|---------|--------------|------------|--------------|-------|
| **task_handoffs table** | Persistent record of handoff events. Zendesk has internal notes on transfers. Temporal has event history. The handoff table captures who, what, why at each conversation boundary. | Low | Existing schema patterns | Four handoff types (completion, pause, delegation, escalation) cover the standard patterns. The spec correctly makes this metadata for agents, not framework behavior. |
| **Agent-authored handoff content** | The core differentiator. Agents write the handoff context, choosing what matters. See Handoff Patterns analysis above. | Medium | Agent tool (`handoff_task`), prompt guidance | **Risk:** Handoff quality depends entirely on prompt engineering. If the agent writes "done" as a completion handoff, the next conversation starts with nothing useful. Prompt examples must demonstrate what good handoffs look like. Few-shot examples with reasoning are critical here. |
| **Handoff context delivery** | When routing to an existing task, the most recent handoff must be delivered as conversation context. | Medium | Event routing, conversation start flow | Must be injected into the system prompt or initial message. The Anthropic recommendation: use `<context>` tags to separate dynamic per-conversation content from stable instructions. |
| **Handoff type extensibility** | The spec says "don't pattern-match on handoff_type in framework code." Framework stores and delivers; agent interprets. | Low | None beyond schema | This is correct. OpenAI's handoff is a single type with optional structured input. Aesir adds type metadata but keeps framework behavior type-agnostic. New types (e.g., "review_request", "blocked") can be added via prompt guidance alone. |

**Confidence: HIGH** -- Handoff patterns verified across multiple frameworks. Agent-authored approach is novel but architecturally sound.

### 4. Integration Correlation

| Feature | Why Expected | Complexity | Dependencies | Notes |
|---------|--------------|------------|--------------|-------|
| **Per-integration correlation tables** | Maps external artifacts to tasks. `(external_type, external_ref) -> task_id`. Each integration maintains its own table because it processes both outgoing (MCP) and incoming (webhook) traffic. | Low | Integration schema infrastructure (linear.*, github.*, slack.*) | Schema is straightforward. The primary key on `(external_type, external_ref)` enforces one-to-one artifact-to-task mapping. This may be too restrictive -- a PR could relate to multiple tasks (e.g., monorepo with multiple issue fixes). Consider: should this be a unique constraint instead of primary key, or should it support many-to-many? |
| **Outgoing correlation recording** | When an agent creates a PR, issue, or Slack message via MCP, the integration records the correlation. Agent passes `task_id` as MCP call context. | Medium | MCP client changes (pass task_id), integration endpoint changes (record correlation) | This requires changes to every MCP tool invocation to include task_id context. The MCP client needs a new header or parameter. Integration endpoints need new logic to extract and store the correlation. Not complex per-tool, but multiplicative across all tools. |
| **Incoming correlation lookup** | When a webhook arrives, the integration looks up the correlation and attaches the task reference before forwarding to the agent service. | Medium | Webhook handler changes in all three integrations | This is the critical path for event routing. Must be fast (database lookup on indexed primary key). Must handle missing correlations gracefully (fall through to existing routing). |
| **Event routing priority change** | Task reference -> fast-path start -> reasoning path. This inverts the current routing priority from "which agent handles this?" to "which task does this belong to?" | Medium | Event router refactor | Significant change to the routing pipeline. The current EventRouter is pure (no I/O in `handle()`). Adding task lookup makes it async. Consider: should the integration layer attach the task reference before the event reaches the router, or should the router do the lookup? The spec says the integration layer -- this is correct. |

**Confidence: MEDIUM-HIGH** -- Architecture is sound but implementation touches many files across multiple packages. The one-to-one constraint on correlation tables needs validation.

### 5. Prompt Rewrites (Phase 1)

| Feature | Why Expected | Complexity | Dependencies | Notes |
|---------|--------------|------------|--------------|-------|
| **Goal-oriented identity sections** | Replace procedural descriptions with purpose statements. Anthropic: "clear, direct language at the right altitude." | Low | Existing prompt.md files | The current prompts have good identity sections already. The change is reducing the procedural content in `<workflow_guidance>` and `<behavior>` sections. |
| **Constitutional constraints replacing procedures** | Replace "FIRST do X, THEN do Y" with "never do Z without checking for Q." | Medium | Existing behavior encoded in prompts | This is the highest-value prompt change. The current product-agent prompt has explicit step sequences (e.g., "Steps 1-5 happen in ONE turn"). Replacing these with constraints requires careful testing to ensure the agent still follows the intended behavior without the rails. |
| **Few-shot examples with reasoning** | 3-5 examples showing input -> reasoning -> action. Teach judgment, not rule-following. | Medium | Prompt guide already written | The Prompt Guide already defines the format. The work is writing high-quality examples that cover common cases, edge cases, and judgment calls. This requires domain expertise about what the agents actually encounter. |
| **Reduced directive density** | Count MUST/ALWAYS/NEVER directives. Current product-agent has ~15+ strong directives. Target: <10 for orchestrators, <5 for workers. | Low | Directive audit of existing prompts | The Prompt Guide provides the audit methodology. Each directive must pass the test: "Is there a reasonable scenario where the agent should violate this?" |
| **Reasoning blocks for orchestrators** | `<reasoning>` blocks before significant decisions. Stored in event log. | Low | Event log already captures agent output | The format is already defined in the Prompt Guide. The agent naturally produces reasoning when prompted. The key: tell the agent WHEN to reason (significant decisions) and WHEN to skip (routine operations). |

**Confidence: HIGH** -- Prompt engineering patterns well-validated. The Prompt Guide is already written and comprehensive.

### 6. Task Concurrency Serialization

| Feature | Why Expected | Complexity | Dependencies | Notes |
|---------|--------------|------------|--------------|-------|
| **One active conversation per task** | The spec says "Events for the same task are serialized. One problem at a time." This prevents race conditions where two conversations modify the same external artifacts simultaneously. | Medium | Task-conversation relationship, event routing | Temporal's workflow uniqueness guarantee is the closest analog. The implementation: when routing to a task with an active conversation, deliver as signal. When no active conversation, create new one. Must handle edge cases: what if the active conversation is about to complete? Signal queueing handles this. |
| **Signal queueing for serialized events** | When a second event arrives for a task with an active conversation, it must be queued as a signal and delivered when the active conversation completes or pauses. | Low | Existing signal queueing infrastructure | The existing `queued_signals` JSONB column on conversations already handles this pattern. The change is: look up signals at the task level, not just the conversation level. |

**Confidence: HIGH** -- Direct extension of existing signal queueing patterns.

---

## Differentiators

Features that set Aesir apart. Not expected by the ecosystem, but genuinely valuable.

### 1. Persisted Task Primitive (Genuine Innovation)

| Feature | Value Proposition | Complexity | Dependencies | Notes |
|---------|-------------------|------------|--------------|-------|
| **Tasks as first-class database entities** | No major agent framework persists tasks as coordination entities. OpenAI and LangGraph treat conversations as the work unit. CrewAI has in-memory Task objects. Aesir's persisted task table enables: cross-conversation continuity, historical audit, task-based routing, human-agent coordination. | Medium | Schema migration, tool factories | This is the most novel aspect of v2.5. The value compounds over time as tasks accumulate context across multiple conversations. The closest industry analog is project management tools (Linear, Jira) -- but those are external. Aesir has its own internal task graph. |
| **Task hierarchies (parent-child)** | Google ADK and CrewAI support hierarchical agent structures but not hierarchical task structures. A parent task with subtasks enables: dev-agent creating research/implement/test subtasks, product-agent creating multiple issue-creation subtasks. | Low | `parent_id` column, depth limit check | The depth limit (max 5 levels) prevents circular delegation. Implementation is simple (recursive query or iterative parent check). The value is in prompt guidance: teaching agents to decompose work into subtasks. |
| **Bidirectional assignment model** | The polymorphic `creator_type + assignee_type` design enables agent-to-human task assignment -- something no surveyed framework supports natively. Today's `request_human_input` becomes a special case of "create task assigned to human." | Low | Already in schema design | Not fully implemented in v2.5 (the agent-to-human notification pathway is future work), but the schema supports it from day one. This avoids a painful migration later. |

**Confidence: HIGH** -- Verified by examining all five major frameworks. None have this.

### 2. Agent-Authored Handoffs

| Feature | Value Proposition | Complexity | Dependencies | Notes |
|---------|-------------------|------------|--------------|-------|
| **Agents write their own handoff context** | Every other framework auto-transfers full history or auto-generates summaries. Agent-authored handoffs let the agent curate what matters. A 50-message conversation gets a 200-word handoff highlighting the key insight, not a 5000-word history dump. | Medium | Prompt engineering, `handoff_task` tool | The risk/reward profile is high on both sides. Good handoffs = dramatically better context efficiency. Bad handoffs = worse than auto-summary. Mitigation: few-shot examples in prompts showing good vs bad handoffs. |
| **Typed handoff strategies** | Completion, pause, delegation, escalation -- each implies different content needs. A completion handoff says "here's what I built." A delegation handoff says "here's what I need you to do." The type guides the agent's writing. | Low | Schema, prompt guidance | The types are metadata, not framework behavior. This is extensible by design -- add new types via prompt guidance alone. |

**Confidence: MEDIUM** -- No production system uses agent-authored handoffs at this level. Sound in theory, must be validated empirically.

### 3. Integration-Layer Correlation (vs Router-Side Matching)

| Feature | Value Proposition | Complexity | Dependencies | Notes |
|---------|-------------------|------------|--------------|-------|
| **Correlation tables in integration packages** | The integration processes both outgoing (create PR) and incoming (PR review webhook) traffic. It has the most information for mapping artifacts to tasks. This is more reliable than router-side JSONB metadata matching (which is fuzzy). | Medium | Per-integration schema changes, MCP protocol changes | The design matches Temporal's WorkflowId pattern applied to external artifacts. The integration is the boundary where correlation is most accurate. |
| **Routing priority inversion** | "Which task does this belong to?" instead of "Which agent handles this?" Most events in a mature system are follow-ups, not novel work. Task-first routing is O(1) database lookup vs O(n) LLM classification. | Medium | Event router refactor | This reduces LLM slow-path invocations (expensive) in favor of database lookups (cheap). The savings compound as the system handles more concurrent tasks. |

**Confidence: HIGH** -- Temporal's correlation pattern is battle-tested. The integration-layer approach is architecturally sound.

### 4. Prompt Rewrites as Systematic Upgrade

| Feature | Value Proposition | Complexity | Dependencies | Notes |
|---------|-------------------|------------|--------------|-------|
| **Formal prompt authoring guide** | The PROMPT_GUIDE.md is a ruleset for prompt quality. No surveyed framework publishes internal prompt authoring standards. This ensures consistency across agents and contributors. | Already done | PROMPT_GUIDE.md exists | The guide is comprehensive: 7 rules, anti-pattern catalog, review checklist. The value is in enforcement -- using it as the standard for v2.5 prompt rewrites. |
| **Constitutional + few-shot approach** | Replaces state machines with reasoning patterns. More robust to novel inputs. Aligns with Anthropic's own recommendations for context engineering. | Medium | Domain expertise for example writing | The current product-agent prompt has ~15 strong directives and explicit step sequences. Replacing these with 4-5 constraints and 3-5 examples requires deep understanding of what the agent encounters in production. |

**Confidence: HIGH** -- Anthropic's own engineering blog validates this approach.

---

## Anti-Features

Things to deliberately NOT build. Common mistakes in this domain.

### 1. Auto-Generated Handoffs

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **LLM-generated summaries at conversation boundaries** | Intercom's Fin generates AI summaries on handover. These treat all messages equally, miss the agent's assessment of what matters, and add latency + cost. The v2.5 design vision explicitly rejects this: "An auto-summary of a 50-message conversation treats everything equally. The agent knows that the key insight was on message 37." | Agent writes its own handoff via `handoff_task` tool. Few-shot examples demonstrate good handoff content. If the agent doesn't write one (bug), the framework stores a minimal "no handoff provided" record -- never auto-generates. |

### 2. Framework Pattern-Matching on Handoff Types

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **If/else on handoff_type in executor code** | The spec's expansion constraint #3: "Don't pattern-match on handoff_type in framework code." If you add `if (handoff.type === 'escalation') { notifySlack() }`, you're fighting the agent for control. The agent should decide whether and how to notify. | Store handoff type as metadata. Deliver to receiving agent as context. The agent interprets the type and decides actions. New handoff types can be added without any framework code changes. |

### 3. Auto-Completion on External Signals

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Task auto-completes when PR merges or issue closes** | The spec's expansion constraint #6: "Don't auto-complete on external signals." A merged PR doesn't mean the task is done -- there might be documentation, deployment verification, or monitoring to follow. The agent decides when work is complete. | Deliver the external signal (pr_merged, issue_closed) to the task's active conversation. The agent evaluates whether the task is actually done and calls `complete_task` if so. |

### 4. Global Orchestrator Agent

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **A persistent agent that routes all events and manages all tasks** | The spec's open question about a global orchestrator. This creates a bottleneck, single point of failure, and high cost (every event goes through an LLM). LangGraph's recommendation: keep orchestration lightweight and stateless where possible. | Task-first routing (database lookup) for correlated events. Fast-path for unambiguous triggers. LLM slow-path only for genuinely novel/ambiguous events. The routing logic is distributed across the integration layer and event router, not centralized in one agent. |

### 5. Complex Task Status Machine

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Adding Zendesk-style intermediate statuses (pending, on-hold, blocked, review)** | Over-engineering the status machine creates framework behavior that fights agent judgment. Zendesk needs 6 statuses because human agents need workflow rails. AI agents reason about their state -- they don't need a status to tell them they're blocked. | Keep 5 statuses (created, active, paused, completed, cancelled). Use handoff types and task metadata for richer state. The agent knows it's blocked; it writes a handoff saying so. Adding a "blocked" status adds framework code without agent value. |

### 6. Eager Context Loading

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Loading all task handoffs into the system prompt** | The spec's open question about context pressure. Long-lived tasks accumulate handoffs. Loading all of them wastes context window on potentially irrelevant history. Anthropic's recommendation: "just-in-time retrieval via tools rather than pre-processing all data upfront." | Deliver most recent handoff on conversation start. Provide `get_task_context` tool for the agent to retrieve older handoffs when needed. The agent decides how far back to look. |

### 7. Deterministic Stale Task Cleanup

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Framework auto-closes tasks after N days of inactivity** | The spec's open question. Auto-closing may kill work that's legitimately paused (waiting for external dependency, pending human action). Glovo's approach (auto-remove stale feature flags) works for flags but not for work items that may have legitimate long pauses. | Hybrid approach (per spec): framework flags inactive tasks via scheduled job (sends timeout signal), agent decides what to do (follow up, discard, retry). Same pattern as existing `wait_for` timeouts. The framework detects; the agent decides. |

---

## Feature Dependencies

```
Phase 1: Prompt Rewrites (independent)
  - No dependencies on other v2.5 features
  - Can be done in parallel with everything else

Phase 2: Conversation Reopening
  - Depends on: existing executor signal infrastructure
  - Partially independent: reopen works without tasks

Phase 3: Task Primitive
  - tasks table + task_handoffs table (schema)
  - conversations.task_id column (schema)
  - 6 agent tools (create_task, complete_task, pause_task, handoff_task, list_tasks, get_task_context)
  - Integration correlation tables (per integration)
  - MCP protocol changes (task_id context)
  - Event routing priority change (task-first lookup)
  - Depends on: conversation reopening (for task-routed events)

Phase 4: Prompt Evolution
  - Depends on: task tools being available
  - Depends on: prompt rewrites establishing the new style
  - Agents learn to use task lifecycle in their prompts

Dependency chain:
  Prompt Rewrites ─────────────────────────────────────┐
                                                        ├──> Prompt Evolution
  Conversation Reopening ──> Task Primitive ────────────┘
```

### Critical Path

The critical path is: Conversation Reopening -> Task Primitive -> Prompt Evolution.

Prompt rewrites are independent and should be done first (or in parallel with Phase 2) because they establish the new prompt style that Phase 4 builds on.

---

## MVP Recommendation

For MVP (minimum that delivers value), prioritize:

1. **Prompt Rewrites** (Phase 1) -- Highest ROI. Removes the state machine anti-pattern from both orchestrator prompts. No schema changes, no runtime changes. Pure prompt improvement. Testable immediately.

2. **Conversation Reopening** (Phase 2) -- Enables follow-up on completed work. Surgical change to executor (allow `reopen` signal on terminal conversations). Dashboard button for manual reopen.

3. **Task Primitive core** (Phase 3, partial) -- tasks table, task_handoffs table, conversations.task_id, 6 agent tools. Integration correlation tables.

4. **Event routing changes** (Phase 3, partial) -- Task-first routing. Integration correlation lookup.

5. **Prompt Evolution** (Phase 4) -- Update agent prompts to leverage tasks.

### Defer to Post-v2.5

- **Agent-to-human task notification pathway**: Schema supports it, but the delivery mechanism (Slack DM, email) is future work.
- **Cross-agent task discovery**: Agents querying each other's tasks for coordination. Useful but not critical for v2.5.
- **Task analytics / cross-session learning**: Aggregating patterns across completed tasks. Requires task history to accumulate first.
- **Proactive task creation**: Agents identifying work without event triggers. Requires scheduling mechanism.
- **Many-to-many artifact correlation**: If a PR fixes multiple issues/tasks, the one-to-one correlation table may need relaxing. Validate against real usage before changing.

---

## Spec Validation: Where v2.5 Aligns With and Diverges From Industry

### Strong Alignment

| Spec Decision | Industry Pattern | Assessment |
|---------------|-----------------|------------|
| Nullable task_id on conversations | LangGraph thread-based persistence; backward-compatible by design | Correct. Existing conversations work unchanged. |
| Integration-layer correlation | Temporal WorkflowId pattern applied to external artifacts | Correct. Integration has the most information for mapping. |
| Agent-decided task completion | No framework auto-completes on external signals | Correct. Agent judgment > deterministic rules. |
| Constitutional + few-shot prompts | Anthropic context engineering recommendations | Correct. Well-validated approach. |
| Serialized task conversations | Temporal workflow uniqueness guarantee | Correct. Prevents race conditions. |
| Reopen via explicit signal only | Zendesk: customer reply triggers reopen, not system | Correct. Prevents accidental resurrection. |
| Most recent handoff as default context | Anthropic: just-in-time retrieval over pre-loading | Correct. Token-efficient with tool-based access to history. |

### Productive Divergence (Better Than Industry)

| Spec Decision | Industry Pattern | Assessment |
|---------------|-----------------|------------|
| Agent-authored handoffs | OpenAI: auto-transfer full history. Intercom: AI-generated summary. | **Novel and promising.** Higher potential quality but higher risk. Must be validated with good few-shot examples. |
| Persisted task primitive | No framework has this. Conversations are the work unit everywhere. | **Genuinely innovative.** Enables cross-conversation continuity that no framework provides. The value compounds over time. |
| Polymorphic creator/assignee | All frameworks assume agent-only assignment. | **Forward-looking.** Costs nothing now, prevents painful migration later. |
| Handoff type as metadata | OpenAI has one handoff type. | **More flexible.** Types grow via prompt guidance, not framework code. |

### Potential Concerns

| Spec Decision | Concern | Mitigation |
|---------------|---------|------------|
| One-to-one correlation (PK on external_type + external_ref) | Monorepo PRs fixing multiple issues would need multiple tasks or a junction table. | Monitor real usage. If one-to-many is needed, change PK to unique constraint + add task_id to composite. |
| Agent-authored handoff quality | No production system has validated this pattern. Bad handoffs = worse than auto-summary. | Few-shot examples in prompts showing good vs bad handoffs. Monitoring handoff token counts as a proxy for quality. |
| 6 new tools at once | Anthropic recommends minimal, non-overlapping tool sets. 6 tools is a significant addition. | The tools have clear boundaries (create vs complete vs pause vs handoff vs list vs get_context). Consider: can `complete_task` and `pause_task` be merged into `update_task_status` with a status parameter? This reduces the tool count but makes tool choice less obvious. Recommendation: keep separate for clarity. |
| Prompt rewrite risk | Removing procedural rails may cause regression in edge cases the procedures handled. | Before/after evaluation using LLM-as-judge on a test suite of real conversations. Shadow testing: run both prompt versions and compare outputs. |
| Context pressure on long-lived tasks | Handoffs accumulate. `get_task_context` can return a lot of data. | Token budget on handoff content (the spec mentions this as a safety net). Summarization of old handoffs if needed. |

---

## Prioritization Matrix

| Feature | Business Value | Technical Risk | Complexity | Recommendation |
|---------|---------------|---------------|------------|----------------|
| Prompt rewrites (Phase 1) | HIGH -- Directly improves agent decision quality | LOW -- Prompts are rollbackable | LOW-MEDIUM | **Do first.** Zero infrastructure risk, immediate quality improvement. |
| Conversation reopening (Phase 2) | HIGH -- Enables follow-up on existing work | LOW -- Surgical change to existing infrastructure | MEDIUM | **Do second.** Foundation for task-based routing. |
| Task table + tools (Phase 3a) | HIGH -- Core coordination primitive | MEDIUM -- New schema, new tools | MEDIUM | **Do third.** The new capability that everything else builds on. |
| Integration correlation (Phase 3b) | HIGH -- Enables task-first routing | MEDIUM -- Touches all three integrations | MEDIUM-HIGH | **Do with Phase 3a.** Critical for event-to-task routing. |
| Event routing changes (Phase 3c) | HIGH -- Reduces LLM slow-path usage | MEDIUM -- Refactors core routing logic | MEDIUM | **Do with Phase 3b.** Completes the task-first routing pipeline. |
| Prompt evolution (Phase 4) | HIGH -- Agents leverage task lifecycle | LOW -- Prompt changes only | LOW-MEDIUM | **Do last.** Requires task tools to be available. |

---

## Sources

### Production Agent Frameworks (HIGH confidence)
- [OpenAI Agents SDK -- Handoffs](https://openai.github.io/openai-agents-python/handoffs/)
- [OpenAI Agents SDK -- Multi-Agent](https://openai.github.io/openai-agents-python/multi_agent/)
- [CrewAI Documentation -- Agents](https://docs.crewai.com/core-concepts/Agents/)
- [CrewAI -- A2A Agent Delegation](https://docs.crewai.com/en/learn/a2a-agent-delegation)
- [LangGraph -- Persistence](https://docs.langchain.com/oss/python/langgraph/persistence)
- [Google ADK -- Multi-Agents](https://google.github.io/adk-docs/agents/multi-agents/)
- [Microsoft Agent Framework Introduction](https://azure.microsoft.com/en-us/blog/introducing-microsoft-agent-framework/)

### Helpdesk/Workflow Systems (HIGH confidence)
- [Zendesk -- About the ticket lifecycle and ticket statuses](https://support.zendesk.com/hc/en-us/articles/8263915942938-About-the-ticket-lifecycle-and-ticket-statuses)
- [Zendesk -- Updating and solving tickets](https://support.zendesk.com/hc/en-us/articles/4408832151834-Updating-and-solving-tickets)
- [Intercom -- Fin AI Agent explained](https://www.intercom.com/help/en/articles/7120684-fin-ai-agent-explained)
- [Intercom -- Fin AI Agent resolutions](https://www.intercom.com/help/en/articles/8205718-fin-ai-agent-resolutions)
- [Temporal -- Managing very long-running Workflows](https://temporal.io/blog/very-long-running-workflows)
- [Temporal -- Events and Event History](https://docs.temporal.io/workflow-execution/event)

### Prompt Engineering (HIGH confidence)
- [Anthropic -- Effective Context Engineering for AI Agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Anthropic -- Constitutional AI](https://arxiv.org/abs/2212.08073)
- [OpenAI -- Prompt Engineering Guide](https://platform.openai.com/docs/guides/prompt-engineering)
- [Prompt Engineering Guide -- Few-Shot Prompting](https://www.promptingguide.ai/techniques/fewshot)

### Integration Documentation (HIGH confidence)
- [GitHub -- Webhook events and payloads](https://docs.github.com/en/webhooks/webhook-events-and-payloads)
- [Linear Developers -- Webhooks](https://linear.app/developers/webhooks)
- [Linear Developers -- Agent Interaction](https://linear.app/developers/agent-interaction)
- [Slack Events API](https://docs.slack.dev/apis/events-api/)

### Evaluation and Testing (MEDIUM confidence)
- [Braintrust -- Best prompt evaluation tools 2025](https://www.braintrust.dev/articles/best-prompt-evaluation-tools-2025)
- [Maxim AI -- Prompt Evaluation Frameworks](https://www.getmaxim.ai/articles/prompt-evaluation-frameworks-measuring-quality-consistency-and-cost-at-scale/)
- [AI Agent Evaluations Guide 2025-2026](https://www.xugj520.cn/en/archives/ai-agent-evaluations-guide-2025.html)

### Industry Analysis (MEDIUM confidence)
- [Top 7 Agentic AI Frameworks in 2026](https://www.alphamatch.ai/blog/top-agentic-ai-frameworks-2026)
- [Taxonomy of Hierarchical Multi-Agent Systems](https://arxiv.org/html/2508.12683)
- [Google Developers Blog -- Multi-Agent Patterns in ADK](https://developers.googleblog.com/developers-guide-to-multi-agent-patterns-in-adk/)
