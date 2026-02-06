# Dev-Agent Traceability Matrix

**Created:** 2026-02-06
**Source:** `packages/agents/definitions/dev-agent/prompt.md` (pre-rewrite)
**Target:** Rewritten prompt following identity -> constraints -> domain knowledge -> examples -> tools -> context structure

## Matrix

Every imperative statement in the current dev-agent prompt is listed below. Each row maps to how the rewrite covers the failure the rule originally prevented.

**Category legend:**
- **Framework contract -> Keep as constraint**: Breaks the executor if violated
- **Behavioral -> Constraint**: Replaced by a constitutional negative constraint
- **Behavioral -> Example**: Replaced by a few-shot example teaching the same judgment
- **Behavioral -> Constraint + Example**: Covered by both
- **Domain knowledge -> Keep**: Non-procedural reference material, preserved in domain knowledge section
- **Behavioral -> Drop (model-native)**: Model does this natively (PROMPT_GUIDE Rule 7)
- **Classification -> Remove**: Complexity classification removed per user decision

| # | Old Rule | Source Section | Failure Prevented | New Coverage | Category |
|---|----------|----------------|-------------------|-------------|----------|
| 1 | "You are an autonomous development agent" (identity statement) | `<identity>` | Agent misunderstands its role | Preserved in `<identity>` -- reworded for goal orientation | Identity -> Keep |
| 2 | "You are the reasoning engine -- you decide WHAT to do and delegate HOW to sub-agents" | `<identity>` | Agent tries to implement code directly instead of delegating | Preserved in `<identity>` -- core operating model | Identity -> Keep |
| 3 | "You never follow a fixed sequence. Instead, you observe the issue, form a plan, adapt as you learn more" | `<identity>` | Agent follows rigid procedures | Preserved in `<identity>` -- adaptive reasoning model | Identity -> Keep |
| 4 | "You operate within a sandboxed development container that has the project codebase checked out" | `<identity>` | Agent assumes access to external systems or host filesystem | Preserved in `<identity>` -- environmental fact | Framework contract -> Keep as constraint |
| 5 | "You run inside a sandboxed dev container. All file reads, writes, and command execution happen within this container." | `<constraints>` | Agent attempts operations outside container scope | Constraint: sandboxed environment reality is stated in identity | Framework contract -> Keep as constraint |
| 6 | "You MUST get human approval before creating a pull request for non-trivial changes" | `<constraints>` | Unreviewed code shipped to production | Constraint #1: "Get human approval before creating a pull request for non-trivial changes" | Behavioral -> Constraint |
| 7 | "You CANNOT merge pull requests -- no merge tool is available" | `<constraints>` | Agent attempts to merge (fails) and gets confused by the error | Constraint #6: "Never merge pull requests -- after creating a PR, report its URL and let a human reviewer handle merging" | Framework contract -> Keep as constraint |
| 8 | "You share a token budget with all sub-agents you spawn. Be efficient -- avoid unnecessary exploration, verbose prompts, or redundant tool calls." | `<constraints>` | Token budget exhaustion before task completion | Constraint #5: "Share a token budget with sub-agents. Provide focused briefs -- each spawned agent costs tokens from the shared pool" + Example #4 (brief quality) | Behavioral -> Constraint + Example |
| 9 | "Prefer reading specific files over searching broadly. Prefer targeted searches over exhaustive scans." | `<constraints>` | Wasted tokens on broad exploration | Drop -- this is an efficiency preference the model calibrates based on situation. Constraint #5 (token budget) covers the underlying concern. Example #1 (simpler than it looks) shows reading directly when appropriate. | Behavioral -> Drop (model-native) |
| 10 | "When spawning sub-agents, provide focused briefs. Each sub-agent invocation costs tokens from the shared budget." | `<constraints>` | Vague briefs waste sub-agent tokens | Constraint #5 (token budget) + Domain knowledge (delegation guide) + Example #4 (what the sub-agent needs vs what I know) | Behavioral -> Constraint + Example |
| 11 | "Do not repeat failed approaches. If something fails, try a DIFFERENT strategy." | `<constraints>` | Infinite retry loops burning budget | Constraint #2: "Never retry the same failed approach -- if something fails, try a fundamentally different strategy" | Behavioral -> Constraint |
| 12 | "Always update the Linear issue status as you progress through phases" | `<constraints>` | Issue status becomes stale in Linear, humans can't track progress | Drop -- behavioral preference, not a safety boundary. The agent has the tool and will naturally use it. Not every status update is valuable, and the agent should decide when updates are meaningful. | Behavioral -> Drop (model-native) |
| 13 | "Your first action is ALWAYS to read the issue details using linear_get_issue" | `<workflow_guidance>` | Agent acts without understanding the task | Drop -- prescriptive tool sequence. The agent naturally reads the issue to understand the task. Example #2 (harder than it looks) implicitly shows reading the issue first. | Behavioral -> Drop (model-native) |
| 14 | "After reading the issue, adapt your approach based on complexity" (classification trigger) | `<workflow_guidance>` | Agent applies same effort to all tasks regardless of scope | Remove -- this is the classification gate. Examples #1 and #2 teach effort calibration through discovery, not upfront classification. | Classification -> Remove |
| 15 | "SIMPLE TASKS (typo fix, README update, config change, single-line fix)" (category definition) | `<workflow_guidance>` | N/A -- classification bucket | Remove -- complexity classification anti-pattern. Example #1 (simpler than it looks) teaches the agent to reduce effort when discovery reveals simplicity, without pre-classifying. | Classification -> Remove |
| 16 | "Read the relevant file(s) directly with read_file" (SIMPLE step 1) | `<workflow_guidance>` | Agent over-invests in trivial changes | Example #1 (simpler than it looks): agent reads codebase, finds simplicity, reads directly instead of spawning researcher | Behavioral -> Example |
| 17 | "Spawn a coder with a concise brief: what to change and where" (SIMPLE step 2) | `<workflow_guidance>` | Agent writes verbose briefs for simple changes | Example #1 + Example #4 (brief quality): demonstrates focused delegation proportional to task complexity | Behavioral -> Example |
| 18 | "Optionally spawn a tester if there are related tests" (SIMPLE step 3) | `<workflow_guidance>` | Skipped testing when tests exist | Drop -- the agent reasons about whether testing is needed. Not every trivial change requires spawning a tester. | Behavioral -> Drop (model-native) |
| 19 | "Create a branch, commit the change, open a PR" (SIMPLE step 4) | `<workflow_guidance>` | Agent forgets to create PR | Drop -- the agent's identity is to produce pull requests. This is its goal, not a step to prescribe. | Behavioral -> Drop (model-native) |
| 20 | "Skip research and detailed planning -- these add cost without value for trivial changes" (SIMPLE step 5) | `<workflow_guidance>` | Agent wastes tokens on research for trivial changes | Example #1 (simpler than it looks): agent reasons "I don't need a researcher -- I can read the file directly" | Behavioral -> Example |
| 21 | "MODERATE TASKS (add function, update endpoint, fix bug with clear scope)" (category definition) | `<workflow_guidance>` | N/A -- classification bucket | Remove -- complexity classification anti-pattern. The agent calibrates effort based on what it discovers, not on upfront categorization. | Classification -> Remove |
| 22 | "Spawn a researcher to explore the relevant code area and identify patterns" (MODERATE step 1) | `<workflow_guidance>` | Agent implements without understanding existing patterns | Example #2 (harder than it looks): agent discovers complexity that requires research after initial reading | Behavioral -> Example |
| 23 | "Create a focused plan: which files to modify, what changes to make, what tests to add" (MODERATE step 2) | `<workflow_guidance>` | Agent implements without a plan, leading to missed files or forgotten tests | Domain knowledge (delegation guide): planning is implicit in providing "clear objective, relevant context, expected output" to sub-agents | Behavioral -> Example |
| 24 | "Spawn a coder with the plan and research findings" (MODERATE step 3) | `<workflow_guidance>` | Coder acts without research context | Example #4 (what the sub-agent needs): demonstrates including research findings in the delegation brief | Behavioral -> Example |
| 25 | "Spawn a tester to run relevant test suites" (MODERATE step 4) | `<workflow_guidance>` | Changes deployed without test verification | Drop -- model naturally verifies work. The identity states "verify correctness." | Behavioral -> Drop (model-native) |
| 26 | "If tests fail, analyze the failure, adjust the plan, and retry" (MODERATE step 5) | `<workflow_guidance>` | Agent gives up on first test failure | Constraint #2 (try different strategy) + Example #3 (wrong approach vs wrong execution): teaches diagnosing and adapting | Behavioral -> Constraint + Example |
| 27 | "COMPLEX TASKS (new feature, architectural change, multi-file refactor)" (category definition) | `<workflow_guidance>` | N/A -- classification bucket | Remove -- complexity classification anti-pattern | Classification -> Remove |
| 28 | "Spawn a researcher for thorough exploration: architecture, dependencies, patterns, risks" (COMPLEX step 1) | `<workflow_guidance>` | Agent implements complex features without understanding architecture | Example #2 (harder than it looks): demonstrates recognizing when thorough research is needed | Behavioral -> Example |
| 29 | "Create a detailed plan with: implementation steps, files to create/modify, test strategy, rollback approach" (COMPLEX step 2) | `<workflow_guidance>` | Complex changes made without rollback strategy | Constraint #1 (human approval for non-trivial changes): the approval request naturally requires presenting a plan | Behavioral -> Constraint |
| 30 | "Send the plan to Slack using slack_send_approval_request..." (COMPLEX step 3) | `<workflow_guidance>` | Complex changes proceed without human review | Constraint #1: "Get human approval before creating a pull request for non-trivial changes" covers this. The agent decides how to get approval (Slack, etc.) | Behavioral -> Constraint |
| 31 | "If issues arise, diagnose and fix iteratively" (COMPLEX step 4) | `<workflow_guidance>` | Agent gives up on complex task at first obstacle | Constraint #2 (different strategy) + Constraint #3 (escalate after 3 attempts): defines iteration boundaries | Behavioral -> Constraint + Example |
| 32 | "You decide the appropriate level of effort. There are no hardcoded rules -- use your judgment." | `<workflow_guidance>` | N/A -- this is already goal-oriented guidance | Drop -- this sentence contradicts the classification above it. The rewritten prompt embodies this by design. | Classification -> Remove |
| 33 | "When in doubt about complexity, start with a quick read of the relevant files" | `<workflow_guidance>` | Agent over-commits before understanding scope | Example #1 and #2 both show reading first and adjusting approach based on what's found. This is the core pattern of both examples. | Behavioral -> Example |
| 34 | "Sub-agents are focused workers with their own context windows. They cannot see your conversation history." | `<sub_agent_delegation>` | Agent assumes sub-agents have context, sends incomplete briefs | Domain knowledge: preserved verbatim as architectural fact in delegation section | Domain knowledge -> Keep |
| 35 | "You MUST include everything they need in the brief you send via spawn_agent" | `<sub_agent_delegation>` | Sub-agents lack context, waste tokens re-discovering information | Domain knowledge (delegation guide) + Example #4 (what the sub-agent needs vs what I know) | Domain knowledge -> Keep |
| 36 | "Every sub-agent brief needs: 1. CLEAR OBJECTIVE 2. RELEVANT CONTEXT 3. EXPECTED OUTPUT FORMAT 4. BOUNDARIES" | `<sub_agent_delegation>` | Incomplete briefs produce incomplete or wrong work | Domain knowledge: preserved as brief requirements checklist | Domain knowledge -> Keep |
| 37 | "GOOD brief example (validateEmail)" | `<sub_agent_delegation>` | Developers don't understand what a good brief looks like | Domain knowledge: preserved as reference example | Domain knowledge -> Keep |
| 38 | "BAD brief example ('Add email validation to the project')" | `<sub_agent_delegation>` | Developers don't recognize vague briefs | Domain knowledge: preserved as anti-example | Domain knowledge -> Keep |
| 39 | "When a sub-agent reports errors or test failures, follow this diagnostic process" (error recovery intro) | `<error_recovery>` | Agent has no error handling strategy | Constraints #2-4 (retry/escalation) + Example #3 (wrong approach): provides reasoning framework instead of procedure | Behavioral -> Constraint + Example |
| 40 | "READ THE ERROR OUTPUT CAREFULLY: Look at the exact error message, stack trace, and failing test name" (step 1) | `<error_recovery>` | Agent ignores error details and retries blindly | Example #3 (wrong approach): agent reads error, checks codebase, diagnoses the actual problem | Behavioral -> Example |
| 41 | "DIAGNOSE THE ROOT CAUSE: Categorize the error" (step 2 header) | `<error_recovery>` | Agent retries without understanding root cause | Example #3: demonstrates diagnosing root cause (stale brief vs code bug) without requiring explicit categorization | Behavioral -> Example |
| 42 | "WRONG APPROACH: The implementation strategy is fundamentally flawed" (diagnostic category) | `<error_recovery>` | Agent retries flawed approach instead of rethinking | Remove diagnostic category. Example #3 teaches this specific judgment: "The coder followed my brief correctly but my brief was based on stale information" | Classification -> Remove |
| 43 | "MISSING DEPENDENCY: A package, import, or configuration is missing" (diagnostic category) | `<error_recovery>` | Agent misdiagnoses missing dependency as code bug | Remove diagnostic category. Example #3 teaches root cause diagnosis without requiring bucketing. | Classification -> Remove |
| 44 | "CODE BUG: Logic error, type mismatch, or incorrect implementation of the right approach" (diagnostic category) | `<error_recovery>` | Agent rethinks approach when just the implementation is wrong | Remove diagnostic category. Example #3 teaches distinguishing approach failure from execution failure. | Classification -> Remove |
| 45 | "ENVIRONMENT ISSUE: Container problem, network error, permission denied, out of memory" (diagnostic category) | `<error_recovery>` | Agent tries to fix infrastructure problems with code changes | Constraint #4: "Escalate infrastructure errors immediately (ECONNREFUSED, EACCES, ENOMEM, container issues) -- these cannot be fixed by changing code" | Behavioral -> Constraint |
| 46 | "TRY A DIFFERENT APPROACH: Do NOT retry the same thing" (step 3) | `<error_recovery>` | Infinite retry loops | Constraint #2: "Never retry the same failed approach" | Behavioral -> Constraint |
| 47 | "If the approach is wrong, rethink the strategy" (step 3 detail) | `<error_recovery>` | Agent makes superficial fixes to fundamentally wrong approach | Example #3 (wrong approach): "This isn't a code bug -- I need to re-read the current interface and revise the implementation approach" | Behavioral -> Example |
| 48 | "TRACK WHAT YOU HAVE TRIED: Keep a mental log of approaches attempted" (step 4) | `<error_recovery>` | Agent loses track and repeats failed approaches | Drop -- the model has conversation history and naturally tracks this. Constraint #2 (no repeats) and #3 (escalate after 3) provide the boundary. | Behavioral -> Drop (model-native) |
| 49 | "After 3 distinct failed approaches for the same problem, escalate to a human" | `<error_recovery>` | Agent burns entire budget retrying without human input | Constraint #3: "After 3 distinct failed approaches for the same problem, escalate to a human with: what you tried, why each failed, your best diagnosis, and a suggested path forward" | Behavioral -> Constraint |
| 50 | "Escalation content: what you tried, why each failed, your best diagnosis, suggested path forward" | `<error_recovery>` | Poor quality escalations that don't help the human | Constraint #3 includes the escalation content requirements. Example #5 (when to escalate) demonstrates a quality escalation. | Behavioral -> Constraint + Example |
| 51 | "ENVIRONMENT ERRORS should be escalated immediately" with specific error codes | `<error_recovery>` | Agent wastes budget debugging infrastructure issues | Constraint #4: "Escalate infrastructure errors immediately (ECONNREFUSED, EACCES, ENOMEM, container issues)" | Behavioral -> Constraint |
| 52 | "These are infrastructure issues that cannot be fixed by changing code. Escalate to a human immediately." | `<error_recovery>` | Agent tries code-level fixes for infra problems | Constraint #4 covers this directly | Behavioral -> Constraint |
| 53 | Tool descriptions: read_file, search_codebase, list_directory (CODEBASE category) | `<available_tools>` | Agent doesn't know which tools are available | Tools section: Codebase category with purpose notes | Tools -> Keep |
| 54 | "You do NOT have write_file or run_command directly. Delegate to sub-agents." | `<available_tools>` | Agent tries to write files directly and fails | Tools section: note that dev-agent has read-only codebase access, delegates execution to sub-agents | Framework contract -> Keep as constraint |
| 55 | Tool description: spawn_agent (DELEGATION category) | `<available_tools>` | Agent doesn't know how to delegate | Tools section: Delegation category | Tools -> Keep |
| 56 | Tool description: request_human_input with usage note about Slack notification first | `<available_tools>` | Agent calls request_human_input without first sending notification, human doesn't know to respond | Tools section: Human interaction category with usage note | Tools -> Keep |
| 57 | Tool descriptions: linear_get_issue, linear_update_issue_status (LINEAR category) | `<available_tools>` | Agent doesn't know which Linear tools are available | Tools section: Linear category | Tools -> Keep |
| 58 | Tool descriptions: github_create_branch, github_create_commit, github_create_pull_request, github_get_pull_request (GITHUB category) | `<available_tools>` | Agent doesn't know which GitHub tools are available | Tools section: GitHub category | Tools -> Keep |
| 59 | "You do NOT have a merge tool. Humans review and merge pull requests." | `<available_tools>` | Agent tries to merge and fails, or waits for a merge it can't perform | Constraint #6: "Never merge pull requests" + Tools section note | Framework contract -> Keep as constraint |
| 60 | Tool descriptions: slack_send_message, slack_send_approval_request (SLACK category) | `<available_tools>` | Agent doesn't know which Slack tools are available | Tools section: Slack category | Tools -> Keep |

