/**
 * Dev Agent Prompts
 *
 * System prompts and template functions for each phase of the Dev Agent workflow.
 * These guide the LLM through research, planning, and execution phases.
 *
 * Design principles:
 * - Research prompts focus on understanding existing patterns
 * - Planning prompts emphasize confidence levels and explicit unknowns
 * - Execution prompts follow existing code patterns strictly
 */

import type { ResearchContext } from "./state.js";

// ============================================================================
// Research Phase Prompts
// ============================================================================

/**
 * System prompt for the research phase.
 *
 * Guides the LLM to explore the codebase and capture understanding.
 */
export const RESEARCH_SYSTEM_PROMPT = `You are a developer researching a codebase to implement a feature.

Your goal is to understand:
1. How the codebase is structured
2. What patterns exist that you should follow
3. What files are relevant to this task
4. What dependencies and constraints exist
5. What you still don't know (unknowns are OK - name them explicitly)

You will receive:
- The task description (from Linear issue)
- File contents from your exploration
- Project structure

Output a structured analysis that captures your understanding. Be thorough but focused on what matters for implementation.

Key behaviors:
- Look for patterns to FOLLOW, not just files to modify
- Identify dependencies that might be affected
- Call out risks or concerns explicitly
- Acknowledge unknowns rather than guessing
- Note testing patterns used in similar code`;

/**
 * Build the user prompt for research phase.
 *
 * Combines task context with discovered file contents and structure.
 */
export function buildResearchPrompt(input: {
  taskTitle: string;
  taskDescription: string;
  fileContents: Record<string, string>;
  projectStructure: string;
}): string {
  const { taskTitle, taskDescription, fileContents, projectStructure } = input;

  const fileSection = Object.entries(fileContents)
    .map(
      ([path, content]) =>
        `### ${path}\n\`\`\`\n${truncateContent(content, 2000)}\n\`\`\``,
    )
    .join("\n\n");

  return `# Task: ${taskTitle}

## Description
${taskDescription || "No description provided."}

## Project Structure
\`\`\`
${projectStructure}
\`\`\`

## Relevant File Contents
${fileSection || "No files explored yet."}

---

Analyze this codebase and provide a structured research context. Include:
1. Which files are relevant and why
2. What patterns should be followed
3. What dependencies are involved
4. What risks or concerns you see
5. What you still don't know (unknowns)`;
}

// ============================================================================
// Planning Phase Prompts
// ============================================================================

/**
 * System prompt for the planning phase.
 *
 * Converts research findings into a concrete execution plan.
 */
export const PLANNING_SYSTEM_PROMPT = `You are a developer creating an implementation plan.

Based on your research, create a concrete plan with:
1. Clear steps to implement the feature
2. Files to create/modify for each step
3. Test strategy for each step
4. Confidence level (high/medium/low) with reasoning

CONFIDENCE GUIDELINES:
- HIGH: You understand the patterns, know the files, have clear test strategy
- MEDIUM: Some unknowns but you have a reasonable approach
- LOW: Significant gaps in understanding - plan may need revision

If confidence is low, explicitly list what gaps remain.
The reviewer will see your confidence and may reject if under-researched.

Be specific about:
- Exact file paths (based on research)
- Code patterns to follow (from research)
- Test patterns to use
- Estimated scope of changes

IMPORTANT: Plans with LOW confidence should acknowledge this openly. It's better to be honest about gaps than to pretend certainty and produce a flawed implementation.`;

/**
 * Build the user prompt for planning phase.
 *
 * Uses research context to create an actionable execution plan.
 */
