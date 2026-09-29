# How a human reaches the agents: prior art on the entry point

Date: 2026-09-21. Research brief for the retarget conversation. Builds on `2026-09-16-multi-agent-coordination-prior-art.md`: §1 (Manager and Decentralised rows), §3 (discovery), §4 (human-in-the-loop). Work item: none yet.

Labels: `[V]` I fetched the page this session and the claim is on it; URL in Sources. `[I]` my inference from `[V]` material. `[S]` a secondary account of a page I could not fetch, named as such. Shapes A, B and C are the owner's three candidates: direct addressing through the business tool, a front-desk orchestrator, and API or MCP first.

## Summary

Work-tool vendors ship shape A and nothing above it: Linear, Jira, GitHub, Cursor, Devin, Codex and Slack all make the human name the agent. Enterprise-assistant vendors ship shape B as a product: Copilot Studio, Agentforce and Microsoft 365 Copilot each put one entry agent over specialists chosen by description. The camps do not overlap; the front desks live in a chat pane, not in an issue tracker. Shape C is thin: Claude Code, the Claude apps, ChatGPT and AgentCore speak remote MCP with OAuth, and the spec has elicitation and tasks. No chat harness I could verify resumes a server-side agent task from a later session; the durable side is the server. The clearest hybrid is Microsoft 365 Copilot and Gemini Enterprise: `@agent` when the human names one, the assistant otherwise. The front-desk vendors' own guidance lists the costs: an extra hop, degraded selection past roughly 30 to 40 choices, specialists that answer the user unbidden. MasDrift's table puts numbers on depth: unauthorised actions average 2.7% at one supervisor level, 11.7% at two and 19.8% at three. On a 12-agent routing benchmark, zero-shot LLM routing scores F1 41.5 against 89.6 for a fine-tuned classifier. The front desk's state is a vendor-held transcript per conversation, plus the specialist's task record in the work tool when one exists. Every product separates the end user, who gets a chat or a work item, from the platform operator, who gets a console and traces. I found no primary user-experience study comparing one routing bot with several named bots.

## 1. One entry point that delegates (shape B)

Conclusion: three vendors sell it, all three put the human in a chat with the entry agent, and delegation is synchronous within a turn. None documents a delegation that outlives the conversation. The specialist is visible to the administrator in a trace, and to the end user only where the vendor chose to say so.

| Product | What the entry agent holds | Who replies | Delegation that takes days | How the human learns which specialist worked |
|---|---|---|---|---|
| Copilot Studio, generative orchestration `[V]` | "recent conversation history", which "is currently limited"; selects child and connected agents "based on their description" and calls several "in sequence" | Parent by default: "the parent agent is the only one that should deliver the final response"; a child may answer "when that's a deliberate choice" | Not documented. A topic redirect waits: "Once the agent is done, the originating topic where you redirected from resumes" | Test panel "activity map"; in some setups a system-generated `explanation_of_tool_call` message; production UI not stated |
| Agentforce multi-agent orchestration `[V]` | "A primary agent serves as the single, intelligent entry point"; Atlas "reviews each agent's description, instructions, and available actions" | Primary agent; specialists send "the final answer back to the primary agent to share with the user" | Not documented | Not on the product page. Observability lets engineers "understand which agent handled each turn, where it routed and why" |
| Microsoft 365 Copilot `[V]` | A "context store"; the orchestrator "formulates a plan comprised of multiple actions" and fills "up to five" function candidate slots | Copilot | Declarative agents "rely on user-initiated interactions"; only custom engine agents "trigger actions automatically" | The human named the agent by `@mention` or sidebar, so the answer is that agent's |
| OpenAI Agents SDK manager and triage (prior file §1, §4) | The manager's conversation; specialists return a result | Only the manager | In-process; a `needs_approval` pause is durable through `RunState` | No product surface; a library |
| Claude Code main thread `[V]` | Full history; subagents get only the delegation prompt and "return results" | Main agent | Background subagents within a session; a team's teammates die with the session | The agent panel and transcript viewer show each subagent or teammate |
| Slack `[V]` | Not a front desk. "Agents are autonomous, goal-oriented AI apps"; the user messages one app | The app | n/a | n/a |
| Gemini Enterprise `[V]` | Not a front desk in the user docs: "Click any agent card to start a conversation" or "run an agent in conversation using `@agent_name`" | The chosen agent | Not documented | The human chose it |

