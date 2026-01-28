#!/usr/bin/env node

/**
 * Migration script: Rename @aesir/common to @aesir/types
 *
 * This script updates all imports from @aesir/common to @aesir/types
 * across the codebase.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

const PACKAGES_DIR = './packages';

function findFiles(dir, extensions = ['.ts', '.tsx', '.json']) {
  const files = [];

  function walk(currentDir) {
    const entries = readdirSync(currentDir);

    for (const entry of entries) {
      const fullPath = join(currentDir, entry);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        // Skip node_modules and dist
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

function updateFile(filePath) {
  const content = readFileSync(filePath, 'utf-8');

  // Replace @aesir/common with @aesir/types
  const updated = content.replace(/@aesir\/common/g, '@aesir/types');

  if (updated !== content) {
    writeFileSync(filePath, updated, 'utf-8');
    return true;
  }
  return false;
}

// Main
const files = findFiles(PACKAGES_DIR);
let updatedCount = 0;

for (const file of files) {
  if (updateFile(file)) {
    console.log(`Updated: ${file}`);
    updatedCount++;
  }
}

console.log(`\nTotal files updated: ${updatedCount}`);
