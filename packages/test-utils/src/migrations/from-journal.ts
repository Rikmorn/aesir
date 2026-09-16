/**
 * Reads a package's real migration files instead of a hand-copied snapshot.
 *
 * test-utils used to carry its own transcription of each schema, which drifted:
 * the agents copy stopped at migration 0002 while the package had reached 0022,
 * so the integration suites ran against a schema missing whole tables. Reading
 * the files the service itself applies removes that drift class rather than
 * correcting one instance of it.
 *
 * `meta/_journal.json` is the order of record, not the directory listing --
 * drizzle applies what the journal lists, and #55 fixed the two disagreeing.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

interface JournalEntry {
  idx: number;
  tag: string;
}

interface Journal {
  entries: JournalEntry[];
}

/**
 * Concatenates a package's migrations in journal order.
 *
 * @param migrationsDir - directory holding the `.sql` files and `meta/_journal.json`
 */
export async function readJournalMigrations(
  migrationsDir: string,
): Promise<string> {
  const journalPath = path.join(migrationsDir, "meta", "_journal.json");

  let journal: Journal;
  try {
    journal = JSON.parse(await readFile(journalPath, "utf-8")) as Journal;
  } catch (cause) {
    throw new Error(`Cannot read migration journal at ${journalPath}`, {
      cause,
    });
  }

  const ordered = [...journal.entries].sort((a, b) => a.idx - b.idx);

  const sources = await Promise.all(
    ordered.map(async (entry) => {
      const file = path.join(migrationsDir, `${entry.tag}.sql`);
      try {
        return await readFile(file, "utf-8");
      } catch (cause) {
        // A journal entry naming no file means the two have drifted apart, the
        // same class of fault as an unjournaled file but in the other direction.
        throw new Error(
          `Journal entry ${entry.idx} (${entry.tag}) names a migration that does not exist: ${file}`,
          { cause },
        );
      }
    }),
  );

  // `--> statement-breakpoint` begins with `--`, so PostgreSQL reads it as a
  // comment and the files concatenate without further processing.
  return sources.join("\n");
}
