# Architecture Research

**Domain:** Agentic Development Platform / AI Agent Orchestration System
**Researched:** 2026-01-16
**Overall Confidence:** MEDIUM (patterns are well-established, but async human-in-loop is still evolving)

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              EVENT INGESTION LAYER                               │
├─────────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │   Linear    │  │   GitHub    │  │    Slack    │  │  Other      │            │
│  │  Webhooks   │  │  Webhooks   │  │  Webhooks   │  │  Sources    │            │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘            │
│         │                │                │                │                    │
│         └────────────────┴────────────────┴────────────────┘                    │
│                                    │                                            │
│                          ┌─────────▼─────────┐                                  │
│                          │   Event Gateway   │ (validation, routing, idempotency)│
│                          └─────────┬─────────┘                                  │
├────────────────────────────────────┼────────────────────────────────────────────┤
│                              ORCHESTRATION LAYER                                 │
├────────────────────────────────────┼────────────────────────────────────────────┤
│                          ┌─────────▼─────────┐                                  │
│                          │  Workflow Engine  │ (Temporal / Custom State Machine) │
│                          │  ┌─────────────┐  │                                  │
│                          │  │ State Store │  │                                  │
│                          │  └─────────────┘  │                                  │
│                          └─────────┬─────────┘                                  │
│                                    │                                            │
│           ┌────────────────────────┼────────────────────────────────┐           │
│           │                        │                                │           │
│  ┌────────▼────────┐    ┌─────────▼─────────┐    ┌─────────────────▼────┐      │
│  │  Agent Router   │    │ Human-in-the-Loop │    │ Checkpoint Manager   │      │
│  │  (Coordinator)  │    │     Service       │    │ (Interrupt/Resume)   │      │
│  └────────┬────────┘    └─────────┬─────────┘    └──────────────────────┘      │
├───────────┼───────────────────────┼─────────────────────────────────────────────┤
│                              AGENT EXECUTION LAYER                               │
├───────────┼───────────────────────┼─────────────────────────────────────────────┤
│           │                       │                                             │
│  ┌────────▼────────┐    ┌────────▼────────┐    ┌─────────────────────┐        │
│  │  Product Agent  │    │   Dev Agent     │    │   Future Agents     │        │
│  │  ┌───────────┐  │    │  ┌───────────┐  │    │   (QA, Deploy, etc) │        │
│  │  │  LLM A    │  │    │  │  LLM B    │  │    │                     │        │
│  │  └───────────┘  │    │  └───────────┘  │    │                     │        │
│  └────────┬────────┘    └────────┬────────┘    └─────────────────────┘        │
│           │                      │                                             │
│           └──────────────────────┴──────────────────────────────────────┐      │
│                                                                          │      │
│                                    ┌─────────────────────────────────────▼─┐    │
│                                    │         Tool Abstraction Layer        │    │
│                                    └─────────────────────────────────────┬─┘    │
├──────────────────────────────────────────────────────────────────────────┼──────┤
│                              TOOL INTEGRATION LAYER                       │      │
├──────────────────────────────────────────────────────────────────────────┼──────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │      │
│  │   Linear    │  │   GitHub    │  │    Slack    │  │  Other      │◄────┘      │
│  │    API      │  │    API      │  │    API      │  │   APIs      │            │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘            │
├─────────────────────────────────────────────────────────────────────────────────┤
│                              OBSERVABILITY LAYER                                 │
├─────────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐                 │
│  │    Tracing      │  │    Metrics      │  │    Logging      │                 │
│  │  (LangSmith /   │  │  (Prometheus /  │  │  (Structured    │                 │
│  │   OpenTelemetry)│  │   Grafana)      │  │   JSON)         │                 │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| Event Gateway | Receives webhooks, validates signatures, deduplicates, routes to workflows | Custom service + message queue (Redis/Kafka) |
| Workflow Engine | Orchestrates agent execution, manages state persistence, handles failures | Temporal (recommended) or custom state machine |
| Agent Router | Dispatches tasks to appropriate agents based on type/context | Coordinator pattern with routing logic |
| Human-in-the-Loop Service | Manages approval requests, collects responses, resumes workflows | Slack/email integration + checkpoint system |
| Checkpoint Manager | Persists workflow state at interrupt points, enables resume | Part of workflow engine or custom store |
| Agent (Product/Dev) | Executes domain-specific tasks using LLM and tools | LangGraph agent or custom agent loop |
| Tool Abstraction Layer | Provides unified interface to external tools | LangChain-style tool definitions |
| Observability Layer | Traces agent decisions, monitors latency/costs, alerts on failures | LangSmith + Grafana + structured logs |

