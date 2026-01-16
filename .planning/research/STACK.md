# Stack Research: Multi-Agent Orchestration Frameworks

**Domain:** Agentic Development Platform / AI Agent Orchestration System
**Researched:** 2026-01-16
**Confidence:** HIGH (based on official docs, GitHub repos, and multiple 2025 industry sources)

## Executive Summary

For Aesir's requirements (multi-LLM support, tool/MCP integration, async webhooks, TypeScript team, AWS deployment), **LangGraph.js** emerges as the recommended core orchestration framework, with **AWS Strands Agents** as a strong alternative for tighter Bedrock integration. CrewAI is excellent for prototyping but has Python-only limitations. Rolling your own is viable with the Vercel AI SDK as a primitive layer.

---

## Framework Comparison Matrix

| Framework | Multi-LLM | TypeScript | MCP Support | Async/HITL | Maturity | AWS Ready |
|-----------|-----------|------------|-------------|------------|----------|-----------|
| **LangGraph.js** | Excellent | Native | Yes | Excellent | GA 1.0 (Oct 2025) | Yes |
| **CrewAI** | Excellent | No (Python) | Yes | Good | GA 2.0 | Yes (Bedrock) |
| **AutoGen/MS Agent Framework** | Good | .NET focus | Yes | Good | Preview | Azure focus |
| **AWS Bedrock Agents** | Limited | SDK only | Via A2A | Native | GA (Mar 2025) | Native |
| **AWS Strands Agents** | Excellent | Native | Yes | Good | Preview (Dec 2025) | Native |
| **Semantic Kernel** | Good | .NET/Python | Yes | Good | Preview | Azure focus |
| **Vercel AI SDK** | Excellent | Native | Yes | Good | GA 6.0 | Any |

---

## Recommended Stack

### Primary Recommendation: LangGraph.js

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| LangGraph.js | 1.0+ (Oct 2025) | Core orchestration | First stable GA in multi-agent space; graph-based workflows with checkpointing, human-in-the-loop, and time-travel debugging. Used by Replit, Uber, LinkedIn, GitLab |
| @langchain/langgraph | ^0.2.x | Agent runtime | Stateful agents with persistent memory, conditional branching, cycles for iteration |
| @langchain/langgraph-sdk | latest | Cloud deployment | REST API for LangGraph deployments |
| @langchain/anthropic | ^0.3.x | Claude integration | Native Anthropic model support |
| @langchain/openai | ^0.3.x | GPT integration | OpenAI model support |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @modelcontextprotocol/sdk | latest | MCP client/server | Tool integration via Model Context Protocol standard |
| Zod | ^3.x | Schema validation | Type-safe tool definitions and structured outputs |
| @effect/io | ^3.x | Error handling | Reliable async operations with retries and fallbacks |
| bullmq | ^5.x | Job queues | Async webhook processing, human-in-the-loop state |
| ioredis | ^5.x | State persistence | Distributed state and checkpointing |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| LangSmith | Observability | Traces execution paths, state transitions, runtime metrics |
| Vitest | Testing | Fast TypeScript-native testing |
| tsx | Development | TypeScript execution without build step |

---

## Installation

```bash
# Core LangGraph.js stack
npm install @langchain/langgraph @langchain/core @langchain/anthropic @langchain/openai

# MCP integration
npm install @modelcontextprotocol/sdk

# Supporting infrastructure
npm install zod bullmq ioredis

# Dev dependencies
npm install -D vitest tsx typescript @types/node
```

---

## Framework Deep Dives

### 1. LangGraph.js (Recommended)

**Architecture:** Graph-based state machine with nodes (agents/functions) and edges (transitions).

**Key Strengths:**
- **Durable execution**: Persists through failures, resumes from checkpoints
- **Human-in-the-loop**: Built-in interrupt nodes, state inspection, time-travel rollback
- **Flexible control flows**: Sequential, parallel, hierarchical, conditional branching
- **Multi-LLM**: Model-agnostic via LangChain integrations (Claude, GPT-4, Bedrock, local)
- **MCP support**: First-class MCP server integration via `@langchain/langgraph-mcp`
- **Performance**: Fastest framework with lowest latency across benchmarks

