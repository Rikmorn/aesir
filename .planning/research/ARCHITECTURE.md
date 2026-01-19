# Architecture Research: v2.0 3-Layer Agentic Platform

**Domain:** Agentic Development Platform - Internal Tooling
**Researched:** 2026-01-19
**Overall Confidence:** HIGH (patterns well-established, MCP is industry standard)

## Executive Summary

This document outlines the architecture for restructuring Aesir into a 3-layer platform: Platform, Integrations, and Agents. The key architectural decision is **how agents communicate with integrations** - the recommendation is a **hybrid approach: MCP for LLM tool calls + internal TypeScript interfaces for direct service communication**.

MCP (Model Context Protocol) has become the industry standard for agent-to-tool communication in 2025-2026, adopted by OpenAI, Anthropic, Google, and all major frameworks. However, MCP is designed for LLM-initiated tool calls, not for all service-to-service communication. The architecture preserves direct TypeScript interfaces where appropriate.

## System Overview

```
                              EXTERNAL EVENTS
                    ┌─────────────┬─────────────┬─────────────┐
                    │   Linear    │   GitHub    │    Slack    │
                    │  Webhooks   │  Webhooks   │   Events    │
                    └──────┬──────┴──────┬──────┴──────┬──────┘
                           │             │             │
                           └─────────────┴─────────────┘
                                         │
┌────────────────────────────────────────┼────────────────────────────────────────┐
│                              PLATFORM LAYER                                      │
├──────────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐                  │
│  │  Event Gateway  │  │    Temporal     │  │   PostgreSQL    │                  │
│  │  (webhook rx,   │  │  (durable exec, │  │  (state store,  │                  │
│  │   validation)   │  │   activities)   │  │   checkpoints)  │                  │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘                  │
│           │                    │                    │                           │
│  ┌────────┴───────────────────┴───────────────────┴────────┐                   │
│  │                   Platform Services API                  │                   │
│  │  (secrets, config, observability, orchestration hooks)   │                   │
│  └──────────────────────────┬───────────────────────────────┘                   │
├─────────────────────────────┼───────────────────────────────────────────────────┤
│                    INTEGRATIONS LAYER                                            │
├─────────────────────────────┼───────────────────────────────────────────────────┤
│           ┌─────────────────┼─────────────────┐                                 │
│           │                 │                 │                                 │
│  ┌────────▼────────┐ ┌──────▼──────┐ ┌───────▼───────┐                         │
│  │  Linear Service │ │GitHub Service│ │ Slack Service │   (each independent,    │
│  │  ┌────────────┐ │ │┌────────────┐│ │┌────────────┐ │    own lifecycle,       │
│  │  │MCP Server  │ │ ││MCP Server  ││ ││MCP Server  │ │    swappable)           │
│  │  │(tools)     │ │ ││(tools)     ││ ││(tools)     │ │                         │
│  │  └────────────┘ │ │└────────────┘│ │└────────────┘ │                         │
│  │  ┌────────────┐ │ │┌────────────┐│ │┌────────────┐ │                         │
│  │  │Direct API  │ │ ││Direct API  ││ ││Direct API  │ │                         │
│  │  │(internal)  │ │ ││(internal)  ││ ││(internal)  │ │                         │
│  │  └────────────┘ │ │└────────────┘│ │└────────────┘ │                         │
│  │  ┌────────────┐ │ │┌────────────┐│ │┌────────────┐ │                         │
│  │  │Auth/Config │ │ ││Auth/Config ││ ││Auth/Config │ │                         │
│  │  └────────────┘ │ │└────────────┘│ │└────────────┘ │                         │
│  └─────────────────┘ └──────────────┘ └───────────────┘                         │
│           │                 │                 │                                 │
│           └─────────────────┴─────────────────┘                                 │
│                             │                                                   │
│                    ┌────────▼────────┐                                          │
│                    │  Integration    │ (normalized interface for agents)        │
│                    │  Protocol Layer │                                          │
│                    │  (MCP + Direct) │                                          │
│                    └────────┬────────┘                                          │
├─────────────────────────────┼───────────────────────────────────────────────────┤
│                       AGENTS LAYER                                               │
├─────────────────────────────┼───────────────────────────────────────────────────┤
│           ┌─────────────────┼─────────────────┐                                 │
│           │                 │                 │                                 │
│  ┌────────▼────────┐ ┌──────▼──────┐ ┌───────▼───────┐                         │
│  │  Product Agent  │ │  Dev Agent  │ │ Future Agents │                         │
│  │  ┌────────────┐ │ │┌────────────┐│ │               │                         │
│  │  │ LangGraph  │ │ ││ LangGraph  ││ │               │                         │
│  │  │ Workflow   │ │ ││ Workflow   ││ │               │                         │
│  │  └────────────┘ │ │└────────────┘│ │               │                         │
│  │  ┌────────────┐ │ │┌────────────┐│ │               │                         │
│  │  │MCP Client  │ │ ││MCP Client  ││ │               │                         │
│  │  │(tools)     │ │ ││(tools)     ││ │               │                         │
│  │  └────────────┘ │ │└────────────┘│ │               │                         │
│  └─────────────────┘ └──────────────┘ └───────────────┘                         │
├──────────────────────────────────────────────────────────────────────────────────┤
│                          OBSERVABILITY (cross-cutting)                           │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐                  │
│  │   Structured    │  │   LangSmith/    │  │    Metrics      │                  │
│  │   Logging       │  │   Tracing       │  │    (future)     │                  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘                  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

### Platform Layer

| Component | Responsibility | Implementation |
|-----------|----------------|----------------|
| **Event Gateway** | Receive webhooks, validate signatures, deduplicate, route to workflows | Express/Hono HTTP server |
| **Temporal** | Durable workflow execution, activity scheduling, retry policies | Temporal.io cluster |
| **PostgreSQL** | State persistence, LangGraph checkpoints, integration credentials | PostgreSQL 15+ |
| **Platform Services API** | Secrets access, configuration, orchestration hooks | Internal TypeScript module |
| **Observability** | Structured logging (pino), tracing (LangSmith), metrics | Cross-cutting concern |

### Integrations Layer

| Component | Responsibility | Implementation |
|-----------|----------------|----------------|
| **Linear Service** | All Linear API operations, OAuth token management, webhook handling | Independent service module |
| **GitHub Service** | All GitHub API operations (via Octokit), webhook handling | Independent service module |
| **Slack Service** | Bolt app, event handling, notifications, OAuth | Independent service module |
| **MCP Servers** | Expose integration capabilities as MCP tools for LLM use | @modelcontextprotocol/sdk |
| **Direct API** | TypeScript interfaces for non-LLM callers (Temporal activities, etc.) | Typed exports |
| **Auth/Config** | Per-integration credential management, config isolation | Scoped config module |

### Agents Layer

| Component | Responsibility | Implementation |
|-----------|----------------|----------------|
| **Product Agent** | Requirement gathering, task creation in Linear | LangGraph StateGraph |
| **Dev Agent** | Code generation, testing, PR creation | LangGraph StateGraph |
| **MCP Clients** | Connect to integration MCP servers for tool use | @modelcontextprotocol/sdk |
| **Agent Config** | LLM model selection, prompts, tool subsets | Config files |

## Recommended Project Structure

```
aesir/
├── packages/                        # Monorepo packages (pnpm workspaces)
│   │
│   ├── platform/                    # Platform Layer
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts             # Public API exports
│   │       ├── gateway/             # Event gateway (webhooks)
│   │       │   ├── index.ts
│   │       │   ├── router.ts        # Route webhooks to handlers
│   │       │   ├── validation.ts    # Signature verification
│   │       │   └── idempotency.ts   # Deduplication
│   │       ├── temporal/            # Temporal integration
│   │       │   ├── index.ts
│   │       │   ├── client.ts        # Temporal client factory
│   │       │   ├── worker.ts        # Worker configuration
│   │       │   └── activities/      # Shared activities
│   │       ├── state/               # State management
│   │       │   ├── index.ts
│   │       │   ├── checkpointer.ts  # LangGraph PostgreSQL checkpointer
│   │       │   └── migrations/      # DB migrations
│   │       ├── config/              # Configuration management
│   │       │   ├── index.ts
│   │       │   ├── loader.ts        # Config loading (dotenv-flow)
│   │       │   └── schema.ts        # Config validation (zod)
│   │       ├── secrets/             # Secrets management
│   │       │   ├── index.ts
│   │       │   └── provider.ts      # Secret provider interface
│   │       └── observability/       # Logging, tracing, metrics
│   │           ├── index.ts
│   │           ├── logger.ts        # pino logger
│   │           ├── tracing.ts       # LangSmith/OpenTelemetry
│   │           └── context.ts       # Correlation IDs
│   │
│   ├── integrations/                # Integrations Layer
│   │   │
│   │   ├── linear/                  # Linear integration (independent package)
│   │   │   ├── package.json
│   │   │   └── src/
│   │   │       ├── index.ts         # Public API
│   │   │       ├── client.ts        # LinearClient factory
│   │   │       ├── auth.ts          # OAuth token management
│   │   │       ├── issues.ts        # Issue operations
│   │   │       ├── webhooks.ts      # Webhook handlers
│   │   │       ├── types.ts         # Linear-specific types
│   │   │       ├── mcp-server.ts    # MCP server exposing Linear tools
│   │   │       └── activities.ts    # Temporal activities (thin wrapper)
│   │   │
│   │   ├── github/                  # GitHub integration (independent package)
│   │   │   ├── package.json
│   │   │   └── src/
│   │   │       ├── index.ts
│   │   │       ├── client.ts        # Octokit factory
│   │   │       ├── auth.ts          # Token management
│   │   │       ├── branches.ts
│   │   │       ├── commits.ts
│   │   │       ├── pull-requests.ts
│   │   │       ├── webhooks.ts
│   │   │       ├── types.ts
│   │   │       ├── mcp-server.ts    # MCP server exposing GitHub tools
│   │   │       └── activities.ts
│   │   │
│   │   ├── slack/                   # Slack integration (independent package)
│   │   │   ├── package.json
│   │   │   └── src/
│   │   │       ├── index.ts
│   │   │       ├── app.ts           # Bolt app setup
│   │   │       ├── auth.ts          # OAuth
│   │   │       ├── notifications.ts
│   │   │       ├── assistant.ts     # Slack assistant handler
│   │   │       ├── types.ts
│   │   │       ├── mcp-server.ts    # MCP server exposing Slack tools
│   │   │       └── activities.ts
│   │   │
│   │   └── shared/                  # Shared integration utilities
│   │       ├── package.json
│   │       └── src/
│   │           ├── index.ts
│   │           ├── mcp-utils.ts     # MCP server helpers
│   │           └── types.ts         # Common integration types
│   │
│   ├── agents/                      # Agents Layer
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts             # Public API
│   │       ├── product-agent/       # Product Agent
│   │       │   ├── index.ts
│   │       │   ├── graph.ts         # LangGraph StateGraph
│   │       │   ├── state.ts         # Agent state definition
│   │       │   ├── prompts.ts       # System prompts
│   │       │   ├── tools.ts         # MCP tool configuration
│   │       │   └── nodes/           # Graph nodes
│   │       ├── dev-agent/           # Dev Agent
│   │       │   ├── index.ts
│   │       │   ├── graph.ts
│   │       │   ├── state.ts
│   │       │   ├── prompts.ts
│   │       │   ├── tools.ts
│   │       │   └── nodes/
│   │       └── shared/              # Shared agent utilities
│   │           ├── base-agent.ts    # Base agent patterns
│   │           ├── mcp-client.ts    # MCP client setup
│   │           └── llm-client.ts    # Multi-LLM abstraction
│   │
│   └── sandbox/                     # Code execution sandbox
│       ├── package.json
│       └── src/
│           ├── index.ts
│           ├── docker-sandbox.ts
│           └── types.ts
│
├── apps/                            # Deployable applications
│   ├── api/                         # Main API server
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts             # Server entry
│   │       └── routes/              # HTTP routes
│   │
│   └── worker/                      # Temporal worker
│       ├── package.json
│       └── src/
│           ├── index.ts
│           └── workflows/           # Workflow definitions
│
├── docker-compose.yml               # Local development
├── pnpm-workspace.yaml              # Workspace configuration
├── tsconfig.base.json               # Shared TypeScript config
└── biome.json                       # Linting/formatting
```

### Structure Rationale

**Why monorepo with pnpm workspaces:**
- Each integration is truly independent (own package.json, own dependencies)
- Clear dependency direction enforced by package boundaries
- Integrations can be versioned and deployed independently
- TypeScript project references enable incremental builds
- pnpm is fastest package manager, handles workspaces well

**Why packages/integrations/{service} structure:**
- Each integration has own lifecycle (key v2.0 requirement)
- Can be swapped at runtime (e.g., GitHub -> GitLab)
- Credentials and config isolated per integration
- MCP server colocated with integration logic
- Testing can be done in isolation

**Why separate apps/ from packages/:**
- packages/ are libraries (reusable)
- apps/ are deployable (entry points)
- Clear distinction supports different deployment targets
- Worker and API can scale independently

## Architectural Patterns

### Pattern 1: MCP for LLM Tool Calls (Recommended)

**What:** Agents use MCP clients to invoke tools on integration MCP servers. The LLM decides which tools to call based on MCP tool definitions.

**When:** Any time an LLM needs to interact with an external service (read issues, create PRs, send messages).

**Why this is now the standard:**
- MCP is industry standard (OpenAI, Anthropic, Google, LangChain all adopted)
- Tool definitions are structured (JSON Schema) - LLMs understand them
- Built-in security model (consent, permission boundaries)
- Ecosystem of tools already exists
- Future-proof: agent-to-agent communication via MCP coming in 2026

**Confidence:** HIGH - MCP is the clear winner, OpenAI deprecated Assistants API in favor of MCP.

**Example:**

```typescript
// packages/integrations/linear/src/mcp-server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server";
import { z } from "zod";
import { createIssue, updateIssueStatus } from "./issues.js";

