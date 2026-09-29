# How a human talks to a team of agents: shipped patterns

Date: 2026-09-27. Research brief for the retarget conversation. Extends `2026-09-21-human-entry-point.md` (the front desk versus direct addressing, catalogue scope) and `2026-09-16-multi-agent-coordination-prior-art.md` §2 and §4. This file covers the team scope: a human and a group of agents coordinating on one piece of work. Work item: none yet.

Labels: `[V]` I fetched the page this session and the claim is on it; URL in Sources. `[S]` a secondary account of a page I could not fetch, named as such. `[I]` my inference from `[V]` material. Claims taken from the two earlier files are cited by section and were verified there, not re-fetched here.

## Summary

Every shipped team product gives the human one counterpart, and that counterpart is the lead: the human addresses the lead's session, issue, or thread, and the lead delegates. The "project manager" model matches what ships, with two corrections: the manager is a role one agent plays under a manifest flag, never a separate platform object, and the best products also give the human a direct line to each member (Claude Code teammates, Devin's managed sessions) or make the shared record the medium (Symphony over Linear, Claude Code's task list). The vendors' own numbers put the cost at 3 to 15 times a single agent's tokens, and the largest 2026 study finds centralised coordination pays only when the single agent scores under about 45% and loses on sequential or tool-heavy work. Nobody ships a team deeper than one level of delegation, and nobody lets a member's question reach the human except through the lead, the artefact, or a correlated approval event.

## 1. The patterns, from shipped systems

Conclusion: four shapes exist. Lead-mediated is the default in every vendor that ships a team primitive. Artefact-mediated is how coding-agent fleets ship. Handoff is a customer-service shape and means something different to each vendor. "No team object" is what work tools ship today and coordination stays with the human.

### 1a. Lead or manager as the single counterpart

| Product, version read | Human talks to | Accountable | Member's question reaches the human | Human interjects mid-run | Status | Persists after the run |
|---|---|---|---|---|---|---|
| Claude Code agent teams, experimental, doc describes v2.1.281 `[V]` | The lead session; "You can also talk to any teammate directly without going through the lead" | The lead, "fixed" for the session | Permission prompts "appear in the lead session"; a finished teammate "notifies the lead and includes its final answer"; the human reads a teammate's transcript from the agent panel | Select a teammate, Enter to message it, Escape interrupts its turn, `x` stops it; hooks `TeammateIdle`, `TaskCreated`, `TaskCompleted` | Agent panel; shared task list (Ctrl+T) | Task list at `~/.claude/tasks/{team-name}/` "persists locally"; team config "removed when the session ends"; `/resume` and `/rewind` "do not restore in-process teammates" |
| Claude Managed Agents, beta header `managed-agents-2026-04-01` `[V]` | The session, whose primary thread is the coordinator | The coordinator; roster declared as `multiagent.type: coordinator` | A subagent's tool-permission or custom-tool request is "cross-posted to the primary thread with `session_thread_id`"; `agent.thread_message_received` carries "a report or question to the coordinator" | `user.interrupt` with `session_thread_id` stops one thread. "Your client posts no messages" in a subagent's thread | Primary thread is "a condensed view"; "you do see the start and end of their work, and blocking events" | Threads "are persistent"; the coordinator "can send a follow-up to an agent it called earlier" |
| Anthropic research system, 2025-06-13 `[V]` | The lead researcher | The lead | Not described; subagents return findings to the lead, or "store their work in external systems, then pass lightweight references" | Not described | Not described | The lead saves "its plan to Memory" against context truncation |
| Devin managed Devins, 2026-03-19 `[V]` | The parent session; each child has "its own session link" and the human can "message it directly" | The parent, which "scopes the work, assigns each piece..., monitors progress, resolves any conflicts, and compiles the results" | The parent "read[s] the full trajectories of its managed Devins"; children are Slack- or Linear-addressable sessions like any Devin `[I]` | Message a child directly; the parent can "message child sessions", "put child sessions to sleep or terminate them" | ACU consumption per child | Each child is a full session with its own VM; "Auto-approve child sessions" is on by default |
| Factory Missions, docs undated `[V]` | Mission Control, "an agent itself that can be paused and conversed with" | Mission Control | Not documented | "pause the orchestrator, describe what you are seeing in plain language, and ask it to recover" | A visual view of features in progress | Not documented; parallelisation is listed as an open question |
| OpenAI Agents SDK manager `[V]` | The manager, which "keeps control of the conversation" via `Agent.as_tool()` | The manager owns "the final answer" | Via `needs_approval` interruptions on the run (prior art §4) | Library; the host decides | n/a | `RunState` (prior art §4) |
| CrewAI hierarchical `[V]` | The crew; a manager from `manager_llm` or `manager_agent` "allocates tasks" and "evaluates outcomes" | The manager | `human_input` on a task: "have a human review the final answer of the agent. Defaults to False"; channel not documented | Not documented | Not documented | `output_file`, `output_json` |
| AG2 GroupChatManager `[V]` | The group; "all agents contribute to a single conversation thread and share the same context" | The manager selects speakers (`auto`, `round_robin`, `random`, `manual`) | Any agent's message is broadcast; the human is a participant with `human_input_mode` ALWAYS, TERMINATE or NEVER | `manual` speaker selection; reply when prompted | The transcript | `clear_history=False` keeps it |
| Magentic-One, 2024-11-04, and Agent Framework Magentic, ms.date 2026-09-04 `[V]` | The orchestrator or manager | The manager; "the manager's synthesized final answer" is the only terminal output | Plan review: `MagenticPlanReviewRequest`, answered with `approve()` or `revise(...)`; tool approval as `RequestInfoEvent` | Approve or revise the plan at start and on stall | Events: plan created, replanned, progress ledger per round | Checkpoints hold pending requests |
| MetaGPT v7 and ChatDev v5 `[V]` | A one-line requirement in, software out | The pipeline | None; "minimal human involvement" | None | None | The artefacts (PRD, design, code) |
| Copilot Studio, ms.date 2026-05-21 `[V]` | The parent agent; "the parent agent is the only one that should deliver the final response" | The parent | See section 3 | Not documented | Test-panel activity map (entry-point file §1) | Separate transcripts per connected agent |
| Agentforce `[V]` | The primary or "super" agent, which "aggregates the responses for the user" | The primary agent | Escalation to a human rep with "full conversation context" via Omni-Channel | Service reps "join the conversation" | Observability (entry-point file §6) | The session |
| Bedrock Agents Classic, maintenance mode `[V]` | The supervisor; `SUPERVISOR_ROUTER` lets a collaborator "send the final response", which "reduces the latency" | The supervisor | Not documented | Not documented | Traces | Session; max 10 collaborators |
| Google ADK v2.0.0 `[V]` | The coordinator; in task mode the subagent "asks questions as needed" then control "automatically returns to the originating agent" | The coordinator | Directly, while the subagent holds the turn | Chat mode: "Agent controls until manual handoff" | n/a | Session state |

Anthropic's own placement `[V]`: subagents "Return a result to the caller"; teams have "Self-coordination through messages, plus a shared task list"; use teams "when teammates need to share findings, challenge each other, and coordinate on their own", and a single session or subagents "For sequential tasks, same-file edits, or work with many dependencies".

### 1b. Artefact-mediated, no lead

| System | The artefact | Who writes it | The human's role | Precedent status |
|---|---|---|---|---|
| Claude Code task list `[V]` | Tasks with pending, in progress, completed and dependencies; "Task claiming uses file locking" | The lead creates; teammates self-claim; the human asks Claude to "show me all tasks" | Reads it (Ctrl+T); `CLAUDE_CODE_TASK_LIST_ID` shares one list across sessions | Ships, experimental |
| Symphony (OpenAI spec, Draft v1) `[V]` | The Linear issue: "One workspace per issue identifier"; dispatch while the state is in `active_states`; a run "can end at a workflow-defined handoff state (for example `Human Review`)" | The agent, through "provider-native tools" run host-side | Moves states, comments, edits `WORKFLOW.md`; `max_concurrent_agents` default 10 | Ships as spec plus Elixir reference; OpenAI post returned 403, framing from `[S]` Help Net Security 2026-04-28 |
| Long-running harness, 2025-11-26 `[V]` | `claude-progress.txt` and a JSON feature list of "over 200 features" all `"passes": false` | An initialiser session writes; later sessions append | No human editing mentioned; sessions are sequential, not a team | Ships as a described pattern |
| Paperclip `[V]` | Issues with company, project, goal and parent links; "atomic checkout" | Agents on heartbeats; a manager "assigns a task" and "Paperclip refuses" assignment to a paused agent | The human is "the board": approves hires, strategy, budget overrides; comments on issues | Ships, open source; `[S]` launched 2026-03 |
| Vibe Kanban `[V]` | Kanban issues; a workspace per task with "a branch, a terminal, and a dev server" | The human creates; agents execute | Reviews diffs, leaves inline comments | "sunsetting" |
| Linear `[V]` | The issue; "the human user remains the primary assignee, while the agent is added as a contributor" | Each delegated agent on its own session (entry-point file §2) | Assignee; several delegates on one issue is not documented; `[S]` Codegen's agent spawns children by creating sub-issues and assigning itself | Ships |
| Blackboard, classic and LLM `[V]` | A shared workspace; agents "are selected based on the current content of the blackboard" (2507.01701); a central agent "posts requests to a shared blackboard" and subordinates "independently decide whether they possess the capability" (2510.01285) | All agents | "Humans only interact with the central/main agent" | Papers, not products |
| Decentralised shared context, 2606.10662 `[V]` | "a shared verified context, and a task queue"; agents "asynchronously claim subtasks" | All agents | Not described | Paper |

### 1c. Handoff or swarm: the conversation moves

What "swarm" means per vendor `[V]`: OpenAI Swarm is an "educational framework" of agents and handoffs, "stateless between calls", returning "the last agent", and "now replaced by the OpenAI Agents SDK". In the Agents SDK a handoff makes the specialist "the active agent for the rest of the turn", seeing "the entire previous conversation history" unless an input filter trims it. LangGraph swarm: agents "dynamically hand off control to one another based on their specializations" and the system remembers "which agent was last active" so the next user message resumes there. Microsoft Agent Framework handoff: "a mesh topology where agents are connected directly without an orchestrator"; "the agent receiving the handoff takes full ownership"; "By default, a user response returns to the agent that requested it"; the pattern "is interactive by default" and pauses with a `HandoffAgentUserRequest` whenever an agent answers without handing off. Agentforce lists "Supervised Mode and Handoff Mode" as generally available and constrains depth to "Agent A>Agent B, not Agent A->B->C"; `[S]` a third-party blog says `delegate_escalation` applies "in handoff mode only". Anthropic's red team uses "swarm" for 10 to 80 peers on a shared project (prior art §2), a third meaning.

Inferred `[I]`: the operator's "swarm" is closest to the red-team meaning. No vendor ships that as a product. The vendors' "swarm" is a routing shape for conversations, where at most one agent holds the human at a time.

### 1d. No team object

Linear, Jira, Slack, Cursor and GitHub let several agents share one issue, channel or PR, each addressed by name (entry-point file §2 and §5). GitHub's agents panel shows "Sessions that you started, or that another user prompted Copilot to work on" across repositories; steering is a follow-up typed under the session log and "is unavailable for third-party coding agents" `[V]`. Agent HQ's "mission control" promises to "assign, steer, and track" agents from five vendors with "Identity features to control which agent is building the task" `[V]`, 2025-10-28. Each of these is n human-to-agent pairs. Coordination between the agents is the human's job or an issue link.

## 2. The "project manager" model tested

Conclusion: the model matches. Every shipped team has an agent whose job is decomposition, assignment, progress tracking and synthesis. It is always a role one agent plays, declared in configuration, never a platform object with its own address. The human addresses that agent as they would any agent.

| System | Holds the plan | Assigns | Approves members' actions | Re-plans on failure | Role or object |
|---|---|---|---|---|---|
| Claude Code lead `[V]` | The shared task list | "The lead breaks work into tasks and assigns them"; teammates also "self-claim" | Grants plan approvals "without the lead reviewing it"; permission prompts go to the human | Reassigns "if someone gets stuck" (best practices) | Role: `team-lead` agent type in `config.json` |
| Managed Agents coordinator `[V]` | Its own context and the shared filesystem | `send_to_agent` to roster members or `self` copies | No; the client answers permission events | Follow-ups to persistent threads | Role: `multiagent.type: coordinator`; "only delegate to one level" |
| Magentic manager `[V]` | Task ledger ("facts, guesses, and plan") and progress ledger | Picks "the next speaker" per round | No; tool approval goes to the human | Stall counter, then "automatic reset and replan", optionally with human review | Role: `MagenticBuilder(manager_agent=...)` |
| Devin parent `[V]` | Its session | Launches children "with specific prompts, playbooks, tags, and ACU limits" | Child launch is auto-approved unless the setting is off | Messages, sleeps or terminates children | Role: any Devin session |
| Bedrock supervisor `[V]` | Its instructions | Routes or coordinates | No | No | Role: `agentCollaboration: SUPERVISOR` |
| CrewAI manager `[V]` | Implicit | "allocates tasks" | "evaluates outcomes" | Not documented | Role: `manager_agent` |
| MetaGPT Project Manager `[V]` | "breaks down the project into a task list" | "each code file... treated as a separate task assigned to Engineers" | No | No | Role, one of five |
| Paperclip CEO `[V]` | Goals and issues | Assigns to reports | The human board approves hires, strategy, budgets | Not documented | Role: the first agent "is always the CEO" |

Costs in the vendors' own words `[V]`. Anthropic: subagents passing results through the lead is a "game of telephone", mitigated by storing work externally and passing references; teams "use significantly more tokens" and "Token costs scale linearly"; the lead "can stop early too". Copilot Studio: "Subagents don't inherently know they're part of an orchestration"; "The parent agent can't stop a running subagent"; "Separate agents introduce overhead... a slightly longer execution time due to context switching"; "start with one agent". Anemoi (2508.17068): a centralised planner has "strong dependency on the planner's capability" and "limited inter-agent communication, where collaboration relies on prompt concatenation". The blackboard paper (2510.01285): the controller "must maintain an accurate model of each agents capabilities" and faces "assignment ambiguity". Cognition, 2025-06-12: "in 2025, running multiple agents in collaboration only results in fragile systems"; nine months later the same vendor shipped managed Devins with the argument that "context accumulates, focus degrades" in one session `[V]`. Inferred `[I]`: the two Cognition positions reconcile the way Anthropic's do (prior art §2): isolate context per member, keep decisions in one place, and give the human a way to see each member's full trace.

Anthropic's guidance on the ladder `[V]`. Blog, 2026-01-23: multi-agent pays for "context protection", "parallelization" and "specialization"; otherwise "Coordination costs typically exceed the benefits"; decompose by required context, not by task type; sequential phases of one feature stay with one agent. Claude Code docs: check "whether a lighter option does the job", subagents first, then cross-session messaging, then a team.

## 3. Where the human's question and the agent's question meet

Conclusion: three routes ship. Through the lead, where the member's question becomes the lead's question and the answer comes back as a delegation message. Through the artefact, where the member writes a comment or moves a state and the human answers in the same place. Through a correlated platform event, an approval or elicitation carrying the member's id. A fourth route, a direct channel to the member, ships in Claude Code and Devin. Lead-only routes lose the thread when the reply re-enters as a fresh turn; artefact and correlated-event routes keep it.

| Pattern | Route | Correlation kept by | Documented loss |
|---|---|---|---|
| Copilot Studio parent `[V]` | Subagent returns `openQuestions` and `findings`; parent answers the user | The parent's plan | "The parent can't see the subagent's exchange with the user"; a one-way "inform" means "the user's reply goes back to the parent planner as a brand-new query"; the fix is "ask" so "the same conversation with the subagent" continues |
| Managed Agents `[V]` | Subagent's permission or custom-tool request cross-posted to the primary thread | `session_thread_id` on the event | None for permissions. Free-form questions reach only the coordinator (`agent.thread_message_received`); the client cannot post into the subagent's thread |
| Claude Code teams `[V]` | Permission prompts surface in the lead session; a teammate's plain question is in its transcript and idle notification | The teammate's name and mailbox file | "teammates sometimes fail to mark tasks as completed"; a teammate "can't approve a permission prompt... on your behalf" |
| Agent Framework `[V]` | `RequestInfoEvent` from any executor; the framework "routes the response to the executor that sent the original request" | `request_id`; pending requests saved in checkpoints | None documented |
| Handoff (Agent Framework, LangGraph swarm) `[V]` | The holding agent asks; the reply "returns to the agent that requested it" | Last-active agent | `enable_return_to_previous(False)` routes every reply through the start agent instead |
| Linear session `[V]` (entry-point file §2) | `elicitation` activity, `awaitingInput` state, `prompted` webhook | Session id on the issue | None documented |
| Symphony `[V]` | The agent moves the issue to `Human Review` or comments; the human changes state | Issue id | The orchestrator "re-fetches issue state" on the next poll; in-memory state "is not persisted" |
| Devin child `[V]` | The child's own session; the human answers there or via the parent | Session link | Not documented |
| MasDrift (entry-point file §4) | n/a | n/a | Unauthorised actions 2.7% at one level, 11.7% at two, 19.8% at three; "71.9% of losses remain at hop 1" |

Inferred `[I]`: the "brand-new query" failure is structural to lead-only routing. The lead has no record that a question is open unless the member reports it as data, which is what `openQuestions` and `elicitation` are. A platform that lets a member's question land in the artefact with the member's session id gets correlation for free and keeps the lead out of the loop for that exchange.

## 4. What is measured

Conclusion: the payoff of a lead is confined to breadth-first, low-baseline work. On coding and sequential planning every multi-agent shape scores below the single agent, and every shape multiplies tokens by three or more.

| Source | Comparison | Result |
|---|---|---|
| Anthropic research system, 2025-06-13 `[V]` | Lead plus subagents versus single Opus 4, internal research eval | "outperformed... by 90.2%"; "about 15× more tokens than chats"; token usage "explains 80% of the variance" on BrowseComp |
| Claude blog, 2026-01-23 `[V]` | Multi versus single | "3-10x more tokens" |
| Claude Code costs `[V]` | Teams versus a session | "approximately 7x more tokens than standard sessions when teammates run in plan mode" |
| Towards a Science of Scaling Agent Systems, v3 2026-04-08, N=260 configurations, 6 benchmarks, 9 models `[V]` | Single versus independent, decentralised, centralised, hybrid | Centralised +80.8% on Finance Agent, −50.3% on PlanCraft, −3.1% on SWE-bench Verified, −19.2% on Terminal-Bench; decentralised +74.5% Finance, −5.4% SWE-bench; independent −14.9% SWE-bench. Overhead over single: independent 58%, decentralised 263%, centralised 285%, hybrid 515%. Error amplification: centralised 4.4×, hybrid 5.1×, decentralised 7.8×, independent 17.2×. "Tasks where single-agent performance already exceeds 45% accuracy experience negative returns from additional agents". Tool-heavy tasks (16 tools) "suffer from multi-agent coordination overhead" |
| MasDrift (entry-point file §4) | Depth of hierarchy | Completion 93.9% to 98.6% against unauthorised actions 2.7% to 19.8% by level |
| Anemoi, v3 2025-10-10 `[V]` | Semi-centralised with peer A2A versus centralised OWL, GPT-4.1-mini planner, GAIA | 52.73% versus 43.63% |
| Blackboard 2510.01285, 2025-09-30 `[V]` | Blackboard versus master-slave and RAG | "13% to 57% relative improvement"; per model 7.90% (Qwen3-Coder) to 31.43% (Claude 4 Opus) |
| Decentralised shared context 2606.10662, 2026-06-09 `[V]` | Shared context plus task queue versus centralised orchestration | "up to 10.5 percentage points" on SWE-bench Verified "while reducing cost per task by roughly 50%"; +5.7 on LongBench-v2 |
| MetaGPT v7, ChatDev v5 `[V]` | Role pipelines, SoftwareDev tasks | MetaGPT 31,255 tokens, 541 s, "0.83" human revisions, 124.3 tokens per line against ChatDev's 248.9; ChatDev 22,949 tokens, 148.2 s, executability 0.88 |
| Cognition, 2025-06-12 `[V]` | Argument, no data | Parallel subagents produce work "inconsistent with each other" |

Two readings `[I]`. First, the shapes that beat the lead on coding in 2026 (Anemoi, 2606.10662) are artefact-mediated: peers read one shared record and claim from a queue. Second, the Scaling paper's 45% threshold and MasDrift's depth curve point the same way as Anthropic's placement: one level, breadth-first, and only where the single agent is weak.

## 5. Accountability and identity

Conclusion: in the work tools the human stays accountable and the agent is a delegate or contributor. In the team products the lead inherits the human's permission mode and every member acts under the same credentials as the lead. Authorisation to a member two hops away is either the lead's own grant (Claude Code, Managed Agents) or absent by construction (one-level limits).

| System | Assignee in the work tool | Signs the commit or PR | Acts on external systems as | Authorisation two hops away |
|---|---|---|---|---|
| Linear `[V]` | The human "remains the primary assignee"; the agent "is added as a contributor"; "an agent cannot be held accountable" (entry-point file §2) | The agent integration's choice | The agent user | Not applicable; one delegate documented |
| GitHub Copilot cloud agent `[V]` | Copilot, on the issue | "exactly one pull request" per task; `[S]` community thread 2025-11-19: squash-merge sets "the commit author... to Copilot rather than the person who requested the task", unresolved as of 2026-09 | Copilot | Not applicable |
| Devin `[V]` | The session | Admin setting "Open PRs as": Devin, User, or User only; co-authored modes; GPG verifies only "when Devin is the committer" | "organization-level permissions", shared by all users | A child is a full Devin under the same org permissions `[I]` |
| Claude Code teams `[V]` | n/a | The human's git identity | "Teammates start with the lead's permission mode"; `--dangerously-skip-permissions` propagates | A denied teammate "can't relay it to another teammate to bypass the check"; "No nested teams" |
| Managed Agents `[V]` | n/a | n/a | "vault credentials are session-scoped (`vault_ids` passed at session creation apply to every thread)"; MCP servers are per agent definition | "only delegate to one level"; a nested roster "fails the create or update request" |
| Symphony `[V]` | The Linear issue's assignee is the human's choice; the agent acts through host tools | The agent, through provider tools | Orchestrator-held tracker credentials; "Do not pass tracker credentials through the coding-agent child environment" | Not applicable; one agent per issue |
| Agentforce `[V]` | The session | n/a | Connected agents "might have different privileges"; "Agent A>Agent B, not Agent A->B->C" | Prohibited |
| Copilot Studio `[V]` | The session | n/a | "The connected agent might have access to things the parent agent doesn't"; "Treat a connected agent call like any other powerful action" | Guidance only |
| Paperclip `[V]` | The issue's agent | n/a | Per-agent budget; the board approves | Manager to worker is one hop; the board approves hires |

The principal-agent paper (2601.23211, 2026-01-30) names the gap: "information asymmetry" between a supervisor and its specialists produces "agency loss: a gap between the principal's intended outcome and the realized system behavior" `[V]`. Inferred `[I]`: one-level limits in Managed Agents, Agentforce and Claude Code are the shipped answer to MasDrift's depth curve. A platform that allows a member to delegate again is on its own.

## 6. Synthesis for the operator's two patterns

Conclusion: "communicating with a team" is, in every shipped product, communicating with one agent that delegates, plus two optional extras: a shared record the human reads, and a direct line to each member. There is no team address distinct from the lead's. The additions below are what a platform needs beyond single-agent direct addressing, each with its precedent.

| Direct to agent | Communicating with a team |
|---|---|
| The human names the agent in the tool (entry-point file §2) | The human names the lead in the tool; the lead is an agent with a `coordinator` or `team-lead` flag |
| One session, one record in the work item | One lead session plus member sessions; the record is the issue or a shared task list |
| Questions arrive as `elicitation` on the session | Members' questions arrive via the lead, or as their own elicitations on the same record, or as correlated approval events |
| Accountability: human assignee, agent delegate | Same; members are contributors, the lead is the delegate |
| Cost: one agent's tokens | 3× to 15× (Anthropic), 7× (Claude Code plan mode), 285% overhead for centralised (Scaling paper) |

| Platform addition | Ships today in | No precedent |
|---|---|---|
| A team address separate from the lead | — | No product addresses a team as an object. Managed Agents addresses the session, whose primary thread is the coordinator. Claude Code has "One team per session" |
| A lead role in the manifest | Managed Agents `multiagent.type: coordinator` with a roster; Bedrock `agentCollaboration: SUPERVISOR`; Claude Code `team-lead`; Agent Framework `MagenticBuilder(manager_agent=)` | — |
| A shared task record readable by members and the human | Claude Code task list (`~/.claude/tasks`, Ctrl+T, `CLAUDE_CODE_TASK_LIST_ID`); Symphony over Linear; Paperclip issues; Magentic ledgers as events | A record that both the human and every member edit with locking, outside a dev harness or an issue tracker |
| A per-member direct channel | Claude Code agent panel; Devin child session links; Copilot Studio connected agents "available directly on independent channels" (entry-point file §5) | Managed Agents: "your client posts no messages" in a subagent thread; interrupt only |
| An approval or question queue correlated to the member | Managed Agents cross-posting with `session_thread_id`; Agent Framework `RequestInfoEvent` with `request_id` and checkpoints; Claude Code prompts in the lead session; Linear `awaitingInput` per session | — |
| A depth limit | Managed Agents one level; Agentforce "A>B, not A->B->C"; Claude Code "No nested teams" | A platform that permits depth two with a measured control |
| Human-readable member traces | Devin: the parent "read[s] the full trajectories"; Claude Code transcripts; Managed Agents thread event lists | — |

Recommendation criteria, not a decision `[I]`:

1. Model "the team" as the lead's address plus a shared record. Every precedent does; a team object would have no counterpart in the tools the human already uses.
2. Give the lead a manifest flag and a roster, and forbid a roster member from having a roster. Three vendors converged on one level.
3. Let a member's question land in the record under the member's own session id, and let the lead read that record. This is Linear's `elicitation` and Symphony's `Human Review` state, and it avoids the Copilot Studio "brand-new query" loss.
4. Keep a per-member direct line for the human. Claude Code and Devin ship it; Managed Agents' omission is the exception, and Copilot Studio's docs show what happens when the parent is the only path: the parent "can't stop a running subagent" and "can't see the subagent's exchange".
5. Prefer the artefact over the lead as the coordination medium for coding work. The 2026 numbers favour shared-record peers over a planner on SWE-bench, and the work tools already are the record.
6. Gate the team shape on the Scaling paper's criteria: parallelisable, few tools, single-agent baseline under about 45%. Above that, the operator's own evidence (prior art §2) says fix the single loop.

## Open questions

- Agentforce "supervised mode" and "handoff mode" are named as generally available `[V]` but their definitions come from a third-party blog `[S]`; the primary help and Agent Script pages returned HTTP 403. Treat the Agentforce row as one-level lead-mediated until verified.
- OpenAI's Symphony announcement returned HTTP 403; the spec is verified, the adoption claims are not.
- No vendor documents a member's free-form question reaching the human without the lead, other than Claude Code's transcript view and Devin's child session links. Whether users prefer that line, or the lead's summary, has no study behind it, as the entry-point file §4 found for routing.
- Devin's "up to 10 parallel sessions" is secondary `[S]`. Cognition's own post gives no limit.

## Pattern table

| Pattern | Human talks to | Accountable | How questions travel | What persists | Precedents | Measured cost |
|---|---|---|---|---|---|---|
| Lead-mediated | The lead; sometimes any member directly | The lead; the human assignee in the work tool | Lead relays, or platform cross-posts with member id | Lead's session; member threads (Managed Agents, Devin); task list (Claude Code) | Claude Code teams, Managed Agents, Devin, Magentic, CrewAI, Bedrock, Copilot Studio, Agentforce, Anthropic research | 3× to 15× tokens; 285% overhead; 4.4× error amplification; 2.7% to 19.8% unauthorised by depth |
| Artefact-mediated | The record; each agent by name on it | The human assignee | Comments, states, `elicitation` on the record | The record itself | Symphony over Linear, Claude Code task list, Paperclip, blackboard papers, 2606.10662 | +10.5 pp SWE-bench at about half the cost (paper); 58% to 263% overhead for independent or decentralised (Scaling paper) |
| Handoff or swarm | Whichever agent holds the conversation | The holding agent | The holder asks; reply returns to it | The transcript and last-active pointer | Agents SDK, LangGraph swarm, Agent Framework handoff, Agentforce handoff mode, ADK chat mode | Not measured for work; customer-service shape |
| No team object | Each agent by name | The human, per agent | Each agent's own session | Each agent's record | Linear, Jira, Slack, Cursor, GitHub agents panel | Single-agent cost times n; coordination is the human's time |

## Sources

Fetched 2026-09-27 unless marked. Dates are as shown on the page.

1. Claude Code, Orchestrate teams of Claude Code sessions (mentions v2.1.281). https://code.claude.com/docs/en/agent-teams
2. Claude Code, Manage costs effectively (agent team token costs; mentions v2.1.271). https://code.claude.com/docs/en/costs
3. Claude Code, Interactive mode, Task list section. https://code.claude.com/docs/en/interactive-mode
4. Claude Platform, Managed Agents, Multiagent orchestration (beta `managed-agents-2026-04-01`). https://platform.claude.com/docs/en/managed-agents/multiagent-orchestration
5. Anthropic, How we built our multi-agent research system, 2025-06-13. https://www.anthropic.com/engineering/multi-agent-research-system
6. Anthropic, Building effective agents, 2024-12-19. https://www.anthropic.com/engineering/building-effective-agents
7. Anthropic, Effective harnesses for long-running agents, 2025-11-26. https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
8. Claude blog, Building multi-agent systems: when and how to use them, 2026-01-23. https://claude.com/blog/building-multi-agent-systems-when-and-how-to-use-them
9. OpenAI Agents SDK, Orchestrating multiple agents (no date). https://openai.github.io/openai-agents-python/multi_agent/
10. OpenAI Agents SDK, Handoffs (no date). https://openai.github.io/openai-agents-python/handoffs/
11. OpenAI, Swarm README (no date; "replaced by the OpenAI Agents SDK"). https://github.com/openai/swarm
12. OpenAI, Agent Builder guide (shutdown scheduled 2026-11-30). https://developers.openai.com/api/docs/guides/agent-builder
13. OpenAI, Symphony SPEC.md, Draft v1. https://raw.githubusercontent.com/openai/symphony/main/SPEC.md
14. OpenAI, An open-source spec for Codex orchestration: Symphony. Not fetched: HTTP 403. https://openai.com/index/open-source-codex-orchestration-symphony/
15. Help Net Security, OpenAI releases Symphony, 2026-04-28. Secondary. https://www.helpnetsecurity.com/2026/04/28/openai-symphony-codex-orchestration-linear/
16. CrewAI, Hierarchical process (no date). https://docs.crewai.com/en/learn/hierarchical-process
17. CrewAI, Tasks (no date). https://docs.crewai.com/en/concepts/tasks
18. AG2, GroupChat (footer 2026-06-26). https://docs.ag2.ai/latest/docs/user-guide/advanced-concepts/groupchat/groupchat/
19. AG2, Human in the loop. https://docs.ag2.ai/latest/docs/user-guide/basic-concepts/human-in-the-loop/
20. Microsoft Research, Magentic-One, 2024-11-04. https://www.microsoft.com/en-us/research/articles/magentic-one-a-generalist-multi-agent-system-for-solving-complex-tasks/
21. Microsoft Agent Framework, Magentic orchestration, ms.date 2026-09-04. https://learn.microsoft.com/en-us/agent-framework/workflows/orchestrations/magentic
22. Microsoft Agent Framework, Handoff orchestration, ms.date 2026-09-24. https://learn.microsoft.com/en-us/agent-framework/workflows/orchestrations/handoff
23. Microsoft Agent Framework, Human-in-the-loop, ms.date 2026-07-16. https://learn.microsoft.com/en-us/agent-framework/workflows/human-in-the-loop
24. Microsoft Copilot Studio, Multi-agent orchestration patterns and best practices, ms.date 2026-05-21, updated 2026-09-12. https://learn.microsoft.com/en-us/microsoft-copilot-studio/guidance/multi-agent-patterns
25. Microsoft Copilot Studio, Design subagents that avoid duplicate messages, ms.date 2026-08-27. https://learn.microsoft.com/en-us/microsoft-copilot-studio/guidance/generative-orchestration-subagents
26. Microsoft Copilot Studio, Design best practices to avoid duplicate messages, ms.date 2026-08-27. https://learn.microsoft.com/en-us/microsoft-copilot-studio/guidance/generative-orchestration-duplicate-messages
27. Salesforce Architects, Agentic Patterns and Implementation with Agentforce (no date). https://architect.salesforce.com/docs/architect/fundamentals/guide/agentic-patterns.html
28. Salesforce, Agentforce Interoperability Guide (no date). https://www.salesforce.com/agentforce/resources/interoperability-guide/
29. SFDC Developers blog, Agentforce Subagents, 2026-09-04. Secondary. https://sfdcdevelopers.com/2026/09/04/agentforce-subagents-split-and-route-an-overloaded-agent/
30. Salesforce Developers, Agent Script blocks. Not fetched: HTTP 403. https://developer.salesforce.com/docs/ai/agentforce/guide/ascript-blocks.html
31. AWS, Use multi-agent collaboration with Amazon Bedrock Agents (Classic, maintenance mode). https://docs.aws.amazon.com/bedrock/latest/userguide/agents-multi-agent-collaboration.html
32. AWS, Create multi-agent collaboration. https://docs.aws.amazon.com/bedrock/latest/userguide/create-multi-agent-collaboration.html
33. Google ADK, Collaborative workflows (ADK Python v2.0.0). https://adk.dev/workflows/collaboration/
34. LangChain, langgraph-swarm-py README (no date). https://github.com/langchain-ai/langgraph-swarm-py
35. Cognition, Don't Build Multi-Agents, 2025-06-12. https://cognition.com/blog/dont-build-multi-agents
36. Cognition, Devin can now Manage Devins, 2026-03-19. https://cognition.com/blog/devin-can-now-manage-devins
37. Devin Docs, Advanced Capabilities (no date). https://docs.devin.ai/work-with-devin/advanced-capabilities
38. Devin Docs, GitHub integration (no date). https://docs.devin.ai/integrations/gh
39. AgentMarketCap, Devin's parallel sessions, 2026-04-10. Secondary; source of "up to 10 parallel sessions". https://agentmarketcap.ai/blog/2026/04/10/devin-parallel-sessions-multi-agent-concurrency
40. Factory Docs, Missions overview (no date). https://docs.factory.ai/missions/overview
41. GitHub Blog, Welcome home, agents (Agent HQ), 2025-10-28. https://github.blog/news-insights/company-news/welcome-home-agents/
42. GitHub Docs, Tracking Copilot's sessions (no date). https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/track-copilot-sessions
43. GitHub Docs, About GitHub Copilot cloud agent (no date). https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent
44. GitHub Community discussion 179983, commit authorship after squash merge, opened 2025-11-19. Secondary. https://github.com/orgs/community/discussions/179983
45. Linear, Linear for Agents (no date). https://linear.app/agents
46. Linear Docs, AI agents (no date). https://linear.app/docs/agents-in-linear
47. Linear Developers, Agent interaction (no date). https://linear.app/developers/agent-interaction
48. Codegen Docs, Linear integration. Secondary, via search snippet; not fetched. https://docs.codegen.com/integrations/linear
49. Paperclip, README (no date). https://github.com/paperclipai/paperclip
50. Paperclip Docs, Agents (no date). https://docs.paperclip.ing/guides/org/agents/
51. BloopAI, Vibe Kanban README ("sunsetting"). https://github.com/BloopAI/vibe-kanban
52. Kim et al., Towards a Science of Scaling Agent Systems, arXiv 2512.08296v3, 2026-04-08. https://arxiv.org/html/2512.08296v3
53. Hong et al., MetaGPT, arXiv 2308.00352v7, 2024-11-01. https://arxiv.org/html/2308.00352v7
54. Qian et al., ChatDev, arXiv 2307.07924v5, 2024-06-05. https://arxiv.org/html/2307.07924v5
55. Han and Zhang, Exploring Advanced LLM Multi-Agent Systems Based on Blackboard Architecture, arXiv 2507.01701, 2025-07-02. https://arxiv.org/abs/2507.01701
56. LLM-Based Multi-Agent Blackboard System for Information Discovery in Data Science, arXiv 2510.01285v1, 2025-09-30. https://arxiv.org/html/2510.01285v1
57. Anemoi: A Semi-Centralized Multi-agent System, arXiv 2508.17068v3, 2025-10-10. https://arxiv.org/abs/2508.17068
58. Decentralized Multi-Agent Systems with Shared Context, arXiv 2606.10662v1, 2026-06-09. https://arxiv.org/abs/2606.10662
59. Multi-Agent Systems Should be Treated as Principal-Agent Problems, arXiv 2601.23211v1, 2026-01-30. https://arxiv.org/abs/2601.23211
60. This repo, `docs/research/retarget/research/2026-09-21-human-entry-point.md`, §1, §2, §4, §5, §6.
61. This repo, `docs/research/retarget/research/2026-09-16-multi-agent-coordination-prior-art.md`, §2, §4.
