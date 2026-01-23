# Phase 19: MCP Layer - Research

**Researched:** 2026-01-23
**Domain:** Model Context Protocol (MCP) server implementation for integration tool exposure
**Confidence:** HIGH

## Summary

Model Context Protocol (MCP) is an open standard introduced by Anthropic in November 2024, donated to the Agentic AI Foundation (under Linux Foundation) in December 2025. MCP standardizes how AI systems integrate with external tools and data sources using JSON-RPC 2.0 messaging. The protocol has matured rapidly with the current specification dated November 25, 2025.

For this phase, we need to add MCP servers to each extracted integration (Linear, GitHub, Slack) to expose their operations as standardized tools that agents can discover and invoke. The research confirms the user's technical decisions in CONTEXT.md align with MCP best practices and current ecosystem standards.

**Primary recommendation:** Use fine-grained tools with normalized domain objects, embedded MCP servers (HTTP/SSE transport) in existing integration services, database-backed permissions, and comprehensive correlation ID logging. The official TypeScript SDK v1.x provides production-ready middleware for Express integration.

## Standard Stack

The established libraries/tools for MCP server implementation in TypeScript/Node.js:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @modelcontextprotocol/sdk | 1.x (v2 Q1 2026) | Official MCP TypeScript SDK | Anthropic-maintained, implements full MCP spec, split packages for server/client |
| zod | 3.25+ | Schema validation | Peer dependency of MCP SDK, already used in Aesir |
| @modelcontextprotocol/express | Latest | Express middleware | Official middleware for Express integration |
| @modelcontextprotocol/node | Latest | Node.js HTTP transport | Streamable HTTP/SSE transport wrapper |

**Note:** v1.x is recommended for production use until v2 stabilizes in Q1 2026. v1.x will receive bug fixes and security updates for at least 6 months after v2 release.

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| express | Already installed | HTTP server | Already used in all integrations (ports 3001, 3002, 3003) |
| pino | Already installed | Structured logging | Already standardized across Aesir for correlation IDs |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| HTTP/SSE transport | stdio transport | stdio only works for local processes; HTTP/SSE enables remote agent connections |
| Official SDK | Custom JSON-RPC | Custom implementation loses protocol compliance, harder to maintain |
| Embedded servers | Standalone MCP services | Standalone services duplicate database connections, credentials; embedded shares infrastructure |

**Installation:**
```bash
pnpm add @modelcontextprotocol/sdk@1 zod@3 --filter @aesir/integration-linear
pnpm add @modelcontextprotocol/express --filter @aesir/integration-linear
pnpm add @modelcontextprotocol/node --filter @aesir/integration-linear
# Repeat for github and slack packages
```

## Architecture Patterns

### Recommended Project Structure (Per Integration)
```
packages/integrations/linear/src/
├── mcp/
│   ├── server.ts        # MCP server factory with tool registration
│   ├── tools/           # Tool implementations
│   │   ├── issues.ts    # get_issue, create_issue, update_issue_status
│   │   ├── teams.ts     # list_teams
│   │   └── labels.ts    # list_labels
│   ├── schemas.ts       # Zod input/output schemas for tools
│   ├── permissions.ts   # Database-backed permission checker
│   └── index.ts         # Barrel export
├── api/
│   └── routes.ts        # Add /mcp/* endpoints
└── db/
    └── schema.ts        # Add mcp_tool_permissions table
```

**Database Schema Addition (per integration schema):**
```typescript
// Example for linear.mcp_tool_permissions
export const mcpToolPermissions = pgTable('linear.mcp_tool_permissions', {
  id: prefixedId('mcp_perm'),
  agentId: varchar('agent_id', { length: 255 }).notNull(), // e.g., 'dev-agent', 'product-agent'
  toolName: varchar('tool_name', { length: 255 }).notNull(), // e.g., 'create_issue', 'update_issue_status'
  allowed: boolean('allowed').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  pk: primaryKey({ columns: [table.agentId, table.toolName] }),
}));
```

### Pattern 1: MCP Server Factory with Express Integration
**What:** Create MCP server instance, register tools, mount on Express routes
**When to use:** Embedding MCP server in existing HTTP service