Copilot Studio's own guidance is the best account of what a front desk costs, verbatim `[V]`:

- "Increase latency due to the extra orchestration hops that are introduced."
- "Subagents don't inherently know they're part of an orchestration. Without explicit guidance, they behave as standalone agents and send messages directly to the user."
- "If the agent asks the user something by using a one-way message (inform), the user's reply goes back to the parent planner as a brand-new query."
- "A connected agent has a context-inclusion setting that controls whether it receives the conversation history"; "Citations might not always be maintained when passing outputs back".
- "Since it's a separate agent, you have separate transcripts for it. It's important for debugging to correlate the parent and connected sessions."

Salesforce's blog says the same from the other side `[V]`. For mission-critical flows it advises to "declare the routing path explicitly rather than leaving it to inference". It contrasts that with probabilistic routing it describes as "95% reliability".

## 2. The human addresses a specific agent through the tool (shape A)

Conclusion: every work-tool vendor ships this and models the agent as a workspace member. Progress and questions land in the artefact the human already has open. None offers routing above the agents. What sits above them is a picker and rule-based triggers: workflow transitions, board columns, labels, triage rules.

| Product | How the human addresses it | Progress and questions back | Several agents in one workspace | Routing above |
|---|---|---|---|---|
| Linear `[V]` | `@mention` in a comment, or delegate by picking the agent in the assignee menu; "the assigned teammate maintains ownership" | Session states `pending`, `active`, `error`, `awaitingInput`, `complete`, `stale` are "visible to users"; activities `thought`, `action`, `elicitation`, `response`, `error`; `elicitation` "Requests clarification"; the reply arrives as a `prompted` webhook | Each appears "in the mention and filter menus"; agent user pages; views filtered "by Delegate" | None. Triage rules can delegate by rule (Business and Enterprise) |
| GitHub Copilot cloud agent `[V]` | Assign the issue to "Copilot"; `@copilot` on a PR; agents panel; Copilot Chat; Teams, Slack, Jira, Linear, Azure Boards | A PR, "every step happening in a commit and being viewable in logs"; "continue chatting while the session runs" | "You can create specialized custom agents"; they appear in "The agents tab and panel, issue assignment, and pull requests"; the selection mechanism is not documented | None documented |
| Jira with Rovo and partner agents `[V]` | The **Agents** button on a work item; `@mention`; workflow transitions; a board column | "the agent provides an output for you to review in the **Agents** section"; "All agent activity and updates are displayed on a work item and in your Rovo chat history"; questions not documented | Rovo and partner agents share one picker; "GitHub Copilot coding agent, the first of many partner agents" | None. Transitions and columns are rules |
| Slack `[V]` | Message the app in split view, a DM, or an app thread | `assistant.threads.setStatus` with `processing` then `active`; "the loading UX does not disappear automatically" | The user picks the app; no routing documented | None |
| Devin `[V]` | `@Devin` in Slack; assign in Linear; labels `!plan`, `!implement`, `!triage`, `!review` | "Devin responds in-thread with updates and questions"; sessions "sync bidirectionally with a Slack thread"; in Linear "posts real-time updates", syncs its todo list "to Linear's plan UI", adds the PR URL | Not addressed | None; labels are rules |
| Cursor cloud agents `[V]` | `@Cursor` in Slack; `@cursor` on GitHub or Bitbucket PRs and issues; Linear; web; iOS; desktop; API | "posts a short plan in the thread"; "updates a short status under the thread"; questions not documented | `@Cursor [prompt]` continues the thread's agent; `@Cursor agent [prompt]` starts another; a context menu targets one agent | None |
| OpenAI Codex cloud `[V]` | Web; GitHub pull requests; "Slack channels and threads" | "watch the task logs or let the task run in the background"; "Review the summary and diff"; questions not documented | Not addressed | None |