## Recommended Project Structure

```
src/
├── agents/                 # Agent definitions and implementations
│   ├── product/            # Product Agent
│   │   ├── agent.ts        # Agent configuration and loop
│   │   ├── prompts.ts      # System prompts and templates
│   │   └── tools.ts        # Product-specific tools
│   ├── dev/                # Dev Agent
│   │   ├── agent.ts
│   │   ├── prompts.ts
│   │   └── tools.ts
│   └── shared/             # Shared agent utilities
│       ├── base-agent.ts   # Base agent class/interface
│       └── llm-client.ts   # Multi-LLM client abstraction
├── workflows/              # Workflow definitions (Temporal or custom)
│   ├── feature-request.ts  # Feature request → shipped code workflow
│   ├── code-review.ts      # Code review workflow
│   └── activities/         # Workflow activities (non-deterministic operations)
│       ├── agent-execution.ts
│       └── human-approval.ts
├── tools/                  # Tool implementations
│   ├── linear/             # Linear API tools
│   ├── github/             # GitHub API tools
│   ├── slack/              # Slack API tools
│   └── registry.ts         # Tool registry for agents
├── events/                 # Webhook handlers and event processing
│   ├── handlers/           # Per-source webhook handlers
│   │   ├── linear.ts
│   │   ├── github.ts
│   │   └── slack.ts
│   ├── gateway.ts          # Event validation and routing
│   └── types.ts            # Event type definitions
├── hitl/                   # Human-in-the-loop components
│   ├── approval-service.ts # Approval request/response management
│   ├── channels/           # Notification channels (Slack, email)
│   └── state.ts            # HITL state persistence
├── observability/          # Monitoring and tracing
│   ├── tracing.ts          # Trace instrumentation
│   ├── metrics.ts          # Metrics collection
│   └── logging.ts          # Structured logging
├── config/                 # Configuration management
│   ├── agents.ts           # Agent-specific configs (LLM models, etc.)
│   └── tools.ts            # Tool configurations and credentials
└── lib/                    # Shared utilities
    ├── llm/                # LLM client wrappers
    └── storage/            # State persistence utilities
```

### Structure Rationale

