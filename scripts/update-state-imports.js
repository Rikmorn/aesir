#!/usr/bin/env node

/**
 * Migration script: Update state imports in agents package
 *
 * State types are now in agents/src/state, not @aesir/types.
 * This script updates imports within the agents package.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, extname, relative, dirname } from 'path';

const AGENTS_SRC = './packages/agents/src';

// State exports that moved to agents/src/state
const STATE_EXPORTS = [
  'AgentState',
  'AgentStateType',
  'AgentStateUpdate',
  'AgentStatus',
  'AgentStatusSchema',
  'createInitialState',
  'hasExceededLoopLimit',
  'shouldContinue',
  'MAX_LOOP_COUNT',
  'DevWorkflowState',
  'DevWorkflowStateType',
  'DevWorkflowStateUpdate',
  'DevWorkflowStatus',
  'DevWorkflowStatusSchema',
  'DevWorkflowConfig',
  'DEFAULT_DEV_WORKFLOW_CONFIG',
  'FileChange',
  'FileChangeSchema',
  'hasExceededTestLimit',
  'didTestsPass',
  'createDevWorkflowInitialState',
];

function findFiles(dir, extensions = ['.ts', '.tsx']) {
  const files = [];

  function walk(currentDir) {
    const entries = readdirSync(currentDir);

    for (const entry of entries) {
      const fullPath = join(currentDir, entry);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        if (entry !== 'node_modules' && entry !== 'dist') {
          walk(fullPath);
        }
      } else if (extensions.includes(extname(entry))) {
        files.push(fullPath);
      }
    }
  }

  walk(dir);
  return files;
}

function getRelativeImportPath(fromFile, toDir) {
  const fromDir = dirname(fromFile);
  let relativePath = relative(fromDir, toDir);

  // Ensure it starts with ./ or ../
  if (!relativePath.startsWith('.')) {
    relativePath = './' + relativePath;
  }

  return relativePath + '/index.js';
}

function updateFile(filePath) {
  // Skip files in the state folder itself
  if (filePath.includes('/state/')) {
    return false;
  }

  const content = readFileSync(filePath, 'utf-8');

  // Find imports from @aesir/types
  const importRegex = /import\s+(\{[^}]+\})\s+from\s+["']@aesir\/types["'];?/g;

  let match;
  let hasChanges = false;
  let newContent = content;

  while ((match = importRegex.exec(content)) !== null) {
    const fullMatch = match[0];
    const importBlock = match[1];

    // Parse individual imports
    const imports = importBlock
      .replace(/[{}]/g, '')
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    const stateImports = [];
    const otherImports = [];

    for (const imp of imports) {
      // Handle "type X" syntax
      const cleanName = imp.replace(/^type\s+/, '');

      if (STATE_EXPORTS.includes(cleanName)) {
        stateImports.push(imp);
      } else {
        otherImports.push(imp);
      }
    }

    if (stateImports.length > 0) {
      hasChanges = true;

      const stateImportPath = getRelativeImportPath(filePath, AGENTS_SRC + '/state');

      let replacement = '';

      if (stateImports.length > 0) {
        replacement += `import { ${stateImports.join(', ')} } from "${stateImportPath}";\n`;
      }

      if (otherImports.length > 0) {
        replacement += `import { ${otherImports.join(', ')} } from "@aesir/types";`;
      }

      newContent = newContent.replace(fullMatch, replacement.trim());
    }
  }

  if (hasChanges) {
    writeFileSync(filePath, newContent, 'utf-8');
    return true;
  }

  return false;
}

// Main
const files = findFiles(AGENTS_SRC);
let updatedCount = 0;

for (const file of files) {
  if (updateFile(file)) {
    console.log(`Updated: ${file}`);
    updatedCount++;
  }
}

console.log(`\nTotal files updated: ${updatedCount}`);
