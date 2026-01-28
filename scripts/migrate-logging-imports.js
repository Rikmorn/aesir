#!/usr/bin/env node
/**
 * Migrate logging imports from @aesir/common to @aesir/platform
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

const LOGGING_SYMBOLS = new Set([
  'createPinoLogger',
  'createLogger',
  'createHttpLogger',
  'createTemporalLogger',
  'createChildLogger',
  'generateCorrelationId',
  'createTraceStore',
  'TraceStore',
  'createRedactionConfig',
  'REDACTION_PATHS',
  // Types
  'PinoLogger',
  'Logger',
  'TraceEntry',
  'TraceContext',
  'TraceLevel',
  'CorrelationContext',
  'OperationType',
  'HttpLogger',
  'HttpLoggerOptions',
  'TemporalLoggerInterface',
  'TemporalLogLevel',
  'ChildLoggerContext',
  'CreateLoggerOptions',
  'LoggerBindings',
]);

function findTsFiles(dir, files = []) {
  for (const file of readdirSync(dir)) {
    const path = join(dir, file);
    if (file === 'node_modules' || file === 'dist') continue;
    if (statSync(path).isDirectory()) {
      findTsFiles(path, files);
    } else if (extname(file) === '.ts') {
      files.push(path);
    }
  }
  return files;
}

function processFile(filePath) {
  const content = readFileSync(filePath, 'utf-8');

  // Match import statements from @aesir/common
  const importRegex = /import\s+(\{[^}]+\}|\*\s+as\s+\w+|type\s+\{[^}]+\})\s+from\s+["']@aesir\/common["'];?/g;

  let modified = false;
  let newContent = content;

  const matches = [...content.matchAll(importRegex)];

  for (const match of matches) {
    const fullImport = match[0];
    const importClause = match[1];

    // Parse the symbols
    const symbolsMatch = importClause.match(/\{([^}]+)\}/);
    if (!symbolsMatch) continue;

    const symbols = symbolsMatch[1].split(',').map(s => s.trim()).filter(Boolean);

    const loggingSymbols = [];
    const otherSymbols = [];

    for (const sym of symbols) {
      // Handle "type X" syntax
      const cleanSym = sym.replace(/^type\s+/, '');
      const isType = sym.startsWith('type ');

      if (LOGGING_SYMBOLS.has(cleanSym)) {
        loggingSymbols.push(sym);
      } else {
        otherSymbols.push(sym);
      }
    }

    if (loggingSymbols.length === 0) continue;

    modified = true;

    // Build new import statements
    let replacement = '';

    if (loggingSymbols.length > 0) {
      replacement += `import { ${loggingSymbols.join(', ')} } from "@aesir/platform";\n`;
    }

    if (otherSymbols.length > 0) {
      replacement += `import { ${otherSymbols.join(', ')} } from "@aesir/common";`;
    } else {
      // Remove trailing newline if no common import
      replacement = replacement.trimEnd();
    }

    newContent = newContent.replace(fullImport, replacement);
  }

  if (modified) {
    writeFileSync(filePath, newContent);
    console.log(`Updated: ${filePath}`);
    return true;
  }
  return false;
}

// Process all packages
const packages = ['packages/agents', 'packages/platform', 'packages/integrations', 'packages/observability', 'packages/test-utils'];
let count = 0;

for (const pkg of packages) {
  try {
    const files = findTsFiles(pkg);
    for (const file of files) {
      if (processFile(file)) count++;
    }
  } catch (e) {
    // Directory might not exist
  }
}

console.log(`\nTotal files updated: ${count}`);
