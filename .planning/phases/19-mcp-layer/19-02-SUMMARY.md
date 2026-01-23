---
phase: 19
plan: 02
subsystem: integrations
tags: [mcp, permissions, database, drizzle, linear, github, slack]
requires: [16-linear-extraction, 17-github-extraction, 18-slack-extraction]
provides: [mcp-tool-permissions-tables, permission-checker-functions]
affects: [19-03-mcp-server-implementation]
tech-stack:
  added: []
  patterns: [allow-list-permissions, database-backed-authorization]
key-files:
  created:
    - packages/integrations/linear/src/db/permissions.ts
    - packages/integrations/github/src/db/permissions.ts
    - packages/integrations/slack/src/db/permissions.ts
    - packages/integrations/linear/src/db/migrations/0001_woozy_shadowcat.sql
    - packages/integrations/github/src/db/migrations/0000_mute_thing.sql
    - packages/integrations/slack/src/db/migrations/0000_melodic_zodiak.sql
  modified:
    - packages/integrations/linear/src/db/schema.ts
    - packages/integrations/linear/src/db/schema.drizzle.ts
    - packages/integrations/linear/src/db/index.ts
    - packages/integrations/github/src/db/schema.ts
    - packages/integrations/github/src/db/schema.drizzle.ts
    - packages/integrations/github/src/db/index.ts
    - packages/integrations/slack/src/db/schema.ts
    - packages/integrations/slack/src/db/schema.drizzle.ts
    - packages/integrations/slack/src/db/index.ts
decisions: []
metrics:
  duration: 8
  completed: 2026-01-23
---

# Phase 19 Plan 02: MCP Permission Schema Summary

**Database-backed MCP tool permission system with allow-list authorization**

## What Was Built

Created database schema and permission checker functions for MCP tool whitelisting across all three integration packages (Linear, GitHub, Slack).

### Core Implementation

**1. Database Schema (All Three Integrations)**
- Added `mcp_tool_permissions` table in each integration's schema namespace
- Fields: id, agent_id, tool_name, allowed, created_at, updated_at
- Unique constraint on (agent_id, tool_name) for single permission per agent-tool pair
- Allow-list approach: permission defaults to denied if no row exists

**2. Permission Checker Functions**
- `checkLinearToolPermission()` - Linear integration
- `checkGitHubToolPermission()` - GitHub integration
- `checkSlackToolPermission()` - Slack integration
- All functions follow identical pattern: query by agent + tool, default deny
- Error handling defaults to deny for security

**3. Database Migrations**
- Linear: `0001_woozy_shadowcat.sql` - creates linear.mcp_tool_permissions
- GitHub: `0000_mute_thing.sql` - creates github.mcp_tool_permissions
- Slack: `0000_melodic_zodiak.sql` - creates slack.mcp_tool_permissions
- All migrations include unique index for fast lookups

## Key Decisions

None - implementation followed plan exactly.

## Deviations from Plan

None - plan executed exactly as written.

## Testing

- All packages pass typecheck
- Biome linting passes for all files
- Migration files generated successfully

## Next Phase Readiness

**Ready for 19-03 (MCP Server Implementation)**

This plan provides the database foundation for MCP tool permissions. Next plan will:
- Implement MCP server initialization
- Create tool registration system
- Integrate permission checkers into tool execution flow

**Blockers:** None

**Concerns:** None

## Architectural Notes

**Allow-List Security Model**
- Default deny approach: tools require explicit permission grants
- Per-agent, per-tool granularity enables precise access control
- Database-backed allows runtime permission changes without redeployment

**Schema Isolation**
- Each integration has its own permissions table in its schema namespace
- Linear: `linear.mcp_tool_permissions`
- GitHub: `github.mcp_tool_permissions`
- Slack: `slack.mcp_tool_permissions`
- Follows established pattern from Phases 16-18

**Performance Considerations**
- Unique index on (agent_id, tool_name) ensures fast permission lookups
- Query pattern: single DB hit per tool execution
- Permission check happens before tool execution (fail-fast)

## Files Modified

**Linear Package:**
- `src/db/schema.ts` - added mcpToolPermissions table
- `src/db/schema.drizzle.ts` - added mcpToolPermissions for migration generation
- `src/db/permissions.ts` - NEW: permission checker function
- `src/db/index.ts` - exported permissions module
- `src/db/migrations/0001_woozy_shadowcat.sql` - NEW: migration file

**GitHub Package:**
- `src/db/schema.ts` - added mcpToolPermissions table
- `src/db/schema.drizzle.ts` - added mcpToolPermissions for migration generation
- `src/db/permissions.ts` - NEW: permission checker function
- `src/db/index.ts` - exported permissions module
- `src/db/migrations/0000_mute_thing.sql` - NEW: migration file

**Slack Package:**
- `src/db/schema.ts` - added mcpToolPermissions table
- `src/db/schema.drizzle.ts` - added mcpToolPermissions for migration generation
- `src/db/permissions.ts` - NEW: permission checker function
- `src/db/index.ts` - exported permissions module
- `src/db/migrations/0000_melodic_zodiak.sql` - NEW: migration file

## Metrics

- **Duration:** 8 minutes
- **Tasks Completed:** 3/3
- **Commits:** 3 (one per task)
- **Files Created:** 9 (3 permission checkers + 3 migrations + 3 meta files)
- **Files Modified:** 9 (3 schemas + 3 drizzle schemas + 3 index files)
- **Lines Added:** ~400 (including migrations)

## Commits

1. `4f7cc24` - feat(19-02): add MCP permission schema to Linear package
2. `c87f9d0` - feat(19-02): add MCP permission schema to GitHub and Slack packages
3. `7573243` - chore(19-02): generate database migrations for MCP permissions