Two vendors explain why they chose this shape. Linear `[V]`: agents get "a dedicated user to represent the agent inside the workspace". Sessions give "structured context: what happened, where it happened, who triggered it". Delegation keeps the human assigned because "an agent cannot be held accountable". Atlassian `[V]`: "most agent work today happens in one-off chats that never make it back to where the work lives and is coordinated".

## 3. Shape C precedents

Conclusion: transport and auth are solved, and the spec has the primitives. What is missing is harness support for a job that outlives the session. Every harness I checked is a remote MCP client with OAuth, and agent-as-MCP-tool exists on three platforms. Elicitation is specified and implemented in Claude Code and AgentCore. Tasks are specified but experimental, and no harness documents polling one from a later session.

| Client or server | Remote MCP and auth | Question from the remote agent | A job that takes days | Resume from a different session |
|---|---|---|---|---|
| Claude Code `[V]` | HTTP "recommended", SSE "deprecated"; `/mcp` and `claude mcp login`; dynamic client registration; keychain storage | Elicitation supported; a call on "an open elicitation dialog isn't backgrounded" | A tool call "still running after two minutes moves to a background task"; the result "arrives as a task notification" (v2.1.212+) | Not documented for MCP tasks. `SendMessage` reaches "your cloud sessions" and other machines; subagents resume by id "with full conversation history" |
| Claude apps (claude.ai, Desktop) `[V]` | Custom connectors by URL; OAuth via "Claude's published identity", DCR, or your own client; request headers in beta; per-tool **Blocked** | Not mentioned on the connectors page | Not mentioned | Not mentioned |
| ChatGPT developer mode `[S]` | Help article returned HTTP 403. OpenAI community post: "full Model Context Protocol (MCP) client support for all tools, both read and write"; remote servers only per replies | Not mentioned | Not mentioned | Not mentioned |
| Bedrock AgentCore Runtime `[V]` | Container at `0.0.0.0:8000/mcp`; invoke URL per runtime ARN; OAuth bearer (Cognito, Auth0) or IAM; `Mcp-Session-Id` | Stateful mode "enables these capabilities" (elicitation, sampling, progress) "within the same invocation" | Not stated | No: "If the server terminates or the session expires, requests may return a 404 error, and clients must re-initialize" |
| Docker cagent `[V]` | `docker agent serve mcp`; "each agent becomes a separate tool in the MCP client"; Claude Desktop config shown; HTTP "stateless, per MCP spec revision 2026-07-28"; `serve a2a` with bearer auth | Not stated | Not stated | Stateless by design |
| Microsoft Foundry A2A tool `[V]` | GA `a2a` v1.0; a toolbox "exposes an MCP-compatible endpoint" wrapping A2A; key, OAuth, Entra, managed identity | Not stated; "streaming responses aren't supported" | "A2A tasks and contexts are retained for 60 days from their most recent write" | The remote agent's answer returns to the calling agent, which "continues to manage the conversation" |
| Copilot Studio and Agentforce `[V]` | Both connect external agents over A2A as connected agents | See section 1 | Not documented | Not documented |
| MCP spec `[V]` | Elicitation (2025-06-18): "user input requests to occur nested inside other MCP server features"; flat schemas; `accept`, `decline`, `cancel`. Tasks (2025-11-25, "experimental"): `working` to `input_required` to terminal; `ttl`; `tasks/list`; "receivers MUST bind tasks to said context" | A task in `input_required` delivers `elicitation/create` over the `tasks/result` stream | Yes by design: "call-now, fetch-later" with polling and optional status notifications | Allowed under the same authorisation context; the client must keep the task id |

Claude Code's messaging primitives are the closest thing to the owner's "coordinate with fully remote agents" `[V]`. `SendMessage` reaches subagents, teammates, other local sessions, cloud sessions and other machines. Limits: "Plain text only", and "a message from another session never counts as your consent". Teammates are "not restored" by `/resume`, and in-process teammates cannot outlive the lead. Inferred `[I]`: a three-day job in shape C needs the server to hold the task and a client that polls it in a later session. The spec permits that. No harness documents it.

## 4. Evidence on the extra hop

Conclusion: every number I found points the same way. The hop adds latency and tokens. An LLM router over a fixed catalogue scores well below a trained classifier. Authorisation loss grows with depth and mostly occurs at the first handoff. No primary user-experience comparison of one routing bot against several named bots exists in what I could fetch.

