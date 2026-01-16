# Phase 2: Execution Environment - Context

**Gathered:** 2026-01-16
**Status:** Ready for planning

<vision>
## How This Should Work

The agent needs a sandboxed environment where it can do everything a developer would do - install dependencies, edit files, run tests, execute builds. But the agent shouldn't directly touch the filesystem or have access to the host.

The sandbox is accessed via API: agent sends commands/code, sandbox executes and returns results. This keeps a clean separation between the agent orchestration layer and the execution environment.

For MVP, we start simple with Docker running locally. No need for per-task container orchestration or bulletproof security yet - cost efficiency and fast iteration matter more at this stage. The key is abstracting the sandbox behind an interface so we can swap Docker for E2B, Fargate, or something else later without changing agent code.

</vision>

<essential>
## What Must Be Nailed

- **Interface abstraction** - Sandbox implementation hidden behind a clean interface. Agent code doesn't know or care if it's Docker, E2B, or something else.
- **Full dev capabilities** - npm install, file operations, git commands, test execution, builds. Everything a developer would do.
- **API-based interaction** - Agent sends commands via API, gets results back. No direct filesystem access.

</essential>

<specifics>
## Specific Ideas

- Start with Docker for MVP (simple, no vendor dependency, cost-effective)
- Abstract behind `Sandbox` interface with methods like `execute()`, `writeFile()`, `readFile()`
- Migration path to E2B or AWS Fargate when scale/security needs increase
- Don't over-engineer isolation for MVP - can harden later

</specifics>

<notes>
## Additional Context

**Core development principle established:** Abstract external dependencies behind interfaces throughout the project. This applies to sandbox, LLM providers, task management (Linear), notifications (Slack), etc. Benefits:
- Swap implementations without touching business logic
- Easy testing with mocks
- No vendor lock-in
- Iterate quickly with simple MVP implementations, harden later

This principle should be reflected in PROJECT.md as a project-wide architectural decision.

</notes>

---

*Phase: 02-execution-environment*
*Context gathered: 2026-01-16*
