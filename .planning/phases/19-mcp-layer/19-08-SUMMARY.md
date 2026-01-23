---
phase: 19-mcp-layer
plan: 08
subsystem: integrations
tags: [mcp, permissions, seeding, documentation]
requires: [19-06, 19-07]
provides:
  - Permission seeding infrastructure
  - MCP layer documentation
affects: [phase-20]
tech-stack:
  added: []
  patterns:
    - Database-backed permission seeding
    - CLI scripts with idempotent updates
key-files:
  created:
    - packages/integrations/linear/scripts/seed-permissions.ts
    - packages/integrations/github/scripts/seed-permissions.ts
    - packages/integrations/slack/scripts/seed-permissions.ts
  modified:
    - packages/integrations/linear/package.json
    - packages/integrations/github/package.json
    - packages/integrations/slack/package.json
    - biome.json
    - .claude/CLAUDE.md
decisions:
  - title: "Biome override for scripts directory"
    rationale: "Scripts are CLI tools where console.log is appropriate for user feedback"
    alternatives: "Use biome-ignore comments per file"
    tradeoffs: "Override is more maintainable but affects all scripts"
    decision_id: "19-08-01"
  - title: "Permission storage via onConflictDoUpdate"
    rationale: "Enables idempotent seeding - can re-run safely"
    alternatives: "Insert only, fail on duplicate"
    tradeoffs: "More complex SQL but much better DX"
    decision_id: "19-08-02"
metrics:
  duration: "~3 min"
  completed: "2026-01-23"
---

# Phase 19 Plan 08: Permission Seeding & Documentation Summary

**One-liner:** Permission seeding scripts for all integrations with comprehensive MCP layer documentation in CLAUDE.md

## Overview

Created seed-permissions.ts scripts for Linear, GitHub, and Slack integrations to bootstrap agent tool permissions. Updated CLAUDE.md with complete MCP layer documentation including endpoints, tools, headers, and examples. Verified all packages build, typecheck, and pass quality gates.

## Implementation Summary

### Permission Seeding Scripts

**Linear (5 tools):**
- dev-agent: Full access (get_issue, create_issue, update_issue_status, list_teams, list_labels)
- product-agent: Full access (same 5 tools)

**GitHub (9 tools):**
- dev-agent: Full access (all 9 tools - repository, branch, commit, PR, file operations)
- product-agent: Read-only (5 tools - get_repository, get_pull_request, list_pull_requests, get_file_contents, list_files)

**Slack (5 tools):**
- dev-agent: Full access (send_message, send_approval_request, get_message, reply_to_thread, list_channels)
- product-agent: Full access (same 5 tools - notifications are collaborative)

Each script:
- Uses onConflictDoUpdate for idempotent seeding
- Connects directly to PostgreSQL (avoids full env validation)
- Provides user-friendly console output
- Added as npm script: `seed:permissions`

### CLAUDE.md Updates

Added comprehensive MCP Layer section:
- Endpoints documentation (GET /mcp/tools, POST /mcp/tools/:name)
- Headers (X-Correlation-ID, X-Agent-ID)
- Port mappings (3001/3002/3003)
- All 19 tools across three integrations
- Tool permissions approach (database-backed allow-list)
- Example curl invocation
- Rate limiting details (100 req/min per agent)
- Updated directory structure showing mcp/ directories

### Code Quality

Updated biome.json:
- Added override for **/scripts/**/*.ts to disable noConsole
- More precise than .biomeignore pattern
- Allows console.log in CLI scripts while maintaining rules elsewhere

## Deviations from Plan

None - plan executed exactly as written.

## Key Technical Details

**Idempotent Seeding:**
```typescript
await db
  .insert(mcpToolPermissions)
  .values(permission)
  .onConflictDoUpdate({
    target: [mcpToolPermissions.agentId, mcpToolPermissions.toolName],
    set: { allowed: permission.allowed, updatedAt: new Date() },
  });
```

**Biome Override:**
```json
{
  "includes": ["**/scripts/**/*.ts"],
  "linter": {
    "rules": {
      "suspicious": {
        "noConsole": "off"
      }
    }
  }
}
```

## Testing & Verification

1. **Build verification:** All integration packages compile successfully
2. **Type safety:** Full project typecheck passes
3. **Tests:** All tests run (pre-existing failures documented)
4. **Lint:** No new violations introduced
5. **Documentation:** All grep verifications pass

## Next Phase Readiness

Phase 20 can proceed with:
- Permission seeding infrastructure available for testing
- Complete MCP documentation for future reference
- All 19 tools documented with clear examples
- Tool permission model established

## Decisions Made

### Decision 1: Biome override for scripts directory
**Context:** Seed scripts use console.log for CLI output but Biome flags it as error

**Options:**
1. Add biome-ignore comments to each console statement
2. Add **/scripts/** to .biomeignore
3. Add biome.json override for scripts directory

**Decision:** Option 3 - biome.json override

**Rationale:**
- More maintainable than per-line comments
- More precise than .biomeignore (can control which rules)
- Follows existing pattern (tests have similar override)
- Scripts are CLI tools where console.log is appropriate

**Impact:** All scripts can use console.log for user feedback

### Decision 2: Permission storage via onConflictDoUpdate
**Context:** Seed scripts need to be idempotent for good DX

**Options:**
1. Insert only, fail on duplicate key
2. Delete existing then insert
3. Use onConflictDoUpdate (upsert)

**Decision:** Option 3 - onConflictDoUpdate

**Rationale:**
- Idempotent - can re-run safely without errors
- Updates timestamp on re-run (audit trail)
- Single atomic operation (no race conditions)
- Standard pattern for seeding scripts

**Impact:** Developers can re-run seed scripts to reset permissions

## Integration Points

**With Phase 19 Plans:**
- 19-06: Uses mcp_tool_permissions tables created
- 19-07: Seeds permissions for HTTP routes

**Database:**
- linear.mcp_tool_permissions
- github.mcp_tool_permissions
- slack.mcp_tool_permissions

**Documentation:**
- .claude/CLAUDE.md: Primary AI context
- README files: Reference seed:permissions scripts

## Performance Notes

- Seeding is fast (<1s for all integrations)
- Scripts use single database connection (max: 1)
- Batch insert avoided to provide per-permission feedback

## Security Considerations

- Permission model is allow-list (secure by default)
- Agent IDs hardcoded in seeds (dev-agent, product-agent)
- Database credentials from environment variables
- No plaintext secrets in scripts

## Future Enhancements

1. **Permission UI:** Web interface for managing permissions
2. **Role-based permissions:** Group permissions by role
3. **Audit logging:** Track permission changes over time
4. **Permission inheritance:** Parent/child permission relationships

## Commits

- 89703a0: feat(19-08): add permission seeding scripts for all integrations
- 7cdc70a: docs(19-08): update CLAUDE.md with MCP layer documentation
- aa0f533: test(19-08): verify final build and quality checks

## Files Changed

**Created:**
- packages/integrations/linear/scripts/seed-permissions.ts (67 lines)
- packages/integrations/github/scripts/seed-permissions.ts (71 lines)
- packages/integrations/slack/scripts/seed-permissions.ts (71 lines)

**Modified:**
- packages/integrations/linear/package.json (added seed:permissions script)
- packages/integrations/github/package.json (added seed:permissions script)
- packages/integrations/slack/package.json (added seed:permissions script)
- biome.json (added scripts override)
- .claude/CLAUDE.md (added 65 lines of MCP documentation)

**Total changes:** ~350 lines across 8 files