- **agents/**: Each agent is self-contained with its own prompts, tools, and configuration. This supports the "specialized agents with different models" requirement.
- **workflows/**: Separates orchestration logic from agent implementation. Activities encapsulate non-deterministic operations for Temporal's replay safety.
- **tools/**: Centralized tool definitions that can be shared across agents. Registry pattern allows runtime tool discovery.
- **events/**: Clean separation of webhook handling from business logic. Gateway pattern provides validation, idempotency, and routing.
- **hitl/**: Isolated human-in-the-loop logic enables testing approval flows independently of agent execution.

## Architectural Patterns

### Pattern 1: Coordinator-Worker (Recommended for MVP)

**What:** A central coordinator agent receives tasks, dispatches to specialized worker agents, and aggregates results.

**When to use:** When you have 2-5 agents with clear role separation and need straightforward orchestration.

**Trade-offs:**
- Pros: Simple mental model, easy debugging, deterministic flow
- Cons: Coordinator can become bottleneck, single point of failure

**Confidence:** HIGH - This is Google's recommended starting pattern and aligns with your Product Agent → Dev Agent flow.

**Example:**
```typescript
// Simplified coordinator pattern
async function coordinatorWorkflow(task: FeatureRequest): Promise<WorkflowResult> {
  // Step 1: Product Agent analyzes and creates spec
  const spec = await executeAgent('product', {
    task: 'analyze_and_spec',
    input: task.description,
  });

  // Step 2: Human approval checkpoint
  const approval = await requestHumanApproval({
    type: 'spec_approval',
    content: spec,
    channel: 'slack',
  });

  if (!approval.approved) {
    return { status: 'rejected', reason: approval.feedback };
  }

  // Step 3: Dev Agent implements
  const implementation = await executeAgent('dev', {
    task: 'implement',
    spec: spec,
  });

  return { status: 'completed', result: implementation };
}
```

### Pattern 2: Event-Driven Blackboard

**What:** Agents communicate via a shared "blackboard" (event stream/state store) rather than direct calls. Each agent subscribes to relevant events and publishes results.

**When to use:** When agents need loose coupling, when you want agents to react to changes from multiple sources (webhooks + other agents).

**Trade-offs:**
- Pros: Highly decoupled, scales well, agents can be added/removed without changing others
- Cons: Harder to debug, eventual consistency, requires robust event infrastructure

**Confidence:** MEDIUM - Well-established in distributed systems, but adds complexity for MVP.

**Example:**
```typescript
// Event-driven pattern with Kafka/Redis streams
interface AgentEvent {
  type: string;
  workflowId: string;
  agentId: string;
  payload: unknown;
  timestamp: Date;
}

// Product Agent subscribes to feature_request events
productAgent.subscribe('feature_request.created', async (event) => {
  const spec = await productAgent.analyze(event.payload);
  await publish({
    type: 'spec.created',
    workflowId: event.workflowId,
    payload: spec,
  });
});

// Dev Agent subscribes to approved specs
devAgent.subscribe('spec.approved', async (event) => {
  const implementation = await devAgent.implement(event.payload);
  await publish({
    type: 'implementation.completed',
    workflowId: event.workflowId,
    payload: implementation,
  });
});
```

### Pattern 3: Durable Execution with Temporal (Recommended for Production)

**What:** Use Temporal's workflow engine to manage agent execution, state persistence, and failure recovery automatically.

**When to use:** When you need reliable execution across async boundaries, human approvals that may take hours/days, and robust failure handling.

**Trade-offs:**
- Pros: Automatic state persistence, replay on failure, built-in timers, proven at scale (OpenAI uses it for Codex)
- Cons: Learning curve, operational overhead of running Temporal, requires separating deterministic (workflows) from non-deterministic (activities) code

**Confidence:** HIGH - Temporal is the recommended approach for production agentic systems with async handoffs.

**Example:**
```typescript
// Temporal workflow for feature request
@Workflow()
export class FeatureRequestWorkflow {
  @WorkflowMethod()
  async run(request: FeatureRequest): Promise<WorkflowResult> {
    // Activity: Non-deterministic agent execution
    const spec = await this.activities.executeProductAgent(request);

    // Signal: Wait for human approval (can take hours/days)
    const approval = await this.waitForSignal<ApprovalResult>('approval');

    if (!approval.approved) {
      return { status: 'rejected', reason: approval.feedback };
    }

    // Activity: Dev agent implementation
    const implementation = await this.activities.executeDevAgent(spec);

    return { status: 'completed', result: implementation };
  }

  @SignalMethod()
  async receiveApproval(approval: ApprovalResult): void {
    // Temporal handles resuming the workflow
  }
}
```

### Pattern 4: Human-in-the-Loop Interrupt/Resume

**What:** Explicit checkpoints in workflow where execution pauses for human input, with state persisted to survive process restarts.

**When to use:** Required for any approval workflow, especially when approvals may take hours or days.

**Trade-offs:**
- Pros: Explicit control over approval points, auditable decision trail
- Cons: Requires robust state persistence, careful handling of workflow timeout/expiry

**Confidence:** HIGH - This is essential for your use case. LangGraph's `interrupt()` function and Temporal's signals both implement this pattern.

**Key Implementation Details:**
- **Checkpointer Required:** State must be persisted (database, Redis, or Temporal's built-in persistence)
- **Thread ID:** Resume requires the same thread/workflow ID to restore state
- **Timeout Handling:** Define what happens if approval takes too long (escalate, auto-reject, etc.)
- **Batched Interrupts:** If multiple approvals needed, batch them in one request

## Data Flow

### Webhook → Agent Execution Flow

```
[Linear Webhook: Issue Created]
         │
         ▼
┌─────────────────────────┐
│     Event Gateway       │
│  - Verify signature     │
│  - Check idempotency    │
│  - Map to event type    │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│    Workflow Engine      │
│  - Create/resume        │
│    workflow instance    │
│  - Load persisted state │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│      Agent Router       │
│  - Select agent by task │
│  - Load agent config    │
│  - Select LLM model     │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│    Agent Execution      │
│  - LLM reasoning loop   │
│  - Tool invocations     │
│  - Emit observations    │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│   HITL Checkpoint?      │───Yes──▶ [Pause, notify human, persist state]
└───────────┬─────────────┘                          │
            │No                                       │
            ▼                                         │
┌─────────────────────────┐                          │
│  Continue/Complete      │◀─────[Human responds]────┘
└─────────────────────────┘
```

### Human Approval Flow (Async)

```
[Workflow reaches approval point]
         │
         ▼
┌─────────────────────────┐
│  Checkpoint Manager     │
│  - Persist full state   │
│  - Generate resume ID   │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  HITL Service           │
│  - Create approval req  │
│  - Send to Slack/email  │
│  - Store pending state  │
└─────────────────────────┘
            │
   [Hours/days pass]
            │
            ▼
┌─────────────────────────┐
│  Human Response         │
│  (Slack button, etc.)   │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  HITL Service           │
│  - Validate response    │
│  - Signal workflow      │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  Workflow Engine        │
│  - Load checkpoint      │
│  - Resume execution     │
│  - Continue with result │
└─────────────────────────┘
```

### Key Data Flows

1. **Webhook Ingestion:** External event → validated event → workflow trigger
2. **Agent Execution:** Task → LLM reasoning → tool calls → observation → repeat until done
3. **Human Approval:** Checkpoint → notification → (async wait) → response → resume
4. **Tool Integration:** Agent decision → tool abstraction → external API → result to agent

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| MVP (1-10 workflows/day) | Single process, SQLite/Redis state, synchronous webhook handling |
| Growth (10-100 workflows/day) | Temporal or durable workflow engine, PostgreSQL state, async webhook queue |
| Scale (100+ concurrent workflows) | Temporal cluster, partitioned event streams, horizontal agent workers |

### Scaling Priorities

1. **First bottleneck: State persistence** - In-memory state fails on process restart. Move to durable storage (PostgreSQL or Temporal) early.

2. **Second bottleneck: Webhook processing** - Synchronous webhook handling blocks under load. Add message queue (Redis, SQS) to decouple ingestion from processing.

3. **Third bottleneck: Agent execution** - LLM calls are slow. Run agent workers as separate processes that can scale horizontally.

4. **Fourth bottleneck: Observability** - As workflows increase, debugging without tracing becomes impossible. Invest in LangSmith/OpenTelemetry before scale issues hit.

### MVP → Scale Migration Path

**Confidence:** MEDIUM - This path is based on common patterns but your specific bottlenecks may differ.

1. **MVP:** Start with simple state machine + PostgreSQL. Focus on correct behavior.
2. **Add Temporal:** When human-approval latency (hours/days) causes reliability issues or process restarts lose state.
3. **Add Event Queue:** When webhook volume causes timeouts or lost events.
4. **Horizontal Agents:** When agent execution time dominates and parallelism helps.

## Anti-Patterns

### Anti-Pattern 1: In-Memory State for Long-Running Workflows

**What people do:** Store workflow state in process memory, assuming workflows complete quickly.

**Why it's wrong:** Human approvals can take hours or days. Process restarts, deployments, or crashes lose all in-progress workflows.

**Do this instead:** Use durable storage from day one. Even for MVP, use PostgreSQL or Redis with persistence. Better yet, use Temporal which handles this automatically.

### Anti-Pattern 2: Synchronous Webhook Processing

**What people do:** Process webhooks synchronously in the HTTP handler, making external calls inline.

**Why it's wrong:** Webhook sources (GitHub, Linear) have timeout expectations. Long processing causes retries, duplicates, and lost events.

**Do this instead:** Acknowledge webhook immediately (200 OK), queue for async processing, implement idempotency keys to handle retries.

### Anti-Pattern 3: Tight Coupling Between Agents

**What people do:** Agents directly call each other's methods or share internal state.

**Why it's wrong:** Makes it impossible to run agents in separate processes, use different LLM models per agent, or test agents in isolation.

**Do this instead:** Agents communicate via the workflow engine. The coordinator passes explicit task payloads; agents return structured results.

### Anti-Pattern 4: Monolithic Agent with All Tools

**What people do:** Create one "super agent" with access to all tools (Linear, GitHub, Slack, etc.).

**Why it's wrong:** Too many tools confuse the LLM, increase token costs, and make the agent unpredictable. Different tasks need different tool subsets.

**Do this instead:** Create specialized agents (Product Agent, Dev Agent) with focused tool sets. Use the coordinator to route tasks to the right specialist.

### Anti-Pattern 5: No Idempotency in Webhook Handlers

**What people do:** Process every webhook as if it's the first time seeing it.

**Why it's wrong:** Webhook sources retry on timeout/failure. You'll process the same event multiple times, creating duplicate issues, PRs, or messages.

**Do this instead:** Store event IDs in database, check before processing, use database transactions to ensure idempotent operations.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Linear | Webhooks + REST API | Verify webhook signatures; use Linear SDK for API calls |
| GitHub | Webhooks + REST/GraphQL API | App installation for org-wide access; webhook secrets per installation |
| Slack | Events API + Web API | Bot token for posting; use Block Kit for rich approval UIs |
| LLM Providers | REST API | Abstract behind client interface to support multiple providers |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Event Gateway → Workflow Engine | Message queue or direct call | Queue recommended for reliability |
| Workflow → Agent | Activity execution (Temporal) or async task | Agent execution is non-deterministic, must be isolated |
| Agent → Tools | Synchronous function call | Tools should be stateless, agents handle retries |
| Workflow → HITL | Signal/event + external notification | Decoupled to allow long wait times |

### Multi-LLM Configuration

| Agent | Recommended Model Tier | Reasoning |
|-------|------------------------|-----------|
| Product Agent | High capability (GPT-4, Claude Opus) | Needs strong reasoning for spec creation |
| Dev Agent | High capability with code focus | Code generation quality matters |
| Coordinator/Router | Fast + cheap (GPT-4-mini, Haiku) | Simple routing decisions, high frequency |
| Tool execution | Varies by task | Some tools may need specific model capabilities |

**Confidence:** MEDIUM - Model selection is highly empirical; test with your specific tasks.

## Framework Comparison

| Framework | Strengths | Weaknesses | Best For |
|-----------|-----------|------------|----------|
| **LangGraph** | Graph-based workflows, built-in checkpointing, tight LangChain integration | Learning curve, opinionated structure | Complex agent workflows with branching logic |
| **CrewAI** | Role-based agents, simple API, good for teams of agents | Less flexible routing, synchronous by default | Declarative multi-agent task decomposition |
| **Temporal** | Production-proven durability, scales massively, language-agnostic | Operational overhead, requires learning workflow/activity separation | Mission-critical workflows with long-running state |
| **Custom State Machine** | Full control, no dependencies | You build everything, error-prone | Simple workflows where frameworks are overkill |

**Recommendation for Aesir:**

**Confidence:** MEDIUM - This is opinionated based on your requirements.

- **MVP:** Custom state machine with PostgreSQL state, to understand your patterns before committing to a framework
- **Production:** Temporal for workflow orchestration + LangGraph-style agent execution within activities

This gives you:
1. Temporal's durable execution for async human-in-loop
2. LangGraph-style agent patterns for the reasoning loops
3. Flexibility to swap LLM providers per agent
4. Proven scalability path

## Sources

### Primary Sources (HIGH confidence)
- [Google ADK Multi-Agent Patterns](https://developers.googleblog.com/developers-guide-to-multi-agent-patterns-in-adk/) - Google's eight essential design patterns
- [Temporal for Multi-Agent Workflows](https://temporal.io/blog/what-are-multi-agent-workflows) - Durable execution for agents
- [LangGraph Multi-Agent Workflows](https://www.blog.langchain.com/langgraph-multi-agent-workflows/) - Graph-based agent orchestration
- [Azure AI Agent Design Patterns](https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/ai-agent-design-patterns) - Microsoft's agent orchestration patterns
- [LangChain Human-in-the-Loop](https://docs.langchain.com/oss/python/deepagents/human-in-the-loop) - HITL implementation patterns

### Secondary Sources (MEDIUM confidence)
- [Confluent Event-Driven Multi-Agent Systems](https://www.confluent.io/blog/event-driven-multi-agent-systems/) - Event-driven patterns for agents
- [CrewAI Documentation](https://docs.crewai.com/en/concepts/agents) - Role-based agent orchestration
- [LangSmith Observability](https://www.langchain.com/langsmith/observability) - Agent tracing and monitoring
- [Temporal vs Database State](https://temporal.io/blog/from-ai-hype-to-durable-reality-why-agentic-flows-need-distributed-systems) - Why durable execution matters
- [Permit.io HITL Best Practices](https://www.permit.io/blog/human-in-the-loop-for-ai-agents-best-practices-frameworks-use-cases-and-demo) - Human approval patterns

### Supporting Sources (LOW confidence - less directly applicable)
- [n8n AI Agent Orchestration Frameworks](https://blog.n8n.io/ai-agent-orchestration-frameworks/) - Framework comparison
- [Pydantic AI Multi-Agent Patterns](https://ai.pydantic.dev/multi-agent-applications/) - Python-focused patterns
- [LangChain Tools Documentation](https://docs.langchain.com/oss/python/langchain/tools) - Tool integration patterns

---
*Architecture research for: Agentic Development Platform*
*Researched: 2026-01-16*
