# Graph engineering for agents: what the label covers and what the evidence says

Date: 2026-09-16. Research brief for the retarget; issue not yet filed.

**Summary.** "Graph engineering" became a live label in July 2026, framed as the step after "loop engineering". In the sources that use the phrase, it means making the structure of an agent run explicit as a graph: tasks and their dependencies, agents and their communication, and runtime state. The paper the owner supplied, arXiv 2604.11378 (Hu Wei, April 2026), is the sharpest statement of that meaning. It argues the agent loop is a scheduler that can only dispatch one unit at a time under an opaque policy, and proposes replacing it with a planned, immutable DAG, three separate layers, and bounded recovery. It is a position paper with no experiments. The surrounding evidence is mixed: planner-emitted DAGs cut latency and tokens in several papers (LLMCompiler, ReWOO, TDP, ATG), production platforms shipped code-defined workflows in 2026 (Claude Code dynamic workflows, Google ADK 2.0, Microsoft Agent Framework), and yet the strongest coding-agent results still come from bare loops, and every DAG system carries a planning-error failure mode. Knowledge graphs, "context graphs" and codebase graphs are different things that share the word; they are covered in a short disambiguation section. Every claim below is labelled: **[V]** verified from the cited source in this session, **[I]** inferred or from a secondary summary.

---

## 1. What "graph engineering" means in 2026 usage

**Conclusion.** The phrase is attached, in the sources that use it, to execution structure: graphs of tasks, agents and runtime state. It is not attached to knowledge-graph retrieval, which uses its own names (GraphRAG, context graph, temporal knowledge graph). The grouping of all four families under one heading is the brief's, not the sources'.

### 1.1 Origin and the loop-to-graph framing