**Example:**
```typescript
// Source: Official TypeScript SDK examples + Express middleware patterns
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import express from 'express';

interface CreateMCPServerOptions {
  db: PostgresJsDatabase;
  logger: PinoLogger;
  integration: 'linear' | 'github' | 'slack';
}

export function createMCPServer(options: CreateMCPServerOptions) {
  const { db, logger, integration } = options;

  const server = new Server(
    {
      name: `${integration}-mcp-server`,
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {
          listChanged: true, // Notify clients when tools change
        },
      },
    }
  );

  // Register tools (pattern shown in next section)
  registerTools(server, { db, logger });

  // Create Express router for MCP endpoints
  const router = express.Router();

  // Mount MCP endpoints
  router.post('/mcp/tools', async (req, res) => {
    const correlationId = req.headers['x-correlation-id'] as string;
    logger.child({ correlationId }).info('MCP tools list request');

    const transport = new StreamableHTTPServerTransport();
    await transport.handleRequest(req, res, server);
  });

  router.post('/mcp/tools/:name', async (req, res) => {
    const correlationId = req.headers['x-correlation-id'] as string;
    const toolName = req.params.name;

    logger.child({ correlationId, toolName }).info('MCP tool invocation');

    const transport = new StreamableHTTPServerTransport();
    await transport.handleRequest(req, res, server);
  });

  return router;
}
```

### Pattern 2: Fine-Grained Tool Registration
**What:** One tool per operation, focused on single responsibility
**When to use:** Always — research shows fine-grained tools improve LLM tool selection accuracy

**Example:**
```typescript
// Source: MCP specification + LLM tool calling best practices
import { z } from 'zod';

// Input schema
const GetIssueSchema = z.object({
  issueId: z.string().describe('Linear issue ID (e.g., ABC-123)'),
});

// Output schema (normalized domain object)
const IssueSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  status: z.string(),
  assignee: z.string().optional(),
  url: z.string().url(),
});

server.tool({
  name: 'get_issue',
  description: 'Retrieve details about a Linear issue. Use this when you need to check issue status, read description, or see who is assigned.',
  inputSchema: zodToJsonSchema(GetIssueSchema),
  outputSchema: zodToJsonSchema(IssueSchema),
}, async ({ issueId }, { logger, correlationId }) => {
  // Permission check (database-backed)
  const permitted = await checkPermission(db, {
    agentId: req.headers['x-agent-id'],
    toolName: 'get_issue',
  });

  if (!permitted) {
    return {
      content: [{ type: 'text', text: 'Permission denied: get_issue' }],
      isError: true,
    };
  }

  // Fetch issue (existing client code)
  const issue = await readIssue(client, issueId);

  // Return normalized domain object
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          id: issue.id,
          title: issue.title,
          description: issue.description,
          status: issue.state.name,
          assignee: issue.assignee?.name,
          url: issue.url,
        }),
      },
    ],
    structuredContent: {
      id: issue.id,
      title: issue.title,
      description: issue.description,
      status: issue.state.name,
      assignee: issue.assignee?.name,
      url: issue.url,
    },
    meta: {
      duration_ms: Date.now() - startTime,
      correlation_id: correlationId,
    },
  };
});
```

### Pattern 3: Database-Backed Permissions
**What:** Store agent-to-tool permissions in PostgreSQL, check on every invocation
**When to use:** Always — enables runtime permission changes without redeployment

**Example:**
```typescript
// Source: MCP authorization best practices + Aesir factory pattern
interface CheckPermissionOptions {
  agentId: string;
  toolName: string;
}

export async function checkPermission(
  db: PostgresJsDatabase,
  options: CheckPermissionOptions
): Promise<boolean> {
  const { agentId, toolName } = options;

  const [permission] = await db
    .select()
    .from(mcpToolPermissions)
    .where(
      and(
        eq(mcpToolPermissions.agentId, agentId),
        eq(mcpToolPermissions.toolName, toolName)
      )
    );

  return permission?.allowed ?? false; // Default deny
}
```

### Pattern 4: Correlation ID Propagation
**What:** Extract correlation ID from headers, propagate to all logs and downstream calls
**When to use:** Always — already standardized in Aesir observability (Phase 12)