**Weaknesses:**
- Steeper learning curve than CrewAI
- Graph abstraction requires upfront design thinking
- Documentation density can be overwhelming

**Production Pattern:**
```typescript
import { StateGraph, Annotation } from "@langchain/langgraph";
import { ChatAnthropic } from "@langchain/anthropic";

const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({ reducer: (a, b) => [...a, ...b] }),
  context: Annotation<Record<string, unknown>>(),
});

const workflow = new StateGraph(AgentState)
  .addNode("researcher", researcherAgent)
  .addNode("reviewer", reviewerAgent)
  .addNode("human_approval", humanApprovalNode)
  .addEdge("researcher", "reviewer")
  .addConditionalEdges("reviewer", shouldRequestApproval, {
    approve: "human_approval",
    revise: "researcher",
    complete: "__end__",
  });
```

**Confidence:** HIGH - GA 1.0 released October 2025, used in production by major companies.

**Sources:**
- [LangGraph Official Docs](https://docs.langchain.com/oss/javascript/langgraph/overview)
- [LangGraph GitHub](https://github.com/langchain-ai/langgraphjs)
- [AWS Blog: LangGraph + Bedrock](https://aws.amazon.com/blogs/machine-learning/build-multi-agent-systems-with-langgraph-and-amazon-bedrock/)

---

### 2. CrewAI

**Architecture:** Role-based crews with hierarchical task delegation.

**Key Strengths:**
- **Rapid prototyping**: Working multi-agent crew in under an hour
- **Intuitive mental model**: Agents have roles, goals, backstories
- **Excellent multi-LLM**: Native Anthropic, OpenAI, Bedrock via LiteLLM
- **Strong MCP support**: Bi-directional (consume and expose as MCP servers)
- **Flows + Crews**: High-level autonomy with event-driven control

**Weaknesses:**
- **Python only**: No TypeScript SDK (critical blocker for your team)
- **Limited graph control**: Loops and conditional branching feel hacky
- **No native checkpointing**: State management via task outputs only
- **Scaling concerns**: Long conversations can lose context

**When to Consider:**
- If team pivots to Python
- For quick prototypes before LangGraph implementation
- Content creation pipelines with clear role delegation

**Confidence:** HIGH for Python teams, NOT RECOMMENDED for TypeScript.

**Sources:**
- [CrewAI Official Docs](https://docs.crewai.com/)
- [CrewAI GitHub](https://github.com/crewAIInc/crewAI)
- [AWS Prescriptive Guidance: CrewAI](https://docs.aws.amazon.com/prescriptive-guidance/latest/agentic-ai-frameworks/crewai.html)

---

### 3. AWS Strands Agents (Strong Alternative)

**Architecture:** Model-driven, lightweight agent loop with Bedrock-first design.

**Key Strengths:**
- **Native TypeScript**: Full type safety, async/await, Zod schemas
- **AWS-native**: First-class Bedrock integration, but also supports OpenAI/Anthropic direct
- **Built-in MCP**: Model Context Protocol support out of the box
- **Lightweight**: Works in Node.js and browser environments
- **Production features**: Streaming, lifecycle hooks, conversation management

**Weaknesses:**
- **Preview status**: TypeScript SDK released December 2025
- **Less mature ecosystem**: Fewer examples and community resources
- **Simpler orchestration**: Not as sophisticated as LangGraph's graph model

**Best For:**
- Teams heavily invested in AWS Bedrock
- Simpler agent workflows without complex branching
- When you want native AWS integration without framework overhead

**Example:**
```typescript
import { Agent } from "@strands-agents/sdk";

const agent = new Agent({
  systemPrompt: "You are a code review assistant.",
  modelProvider: "bedrock", // or "openai", "anthropic"
});

const response = await agent.invoke("Review this PR...");
```

**Confidence:** MEDIUM - Preview, but AWS backing provides stability assurance.

**Sources:**
- [Strands Agents Docs](https://strandsagents.com/latest/)
- [Strands TypeScript SDK](https://github.com/strands-agents/sdk-typescript)
- [AWS Announcement](https://aws.amazon.com/about-aws/whats-new/2025/12/typescript-strands-agents-preview/)

---

### 4. AWS Bedrock Agents (Multi-Agent Collaboration)

**Architecture:** Managed supervisor-subagent hierarchy with routing modes.

**Key Strengths:**
- **Fully managed**: No infrastructure to deploy
- **Multi-agent GA**: Released March 2025
- **Inline agents**: Dynamic role/behavior adjustment at runtime
- **A2A protocol**: Cross-framework agent communication
- **AgentCore**: Policy controls, evaluations, enhanced memory

**Weaknesses:**
- **Vendor lock-in**: Bedrock models only for native agents
- **Less flexibility**: Managed service constraints
- **SDK-only TypeScript**: Not a framework, just API access

**Best For:**
- Enterprises wanting managed infrastructure
- When Bedrock models (Claude via Bedrock) are acceptable
- Teams without DevOps capacity for self-hosting

**Confidence:** HIGH - GA, but limited for multi-LLM requirements.

**Sources:**
- [Bedrock Multi-Agent Docs](https://docs.aws.amazon.com/bedrock/latest/userguide/agents-multi-agent-collaboration.html)
- [AWS Blog: Multi-Agent Intro](https://aws.amazon.com/blogs/aws/introducing-multi-agent-collaboration-capability-for-amazon-bedrock/)

---

### 5. Microsoft AutoGen / Agent Framework

**Architecture:** Event-driven messaging with AgentChat abstractions.

**Key Strengths:**
- **Enterprise-focused**: Robust error handling, enterprise governance
- **Cross-language**: Python and .NET support
- **Unified framework**: AutoGen + Semantic Kernel merged (October 2025)
- **MCP support**: Via McpWorkbench extension
- **AutoGen Studio**: No-code prototyping

**Weaknesses:**
- **Azure-centric**: Best experience with Azure OpenAI
- **No TypeScript SDK**: Python and .NET only
- **Complex architecture**: Core + AgentChat + Extensions layers
- **Still evolving**: GA 1.0 targeted Q1 2026

**Best For:**
- Microsoft/.NET shops
- Teams already on Azure
- Enterprise governance requirements

**Confidence:** MEDIUM - Active development, but not recommended for TypeScript/AWS stack.

**Sources:**
- [AutoGen Docs](https://microsoft.github.io/autogen/stable/)
- [Microsoft Agent Framework](https://learn.microsoft.com/en-us/agent-framework/)
- [Visual Studio Magazine: Agent Framework](https://visualstudiomagazine.com/articles/2025/10/01/semantic-kernel-autogen--open-source-microsoft-agent-framework.aspx)

---

### 6. Semantic Kernel

**Architecture:** Orchestration patterns (Sequential, Concurrent, GroupChat, Handoff).

**Key Strengths:**
- **Production foundations**: Thread-based state, telemetry, filters
- **Open standards**: MCP, A2A protocol, OpenAPI-first
- **Enterprise governance**: RBAC, auditability, lifecycle management
- **Unified interface**: Consistent API across orchestration patterns

**Weaknesses:**
- **Azure focus**: Best with Azure AI Foundry
- **No TypeScript**: .NET and Python SDKs only
- **Preview status**: GA 1.0 expected Q1 2026

**Confidence:** MEDIUM - Strong enterprise features but wrong language/cloud ecosystem.

**Sources:**
- [Semantic Kernel Agent Orchestration](https://learn.microsoft.com/en-us/semantic-kernel/frameworks/agent/agent-orchestration/)
- [Semantic Kernel GitHub](https://github.com/microsoft/semantic-kernel)

---

### 7. Roll Your Own with Primitives

**Approach:** Build custom orchestration using Vercel AI SDK + infrastructure primitives.

**Stack:**
| Component | Library | Purpose |
|-----------|---------|---------|
| LLM abstraction | Vercel AI SDK 6.0 | Provider-agnostic, streaming, tool calling |
| State machine | XState 5.x | Formal state machines with persistence |
| Job queue | BullMQ | Async task processing, retries |
| Event bus | EventEmitter / Redis Pub/Sub | Agent communication |
| MCP | @modelcontextprotocol/sdk | Tool integration |

**Key Strengths:**
- **Maximum control**: No framework constraints
- **Minimal dependencies**: Only what you need
- **Type safety**: End-to-end TypeScript
- **Vercel AI SDK**: 20M+ monthly downloads, production-proven

**Weaknesses:**
- **Build everything**: Checkpointing, HITL, debugging all custom
- **No community patterns**: Solve problems others have solved
- **Maintenance burden**: Own the entire stack

**When to Consider:**
- Simple single-agent workflows
- Unique orchestration patterns not supported by frameworks
- Team has deep distributed systems expertise

**Example with Vercel AI SDK:**
```typescript
import { Agent } from "ai";
import { anthropic } from "@ai-sdk/anthropic";

const codeReviewer = new Agent({
  model: anthropic("claude-sonnet-4-20250514"),
  instructions: "You review code for quality and security issues.",
  tools: [createPRComment, requestChanges, approvePR],
});

const result = await codeReviewer.run("Review PR #123");
```

**Confidence:** HIGH for simple cases, MEDIUM for complex multi-agent.

**Sources:**
- [Vercel AI SDK Docs](https://ai-sdk.dev/docs/introduction)
- [AI SDK 6 Announcement](https://vercel.com/blog/ai-sdk-6)
- [Vercel AI SDK GitHub](https://github.com/vercel/ai)

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| LangGraph.js | CrewAI | If team moves to Python; for quick prototypes |
| LangGraph.js | AWS Strands Agents | Simpler workflows; tighter Bedrock integration |
| LangGraph.js | Vercel AI SDK | Single-agent; maximum TypeScript control |
| LangGraph.js | n8n | Low-code team; visual workflow building |
| Self-hosted | AWS Bedrock Agents | No DevOps capacity; managed preference |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| CrewAI for production TypeScript | Python-only, no TypeScript SDK | LangGraph.js or Strands Agents |
| AutoGen for AWS deployment | Azure-centric, no TypeScript | LangGraph.js or Strands Agents |
| Raw LangChain (without LangGraph) | Linear chains lack state management | LangGraph.js for stateful agents |
| OpenAI Agents SDK alone | OpenAI-locked, limited multi-LLM | LangGraph.js for vendor flexibility |
| Building from scratch | "Valley of Death" - high failure rate prototype to production | Use established framework patterns |

---

## Stack Patterns by Use Case

**If building software development automation (Aesir's case):**
- Use LangGraph.js for orchestration
- Integrate Linear, GitHub, Slack via MCP servers
- Use BullMQ for webhook-driven async workflows
- Deploy on AWS ECS/Lambda with Redis for state

**If rapid prototyping before production:**
- Start with CrewAI (Python) for concept validation
- Migrate logic to LangGraph.js for TypeScript production
- This is a common industry pattern

**If AWS-native is critical:**
- Use AWS Strands Agents for agent logic
- Use Bedrock Agents for managed orchestration layer
- Combine with Step Functions for complex workflows

**If maximum control needed:**
- Use Vercel AI SDK 6.0 as LLM abstraction
- Build custom orchestration with XState + BullMQ
- Own the complexity, get full flexibility

---

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| @langchain/langgraph@1.0 | Node.js 18+ | LangGraph 1.0 stable API through v2.0 |
| @langchain/langgraph@1.0 | @langchain/core@0.3.x | Must use compatible LangChain core |
| @langchain/anthropic@0.3 | Claude 3.5/4 Opus/Sonnet | Full Claude model support |
| @strands-agents/sdk | Node.js 18+ | Preview - API may change |
| ai (Vercel)@6.0 | Node.js 18+ | Stable GA |

---

## MCP Integration Notes

MCP (Model Context Protocol) became the Linux Foundation standard in 2025. OpenAI adopted it in March 2025.

**For Aesir's tool integrations:**
- Build MCP servers for Linear, GitHub, Slack
- LangGraph.js has first-class MCP support via `@langchain/langgraph-mcp`
- CrewAI supports MCP via `MCPServerAdapter` (bi-directional)
- Strands Agents has built-in MCP support

**Pattern:**
```typescript
// MCP server discovery and tool integration
import { MCPClient } from "@modelcontextprotocol/sdk/client";

const linearMCP = new MCPClient({ transport: linearTransport });
const tools = await linearMCP.listTools();
// Tools become available to LangGraph agents
```

---

## Recommendation Summary

### For Aesir (TypeScript, AWS, Multi-LLM, Async Webhooks):

**Primary: LangGraph.js 1.0**
- Best balance of control, maturity, and TypeScript support
- Excellent multi-LLM via LangChain integrations
- Native MCP support for tool integration
- Built-in human-in-the-loop and checkpointing
- Production-proven at scale

**Secondary: AWS Strands Agents**
- Consider as LangGraph alternative if simpler orchestration suffices
- Better Bedrock integration out of the box
- Native TypeScript, good MCP support
- Watch for GA release (currently preview)

**For Prototyping: CrewAI (Python)**
- Use for rapid concept validation
- Plan to migrate to LangGraph.js for production

**Avoid:**
- CrewAI for production (Python-only)
- AutoGen/Semantic Kernel (Azure/.NET focus)
- Building from scratch (unless very simple workflows)

---

## Sources

### Official Documentation
- [LangGraph.js Docs](https://docs.langchain.com/oss/javascript/langgraph/overview) - Architecture, API reference (HIGH confidence)
- [CrewAI Docs](https://docs.crewai.com/) - Crews, Flows, LLM integrations (HIGH confidence)
- [AWS Strands Agents](https://strandsagents.com/latest/) - TypeScript SDK, quickstart (HIGH confidence)
- [AWS Bedrock Agents](https://docs.aws.amazon.com/bedrock/latest/userguide/agents-multi-agent-collaboration.html) - Multi-agent collaboration (HIGH confidence)
- [Vercel AI SDK](https://ai-sdk.dev/docs/introduction) - Agent abstraction, tools (HIGH confidence)
- [Microsoft Agent Framework](https://learn.microsoft.com/en-us/agent-framework/) - AutoGen + Semantic Kernel (MEDIUM confidence - evolving)

### Industry Analysis
- [DataCamp: CrewAI vs LangGraph vs AutoGen](https://www.datacamp.com/tutorial/crewai-vs-langgraph-vs-autogen) - Framework comparison (HIGH confidence)
- [Latenode: LangGraph Multi-Agent Guide 2025](https://latenode.com/blog/ai-frameworks-technical-infrastructure/langgraph-multi-agent-orchestration/) - Architecture analysis (MEDIUM confidence)
- [Turing: AI Agent Frameworks 2025](https://www.turing.com/resources/ai-agent-frameworks) - Market overview (MEDIUM confidence)
- [n8n: AI Agent Orchestration Frameworks](https://blog.n8n.io/ai-agent-orchestration-frameworks/) - Practical comparison (MEDIUM confidence)

### GitHub Repositories
- [LangGraph.js](https://github.com/langchain-ai/langgraphjs) - Source, examples (HIGH confidence)
- [CrewAI](https://github.com/crewAIInc/crewAI) - Source, issues (HIGH confidence)
- [Strands TypeScript SDK](https://github.com/strands-agents/sdk-typescript) - Source (HIGH confidence)
- [Vercel AI SDK](https://github.com/vercel/ai) - Source, examples (HIGH confidence)

---

*Stack research for: Agentic Development Platform / AI Agent Orchestration System*
*Researched: 2026-01-16*
