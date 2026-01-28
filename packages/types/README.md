# @aesir/types

Shared type contracts and lightweight utilities for the Aesir platform.

## Purpose

This package contains pure types, interfaces, error classes, and minimal utilities that are shared across all layers of the Aesir monorepo. It has no heavy runtime dependencies - just `nanoid` for ID generation and `zod` for schema validation.

## What belongs here

- **Error types** - Base error classes and error codes
- **Event schemas** - Normalized event types for cross-integration communication
- **MCP types** - Model Context Protocol interfaces (MCPLogger, MCPToolContext, MCPToolResult)
- **Temporal contracts** - Workflow/activity input/output types
- **Shared types** - Domain types used across packages (TestResult, Sandbox, IssueStatus, etc.)
- **Utilities** - Pure functions like ID generators

## What does NOT belong here

- **Infrastructure implementations** - Database connections, logging implementation, HTTP servers → use `@aesir/platform`
- **State schemas with LangGraph dependencies** - Agent state definitions → use `@aesir/agents`
- **Integration-specific code** - OAuth flows, API clients → use `@aesir/integration-*`

## Dependencies

This package intentionally has minimal dependencies:

- `nanoid` - ID generation
- `zod` - Schema validation

No database drivers, no logging libraries, no heavy frameworks.

## Usage

```typescript
import {
  // Errors
  AppError,
  ValidationError,

  // Types
  TestResult,
  Sandbox,

  // MCP
  MCPLogger,
  MCPToolContext,
  createToolResult,

  // Utilities
  createId,
} from "@aesir/types";
```

## Package Architecture

```
Agents / Dashboard        (top-level applications)
   ↓
Integrations              (HTTP services for external APIs)
   ↓
Platform                  (infrastructure: db, logging, temporal, sandbox)
   ↓
Types                     (pure contracts and utilities) ← you are here
```