**Example:**
```typescript
// Source: Aesir Phase 12 patterns + distributed tracing best practices
router.post('/mcp/tools/:name', async (req, res) => {
  const correlationId = req.headers['x-correlation-id'] as string || generateCorrelationId();
  const toolName = req.params.name;
  const startTime = Date.now();

  const childLogger = logger.child({
    correlationId,
    toolName,
    component: 'mcp',
  });

  childLogger.info({ input: req.body }, 'Tool invocation started');

  try {
    // Handle tool invocation
    const result = await handleToolCall(/* ... */);

    childLogger.info(
      {
        duration_ms: Date.now() - startTime,
        success: !result.isError,
      },
      'Tool invocation completed'
    );

    res.json(result);
  } catch (error) {
    childLogger.error({ err: error, duration_ms: Date.now() - startTime }, 'Tool invocation failed');
    throw error;
  }
});
```

### Anti-Patterns to Avoid
- **Coarse-grained tools**: "process_linear_issue" that does create/read/update in one tool — makes LLM tool selection harder, violates single responsibility
- **Raw API responses**: Returning full Linear/GitHub API responses — include nested objects LLM doesn't need, format varies by API version
- **Composite tools**: "create_issue_and_pr" spanning Linear + GitHub — violates integration isolation, orchestration belongs at agent level
- **Global singletons**: Shared MCP server instance — prevents per-integration configuration, breaks factory pattern
- **Protocol-level errors for tool failures**: Using JSON-RPC error codes for business logic failures — prevents LLM from seeing and handling errors

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON-RPC 2.0 message handling | Custom request parser | @modelcontextprotocol/sdk Server class | Protocol compliance, capability negotiation, lifecycle management |
| HTTP/SSE transport | Custom streaming response | @modelcontextprotocol/node StreamableHTTPServerTransport | Handles SSE connection lifecycle, chunking, reconnection |
| Tool schema validation | Manual JSON Schema | zodToJsonSchema + Zod schemas | Type-safe at compile time, runtime validation, auto-generated JSON Schema |
| Correlation ID generation | UUID v4 | Existing generateCorrelationId() from @aesir/platform | Already standardized in Phase 12, consistent format |
| Permission storage | In-memory Map | PostgreSQL table + factory service | Runtime changes, audit trail, survives restarts |
| Rate limiting | Custom token bucket | Express rate-limit middleware | Battle-tested, configurable, supports distributed (Redis) |

**Key insight:** MCP protocol has subtle requirements (capability negotiation, list_changed notifications, structured content formats) that are easy to get wrong in custom implementations. The official SDK handles these correctly and is actively maintained by Anthropic.

## Common Pitfalls

### Pitfall 1: Treating Tool Errors as Protocol Errors
**What goes wrong:** Returning JSON-RPC error codes (-32600, -32602) for business logic failures like "issue not found" or "permission denied"
**Why it happens:** Confusion between protocol-level errors (invalid JSON, unknown method) and tool execution errors
**How to avoid:**
- Use `isError: true` in tool result for recoverable failures
- Reserve protocol errors for schema violations and unknown tools
- Return structured error messages in result.content that LLM can read
**Warning signs:** LLM can't see error messages, can't adapt to failures

### Pitfall 2: Raw API Response Leakage
**What goes wrong:** Returning full GitHub/Linear API response objects with 50+ fields the LLM doesn't need
**Why it happens:** Seems faster to just return `JSON.stringify(apiResponse)` than mapping to normalized object
**How to avoid:**
- Define explicit output schemas with only necessary fields
- Map API responses to normalized domain objects
- Consider split: LLM tools return normalized objects, internal debugging tools return raw responses
**Warning signs:** LLM confused by extra fields, token usage spikes, context window fills up

### Pitfall 3: Permission Check After Execution
**What goes wrong:** Checking permissions after calling the underlying API, leaking data or creating side effects
**Why it happens:** Easier to add permission check as afterthought
**How to avoid:**
- Check permissions FIRST, before any database/API calls
- Return early with isError: true if denied
- Log permission denials with agent ID and tool name
**Warning signs:** Audit logs show successful API calls followed by permission errors

### Pitfall 4: Missing Correlation ID Propagation
**What goes wrong:** MCP tool calls logged without correlation IDs, can't trace request through agent → integration → Linear API
**Why it happens:** Forgetting to extract and propagate X-Correlation-ID header
**How to avoid:**
- Extract correlation ID in Express middleware or route handler
- Pass to child logger, all database calls, all API calls
- Include in tool result metadata
**Warning signs:** Logs show tool calls but can't link to originating agent execution