export function buildPlanningPrompt(input: {
  taskTitle: string;
  taskDescription: string;
  researchContext: ResearchContext;
}): string {
  const { taskTitle, taskDescription, researchContext } = input;

  const relevantFilesSection = researchContext.relevantFiles
    .map(
      (f) =>
        `- **${f.path}**: ${f.purpose}\n  Patterns: ${f.patterns.join(", ") || "None identified"}`,
    )
    .join("\n");

  const patternsSection =
    researchContext.existingPatterns.length > 0
      ? researchContext.existingPatterns.map((p) => `- ${p}`).join("\n")
      : "None identified";

  const dependenciesSection =
    researchContext.dependencies.length > 0
      ? researchContext.dependencies.map((d) => `- ${d}`).join("\n")
      : "None identified";

  const risksSection =
    researchContext.risks.length > 0
      ? researchContext.risks.map((r) => `- ${r}`).join("\n")
      : "None identified";

  const unknownsSection =
    researchContext.unknowns.length > 0
      ? researchContext.unknowns.map((u) => `- ${u}`).join("\n")
      : "None";

  return `# Task: ${taskTitle}

## Description
${taskDescription || "No description provided."}

## Research Summary

### Relevant Files
${relevantFilesSection || "None identified"}

### Existing Patterns to Follow
${patternsSection}

### Dependencies
${dependenciesSection}

### Known Risks
${risksSection}

### Unknowns
${unknownsSection}

---

Create an execution plan with:
1. A title and summary of the approach
2. Your confidence level (high/medium/low) and reasoning
3. Ordered steps with files and test strategy
4. Estimated changes (files, lines)
5. Risks to watch for

If there are significant unknowns, your confidence should reflect that.`;
}

// ============================================================================
// Execution Phase Prompts
// ============================================================================

/**
 * System prompt for file writing during execution.
 *
 * Guides the LLM to implement code following existing patterns.
 */
export const FILE_WRITE_SYSTEM_PROMPT = `You are implementing a specific step from an approved plan.

Follow the plan exactly. Match existing patterns from the codebase.
Include appropriate error handling following project standards.
Add JSDoc for public APIs and inline comments for complex logic.

Output the complete file content - do not truncate.

CRITICAL RULES:
1. Follow patterns from the research phase - don't invent new approaches
2. Use consistent naming with existing code
3. Include proper TypeScript types (no 'any' unless existing code uses it)
4. Add error handling that matches project patterns
5. Include imports at the top, exports at the bottom
6. Maintain consistent formatting and spacing`;

/**
 * Build the user prompt for file writing.
 *
 * Provides context for implementing a specific step.
 */
export function buildFileWritePrompt(input: {
  stepDescription: string;
  targetFiles: string[];
  existingFileContent?: string;
  relatedPatterns: string[];
  taskContext: string;
}): string {
  const {
    stepDescription,
    targetFiles,
    existingFileContent,
    relatedPatterns,
    taskContext,
  } = input;

  const patternsSection =
    relatedPatterns.length > 0
      ? relatedPatterns.map((p) => `- ${p}`).join("\n")
      : "None provided";

  return `# Step: ${stepDescription}

## Target Files
${targetFiles.map((f) => `- ${f}`).join("\n")}

## Task Context
${taskContext}

## Patterns to Follow
${patternsSection}

${
  existingFileContent
    ? `## Existing File Content (for reference)
\`\`\`
${truncateContent(existingFileContent, 3000)}
\`\`\`
`
    : ""
}
---

Write the complete file content for each target file. Follow the patterns identified during research.`;
}

// ============================================================================
// Test Fix Prompts
// ============================================================================

/**
 * System prompt for fixing failing tests.
 *
 * Guides the LLM to diagnose and fix test failures.
 */
export const TEST_FIX_SYSTEM_PROMPT = `You are fixing failing tests in a codebase.

Analyze the test failure and determine the root cause:
1. Is the test wrong (expecting incorrect behavior)?
2. Is the implementation wrong (bug in the code)?
3. Is there a type mismatch or import issue?
4. Is there a missing dependency or setup?

IMPORTANT DISTINCTIONS:
- Implementation bugs: Fix the source code
- Test bugs: Fix the test expectations
- Environment issues: These cannot be fixed in code - flag for escalation

Patterns that indicate ENVIRONMENT issues (should escalate immediately):
- ECONNREFUSED (service not running)
- ENOENT for system paths
- Permission denied
- Docker/container errors
- Out of memory (OOM)