MasDrift (arXiv 2608.07556v2), Table 3, undefended, five homogeneous model configurations `[V]`. The L1 and L3 rows match the paper's text ("taking UA from 2.7% to 19.8%"). The Single and L2 averages are my arithmetic over the same five columns.

| Structure | Agents | Unauthorised actions, mean % | Completion, mean % | Per-model UA range |
|---|---|---|---|---|
| Single agent | 1 | 0.4 | 85.1 | 0.0 to 1.0 |
| Peer network N2 to N8 | 2 to 8 | 0.6 to 0.8 | 85.7 to 87.0 | 0.0 to 2.3 |
| Centralised L1 (one supervisor) | 3 | 2.7 | 93.9 | 0.0 to 6.0 |
| Centralised L2 | 7 | 11.7 | 98.1 | 1.5 to 19.3 |
| Centralised L3 | 15 | 19.8 | 98.6 | 1.0 to 33.5 |

The paper's per-hop finding: "more than seven in ten losses land on the very first handoff whether the tree has one level or three. Even at three levels, 71.9% of losses remain at hop 1." Reserved-action attempts per 100 runs (Table 14) climb with depth, for example DeepSeek 16.5 at L1, 48.7 at L2, 104.2 at L3. The Source re-anchoring defence costs 6.6 to 19.3% more tokens and at most 4.5 completion points. The Chain defence costs 16.2 to 42.0% and "forfeits up to 36.3 points". Inferred `[I]`: in aesir's terms a front desk over a specialist is L1, and a specialist that spawns its own worker is L2.

Routing accuracy `[V]`. The WildChat set-valued routing benchmark (arXiv 2606.28925v2) routes 3,000 prompts over "a fixed 12-agent catalog". Zero-shot GPT-4o with a constrained schema: F1 41.51, exact match 19.00, and 0.78 extra agents dispatched per query. Linear multilabel: F1 71.79, exact match 49.67. Fine-tuned encoder: F1 89.59, exact match 73.11. The authors: "zero-shot prompting alone is not sufficient for reliable routing under the fixed 12-agent inventory used here". The Routing Plateau (arXiv 2606.07587v1) is about model routing, not agent routing. Its 21 methods "converge to a narrow performance range that remains far below the oracle router". The cause: routers "learn global averaged model-performance trends rather than fine-grained query-specific routing signals". Adjacent evidence, not direct.

Vendor numbers `[V]`. Copilot Studio: selection degrades "when your main agent has more than 30-40 choices of action (tools, topics, and other agents)", and sooner "with similar descriptions". Microsoft 365 Copilot fills "five function candidate slots". Its docs warn: "Declarative agents might stop responding when three or more different API actions are triggered within a single user turn". Claude Code agent teams "use significantly more tokens than a single session" and "Token costs scale linearly". Lost context between front desk and specialist is documented in section 1. The items: limited history, an opt-in context-inclusion setting, lost citations, and a specialist's question that comes back as a new query.

User experience `[I]`. The only vendor argument on the question is Atlassian's, in favour of named agents in the work item (section 2). "Agent sprawl" posts from orchestration vendors argue the opposite and are marketing; I did not find a study.

## 5. Hybrids

Conclusion: the hybrid is the norm in enterprise assistants and in Cursor, and every product keeps machine-event routing rule-based, with one exception. Copilot Studio lets generative orchestration "autonomously respond to events", which is an LLM in the event path; aesir treats that as a defect. Everyone else routes events by rule and reserves the LLM for a human's sentence.

| Product | Human names an agent | Human does not name one | Machine event |
|---|---|---|---|
| Microsoft 365 Copilot `[V]` | "@mentioning the agent" or "selecting the agent from the sidebar" | Copilot's orchestrator over built-in skills and installed actions | Declarative agents: none; custom engine agents: "proactive messaging" |
| Copilot Studio `[V]` | A connected agent can be "available directly on independent channels, as well as being usable by other agents" | The main agent selects by description | Event triggers go through the same generative orchestration |
| Gemini Enterprise `[V]` | Agent card or `@agent_name` | A conversation without a named agent (behaviour not documented) | Not documented |
| Cursor in Slack `[V]` | `@Cursor agent [prompt]` starts a fresh agent | `@Cursor [prompt]` in a thread that has an agent "adds follow-up instructions" | `@cursor` on a PR or issue comment |
| Linear, Jira, Devin `[V]` | Mention, delegate, assign | Nothing happens | Triage rules, transitions, columns, labels: rule to a named agent |
| Claude Code `[V]` | `@"name (agent)"` "guarantees it runs" | The main agent delegates "when Claude encounters a task that matches a subagent's description" | n/a |