### Pitfall 5: Overly Coarse Tools
**What goes wrong:** Creating tools like "manage_issue" that take action: "create" | "update" | "delete" parameter
**Why it happens:** Seems DRY-er to combine similar operations
**How to avoid:**
- One tool per operation: create_issue, update_issue_status, delete_issue
- Simpler LLM tool selection (no need to choose action parameter)
- Clearer permission boundaries (allow create but not delete)
**Warning signs:** Tool descriptions become long and complex, LLM struggles to pick right action parameter

### Pitfall 6: Network Isolation Assumptions
**What goes wrong:** Assuming Docker internal network means zero authentication needed
**Why it happens:** CONTEXT.md says "trust connections from internal Docker network"
**How to avoid:**
- Still validate X-Agent-ID header to identify caller
- Check agent-to-tool permissions in database
- Network isolation is defense-in-depth, not replacement for authorization
**Warning signs:** Agents can call any tool regardless of configured permissions

### Pitfall 7: Synchronous Blocking on Long Operations
**What goes wrong:** Tools like "get_large_pr_diff" block HTTP response until 10MB diff is fetched
**Why it happens:** Not considering timeout and streaming implications
**How to avoid:**
- Set per-tool timeouts (e.g., 30s for large operations)
- Use SSE streaming for large responses
- Consider pagination for list operations
**Warning signs:** Tool calls timeout, agents get stuck waiting

## Code Examples

Verified patterns from official sources:

### Linear Tool: create_issue
```typescript
// Source: MCP tools specification + Linear SDK
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

const CreateIssueInputSchema = z.object({
  teamId: z.string().describe('Linear team ID (get from list_teams)'),
  title: z.string().min(1).describe('Issue title'),
  description: z.string().optional().describe('Issue description in markdown'),
  priority: z.enum(['urgent', 'high', 'medium', 'low']).optional(),
  labelIds: z.array(z.string()).optional().describe('Array of label IDs (get from list_labels)'),
});

const CreateIssueOutputSchema = z.object({
  issueId: z.string(),
  issueNumber: z.string(),
  url: z.string().url(),
  status: z.string(),
});

server.tool({
  name: 'create_issue',
  description: 'Create a new Linear issue in a team. Use this when you need to create a task, bug report, or feature request. Get teamId from list_teams first.',
  inputSchema: zodToJsonSchema(CreateIssueInputSchema),
  outputSchema: zodToJsonSchema(CreateIssueOutputSchema),
}, async (input, context) => {
  const { teamId, title, description, priority, labelIds } = CreateIssueInputSchema.parse(input);
  const { logger, correlationId, agentId } = context;

  const childLogger = logger.child({ correlationId, agentId, toolName: 'create_issue' });

  // Permission check
  const permitted = await checkPermission(db, { agentId, toolName: 'create_issue' });
  if (!permitted) {
    childLogger.warn('Permission denied');
    return {
      content: [{ type: 'text', text: 'Permission denied: create_issue not allowed for this agent' }],
      isError: true,
    };
  }

  childLogger.info({ teamId, title }, 'Creating Linear issue');

  try {
    const client = await createLinearClientFromDatabase({ workspaceId: 'ws_default', db, logger });

    const result = await createIssue(client, {
      teamId,
      title,
      description,
      priority,
      labelIds,
    });

    childLogger.info({ issueId: result.issue.id }, 'Issue created successfully');

    return {
      content: [
        {
          type: 'text',
          text: `Created issue ${result.issue.identifier}: ${result.issue.url}`,
        },
      ],
      structuredContent: {
        issueId: result.issue.id,
        issueNumber: result.issue.identifier,
        url: result.issue.url,
        status: result.issue.state.name,
      },
    };
  } catch (error) {
    childLogger.error({ err: error }, 'Failed to create issue');
    return {
      content: [{ type: 'text', text: `Failed to create issue: ${error.message}` }],
      isError: true,
    };
  }
});
```