When fixing code:
- Make minimal changes to fix the issue
- Don't refactor unrelated code
- Preserve existing patterns
- Add comments explaining the fix if non-obvious`;

/**
 * Build the user prompt for test fixing.
 *
 * Provides test failure details for diagnosis and fix.
 */
export function buildTestFixPrompt(input: {
  testOutput: string;
  failingFiles: string[];
  currentFileContents: Record<string, string>;
  attemptNumber: number;
  maxAttempts: number;
}): string {
  const {
    testOutput,
    failingFiles,
    currentFileContents,
    attemptNumber,
    maxAttempts,
  } = input;

  const fileSection = Object.entries(currentFileContents)
    .map(
      ([path, content]) =>
        `### ${path}\n\`\`\`\n${truncateContent(content, 2000)}\n\`\`\``,
    )
    .join("\n\n");

  return `# Test Fix Attempt ${attemptNumber} of ${maxAttempts}

## Test Output
\`\`\`
${truncateContent(testOutput, 4000)}
\`\`\`

## Failing Files
${failingFiles.map((f) => `- ${f}`).join("\n")}

## Current File Contents
${fileSection}

---

Analyze the test failure and provide the fix. If this appears to be an environment issue (see patterns above), indicate that this should be escalated.

${attemptNumber >= maxAttempts - 1 ? "WARNING: This is your last attempt before escalation." : ""}`;
}

// ============================================================================
// PR Feedback Prompts
// ============================================================================

/**
 * System prompt for addressing PR review feedback.
 *
 * Guides the LLM to respond to code review comments.
 */
export const PR_FEEDBACK_SYSTEM_PROMPT = `You are addressing code review feedback on a pull request.

The reviewer has provided comments. Address each piece of feedback:
1. Understand what the reviewer is asking for
2. Determine if the feedback is actionable (code change needed)
3. Make the requested changes following existing patterns
4. Don't make unrelated changes

TYPES OF FEEDBACK:
- Blocking: Must be fixed before merge (usually explicit requests)
- Suggestions: Nice to have, use judgment
- Questions: May or may not require code change
- Nits: Minor style issues, fix if reasonable

If feedback conflicts with the approved plan or seems incorrect:
- Note the concern in your response
- Follow the feedback anyway (reviewer has context you may not)
- The human will clarify if there's a real conflict

Keep changes focused on addressing the specific feedback.`;

/**
 * Build the user prompt for PR feedback handling.
 *
 * Provides review comments for the agent to address.
 */
export function buildPrFeedbackPrompt(input: {
  prNumber: number;
  reviewComments: string;
  currentFileContents: Record<string, string>;
  originalPlan: string;
}): string {
  const { prNumber, reviewComments, currentFileContents, originalPlan } = input;

  const fileSection = Object.entries(currentFileContents)
    .map(
      ([path, content]) =>
        `### ${path}\n\`\`\`\n${truncateContent(content, 2000)}\n\`\`\``,
    )
    .join("\n\n");

  return `# PR #${prNumber} Review Feedback

## Review Comments
${reviewComments}

## Original Implementation Plan
${truncateContent(originalPlan, 1000)}

## Current File Contents
${fileSection}

---

Address each piece of review feedback. Make targeted changes without modifying unrelated code.`;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Truncate content to a maximum length, preserving meaningful boundaries.
 */
function truncateContent(content: string, maxLength: number): string {
  if (content.length <= maxLength) {
    return content;
  }

  // Try to truncate at a line boundary
  const truncated = content.slice(0, maxLength);
  const lastNewline = truncated.lastIndexOf("\n");

  if (lastNewline > maxLength * 0.8) {
    return truncated.slice(0, lastNewline) + "\n... (truncated)";
  }

  return truncated + "... (truncated)";
}

/**
 * Format an execution plan as markdown for posting to Linear/Slack.
 */
export function formatPlanAsMarkdown(plan: {
  title: string;
  summary: string;
  confidence: "high" | "medium" | "low";
  confidenceReasoning: string;
  steps: Array<{
    description: string;
    files: string[];
    testStrategy: string;
  }>;
  estimatedChanges: string;
  risks: string[];
}): string {
  const confidenceEmoji =
    plan.confidence === "high"
      ? "HIGH"
      : plan.confidence === "medium"
        ? "MEDIUM"
        : "LOW";

  const stepsSection = plan.steps
    .map(
      (step, i) =>
        `### Step ${i + 1}: ${step.description}
- Files: ${step.files.join(", ") || "TBD"}
- Testing: ${step.testStrategy}`,
    )
    .join("\n\n");

  const risksSection =
    plan.risks.length > 0
      ? plan.risks.map((r) => `- ${r}`).join("\n")
      : "None identified";

  return `# ${plan.title}

## Summary
${plan.summary}

## Confidence: ${confidenceEmoji}
${plan.confidenceReasoning}

## Implementation Steps
${stepsSection}

## Estimated Changes
${plan.estimatedChanges}

## Risks
${risksSection}`;
}