Keeping the two apart `[I]`: a front desk is an LLM reading a human's natural-language request and choosing a specialist. An event router is a rule over a typed event. The work-tool products never merge them; the routing layer above their agents is a rule table, and the LLM lives inside the named agent.

## 6. Where the front desk's state lives

Conclusion: shape B products keep "what I asked for on Monday" in a vendor-held conversation store the end user cannot open. Shape A products keep it in the work item, where the human can read it. Shape C leaves it on the server under a ttl.

| Product | Where the state lives | The human can inspect |
|---|---|---|
| Copilot Studio `[V]` | The planner's "Conversation history for the current session", limited; child agents "always" get the parent's context; connected agents have "separate transcripts" correlated by "identifiers in the telemetry" | The activity map, in the test panel |
| Agentforce `[V]` | The session; Observability captures "every multi-agent interaction captured turn-by-turn" | Administrators, in Observability |
| Microsoft 365 Copilot `[V]` | The orchestrator "logs it in the context store" and "updates the conversation state" | The chat history |
| Claude Code `[V]` | The session transcript; subagents at `~/.claude/projects/{project}/{sessionId}/subagents/agent-{agentId}.jsonl`, resumable; the team task list "persists locally", the team config is "removed when the session ends" | Transcript viewer and agent panel |
| Linear, Jira, GitHub, Devin, Cursor, Codex `[V]` | The specialist's record in the tool: a session on the issue, the **Agents** section, a PR with logs, a synced thread, a task page | Yes, in the tool |
| MCP tasks and Foundry A2A `[V]` | A server-held task with a `ttl`, listable under the same authorisation context; Foundry keeps A2A tasks and contexts 60 days from last write | Through `tasks/list`, if the client exposes it |

## 7. Two meanings of "operator"

Conclusion: every product separates two people. The end user works with agents in chat or a work item; the administrator governs them in a console and reads traces. The word "operator" in aesir's earlier design (operator-to-agent chat) meant the second person using the first person's surface; no product ships that.

| Product | End user gets | Platform administrator gets |
|---|---|---|
| Microsoft 365 Copilot `[V]` | Copilot Chat, the Agent Store, `@mention`, the sidebar | Copilot controls in the Microsoft 365 admin center to "approve, publish, deploy, remove, and block agents"; the Power Platform admin center for Copilot Studio agents |
| Copilot Studio `[V]` | The published channel | The main agent's **Agents** page with an **Enabled** toggle; the test panel activity map |
| Agentforce `[V]` | The primary agent's chat | Agentforce Builder; Observability "for IT teams" and "service leaders", per session, "drilling into specific subagents" |
| Gemini Enterprise `[V]` | The Agent Gallery, `@agent_name` | "Gemini Enterprise Admin manages and adds agents"; the Agent Registry |
| Linear `[V]` | Assignee menu, session on the issue | "Workspace admins can install agents"; Insights "by Delegate" |
| Jira `[V]` | The **Agents** button, mentions | **Configuration > Surfaces**; credit allowances from 2026-12-03 |
| Claude Code `[V]` | Terminal, agent panel, transcript, Remote Control | Managed settings; permission deny rules for `SendMessage` and `ListAgents`; Foundry Control Plane registers external A2A agents |
| AgentCore `[V]` | Any MCP client | The AgentCore CLI, Cognito or Auth0, the runtime ARN |

Vocabulary this note suggests `[I]`: "end user" for the person who asks, "administrator" for the person who governs and reads traces. The trace viewer is the administrator's chat substitute in every product above.

## What the evidence supports for each shape