### GitHub Tool: create_pull_request
```typescript
// Source: MCP tools specification + Octokit patterns
const CreatePRInputSchema = z.object({
  owner: z.string().describe('Repository owner (user or org)'),
  repo: z.string().describe('Repository name'),
  title: z.string().min(1).describe('PR title'),
  body: z.string().optional().describe('PR description in markdown'),
  head: z.string().describe('Head branch name (source branch with changes)'),
  base: z.string().default('main').describe('Base branch name (target branch, default: main)'),
});

const CreatePROutputSchema = z.object({
  number: z.number(),
  url: z.string().url(),
  state: z.enum(['open', 'closed']),
});

server.tool({
  name: 'create_pull_request',
  description: 'Create a pull request in GitHub. Use this after pushing commits to a branch. Specify owner, repo, title, head (source branch), and optionally base (target branch, defaults to main).',
  inputSchema: zodToJsonSchema(CreatePRInputSchema),
  outputSchema: zodToJsonSchema(CreatePROutputSchema),
}, async (input, context) => {
  const { owner, repo, title, body, head, base } = CreatePRInputSchema.parse(input);
  const { logger, correlationId, agentId } = context;

  const childLogger = logger.child({ correlationId, agentId, toolName: 'create_pull_request' });

  // Permission check
  const permitted = await checkPermission(db, { agentId, toolName: 'create_pull_request' });
  if (!permitted) {
    childLogger.warn('Permission denied');
    return {
      content: [{ type: 'text', text: 'Permission denied: create_pull_request not allowed' }],
      isError: true,
    };
  }

  childLogger.info({ owner, repo, head, base }, 'Creating pull request');

  try {
    const client = await createGitHubClientFromDatabase({ owner, db, logger });

    const pr = await createPullRequest(client, {
      owner,
      repo,
      title,
      body,
      head,
      base,
    });

    childLogger.info({ prNumber: pr.number, url: pr.url }, 'PR created');

    return {
      content: [
        {
          type: 'text',
          text: `Created PR #${pr.number}: ${pr.url}`,
        },
      ],
      structuredContent: {
        number: pr.number,
        url: pr.url,
        state: pr.state,
      },
    };
  } catch (error) {
    childLogger.error({ err: error }, 'Failed to create PR');
    return {
      content: [{ type: 'text', text: `Failed to create PR: ${error.message}` }],
      isError: true,
    };
  }
});
```

### Slack Tool: send_message
```typescript
// Source: MCP tools specification + Slack Block Kit
const SendMessageInputSchema = z.object({
  channel: z.string().describe('Channel ID (e.g., C1234567890) or user ID for DM'),
  text: z.string().min(1).describe('Message text (used as fallback if blocks fail)'),
  blocks: z.array(z.any()).optional().describe('Optional Block Kit blocks for rich formatting'),
  threadTs: z.string().optional().describe('Thread timestamp to reply in thread'),
});

const SendMessageOutputSchema = z.object({
  ts: z.string(),
  channel: z.string(),
  permalink: z.string().url().optional(),
});

server.tool({
  name: 'send_message',
  description: 'Send a message to a Slack channel or user. Use channel ID for public/private channels, user ID for direct messages. Optionally specify threadTs to reply in a thread.',
  inputSchema: zodToJsonSchema(SendMessageInputSchema),
  outputSchema: zodToJsonSchema(SendMessageOutputSchema),
}, async (input, context) => {
  const { channel, text, blocks, threadTs } = SendMessageInputSchema.parse(input);
  const { logger, correlationId, agentId } = context;

  const childLogger = logger.child({ correlationId, agentId, toolName: 'send_message' });

  // Permission check
  const permitted = await checkPermission(db, { agentId, toolName: 'send_message' });
  if (!permitted) {
    childLogger.warn('Permission denied');
    return {
      content: [{ type: 'text', text: 'Permission denied: send_message not allowed' }],
      isError: true,
    };
  }

  childLogger.info({ channel, hasBlocks: !!blocks, inThread: !!threadTs }, 'Sending Slack message');

  try {
    const client = await createSlackClientFromDatabase({ teamId: 'T_DEFAULT', db, logger });

    const result = await sendMessage({
      client,
      channel,
      text,
      blocks,
      threadTs,
    });

    childLogger.info({ ts: result.ts, channel: result.channel }, 'Message sent');

    return {
      content: [
        {
          type: 'text',
          text: `Message sent to ${channel} (ts: ${result.ts})`,
        },
      ],
      structuredContent: {
        ts: result.ts,
        channel: result.channel,
      },
    };
  } catch (error) {
    childLogger.error({ err: error }, 'Failed to send message');
    return {
      content: [{ type: 'text', text: `Failed to send message: ${error.message}` }],
      isError: true,
    };
  }
});
```

### Rate Limiting Middleware
```typescript
// Source: Express rate-limit + MCP security patterns
import rateLimit from 'express-rate-limit';