| Date | Source | What it says | Who |
| --- | --- | --- | --- |
| 7 Jun 2026 | Addy Osmani, "Loop Engineering" (addyosmani.com; O'Reilly Radar 22 Jun) **[I]** | Loop engineering is "replacing yourself as the person who prompts the agent" with a system that does it | Google engineer; ~6.5M views reported |
| 30 Jun 2026 | Anthropic, "Loop engineering: getting started with loops" **[V]** | Loops are "agents repeating cycles of work until a stop condition is met"; names turn-based, goal-based, time-based and proactive loops; mentions dynamic workflows for parallel agents | Vendor (Claude Code team) |
| 18 Jul 2026 | Peter Steinberger post, "Are we still talking loops or did we shift to graphs yet?" **[I]** (reported by Flowtivity, 25 Jul) | The post credited with catalysing the July discourse | OpenClaw creator |
| 25–30 Jul 2026 | Flowtivity; puppyone **[V]** | Flowtivity: graph engineering is "designing AI systems around explicit graphs" of typed nodes and edges "that an agent can traverse". puppyone: "an unsettled 2026 label" with three competing meanings (execution graphs, graph of loops and controls, knowledge or memory graphs) | Community and small vendors |
| Jul–Aug 2026 | Gao Dalie; Adnan Masood; Towards AI; eigent.ai; AI Builder Club **[I]** (403 on two fetches; titles and search summaries only) | All frame it as multi-agent topology or governed execution graphs, "loop engineering was the phrase through mid-2026, graph engineering is the layer that comes next" | Community |
| 21 Aug 2026 | arXiv 2608.21156, "Graph Engineering in the Era of LLM Agents", 33 authors **[V]** | "graph structures are used to organize and control task execution, agent coordination, and runtime state evolution for system-level intelligence". Positioned after prompt, context, harness and loop engineering. Families: task organisation graphs (goal decomposition, workflow), agent coordination graphs (capability, team, communication), runtime state graphs, and, peripherally, memory graphs (GraphRAG, Graphiti, Mem0) | Academic survey |

The academic survey is the closest thing to a canonical definition, and it puts memory graphs at the edge, not the centre. Its fetched text does not cite 2604.11378 **[V, as far as the fetched HTML shows]**.

### 1.2 The owner's paper: arXiv 2604.11378

"From Agent Loops to Structured Graphs: A Scheduler-Theoretic Framework for LLM Agent Execution", Hu Wei, submitted 13 April 2026, v1 only **[V]**. It predates the July label and, in the text fetched, does not use the phrase "graph engineering" **[I]**. It is the meaning the owner has in mind: a graph produced inside the harness at run time, not a hand-authored flow.

**What it defines.** An execution system is a tuple (states, ready-set function, scheduling policy, outcomes, transition). The agent loop is a "single-ready-unit scheduler": at most one executable unit is ready at any state, and the choice is "the output of an opaque LLM inference" **[V]**. Systems sit on a continuum with two axes, ready-set cardinality (one versus many) and policy explicitness (implicit LLM inference, prompt-level, state machine) **[V]**.

**The three weaknesses of the loop** **[V]**:

1. Implicit dependencies. "The fact that the second step depends on the first exists only in the context window."
2. Unbounded recovery. "No explicit contract specifying which recovery actions are available for which failure types, and no bound on how many attempts may be made."
3. Mutable plan. "If the LLM revises its plan mid-execution, the original plan is overwritten in the context. After execution, it is impossible to reconstruct a faithful audit trail."

**What it proposes: SGH, the Structured Graph Harness** **[V]**:

- A planner layer emits a static DAG (nodes, edges, per-node configuration, output contracts) before execution; the plan is "an immutable commitment for the duration of a plan version". Any structural change is a new version.
- An execution layer computes the ready set from the DAG and dispatches every ready node concurrently. Joins are `all_of` or `any_of`; competitive `first_of` is deliberately excluded for controllability.
- A recovery layer with three escalation levels: retry (bounded attempts, transient errors), local repair (re-invoke the LLM with diagnostic context), replan (new plan version, once per version). Retries are gated by a side-effect classification (pure, idempotent, non-idempotent).
- Context separation: an execution context holding only successful node outputs, and a diagnostic context holding failure history, so "failure history" does not corrupt later reasoning.
- A node state machine (ready, running, executed, failed, cancelled) with terminal stability and contract validation at the running-to-executed transition.

**Four design principles** **[V]**: controllability first, stable execution commitment, bounded recovery, side-effect classification. Each names what it sacrifices (expressiveness or flexibility).

**What it measures.** Nothing empirical. "This is a position paper and design proposal" **[V]**. The only numbers are a survey of 70 open-source projects: agent loop 60% (42), event-driven 16% (11), state machine 6% (4), graph or flow orchestration 7% (5), hybrid 10% (7) **[V]**. It reports failure-loop pathology in most surveyed graph or flow systems and rarely in state-machine systems, and that the most expressive systems "consistently exhibit the lowest controllability and the highest implementation risk" **[V]**. It proposes a seven-group ablation (loop, planner loop, planner plus parallel, deterministic routing, escalation, context separation, full SGH) and metrics named G_plan, G_scaffold, G_graph, G_patch, G_replan, all for future work **[V]**.

**Stated limitations** **[V]**: no validation; static DAG cannot adapt structure mid-run; LLM error propagation not characterised; cold start (the planner must produce a DAG before anything runs, so small tasks pay overhead); no complexity guarantees; implementation complexity of concurrent scheduling and persistence; and an explicit boundary, "exploratory tasks" where structure emerges during execution. Human pauses and external waits are not covered; state persistence is mentioned only as "checkpoint and restore node outputs" **[V]**.

**Named prior work it builds on** **[V]**: list scheduling and critical-path analysis (Topcuoglu 2002); Airflow, Luigi, Prefect as static-DAG engines; LangGraph (fan-out, conditional edges, runtime graph mutation); Plan-and-Act; Routine; TDP; AutoGen; CrewAI; AOP; DynTaskMAS; Graph-of-Agents; GPTSwarm; AFlow. LLMCompiler, ReWOO and Graph of Thoughts are not cited in the fetched sections **[I]**.

### 1.3 How the paper relates to the other meanings

| Meaning | Nodes and edges | Who produces the graph | Representative sources | Uses the phrase "graph engineering"? |
| --- | --- | --- | --- | --- |
| Planned execution DAG (2604.11378, ATG, TDP, LLMCompiler, ReWOO) | Steps or tool calls; data and precedence dependencies | The model, at run start; replans create versions | 2604.11378 **[V]**; 2607.01942 **[V]**; 2601.07577 **[V]**; 2312.04511 **[V]**; 2305.18323 **[V]** | Not in the papers; yes in 2608.21156 and community posts |
| Developer-authored workflow graph | Agents, functions, routers; control-flow edges | The developer, at build time | LangGraph, MAF, ADK 2.0 graphs **[V]** | Yes (AI Builder Club, TrueFoundry per puppyone) **[I]** |
| Agent topology, learned or searched | Agents or LLM calls; communication or dependency edges | Search or RL (AFlow, GPTSwarm), or the model (Graph of Thoughts) | 2410.10762 **[I]**; 2402.16823 **[I]**; 2308.09687 **[V]** | Yes (2608.21156, Masood) |
| Knowledge graph as memory | Entities, facts, episodes; typed and often temporal edges | An extraction pipeline at ingestion | GraphRAG, Graphiti, Cognee, Neo4j **[V]** | No; vendors say GraphRAG, "Context Graph", temporal KG |
| "Context graph" as decision traces | Business entities; decision events with provenance | Agents observing work over time | Foundation Capital, Forrester **[V]** | No |
| Codebase graph for coding agents | Files, symbols; calls, imports, inherits | AST parser at index time | graphify, RepoGraph, Sourcegraph SCIP **[V]** | No |

### 1.4 Disambiguation: the graphs that are not the owner's meaning

Kept short because the brief re-weighted; each line is a pointer.

- **Knowledge graphs as agent memory.** Zep's Graphiti is a temporal graph where "every edge carries timestamps for when a fact became valid, when it stopped being valid, when Graphiti learned about it, and when it learned it was no longer true"; retrieval fuses vector, full-text and traversal **[V]**. Zep markets this as a "Context Graph" **[V]**. Mem0 removed external graph stores in 2026 in favour of entity linking that boosts ranking; "this is no longer a queryable graph interface" **[V]**. Cognee builds an LLM-extracted entity graph plus vectors at `cognify` time and traverses it at query time **[V]**. Neo4j frames the domain graph as "a living representation of the environment your agents operate in" under the GraphRAG name (Hunger, 19 Dec 2025) **[V]**.
- **"Context graphs" as decision traces.** Foundation Capital (Gupta and Garg; dated 23 Dec 2025 in secondary reports, the page shows no reliable date when fetched **[I]**): "a living record of decision traces stitched across entities and time so precedent becomes searchable" **[V]**. Forrester (Betz, 10 Apr 2026): "a queryable layer of sensemaking abstractions that connects entity state to decision rationale across systems and time", a convergence of CMDBs, process mining and ADRs, with the caution that decision traces add "reasoning decay" on top of entity staleness **[V]**.
- **Codebase graphs.** graphify parses with tree-sitter, "no LLM, nothing leaves your machine", stores `graphify-out/graph.json`, rebuilds via post-commit hooks, exposes `query_graph`, `get_node`, `get_neighbors`, `shortest_path` over MCP and a PreToolUse nudge **[V]**. RepoGraph (ICLR 2025) reports a 32.8% relative SWE-bench gain from a repository graph **[I]**. Sourcegraph exposes SCIP-indexed definitions and references to agents over MCP **[I]**. Cursor indexes embeddings, not a graph **[I]**. Augment's page claims a semantic index of relationships but states no mechanism **[V]**.
- **Agent-topology graphs.** Graph of Thoughts models "LLM thoughts" as vertices and dependencies as edges, reporting 62% better sorting quality than Tree of Thoughts at 31% lower cost **[V]**. GPTSwarm, G-Designer, MaAS and AFlow search or learn the topology **[I]**.

---

## 2. What the evidence says

**Conclusion.** Planner-emitted DAGs have repeatable wins on latency, tokens and step counts, mostly on small models and structured benchmarks. No published result isolates the SGH claims (immutability, escalation, context separation). The strongest coding-agent results still come from bare loops, and the failure mode of every DAG system is a wrong plan. Vendor numbers for both execution graphs and memory graphs do not survive independent runs well.

### 2.1 For explicit execution graphs

| Source | Design | Result | Status |
| --- | --- | --- | --- |
| LLMCompiler, ICML 2024 (2312.04511) **[V]** | Planner emits a DAG of function calls; task-fetching unit; parallel executor | Up to 3.7x latency, 6.7x cost, ~9% accuracy over ReAct on HotpotQA, ParallelQA, Game of 24 | Academic |
| ReWOO, 2023 (2305.18323) **[V]** | Plan, execute tools without observations, solve | 5x token efficiency and +4% accuracy on HotpotQA; wrong plans propagate uncorrected | Academic |
| TDP, Jan 2026 (2601.07577) **[V]** | Supervisor builds a DAG of sub-goals; scoped contexts per sub-task | Up to 82% fewer output tokens than Plan-and-Act, higher accuracy on HotpotQA and ScienceWorld | Academic |
| ATG, Jul 2026 (2607.01942) **[V]** | Recursive decomposition to atomic (input, tool, output) nodes; graph evolution history; localised repair | Mistral-7B ALFWorld success 55.73 vs ReAct 6.57; steps 31.42 to 18.36; invalid actions 42.86% to 12.14%; "extra overhead for simple tasks" | Academic, 7–8B models only |
| DynTaskMAS, ICAPS 2025 (2503.07675) **[I]** | Dynamic task graph with asynchronous parallel execution | 21–33% shorter execution time versus serial; near-linear throughput to 16 agents | Academic |
| AFlow, ICLR 2025 (2410.10762) **[I]** | Workflows as code graphs searched by MCTS | +5.7% average over baselines; small models beat GPT-4o at 4.55% of its cost | Academic |
| Routine, Jul 2025 (2507.14447) **[I]** | Structured planning scripts for enterprise tool calling | GPT-4o tool-call accuracy 41.1% to 96.3% | Vendor (Digital China) |
| Google ADK 2.0 blog, 1 Jul 2026 **[V]** | Agent versus graph workflow on a refund task | 5,152 vs 2,265 tokens; 7.2 s vs 5.7 s | Vendor, "illustrative" |
| Agentless, 2024 (2407.01489) **[V]** | Fixed three-phase pipeline, no agent decisions | 32.00% SWE-bench Lite at $0.70 per issue, then the best open-source result | Academic |

Read together: the gains come from parallelism (LLMCompiler, DynTaskMAS), from scoping context per node (TDP, ATG, and SGH's context separation), and from taking decisions away from a weak model (ATG on 7B, Routine, Agentless). None of these measures immutability, escalation levels or audit quality, which are SGH's distinctive claims.

### 2.2 Against, or at least not for

- **Bare loops keep winning on hard coding tasks.** mini-SWE-agent's README claims over 74% on SWE-bench Verified from a 100-line loop with only bash **[I]**. The SWE-bench leaderboard study (2506.17208, revised Feb 2026) finds "no single architecture consistently achieves state-of-the-art performance" across 80 approaches spanning fixed, scaffolded and emergent control flow **[V]**.
- **Vendors that ship graphs still tell you to start with a loop.** Anthropic (Dec 2024): "building the right system for your needs", and frameworks "obscure the underlying prompts" **[V]**. OpenAI's orchestration guide: "Start with one agent whenever you can" **[V]**; its visual Agent Builder canvas is being wound down on 30 Nov 2026 in favour of code **[I]**. Anthropic's long-running harness (Nov 2025) is a loop over files and git, not a DAG, with no measured comparison **[V]**. Claude Code's dynamic workflows post (2 Jun 2026) publishes no benchmark and the docs say a run "can use meaningfully more tokens" **[V]**.
- **Planning is the failure mode.** SGH itself lists missing dependencies, spurious dependencies, wrong join semantics, over- and under-decomposition, and non-idempotent retry **[V]**. ReWOO's plan errors propagate because the planner never sees observations **[V]**. ATG "depends on the backbone LLM's decomposition ability" and localisation fails "under noisy observations or long-range dependencies" **[V]**. SGH's "fixed-overhead hypothesis" collapses if replans are frequent **[V]**.
- **Durability is not free with a graph.** Microsoft Agent Framework checkpoints per superstep and the docs state fan-out chains block on the slowest branch **[V]**. Diagrid (Mar 2026, a Dapr vendor) argues that is not durable: "Resume is entirely manual... no supervisor, no scheduler, no automatic restart" **[V]**. LangGraph's `interrupt()` re-runs the node from its start on resume, so pre-interrupt side effects repeat **[V]**. Temporal replays an event-sourced history instead **[V]**.

### 2.3 Knowledge-graph memory, in brief

- Full Microsoft GraphRAG indexing cost about 1000x vector RAG on 5,590 AP articles; LazyGraphRAG (Nov 2024) matches its global-query quality at "0.1% of the costs of full GraphRAG" and over 700x lower query cost **[V]**.
- GraphRAG-Bench (Xiang et al., revised Feb 2026): "GraphRAG frequently underperforms vanilla RAG on many real-world tasks" **[V]**. HippoRAG 2 (ICML 2025) reports +7 F1 on associative questions over dense retrievers **[I]**.
- Vendor claims and independent checks diverge. Zep's paper reports up to +18.5% on LongMemEval and 90% lower latency **[V, vendor]**; Mem0's paper reports its graph variant at only ~2% over its vector variant **[V, vendor]**; the two vendors dispute each other's LoCoMo runs (58.44% versus 75.14% for Zep) and a GitHub issue contests Zep's earlier 84% claim **[I]**. Wolff and Bennati (Jan 2026, revised Sep 2026): mem0, plain RAG and full context score 77–81% while Graphiti and cognee score 55–56%, and RAG matches at 8.4x lower total cost than mem0 **[V]**. An independent blog run (Aug 2026) got Mem0 OSS at 32–49% on LongMemEval-S against a vendor-reported 93.4% **[V]**.
- Failure modes reported in practice: entity-resolution errors compound per hop, three indexes (text, vector, graph) must stay in sync, and paths beyond three hops are often not found **[I, community sources]**. Forrester adds "reasoning decay" for decision-trace graphs **[V]**.

---

## 3. How current harnesses and platforms use graphs

**Conclusion.** Three production harnesses now let the model or the developer put the plan in code or a graph, all in 2026: Claude Code dynamic workflows, Google ADK 2.0, Microsoft Agent Framework. None implements SGH's planner-emitted immutable DAG with escalation; the closest are Claude Code's replayable script and MAF's per-superstep checkpoints. Memory stores in these platforms are files or key-value, not graphs.

| Platform | Is there an execution graph? | Nodes and edges | Built when, by whom | Pause and resume | Source |
| --- | --- | --- | --- | --- | --- |
| Claude Code, default | No; a loop. "Claude continues calling tools and processing results until it produces a response with no tool calls" | Turns | Runtime, the model | Session resume; compaction | Agent loop doc **[V]** |
| Claude Code dynamic workflows (v2.1.154+; post 2 Jun 2026) | A JavaScript script, not a declared DAG. `agent()`, `pipeline()`, `parallel()`, `phase()`; "the script holds the loop, the branching, and the intermediate results" | Agent calls; data flow in script variables | Runtime, written by the model per task; saveable to `.claude/workflows/` | Replay by agent order: completed agents return cached results, a failed agent and everything after it re-run; `Date.now()` and `Math.random()` throw to keep replay deterministic; no mid-run user input; 16 concurrent, 1,000 agents per run | Workflows doc **[V]** |
| Claude Code Tasks | A task list with `blockedBy` edges, not a scheduler; off by default on Opus 4.8 and later, opt in with `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` | Tasks; blocking edges | Runtime, the model | n/a | Tools reference **[I]** |
| Claude Agent SDK | Same loop; hooks, subagents, `maxTurns`, `maxBudgetUsd` | Turns | Runtime | Session store adapters | Agent loop doc **[V]** |
| Managed Agents memory stores (beta 23 Apr 2026) | No graph. "A workspace-scoped collection of small text documents", mounted at `/mnt/memory/<store>/`, edited with file tools, every mutation an immutable version | Files | Runtime, the agent | n/a | anthropics/skills doc **[V]** |
| Anthropic long-running harness (26 Nov 2025) | No; a loop over `claude-progress.txt`, a JSON feature list and git | Features | Initialiser agent, then one feature per session | Git and progress file | Engineering post **[V]** |
| Google ADK 2.0 (Python GA 19 May 2026) | Graph workflows: developer-declared DAG of agents, tools and code with `event.route` edges. Dynamic workflows: plain Python control flow. Template Sequential, Parallel and Loop agents "superseded" | Agents, tools, functions | Build time (graph) or runtime code (dynamic) | Human input documented; checkpointing not seen on the fetched page | adk.dev **[V]**, blog **[V]** |
| Microsoft Agent Framework | Directed graph of executors built with `WorkflowBuilder`; Pregel supersteps with a barrier; graph fixed once built | Executors; direct, conditional, fan-out, fan-in edges | Build time, the developer | Checkpoint at every superstep boundary, including pending requests and responses; resume needs the same topology and executor identities | Learn docs **[V]** |
| LangGraph | Developer-authored graph; `Send` adds runtime fan-out; long-term store is namespaced JSON with optional semantic search, "no graph structure" | Nodes, edges, state channels | Build time | `interrupt()` with a checkpointer; node re-runs from its start on resume | Docs **[V]** |
| OpenAI Agents SDK | Code plus handoffs; "Start with one agent whenever you can"; Agent Builder canvas retiring 30 Nov 2026 | Agents; handoffs as tools | Build time | n/a | Orchestration guide **[V]**, wind-down **[I]** |
| Temporal | Workflow as code, not a DAG; deterministic workflow, non-deterministic activities; signals for human input; event-sourced replay; LangGraph and OpenAI SDK plugins | Activities | Build time | Replay from history | docs.temporal.io/ai **[V]** |
| Letta | Memory blocks pinned in context, archival memory as a vector store, sleep-time agents rewrite blocks; no graph | Blocks | Runtime | n/a | Docs **[I]** |
| Mem0 | Entity linking that boosts ranking; external graph store deprecated, `relations` no longer populated | Entities | Ingestion | n/a | Docs **[V]** |
| Zep or Graphiti | Temporal knowledge graph; hybrid retrieval; incremental ingestion | Entities, facts, episodes | Ingestion, real time | n/a | Product page **[V]** |
| Cognee | Entity graph plus vectors, built at `cognify`, refined by `memify` | Entities, chunks, summaries | Ingestion | n/a | Blog **[V]** |
| graphify | Code graph from tree-sitter, Leiden communities | Symbols; calls, imports, inherits | Index time; hooks on commit | n/a | README **[V]** |

The recurring pattern across the three 2026 harness launches is the same as SGH's diagnosis: move the plan out of the context window. Claude Code says a workflow "moves the plan into code" so "Claude's context holds only the final answer" **[V]**. ADK 2.0 says "the workflow graph acts as a boundary" **[V]**. Where they differ from SGH is that the plan is code (arbitrary control flow) rather than a static DAG with declared joins, so none can give SGH's termination argument.

---

## 4. What it would mean for a manifest-driven harness

Framed as questions with the constraints that bear on each, not as decisions.

**Execution structure as a declared strategy.** The candidates the sources support are `loop` (SGH's single-ready-unit scheduler; every Anthropic and OpenAI harness default), `planned-dag` (SGH, ATG, TDP: a planner emits nodes, edges, joins and contracts before execution), and `hybrid` (a loop that may hand a task to a planned or scripted sub-run, which is what Claude Code's ultracode and ADK dynamic workflows do). The constraint that decides is the task class: SGH names "exploratory tasks" as out of scope, ATG reports overhead on simple tasks, and every production vendor reserves graphs for large fan-out work **[V]**. A manifest field only earns its place if the runtime does something different for each value; otherwise it is documentation.

**Who produces the graph, and when.** Three options with different failure surfaces: the developer at build time (LangGraph, MAF, ADK graphs; failures are code bugs), the model at run start (SGH, LLMCompiler; failures are planning errors, and SGH lists five), or the model mid-run (Claude Code writes a script per task; failures are both). SGH's answer to planning errors is versioning: a replan is a new immutable plan version, at most one per version **[V]**. If the manifest names a planner model, that is a cost and a latency the loop does not pay (SGH's cold-start limitation).

**Durable pause inside a DAG.** SGH does not cover it **[V]**. The mechanical fit is a node state `waiting` that the ready-set function excludes, with the wake-up delivered as a signal and a deadline delivered as a scheduled timeout, exactly as the current executor already does for a whole conversation (the brief's CLAUDE.md describes `wait_for` plus pg-boss timeouts and SKIP LOCKED claims) **[I, from the brief's context]**. The change a DAG forces is granularity: claims, heartbeats and timeouts per node rather than per conversation. Two documented precedents to learn from: MAF captures "pending requests and responses" in the superstep checkpoint **[V]**; LangGraph re-runs the interrupted node from its start, which requires idempotent pre-interrupt code **[V]**. SGH's side-effect classification (pure, idempotent, non-idempotent) is the piece that makes either safe **[V]**.

**Storage and inspection.** Two shapes exist in production. Data: a versioned plan document (nodes, edges, joins, contracts, node states) plus an append-only event log, which is what SGH's audit-trail claim needs and what MAF's checkpoints approximate. Code: a script file the runtime replays, which Claude Code writes under the session directory and lets you diff, edit and relaunch **[V]**. Data is queryable and diffable across runs; code is more expressive and harder to inspect without running it. A dashboard view of a plan version with node states is the observability win SGH promises and Claude Code's `/workflows` view already provides for scripts **[V]**.

**Cost of the next change.** If the plan schema changes (a new join type, a new node state, a new contract shape), immutable plan versions mean in-flight plans keep their old schema and the executor must read both, or in-flight runs must drain first. That is the same migration problem as any versioned document, and it is smaller than changing a script runtime's API, which invalidates every saved workflow. Claude Code's stance is instructive: saved scripts are "plain JavaScript" with four functions and a `meta` block, a deliberately tiny surface **[V]**.

**Memory strategy, briefly.** A `memory: graph | vector | hybrid | none` field is cheap to declare and expensive to honour. The current store (pgvector plus tsvector fused by RRF, typed entries, scoping, expiry, supersession) already covers what Mem0 now ships after it dropped its graph store **[V]**, and the independent evidence in section 2.3 does not show a graph paying for itself on agent-memory benchmarks. A shared organisation graph, if wanted later, is a support service with its own ingestion and entity-resolution cost; a per-agent graph is the thing the evidence says not to build first. Codebase graphs are a different question: they are build-time artefacts (graphify's `graph.json`) that could be baked into an image and rebuilt by hooks, and the model traverses them through tools rather than receiving injected context **[V]**.

---

## 5. One-hour orientation

### 5.1 Reading list, ranked

1. **arXiv 2604.11378, From Agent Loops to Structured Graphs (Apr 2026).** The definitions, the three weaknesses, the three layers and the limitations. Read sections 1, 3, 5, 6 and 10; skip 8.
2. **Claude Code docs, Orchestrate subagents at scale with dynamic workflows (2026).** The one shipped harness that moves the plan into code, with resume semantics spelled out. Compare its replay rules to SGH's recovery levels.
3. **arXiv 2608.21156, Graph Engineering in the Era of LLM Agents (Aug 2026).** The survey that gives the label its academic definition and taxonomy; skim the task-graph and runtime-state sections.
4. **Kim et al., An LLM Compiler for Parallel Function Calling (ICML 2024).** The cleanest measured case for a planner-emitted DAG.
5. **Zhang et al., Atomic Task Graph (Jul 2026).** The 2026 paper closest to SGH with numbers, including the overhead caveat.
6. **Microsoft Learn, Agent Framework workflows and checkpoints (2026).** Supersteps and per-superstep checkpoints are the concrete durability model to argue against or adopt.
7. **Google Developers Blog, Why we built ADK 2.0 (Jul 2026).** The vendor case for graph boundaries, with its own numbers and their "illustrative" label.
8. **Anthropic, Building effective agents (Dec 2024) and Loop engineering: getting started with loops (Jun 2026).** The loop-first position the graph papers argue against.
9. **Diagrid, Still not durable (Mar 2026).** A vendor critique, but the checklist of what durable means is useful.
10. **puppyone, What is graph engineering for AI agents (Jul 2026).** Ten minutes on why the label is unsettled, so the session does not relitigate it.

### 5.2 Glossary

Execution-graph terms first, then the knowledge-graph terms that recur.

| Term | Meaning as used in the sources |
| --- | --- |
| DAG | Directed acyclic graph; nodes are executable units, edges are dependencies; acyclic so a topological order exists |
| Scheduler, ready set | The function from global state to the nodes eligible to dispatch; SGH's loop has a ready set of at most one |
| Single- versus multi-ready-unit | Whether more than one node can be dispatched at once; the first axis of SGH's continuum |
| Policy explicitness | Whether the next node is chosen by opaque inference, a structured prompt, or a state machine; the second axis |
| Critical path | The longest dependency chain, which bounds wall-clock time under unlimited parallelism |
| Join semantics | `all_of` waits for every predecessor; `any_of` proceeds on the first success and cancels the rest; `first_of` (racing) is excluded by SGH |
| Plan version, immutable history | A plan is fixed for its version; a replan creates a new version so the audit trail survives |
| Escalation | SGH's ordered recovery: retry, local repair, replan, each bounded |
| Side-effect class | Pure, idempotent, non-idempotent; decides whether a retry is safe |
| Context separation | Execution context (successful outputs only) versus diagnostic context (failure history) |
| Controllability, expressiveness, implementability | SGH's three-way trade-off; predictability and auditability against representable structures against engineering cost |
| Superstep | MAF and LangGraph's Pregel round: run all ready executors, barrier, checkpoint |
| Checkpoint, replay | Saved state at a boundary versus re-executing from an event history (Temporal, Claude Code workflows) |
| Interrupt, signal | A durable pause awaiting external input (LangGraph `interrupt()`, Temporal signals) |
| Entity, relation, triple | A node, a typed edge, and the (subject, predicate, object) fact they form in a knowledge graph |
| Episode | A raw ingested unit (message, document) that facts are extracted from; Graphiti keeps an episodic subgraph |
| Community | A cluster of densely connected nodes, found by Leiden or similar; GraphRAG and graphify summarise per community |
| Temporal edge | An edge with validity and ingestion timestamps (valid_at, invalid_at, created, expired) |
| Provenance | Which source, actor and time a fact or decision came from |
| Ontology | The declared schema of entity and relation types a graph is allowed to contain |
| Property graph versus RDF | Nodes and edges carrying key-value properties (Neo4j) versus triples with URIs and a formal schema layer |
| Hypergraph | An edge that joins more than two nodes; appears in a few 2026 RAG papers, not in the harness sources |

---

## Sources

Execution graphs and harnesses

- Hu Wei, From Agent Loops to Structured Graphs: A Scheduler-Theoretic Framework for LLM Agent Execution, arXiv 2604.11378, 13 Apr 2026. https://arxiv.org/abs/2604.11378 and https://arxiv.org/html/2604.11378
- Feng et al., Graph Engineering in the Era of LLM Agents, arXiv 2608.21156, 21 Aug 2026 (v2 26 Aug). https://arxiv.org/abs/2608.21156
- Zhang et al., Atomic Task Graph, arXiv 2607.01942, 2 Jul 2026. https://arxiv.org/abs/2607.01942
- Li et al., Beyond Entangled Planning: Task-Decoupled Planning, arXiv 2601.07577, 12 Jan 2026. https://arxiv.org/abs/2601.07577
- Kim et al., An LLM Compiler for Parallel Function Calling, arXiv 2312.04511, ICML 2024. https://arxiv.org/abs/2312.04511
- Xu et al., ReWOO, arXiv 2305.18323, 23 May 2023. https://arxiv.org/abs/2305.18323
- Besta et al., Graph of Thoughts, arXiv 2308.09687, v4 6 Feb 2024. https://arxiv.org/abs/2308.09687
- DynTaskMAS, arXiv 2503.07675, ICAPS 2025. https://arxiv.org/abs/2503.07675
- AFlow, arXiv 2410.10762, ICLR 2025. https://arxiv.org/abs/2410.10762
- Routine, arXiv 2507.14447, 19 Jul 2025. https://arxiv.org/abs/2507.14447
- Xia et al., Agentless, arXiv 2407.01489, rev 29 Oct 2024. https://arxiv.org/abs/2407.01489
- Martinez and Franch, Dissecting the SWE-Bench Leaderboards, arXiv 2506.17208, rev 5 Feb 2026. https://arxiv.org/abs/2506.17208
- mini-SWE-agent README (claim of >74% SWE-bench Verified). https://github.com/SWE-agent/mini-swe-agent
- Anthropic, A harness for every task: dynamic workflows in Claude Code, 2 Jun 2026. https://claude.com/blog/a-harness-for-every-task-dynamic-workflows-in-claude-code
- Claude Code docs, Orchestrate subagents at scale with dynamic workflows. https://code.claude.com/docs/en/workflows
- Claude Code docs, How the agent loop works. https://code.claude.com/docs/en/agent-sdk/agent-loop
- Claude Code docs, How Claude remembers your project. https://code.claude.com/docs/en/memory
- Anthropic, Loop engineering: getting started with loops, 30 Jun 2026. https://claude.com/blog/getting-started-with-loops
- Anthropic, Effective harnesses for long-running agents, 26 Nov 2025. https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
- Anthropic, Building effective agents, 19 Dec 2024. https://www.anthropic.com/engineering/building-effective-agents
- Anthropic, Managed Agents memory (skills repo), beta 23 Apr 2026. https://github.com/anthropics/skills/blob/main/skills/claude-api/shared/managed-agents-memory.md
- Claude Platform docs, Memory tool. https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool
- Google, Why we built ADK 2.0, 1 Jul 2026. https://developers.googleblog.com/why-we-built-adk-20/
- ADK docs, Graph-based agent workflows and Template agent workflows. https://adk.dev/graphs/ and https://adk.dev/agents/workflow-agents/
- Microsoft Learn, Agent Framework workflows (ms.date 27 May 2026) and Checkpoints (ms.date 16 Sep 2026). https://learn.microsoft.com/en-us/agent-framework/workflows/workflows and https://learn.microsoft.com/en-us/agent-framework/workflows/checkpoints
- Diagrid, Still not durable, 2 Mar 2026. https://www.diagrid.io/blog/still-not-durable-how-microsoft-agent-framework-and-strands-agents-repeat-the-same-mistake
- LangGraph docs, Memory and Interrupts. https://docs.langchain.com/oss/python/langgraph/memory and https://docs.langchain.com/oss/python/langgraph/interrupts
- OpenAI, Orchestration and handoffs. https://developers.openai.com/api/docs/guides/agents/orchestration
- Temporal, Durable AI. https://docs.temporal.io/ai
- Addy Osmani, Loop Engineering, 7 Jun 2026 (O'Reilly Radar 22 Jun). https://www.oreilly.com/radar/loop-engineering/
- Flowtivity, From Loops to Graphs, updated 25 Jul 2026. https://flowtivity.ai/blog/graph-engineering-2026-guide-openclaw-codex/
- puppyone, What Is Graph Engineering for AI Agents?, 30 Jul 2026. https://www.puppyone.ai/en/blog/graph-engineering-ai-agents-map
- Gao Dalie, Forget Loop Engineering, Jul 2026 (403 on fetch). https://medium.com/@GaoDalie_AI/forget-loop-engineering-graph-engineering-is-about-this-713a9cf2e985
- Adnan Masood, Graph Engineering for AI Agents, Aug 2026 (403 on fetch). https://medium.com/@adnanmasood/graph-engineering-for-ai-agents-the-practitioners-guide-to-designing-multi-agent-systems-as-f9a4559aa693

Knowledge, context and codebase graphs

- Edge, Trinh, Larson, LazyGraphRAG, Microsoft Research, 25 Nov 2024. https://www.microsoft.com/en-us/research/blog/lazygraphrag-setting-a-new-standard-for-quality-and-cost/
- Xiang et al., When to use Graphs in RAG (GraphRAG-Bench), arXiv 2506.05690, rev 22 Feb 2026. https://arxiv.org/abs/2506.05690
- Gutiérrez et al., From RAG to Memory (HippoRAG 2), arXiv 2502.14802, ICML 2025. https://arxiv.org/abs/2502.14802
- Rasmussen et al., Zep: A Temporal Knowledge Graph Architecture for Agent Memory, arXiv 2501.13956, 20 Jan 2025. https://arxiv.org/abs/2501.13956
- Chhikara et al., Mem0, arXiv 2504.19413, 28 Apr 2025. https://arxiv.org/abs/2504.19413
- Zep, Is Mem0 Really SOTA in Agent Memory? and getzep/zep-papers issue #5. https://blog.getzep.com/lies-damn-lies-statistics-is-mem0-really-sota-in-agent-memory/ and https://github.com/getzep/zep-papers/issues/5
- Wolff and Bennati, Cost and Accuracy of Long-Term Memory in Distributed Multi-Agent Systems, arXiv 2601.07978, 12 Jan 2026, rev 3 Sep 2026. https://arxiv.org/abs/2601.07978
- Everest An, I benchmarked AI agent memory in 2026, 7 Aug 2026. https://dev.to/everest_an/-i-benchmarked-ai-agent-memory-in-2026-and-the-numbers-tell-a-different-story-than-the-marketing-2ae4
- Mem0, State of AI Agent Memory 2026 (page says updated from 1 Apr 2026) and Graph memory docs. https://mem0.ai/blog/state-of-ai-agent-memory-2026 and https://docs.mem0.ai/open-source/features/graph-memory
- Zep, Graphiti product page. https://www.getzep.com/platform/graphiti/
- Cognee, How Cognee builds AI memory, 24 Feb 2026, updated 3 Sep 2026. https://www.cognee.ai/blog/fundamentals/how-cognee-builds-ai-memory
- Hunger, What is context engineering in AI agents?, Neo4j, 19 Dec 2025. https://neo4j.com/blog/agentic-ai/what-is-context-engineering/
- Gupta and Garg, AI's trillion-dollar opportunity: Context graphs, Foundation Capital, reported 23 Dec 2025, and Context graphs, one month in. https://foundationcapital.com/ideas/context-graphs-ais-trillion-dollar-opportunity and https://foundationcapital.com/ideas/context-graphs-one-month-in
- Betz, Context Graphs Are a Convergence, Not an Invention, Forrester, 10 Apr 2026. https://www.forrester.com/blogs/context-graphs-are-a-convergence-not-an-invention/
- Graphify-Labs/graphify README. https://github.com/Graphify-Labs/graphify
- RepoGraph, arXiv 2410.14684, ICLR 2025. https://arxiv.org/abs/2410.14684
- Letta docs, Memory blocks, Archival memory, Sleep-time agents. https://docs.letta.com/guides/core-concepts/memory/memory-blocks
- Augment Code, Context Engine page. https://www.augmentcode.com/context-engine