**Shape A, direct addressing through the business tool.** Confirms: it is the only shape any work-tool vendor ships. Linear and Atlassian give explicit reasons: accountability, and work that stays where it lives. Progress and questions land in the artefact. Automation above it is rule-based, which matches aesir's event-router stance. MasDrift favours fewer hops. Contradicts: the enterprise-assistant vendors treat a single entry point as the customer ask, and their pitch is that named agents sprawl (`[S]`, marketing). Unknown: how many named agents a picker tolerates, and whether end users prefer it; no study.

**Shape B, a front desk that aesir builds.** Confirms: three vendors ship it, and one conversation is the sales point. Agentforce can show an administrator which agent ran each turn. Contradicts: the vendors' own guidance lists latency, a 30 to 40 choice ceiling, subagents replying unbidden, questions that return as new queries, and lost citations. MasDrift shows 2.7% to 11.7% unauthorised actions from one to two levels. Zero-shot routing over 12 agents scores F1 41.5. No vendor puts the front desk in a work tool, and none documents a delegation that outlives the turn. Unknown: what the end user sees of the specialist in production, and human-facing misroute rates.

**Shape C, API and MCP first.** Confirms: every harness is a remote MCP client with OAuth. Agents already appear as MCP tools on cagent, AgentCore and Foundry. Elicitation and tasks are in the spec. Claude Code backgrounds long calls and can message cloud sessions. Contradicts: no harness documents resuming a task in a later session, and AgentCore sessions expire. ChatGPT's behaviour is unverified. Agent teams die with the lead, tasks are experimental, and cross-agent messages are plain text and never consent. Unknown: elicitation in the Claude apps and ChatGPT, tasks in any harness, and how a three-day job's question reaches a human who closed the harness.

## Sources

Fetched 2026-09-21 unless marked. Dates are as shown on the page.