// Per-agent rate limiting
const mcpRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute per agent
  keyGenerator: (req) => {
    // Use agent ID from header as rate limit key
    return req.headers['x-agent-id'] as string || 'unknown';
  },
  handler: (req, res) => {
    const agentId = req.headers['x-agent-id'];
    logger.warn({ agentId }, 'MCP rate limit exceeded');

    res.status(429).json({
      jsonrpc: '2.0',
      id: req.body?.id || null,
      error: {
        code: -32000, // Server error
        message: 'Rate limit exceeded. Try again later.',
        data: {
          retryAfter: 60,
        },
      },
    });
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply to MCP routes
router.use('/mcp/*', mcpRateLimiter);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Direct LLM tool calling with custom formats | MCP standardized protocol | Nov 2024 (initial), Nov 2025 (v2025-11-25 spec) | Tool definitions portable across LLM hosts (Claude Desktop, Cursor, etc.) |
| stdio transport only | HTTP/SSE (Streamable HTTP) preferred | 2025 | Enables remote MCP servers, not just local processes |
| Custom error handling per integration | MCP in-band error reporting (isError flag) | Nov 2025 spec | LLM can see and handle tool errors, not just fail silently |
| OAuth 2.0 ad-hoc | OAuth 2.1 standardized in MCP spec | June 2025 spec update | Security improvements, standardized across MCP ecosystem |
| HTTP+SSE (separate) | Streamable HTTP (unified) | 2025-2026 | Simpler implementation, single transport mechanism |

**Deprecated/outdated:**
- **stdio-only servers**: Still supported but HTTP/SSE is recommended for production remote connections
- **Pre-v2025-11-25 spec**: Prior versions (2025-06-18, 2025-03-26, 2024-11-05) superseded, use latest spec
- **Custom JSON-RPC implementations**: Official SDK is now mature and recommended over custom

**Governance change:** Anthropic donated MCP to Agentic AI Foundation (Linux Foundation) in December 2025. This ensures long-term vendor-neutral governance with participation from Anthropic, Block, OpenAI, and others.

## Open Questions

Things that couldn't be fully resolved:

1. **Gateway/Proxy for Production**
   - What we know: CONTEXT.md mentions "gateway/proxy for production" but doesn't specify technology
   - What's unclear: Whether to use API gateway (Kong, Tyk), reverse proxy (Nginx), or MCP-specific gateway (emerging in 2026 ecosystem)
   - Recommendation: Start without gateway (agents connect directly to integration MCP servers via Docker network). Evaluate gateway need based on observability/rate limiting requirements. If needed, Nginx reverse proxy is simplest (already in ecosystem, handles HTTPS, basic auth).

2. **Tool Discovery vs Static Configuration**
   - What we know: MCP supports dynamic tool discovery via list_tools endpoint and listChanged notifications
   - What's unclear: Whether agents should discover tools dynamically at runtime or have static configuration of available tools
   - Recommendation: Implement dynamic discovery (listChanged: true in capabilities). Agents call list_tools on startup, cache results, listen for notifications. Allows adding new tools without agent redeployment. Static config available as fallback if discovery causes issues.

3. **Batch Tool Invocation**
   - What we know: MCP protocol is request/response per tool
   - What's unclear: Whether to support batch invocations (e.g., create_issue x5 in one request) for efficiency
   - Recommendation: Start without batch support. Fine-grained tools are already efficient. Add batch variants only if profiling shows network overhead as bottleneck (unlikely for typical agent workflows).

4. **Read/Write Tool Separation**
   - What we know: Some systems separate read-only tools (query) from write tools (command)
   - What's unclear: Whether to enforce this separation in tool naming (get_* vs create_*/update_*) or permissions
   - Recommendation: Use naming convention (get/list = read, create/update/delete = write) but rely on permissions table for enforcement. This allows fine-grained control (agent allowed create_issue but not delete_issue).

5. **Hot-Reload of Tool Definitions**
   - What we know: listChanged notification tells clients to refetch tool list
   - What's unclear: Whether tool definitions should be hot-reloadable without server restart
   - Recommendation: Tool definitions are code, not configuration — require server restart to change. Permissions are database-backed and hot-reloadable. This matches existing Aesir patterns (code is deployed, config is runtime).

6. **Global vs Per-Tool Timeouts**
   - What we know: Long-running tools (large PR diffs) need timeouts
   - What's unclear: Whether to set global timeout or per-tool timeouts
   - Recommendation: Both — global timeout (30s) as safety net, per-tool overrides in tool definition metadata. Express middleware enforces global, tool implementation can set response headers for streaming operations.

## Sources

### Primary (HIGH confidence)
- [Model Context Protocol Specification (2025-11-25)](https://modelcontextprotocol.io/specification/2025-11-25) - Official protocol specification
- [MCP Tools Concept Documentation](https://modelcontextprotocol.io/docs/concepts/tools) - Tool design patterns and best practices
- [TypeScript SDK GitHub Repository](https://github.com/modelcontextprotocol/typescript-sdk) - Official SDK implementation
- [MCP Authorization Documentation](https://modelcontextprotocol.io/docs/tutorials/security/authorization) - Security and authorization patterns

### Secondary (MEDIUM confidence)
- [How to Build MCP Servers with TypeScript SDK](https://dev.to/shadid12/how-to-build-mcp-servers-with-typescript-sdk-1c28) - Implementation guide verified against SDK
- [Building MCP Clients - Node.js Tutorial](https://modelcontextprotocol.info/docs/tutorials/building-a-client-node/) - Client-side patterns for agent integration
- [MCP Permissions - Securing AI Agent Access (Cerbos)](https://www.cerbos.dev/blog/mcp-permissions-securing-ai-agent-access-to-tools) - Database-backed authorization patterns
- [Correlation ID vs Trace ID (Last9)](https://last9.io/blog/correlation-id-vs-trace-id/) - Distributed tracing best practices
- [LangChain Standard Message Content](https://www.blog.langchain.com/standard-message-content/) - Normalized domain objects for LLM consumption

### Tertiary (LOW confidence - research needed for validation)
- [MCP Magic Moments: LLM Patterns](https://www.elasticpath.com/blog/mcp-magic-moments-guide-to-llm-patterns) - Router, tool groups patterns (interesting but not authoritative)
- [Rate Limiting in AI Gateway (TrueFoundry)](https://www.truefoundry.com/blog/rate-limiting-in-llm-gateway) - Gateway rate limiting (if gateway approach chosen)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Official SDK and current spec version verified from Anthropic sources
- Architecture: HIGH - Patterns extracted from official SDK examples, documentation, and verified against TypeScript SDK code
- Tool design: HIGH - MCP specification tools section + research papers on fine-grained vs coarse-grained (2025-2026 publications)
- Pitfalls: MEDIUM - Combination of MCP security documentation and general distributed systems patterns; some inferred from problem domain
- Rate limiting: MEDIUM - Express middleware patterns well-established, MCP-specific guidance limited
- Gateway patterns: LOW - CONTEXT.md mentions it but no specific technology chosen; ecosystem still emerging

**Research date:** 2026-01-23
**Valid until:** 2026-02-23 (30 days - stable domain with mature spec)

**Key risks:**
- v2.x SDK releasing Q1 2026 may introduce breaking changes, though v1.x will be supported
- MCP gateway ecosystem still emerging; if gateway needed, options may expand in coming months
- Fine-grained tool performance at scale not yet proven in Aesir; monitoring needed post-implementation

**Dependencies validated:**
- Zod already in use (Phase 13 data layer)
- Express already in all integrations (Phases 16-18)
- Pino logging already standardized (Phase 12)
- PostgreSQL schema pattern established (Phase 13)
- Factory pattern standardized (Phase 14)

**User decisions honored:**
- ✅ Fine-grained tools recommended (matches CONTEXT.md lean)
- ✅ Normalized domain objects recommended (matches research + CONTEXT.md lean)
- ✅ One MCP server per integration (matches CONTEXT.md decision)
- ✅ Embedded in existing service (matches CONTEXT.md decision)
- ✅ HTTP/SSE transport (matches CONTEXT.md decision)
- ✅ Database-backed permissions (matches CONTEXT.md decision)
- ✅ Network isolation for auth (matches CONTEXT.md decision, with validation caveat)
- ✅ Correlation ID propagation (matches CONTEXT.md decision + Phase 12 patterns)