## Summary Statistics

| Category | Count | Description |
|----------|-------|-------------|
| Identity -> Keep | 3 | Identity statements preserved in rewritten identity |
| Framework contract -> Keep as constraint | 5 | System invariants that break the executor if violated |
| Behavioral -> Constraint | 9 | Procedural rules replaced by constitutional negatives |
| Behavioral -> Example | 11 | Procedural rules replaced by few-shot reasoning examples |
| Behavioral -> Constraint + Example | 6 | Covered by both constraint and example |
| Domain knowledge -> Keep | 5 | Sub-agent delegation guide preserved as reference material |
| Behavioral -> Drop (model-native) | 7 | Model handles natively; constraint #5 or identity covers underlying concern |
| Classification -> Remove | 8 | Complexity classification and diagnostic categorization removed |
| Tools -> Keep | 6 | Tool reference information preserved in tools section |

**Total rows: 60**

Note: The research estimated ~35 imperative statements. The actual count is higher because the research grouped multi-step procedures as single entries. This matrix lists each step individually for full traceability. The core imperative statements (rules that require coverage decisions) are rows 4-52 (49 entries), with rows 1-3 being identity statements and rows 53-60 being tool documentation.

## Coverage Verification

### All current prompt sections represented:

| Source Section | Rows | Status |
|----------------|------|--------|
| `<identity>` | 1-4 | Covered -- preserved in new identity |
| `<constraints>` | 5-12 | Covered -- framework contracts kept, behavioral rules mapped to constraints/examples/dropped |
| `<workflow_guidance>` (intro) | 13-14 | Covered -- prescriptive start removed, classification trigger removed |
| `<workflow_guidance>` SIMPLE | 15-20 | Covered -- classification removed, judgment taught via Example #1 |
| `<workflow_guidance>` MODERATE | 21-26 | Covered -- classification removed, judgment taught via Examples #2, #3, #4 |
| `<workflow_guidance>` COMPLEX | 27-31 | Covered -- classification removed, constraint #1 covers approval |
| `<workflow_guidance>` (guidance) | 32-33 | Covered -- embodied in prompt design |
| `<sub_agent_delegation>` | 34-38 | Covered -- preserved as domain knowledge |
| `<error_recovery>` (process) | 39-41 | Covered -- constraints #2-4 + Example #3 |
| `<error_recovery>` (categories) | 42-45 | Covered -- diagnostic categories removed, wisdom captured in constraints + examples |
| `<error_recovery>` (retry/escalate) | 46-52 | Covered -- constraints #2, #3, #4 + Example #5 |
| `<available_tools>` | 53-60 | Covered -- preserved in tools section |

### Constraint mapping (new prompt constraints <- old rules):

| New Constraint | Covers Old Rules |
|----------------|-----------------|
| #1: Get human approval before creating PR for non-trivial changes | 6, 29, 30 |
| #2: Never retry the same failed approach | 11, 46, 47 |
| #3: After 3 failed approaches, escalate with details | 49, 50 |
| #4: Escalate infrastructure errors immediately | 45, 51, 52 |
| #5: Share token budget, provide focused briefs | 8, 10 |
| #6: Never merge pull requests | 7, 59 |

### Example mapping (new prompt examples <- old rules):

| New Example | Covers Old Rules |
|-------------|-----------------|
| #1: Simpler than it looks | 16, 17, 20, 33 |
| #2: Harder than it looks | 22, 28, 33 |
| #3: Wrong approach, not wrong execution | 40, 41, 42, 43, 44, 47 |
| #4: What the sub-agent needs vs what I know | 8, 10, 17, 23, 24 |
| #5: When to escalate | 49, 50, 31, 26 |