1. Microsoft Copilot Studio, Add other agents overview, ms.date 2026-05-15, updated 2026-08-27. https://learn.microsoft.com/en-us/microsoft-copilot-studio/authoring-add-other-agents
2. Microsoft Copilot Studio, Orchestrate agent behavior with generative AI, ms.date 2026-08-26. https://learn.microsoft.com/en-us/microsoft-copilot-studio/advanced-generative-actions
3. Microsoft Copilot Studio, Multi-agent orchestration patterns and best practices, ms.date 2026-05-21, updated 2026-09-12. https://learn.microsoft.com/en-us/microsoft-copilot-studio/guidance/multi-agent-patterns
4. Microsoft 365 Copilot, Agents for Microsoft 365 Copilot, ms.date 2026-08-05. https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/agents-overview
5. Microsoft 365 Copilot, How the orchestrator chooses actions, ms.date 2026-01-13. https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/orchestrator
6. Microsoft 365, Agents admin guide, ms.date 2026-04-07, updated 2026-09-09. https://learn.microsoft.com/en-us/copilot/microsoft-365/agent-essentials/m365-agents-admin-guide
7. Salesforce, Agentforce Multi-Agent Orchestration (no date on page). https://www.salesforce.com/agentforce/multi-agent-orchestration/
8. Salesforce blog, Scaling Beyond One Agent? Here's Where Most Teams Get Stuck, 2026-08-17. https://www.salesforce.com/blog/multi-agent-orchestration/
9. Salesforce, Agentforce Observability (no date on page). https://www.salesforce.com/agentforce/observability/
10. Salesforce Admins blog, What Is Multi-Agent Orchestration. Not fetched: HTTP 403. https://admin.salesforce.com/blog/2026/what-is-soma-and-when-to-build-a-super-agent-or-a-single-agent
11. Google Cloud, Browse agents with Agent Gallery, last updated 2026-09-18. https://docs.cloud.google.com/gemini/enterprise/docs/agent-gallery
12. Google Cloud, Gemini Enterprise Agent Platform, Agents overview, last updated 2026-09-21. https://docs.cloud.google.com/gemini-enterprise-agent-platform/agents
13. Slack, AI apps (no date on page). https://docs.slack.dev/ai
14. Slack, Developing AI apps (no date on page). https://docs.slack.dev/ai/developing-ai-apps
15. Claude Code, Subagents (no date on page). https://code.claude.com/docs/en/sub-agents
16. Claude Code, Orchestrate teams of Claude Code sessions (describes v2.1.178; no date). https://code.claude.com/docs/en/agent-teams
17. Claude Code, Message your other Claude Code sessions (no date on page). https://code.claude.com/docs/en/cross-session-messaging
18. Claude Code, Connect Claude Code to tools via MCP (no date; mentions v2.1.274). https://code.claude.com/docs/en/mcp
19. Linear Developers, Getting started with agents (no date on page). https://linear.app/developers/agents
20. Linear Developers, Agent interaction (no date on page). https://linear.app/developers/agent-interaction
21. Linear Docs, AI agents (no date on page). https://linear.app/docs/agents-in-linear
22. Linear Docs, Assign and delegate issues (no date on page). https://linear.app/docs/assigning-issues
23. Linear, Our approach to building the Agent Interaction SDK, 2025-08-01. https://linear.app/now/our-approach-to-building-the-agent-interaction-sdk
24. GitHub Docs, About GitHub Copilot cloud agent (no date on page). https://docs.github.com/copilot/concepts/agents/coding-agent/about-coding-agent
25. GitHub Docs, About custom agents (no date on page). https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-custom-agents
26. Atlassian Support, Collaborate on work items with AI agents (no date; mentions 2026-12-03). https://support.atlassian.com/jira-software-cloud/docs/collaborate-on-work-items-with-ai-agents/
27. Atlassian, From agent sprawl to seamless alignment: Introducing agents in Jira, 2026-02-25. https://www.atlassian.com/blog/rovo/ai-agents-in-jira
28. Devin Docs, Slack (no date on page). https://docs.devin.ai/integrations/slack
29. Devin Docs, Linear (no date on page). https://docs.devin.ai/integrations/linear
30. Cursor Docs, Cloud Agents (no date on page). https://cursor.com/docs/cloud-agent
31. Cursor Docs, Slack (no date on page). https://cursor.com/docs/integrations/slack
32. OpenAI, Codex cloud (no date; redirect from developers.openai.com/codex/cloud). https://learn.chatgpt.com/docs/cloud
33. OpenAI Help, Developer mode and MCP apps in ChatGPT. Not fetched: HTTP 403. https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt
34. OpenAI Developer Community, MCP server tools now in ChatGPT developer mode, 2025-09-10. Secondary. https://community.openai.com/t/mcp-server-tools-now-in-chatgpt-developer-mode/1357233
35. Claude Docs, Third party connectors with remote MCP (no date on page). https://claude.com/docs/connectors/custom/remote-mcp
36. Model Context Protocol, Elicitation, spec 2025-06-18. https://modelcontextprotocol.io/specification/2025-06-18/client/elicitation
37. Model Context Protocol, Tasks, spec 2025-11-25. https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks
38. Docker Agent docs, MCP Mode (tracks `main`; cites MCP spec revision 2026-07-28). https://docker.github.io/docker-agent/features/mcp-mode/
39. Docker Agent docs, A2A Protocol (tracks `main`). https://docker.github.io/docker-agent/features/a2a/
40. AWS, Deploy MCP servers in AgentCore Runtime (no date; mentions 2025-10-07). https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-mcp.html
41. AWS, Stateful MCP server features (no date on page). https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/mcp-stateful-features.html
42. Microsoft Foundry, Connect to an A2A agent endpoint from Foundry Agent Service, ms.date 2026-09-11. https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/tools/agent-to-agent
43. Xu et al., MasDrift, arXiv 2608.07556v2, 2026-08-11. HTML for the text, PDF for Tables 3 and 14. https://arxiv.org/html/2608.07556 and https://arxiv.org/pdf/2608.07556
44. Multi-Agent Routing as Set-Valued Prediction: A WildChat Benchmark and Cost-Aware Evaluation, arXiv 2606.28925v2, 2026-07-12. https://arxiv.org/html/2606.28925
45. The Routing Plateau: Understanding and Breaking the Accuracy Limits of LLM Routers, arXiv 2606.07587v1, 2026-05-27. https://arxiv.org/abs/2606.07587
46. This repo, `docs/designs/retarget/research/2026-09-16-multi-agent-coordination-prior-art.md`, §1, §3, §4.