export function createLinearMcpServer(client: LinearClient) {
  const server = new McpServer({ name: "linear", version: "1.0.0" });

  server.tool(
    "linear_create_issue",
    "Create a new issue in Linear",
    {
      teamId: z.string().describe("Team ID"),
      title: z.string().describe("Issue title"),
      description: z.string().optional().describe("Issue description"),
      priority: z.number().min(0).max(4).optional(),
    },
    async (params) => {
      const result = await createIssue(client, params);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    "linear_update_status",
    "Update issue status",
    {
      issueId: z.string(),
      status: z.enum(["Todo", "In Progress", "Done", "Cancelled"]),
    },
    async (params) => {
      await updateIssueStatus(client, params.issueId, params.status);
      return { content: [{ type: "text", text: "Status updated" }] };
    }
  );

  return server;
}
```

```typescript
// packages/agents/src/product-agent/tools.ts
import { Client } from "@modelcontextprotocol/sdk/client";

export async function connectToLinear(): Promise<Client> {
  const client = new Client({ name: "product-agent" });
  // Connect via stdio or HTTP depending on deployment
  await client.connect(transport);
  return client;
}
```

### Pattern 2: Direct TypeScript Interfaces for Non-LLM Calls

**What:** Temporal activities and other non-LLM code use direct TypeScript imports from integration packages.

**When:** When a workflow or activity needs to call an integration without LLM involvement (e.g., updating status after PR merge).

**Why:** MCP adds overhead (JSON-RPC, serialization) that's unnecessary for direct service-to-service calls. TypeScript interfaces provide type safety and are simpler.

**Confidence:** HIGH - This is standard software architecture.

**Example:**

```typescript
// packages/platform/src/temporal/activities/integration-activities.ts
import { updateIssueStatus } from "@aesir/linear";
import { mergePullRequest } from "@aesir/github";

// Activities use direct imports - no MCP overhead
export async function updateLinearStatus(
  issueId: string,
  status: IssueStatus
): Promise<void> {
  const client = await getLinearClient(); // From secrets/config
  await updateIssueStatus(client, issueId, status);
}

export async function mergeGitHubPR(
  owner: string,
  repo: string,
  prNumber: number
): Promise<{ sha: string }> {
  const octokit = await getOctokit();
  return mergePullRequest(octokit, owner, repo, prNumber);
}
```

### Pattern 3: Dependency Injection via Factory Functions

**What:** Integration clients are created via factory functions that receive dependencies (config, secrets, logger).

**When:** Everywhere. Every integration client should be created via factory.

**Why:**
- Testability (inject mocks)
- Configuration isolation
- Credential management centralized
- No global state

**Confidence:** HIGH - This is already partially implemented in v1.

**Example:**

```typescript
// packages/integrations/linear/src/client.ts
export interface LinearClientDeps {
  config: LinearConfig;
  secrets: SecretsProvider;
  logger: Logger;
}

export async function createLinearClient(deps: LinearClientDeps): Promise<LinearClient> {
  const { accessToken, refreshToken, expiresAt } = await deps.secrets.get("linear");

  if (isTokenExpiring(expiresAt)) {
    const newTokens = await refreshOAuthToken(refreshToken, deps.config);
    await deps.secrets.set("linear", newTokens);
    return new LinearClient({ accessToken: newTokens.accessToken });
  }

  return new LinearClient({ accessToken });
}
```

### Pattern 4: Event-Driven Webhook Processing

**What:** Webhooks are received, validated, and queued for async processing. Temporal workflows handle the actual work.

**When:** All webhook handling.

**Why:**
- Webhook sources (GitHub, Linear, Slack) have timeout expectations
- Async processing prevents lost events
- Idempotency keys handle retries
- Temporal provides durability

**Confidence:** HIGH - Already implemented in v1, proven pattern.

**Example:**

```typescript
// packages/platform/src/gateway/router.ts
import { TemporalClient } from "../temporal/client.js";

export async function handleLinearWebhook(req: Request): Promise<Response> {
  // 1. Validate signature
  if (!verifyLinearSignature(req)) {
    return new Response("Invalid signature", { status: 401 });
  }

  // 2. Check idempotency
  const eventId = req.headers.get("x-linear-event-id");
  if (await isDuplicate(eventId)) {
    return new Response("Already processed", { status: 200 });
  }

  // 3. Start Temporal workflow (async)
  const temporal = await getTemporalClient();
  await temporal.workflow.start("handleLinearEvent", {
    taskQueue: "aesir-main",
    workflowId: `linear-${eventId}`,
    args: [await req.json()],
  });

  // 4. Acknowledge immediately
  return new Response("OK", { status: 200 });
}
```

### Pattern 5: LangGraph + Temporal Hybrid

**What:** LangGraph handles the agent reasoning loop (LLM calls, tool use). Temporal handles durable orchestration (human-in-loop, cross-service coordination).

**When:** This is the overall architecture - not one or the other.

**Why:**
- LangGraph is excellent for agent logic (graph-based, checkpointing, tool integration)
- Temporal is excellent for long-running workflows (days for human approval)
- They complement each other
- LangGraph activities run inside Temporal activities

**Confidence:** HIGH - This pattern is explicitly recommended by both LangChain and Temporal.

**Example:**

```typescript
// apps/worker/src/workflows/dev-workflow.ts
import { proxyActivities } from "@temporalio/workflow";
import type { DevWorkflowActivities } from "../activities.js";

const { runDevAgent, updateLinearStatus, notifySlack } = proxyActivities<DevWorkflowActivities>({
  startToCloseTimeout: "30m",
  retry: { maximumAttempts: 3 },
});

export async function devWorkflow(issueId: string): Promise<void> {
  // Update Linear status
  await updateLinearStatus(issueId, "In Progress");

  // Run LangGraph agent (inside Temporal activity for durability)
  const result = await runDevAgent({ issueId });

  if (result.success) {
    await updateLinearStatus(issueId, "In Review");
    await notifySlack(`PR created: ${result.prUrl}`);
  } else {
    await updateLinearStatus(issueId, "Blocked");
    await notifySlack(`Dev agent failed: ${result.error}`);
  }
}
```

## Anti-Patterns to Avoid

### Anti-Pattern 1: MCP for Everything

**What people do:** Use MCP for all service-to-service communication, even non-LLM code.

**Why it's wrong:** MCP adds JSON-RPC overhead, designed for LLM tool use. Direct function calls are simpler and faster for internal code.

**Do instead:** Use MCP for LLM tool calls. Use direct TypeScript imports for activities and non-LLM code.

### Anti-Pattern 2: Mixing Integration Logic with Agent Logic

**What people do:** Put Linear API calls directly in agent nodes.

**Why it's wrong:** Couples agents to specific integrations. Makes testing hard. Prevents integration swapping.

**Do instead:** Agents call integration tools via MCP. Integration logic lives in integration packages.

### Anti-Pattern 3: Shared Global Clients

**What people do:** Create a single LinearClient at startup and reuse everywhere.

**Why it's wrong:** Token refresh becomes global state. Testing requires global mocking. Credential rotation is unsafe.

**Do instead:** Factory functions create clients on demand. Pass clients as dependencies.

### Anti-Pattern 4: Integration Packages Depending on Each Other

**What people do:** Linear package imports from GitHub package.

**Why it's wrong:** Creates coupling between integrations. Prevents independent deployment.

**Do instead:** If integrations need to coordinate, do it at the platform or agent layer. Integration packages only depend on platform packages.

## Data Flow

### Agent Tool Call Flow (via MCP)

```
┌─────────────────┐
│    LLM         │ "I need to create an issue in Linear"
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  LangGraph     │ Receives tool call request
│  Agent Node    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  MCP Client    │ JSON-RPC request: linear_create_issue
│  (in agent)    │
└────────┬────────┘
         │ (stdio or HTTP transport)
         ▼
┌─────────────────┐
│  MCP Server    │ Receives tool call
│  (Linear pkg)  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Linear Client  │ createIssue(client, params)
│ (direct call)  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Linear API    │ REST API call
└────────┬────────┘
         │
         ▼
   (result flows back through same path)
```

### Webhook Processing Flow

```
┌─────────────────┐
│ GitHub Webhook │ PR approved event
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Event Gateway  │ Validate signature, check idempotency
│ (platform)     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Temporal       │ Start/signal workflow
│ Client         │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Temporal       │ Execute workflow
│ Workflow       │
└────────┬────────┘
         │
         ├──────────────────────────────┐
         ▼                              ▼
┌─────────────────┐          ┌─────────────────┐
│ Activity:      │          │ Activity:       │
│ mergeGitHubPR  │          │ updateLinear    │
│ (direct call)  │          │ (direct call)   │
└────────┬────────┘          └────────┬────────┘
         │                            │
         ▼                            ▼
┌─────────────────┐          ┌─────────────────┐
│ @aesir/github  │          │ @aesir/linear   │
│ package        │          │ package         │
└─────────────────┘          └─────────────────┘
```

## Integration Points

### Layer Communication

| From | To | Mechanism | Why |
|------|------|-----------|-----|
| Agents | Integrations | MCP (for LLM tool calls) | Standardized, LLM-friendly |
| Agents | Integrations | Direct import (for setup) | Type safety, no overhead |
| Temporal | Integrations | Direct import (activities) | Type safety, no overhead |
| Gateway | Temporal | Temporal client API | Workflow signaling |
| Integrations | Platform | Direct import | Config, secrets, logging |

### External Service Integration

| Service | Inbound | Outbound |
|---------|---------|----------|
| Linear | Webhooks -> Gateway -> Temporal | LinearClient (SDK) |
| GitHub | Webhooks -> Gateway -> Temporal | Octokit (SDK) |
| Slack | Events API -> Gateway -> Temporal | Bolt app + Web API |

### MCP Transport Options

| Environment | Transport | Reason |
|-------------|-----------|--------|
| Local dev (single process) | stdio | Simplest, no network |
| Local dev (multi-process) | HTTP (localhost) | Service isolation |
| Containerized | HTTP (internal network) | Container boundaries |
| Future: remote integrations | HTTP (over tunnel) | External MCP servers |

## Suggested Build Order

Based on dependency analysis, implement in this order:

### Phase 1: Platform Foundation
1. **pnpm workspace setup** - Monorepo structure, tsconfig.base.json
2. **packages/platform/observability** - Logger (pino), tracing setup
3. **packages/platform/config** - dotenv-flow, config schema
4. **packages/platform/secrets** - Secret provider interface

*Rationale: Everything depends on logging, config, and secrets.*

### Phase 2: Integration Independence
5. **packages/integrations/shared** - Common integration types
6. **packages/integrations/linear** - Extract Linear integration
7. **packages/integrations/github** - Extract GitHub integration
8. **packages/integrations/slack** - Extract Slack integration

*Rationale: Each integration becomes independent package. MCP servers can be added incrementally.*

### Phase 3: MCP Layer
9. **MCP servers** - Add mcp-server.ts to each integration
10. **packages/agents/shared/mcp-client** - Agent MCP client setup

*Rationale: MCP layer builds on working integrations.*

### Phase 4: Platform Services
11. **packages/platform/gateway** - Webhook routing
12. **packages/platform/temporal** - Temporal client, activities
13. **packages/platform/state** - Checkpointer, state management

*Rationale: Platform services use integrations and observability.*

### Phase 5: Agent Migration
14. **packages/agents/product-agent** - Migrate with MCP tools
15. **packages/agents/dev-agent** - Migrate with MCP tools

*Rationale: Agents use MCP layer and platform services.*

### Phase 6: Applications
16. **apps/api** - HTTP server
17. **apps/worker** - Temporal worker

*Rationale: Apps compose packages into deployables.*

## Open Questions for Phase-Specific Research

1. **MCP transport for containers:** Should each integration MCP server run in its own container, or embed in the worker?
2. **Integration swapping mechanism:** Runtime registry or build-time selection?
3. **Multi-tenant credentials:** How to handle multiple Linear workspaces?
4. **MCP security boundaries:** Should agents have different tool subsets?

## Sources

### MCP (Model Context Protocol)
- [MCP Specification 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25) - Official specification
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) - Official implementation
- [Anthropic MCP Introduction](https://www.anthropic.com/news/model-context-protocol) - Protocol rationale
- [A Year of MCP: 2025 Review](https://www.pento.ai/blog/a-year-of-mcp-2025-review) - Ecosystem adoption
- [Thoughtworks MCP Impact 2025](https://www.thoughtworks.com/en-us/insights/blog/generative-ai/model-context-protocol-mcp-impact-2025) - Industry analysis

### Architecture Patterns
- [Google Cloud Agentic AI Design Patterns](https://cloud.google.com/architecture/choose-design-pattern-agentic-ai-system) - Pattern selection guide
- [Salesforce Enterprise Agentic Architecture](https://architect.salesforce.com/fundamentals/enterprise-agentic-architecture) - Enterprise patterns
- [Temporal for Agentic AI (Grid Dynamics)](https://temporal.io/blog/prototype-to-prod-ready-agentic-ai-grid-dynamics) - LangGraph + Temporal case study

### TypeScript Architecture
- [Clean Architecture Node.js TypeScript](https://dev.to/evangunawan/clean-architecture-in-nodejs-an-approach-with-typescript-and-dependency-injection-16o) - DI patterns
- [TypeScript Monorepo Guide](https://dev.to/mxro/the-ultimate-guide-to-typescript-monorepos-5ap7) - Workspace patterns
- [Feature-Sliced Design Monorepo 2025](https://feature-sliced.design/blog/frontend-monorepo-explained) - Modern structure

### LangGraph
- [LangGraph 1.0 Announcement](https://www.blog.langchain.com/langchain-langgraph-1dot0/) - Production features
- [LangGraph Multi-Agent Guide 2025](https://latenode.com/blog/langgraph-ai-framework-2025-complete-architecture-guide-multi-agent-orchestration-analysis) - Architecture guide

---
*Architecture research for: Aesir v2.0 Foundation*
*Researched: 2026-01-19*
