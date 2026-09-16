/**
 * Guards drizzle's migration journals against the drift that caused #55.
 *
 * drizzle-kit applies what `meta/_journal.json` lists, not what the directory
 * contains. When a migration is hand-written rather than produced by
 * `drizzle-kit generate`, nothing appends a journal entry, and the file is
 * simply never applied. `db:migrate` still exits 0 and prints
 * "migrations applied successfully!", so the schema falls behind the code with
 * nothing to notice it -- six migrations in packages/agents, and the
 * task_correlations table in all three integrations.
 *
 * This walks every migrations directory in the repo rather than a hardcoded
 * list, so a new package is covered the day it is added.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "../../../..");
const packagesDir = path.join(repoRoot, "packages");

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

interface MigrationDir {
  /** Path relative to the repo root, for readable assertion messages. */
  label: string;
  sqlTags: string[];
  entries: JournalEntry[];
}

/**
 * Finds every directory holding a `meta/_journal.json`. node_modules is skipped:
 * workspace packages are symlinked into each other, so the same directory would
 * otherwise be reported once per dependent package.
 */
function findMigrationDirs(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "node_modules") continue;
    const child = path.join(dir, entry.name);
    if (existsSync(path.join(child, "meta/_journal.json"))) {
      found.push(child);
      continue;
    }
    findMigrationDirs(child, found);
  }
  return found;
}

function readMigrationDir(dir: string): MigrationDir {
  const journal = JSON.parse(
    readFileSync(path.join(dir, "meta/_journal.json"), "utf-8"),
  ) as { entries: JournalEntry[] };

  return {
    label: path.relative(repoRoot, dir),
    sqlTags: readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => f.slice(0, -".sql".length))
      .sort(),
    entries: journal.entries,
  };
}

const migrationDirs = findMigrationDirs(packagesDir)
  .filter((dir) => statSync(dir).isDirectory())
  .map(readMigrationDir);

describe("migration journals", () => {
  it("finds the migration directories to check", () => {
    // Without this, a broken walk would make every test below pass vacuously.
    expect(migrationDirs.length).toBeGreaterThan(0);
  });

  it.each(migrationDirs)("$label lists every .sql file", (dir) => {
    const listed = new Set(dir.entries.map((e) => e.tag));
    const unlisted = dir.sqlTags.filter((tag) => !listed.has(tag));

    // An unlisted file is never applied, and db:migrate still reports success.
    expect(unlisted).toEqual([]);
  });

  it.each(migrationDirs)("$label has no entry without a .sql file", (dir) => {
    const onDisk = new Set(dir.sqlTags);
    const orphaned = dir.entries
      .map((e) => e.tag)
      .filter((tag) => !onDisk.has(tag));

    // The opposite drift: drizzle fails at migrate time reading a missing file.
    expect(orphaned).toEqual([]);
  });

  it.each(migrationDirs)("$label orders entries by a rising when", (dir) => {
    // drizzle decides what is new by comparing `when` against the last applied
    // migration's timestamp, so a non-rising sequence silently skips entries on
    // a database that is already partly migrated.
    const whens = dir.entries.map((e) => e.when);
    expect(whens).toEqual([...whens].sort((a, b) => a - b));
  });

  it.each(migrationDirs)("$label has unique, gapless indexes", (dir) => {
    const indexes = dir.entries.map((e) => e.idx);
    expect(indexes).toEqual(indexes.map((_, position) => position));
  });
});
